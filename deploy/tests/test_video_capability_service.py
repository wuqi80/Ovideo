from __future__ import annotations

import sys
from types import SimpleNamespace

from services import video_capability_service


async def test_video_capabilities_report_seedance_omni_and_comfyui(monkeypatch):
    class FakeAgentDAO:
        @staticmethod
        async def get_online_agents():
            return [{"agent_id": "agent_1"}]

    monkeypatch.setattr(
        video_capability_service,
        "resolve_seedance_model_name",
        lambda sub_model: "doubao-seedance-2-0-260128",
    )
    monkeypatch.setitem(sys.modules, "dao_agent", SimpleNamespace(AgentDAO=FakeAgentDAO))

    assert await video_capability_service.get_video_capabilities() == {
        "seedance_omni": True,
        "comfyui_available": True,
    }


async def test_video_capabilities_degrade_safely(monkeypatch):
    class BrokenAgentDAO:
        @staticmethod
        async def get_online_agents():
            raise RuntimeError("agent unavailable")

    def broken_seedance_model(_sub_model: str) -> str:
        raise RuntimeError("runtime unavailable")

    monkeypatch.setattr(video_capability_service, "resolve_seedance_model_name", broken_seedance_model)
    monkeypatch.setitem(
        sys.modules,
        "dao_agent",
        SimpleNamespace(AgentDAO=BrokenAgentDAO),
    )

    assert await video_capability_service.get_video_capabilities() == {
        "seedance_omni": False,
        "comfyui_available": False,
    }
