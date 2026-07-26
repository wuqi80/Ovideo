import json
import sys
from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from scripts.build_workflow_catalog import build_catalog
from services.workflow_template_validation import INVALID_WORKFLOW_MARKER


def _write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def test_build_catalog_prefers_database_and_excludes_invalid_sources(tmp_path):
    backup_dir = tmp_path / "backup"
    active_dir = tmp_path / "active"
    output_dir = tmp_path / "out"
    backup_dir.mkdir()
    active_dir.mkdir()

    backup_workflow = {"1": {"class_type": "LoadImage", "inputs": {"image": "backup"}}}
    active_workflow = {"1": {"class_type": "LoadImage", "inputs": {"image": "active"}}}
    database_workflow = {"1": {"class_type": "LoadImage", "inputs": {"image": "database"}}}
    active_extra = {"1": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}}}
    backup_only = {"1": {"class_type": "KSampler", "inputs": {"seed": 1}}}

    _write_json(backup_dir / "same.json", backup_workflow)
    _write_json(backup_dir / "only_backup.json", backup_only)
    _write_json(backup_dir / "placeholder.json", {"1": {"class_type": "PlaceholderNode"}})
    _write_json(active_dir / "same.json", active_workflow)
    _write_json(active_dir / "active_extra.json", active_extra)
    _write_json(
        active_dir / "marker.json",
        {"1": {"class_type": "KSampler", "inputs": {"prompt": INVALID_WORKFLOW_MARKER}}},
    )
    (active_dir / "empty.json").write_text("{}", encoding="utf-8")

    database_export = tmp_path / "database.json"
    _write_json(
        database_export,
        [
            {
                "workflow_key": "same",
                "workflow_json": database_workflow,
                "enabled": False,
                "version": 7,
                "updated_at": "2026-07-26T12:00:00",
            },
            {
                "workflow_key": "invalid_db",
                "workflow_json": {},
                "enabled": True,
                "version": 1,
                "updated_at": "2026-07-26T12:01:00",
            },
        ],
    )

    selected, excluded = build_catalog(
        backup_dir=backup_dir,
        active_dir=active_dir,
        database_export=database_export,
        output_dir=output_dir,
        file_by_key={
            "same": "same.json",
            "active_extra": "active_extra.json",
            "only_backup": "only_backup.json",
        },
        clean=True,
    )

    assert [item.file_name for item in selected] == [
        "active_extra.json",
        "only_backup.json",
        "same.json",
    ]
    assert json.loads((output_dir / "same.json").read_text(encoding="utf-8")) == database_workflow
    assert json.loads((output_dir / "active_extra.json").read_text(encoding="utf-8")) == active_extra
    assert json.loads((output_dir / "only_backup.json").read_text(encoding="utf-8")) == backup_only
    assert not (output_dir / "empty.json").exists()
    assert not (output_dir / "marker.json").exists()
    assert not (output_dir / "placeholder.json").exists()

    excluded_ids = {(source, identifier) for source, identifier, _reason in excluded}
    assert ("deploy/workflows", "empty.json") in excluded_ids
    assert ("deploy/workflows", "marker.json") in excluded_ids
    assert ("backup-20260701", "placeholder.json") in excluded_ids
    assert ("database", "invalid_db") in excluded_ids
    assert "same.json" in (output_dir / "CATALOG.md").read_text(encoding="utf-8")
