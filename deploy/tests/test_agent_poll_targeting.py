from agent_routes import _preferred_agent_id_from_task_info


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
