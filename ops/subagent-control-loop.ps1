param(
  [int]$WorkerCount = 0,
  [int]$HeartbeatSeconds = 45,
  [int]$ProgressReportSeconds = 300,
  [int]$DriftAuditSeconds = 600,
  [int]$ContextWarnPercent = 45,
  [int]$ContextHardPercent = 50,
  [int]$MaxRetries = 3,
  [string]$WorkspacePath = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RecommendWorkerCount {
  param([int]$Requested)
  if ($Requested -gt 0) { return $Requested }

  $cpu = [Environment]::ProcessorCount
  $calculated = [Math]::Max(2, [Math]::Min(8, ($cpu - 1)))
  return $calculated
}

function New-DirIfMissing {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Write-Event {
  param(
    [string]$RuntimeDir,
    [string]$Type,
    [string]$Agent,
    [string]$TaskId,
    [string]$Status,
    [int]$Percent,
    [string]$NextAction,
    [string]$Blocker = ""
  )

  $evt = [ordered]@{
    timestamp = (Get-Date).ToString("s")
    type = $Type
    agent = $Agent
    task_id = $TaskId
    status = $Status
    percent = $Percent
    next_action = $NextAction
    blocker = $Blocker
  }

  ($evt | ConvertTo-Json -Compress) + [Environment]::NewLine |
    Out-File -FilePath (Join-Path $RuntimeDir "events.jsonl") -Append -Encoding utf8
}

function Get-QueueState {
  return [ordered]@{
    P0 = New-Object System.Collections.Generic.Queue[object]
    P1 = New-Object System.Collections.Generic.Queue[object]
    P2 = New-Object System.Collections.Generic.Queue[object]
    P3 = New-Object System.Collections.Generic.Queue[object]
  }
}

function Enqueue-Task {
  param(
    [hashtable]$Queues,
    [ValidateSet("P0", "P1", "P2", "P3")][string]$Priority,
    [hashtable]$Task
  )
  $Queues[$Priority].Enqueue($Task)
}

function Get-ContextPercentFromTokenReport {
  param([string]$Workspace)

  $file = Join-Path $Workspace "token-usage-output.txt"
  if (-not (Test-Path -LiteralPath $file)) { return 0 }

  $raw = Get-Content -LiteralPath $file -Raw
  $m = [regex]::Match($raw, "Cache Hit Rate:\s+([0-9.]+)%")
  if (-not $m.Success) { return 0 }

  # Proxy estimate: lower hit rate often indicates fresh context pressure.
  $hit = [double]$m.Groups[1].Value
  $freshPressure = [Math]::Round(100 - $hit, 2)
  return [int]$freshPressure
}

function Acquire-Lock {
  param([hashtable]$Locks, [string]$ScopeKey, [string]$Owner)
  if ($Locks.ContainsKey($ScopeKey)) { return $false }
  $Locks[$ScopeKey] = $Owner
  return $true
}

function Release-Lock {
  param([hashtable]$Locks, [string]$ScopeKey, [string]$Owner)
  if ($Locks.ContainsKey($ScopeKey) -and $Locks[$ScopeKey] -eq $Owner) {
    $Locks.Remove($ScopeKey)
  }
}

function Select-NextTask {
  param([hashtable]$Queues)

  if ($Queues.P0.Count -gt 0) { return $Queues.P0.Dequeue() }
  if ($Queues.P1.Count -gt 0) { return $Queues.P1.Dequeue() }
  if ($Queues.P2.Count -gt 0) { return $Queues.P2.Dequeue() }
  if ($Queues.P3.Count -gt 0) { return $Queues.P3.Dequeue() }
  return $null
}

$workers = Get-RecommendWorkerCount -Requested $WorkerCount
$opsDir = Join-Path $WorkspacePath "ops"
$runtimeDir = Join-Path $opsDir "runtime-state"
New-DirIfMissing -Path $opsDir
New-DirIfMissing -Path $runtimeDir

$state = [ordered]@{
  coordinator = "active"
  workers = @()
  queue_counts = @{ P0 = 0; P1 = 0; P2 = 0; P3 = 0 }
  lock_count = 0
  context_pressure_percent = 0
  last_progress_report = ""
  last_drift_audit = ""
}

for ($i = 1; $i -le $workers; $i++) {
  $state.workers += [ordered]@{
    name = "worker-$i"
    status = "idle"
    current_task = ""
    last_heartbeat = ""
  }
}

$queues = Get-QueueState
$locks = @{}

# Seed tasks (template; replace with real tasks from coordinator)
Enqueue-Task -Queues $queues -Priority "P1" -Task @{ id = "T-101"; scope = "module:orchestration"; attempt = 1; owner = ""; progress = 0 }
Enqueue-Task -Queues $queues -Priority "P1" -Task @{ id = "T-102"; scope = "module:grooming"; attempt = 1; owner = ""; progress = 0 }
Enqueue-Task -Queues $queues -Priority "P3" -Task @{ id = "T-103"; scope = "resource:archive"; attempt = 1; owner = ""; progress = 0 }

$lastReport = Get-Date
$lastDriftAudit = Get-Date

while ($true) {
  $now = Get-Date
  $contextPressure = Get-ContextPercentFromTokenReport -Workspace $WorkspacePath
  $state.context_pressure_percent = $contextPressure

  if ($contextPressure -ge $ContextHardPercent) {
    Write-Event -RuntimeDir $runtimeDir -Type "DRIFT_DETECTED" -Agent "coordinator" -TaskId "GLOBAL" -Status "hard-context-limit" -Percent 0 -NextAction "Pause P2/P3, trigger grooming" -Blocker "Context >= hard threshold"
    # Pause lower priorities and trigger P0 grooming task
    Enqueue-Task -Queues $queues -Priority "P0" -Task @{ id = "T-GROOM-HARD"; scope = "resource:context"; attempt = 1; owner = ""; progress = 0 }
  } elseif ($contextPressure -ge $ContextWarnPercent) {
    Write-Event -RuntimeDir $runtimeDir -Type "TASK_PROGRESS" -Agent "coordinator" -TaskId "GLOBAL" -Status "context-warning" -Percent $contextPressure -NextAction "Run grooming on next slot"
  }

  foreach ($worker in $state.workers) {
    if ([string]::IsNullOrWhiteSpace($worker.current_task)) {
      $candidate = Select-NextTask -Queues $queues
      if ($null -eq $candidate) {
        $worker.status = "idle"
        $worker.last_heartbeat = $now.ToString("s")
        continue
      }

      $lockOk = Acquire-Lock -Locks $locks -ScopeKey $candidate.scope -Owner $worker.name
      if (-not $lockOk) {
        # Conflict -> requeue with bump attempt
        $candidate.attempt = [int]$candidate.attempt + 1
        if ($candidate.attempt -le $MaxRetries) {
          Enqueue-Task -Queues $queues -Priority "P0" -Task $candidate
        } else {
          Write-Event -RuntimeDir $runtimeDir -Type "TASK_FAILED" -Agent $worker.name -TaskId $candidate.id -Status "lock-conflict" -Percent 0 -NextAction "Escalate to coordinator" -Blocker "Max retries reached"
        }
        continue
      }

      $candidate.owner = $worker.name
      $candidate.progress = 10
      $worker.current_task = $candidate.id
      $worker.status = "running"
      $worker.last_heartbeat = $now.ToString("s")
      Write-Event -RuntimeDir $runtimeDir -Type "TASK_ASSIGNED" -Agent $worker.name -TaskId $candidate.id -Status "running" -Percent 10 -NextAction "Execute with lease"

      $worker | Add-Member -NotePropertyName "scope" -NotePropertyValue $candidate.scope -Force
      $worker | Add-Member -NotePropertyName "progress" -NotePropertyValue 10 -Force
      $worker | Add-Member -NotePropertyName "attempt" -NotePropertyValue $candidate.attempt -Force
    } else {
      $worker.progress = [Math]::Min(100, [int]$worker.progress + 20)
      $worker.last_heartbeat = $now.ToString("s")
      Write-Event -RuntimeDir $runtimeDir -Type "TASK_HEARTBEAT" -Agent $worker.name -TaskId $worker.current_task -Status "running" -Percent $worker.progress -NextAction "Continue"

      if ($worker.progress -ge 100) {
        Write-Event -RuntimeDir $runtimeDir -Type "TASK_COMPLETED" -Agent $worker.name -TaskId $worker.current_task -Status "done" -Percent 100 -NextAction "Await next assignment"
        Release-Lock -Locks $locks -ScopeKey $worker.scope -Owner $worker.name
        $worker.current_task = ""
        $worker.status = "idle"
      }
    }
  }

  if (($now - $lastReport).TotalSeconds -ge $ProgressReportSeconds) {
    $state.last_progress_report = $now.ToString("s")
    Write-Event -RuntimeDir $runtimeDir -Type "TASK_PROGRESS" -Agent "coordinator" -TaskId "GLOBAL" -Status "periodic-report" -Percent 0 -NextAction "Report consolidated status"
    $lastReport = $now
  }

  if (($now - $lastDriftAudit).TotalSeconds -ge $DriftAuditSeconds) {
    $state.last_drift_audit = $now.ToString("s")
    Write-Event -RuntimeDir $runtimeDir -Type "DRIFT_CORRECTED" -Agent "coordinator" -TaskId "GLOBAL" -Status "audit-complete" -Percent 0 -NextAction "Continue dispatch"
    $lastDriftAudit = $now
  }

  $state.queue_counts = @{
    P0 = $queues.P0.Count
    P1 = $queues.P1.Count
    P2 = $queues.P2.Count
    P3 = $queues.P3.Count
  }
  $state.lock_count = $locks.Count

  $state | ConvertTo-Json -Depth 10 | Out-File -FilePath (Join-Path $runtimeDir "status.json") -Encoding utf8
  Start-Sleep -Seconds $HeartbeatSeconds
}
