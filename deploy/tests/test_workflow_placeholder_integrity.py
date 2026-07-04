# -*- coding: utf-8 -*-
import json
from pathlib import Path
from typing import Any

import pytest

from pipeline.workflow_config import WORKFLOW_CONFIGS
from pipeline.workflow_handler import WorkflowHandler


KNOWN_INCOMPLETE_WORKFLOWS = {
    "smooth_i2v",
    "smooth_morph",
    "dawasi_i2v",
    "dawasi_morph",
    "hunyuan_i2v",
    "ltx_i2v",
    "turbo22_i2v",
    "turbo21_i2v",
    "svdwan_i2v",
    "qwenN_1",
    "qwenN_2",
    "qwenN_3",
    "qwenN_4",
    "qwenN_5",
    "qwenN_6",
    "three_view",
}


def _workflow_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        strings: list[str] = []
        for child in value.values():
            strings.extend(_workflow_strings(child))
        return strings
    if isinstance(value, list):
        strings: list[str] = []
        for child in value:
            strings.extend(_workflow_strings(child))
        return strings
    return []


def _placeholder_names(workflow_json: dict[str, Any]) -> set[str]:
    return {
        value[1:-1]
        for value in _workflow_strings(workflow_json)
        if value.startswith("{") and value.endswith("}")
    }


def test_configured_workflow_placeholders_exist_in_disk_json():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    missing_by_key: dict[str, list[str]] = {}

    for key, cfg in WORKFLOW_CONFIGS.items():
        if key in KNOWN_INCOMPLETE_WORKFLOWS or not cfg.file:
            continue

        path = workflow_dir / cfg.file
        workflow_json = json.loads(path.read_text(encoding="utf-8"))
        configured = set(cfg.placeholders or [])
        present = _placeholder_names(workflow_json)
        missing = sorted(configured - present)
        if missing:
            missing_by_key[key] = missing

    assert missing_by_key == {}


@pytest.mark.parametrize(
    ("task_type", "task_data", "expected"),
    [
        (
            "i2v",
            {
                "model": "Wan2",
                "uploaded_image": "start.png",
                "prompt": "a moving shot",
                "negative_prompt": "bad frame",
                "seed": 123,
            },
            {"image": "start.png", "prompt": "a moving shot", "negative_prompt": "bad frame"},
        ),
        (
            "morph",
            {
                "model": "Wan2",
                "uploaded_image": "start.png",
                "uploaded_image_end": "end.png",
                "prompt": "transition",
                "negative_prompt": "bad transition",
                "seed": 456,
            },
            {
                "start_image": "start.png",
                "end_image": "end.png",
                "prompt": "transition",
                "negative_prompt": "bad transition",
            },
        ),
    ],
)
def test_wan2_workflows_replace_runtime_placeholders(task_type, task_data, expected):
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    handler = WorkflowHandler(str(workflow_dir))

    workflow = handler.build_workflow_for_task(task_type, task_data)
    rendered_strings = set(_workflow_strings(workflow))

    for value in expected.values():
        assert value in rendered_strings

    unresolved = {value for value in rendered_strings if value.startswith("{") and value.endswith("}")}
    assert unresolved == set()
