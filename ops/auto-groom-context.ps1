param(
  [string]$WorkspacePath = (Get-Location).Path,
  [string[]]$ProtectPaths = @("index.html", "ops/subagent-orchestrator-plan.md", "ops/subagent-control-loop.ps1", "ops/auto-groom-context.ps1"),
  [int]$StaleDays = 14,
  [int]$LargeFileMB = 2,
  [int]$ContextWarnPercent = 45,
  [int]$ContextHardPercent = 50,
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-DirIfMissing {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Get-TokenPressure {
  param([string]$Workspace)

  $report = Join-Path $Workspace "token-usage-output.txt"
  if (-not (Test-Path -LiteralPath $report)) {
    return [ordered]@{ percent = 0; source = "none" }
  }

  $raw = Get-Content -LiteralPath $report -Raw
  $local = [regex]::Match($raw, "Local Total:\s+([0-9,]+) tokens")
  $fresh = [regex]::Match($raw, "Fresh Input:\s+([0-9,]+) tokens")
  $cache = [regex]::Match($raw, "Cache Read:\s+([0-9,]+) tokens")

  if (-not ($local.Success -and $fresh.Success -and $cache.Success)) {
    return [ordered]@{ percent = 0; source = "partial" }
  }

  $freshInput = [int]($fresh.Groups[1].Value -replace ",", "")
  $cacheRead = [int]($cache.Groups[1].Value -replace ",", "")
  $denom = [Math]::Max(1, ($freshInput + $cacheRead))
  $pressure = [Math]::Round(($freshInput / $denom) * 100, 2)
  return [ordered]@{ percent = [int]$pressure; source = "token-usage-output.txt" }
}

function Is-Protected {
  param([string]$RelativePath, [string[]]$Protected)
  foreach ($p in $Protected) {
    if ($RelativePath -ieq $p) { return $true }
    if ($RelativePath -like ("$p/*")) { return $true }
  }
  return $false
}

function To-RelativePath {
  param([string]$Base, [string]$Full)
  return ([System.IO.Path]::GetRelativePath($Base, $Full)).Replace("\\", "/")
}

$opsDir = Join-Path $WorkspacePath "ops"
$archiveRoot = Join-Path $opsDir "archive"
$runtimeDir = Join-Path $opsDir "runtime-state"
New-DirIfMissing -Path $opsDir
New-DirIfMissing -Path $archiveRoot
New-DirIfMissing -Path $runtimeDir

$now = Get-Date
$stamp = $now.ToString("yyyyMMdd-HHmmss")
$sessionArchive = Join-Path $archiveRoot $stamp
New-DirIfMissing -Path $sessionArchive

$pressure = Get-TokenPressure -Workspace $WorkspacePath

$cutoff = $now.AddDays(-1 * $StaleDays)
$allFiles = Get-ChildItem -LiteralPath $WorkspacePath -File -Recurse

$candidates = @()
foreach ($f in $allFiles) {
  $rel = To-RelativePath -Base $WorkspacePath -Full $f.FullName
  if (Is-Protected -RelativePath $rel -Protected $ProtectPaths) { continue }
  if ($rel -like "ops/archive/*") { continue }
  if ($f.LastWriteTime -lt $cutoff) {
    $candidates += [ordered]@{
      path = $rel
      full = $f.FullName
      size_bytes = [int64]$f.Length
      last_write = $f.LastWriteTime.ToString("s")
      action = "archive"
    }
  }
}

$largeCandidates = @()
foreach ($f in $allFiles) {
  $rel = To-RelativePath -Base $WorkspacePath -Full $f.FullName
  if (Is-Protected -RelativePath $rel -Protected $ProtectPaths) { continue }
  if ($rel -like "ops/archive/*") { continue }
  if ($f.Length -ge ($LargeFileMB * 1MB)) {
    $largeCandidates += [ordered]@{
      path = $rel
      full = $f.FullName
      size_bytes = [int64]$f.Length
      last_write = $f.LastWriteTime.ToString("s")
      action = "compress"
    }
  }
}

$manifest = [ordered]@{
  timestamp = $now.ToString("s")
  context_pressure_percent = $pressure.percent
  context_source = $pressure.source
  thresholds = [ordered]@{ warn = $ContextWarnPercent; hard = $ContextHardPercent }
  dry_run = (-not $Apply.IsPresent)
  stale_candidates = $candidates
  large_candidates = $largeCandidates
  recommended_actions = @()
}

if ($pressure.percent -ge $ContextHardPercent) {
  $manifest.recommended_actions += "HARD_LIMIT: stop P2/P3 dispatch; run distill/prune/compress immediately"
} elseif ($pressure.percent -ge $ContextWarnPercent) {
  $manifest.recommended_actions += "WARN_LIMIT: schedule grooming pass in next control interval"
} else {
  $manifest.recommended_actions += "Context pressure healthy"
}

if ($Apply.IsPresent) {
  foreach ($c in $candidates) {
    $target = Join-Path $sessionArchive ($c.path -replace "/", "_")
    Move-Item -LiteralPath $c.full -Destination $target -Force
  }

  foreach ($l in $largeCandidates) {
    $zipName = ($l.path -replace "/", "_") + ".zip"
    $zipPath = Join-Path $sessionArchive $zipName
    Compress-Archive -Path $l.full -DestinationPath $zipPath -Force
  }
}

$manifestPath = Join-Path $sessionArchive "manifest.json"
$summaryPath = Join-Path $sessionArchive "summary.md"

$manifest | ConvertTo-Json -Depth 10 | Out-File -FilePath $manifestPath -Encoding utf8

$summary = @(
  "# Auto Grooming Summary"
  ""
  "- Timestamp: $($now.ToString('s'))"
  "- Mode: $(if ($Apply.IsPresent) { 'apply' } else { 'dry-run' })"
  "- Context pressure: $($pressure.percent)% (source: $($pressure.source))"
  "- Stale candidates: $($candidates.Count)"
  "- Large candidates: $($largeCandidates.Count)"
  ""
  "## Recommended Actions"
) + ($manifest.recommended_actions | ForEach-Object { "- $_" })

$summary | Out-File -FilePath $summaryPath -Encoding utf8

$runtimeStatus = [ordered]@{
  timestamp = $now.ToString("s")
  grooming_mode = if ($Apply.IsPresent) { "apply" } else { "dry-run" }
  context_pressure_percent = $pressure.percent
  stale_candidates = $candidates.Count
  large_candidates = $largeCandidates.Count
  archive_session = (To-RelativePath -Base $WorkspacePath -Full $sessionArchive)
}

$runtimeStatus | ConvertTo-Json -Depth 10 | Out-File -FilePath (Join-Path $runtimeDir "grooming-status.json") -Encoding utf8

Write-Host "Auto-groom complete. Archive session: $sessionArchive"
