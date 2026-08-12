"""Low-overhead Windows resource telemetry and fail-closed GPU task guard.

The guard is deliberately scoped to the local MECHA process tree.  It never
changes the pagefile, VMware, DFS, or host services.  Production activation is
separate from deploying this module.
"""
from __future__ import annotations

import ctypes
import json
import math
import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable


GIB = 1024 ** 3
MIB = 1024 ** 2


def _env_int(name: str, default: int, *, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return max(minimum, int(default))


@dataclass(frozen=True)
class ResourcePolicy:
    """Conservative defaults for a 256 GiB host with a fixed 64 GiB DFS VM."""

    min_free_for_load_bytes: int = 96 * GIB
    pause_free_bytes: int = 64 * GIB
    unload_free_bytes: int = 48 * GIB
    emergency_free_bytes: int = 32 * GIB
    min_commit_headroom_for_load_bytes: int = 64 * GIB
    emergency_commit_headroom_bytes: int = 16 * GIB
    normal_ai_private_bytes: int = 96 * GIB
    warning_ai_private_bytes: int = 112 * GIB
    hard_ai_private_bytes: int = 128 * GIB
    active_interval_seconds: int = 2
    idle_interval_seconds: int = 10

    @classmethod
    def from_env(cls) -> "ResourcePolicy":
        gib = lambda name, default: _env_int(name, default) * GIB
        return cls(
            min_free_for_load_bytes=gib("MECHA_GPU_MIN_FREE_FOR_LOAD_GIB", 96),
            pause_free_bytes=gib("MECHA_GPU_PAUSE_FREE_GIB", 64),
            unload_free_bytes=gib("MECHA_GPU_UNLOAD_FREE_GIB", 48),
            emergency_free_bytes=gib("MECHA_GPU_EMERGENCY_FREE_GIB", 32),
            min_commit_headroom_for_load_bytes=gib("MECHA_GPU_MIN_COMMIT_HEADROOM_GIB", 64),
            emergency_commit_headroom_bytes=gib("MECHA_GPU_EMERGENCY_COMMIT_HEADROOM_GIB", 16),
            normal_ai_private_bytes=gib("MECHA_GPU_NORMAL_AI_PRIVATE_GIB", 96),
            warning_ai_private_bytes=gib("MECHA_GPU_WARNING_AI_PRIVATE_GIB", 112),
            hard_ai_private_bytes=gib("MECHA_GPU_HARD_AI_PRIVATE_GIB", 128),
            active_interval_seconds=_env_int("MECHA_GPU_TELEMETRY_ACTIVE_SECONDS", 2, minimum=1),
            idle_interval_seconds=_env_int("MECHA_GPU_TELEMETRY_IDLE_SECONDS", 10, minimum=2),
        )


class _MemoryStatusEx(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def read_windows_host_memory() -> Dict[str, int] | None:
    """Read physical and commit memory without WMI, PowerShell, or subprocesses."""
    if os.name != "nt":
        return None
    status = _MemoryStatusEx()
    status.dwLength = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return None
    commit_limit = int(status.ullTotalPageFile)
    commit_available = int(status.ullAvailPageFile)
    return {
        "ram_total": int(status.ullTotalPhys),
        "ram_available": int(status.ullAvailPhys),
        "commit_limit": commit_limit,
        "commit_available": commit_available,
        "commit_used": max(0, commit_limit - commit_available),
    }


class _ProcessEntry32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", ctypes.c_ulong),
        ("cntUsage", ctypes.c_ulong),
        ("th32ProcessID", ctypes.c_ulong),
        ("th32DefaultHeapID", ctypes.c_void_p),
        ("th32ModuleID", ctypes.c_ulong),
        ("cntThreads", ctypes.c_ulong),
        ("th32ParentProcessID", ctypes.c_ulong),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", ctypes.c_ulong),
        ("szExeFile", ctypes.c_wchar * 260),
    ]


class _ProcessMemoryCountersEx(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("PageFaultCount", ctypes.c_ulong),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


def _windows_process_rows() -> list[tuple[int, int, str]]:
    if os.name != "nt":
        return []
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    kernel32.CreateToolhelp32Snapshot.argtypes = [ctypes.c_ulong, ctypes.c_ulong]
    kernel32.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_ProcessEntry32W)]
    kernel32.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_ProcessEntry32W)]
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
    invalid_handle = ctypes.c_void_p(-1).value
    if snapshot == invalid_handle:
        return []
    rows: list[tuple[int, int, str]] = []
    entry = _ProcessEntry32W()
    entry.dwSize = ctypes.sizeof(entry)
    try:
        ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            rows.append((int(entry.th32ProcessID), int(entry.th32ParentProcessID), str(entry.szExeFile)))
            ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    return rows


def _windows_process_image_and_memory(pid: int) -> tuple[str, int, int] | None:
    if os.name != "nt":
        return None
    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel32.QueryFullProcessImageNameW.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_wchar_p,
        ctypes.POINTER(ctypes.c_ulong),
    ]
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(_ProcessMemoryCountersEx),
        ctypes.c_ulong,
    ]
    process = kernel32.OpenProcess(0x1000 | 0x0010, False, int(pid))
    if not process:
        return None
    try:
        size = ctypes.c_ulong(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        if not kernel32.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)):
            return None
        counters = _ProcessMemoryCountersEx()
        counters.cb = ctypes.sizeof(counters)
        if not ctypes.windll.psapi.GetProcessMemoryInfo(
            process, ctypes.byref(counters), counters.cb
        ):
            return None
        return str(buffer.value), int(counters.PrivateUsage), int(counters.WorkingSetSize)
    finally:
        kernel32.CloseHandle(process)


def read_mecha_process_memory(root: Path) -> Dict[str, Any] | None:
    """Aggregate MECHA executables and all descendants, including child FFmpeg."""
    if os.name != "nt":
        return None
    rows = _windows_process_rows()
    if not rows:
        return None
    normalized_root = os.path.normcase(os.path.abspath(str(root))).rstrip("\\/") + os.sep
    parents: Dict[int, list[int]] = {}
    details: Dict[int, tuple[str, int, int]] = {}
    root_pids: set[int] = set()
    for pid, parent_pid, _exe in rows:
        parents.setdefault(parent_pid, []).append(pid)
        detail = _windows_process_image_and_memory(pid)
        if detail is None:
            continue
        details[pid] = detail
        image = os.path.normcase(os.path.abspath(detail[0]))
        if image.startswith(normalized_root):
            root_pids.add(pid)

    included = set(root_pids)
    pending = list(root_pids)
    while pending:
        parent = pending.pop()
        for child in parents.get(parent, []):
            if child not in included:
                included.add(child)
                pending.append(child)

    private_bytes = 0
    working_set_bytes = 0
    measured_pids: list[int] = []
    for pid in sorted(included):
        detail = details.get(pid) or _windows_process_image_and_memory(pid)
        if detail is None:
            continue
        measured_pids.append(pid)
        private_bytes += int(detail[1])
        working_set_bytes += int(detail[2])
    return {
        "private_bytes": private_bytes,
        "working_set_bytes": working_set_bytes,
        "process_count": len(measured_pids),
        "pids": measured_pids,
    }


class BoundedJsonlTelemetry:
    """Daily JSONL telemetry with bounded files, retention, and total storage."""

    def __init__(
        self,
        root: Path | None = None,
        *,
        max_file_bytes: int | None = None,
        max_total_bytes: int | None = None,
        retention_days: int | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.root = Path(root or os.environ.get("MECHA_GPU_TELEMETRY_DIR", r"D:\MECHA-GPU-Telemetry"))
        self.max_file_bytes = max_file_bytes or _env_int("MECHA_GPU_TELEMETRY_FILE_MIB", 64, minimum=1) * MIB
        self.max_total_bytes = max_total_bytes or _env_int("MECHA_GPU_TELEMETRY_TOTAL_MIB", 512, minimum=16) * MIB
        self.retention_days = retention_days or _env_int("MECHA_GPU_TELEMETRY_RETENTION_DAYS", 30, minimum=1)
        self.clock = clock
        self.healthy = True
        self.last_error = ""
        self._writes_since_prune = 0
        self._lock = threading.Lock()

    def _timestamp(self) -> datetime:
        return datetime.fromtimestamp(self.clock(), tz=timezone.utc)

    def _target_path(self, now: datetime) -> Path:
        stem = f"gpu-memory-{now.strftime('%Y%m%d')}"
        index = 0
        while True:
            path = self.root / f"{stem}-{index:02d}.jsonl"
            if not path.exists() or path.stat().st_size < self.max_file_bytes:
                return path
            index += 1

    def _prune(self, now: datetime) -> None:
        files = sorted(self.root.glob("gpu-memory-*.jsonl"), key=lambda path: path.stat().st_mtime)
        cutoff = now.timestamp() - self.retention_days * 86400
        for path in list(files):
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
                files.remove(path)
        total = sum(path.stat().st_size for path in files)
        while files and total > self.max_total_bytes:
            oldest = files.pop(0)
            size = oldest.stat().st_size
            oldest.unlink(missing_ok=True)
            total -= size

    def write(self, payload: Dict[str, Any]) -> bool:
        with self._lock:
            try:
                now = self._timestamp()
                self.root.mkdir(parents=True, exist_ok=True)
                record = dict(payload)
                record.setdefault("timestamp", now.isoformat())
                encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
                path = self._target_path(now)
                with path.open("a", encoding="utf-8", newline="\n") as handle:
                    handle.write(encoded)
                self._writes_since_prune += 1
                if self._writes_since_prune >= 100:
                    self._prune(now)
                    self._writes_since_prune = 0
                self.healthy = True
                self.last_error = ""
                return True
            except (OSError, ValueError, TypeError) as exc:
                self.healthy = False
                self.last_error = f"telemetry write failed: {exc}"
                return False


class _TaskAccumulator:
    """Bounded per-task statistics; never retains every long-task sample."""

    def __init__(self, max_samples: int = 2048) -> None:
        self.count = 0
        self.ai_private_sum = 0
        self.commit_used_sum = 0
        self.peak_ai_private = 0
        self.peak_working_set = 0
        self.peak_commit_used = 0
        self.peak_vram_used = 0
        self.min_ram_available: int | None = None
        self.min_commit_available: int | None = None
        self.ai_private_samples: deque[int] = deque(maxlen=max_samples)

    def add(self, snapshot: Dict[str, Any]) -> None:
        host = snapshot.get("host") or {}
        ai = snapshot.get("ai") or {}
        comfy = snapshot.get("comfyui") or {}
        ai_private = int(ai.get("private_bytes") or 0)
        working_set = int(ai.get("working_set_bytes") or 0)
        commit_used = int(host.get("commit_used") or 0)
        ram_available = int(host.get("ram_available") or 0)
        commit_available = int(host.get("commit_available") or 0)
        vram_used = max(0, int(comfy.get("vram_total") or 0) - int(comfy.get("vram_free") or 0))
        self.count += 1
        self.ai_private_sum += ai_private
        self.commit_used_sum += commit_used
        self.peak_ai_private = max(self.peak_ai_private, ai_private)
        self.peak_working_set = max(self.peak_working_set, working_set)
        self.peak_commit_used = max(self.peak_commit_used, commit_used)
        self.peak_vram_used = max(self.peak_vram_used, vram_used)
        self.min_ram_available = ram_available if self.min_ram_available is None else min(self.min_ram_available, ram_available)
        self.min_commit_available = commit_available if self.min_commit_available is None else min(self.min_commit_available, commit_available)
        self.ai_private_samples.append(ai_private)

    def summary(self) -> Dict[str, int]:
        ordered = sorted(self.ai_private_samples)
        p95_index = max(0, math.ceil(len(ordered) * 0.95) - 1) if ordered else 0
        return {
            "sample_count": self.count,
            "average_ai_private_bytes": self.ai_private_sum // max(1, self.count),
            "p95_ai_private_bytes": ordered[p95_index] if ordered else 0,
            "peak_ai_private_bytes": self.peak_ai_private,
            "peak_ai_working_set_bytes": self.peak_working_set,
            "average_commit_used_bytes": self.commit_used_sum // max(1, self.count),
            "peak_commit_used_bytes": self.peak_commit_used,
            "min_ram_available_bytes": int(self.min_ram_available or 0),
            "min_commit_available_bytes": int(self.min_commit_available or 0),
            "peak_vram_used_bytes": self.peak_vram_used,
        }


class Gpu2ResourceController:
    """Sample resources, record task summaries, and stop only the GPU runtime."""

    def __init__(
        self,
        root: Path,
        *,
        policy: ResourcePolicy | None = None,
        writer: BoundedJsonlTelemetry | None = None,
        host_reader: Callable[[], Dict[str, int] | None] = read_windows_host_memory,
        process_reader: Callable[[Path], Dict[str, Any] | None] = read_mecha_process_memory,
        comfy_reader: Callable[[], Dict[str, int] | None] | None = None,
        emergency_stop: Callable[[], bool] | None = None,
    ) -> None:
        self.root = Path(root)
        self.policy = policy or ResourcePolicy.from_env()
        self.writer = writer or BoundedJsonlTelemetry()
        self.host_reader = host_reader
        self.process_reader = process_reader
        self.comfy_reader = comfy_reader or (lambda: None)
        self.emergency_stop = emergency_stop or (lambda: False)
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._task: Dict[str, Any] | None = None
        self._task_stats: _TaskAccumulator | None = None
        self._last_snapshot: Dict[str, Any] | None = None
        self._last_error = "resource telemetry has not produced a valid sample"
        self._emergency_latched = False

    def _evaluate(self, snapshot: Dict[str, Any] | None) -> tuple[bool, bool, list[str]]:
        if snapshot is None:
            return False, False, ["resource telemetry unavailable"]
        host = snapshot.get("host") or {}
        ai = snapshot.get("ai") or {}
        ram_available = int(host.get("ram_available") or 0)
        commit_available = int(host.get("commit_available") or 0)
        ai_private = int(ai.get("private_bytes") or 0)
        alerts: list[str] = []
        emergency = False
        if ram_available < self.policy.emergency_free_bytes:
            alerts.append("host physical memory crossed emergency reserve")
            emergency = True
        elif ram_available < self.policy.unload_free_bytes:
            alerts.append("host physical memory crossed unload reserve")
            emergency = True
        elif ram_available < self.policy.pause_free_bytes:
            alerts.append("host physical memory crossed queue pause reserve")
        if commit_available < self.policy.emergency_commit_headroom_bytes:
            alerts.append("host commit headroom crossed emergency reserve")
            emergency = True
        if ai_private >= self.policy.hard_ai_private_bytes:
            alerts.append("MECHA process tree crossed hard private-memory ceiling")
            emergency = True
        elif ai_private >= self.policy.warning_ai_private_bytes:
            alerts.append("MECHA process tree crossed warning private-memory level")

        ready = (
            self.writer.healthy
            and ram_available >= self.policy.min_free_for_load_bytes
            and commit_available >= self.policy.min_commit_headroom_for_load_bytes
            and ai_private < self.policy.normal_ai_private_bytes
            and not emergency
        )
        return ready, emergency, alerts

    def sample_now(self, *, event: str = "sample") -> Dict[str, Any] | None:
        host = self.host_reader()
        ai = self.process_reader(self.root)
        if host is None or ai is None:
            with self._lock:
                self._last_error = "resource telemetry could not read Windows host or MECHA process memory"
            self.writer.write({"event": "telemetry_error", "reason": self._last_error})
            return None
        try:
            comfy = self.comfy_reader()
        except Exception:
            comfy = None
        with self._lock:
            task = dict(self._task) if self._task else None
        snapshot: Dict[str, Any] = {
            "event": event,
            "phase": "active" if task else "idle",
            "host": host,
            "ai": ai,
            "comfyui": comfy or {},
        }
        if task:
            snapshot["task"] = task
        ready, emergency, alerts = self._evaluate(snapshot)
        snapshot["guard"] = {
            "ready_for_new_task": ready,
            "emergency": emergency,
            "alerts": alerts,
        }
        write_ok = self.writer.write(snapshot)
        with self._lock:
            self._last_snapshot = snapshot
            self._last_error = "" if write_ok else self.writer.last_error
            if self._task_stats is not None:
                self._task_stats.add(snapshot)
        if emergency and not self._emergency_latched:
            self._emergency_latched = True
            stopped = False
            try:
                stopped = bool(self.emergency_stop())
            except Exception:
                stopped = False
            self.writer.write({
                "event": "emergency_stop",
                "reason": alerts,
                "gpu_runtime_stopped": stopped,
            })
        elif not emergency:
            self._emergency_latched = False
        return snapshot

    def ready_for_new_task(self) -> bool:
        snapshot = self.sample_now(event="preflight_sample")
        ready, _emergency, alerts = self._evaluate(snapshot)
        if not self.writer.healthy:
            ready = False
            alerts = [self.writer.last_error or "telemetry persistence is unavailable"]
        with self._lock:
            self._last_error = "" if ready else "; ".join(alerts or ["resource guard is closed"])
        return ready

    def begin_task(self, task: Dict[str, Any]) -> None:
        if not self.ready_for_new_task():
            raise RuntimeError(f"GPU resource guard refused task start: {self.last_error}")
        safe_task = {
            "task_id": str(task.get("task_id") or ""),
            "task_type": str(task.get("task_type") or ""),
            "runtime_profile": str(task.get("runtime_profile") or ""),
            "model": str(task.get("model") or ""),
            "width": int(task.get("width") or 0),
            "height": int(task.get("height") or 0),
            "duration_seconds": float(task.get("duration_seconds") or 0),
        }
        with self._lock:
            self._task = safe_task
            self._task_stats = _TaskAccumulator()
        self.writer.write({"event": "task_start", "task": safe_task})

    def finish_task(self, status: str, *, models_released: bool) -> Dict[str, Any]:
        self.sample_now(event="task_final_sample")
        with self._lock:
            task = dict(self._task) if self._task else {}
            stats = self._task_stats.summary() if self._task_stats else {}
            self._task = None
            self._task_stats = None
        summary = {
            "event": "task_summary",
            "task": task,
            "status": str(status),
            "models_released": bool(models_released),
            "metrics": stats,
        }
        self.writer.write(summary)
        return summary

    def status(self) -> Dict[str, Any]:
        with self._lock:
            snapshot = self._last_snapshot
            error = self._last_error
        ready, emergency, alerts = self._evaluate(snapshot)
        if not self.writer.healthy:
            ready = False
            error = self.writer.last_error
        return {
            "ready_for_new_task": ready,
            "emergency": emergency,
            "alerts": alerts,
            "last_error": error,
            "telemetry_healthy": self.writer.healthy,
            "policy": {
                "min_free_for_load_bytes": self.policy.min_free_for_load_bytes,
                "normal_ai_private_bytes": self.policy.normal_ai_private_bytes,
                "warning_ai_private_bytes": self.policy.warning_ai_private_bytes,
                "hard_ai_private_bytes": self.policy.hard_ai_private_bytes,
            },
        }

    @property
    def last_error(self) -> str:
        with self._lock:
            return self._last_error

    def _run(self) -> None:
        while not self._stop_event.is_set():
            self.sample_now()
            with self._lock:
                active = self._task is not None
            interval = self.policy.active_interval_seconds if active else self.policy.idle_interval_seconds
            self._stop_event.wait(interval)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="mecha-resource-telemetry", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=5)
