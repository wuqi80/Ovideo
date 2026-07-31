from pathlib import Path

import pytest
from fastapi import HTTPException

import admin_routes
import dao_agent
from dao.admin import agent as agent_dao_module


DEPLOY_DIR = Path(__file__).resolve().parents[1]


async def test_dao_rename_updates_only_display_name(monkeypatch):
    calls = []

    class FakeDatabase:
        async def fetchrow(self, query, *args):
            calls.append((query, args))
            return {
                "agent_id": args[0],
                "name": "GPU1",
                "display_name": args[1],
                "token": "stable-token",
            }

    monkeypatch.setattr(agent_dao_module, "get_db_manager", lambda: FakeDatabase())

    result = await dao_agent.AgentDAO.rename_display_name("agent_1", "主渲染机")

    assert result["agent_id"] == "agent_1"
    assert result["name"] == "GPU1"
    assert result["display_name"] == "主渲染机"
    assert result["token"] == "stable-token"
    assert "SET display_name = $2" in calls[0][0]
    assert "SET name =" not in calls[0][0]


async def test_admin_rename_preserves_routing_identity(monkeypatch):
    captured = {}

    async def fake_rename(agent_id, display_name):
        captured.update(agent_id=agent_id, display_name=display_name)
        return {
            "agent_id": agent_id,
            "name": "GPU2",
            "display_name": display_name,
            "token": "stable-token",
        }

    monkeypatch.setattr(admin_routes, "_require_db", lambda: None)
    monkeypatch.setattr(admin_routes.AgentDAO, "rename_display_name", fake_rename)

    response = await admin_routes.admin_rename_agent(
        "agent_2",
        admin_routes.AgentRenameBody(name="  备用渲染机  "),
    )

    assert captured == {"agent_id": "agent_2", "display_name": "备用渲染机"}
    assert response["agent"]["agent_id"] == "agent_2"
    assert response["agent"]["name"] == "GPU2"
    assert response["agent"]["display_name"] == "备用渲染机"
    assert response["agent"]["token"] == "stable-token"


async def test_admin_rename_rejects_blank_name(monkeypatch):
    monkeypatch.setattr(admin_routes, "_require_db", lambda: None)

    with pytest.raises(HTTPException) as exc_info:
        await admin_routes.admin_rename_agent(
            "agent_2",
            admin_routes.AgentRenameBody(name="   "),
        )

    assert exc_info.value.status_code == 400


def test_display_name_migration_and_admin_ui_contract():
    migration = (
        DEPLOY_DIR / "sql/db_migration_gpu_agent_display_name.sql"
    ).read_text(encoding="utf-8")
    manifest = (DEPLOY_DIR / "db_build/manifest.txt").read_text(encoding="utf-8")
    admin_js = (DEPLOY_DIR / "admin/app.js").read_text(encoding="utf-8")

    assert "ADD COLUMN IF NOT EXISTS display_name" in migration
    assert "SET display_name = name" in migration
    assert "sql/db_migration_gpu_agent_display_name.sql" in manifest
    assert "a.display_name || a.name || a.agent_id" in admin_js
    assert "/api/admin/agents/${id}/name" in admin_js
    assert "escapeHtml(displayName)" in admin_js
    assert "encodeURIComponent(displayName).replace(/'/g, '%27')" in admin_js
