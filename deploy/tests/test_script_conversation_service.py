from __future__ import annotations

import pytest

from services import script_conversation_service as service


class FakeConversationDAO:
    created_message = None
    updated_message = None
    created_version = None
    selected_version = None

    @staticmethod
    async def list_messages(script_id):
        return [{"message_id": "msg_1", "script_id": script_id, "role": "user"}]

    @staticmethod
    async def list_versions(script_id):
        return [{"version_id": "ver_1", "script_id": script_id, "version_no": 1}]

    @classmethod
    async def create_message(cls, **kwargs):
        cls.created_message = kwargs
        return {"message_id": "msg_new", **kwargs}

    @classmethod
    async def update_message(cls, script_id, message_id, **kwargs):
        cls.updated_message = {"script_id": script_id, "message_id": message_id, **kwargs}
        if message_id == "missing":
            return None
        return cls.updated_message

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created_version = kwargs
        return {"version_id": "ver_new", "version_no": 2, **kwargs}

    @classmethod
    async def select_version(cls, script_id, version_id):
        cls.selected_version = (script_id, version_id)
        if version_id == "missing":
            return None
        return {"version_id": version_id, "script_id": script_id}


async def test_get_conversation_returns_messages_versions_and_current_pointer():
    result = await service.get_script_conversation(
        {"script_id": "script_1", "current_version_id": "ver_1"},
        conversation_dao=FakeConversationDAO,
    )
    assert result["current_version_id"] == "ver_1"
    assert result["messages"][0]["message_id"] == "msg_1"
    assert result["versions"][0]["version_id"] == "ver_1"


async def test_create_version_forwards_model_and_storyboard_snapshot():
    result = await service.create_script_version(
        episode_id="ep_1",
        script_id="script_1",
        message_id="msg_2",
        content="镜头01",
        storyboard_items=[{"id": "shot_1"}],
        source="ai",
        status="ready",
        model_alias="金丹",
        provider="deepseek",
        model_name="deepseek-chat",
        metadata={"requestId": "req_1"},
        set_current=True,
        conversation_dao=FakeConversationDAO,
    )
    assert result["version"]["version_id"] == "ver_new"
    assert FakeConversationDAO.created_version["storyboard_items"] == [{"id": "shot_1"}]
    assert FakeConversationDAO.created_version["set_current"] is True


async def test_missing_message_and_version_raise_not_found():
    with pytest.raises(service.ScriptConversationItemNotFound):
        await service.revise_script_message(
            script_id="script_1",
            message_id="missing",
            content=None,
            status="failed",
            metadata=None,
            conversation_dao=FakeConversationDAO,
        )
    with pytest.raises(service.ScriptConversationItemNotFound):
        await service.select_script_version(
            script_id="script_1",
            version_id="missing",
            conversation_dao=FakeConversationDAO,
        )
