# GPU2 safe runtime policy

This policy applies to the shared Windows GPU host that also owns the fixed
64 GiB DFS Ubuntu VM.  DFS production health always has priority over local AI
throughput.

## Activation boundary

- Keep `MECHA_LOCAL_GPU_MAINTENANCE=1` while DFS is replaying, rebuilding its
  index, degraded, or awaiting acceptance.  Local ComfyUI submissions fail with
  a maintenance response; external API providers remain available.
- Deploying these files does not authorize starting ComfyUI, Agent, Windows,
  VMware, or DFS.  Production synchronization and activation require separate
  explicit approvals.
- Do not activate the Agent until the current-boot DFS readiness gate and its
  sustained health checks have passed.

## Conservative 256 GiB defaults

| Boundary | Default | Result |
| --- | ---: | --- |
| Fixed DFS VM | 64 GiB | Never reclaimed for AI |
| Minimum free RAM before a new model | 96 GiB | Agent does not claim work |
| Queue pause reserve | 64 GiB | No new model load |
| Controlled-stop reserve | 48 GiB | Stop only the Agent-owned runtime and unload models |
| Emergency host reserve | 32 GiB | Stop only the Agent-owned ComfyUI runtime |
| Normal AI private-memory target | below 96 GiB | Normal serial operation |
| AI private-memory warning | 112 GiB | No new load; investigate trend |
| AI private-memory hard ceiling | 128 GiB | Stop only the Agent-owned runtime |

These are safety limits, not capacity targets.  A D-drive pagefile is emergency
headroom only and is never counted as normal model memory.  The guard does not
create, resize, or inspect pagefile configuration and never calls WMI, WinRM,
SCM, VMware, or DFS controls.

## Model and queue lifecycle

1. The backend and browser submit local GPU work serially.
2. The Agent performs a fresh host/commit/process telemetry sample before each
   claim and again immediately before task start.
3. Only one managed runtime owns the local service entry at a time.
4. After every task, ComfyUI receives `/free` with model unload and memory-free
   flags.
5. The next task stays queued until RAM and VRAM recover for three consecutive
   samples and at least 96 GiB physical RAM is free.
6. Unknown listeners are never killed.  An emergency stop targets only the
   known runtime profile already owned by this Agent.

## Telemetry

- Active tasks sample every 2 seconds; idle operation samples every 10 seconds.
- Files are daily JSONL under `D:\MECHA-GPU-Telemetry`.
- Each file is limited to 64 MiB; total storage is limited to 512 MiB; default
  retention is 30 days.
- Records include Windows physical/commit memory, aggregate MECHA process-tree
  private and working-set memory, ComfyUI RAM/VRAM, model/runtime phase, and
  per-task peak/average/P95/minimum-free summaries.
- Prompt text, source paths, media URLs, and user content are never recorded.
- If telemetry cannot be read or persisted, new local GPU work fails closed.

Environment overrides exist for controlled future tuning:

```text
MECHA_GPU_TELEMETRY_DIR
MECHA_GPU_MIN_FREE_FOR_LOAD_GIB
MECHA_GPU_PAUSE_FREE_GIB
MECHA_GPU_UNLOAD_FREE_GIB
MECHA_GPU_EMERGENCY_FREE_GIB
MECHA_GPU_MIN_COMMIT_HEADROOM_GIB
MECHA_GPU_EMERGENCY_COMMIT_HEADROOM_GIB
MECHA_GPU_NORMAL_AI_PRIVATE_GIB
MECHA_GPU_WARNING_AI_PRIVATE_GIB
MECHA_GPU_HARD_AI_PRIVATE_GIB
MECHA_GPU_TELEMETRY_ACTIVE_SECONDS
MECHA_GPU_TELEMETRY_IDLE_SECONDS
MECHA_GPU_TELEMETRY_FILE_MIB
MECHA_GPU_TELEMETRY_TOTAL_MIB
MECHA_GPU_TELEMETRY_RETENTION_DAYS
```

Do not loosen these values from production observations alone.  Review at least
several weeks of task summaries, confirm no sustained paging and no DFS health
impact, then obtain explicit approval before enabling concurrency or lowering
reserves.
