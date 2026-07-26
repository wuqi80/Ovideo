"""Sync executable workflow JSON files into workflow_templates."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import asyncpg


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from pipeline.workflow_config import WORKFLOW_CONFIGS  # noqa: E402
from services.workflow_template_validation import (  # noqa: E402
    decode_workflow_json,
    workflow_invalid_reason,
)


_PLACEHOLDER_RE = re.compile(r"^\{([A-Za-z0-9_]+)\}$")


@dataclass(frozen=True)
class WorkflowSyncItem:
    workflow_key: str
    name: str
    category: str
    description: str
    workflow_json: dict[str, Any]
    placeholders: list[dict[str, Any]]


def _workflow_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _workflow_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _workflow_strings(child)


def _placeholder_objects(
    names: Iterable[str],
    defaults: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    defaults = defaults or {}
    return [
        {
            "key": name,
            "label": name,
            "type": "text",
            "required": False,
            "default": defaults.get(name, ""),
        }
        for name in sorted({name for name in names if name})
    ]


def _configured_placeholders(config: Any) -> list[dict[str, Any]]:
    names = getattr(config, "placeholders", None) or []
    return _placeholder_objects(names, getattr(config, "default_params", None) or {})


def _json_key(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _jsonable_row(row: Any) -> dict[str, Any]:
    return {
        key: value.isoformat() if isinstance(value, datetime) else value
        for key, value in dict(row).items()
    }


def load_catalog_items(
    workflow_dir: Path,
    configs: dict[str, Any] | None = None,
) -> list[WorkflowSyncItem]:
    configs = configs or WORKFLOW_CONFIGS
    key_by_file = {
        str(getattr(config, "file")).lower(): str(key)
        for key, config in configs.items()
        if getattr(config, "file", None)
    }
    items: list[WorkflowSyncItem] = []
    for path in sorted(workflow_dir.glob("*.json"), key=lambda item: item.name.lower()):
        workflow_json = json.loads(path.read_text(encoding="utf-8"))
        reason = workflow_invalid_reason(workflow_json)
        if reason:
            raise ValueError(f"{path.name}: {reason}")

        workflow_key = key_by_file.get(path.name.lower(), path.stem)
        config = configs.get(workflow_key)
        if config:
            placeholders = _configured_placeholders(config)
            name = getattr(config, "name", None) or workflow_key
            category = workflow_key
            description = getattr(config, "description", "") or ""
        else:
            placeholders = _placeholder_objects(
                match.group(1)
                for value in _workflow_strings(workflow_json)
                for match in [_PLACEHOLDER_RE.match(value)]
                if match
            )
            name = workflow_key
            category = workflow_key
            description = f"Catalog workflow file {path.name}"

        items.append(
            WorkflowSyncItem(
                workflow_key=workflow_key,
                name=name,
                category=category,
                description=description,
                workflow_json=workflow_json,
                placeholders=placeholders,
            )
        )
    return items


def _needs_update(row: dict[str, Any], item: WorkflowSyncItem) -> bool:
    return any(
        [
            row.get("workflow_key") != item.workflow_key,
            row.get("name") != item.name,
            row.get("category") != item.category,
            (row.get("description") or "") != item.description,
            _json_key(decode_workflow_json(row.get("workflow_json"))) != _json_key(item.workflow_json),
            _json_key(decode_workflow_json(row.get("placeholders")) or []) != _json_key(item.placeholders),
        ]
    )


async def sync_workflow_templates(
    *,
    workflow_dir: Path,
    apply: bool,
    backup_path: Path,
) -> tuple[int, int, int]:
    items = load_catalog_items(workflow_dir)
    conn = await asyncpg.connect(
        host=os.getenv("DB_HOST", "/tmp"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "my2_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
    )
    try:
        async with conn.transaction():
            rows = [
                _jsonable_row(row)
                for row in await conn.fetch(
                    """
                    SELECT *
                    FROM workflow_templates
                    ORDER BY category, name
                    FOR UPDATE
                    """
                )
            ]
            by_key = {
                str(row.get("workflow_key") or ""): row
                for row in rows
                if row.get("workflow_key")
            }
            by_name = {str(row.get("name") or ""): row for row in rows if row.get("name")}

            to_create: list[WorkflowSyncItem] = []
            to_update: list[tuple[dict[str, Any], WorkflowSyncItem]] = []
            unchanged = 0
            for item in items:
                row = by_key.get(item.workflow_key) or by_name.get(item.name)
                if not row:
                    to_create.append(item)
                elif _needs_update(row, item):
                    to_update.append((row, item))
                else:
                    unchanged += 1

            if not apply:
                return len(to_create), len(to_update), unchanged

            backup_path.parent.mkdir(parents=True, exist_ok=True)
            backup_path.write_text(
                json.dumps(
                    {
                        "created_at": datetime.now().astimezone().isoformat(),
                        "table": "workflow_templates",
                        "reason": "Recovery snapshot before syncing workflow catalog files.",
                        "rows": rows,
                    },
                    ensure_ascii=False,
                    indent=2,
                    default=str,
                )
                + "\n",
                encoding="utf-8",
                newline="\n",
            )

            for row, item in to_update:
                await conn.execute(
                    """
                    UPDATE workflow_templates
                    SET name = $1,
                        category = $2,
                        description = $3,
                        workflow_json = $4::jsonb,
                        placeholders = $5::jsonb,
                        node_type = 'any',
                        estimated_time = 30,
                        workflow_key = $6,
                        version = CASE
                            WHEN workflow_json IS DISTINCT FROM $4::jsonb THEN version + 1
                            ELSE version
                        END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE template_id = $7
                    """,
                    item.name,
                    item.category,
                    item.description,
                    json.dumps(item.workflow_json, ensure_ascii=False),
                    json.dumps(item.placeholders, ensure_ascii=False),
                    item.workflow_key,
                    row["template_id"],
                )

            for item in to_create:
                await conn.execute(
                    """
                    INSERT INTO workflow_templates (
                        template_id, name, category, description,
                        workflow_json, placeholders, node_type,
                        estimated_time, enabled, workflow_key
                    )
                    VALUES (
                        'wft_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
                        $1, $2, $3, $4::jsonb, $5::jsonb, 'any', 30, TRUE, $6
                    )
                    """,
                    item.name,
                    item.category,
                    item.description,
                    json.dumps(item.workflow_json, ensure_ascii=False),
                    json.dumps(item.placeholders, ensure_ascii=False),
                    item.workflow_key,
                )

            return len(to_create), len(to_update), unchanged
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflow-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--backup-path",
        type=Path,
        default=Path("server_backups")
        / f"workflow_templates_sync_{datetime.now():%Y%m%d-%H%M%S}"
        / "workflow_templates_before_sync.json.bak",
    )
    args = parser.parse_args()
    created, updated, unchanged = asyncio.run(
        sync_workflow_templates(
            workflow_dir=args.workflow_dir,
            apply=args.apply,
            backup_path=args.backup_path,
        )
    )
    action = "synced" if args.apply else "would_sync"
    print(
        f"Workflow template catalog sync: {action}=1 created={created} "
        f"updated={updated} unchanged={unchanged} "
        f"backup={args.backup_path if args.apply else '-'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
