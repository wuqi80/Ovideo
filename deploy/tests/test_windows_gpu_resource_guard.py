import json
from pathlib import Path

from scripts.windows_gpu_resource_guard import (
    GIB,
    BoundedJsonlTelemetry,
    Gpu2ResourceController,
    ResourcePolicy,
)


def _host(*, available_gib=160, commit_available_gib=192):
    return {
        "ram_total": 256 * GIB,
        "ram_available": available_gib * GIB,
        "commit_limit": 320 * GIB,
        "commit_available": commit_available_gib * GIB,
        "commit_used": (320 - commit_available_gib) * GIB,
    }


def _ai(*, private_gib=12, working_set_gib=10):
    return {
        "private_bytes": private_gib * GIB,
        "working_set_bytes": working_set_gib * GIB,
        "process_count": 2,
        "pids": [101, 202],
    }


def _controller(tmp_path, *, host_reader=None, process_reader=None, emergency_stop=None):
    writer = BoundedJsonlTelemetry(
        tmp_path,
        max_file_bytes=1024 * 1024,
        max_total_bytes=4 * 1024 * 1024,
        retention_days=7,
    )
    return Gpu2ResourceController(
        Path(r"E:\MECHA-GPU"),
        writer=writer,
        host_reader=host_reader or (lambda: _host()),
        process_reader=process_reader or (lambda _root: _ai()),
        comfy_reader=lambda: {
            "ram_total": 256 * GIB,
            "ram_free": 160 * GIB,
            "vram_total": 12 * GIB,
            "vram_free": 10 * GIB,
        },
        emergency_stop=emergency_stop,
    )


def _records(root):
    result = []
    for path in sorted(root.glob("gpu-memory-*.jsonl")):
        result.extend(json.loads(line) for line in path.read_text(encoding="utf-8").splitlines())
    return result


def test_resource_guard_allows_load_only_with_large_host_reserve(tmp_path):
    controller = _controller(tmp_path)

    assert controller.ready_for_new_task() is True
    status = controller.status()
    assert status["ready_for_new_task"] is True
    assert status["policy"]["min_free_for_load_bytes"] == 96 * GIB
    assert status["policy"]["hard_ai_private_bytes"] == 128 * GIB


def test_resource_guard_fails_closed_below_96_gib_without_stopping_host(tmp_path):
    stopped = []
    controller = _controller(
        tmp_path,
        host_reader=lambda: _host(available_gib=80),
        emergency_stop=lambda: stopped.append(True) or True,
    )

    assert controller.ready_for_new_task() is False
    assert controller.status()["emergency"] is False
    assert stopped == []


def test_resource_guard_stops_gpu_runtime_at_unload_reserve(tmp_path):
    stopped = []
    controller = _controller(
        tmp_path,
        host_reader=lambda: _host(available_gib=47),
        emergency_stop=lambda: stopped.append(True) or True,
    )

    assert controller.ready_for_new_task() is False
    assert stopped == [True]
    assert controller.status()["emergency"] is True
    assert "unload reserve" in controller.last_error


def test_resource_guard_stops_only_gpu_runtime_at_emergency_threshold(tmp_path):
    stopped = []
    controller = _controller(
        tmp_path,
        host_reader=lambda: _host(available_gib=31),
        emergency_stop=lambda: stopped.append(True) or True,
    )

    assert controller.ready_for_new_task() is False
    assert stopped == [True]
    assert controller.status()["emergency"] is True
    assert any(record["event"] == "emergency_stop" for record in _records(tmp_path))


def test_resource_guard_stops_gpu_runtime_at_128_gib_ai_private_memory(tmp_path):
    stopped = []
    controller = _controller(
        tmp_path,
        process_reader=lambda _root: _ai(private_gib=128, working_set_gib=120),
        emergency_stop=lambda: stopped.append(True) or True,
    )

    assert controller.ready_for_new_task() is False
    assert stopped == [True]
    assert "hard private-memory ceiling" in controller.last_error


def test_task_telemetry_is_bounded_and_excludes_prompts_and_assets(tmp_path):
    controller = _controller(tmp_path)
    controller.begin_task({
        "task_id": "task-1",
        "task_type": "i2v",
        "runtime_profile": "wan",
        "model": "wan21",
        "width": 640,
        "height": 384,
        "duration_seconds": 5,
        "prompt": "must never be recorded",
        "image_path": "private.png",
    })
    controller.sample_now()
    summary = controller.finish_task("completed", models_released=True)

    assert summary["metrics"]["sample_count"] >= 2
    assert summary["metrics"]["peak_ai_private_bytes"] == 12 * GIB
    assert summary["models_released"] is True
    serialized = json.dumps(_records(tmp_path), ensure_ascii=False)
    assert "must never be recorded" not in serialized
    assert "private.png" not in serialized


def test_telemetry_write_failure_closes_new_task_gate(tmp_path):
    blocked_root = tmp_path / "not-a-directory"
    blocked_root.write_text("occupied", encoding="utf-8")
    controller = Gpu2ResourceController(
        Path(r"E:\MECHA-GPU"),
        writer=BoundedJsonlTelemetry(blocked_root),
        host_reader=lambda: _host(),
        process_reader=lambda _root: _ai(),
    )

    assert controller.ready_for_new_task() is False
    assert "telemetry write failed" in controller.last_error


def test_resource_policy_environment_defaults_are_conservative(monkeypatch):
    monkeypatch.delenv("MECHA_GPU_MIN_FREE_FOR_LOAD_GIB", raising=False)
    monkeypatch.delenv("MECHA_GPU_HARD_AI_PRIVATE_GIB", raising=False)

    policy = ResourcePolicy.from_env()

    assert policy.min_free_for_load_bytes == 96 * GIB
    assert policy.normal_ai_private_bytes == 96 * GIB
    assert policy.warning_ai_private_bytes == 112 * GIB
    assert policy.hard_ai_private_bytes == 128 * GIB
    assert policy.active_interval_seconds == 2
    assert policy.idle_interval_seconds == 10
