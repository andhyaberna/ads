# Sub-Agent Orchestration Blueprint (Strategic Control)

## Strategic Objective

Menjalankan sub-agent paralel semaksimal mungkin **tanpa melanggar kontrol strategis**, dengan pilar berikut:

1. **Throughput tinggi** (parallel workers)
2. **Kontrol real-time** (heartbeat + deviation correction)
3. **Zero duplicate execution** (task lease + lock ownership)
4. **Context hygiene** (auto-grooming dan threshold < 50%)

## Worker Pool Model

- `coordinator`: 1 instance (single source of truth)
- `workers`: N instance (disarankan `N = max(2, min(8, logical_cpu - 1))`)
- `reviewer`: 1 instance (quality/plan critic)
- `advisor`: 1 instance (high-level reasoning/oracle)

## Load Balancing Policy

Gunakan **weighted round-robin + queue priority**.

Queue levels:

- `P0`: blocker/failure correction
- `P1`: implement core milestone
- `P2`: optimization
- `P3`: housekeeping

Dispatch rules:

1. Selalu drain `P0` dahulu.
2. `P1` minimal 50% jatah slot aktif.
3. `P2` maksimal 30% jatah slot.
4. `P3` berjalan saat sistem idle atau interval periodic.

## Anti-Conflict / Anti-Duplication

### Task Lease

Setiap task yang di-pick worker harus memiliki lease metadata:

- `task_id`
- `owner_agent`
- `lease_start`
- `lease_expiry`
- `heartbeat_interval_sec`
- `attempt`

Aturan:

- Task hanya boleh dieksekusi pemilik lease aktif.
- Lease expired otomatis masuk retry queue.
- Retry max 3x sebelum eskalasi ke coordinator.

### Lock Granularity

- Lock by `scope_key` (mis: `file:path`, `module:name`, `resource:id`)
- Tidak boleh mengambil task baru jika lock bentrok.

## Communication Pipeline

Semua komunikasi antar sub-agent harus berbasis event:

- `TASK_ASSIGNED`
- `TASK_HEARTBEAT`
- `TASK_PROGRESS`
- `TASK_BLOCKED`
- `TASK_COMPLETED`
- `TASK_FAILED`
- `DRIFT_DETECTED`
- `DRIFT_CORRECTED`

Payload minimum:

- `timestamp`
- `agent`
- `task_id`
- `status`
- `percent`
- `next_action`
- `blocker` (nullable)

## Real-Time Monitoring Cadence

- Heartbeat: tiap 30-60 detik
- Progress summary: tiap 5 menit
- Drift audit terhadap strategic plan: tiap 10 menit
- Context usage audit (`tokenscope`): tiap 10 menit

## Drift Correction Protocol

Jika deviasi terdeteksi:

1. Tandai `DRIFT_DETECTED`
2. Pause dispatch task non-priority
3. Re-issue instruction eksplisit:
   - target outcome
   - batasan
   - acceptance criteria
4. Resume execution hanya setelah `DRIFT_CORRECTED`

## Context Auto-Grooming Policy (<50%)

Trigger saat context >= 45%:

1. Distill output tool ber-noise tinggi
2. Prune output irrelevan/superseded
3. Compress fase yang sudah selesai
4. Off-load artefak panjang ke `ops/archive/` + simpan metadata ringkas

Hard stop:

- Jika >= 50%, hentikan dispatch P2/P3, jalankan grooming sampai < 40%.

## SLO (Operational)

- Duplicate execution rate: 0%
- Missed heartbeat > 2 interval: < 2%
- Drift correction TTR: < 5 menit
- Context breach >= 50%: 0 kejadian
