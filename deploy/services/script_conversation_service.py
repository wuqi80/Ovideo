"""Business rules for per-script conversations and immutable versions."""
from __future__ import annotations

from typing import Any, Dict, Optional


class ScriptConversationError(RuntimeError):
    pass


class ScriptConversationItemNotFound(ScriptConversationError):
    pass


async def get_script_conversation(
    script: dict,
    *,
    conversation_dao: Any,
) -> Dict[str, Any]:
    script_id = str(script["script_id"])
    messages = await conversation_dao.list_messages(script_id)
    versions = await conversation_dao.list_versions(script_id)
    return {
        "success": True,
        "script": dict(script),
        "messages": messages,
        "versions": versions,
        "current_version_id": script.get("current_version_id"),
    }


async def append_script_message(
    *,
    episode_id: str,
    script_id: str,
    role: str,
    content: str,
    status: str,
    model_alias: Optional[str],
    provider: Optional[str],
    model_name: Optional[str],
    reply_to_message_id: Optional[str],
    request_id: Optional[str],
    metadata: Optional[dict],
    conversation_dao: Any,
) -> Dict[str, Any]:
    message = await conversation_dao.create_message(
        episode_id=episode_id,
        script_id=script_id,
        role=role,
        content=content,
        status=status,
        model_alias=model_alias,
        provider=provider,
        model_name=model_name,
        reply_to_message_id=reply_to_message_id,
        request_id=request_id,
        metadata=metadata,
    )
    if not message:
        raise ScriptConversationError("Unable to create script message")
    return {"success": True, "message": message}


async def revise_script_message(
    *,
    script_id: str,
    message_id: str,
    content: Optional[str],
    status: Optional[str],
    metadata: Optional[dict],
    conversation_dao: Any,
) -> Dict[str, Any]:
    message = await conversation_dao.update_message(
        script_id,
        message_id,
        content=content,
        status=status,
        metadata=metadata,
    )
    if not message:
        raise ScriptConversationItemNotFound("Script message not found")
    return {"success": True, "message": message}


async def create_script_version(
    *,
    episode_id: str,
    script_id: str,
    message_id: Optional[str],
    content: str,
    storyboard_items: list,
    source: str,
    status: str,
    model_alias: Optional[str],
    provider: Optional[str],
    model_name: Optional[str],
    metadata: Optional[dict],
    set_current: bool,
    conversation_dao: Any,
) -> Dict[str, Any]:
    version = await conversation_dao.create_version(
        episode_id=episode_id,
        script_id=script_id,
        message_id=message_id,
        content=content,
        storyboard_items=storyboard_items,
        source=source,
        status=status,
        model_alias=model_alias,
        provider=provider,
        model_name=model_name,
        metadata=metadata,
        set_current=set_current,
    )
    if not version:
        raise ScriptConversationError("Unable to create script version")
    return {"success": True, "version": version}

async def select_script_version(
    *,
    script_id: str,
    version_id: str,
    conversation_dao: Any,
) -> Dict[str, Any]:
    version = await conversation_dao.select_version(script_id, version_id)
    if not version:
        raise ScriptConversationItemNotFound("Script version not found")
    return {"success": True, "version": version}


async def merge_script_version_metadata(
    *,
    script_id: str,
    version_id: str,
    metadata: dict,
    conversation_dao: Any,
) -> Dict[str, Any]:
    version = await conversation_dao.merge_version_metadata(script_id, version_id, metadata)
    if not version:
        raise ScriptConversationItemNotFound("Script version not found")
    return {"success": True, "version": version}
