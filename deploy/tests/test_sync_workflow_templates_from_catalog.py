import json
import sys
from pathlib import Path

import pytest


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from scripts.sync_workflow_templates_from_catalog import load_catalog_items


def _write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def test_load_catalog_items_uses_config_metadata_and_disk_extra_placeholders(tmp_path):
    configured_workflow = {
        "1": {"class_type": "LoadImage", "inputs": {"image": "{image}"}},
    }
    extra_workflow = {
        "1": {"class_type": "KSampler", "inputs": {"seed": "{seed}"}},
    }
    _write_json(tmp_path / "configured.json", configured_workflow)
    _write_json(tmp_path / "extra.json", extra_workflow)

    config = type(
        "Cfg",
        (),
        {
            "name": "Configured",
            "file": "configured.json",
            "description": "configured description",
            "placeholders": ["image"],
            "default_params": {},
        },
    )()

    items = load_catalog_items(tmp_path, {"configured_key": config})

    assert [item.workflow_key for item in items] == ["configured_key", "extra"]
    assert items[0].name == "Configured"
    assert items[0].category == "configured_key"
    assert items[0].placeholders == [
        {"key": "image", "label": "image", "type": "text", "required": False, "default": ""}
    ]
    assert items[1].description == "Catalog workflow file extra.json"
    assert items[1].placeholders == [
        {"key": "seed", "label": "seed", "type": "text", "required": False, "default": ""}
    ]


def test_load_catalog_items_rejects_invalid_json(tmp_path):
    _write_json(tmp_path / "bad.json", {})

    with pytest.raises(ValueError, match="workflow JSON is empty"):
        load_catalog_items(tmp_path, {})
