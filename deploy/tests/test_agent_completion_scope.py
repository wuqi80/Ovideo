import pytest
from fastapi import HTTPException

from agent_routes import _assert_agent_completion_scope


def test_agent_completion_scope_accepts_claimed_agent_from_redis():
    assert _assert_agent_completion_scope(
        {"agent_id": "agent_a"},
        "agent_a",
        "task_1",
        {"node_id": "agent_a"},
        None,
    ) == "agent_a"


def test_agent_completion_scope_uses_database_when_redis_expired():
    assert _assert_agent_completion_scope(
        {"agent_id": "agent_a"},
        "agent_a",
        "task_1",
        {},
        {"node_id": "agent_a"},
    ) == "agent_a"


@pytest.mark.parametrize(
    ("submitted_agent_id", "task_hash", "db_task", "status_code"),
    [
        ("agent_b", {"node_id": "agent_a"}, None, 403),
        ("agent_a", {"node_id": "agent_b"}, None, 403),
        ("agent_a", {}, None, 404),
        ("agent_a", {"status": "pending"}, None, 409),
    ],
)
def test_agent_completion_scope_rejects_unowned_or_unassigned_tasks(
    submitted_agent_id,
    task_hash,
    db_task,
    status_code,
):
    with pytest.raises(HTTPException) as exc:
        _assert_agent_completion_scope(
            {"agent_id": "agent_a"},
            submitted_agent_id,
            "task_1",
            task_hash,
            db_task,
        )
    assert exc.value.status_code == status_code
