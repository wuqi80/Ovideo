from datetime import datetime

import pytest
from fastapi import HTTPException

from pipeline import comfyui_main


@pytest.fixture(autouse=True)
def reset_legacy_state():
    comfyui_main.task_storage.clear()
    comfyui_main.upload_owners.clear()
    yield
    comfyui_main.task_storage.clear()
    comfyui_main.upload_owners.clear()


def test_legacy_task_lookup_hides_foreign_tasks():
    comfyui_main.task_storage["task-1"] = {
        "task_id": "task-1",
        "user": "yuan",
        "created_at": datetime.now(),
    }

    assert comfyui_main._require_task_owner("task-1", "yuan")["task_id"] == "task-1"
    with pytest.raises(HTTPException) as exc:
        comfyui_main._require_task_owner("task-1", "other")
    assert exc.value.status_code == 404


def test_legacy_artifacts_are_scoped_to_creator():
    comfyui_main.upload_owners["input.png"] = "yuan"
    comfyui_main.task_storage["task-1"] = {
        "user": "yuan",
        "result": {"output_files": [{"filename": "output.png"}]},
    }

    assert comfyui_main._owns_artifact("input.png", "yuan")
    assert comfyui_main._owns_artifact("output.png", "yuan")
    assert not comfyui_main._owns_artifact("output.png", "other")


def test_legacy_service_rejects_unregistered_node_and_path_traversal(tmp_path):
    with pytest.raises(HTTPException) as server_exc:
        comfyui_main._require_configured_comfyui_server("http://127.0.0.1:9999")
    assert server_exc.value.status_code == 400

    with pytest.raises(HTTPException) as path_exc:
        comfyui_main._safe_child(str(tmp_path), "../secret.txt")
    assert path_exc.value.status_code == 404
