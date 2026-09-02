from pathlib import Path

from agent_routes import _extract_node_local_entries
from services.credit_service import compute_cost


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_image_upscale_migration_is_manifested_and_capped_at_fifty():
    sql = (DEPLOY_DIR / "sql/db_migration_image_upscale_credit_rule.sql").read_text(encoding="utf-8")
    manifest = (DEPLOY_DIR / "db_build/manifest.txt").read_text(encoding="utf-8")

    assert "'image_upscale'" in sql
    assert "min_cost, max_cost" in sql
    assert "  50," in sql
    assert "sql/db_migration_image_upscale_credit_rule.sql" in manifest


def test_image_upscale_credit_tiers_and_text_mode_never_exceed_fifty():
    rule = {
        "feature_key": "image_upscale",
        "base_cost": 10,
        "factors": [
            {
                "key": "target_long_edge",
                "type": "range",
                "rules": [
                    {"min": 4096, "max": 4096, "multiplier": 0.8},
                    {"min": 4097, "max": 8192, "multiplier": 1.5},
                    {"min": 8193, "max": 16000, "multiplier": 2.5},
                    {"min": 16001, "max": 32000, "multiplier": 3.8},
                    {"min": 32001, "max": 50000, "multiplier": 5.0},
                ],
            },
            {
                "key": "text_clarity",
                "type": "enum",
                "rules": [{"value": True, "multiplier": 1.1}],
            },
        ],
        "min_cost": 8,
        "max_cost": 50,
    }

    assert [compute_cost(rule, {"target_long_edge": edge}) for edge in (4096, 8192, 16000, 32000, 50000)] == [8, 15, 25, 38, 50]
    assert compute_cost(rule, {"target_long_edge": 50000, "text_clarity": True}) == 50


def test_frontend_exposes_standalone_image_upscale_route_and_controls():
    app = (DEPLOY_DIR / "new_html/App.tsx").read_text(encoding="utf-8")
    layout = (DEPLOY_DIR / "new_html/layouts/WorkflowLayout.tsx").read_text(encoding="utf-8")
    page = (DEPLOY_DIR / "new_html/pages/ImageUpscalePage.tsx").read_text(encoding="utf-8")

    assert 'path="image-upscale"' in app
    assert "label: '图片高清放大'" in layout
    assert "50000" in page
    assert "300 DPI" in page
    assert "文字清晰" in page
    assert "纯图片背景效果通常更稳定" in page
    assert "'image_upscale'" in page
    assert "结果保存在本地节点 7 天" in page
    assert "/ticket" in page


def test_agent_completion_exposes_only_an_authenticated_node_output_url():
    payload = {
        "node_local_files": [
            {
                "node_output_id": "opaque_output_id_123456",
                "filename": "poster_50000px.png",
                "size": 123456789,
                "mime_type": "image/png",
                "created_at": "2026-09-02T00:00:00+00:00",
                "expires_at": "2026-09-09T00:00:00+00:00",
            }
        ]
    }

    entries = _extract_node_local_entries(
        payload,
        task_id="task-upscale",
        task_data={"requested_workflow_type": "image_upscale"},
        agent_id="gpu-agent",
    )

    assert len(entries) == 1
    assert entries[0]["url"] == (
        "/api/node-outputs/task-upscale/opaque_output_id_123456/download"
    )
    assert entries[0]["file_path"] == "agent://gpu-agent/opaque_output_id_123456"
    assert entries[0]["storage"] == "node_local"
    assert "node_local_files" not in payload


def test_agent_completion_rejects_node_outputs_for_other_task_types():
    payload = {
        "node_local_files": [
            {
                "node_output_id": "opaque_output_id_123456",
                "filename": "untrusted.png",
            }
        ]
    }
    assert _extract_node_local_entries(
        payload,
        task_id="task-video",
        task_data={"requested_workflow_type": "i2v"},
        agent_id="gpu-agent",
    ) == []
