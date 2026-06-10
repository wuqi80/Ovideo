# -*- coding: utf-8 -*-
"""
ComfyUI Agent DAO 测试
"""
import pytest


async def test_generate_token_format(test_db):
    from dao_agent import AgentDAO
    t1 = AgentDAO.generate_token()
    t2 = AgentDAO.generate_token()
    assert t1.startswith("sk-agent-")
    assert len(t1) > len("sk-agent-")
    assert t1 != t2


async def test_create_agent_returns_complete_record(test_db):
    from dao_agent import AgentDAO
    token = AgentDAO.generate_token()
    result = await AgentDAO.create(name="测试节点", token=token)
    assert result is not None
    assert result["agent_id"].startswith("agent_")
    assert result["name"] == "测试节点"
    assert result["token"] == token
    assert result["status"] == "offline"
    assert result["enabled"] is True


async def test_get_by_token_found(test_db):
    from dao_agent import AgentDAO
    token = AgentDAO.generate_token()
    created = await AgentDAO.create(name="t1", token=token)
    found = await AgentDAO.get_by_token(token)
    assert found is not None
    assert found["agent_id"] == created["agent_id"]


async def test_get_by_token_not_found(test_db):
    from dao_agent import AgentDAO
    found = await AgentDAO.get_by_token("sk-agent-nonexistent-token-000000000000000000000000")
    assert found is None


async def test_update_heartbeat(test_db):
    from dao_agent import AgentDAO
    token = AgentDAO.generate_token()
    created = await AgentDAO.create(name="hb", token=token)
    inst = [{"id": "i1", "port": 8188}]
    sysinfo = {"os": "linux", "mem_gb": 16}
    updated = await AgentDAO.update_heartbeat(
        created["agent_id"],
        status="online",
        comfyui_instances=inst,
        system_info=sysinfo,
    )
    assert updated["status"] == "online"
    assert updated["last_heartbeat"] is not None
    assert updated["comfyui_instances"] == inst
    assert updated["system_info"] == sysinfo

    # Optional JSONB omitted -> COALESCE keeps previous values
    again = await AgentDAO.update_heartbeat(created["agent_id"], status="online")
    assert again["comfyui_instances"] == inst
    assert again["system_info"] == sysinfo


async def test_list_all_order(test_db):
    from dao_agent import AgentDAO
    await AgentDAO.create(name="older", token=AgentDAO.generate_token())
    await AgentDAO.create(name="newer", token=AgentDAO.generate_token())
    rows = await AgentDAO.list_all()
    names = [r["name"] for r in rows if r["name"] in ("older", "newer")]
    # created_at DESC: newer before older
    assert names[0] == "newer"
    assert names[1] == "older"


async def test_get_online_agents(test_db):
    from dao_agent import AgentDAO
    a = await AgentDAO.create(name="on", token=AgentDAO.generate_token())
    b = await AgentDAO.create(name="off", token=AgentDAO.generate_token())
    await AgentDAO.update_heartbeat(a["agent_id"], status="online")
    await AgentDAO.set_enabled(b["agent_id"], False)
    await AgentDAO.update_heartbeat(b["agent_id"], status="online")

    online = await AgentDAO.get_online_agents()
    ids = {r["agent_id"] for r in online}
    assert a["agent_id"] in ids
    assert b["agent_id"] not in ids


async def test_delete_agent(test_db):
    from dao_agent import AgentDAO
    created = await AgentDAO.create(name="del", token=AgentDAO.generate_token())
    ok = await AgentDAO.delete(created["agent_id"])
    assert ok is True
    assert await AgentDAO.get_by_id(created["agent_id"]) is None
    ok2 = await AgentDAO.delete("agent_nonexistent000")
    assert ok2 is False
