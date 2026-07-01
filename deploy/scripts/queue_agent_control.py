#!/usr/bin/env python3
"""Queue a constrained control task for a GPU Agent.

This is intentionally not a generic remote shell. The agent only accepts
whitelisted actions implemented in pipeline/comfyui_agent.py.

Examples:
    .venv/bin/python scripts/queue_agent_control.py status
    .venv/bin/python scripts/queue_agent_control.py self_update --wait
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


async def redis_client():
    import redis.asyncio as redis
    from cluster_config import RedisConfig

    client = redis.Redis(
        host=RedisConfig.HOST,
        port=RedisConfig.PORT,
        db=RedisConfig.DB,
        password=RedisConfig.PASSWORD,
        decode_responses=True,
    )
    await client.ping()
    return client


async def queue_control_task(args: argparse.Namespace) -> str:
    from cluster_config import RedisConfig

    r = await redis_client()
    task_id = f"agent_control_{args.action}_{uuid.uuid4().hex[:12]}"
    data: dict[str, Any] = {"action": args.action}
    if args.script_url:
        data["script_url"] = args.script_url

    await r.hset(
        f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}",
        mapping={
            "task_id": task_id,
            "task_type": "agent_control",
            "data": json.dumps(data, ensure_ascii=False),
            "params": json.dumps(data, ensure_ascii=False),
            "priority": 1,
            "user_id": "admin",
            "status": "queued",
            "created_at": datetime.now().isoformat(),
            "progress": 0,
        },
    )
    score = 1_000_000 + int(datetime.now().timestamp())
    await r.zadd(RedisConfig.TASK_QUEUE_KEY, {task_id: score})
    await r.close()
    return task_id


async def wait_task(task_id: str, seconds: int) -> dict[str, Any]:
    from cluster_config import RedisConfig

    r = await redis_client()
    key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
    last = None
    for _ in range(max(1, seconds // 3)):
        h = await r.hgetall(key)
        status = h.get("status", "")
        if status and status != last:
            print(f"{task_id}: status={status}")
            last = status
        if status in {"completed", "failed", "cancelled", "timeout"}:
            await r.close()
            return h
        await asyncio.sleep(3)
    h = await r.hgetall(key)
    h.setdefault("status", "still_processing")
    await r.close()
    return h


async def main_async(args: argparse.Namespace) -> int:
    task_id = await queue_control_task(args)
    print(f"queued {task_id}")
    if not args.wait:
        return 0

    result = await wait_task(task_id, args.timeout)
    print("final_status=" + result.get("status", ""))
    if result.get("error"):
        print("error=" + result["error"])
    if result.get("result"):
        print("result=" + result["result"])
    return 0 if result.get("status") == "completed" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Queue a constrained GPU Agent control task")
    parser.add_argument("action", choices=["status", "self_update"])
    parser.add_argument("--script-url", default="", help="Override self-update script URL")
    parser.add_argument("--wait", action="store_true", help="Wait for the agent to report completion")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
