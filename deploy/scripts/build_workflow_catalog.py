"""Build a clean workflow catalog from backup, disk, and database exports.

Database candidates have priority because they are the versions currently used
by the application. The active disk directory is the second source, and the
immutable historical backup is the final fallback.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from services.workflow_template_validation import (  # noqa: E402
    decode_workflow_json,
    workflow_executable_node_count,
    workflow_invalid_reason,
)
from pipeline.workflow_handler import WorkflowHandler  # noqa: E402


ANGLE_ADJUST_NEGATIVE_PROMPT = (
    "与原图不符合的风格，不符合image1的风格和外观，扭曲变形的身体，错乱的结构，"
    "错误的透视，不自然的异物，奇怪的肢体形状，多个主体，裁切头部，头顶缺失，"
    "脸部缺失，身体被截断，四肢缺失，手脚出框，服装被截断，主体贴边"
)


@dataclass(frozen=True)
class Candidate:
    file_name: str
    workflow_key: str
    workflow_json: dict[str, Any]
    source: str
    priority: int
    enabled: bool | None = None
    version: int | None = None
    updated_at: str = ""


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _database_rows(path: Path) -> list[dict[str, Any]]:
    value = _read_json(path)
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict):
        rows = value.get("rows", value.get("workflows", []))
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    raise ValueError(f"Unsupported database export format: {path}")


def _disk_candidates(
    directory: Path,
    *,
    source: str,
    priority: int,
    key_by_file: dict[str, str],
) -> tuple[list[Candidate], list[tuple[str, str, str]]]:
    candidates: list[Candidate] = []
    excluded: list[tuple[str, str, str]] = []
    for path in sorted(directory.glob("*.json"), key=lambda item: item.name.lower()):
        workflow_json = _read_json(path)
        reason = workflow_invalid_reason(workflow_json)
        workflow_key = key_by_file.get(path.name.lower(), path.stem)
        if reason:
            excluded.append((source, path.name, reason))
            continue
        candidates.append(
            Candidate(
                file_name=path.name,
                workflow_key=workflow_key,
                workflow_json=workflow_json,
                source=source,
                priority=priority,
            )
        )
    return candidates, excluded


def _database_candidates(
    rows: Iterable[dict[str, Any]],
    *,
    file_by_key: dict[str, str | None],
) -> tuple[list[Candidate], list[tuple[str, str, str]]]:
    candidates: list[Candidate] = []
    excluded: list[tuple[str, str, str]] = []
    for row in rows:
        workflow_key = str(
            row.get("workflow_key") or row.get("category") or row.get("name") or ""
        ).strip()
        file_name = file_by_key.get(workflow_key) or f"{workflow_key}.json"
        workflow_json = decode_workflow_json(row.get("workflow_json"))
        reason = workflow_invalid_reason(workflow_json)
        if reason:
            excluded.append(("database", workflow_key or file_name, reason))
            continue
        candidates.append(
            Candidate(
                file_name=file_name,
                workflow_key=workflow_key,
                workflow_json=workflow_json,
                source="database",
                priority=30,
                enabled=bool(row.get("enabled", True)),
                version=int(row.get("version") or 1),
                updated_at=str(row.get("updated_at") or ""),
            )
        )
    return candidates, excluded


def select_candidates(candidates: Iterable[Candidate]) -> list[Candidate]:
    """Select one newest usable version for each case-insensitive file name."""
    selected: dict[str, Candidate] = {}
    for candidate in candidates:
        key = candidate.file_name.lower()
        existing = selected.get(key)
        rank = (candidate.priority, candidate.updated_at, candidate.version or 0)
        existing_rank = (
            (existing.priority, existing.updated_at, existing.version or 0)
            if existing
            else None
        )
        if existing is None or rank > existing_rank:
            selected[key] = candidate
    return sorted(selected.values(), key=lambda item: item.file_name.lower())


def _safe_clean_output(output_dir: Path, source_dirs: Iterable[Path]) -> None:
    resolved_output = output_dir.resolve()
    if resolved_output == Path(resolved_output.anchor):
        raise ValueError(f"Refusing to clean filesystem root: {resolved_output}")
    for source_dir in source_dirs:
        if resolved_output == source_dir.resolve():
            raise ValueError(f"Refusing to clean source directory: {resolved_output}")
    for path in output_dir.glob("*.json"):
        path.unlink()
    catalog_path = output_dir / "CATALOG.md"
    if catalog_path.is_file():
        catalog_path.unlink()


def _workflow_for_output(candidate: Candidate) -> dict[str, Any]:
    workflow = deepcopy(candidate.workflow_json)
    workflow_name = Path(candidate.file_name).stem
    WorkflowHandler.apply_gpu1_qwen_model_paths(workflow, workflow_name)
    WorkflowHandler.apply_gpu1_upscale_contract(workflow, workflow_name)

    lower_name = candidate.file_name.lower()
    if lower_name == "remove_watermark.json":
        seed_node = workflow.get("118:111")
        if isinstance(seed_node, dict):
            seed_node.setdefault("inputs", {})["noise_seed"] = "{seed}"
    elif lower_name == "i2i_fj.json":
        prompt_node = workflow.get("110")
        if isinstance(prompt_node, dict):
            prompt_node.setdefault("inputs", {})["prompt"] = ANGLE_ADJUST_NEGATIVE_PROMPT
    return workflow


def _write_catalog(
    output_dir: Path,
    selected: list[Candidate],
    excluded: list[tuple[str, str, str]],
) -> None:
    lines = [
        "# Executable Workflow Catalog",
        "",
        "Selection priority: production database > deploy/workflows > "
        "server_backups/workflows_20260701-202817. Empty JSON objects, "
        "replacement-marker placeholders, placeholder-node graphs, and no-node "
        "graphs are excluded.",
        "",
        "| File | Workflow key | Source | Nodes | Enabled | Version | Updated at | SHA-256 |",
        "| --- | --- | --- | ---: | --- | ---: | --- | --- |",
    ]
    for candidate in selected:
        output_path = output_dir / candidate.file_name
        digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
        enabled = (
            "yes" if candidate.enabled is True else "no" if candidate.enabled is False else "-"
        )
        version = str(candidate.version) if candidate.version is not None else "-"
        lines.append(
            f"| `{candidate.file_name}` | `{candidate.workflow_key}` | "
            f"{candidate.source} | {workflow_executable_node_count(candidate.workflow_json)} | "
            f"{enabled} | {version} | {candidate.updated_at or '-'} | `{digest}` |"
        )

    lines.extend(
        [
            "",
            "## Excluded Invalid Sources",
            "",
            "| Source | File or key | Reason |",
            "| --- | --- | --- |",
        ]
    )
    for source, identifier, reason in sorted(
        excluded, key=lambda item: (item[0], item[1].lower())
    ):
        if reason.startswith("workflow contains invalid marker:"):
            reason = "workflow contains invalid replacement marker"
        lines.append(f"| {source} | `{identifier}` | {reason} |")
    lines.append("")
    (output_dir / "CATALOG.md").write_text(
        "\n".join(lines),
        encoding="utf-8",
        newline="\n",
    )


def build_catalog(
    *,
    backup_dir: Path,
    active_dir: Path,
    database_export: Path,
    output_dir: Path,
    file_by_key: dict[str, str | None],
    clean: bool = False,
) -> tuple[list[Candidate], list[tuple[str, str, str]]]:
    key_by_file = {
        file_name.lower(): key
        for key, file_name in file_by_key.items()
        if file_name
    }
    backup_candidates, backup_excluded = _disk_candidates(
        backup_dir,
        source="backup-20260701",
        priority=10,
        key_by_file=key_by_file,
    )
    active_candidates, active_excluded = _disk_candidates(
        active_dir,
        source="deploy/workflows",
        priority=20,
        key_by_file=key_by_file,
    )
    database_candidates, database_excluded = _database_candidates(
        _database_rows(database_export),
        file_by_key=file_by_key,
    )
    selected = select_candidates(
        [*backup_candidates, *active_candidates, *database_candidates]
    )
    excluded = [*backup_excluded, *active_excluded, *database_excluded]

    output_dir.mkdir(parents=True, exist_ok=True)
    if clean:
        _safe_clean_output(output_dir, (backup_dir, active_dir))
    for candidate in selected:
        target = output_dir / candidate.file_name
        workflow_json = _workflow_for_output(candidate)
        target.write_text(
            json.dumps(workflow_json, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    _write_catalog(output_dir, selected, excluded)
    return selected, excluded


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--active-dir", type=Path, required=True)
    parser.add_argument("--database-export", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--clean", action="store_true")
    args = parser.parse_args()

    from pipeline.workflow_config import WORKFLOW_CONFIGS

    selected, excluded = build_catalog(
        backup_dir=args.backup_dir,
        active_dir=args.active_dir,
        database_export=args.database_export,
        output_dir=args.output_dir,
        file_by_key={
            str(key): getattr(config, "file", None)
            for key, config in WORKFLOW_CONFIGS.items()
        },
        clean=args.clean,
    )
    print(
        f"Workflow catalog built: selected={len(selected)} "
        f"excluded_sources={len(excluded)} output={args.output_dir.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
