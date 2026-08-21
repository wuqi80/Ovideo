from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set


VALID_STATUSES = {"ready", "already_canonical", "target_exists_same_size"}
SQL_CHUNK_SIZE = 500
LEGACY_URL_COLUMNS = {
    "storyboard_items": [
        "generated_image_url",
        "dialogue_audio_url",
        "narration_audio_url",
        "sfx_audio_url",
        "mixed_audio_url",
    ],
    "video_segments": ["video_url", "thumbnail_url"],
    "assets": ["thumbnail_url"],
}


def read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def quote_sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def nullable_sql(value: Any) -> str:
    return quote_sql(value) if value not in (None, "") else "NULL"


def chunked(values: List[Any], size: int = SQL_CHUNK_SIZE) -> Iterable[List[Any]]:
    for index in range(0, len(values), size):
        yield values[index:index + size]


def safe_resolve_under(root: Path, candidate: str) -> Optional[Path]:
    if not candidate:
        return None
    path = Path(candidate)
    if not path.is_absolute():
        path = Path.cwd() / path
    try:
        resolved = path.resolve()
        resolved.relative_to(root.resolve())
        return resolved
    except Exception:
        return None


def dirty_file_ids(*row_groups: List[Dict[str, str]]) -> Set[str]:
    result: Set[str] = set()
    for rows in row_groups:
        for row in rows:
            file_id = row.get("file_id")
            if file_id:
                result.add(file_id)
    return result


def dirty_urls(*row_groups: List[Dict[str, str]]) -> List[str]:
    urls: Set[str] = set()
    for rows in row_groups:
        for row in rows:
            for key in ("file_url", "old_url", "new_url"):
                value = row.get(key)
                if value and value.startswith(("/storage/", "/api/files/")):
                    urls.add(value)
    return sorted(urls)


def manifest_fields() -> List[str]:
    return [
        "status",
        "file_id",
        "user_id",
        "file_type",
        "file_name",
        "project_id",
        "episode_id",
        "source",
        "old_rel_path",
        "new_rel_path",
        "old_path",
        "new_path",
        "old_url",
        "new_url",
        "file_size_bytes",
        "created_at",
    ]


def select_clean_rows(
    manifest_rows: List[Dict[str, str]],
    *,
    storage_root: Path,
    dirty_ids: Set[str],
) -> tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    clean: List[Dict[str, str]] = []
    excluded: List[Dict[str, str]] = []
    storage_root = storage_root.resolve()

    for row in manifest_rows:
        reasons: List[str] = []
        status = row.get("status") or ""
        file_id = row.get("file_id") or ""
        old_rel = row.get("old_rel_path") or ""
        old_path = storage_root / old_rel if old_rel else None

        if status not in VALID_STATUSES:
            reasons.append(f"status:{status or 'empty'}")
        if file_id in dirty_ids:
            reasons.append("dirty_report")
        if not row.get("project_id"):
            reasons.append("missing_project")
        if not old_path or not old_path.exists():
            reasons.append("missing_source_file")
        if not row.get("new_rel_path"):
            reasons.append("missing_new_path")

        if reasons:
            excluded.append({**row, "exclude_reason": "|".join(reasons)})
        else:
            clean.append(row)

    return clean, excluded


def write_update_sql(path: Path, clean_rows: List[Dict[str, str]]) -> None:
    lines = [
        "-- Apply on the new server after DB restore and after clean files are in place.",
        "-- Updates files.file_path/file_url/project_id/episode_id/source for valid migrated files only.",
        "BEGIN;",
    ]
    for row in clean_rows:
        rel_path = Path("persistent_storage") / row["new_rel_path"]
        lines.append(
            "UPDATE files SET "
            f"file_path = {quote_sql(rel_path.as_posix())}, "
            f"file_url = {quote_sql(row['new_url'])}, "
            f"project_id = COALESCE(project_id, {nullable_sql(row.get('project_id'))}), "
            f"episode_id = COALESCE(episode_id, {nullable_sql(row.get('episode_id'))}), "
            f"source = COALESCE(source, {nullable_sql(row.get('source'))}, 'unknown') "
            f"WHERE file_id = {quote_sql(row['file_id'])};"
        )
    lines.append("COMMIT;")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_exclude_sql(
    path: Path,
    *,
    dirty_ids_list: List[str],
    dirty_urls_list: List[str],
) -> None:
    lines = [
        "-- Apply on the new server after DB restore.",
        "-- Dirty files are not copied by the clean migration package.",
        "-- This SQL soft-deletes their file records and clears common legacy URL fields.",
        "BEGIN;",
    ]

    for ids in chunked(dirty_ids_list):
        values = ", ".join(quote_sql(value) for value in ids)
        lines.append(
            "UPDATE files SET "
            "is_deleted = TRUE, "
            "deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), "
            "metadata = COALESCE(metadata, '{}'::jsonb) || "
            "'{\"migration_excluded\": true, \"migration_reason\": \"not_in_clean_storage_package\"}'::jsonb "
            f"WHERE file_id IN ({values});"
        )
        lines.append(
            "DO $do$ BEGIN "
            "IF to_regclass('public.media_library_items') IS NOT NULL THEN "
            f"UPDATE media_library_items SET is_deleted = TRUE, deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP) "
            f"WHERE file_id IN ({values}); "
            "END IF; END $do$;"
        )

    if dirty_urls_list:
        values_sql = ", ".join(f"({quote_sql(url)})" for url in dirty_urls_list)
        for table, columns in LEGACY_URL_COLUMNS.items():
            for column in columns:
                lines.append(
                    "DO $do$ BEGIN "
                    f"IF to_regclass('public.{table}') IS NOT NULL THEN "
                    f"UPDATE {table} SET {column} = NULL "
                    f"WHERE {column} IN (SELECT url FROM (VALUES {values_sql}) AS dirty_urls(url)); "
                    "END IF; END $do$;"
                )

        lines.append(
            "DO $do$ BEGIN "
            "IF to_regclass('public.assets') IS NOT NULL THEN "
            "UPDATE assets a SET reference_images = COALESCE(("
            "SELECT jsonb_agg(value) FROM jsonb_array_elements_text(a.reference_images) AS value "
            f"WHERE value NOT IN (SELECT url FROM (VALUES {values_sql}) AS dirty_urls(url))"
            "), '[]'::jsonb) "
            "WHERE reference_images IS NOT NULL "
            "AND jsonb_typeof(reference_images) = 'array' "
            f"AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.reference_images) AS value "
            f"WHERE value IN (SELECT url FROM (VALUES {values_sql}) AS dirty_urls(url))); "
            "END IF; END $do$;"
        )

    lines.append("COMMIT;")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def materialize_files(
    clean_rows: List[Dict[str, str]],
    *,
    storage_root: Path,
    package_root: Path,
    mode: str,
) -> Dict[str, int]:
    stats = {"created": 0, "skipped_existing": 0, "errors": 0}
    if mode == "none":
        return stats

    target_root = package_root / "persistent_storage"
    storage_root = storage_root.resolve()
    target_root.mkdir(parents=True, exist_ok=True)

    for row in clean_rows:
        source = storage_root / row["old_rel_path"]
        target = target_root / row["new_rel_path"]
        try:
            source = source.resolve()
            source.relative_to(storage_root)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if target.stat().st_size == source.stat().st_size:
                    stats["skipped_existing"] += 1
                    continue
                raise RuntimeError(f"target exists with different size: {target}")
            if mode == "hardlink":
                os.link(source, target)
            elif mode == "copy":
                shutil.copy2(source, target)
            else:
                raise RuntimeError(f"unsupported materialize mode: {mode}")
            stats["created"] += 1
        except Exception as exc:
            stats["errors"] += 1
            row["materialize_error"] = str(exc)
    return stats


def write_readme(path: Path, summary: Dict[str, Any]) -> None:
    content = f"""# OSTORY Clean Storage Migration Package

Generated at: {summary['generated_at']}

This package intentionally includes only valid referenced media files.
Missing DB references, unowned media, and disk-only orphan files are excluded.

## Counts

- Valid files: {summary['valid_files']}
- Excluded dirty file records: {summary['excluded_file_records']}
- Disk orphan files excluded: {summary['disk_orphans_excluded']}
- Materialize mode: {summary['materialize_mode']}

## New Server Order

1. Restore the application database dump.
2. Copy this package's `persistent_storage/` into the new deploy directory.
3. Run `sql/01_update_valid_file_paths.sql`.
4. Run `sql/02_exclude_dirty_file_records.sql`.
5. Start the application and run smoke tests.

Do not run the SQL files on the old production server unless a rollback plan is prepared.
"""
    path.write_text(content, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a clean storage migration package from audit reports")
    parser.add_argument("--reports-dir", default="storage_audit_reports")
    parser.add_argument("--storage-root", default="persistent_storage")
    parser.add_argument("--output-dir", default="clean_migration_export")
    parser.add_argument(
        "--materialize",
        choices=["none", "hardlink", "copy"],
        default="none",
        help="Create package/persistent_storage tree. hardlink avoids duplicate disk blocks.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    reports_dir = Path(args.reports_dir)
    storage_root = Path(args.storage_root).resolve()
    output_dir = Path(args.output_dir)
    manifests_dir = output_dir / "manifests"
    sql_dir = output_dir / "sql"
    excluded_dir = output_dir / "excluded"
    manifests_dir.mkdir(parents=True, exist_ok=True)
    sql_dir.mkdir(parents=True, exist_ok=True)
    excluded_dir.mkdir(parents=True, exist_ok=True)

    manifest_rows = read_csv(reports_dir / "storage_restructure_manifest.csv")
    missing_rows = read_csv(reports_dir / "missing_files.csv")
    unowned_rows = read_csv(reports_dir / "unowned_files.csv")
    orphan_rows = read_csv(reports_dir / "disk_orphans.csv")

    dirty_ids = dirty_file_ids(missing_rows, unowned_rows)
    clean_rows, excluded_manifest_rows = select_clean_rows(
        manifest_rows,
        storage_root=storage_root,
        dirty_ids=dirty_ids,
    )
    dirty_ids.update(dirty_file_ids(excluded_manifest_rows))

    all_dirty_url_rows = missing_rows + unowned_rows + excluded_manifest_rows
    dirty_url_values = dirty_urls(all_dirty_url_rows)

    clean_csv = manifests_dir / "clean_files_manifest.csv"
    excluded_csv = manifests_dir / "excluded_file_records.csv"
    write_csv(clean_csv, clean_rows, manifest_fields())
    write_csv(excluded_csv, excluded_manifest_rows, manifest_fields() + ["exclude_reason", "materialize_error"])
    write_csv(excluded_dir / "missing_files.csv", missing_rows, list(missing_rows[0].keys()) if missing_rows else [])
    write_csv(excluded_dir / "unowned_files.csv", unowned_rows, list(unowned_rows[0].keys()) if unowned_rows else [])
    write_csv(excluded_dir / "disk_orphans.csv", orphan_rows, list(orphan_rows[0].keys()) if orphan_rows else [])

    write_update_sql(sql_dir / "01_update_valid_file_paths.sql", clean_rows)
    write_exclude_sql(
        sql_dir / "02_exclude_dirty_file_records.sql",
        dirty_ids_list=sorted(dirty_ids),
        dirty_urls_list=dirty_url_values,
    )

    materialize_stats = materialize_files(
        clean_rows,
        storage_root=storage_root,
        package_root=output_dir,
        mode=args.materialize,
    )

    by_type = Counter(row.get("file_type") or "unknown" for row in clean_rows)
    total_bytes = 0
    for row in clean_rows:
        try:
            total_bytes += int(row.get("file_size_bytes") or 0)
        except (TypeError, ValueError):
            pass

    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "reports_dir": str(reports_dir),
        "storage_root": str(storage_root),
        "output_dir": str(output_dir),
        "valid_files": len(clean_rows),
        "valid_bytes_from_db": total_bytes,
        "valid_by_type": dict(by_type),
        "excluded_file_records": len(dirty_ids),
        "excluded_manifest_rows": len(excluded_manifest_rows),
        "missing_files_excluded": len(missing_rows),
        "unowned_files_excluded": len(unowned_rows),
        "disk_orphans_excluded": len(orphan_rows),
        "dirty_urls": len(dirty_url_values),
        "materialize_mode": args.materialize,
        "materialize": materialize_stats,
        "outputs": {
            "clean_manifest": str(clean_csv),
            "excluded_manifest": str(excluded_csv),
            "update_sql": str(sql_dir / "01_update_valid_file_paths.sql"),
            "exclude_sql": str(sql_dir / "02_exclude_dirty_file_records.sql"),
        },
    }
    (output_dir / "migration_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_readme(output_dir / "README.md", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
