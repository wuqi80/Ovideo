# -*- coding: utf-8 -*-
"""
Workflow template DAO 测试
"""


async def test_create_workflow_template(test_db):
    from dao_workflow_template import WorkflowTemplateDAO

    wf = {"1": {"class_type": "CLIPTextEncode", "inputs": {"text": "hello"}}}
    row = await WorkflowTemplateDAO.create(
        name="tpl_create",
        category="image",
        workflow_json=wf,
    )
    assert row is not None
    assert row["template_id"].startswith("wft_")
    assert row["name"] == "tpl_create"
    assert row["category"] == "image"
    assert row["workflow_json"] == wf
    assert row["enabled"] is True
    assert row["version"] == 1
    assert row["node_type"] == "any"
    assert row["estimated_time"] == 30


async def test_get_by_name(test_db):
    from dao_workflow_template import WorkflowTemplateDAO

    wf = {"1": {"class_type": "Empty", "inputs": {}}}
    await WorkflowTemplateDAO.create(
        name="unique_tpl_name", category="other", workflow_json=wf
    )
    found = await WorkflowTemplateDAO.get_by_name("unique_tpl_name")
    assert found is not None
    assert found["name"] == "unique_tpl_name"


async def test_list_enabled_filters_disabled(test_db):
    from dao_workflow_template import WorkflowTemplateDAO

    wf = {"1": {"class_type": "X", "inputs": {}}}
    a = await WorkflowTemplateDAO.create(
        name="tpl_on", category="a", workflow_json=wf
    )
    b = await WorkflowTemplateDAO.create(
        name="tpl_off", category="a", workflow_json=wf
    )
    await WorkflowTemplateDAO.update(b["template_id"], enabled=False)

    enabled_rows = await WorkflowTemplateDAO.list_enabled()
    ids = {r["template_id"] for r in enabled_rows}
    assert a["template_id"] in ids
    assert b["template_id"] not in ids


async def test_update_increments_version_when_workflow_json_changes(test_db):
    from dao_workflow_template import WorkflowTemplateDAO

    wf1 = {"1": {"class_type": "A", "inputs": {"x": 1}}}
    wf2 = {"2": {"class_type": "B", "inputs": {"y": 2}}}
    row = await WorkflowTemplateDAO.create(
        name="tpl_ver", category="image", workflow_json=wf1
    )
    assert row["version"] == 1

    updated = await WorkflowTemplateDAO.update(
        row["template_id"], description="note"
    )
    assert updated["version"] == 1

    updated2 = await WorkflowTemplateDAO.update(
        row["template_id"], workflow_json=wf2
    )
    assert updated2["version"] == 2
    assert updated2["workflow_json"] == wf2


async def test_delete_workflow_template(test_db):
    from dao_workflow_template import WorkflowTemplateDAO

    wf = {"1": {"class_type": "Z", "inputs": {}}}
    row = await WorkflowTemplateDAO.create(
        name="tpl_del", category="other", workflow_json=wf
    )
    ok = await WorkflowTemplateDAO.delete(row["template_id"])
    assert ok is True
    assert await WorkflowTemplateDAO.get_by_id(row["template_id"]) is None
    ok2 = await WorkflowTemplateDAO.delete("wft_nonexistent00")
    assert ok2 is False


def test_parse_nodes_static():
    from dao_workflow_template import WorkflowTemplateDAO

    workflow = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 42,
                "prompt": "{positive_prompt}",
                "latent_image": [4, 0],
            },
        },
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512}},
    }
    rows = WorkflowTemplateDAO.parse_nodes(workflow)
    by_field = {(r["node_id"], r["field"]): r for r in rows}

    r_seed = by_field[("3", "inputs.seed")]
    assert r_seed["class_type"] == "KSampler"
    assert r_seed["current_value"] == 42
    assert r_seed["is_placeholder"] is False

    r_prompt = by_field[("3", "inputs.prompt")]
    assert r_prompt["current_value"] == "{positive_prompt}"
    assert r_prompt["is_placeholder"] is True

    assert ("3", "inputs.latent_image") not in by_field

    r_w = by_field[("4", "inputs.width")]
    assert r_w["current_value"] == 512
    assert r_w["is_placeholder"] is False
