# -*- coding: utf-8 -*-
from unittest.mock import AsyncMock
from types import ModuleType
import sys

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
