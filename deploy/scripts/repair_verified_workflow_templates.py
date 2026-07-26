"""Repair only known legacy placeholder workflow rows from verified disk templates."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import asyncpg


DEPLOY_DIR = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = DEPLOY_DIR / "workflows"

# A row above its legacy ceiling is treated as a real customization and preserved.
VERIFIED_RECOVERY_SPECS: dict[str, tuple[str, int, list[str]]] = {
    "i2i_fj": ("I2I_FJ.json", 4, ["image", "prompt", "seed"]),
    "i2i_around": ("I2I_Around.json", 4, ["image", "prompt", "seed"]),
    **{
        f"qwenN_{index}": (
            f"qwenN_{index}.json",
            0,
            [*(f"image_{image_index}" for image_index in range(1, index + 1)), "prompt", "seed"],
        )
        for index in range(1, 7)
    },
}


def workflow_node_count(value: Any) -> int:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return 0
    if not isinstance(value, dict):
        return 0
    return sum(
        1
        for node in value.values()
        if isinstance(node, dict) and isinstance(node.get("class_type"), str)
    )


def load_verified_workflow(file_name: str) -> dict[str, Any]:
    path = WORKFLOW_DIR / file_name
    workflow = json.loads(path.read_text(encoding="utf-8"))
    if workflow_node_count(workflow) <= 4:
        raise RuntimeError(f"Verified workflow is incomplete: {path}")
    return workflow


async def repair_verified_workflow_templates() -> tuple[int, int]:
    conn = await asyncpg.connect(
        host=os.getenv("DB_HOST", "/tmp"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "my2_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
    )
    repaired = 0
    preserved = 0
    try:
        async with conn.transaction():
            for workflow_key, (file_name, maximum_legacy_nodes, placeholders) in VERIFIED_RECOVERY_SPECS.items():
                row = await conn.fetchrow(
                    """
                    SELECT template_id, workflow_json
                    FROM workflow_templates
                    WHERE workflow_key = $1
                    FOR UPDATE
                    """,
                    workflow_key,
                )
                if not row:
                    preserved += 1
                    continue
                existing_nodes = workflow_node_count(row["workflow_json"])
                if existing_nodes > maximum_legacy_nodes:
                    preserved += 1
                    continue

                workflow = load_verified_workflow(file_name)
                await conn.execute(
                    """
                    UPDATE workflow_templates
                    SET workflow_json = $1::jsonb,
                        placeholders = $2::jsonb,
                        enabled = TRUE,
                        version = version + 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE template_id = $3
                    """,
                    json.dumps(workflow, ensure_ascii=False),
                    json.dumps([{"key": key} for key in placeholders], ensure_ascii=False),
                    row["template_id"],
                )
                repaired += 1
    finally:
        await conn.close()
    return repaired, preserved


def main() -> int:
    repaired, preserved = asyncio.run(repair_verified_workflow_templates())
    print(f"Verified workflow repair complete: repaired={repaired} preserved={preserved}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
