#!/usr/bin/env python3
"""Create or reuse a GPU Agent record and write its token to a protected file."""
from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from queue_agent_control import _load_service_env  # noqa: E402


async def register(name: str, token_file: Path) -> tuple[str, bool]:
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
        row = await conn.fetchrow(
            "SELECT agent_id, token FROM comfyui_agents WHERE name = $1 ORDER BY created_at DESC LIMIT 1",
            name,
        )
        created = row is None
        if row is None:
            agent_id = f"agent_{secrets.token_hex(6)}"
            token = f"sk-agent-{secrets.token_hex(24)}"
            row = await conn.fetchrow(
                """
                INSERT INTO comfyui_agents (agent_id, name, token, enabled, status)
                VALUES ($1, $2, $3, true, 'offline')
                RETURNING agent_id, token
                """,
                agent_id,
                name,
                token,
            )
        else:
            await conn.execute(
                "UPDATE comfyui_agents SET enabled = true WHERE agent_id = $1",
                row["agent_id"],
            )

        token_file.parent.mkdir(parents=True, exist_ok=True)
        token_file.write_text(str(row["token"]).strip(), encoding="utf-8")
        try:
            os.chmod(token_file, 0o600)
        except OSError:
            pass
        return str(row["agent_id"]), created
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Register a MECHA GPU Agent")
    parser.add_argument("--name", required=True)
    parser.add_argument("--token-file", required=True, type=Path)
    args = parser.parse_args()
    agent_id, created = asyncio.run(register(args.name.strip(), args.token_file))
    print(f"agent_id={agent_id}")
    print(f"created={str(created).lower()}")
    print(f"token_file={args.token_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
