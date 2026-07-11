from __future__ import annotations

import sys
from types import SimpleNamespace

from services import cluster_node_service


async def test_list_agent_nodes_filters_and_normalizes(monkeypatch):
    class FakeAgentDAO:
        @staticmethod
        async def list_all():
            return [
                {
                    "agent_id": "agent_online",
                    "name": "GPU1",
                    "status": "online",
                    "enabled": True,
                    "comfyui_instances": [{"host": "10.0.0.2", "port": 8188}],
                    "system_info": {"current_tasks": 1},
                },
                {"agent_id": "agent_busy", "status": "busy", "enabled": True},
                {"agent_id": "agent_off", "status": "offline", "enabled": True},
                {"agent_id": "agent_disabled", "status": "online", "enabled": False},
            ]

    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=FakeAgentDAO))

    nodes = await cluster_node_service.list_agent_nodes()

    assert [node["agent_id"] for node in nodes] == ["agent_online", "agent_busy"]
    assert nodes[0]["name"] == "GPU1"
    assert nodes[0]["url"] == "http://10.0.0.2:8188"
    assert nodes[0]["tasks"] == 1


async def test_list_agent_nodes_degrades_safely(monkeypatch):
    class BrokenAgentDAO:
        @staticmethod
        async def list_all():
            raise RuntimeError("db unavailable")

    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=BrokenAgentDAO))

    assert await cluster_node_service.list_agent_nodes() == []
