import json
from pathlib import Path

import pytest
import requests

from pipeline.comfyui_agent import ComfyUIAgent


class _Response:
    def raise_for_status(self):
        return None


def _agent(tmp_path, monkeypatch):
    monkeypatch.setattr("signal.signal", lambda *_args, **_kwargs: None)
    agent = ComfyUIAgent("https://example.test", "token", [8188])
    agent.agent_id = "agent_test"
    agent.pending_completion_dir = tmp_path / "pending"
    agent.pending_completion_dir.mkdir(parents=True)
    agent.completion_retry_delays = (0, 0)
    return agent


def test_completion_retries_with_fresh_file_handle(tmp_path, monkeypatch):
    agent = _agent(tmp_path, monkeypatch)
    output = tmp_path / "result.webp"
    output.write_bytes(b"gpu-output")
    attempts = []

    def fake_post(*_args, **kwargs):
        uploaded = kwargs["files"][0][1][1].read()
        attempts.append(uploaded)
        if len(attempts) == 1:
            raise requests.Timeout("write timed out")
        return _Response()

    monkeypatch.setattr(requests, "post", fake_post)

    assert agent.complete("task-1", "completed", 12.5, [str(output)]) is True
    assert attempts == [b"gpu-output", b"gpu-output"]
    assert not agent._pending_completion_path("task-1").exists()


def test_failed_completion_report_is_persisted_and_blocks_new_claims(
    tmp_path,
    monkeypatch,
):
    agent = _agent(tmp_path, monkeypatch)
    agent.completion_retry_delays = (0,)
    monkeypatch.setattr(
        requests,
        "post",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            requests.Timeout("write timed out")
        ),
    )

    assert agent.complete("task-2", "failed", 3, error="boom") is False
    pending = agent._pending_completion_path("task-2")
    assert pending.exists()
    assert json.loads(pending.read_text(encoding="utf-8"))["error"] == "boom"
    assert agent._flush_pending_completions() is False


def test_pending_completion_is_flushed_after_restart(tmp_path, monkeypatch):
    agent = _agent(tmp_path, monkeypatch)
    record = {
        "task_id": "task-3",
        "status": "completed",
        "duration": 1,
        "output_files": [],
        "error": "",
        "result_payload": {"ok": True},
    }
    agent._save_pending_completion(record)
    monkeypatch.setattr(requests, "post", lambda *_args, **_kwargs: _Response())

    assert agent._flush_pending_completions() is True
    assert not agent._pending_completion_path("task-3").exists()
