# -*- coding: utf-8 -*-
import json
from pathlib import Path
from typing import Any

from pipeline.workflow_config import WORKFLOW_CONFIGS
from pipeline.workflow_handler import WorkflowHandler


def _all_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        strings: list[str] = []
        for child in value.values():
            strings.extend(_all_strings(child))
        return strings
    if isinstance(value, list):
        strings: list[str] = []
        for child in value:
            strings.extend(_all_strings(child))
        return strings
    return []


def test_i2i_angel_config_exposes_runtime_placeholders():
    cfg = WORKFLOW_CONFIGS["i2i_angel"]

    assert cfg.file == "I2I_angel.json"
    assert cfg.placeholders == ["image", "prompt", "seed"]
    assert cfg.param_mapping == {
        "image_data": "image",
        "prompt": "prompt",
        "seed": "seed",
    }
    assert cfg.default_params["seed"] == -1


def test_i2i_angel_workflow_builds_executable_prompt():
    workflow_path = Path(__file__).resolve().parents[1] / "workflows" / "I2I_angel.json"
    raw = json.loads(workflow_path.read_text(encoding="utf-8"))
    assert raw["78"]["inputs"]["image"] == "{image}"
    assert raw["111"]["inputs"]["prompt"] == "{prompt}"
    assert raw["3"]["inputs"]["seed"] == "{seed}"

    handler = WorkflowHandler(str(workflow_path.parent))
    workflow = handler.build_workflow_for_task(
        "i2i_angel",
        {
            "uploaded_image": "sample.png",
            "prompt": "front view",
            "seed": 123,
        },
    )

    assert workflow["78"]["inputs"]["image"] == "sample.png"
    assert workflow["111"]["inputs"]["prompt"] == "front view"
    assert workflow["3"]["inputs"]["seed"] == 123
    assert all(isinstance(node, dict) and node.get("class_type") for node in workflow.values())
    assert not {"{image}", "{prompt}", "{seed}"} & set(_all_strings(workflow))
