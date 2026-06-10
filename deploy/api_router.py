# api_router.py
"""
Smart API Router: routes API calls directly or via Agent based on proxy_mode config.
- proxy_mode='direct' -> backend calls API directly using aiohttp
- proxy_mode='agent'/'custom' -> creates task in Redis queue for Agent to execute
"""
import json
import uuid
import logging
import aiohttp
from typing import Optional, Dict, Any
from dao_api_config import ApiConfigDAO
from dao_system_settings import SystemSettingsDAO
from dao_task import TaskDAO

logger = logging.getLogger(__name__)

redis_client = None


def set_redis_client(client):
    """Called from cluster_main.py during startup to inject Redis client"""
    global redis_client
    redis_client = client


class SmartApiRouter:
    """Routes API calls based on api_configurations.proxy_mode"""

    async def call_api(
        self, config_id: str, body: dict,
        method: str = "POST", extra_headers: Optional[dict] = None
    ) -> Dict[str, Any]:
        config = await ApiConfigDAO.get_by_id(config_id)
        if not config:
            raise ValueError(f"API config '{config_id}' not found")
        api_key = await ApiConfigDAO.get_decrypted_key(config_id)
        if config["proxy_mode"] == "direct":
            return await self._call_direct(config, api_key, body, method, extra_headers)
        else:
            return await self._dispatch_to_agent(config, api_key, body, method, extra_headers)

    async def _call_direct(self, config, api_key, body, method, extra_headers):
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        stored_headers = config.get("headers")
        if stored_headers:
            if isinstance(stored_headers, str):
                stored_headers = json.loads(stored_headers)
            headers.update(stored_headers)
        if extra_headers:
            headers.update(extra_headers)
        async with aiohttp.ClientSession() as session:
            req_fn = getattr(session, method.lower())
            async with req_fn(
                config["endpoint"], json=body, headers=headers,
                timeout=aiohttp.ClientTimeout(total=120)
            ) as resp:
                result = await resp.json()
                return result

    async def _dispatch_to_agent(self, config, api_key, body, method, extra_headers):
        global redis_client
        if not redis_client:
            raise RuntimeError("Redis not available, cannot dispatch to agent")
        proxy_settings = await SystemSettingsDAO.get_proxy_settings()
        proxy = proxy_settings.get("proxy_https", "")
        if config["proxy_mode"] == "custom" and config.get("custom_proxy"):
            proxy = config["custom_proxy"]
        task_id = f"api_{uuid.uuid4().hex[:16]}"
        stored_headers = config.get("headers") or {}
        if isinstance(stored_headers, str):
            stored_headers = json.loads(stored_headers)
        merged_headers = {**stored_headers, **(extra_headers or {})}
        task_data = {
            "task_id": task_id,
            "task_type": "api_call",
            "data": {
                "config_id": config["config_id"],
                "endpoint": config["endpoint"],
                "api_key": api_key,
                "method": method,
                "headers": merged_headers,
                "body": body,
                "proxy": proxy,
            }
        }
        await TaskDAO.create_task(task_id=task_id, user_id="system", task_type="api_call", task_data=task_data["data"])
        from cluster_config import RedisConfig
        await redis_client.zadd(RedisConfig.TASK_QUEUE_KEY, {json.dumps(task_data): 10})
        return {"task_id": task_id, "status": "queued", "message": "Dispatched to agent"}
