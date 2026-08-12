from __future__ import annotations

import sys
from types import SimpleNamespace

from services import cluster_node_service


async def test_list_agent_nodes_filters_and_normalizes(monkeypatch):
    class FakeAgentDAO:
        @staticmethod
        async def list_all_with_active_task_counts():
            return [
                {
                    "agent_id": "agent_online",
                    "name": "GPU1",
                    "display_name": "主渲染机",
                    "status": "online",
                    "enabled": True,
                    "comfyui_instances": [{"host": "10.0.0.2", "port": 8188, "status": "healthy"}],
                    "system_info": {"current_tasks": 1},
                },
                {"agent_id": "agent_busy", "status": "busy", "enabled": True},
                {"agent_id": "agent_off", "status": "offline", "enabled": True},
                {"agent_id": "agent_disabled", "status": "online", "enabled": False},
            ]

    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=FakeAgentDAO))

    nodes = await cluster_node_service.list_agent_nodes()

    assert [node["agent_id"] for node in nodes] == ["agent_online", "agent_busy"]
    assert nodes[0]["name"] == "主渲染机"
    assert nodes[0]["routing_name"] == "GPU1"
    assert nodes[0]["url"] == "http://10.0.0.2:8188"
    assert nodes[0]["tasks"] == 1
    assert nodes[0]["max_concurrent"] == 1
    assert nodes[1]["status"] == "busy"
    assert nodes[1]["tasks"] == 1
    assert nodes[1]["max_concurrent"] == 1


async def test_list_agent_instances_preserves_per_port_capabilities(monkeypatch):
    class FakeAgentDAO:
        @staticmethod
        async def list_all_with_active_task_counts():
            return [
                {
                    "agent_id": "agent_gpu2",
                    "name": "GPU2",
                    "status": "online",
                    "enabled": True,
                    "comfyui_instances": [
                        {"host": "192.168.31.134", "port": 8188, "status": "healthy"},
                        {
                            "host": "192.168.31.134",
                            "port": 8288,
                            "status": "healthy",
                            "capabilities": {"minimax_h3_fl2va": True},
                        },
                    ],
                    "system_info": {"hostname": "GPU2"},
                },
            ]

    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=FakeAgentDAO))

    instances = await cluster_node_service.list_agent_instances()

    assert [instance["port"] for instance in instances] == [8188, 8288]
    h3 = next(instance for instance in instances if instance["port"] == 8288)
    assert h3["agent_id"] == "agent_gpu2"
    assert h3["routing_name"] == "GPU2"
    assert h3["url"] == "http://GPU2:8288"
    assert h3["healthy"] is True
    assert h3["capabilities"] == {"minimax_h3_fl2va": True}


async def test_list_agent_instances_treats_busy_agent_with_stale_row_status_as_healthy(monkeypatch):
    class FakeAgentDAO:
        @staticmethod
        async def list_all_with_active_task_counts():
            return [
                {
                    "agent_id": "agent_gpu2",
                    "name": "GPU2",
                    "status": "offline",
                    "enabled": True,
                    "active_tasks": 1,
                    "comfyui_instances": [
                        {"host": "192.168.31.134", "port": 8188, "status": "healthy"},
                        {
                            "host": "192.168.31.134",
                            "port": 8288,
                            "status": "healthy",
                            "capabilities": {"minimax_h3_fl2va": True},
                        },
                    ],
                    "system_info": {"hostname": "GPU2"},
                },
            ]

    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=FakeAgentDAO))

    instances = await cluster_node_service.list_agent_instances()

    assert [instance["port"] for instance in instances] == [8188, 8288]
    h3 = next(instance for instance in instances if instance["port"] == 8288)
    assert h3["status"] == "busy"
    assert h3["healthy"] is True
    assert h3["capabilities"] == {"minimax_h3_fl2va": True}


async def test_list_agent_nodes_hides_agent_when_comfyui_is_unhealthy(monkeypatch):
    class FakeAgentDAO:
        @staticmethod
        async def list_all_with_active_task_counts():
            return [
                {
                    "agent_id": "agent_gpu2",
                    "name": "GPU2",
                    "status": "online",
                    "enabled": True,
                    "comfyui_instances": [{"port": 8188, "status": "unhealthy"}],
                }
            ]

    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=FakeAgentDAO))

    assert await cluster_node_service.list_agent_nodes() == []
    nodes = await cluster_node_service.list_agent_nodes(include_offline=True)
    assert nodes[0]["status"] == "unavailable"


async def test_list_agent_nodes_degrades_safely(monkeypatch):
    class BrokenAgentDAO:
        @staticmethod
        async def list_all_with_active_task_counts():
            raise RuntimeError("db unavailable")

    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=BrokenAgentDAO))

    assert await cluster_node_service.list_agent_nodes() == []


async def test_list_agent_nodes_can_include_offline(monkeypatch):
    class FakeAgentDAO:
        @staticmethod
        async def list_all_with_active_task_counts():
            return [
                {"agent_id": "agent_gpu1", "name": "GPU1", "status": "offline", "enabled": True},
                {
                    "agent_id": "agent_gpu2",
                    "name": "GPU2",
                    "status": "online",
                    "enabled": True,
                    "active_tasks": 1,
                },
            ]

    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=FakeAgentDAO))

    nodes = await cluster_node_service.list_agent_nodes(include_offline=True)

    assert [node["name"] for node in nodes] == ["处理节点1", "处理节点2"]
    assert [node["routing_name"] for node in nodes] == ["GPU1", "GPU2"]
    assert nodes[0]["status"] == "offline"
    assert nodes[1]["status"] == "busy"
    assert nodes[1]["tasks"] == 1
