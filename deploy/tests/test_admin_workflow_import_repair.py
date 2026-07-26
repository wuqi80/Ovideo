# -*- coding: utf-8 -*-
from unittest.mock import AsyncMock
from types import ModuleType
import json
import sys
from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

import pytest


@pytest.mark.asyncio
async def test_import_workflows_repairs_existing_i2i_angel_without_placeholders(monkeypatch):
    import admin_routes
    from pipeline import workflow_config

    cfg = workflow_config.WORKFLOW_CONFIGS["i2i_angel"]
    fake_workflow_config = ModuleType("workflow_config")
    fake_workflow_config.WORKFLOW_CONFIGS = {"i2i_angel": cfg}
    monkeypatch.setitem(sys.modules, "workflow_config", fake_workflow_config)
    monkeypatch.setattr(admin_routes, "get_db_manager", lambda: object())
    monkeypatch.setattr(
        admin_routes,
        "_get_workflow_template_by_key",
        AsyncMock(
            return_value={
                "template_id": "wft_old",
                "workflow_key": "i2i_angel",
                "workflow_json": {
                    "78": {"class_type": "LoadImage", "inputs": {"image": "old.png"}},
                    "111": {"class_type": "TextEncode", "inputs": {"prompt": "old prompt"}},
                    "3": {"class_type": "KSampler", "inputs": {"seed": 1}},
                },
                "placeholders": [],
                "enabled": True,
            }
        ),
    )

    class FakeWorkflowTemplateDAO:
        get_by_name = AsyncMock(return_value=None)
        create = AsyncMock()
        update = AsyncMock(return_value={"template_id": "wft_old"})
        list_all = AsyncMock(return_value=[])

    monkeypatch.setattr(admin_routes, "WorkflowTemplateDAO", FakeWorkflowTemplateDAO)

    result = await admin_routes.admin_import_workflows()

    assert result["success"] is True
    assert result["skipped"] >= 1
    assert result["repaired"] >= 1
    FakeWorkflowTemplateDAO.create.assert_not_awaited()
    assert FakeWorkflowTemplateDAO.update.await_args_list
    update_kwargs = [
        call.kwargs
        for call in FakeWorkflowTemplateDAO.update.await_args_list
        if call.kwargs.get("workflow_json", {}).get("78", {}).get("inputs", {}).get("image") == "{image}"
        and call.kwargs.get("workflow_json", {}).get("111", {}).get("inputs", {}).get("prompt") == "{prompt}"
    ]
    assert update_kwargs
    kwargs = update_kwargs[0]
    assert kwargs["placeholders"] == [
        {"key": "image", "label": "image", "type": "text", "required": False, "default": ""},
        {"key": "prompt", "label": "prompt", "type": "text", "required": False, "default": ""},
        {"key": "seed", "label": "seed", "type": "text", "required": False, "default": -1},
    ]
    assert kwargs["workflow_json"]["78"]["inputs"]["image"] == "{image}"
    assert kwargs["workflow_json"]["111"]["inputs"]["prompt"] == "{prompt}"
    assert kwargs["workflow_json"]["3"]["inputs"]["seed"] == "{seed}"


@pytest.mark.asyncio
async def test_import_workflows_skips_invalid_disk_and_deletes_invalid_db(monkeypatch, tmp_path):
    import admin_routes

    (tmp_path / "bad.json").write_text(
        '{"1":{"class_type":"PlaceholderNode","_meta":{"title":"bad"}}}',
        encoding="utf-8",
    )
    (tmp_path / "extra.json").write_text("{}", encoding="utf-8")

    fake_cfg = type(
        "FakeCfg",
        (),
        {
            "name": "bad",
            "file": "bad.json",
            "description": "",
            "placeholders": [],
            "default_params": {},
        },
    )()
    fake_workflow_config = ModuleType("workflow_config")
    fake_workflow_config.WORKFLOW_CONFIGS = {"bad": fake_cfg}
    monkeypatch.setitem(sys.modules, "workflow_config", fake_workflow_config)
    monkeypatch.setattr(admin_routes, "_workflow_dir", lambda: tmp_path)
    monkeypatch.setattr(admin_routes, "get_db_manager", lambda: object())
    monkeypatch.setattr(
        admin_routes,
        "_get_workflow_template_by_key",
        AsyncMock(return_value=None),
    )

    class FakeWorkflowTemplateDAO:
        get_by_name = AsyncMock(return_value=None)
        create = AsyncMock()
        update = AsyncMock()
        delete = AsyncMock(return_value=True)
        list_all = AsyncMock(
            return_value=[
                {
                    "template_id": "wft_bad",
                    "workflow_key": "bad",
                    "category": "bad",
                    "name": "bad",
                    "workflow_json": {},
                    "enabled": True,
                }
            ]
        )

    monkeypatch.setattr(admin_routes, "WorkflowTemplateDAO", FakeWorkflowTemplateDAO)

    result = await admin_routes.admin_import_workflows()

    assert result["success"] is True
    assert result["imported"] == 0
    assert result["removed_invalid"] == 1
    FakeWorkflowTemplateDAO.create.assert_not_awaited()
    FakeWorkflowTemplateDAO.update.assert_not_awaited()
    FakeWorkflowTemplateDAO.delete.assert_awaited_once_with("wft_bad")


@pytest.mark.asyncio
async def test_import_workflows_repairs_invalid_db_from_valid_disk(monkeypatch, tmp_path):
    import admin_routes

    valid_workflow = {
        "1": {"class_type": "LoadImage", "inputs": {"image": "{image}"}},
        "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
    }
    (tmp_path / "good.json").write_text(
        json.dumps(valid_workflow),
        encoding="utf-8",
    )

    fake_cfg = type(
        "FakeCfg",
        (),
        {
            "name": "good",
            "file": "good.json",
            "description": "",
            "placeholders": ["image"],
            "default_params": {},
        },
    )()
    fake_workflow_config = ModuleType("workflow_config")
    fake_workflow_config.WORKFLOW_CONFIGS = {"good": fake_cfg}
    monkeypatch.setitem(sys.modules, "workflow_config", fake_workflow_config)
    monkeypatch.setattr(admin_routes, "_workflow_dir", lambda: tmp_path)
    monkeypatch.setattr(admin_routes, "get_db_manager", lambda: object())

    stale_row = {
        "template_id": "wft_good",
        "workflow_key": "good",
        "category": "good",
        "name": "good",
        "workflow_json": {},
        "placeholders": [],
        "enabled": True,
    }
    monkeypatch.setattr(
        admin_routes,
        "_get_workflow_template_by_key",
        AsyncMock(return_value=stale_row),
    )

    class FakeWorkflowTemplateDAO:
        get_by_name = AsyncMock(return_value=None)
        create = AsyncMock()
        update = AsyncMock(return_value={"template_id": "wft_good"})
        delete = AsyncMock()
        list_all = AsyncMock(return_value=[stale_row])

    monkeypatch.setattr(admin_routes, "WorkflowTemplateDAO", FakeWorkflowTemplateDAO)

    result = await admin_routes.admin_import_workflows()

    assert result["success"] is True
    assert result["removed_invalid"] == 0
    FakeWorkflowTemplateDAO.create.assert_not_awaited()
    FakeWorkflowTemplateDAO.delete.assert_not_awaited()
    assert any(
        call.kwargs.get("workflow_json") == valid_workflow
        for call in FakeWorkflowTemplateDAO.update.await_args_list
    )


@pytest.mark.asyncio
async def test_create_workflow_rejects_invalid_template(monkeypatch):
    import admin_routes

    monkeypatch.setattr(admin_routes, "get_db_manager", lambda: object())

    class FakeWorkflowTemplateDAO:
        create = AsyncMock()

    monkeypatch.setattr(admin_routes, "WorkflowTemplateDAO", FakeWorkflowTemplateDAO)

    with pytest.raises(admin_routes.HTTPException) as exc:
        await admin_routes.admin_create_workflow(
            admin_routes.WorkflowCreateBody(
                name="empty",
                category="empty",
                workflow_json={},
            )
        )

    assert exc.value.status_code == 422
    FakeWorkflowTemplateDAO.create.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_workflow_rejects_invalid_template(monkeypatch):
    import admin_routes

    monkeypatch.setattr(admin_routes, "get_db_manager", lambda: object())

    class FakeWorkflowTemplateDAO:
        update = AsyncMock()

    monkeypatch.setattr(admin_routes, "WorkflowTemplateDAO", FakeWorkflowTemplateDAO)

    with pytest.raises(admin_routes.HTTPException) as exc:
        await admin_routes.admin_update_workflow(
            "wft_bad",
            admin_routes.WorkflowUpdateBody(
                workflow_json={"1": {"class_type": "PlaceholderNode", "inputs": {}}},
            ),
        )

    assert exc.value.status_code == 422
    FakeWorkflowTemplateDAO.update.assert_not_awaited()
