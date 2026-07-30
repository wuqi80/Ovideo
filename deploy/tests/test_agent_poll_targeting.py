import json

import pytest

from agent_routes import (
    _claim_next_agent_task,
    _legacy_file_id_from_download_url,
    _preferred_agent_id_from_task_info,
    _scope_agent_file_download_urls,
    _task_references_legacy_file,
)


class _RedisConfig:
    TASK_QUEUE_KEY = "queue"
    TASK_STATUS_PREFIX = "task:"


class _FakeRedis:
    def __init__(self, members, hashes=None):
        self.members = list(members)
        self.hashes = hashes or {}

    async def zrange(self, _key, start, end, withscores=False):
        selected = self.members[start:] if end == -1 else self.members[start:end + 1]
        return selected if withscores else [member for member, _score in selected]

    async def zrem(self, _key, raw_member):
        before = len(self.members)
        self.members = [item for item in self.members if item[0] != raw_member]
        return before - len(self.members)

    async def hgetall(self, key):
        return self.hashes.get(key, {})


def test_preferred_agent_id_from_task_info_uses_agent_field():
    task_info = {
        "task_id": "task_1",
        "data": {
            "preferred_agent_id": "agent_a",
            "preferred_node_id": "local_node_1",
        },
    }

    assert _preferred_agent_id_from_task_info(task_info) == "agent_a"


def test_preferred_agent_id_from_task_info_ignores_plain_node_id():
    task_info = {
        "task_id": "task_2",
        "data": {
            "preferred_node_id": "local_node_1",
        },
    }

    assert _preferred_agent_id_from_task_info(task_info) == ""


def test_agent_file_download_urls_are_scoped_to_claimed_task():
    files = [
        {
            "param": "image_path",
            "filename": "input.png",
            "url": "https://spti.ai/api/files/file_input123/download",
        },
        {
            "param": "mask",
            "filename": "mask.png",
            "url": "https://assets.example.test/mask.png",
        },
    ]

    scoped = _scope_agent_file_download_urls("task_1", files)

    assert scoped[0]["url"] == "/api/agent/tasks/task_1/files/file_input123"
    assert scoped[1]["url"] == "https://assets.example.test/mask.png"
    assert files[0]["url"] == "https://spti.ai/api/files/file_input123/download"


def test_agent_file_scope_only_accepts_task_declared_legacy_files():
    task_data = {
        "agent_files": [
            {
                "filename": "input.webp",
                "url": "/api/files/file_allowed/download",
            }
        ]
    }

    assert _legacy_file_id_from_download_url("/api/files/file_allowed/download") == "file_allowed"
    assert _task_references_legacy_file(task_data, "file_allowed") is True
    assert _task_references_legacy_file(task_data, "file_other") is False
    assert _legacy_file_id_from_download_url("https://example.test/file_allowed") == ""


@pytest.mark.asyncio
async def test_agent_claim_skips_external_api_task_and_claims_gpu_task():
    external_id = "task_external"
    gpu_member = json.dumps({
        "task_id": "task_gpu",
        "task_type": "qwen_i2i",
        "data": {},
    })
    redis = _FakeRedis(
        [(external_id, 1.0), (gpu_member, 2.0)],
        hashes={
            "task:task_external": {
                "task_type": "video_reverse_prompt",
                "data": "{}",
            },
        },
    )

    claimed = await _claim_next_agent_task(redis, _RedisConfig, "agent_a")

    assert claimed is not None
    assert claimed[0]["task_id"] == "task_gpu"
    assert redis.members == [(external_id, 1.0)]


@pytest.mark.asyncio
async def test_agent_claim_leaves_external_only_queue_untouched():
    redis = _FakeRedis(
        [("task_external", 1.0)],
        hashes={
            "task:task_external": {
                "task_type": "seedance_i2v",
                "data": "{}",
            },
        },
    )

    claimed = await _claim_next_agent_task(redis, _RedisConfig, "agent_a")

    assert claimed is None
    assert redis.members == [("task_external", 1.0)]


@pytest.mark.asyncio
async def test_agent_claim_respects_preferred_agent_without_requeueing():
    pinned_member = json.dumps({
        "task_id": "task_pinned",
        "task_type": "qwen_i2i",
        "data": {"preferred_agent_id": "agent_b"},
    })
    redis = _FakeRedis([(pinned_member, 1.0)])

    claimed = await _claim_next_agent_task(redis, _RedisConfig, "agent_a")

    assert claimed is None
    assert redis.members == [(pinned_member, 1.0)]
