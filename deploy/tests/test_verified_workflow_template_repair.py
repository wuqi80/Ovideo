from pathlib import Path

from scripts.repair_verified_workflow_templates import (
    VERIFIED_RECOVERY_SPECS,
    load_verified_workflow,
    workflow_node_count,
)


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_verified_recovery_specs_use_full_disk_workflows() -> None:
    assert VERIFIED_RECOVERY_SPECS["i2i_fj"][1] == 4
    assert VERIFIED_RECOVERY_SPECS["i2i_around"][1] == 4
    assert {
        key for key in VERIFIED_RECOVERY_SPECS if key.startswith("qwenN_")
    } == {f"qwenN_{index}" for index in range(1, 7)}

    for file_name, _maximum_legacy_nodes, _placeholders in VERIFIED_RECOVERY_SPECS.values():
        assert workflow_node_count(load_verified_workflow(file_name)) > 4


def test_workflow_node_count_rejects_empty_and_non_node_json() -> None:
    assert workflow_node_count({}) == 0
    assert workflow_node_count({"meta": {"title": "not a node"}}) == 0
    assert workflow_node_count('{"1":{"class_type":"LoadImage","inputs":{}}}') == 1


def test_container_entrypoint_runs_verified_repair_after_migrations() -> None:
    script = (DEPLOY_DIR / "containers" / "entrypoint.sh").read_text(encoding="utf-8")
    migration_call = script.index("python db_build/build_fresh_db.py")
    repair_call = script.index("python scripts/repair_verified_workflow_templates.py")

    assert migration_call < repair_call
