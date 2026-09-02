"""Authenticated browser download route for files retained on a GPU Agent."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from dao_task import TaskDAO
from services.node_output_relay import is_eof, registry, tickets


def _json_dict(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}
    return {}


def _find_output(result: dict, output_id: str) -> dict:
    for bucket in ("images", "output_files"):
        values = result.get(bucket) or []
        if not isinstance(values, list):
            continue
        for item in values:
            if isinstance(item, dict) and str(item.get("node_output_id") or "") == output_id:
                return item
    return {}


def create_node_output_router(*, require_auth_dependency: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/node-outputs", tags=["node-outputs"])

    async def resolve_output(task_id: str, output_id: str, user_id: str) -> tuple[dict, dict]:
        row = await TaskDAO.get_task_by_task_id(task_id)
        task = dict(row or {})
        if not task or str(task.get("user_id") or "") != str(user_id):
            raise HTTPException(status_code=404, detail="图片不存在")
        if str(task.get("status") or "").lower() != "completed":
            raise HTTPException(status_code=409, detail="图片仍在处理中")

        result = _json_dict(task.get("result_data"))
        output = _find_output(result, output_id)
        if not output:
            raise HTTPException(status_code=404, detail="本地节点图片不存在或已过期")
        return task, output

    async def create_stream(task_id: str, output_id: str, user_id: str):
        task, output = await resolve_output(task_id, output_id, user_id)
        agent_id = str(output.get("node_agent_id") or task.get("node_id") or "").strip()
        if not agent_id:
            raise HTTPException(status_code=409, detail="本地节点信息缺失")

        filename = Path(str(output.get("filename") or "upscaled-image.png")).name
        mime_type = str(output.get("mime_type") or "image/png")
        size = max(0, int(output.get("size") or 0))
        relay = await registry.create(
            task_id=task_id,
            output_id=output_id,
            agent_id=agent_id,
            user_id=str(user_id),
            filename=filename,
            mime_type=mime_type,
            size=size,
        )
        try:
            await asyncio.wait_for(relay.started.wait(), timeout=45)
        except asyncio.TimeoutError as exc:
            await registry.close(relay.relay_id)
            raise HTTPException(status_code=504, detail="本地节点暂未响应，请稍后重试下载") from exc

        async def stream():
            try:
                while True:
                    item = await asyncio.wait_for(relay.queue.get(), timeout=120)
                    if is_eof(item):
                        if relay.error:
                            raise RuntimeError(relay.error)
                        break
                    yield item
            finally:
                await registry.close(relay.relay_id)

        headers = {
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        }
        if size:
            headers["Content-Length"] = str(size)
        return StreamingResponse(stream(), media_type=mime_type, headers=headers)

    @router.post("/{task_id}/{output_id}/ticket")
    async def create_download_ticket(
        task_id: str,
        output_id: str,
        user_id: str = Depends(require_auth_dependency),
    ):
        await resolve_output(task_id, output_id, user_id)
        ticket = await tickets.create(
            task_id=task_id,
            output_id=output_id,
            user_id=str(user_id),
        )
        return {
            "download_url": f"/api/node-outputs/download/{ticket.token}",
            "expires_in": tickets.ttl_seconds,
        }

    @router.get("/{task_id}/{output_id}/download")
    async def download_node_output_with_session(
        task_id: str,
        output_id: str,
        user_id: str = Depends(require_auth_dependency),
    ):
        """Header-authenticated fallback for API clients; browsers use a ticket."""
        return await create_stream(task_id, output_id, str(user_id))

    @router.get("/download/{ticket_token}")
    async def download_node_output(ticket_token: str):
        ticket = await tickets.consume(ticket_token)
        if ticket is None:
            raise HTTPException(status_code=401, detail="下载链接已失效，请重新点击下载")
        return await create_stream(ticket.task_id, ticket.output_id, ticket.user_id)

    return router
