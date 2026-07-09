#!/usr/bin/env python3
"""Read-only readiness check for the external GPU Agent path.

This script is designed for the backend server. It answers three questions:

1. Is the public Agent script updated?
2. Are online GPU Agents running a version that supports agent_control?
3. What should we do next before running workflow E2E diagnostics?

It never prints Agent tokens or database credentials.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from queue_agent_control import fetch_online_agents, _load_service_env, _supports_agent_control  # noqa: E402


def parse_agent_version(path: Path) -> str:
    if not path.exists():
        return "missing"
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r'AGENT_VERSION\s*=\s*["\']([^"\']+)["\']', text)
    return match.group(1) if match else "unknown"


def public_script_versions() -> dict[str, str]:
    candidates = {
        "public_storage": ROOT / "persistent_storage" / "tools" / "comfyui_agent.py",
        "pipeline": ROOT / "pipeline" / "comfyui_agent.py",
    }
    return {name: parse_agent_version(path) for name, path in candidates.items()}


def print_json_line(prefix: str, payload: dict[str, Any]) -> None:
    print(prefix + "=" + json.dumps(payload, ensure_ascii=False, default=str))


def public_base_url() -> str:
    return (
        os.getenv("PUBLIC_BASE_URL")
        or os.getenv("SERVER_BASE_URL")
        or os.getenv("SMOKE_BASE_URL")
        or "https://mecha.one"
    ).rstrip("/")


def print_gpu_agent_restart_commands(base_url: str) -> None:
    print("gpu_command=pkill -f comfyui_agent.py || true")
    print(f"gpu_command=curl -fsSL {base_url}/storage/tools/comfyui_agent.py -o comfyui_agent.py")
    print(f"gpu_command=python comfyui_agent.py --server {base_url} --token '<sk-agent token from admin>' --ports 8188")


async def check_agents() -> list[dict[str, Any]]:
    agents = await fetch_online_agents()
    normalized = []
    for agent in agents:
        normalized.append(
            {
                "agent_id": agent.get("agent_id"),
                "name": agent.get("name"),
                "status": agent.get("status"),
                "agent_version": agent.get("agent_version"),
                "hostname": agent.get("hostname"),
                "supports_agent_control": _supports_agent_control(agent),
            }
        )
    return normalized


async def fetch_last_seen_agents(limit: int = 5) -> list[dict[str, Any]]:
    import asyncpg

    env = _load_service_env()
    conn = await asyncpg.connect(
        host=env.get("DB_HOST", "localhost"),
        port=int(env.get("DB_PORT", "5432")),
        database=env.get("DB_NAME", "my2_db"),
        user=env.get("DB_USER", "my2_user"),
        password=env.get("DB_PASSWORD", ""),
    )
    try:
        rows = await conn.fetch(
            """
            select agent_id,
                   name,
                   status,
                   last_heartbeat,
                   coalesce(system_info->>'agent_version', 'legacy') as agent_version,
                   coalesce(system_info->>'hostname', '-') as hostname
            from comfyui_agents
            where enabled = true
            order by last_heartbeat desc nulls last
            limit $1
            """,
            limit,
        )
        return [
            {
                "agent_id": row["agent_id"],
                "name": row["name"],
                "status": row["status"],
                "last_heartbeat": row["last_heartbeat"],
                "agent_version": row["agent_version"],
                "hostname": row["hostname"],
                "supports_agent_control": "agent-control" in str(row["agent_version"] or ""),
            }
            for row in rows
        ]
    finally:
        await conn.close()


def run_prebuild_check() -> int:
    script = ROOT / "scripts" / "check_workflow_prebuild.py"
    if not script.exists():
        print("prebuild_check=missing")
        return 1
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(ROOT),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=120,
    )
    interesting = [
        line
        for line in result.stdout.splitlines()
        if line.endswith("_PASS") or "ERR " in line or line.startswith("workflow_dir=")
    ]
    for line in interesting:
        print("prebuild_check_line=" + line)
    print("prebuild_check_exit=" + str(result.returncode))
    return result.returncode


async def main_async(args: argparse.Namespace) -> int:
    versions = public_script_versions()
    print_json_line("agent_script_versions", versions)
    base_url = public_base_url()

    agents = await check_agents()
    if not agents:
        print("ready=false")
        print("reason=No online GPU Agent heartbeat found")
        for agent in await fetch_last_seen_agents():
            print_json_line("last_seen_agent", agent)
        print("next_step=Start or restart the GPU Agent with the latest public script")
        print_gpu_agent_restart_commands(base_url)
        return 2

    for agent in agents:
        print_json_line("online_agent", agent)

    unsupported = [agent for agent in agents if not agent["supports_agent_control"]]
    if unsupported:
        print("ready=false")
        print("reason=Online GPU Agent is still legacy and cannot return detailed diagnostics")
        print("next_step=Restart the GPU Agent once with the latest public script")
        print_gpu_agent_restart_commands(base_url)
        return 2

    prebuild_code = 0
    if args.prebuild:
        prebuild_code = run_prebuild_check()

    print("ready=true")
    print("next_step=.venv/bin/python scripts/diagnose_gpu_agent_workflows.py --qwen-branch-probes")
    return prebuild_code


def main() -> int:
    parser = argparse.ArgumentParser(description="Check GPU Agent readiness for workflow E2E diagnostics")
    parser.add_argument("--no-prebuild", dest="prebuild", action="store_false", help="Skip workflow prebuild check")
    parser.set_defaults(prebuild=True)
    args = parser.parse_args()
    try:
        return asyncio.run(main_async(args))
    except RuntimeError as exc:
        print(f"ready=false")
        print(f"error={exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
