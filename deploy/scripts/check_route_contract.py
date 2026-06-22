#!/usr/bin/env python3
"""Verify MECHA FastAPI route contract after refactor increments.

The script intentionally imports cluster_main without starting uvicorn. Use it
after moving handlers between modules to make sure the public API surface stays
stable and no unexpected duplicate route registrations were introduced.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable


HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
OPENAPI_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}

DEFAULT_EXPECTED_PATHS = 231
DEFAULT_EXPECTED_OPERATIONS = 287

# Known legacy overlap: routers.projects still owns the old project JSON model
# while routers.project_core exposes the newer DAO-backed project model. This is
# high coupling and tracked as a later migration, so the checker allows it but
# reports it.
ALLOWED_DUPLICATES = {
    ("/api/projects/{project_id}", "GET"),
}

EXPECTED_ENDPOINTS = {
    ("/api/login", "POST"): ("routers.auth", "login"),
    ("/api/auth/register", "POST"): ("routers.auth_legacy", "register_user"),
    ("/api/auth/login", "POST"): ("routers.auth_legacy", "login_user"),
    ("/api/user/profile", "GET"): ("routers.auth_legacy", "get_user_profile"),
    ("/api/admin/stats", "GET"): ("routers.admin_compat", "get_admin_stats"),
    ("/api/admin/logs", "GET"): ("routers.admin_compat", "get_admin_logs"),
    ("/api/admin/users/create", "POST"): ("routers.admin_compat", "create_user"),
    ("/api/admin/users/{user_id}", "DELETE"): ("routers.admin_compat", "delete_user"),
    ("/api/video/crop", "POST"): ("routers.video", "crop_video"),
    ("/api/thumbnail", "GET"): ("routers.files", "get_thumbnail"),
    ("/api/upload", "POST"): ("routers.files", "upload_file"),
    ("/api/comfyui/upload", "POST"): ("routers.comfyui_files", "comfyui_upload_proxy"),
    ("/api/admin/users", "GET"): ("admin_routes", "admin_list_users"),
    ("/api/admin/users/{user_id}/permissions", "PUT"): ("admin_routes", "admin_update_permissions"),
    ("/api/admin/api-configs/reload-env", "POST"): ("admin_api_config_routes", "admin_reload_api_env"),
    ("/api/admin/api-configs/{config_id}/test", "POST"): ("admin_api_config_routes", "admin_test_api_config"),
    ("/api/admin/api-configs/test-all", "POST"): ("admin_api_config_routes", "admin_test_all_api_configs"),
    ("/api/admin/api-configs/health/cache", "GET"): ("admin_api_config_routes", "admin_get_provider_health_cache"),
    ("/api/admin/api-configs/health/sweep", "POST"): ("admin_api_config_routes", "admin_sweep_provider_health"),
    (
        "/api/admin/api-configs/repair-conflicts",
        "POST",
    ): ("admin_api_config_routes", "admin_repair_api_config_conflicts"),
    (
        "/api/admin/api-configs/{provider_id}/health",
        "GET",
    ): ("admin_api_config_routes", "admin_check_provider_health"),
    ("/api/prompts/{template_type}", "GET"): ("routers.prompts", "get_prompt_template"),
    ("/api/prompts/{template_type}", "POST"): ("routers.prompts", "save_prompt_template"),
    ("/api/prompts/{template_type}", "DELETE"): ("routers.prompts", "delete_prompt_template"),
    ("/api/cluster/stats", "GET"): ("routers.cluster_status", "get_cluster_stats"),
    ("/api/cluster/nodes", "GET"): ("routers.cluster_status", "list_nodes"),
    ("/health", "GET"): ("routers.cluster_status", "health_check"),
    ("/", "GET"): ("routers.frontend_pages", "root"),
    ("/login", "GET"): ("routers.frontend_pages", "login_page"),
    ("/favicon.ico", "GET"): ("routers.frontend_pages", "favicon"),
    ("/favicon.png", "GET"): ("routers.frontend_pages", "favicon_png"),
    ("/editor", "GET"): ("routers.frontend_pages", "editor_page"),
    ("/materials", "GET"): ("routers.frontend_pages", "materials_page"),
    ("/generation", "GET"): ("routers.frontend_pages", "generation_page"),
    ("/workspace", "GET"): ("routers.frontend_pages", "workspace_page"),
    ("/app", "GET"): ("routers.frontend_pages", "app_page"),
    ("/projects", "GET"): ("routers.frontend_pages", "projects_hub"),
    ("/projects/{path:path}", "GET"): ("routers.frontend_pages", "projects_spa"),
    ("/canvas", "GET"): ("routers.frontend_pages", "canvas_page"),
    ("/canvas/{path:path}", "GET"): ("routers.frontend_pages", "canvas_spa"),
    ("/admin", "GET"): ("routers.frontend_pages", "admin_spa_root"),
    ("/admin/", "GET"): ("routers.frontend_pages", "admin_spa_root"),
    ("/admin/login", "GET"): ("routers.frontend_pages", "admin_spa_named"),
    ("/admin/operations", "GET"): ("routers.frontend_pages", "admin_spa_named"),
    ("/admin/settings", "GET"): ("routers.frontend_pages", "admin_spa_named"),
    ("/admin/login/{path:path}", "GET"): ("routers.frontend_pages", "admin_spa_subpath"),
    ("/admin/operations/{path:path}", "GET"): ("routers.frontend_pages", "admin_spa_subpath"),
    ("/admin/settings/{path:path}", "GET"): ("routers.frontend_pages", "admin_spa_subpath"),
    ("/api/logout", "POST"): ("routers.user_session", "logout"),
    ("/api/user/info", "GET"): ("routers.user_session", "get_user_info"),
    ("/api/me/organizations", "GET"): ("routers.user_session", "list_my_organizations"),
    ("/api/me/organizations/{org_id}/leave", "POST"): ("routers.user_session", "leave_organization"),
    ("/api/workspace/save-task", "POST"): ("routers.workspace", "save_video_task"),
    ("/api/workspace/tasks", "GET"): ("routers.workspace", "get_workspace_tasks"),
    ("/api/workspace/save-session", "POST"): ("routers.workspace", "save_workspace_session"),
    ("/api/workspace/save-beacon", "POST"): ("routers.workspace", "save_workspace_beacon"),
    ("/api/workspace/load-session", "GET"): ("routers.workspace", "load_workspace_session"),
    ("/api/generate", "POST"): ("routers.tasks", "create_generate_task"),
    ("/api/task/{task_id}", "GET"): ("routers.tasks", "get_task_status"),
    ("/api/task/{task_id}", "DELETE"): ("routers.tasks", "cancel_task"),
    ("/api/task/{task_id}/delete", "DELETE"): ("routers.tasks", "delete_task"),
    ("/api/tasks/stream", "GET"): ("routers.tasks", "task_event_stream"),
    ("/api/tasks", "GET"): ("routers.tasks", "list_tasks"),
    ("/api/tasks/recent", "GET"): ("routers.task_notifications", "get_recent_tasks"),
    ("/api/tasks/{task_id}/files", "GET"): ("routers.task_notifications", "get_task_files"),
    ("/api/tasks/active", "GET"): ("routers.task_notifications", "get_active_tasks"),
    ("/api/tasks/notifications", "GET"): ("routers.task_notifications", "get_task_notifications"),
    ("/api/notifications/unread-count", "GET"): (
        "routers.task_notifications",
        "get_unread_notification_count",
    ),
    ("/api/notifications", "GET"): ("routers.task_notifications", "get_notifications"),
    ("/api/notifications/{notification_id}/read", "POST"): (
        "routers.task_notifications",
        "mark_notification_read",
    ),
    ("/api/notifications/read-all", "POST"): ("routers.task_notifications", "mark_all_notifications_read"),
    ("/api/notifications/{notification_id}", "DELETE"): (
        "routers.task_notifications",
        "dismiss_notification",
    ),
    ("/{filename}", "GET"): ("routers.fallback_static", "serve_image_files"),
    ("/{path:path}", "GET"): ("routers.fallback_static", "catch_scanner_requests"),
    ("/api/generate/image", "POST"): ("routers.generation", "generate_image"),
    ("/api/generate/comfyui-workflow", "POST"): ("routers.generation", "generate_comfyui_workflow"),
    ("/api/generate/angle-adjust", "POST"): ("routers.generation", "adjust_image_angle"),
    ("/api/generate/human-multi-angle", "POST"): ("routers.generation", "generate_human_multi_angle"),
    ("/api/generate/around-angle", "POST"): ("routers.generation", "generate_around_angle"),
    ("/api/generate/matting", "POST"): ("routers.generation", "generate_matting"),
    ("/api/generate/image-fusion", "POST"): ("routers.generation", "generate_image_fusion"),
    ("/api/generate/panorama-360", "POST"): ("routers.generation", "generate_panorama_360"),
    ("/api/generate/panorama-fusion", "POST"): ("routers.generation", "generate_panorama_fusion"),
    ("/api/generate/auto-storyboard", "POST"): ("routers.generation", "generate_auto_storyboard"),
    ("/api/generate/multi-grid-storyboard", "POST"): ("routers.generation", "generate_multi_grid_storyboard"),
    ("/api/materials/process", "POST"): ("routers.generation", "process_material"),
    ("/api/projects", "POST"): ("routers.project_core", "create_project"),
    ("/api/projects", "GET"): ("routers.project_core", "get_user_projects"),
    ("/api/projects/save", "POST"): ("routers.projects", "save_project"),
    ("/api/projects/list", "GET"): ("routers.projects", "list_projects"),
    ("/api/projects/{project_id}", "GET"): ("routers.projects", "get_project"),
    ("/api/projects/{project_id}", "DELETE"): ("routers.projects", "delete_project"),
    ("/api/projects/{project_id}/images/{shot_id}", "GET"): ("routers.projects", "get_shot_images"),
    ("/api/projects/{project_id}/export-to-video", "POST"): ("routers.projects", "export_to_video"),
    ("/api/projects/{project_id}/clear-video-tasks", "POST"): ("routers.projects", "clear_video_tasks"),
    ("/api/projects/{project_id}", "PUT"): ("routers.project_admin", "update_project"),
    ("/api/projects/{project_id}/archive", "POST"): ("routers.project_admin", "archive_project"),
    ("/api/projects/{project_id}/unarchive", "POST"): ("routers.project_admin", "unarchive_project"),
    ("/api/projects/{project_id}/members", "GET"): ("routers.project_admin", "get_members"),
    ("/api/projects/{project_id}/members", "POST"): ("routers.project_admin", "add_member"),
    (
        "/api/projects/{project_id}/members/{member_user_id}",
        "PUT",
    ): ("routers.project_admin", "update_member"),
    (
        "/api/projects/{project_id}/members/{member_user_id}",
        "DELETE",
    ): ("routers.project_admin", "remove_member"),
    ("/api/versions", "POST"): ("routers.content_versions", "create_version"),
    ("/api/versions/{version_id}", "GET"): ("routers.content_versions", "get_version_detail"),
    ("/api/versions/{version_id}/restore", "POST"): ("routers.content_versions", "restore_version"),
    ("/api/versions/{version_id}", "DELETE"): ("routers.content_versions", "delete_version"),
    ("/api/texts", "POST"): ("routers.content_versions", "create_text"),
    ("/api/texts/{content_id}", "GET"): ("routers.content_versions", "get_text"),
    ("/api/projects/{project_id}/episodes", "GET"): ("routers.episodes", "list_episodes"),
    ("/api/projects/{project_id}/episodes", "POST"): ("routers.episodes", "create_episode"),
    ("/api/episodes/{episode_id}", "GET"): ("routers.episodes", "get_episode"),
    ("/api/episodes/{episode_id}", "PUT"): ("routers.episodes", "update_episode"),
    ("/api/episodes/{episode_id}", "DELETE"): ("routers.episodes", "delete_episode"),
    ("/api/episodes/{episode_id}/duplicate", "POST"): ("routers.episodes", "duplicate_episode"),
    ("/api/projects/{project_id}/episodes/reorder", "POST"): ("routers.episodes", "reorder_episodes"),
    ("/api/episodes/{episode_id}/video-segments", "GET"): ("routers.episode_video", "get_video_segments"),
    ("/api/episodes/{episode_id}/video-takes", "GET"): ("routers.episode_video", "video_takes_endpoint"),
    ("/api/episodes/{episode_id}/compose", "POST"): ("routers.episode_video", "compose_episode_endpoint"),
    (
        "/api/episodes/{episode_id}/compose/status",
        "GET",
    ): ("routers.episode_video", "compose_status_endpoint"),
    ("/api/episodes/{episode_id}/video-segments", "POST"): ("routers.episode_video", "create_video_segment"),
    ("/api/video-segments/{segment_id}", "PUT"): ("routers.episode_video", "update_video_segment"),
    ("/api/video-segments/{segment_id}", "DELETE"): ("routers.episode_video", "delete_video_segment"),
    ("/api/video/capabilities", "GET"): ("routers.video_capabilities", "video_capabilities"),
    ("/api/episodes/{episode_id}/storyboard-items", "GET"): ("routers.storyboard", "get_storyboard_items"),
    ("/api/episodes/{episode_id}/storyboard-items", "POST"): ("routers.storyboard", "create_storyboard_item"),
    ("/api/storyboard-items/{item_id}", "PUT"): ("routers.storyboard", "update_storyboard_item"),
    ("/api/storyboard-items/{item_id}", "DELETE"): ("routers.storyboard", "delete_storyboard_item"),
    ("/api/episodes/{episode_id}/storyboard-items/all", "DELETE"): (
        "routers.storyboard",
        "delete_all_storyboard_items",
    ),
    ("/api/episodes/{episode_id}/export-script", "POST"): ("routers.storyboard", "export_script"),
    ("/api/episodes/{episode_id}/storyboard-items/reorder", "POST"): (
        "routers.storyboard",
        "reorder_storyboard_items",
    ),
    ("/api/storyboard/mix-audio", "POST"): ("routers.storyboard", "mix_storyboard_audio_endpoint"),
    ("/api/episodes/{episode_id}/storyboard-items/batch", "POST"): (
        "routers.storyboard",
        "batch_create_storyboard_items",
    ),
    ("/api/episodes/{episode_id}/extract-to-assets", "POST"): ("routers.storyboard", "extract_to_assets"),
    ("/api/projects/{project_id}/assets", "GET"): ("routers.assets", "get_assets"),
    ("/api/assets", "POST"): ("routers.assets", "create_asset"),
    ("/api/assets/{asset_id}", "PUT"): ("routers.assets", "update_asset"),
    ("/api/assets/{asset_id}", "DELETE"): ("routers.assets", "delete_asset"),
    ("/api/assets/{asset_id}/share", "POST"): ("routers.assets", "share_asset"),
    ("/api/user-files", "GET"): ("routers.entity_files", "get_user_files"),
    ("/api/entity-files", "GET"): ("routers.entity_files", "get_entity_files"),
    ("/api/entity-files/link", "POST"): ("routers.entity_files", "link_entity_file"),
    ("/api/entity-files/{file_id}/select", "PUT"): ("routers.entity_files", "select_entity_file"),
    ("/api/entity-files/upload", "POST"): ("routers.entity_files", "upload_entity_file"),
    ("/api/entity-files/{file_id}", "DELETE"): ("routers.entity_files", "delete_entity_file"),
    ("/api/entity-files/{file_id}/hard", "DELETE"): ("routers.entity_files", "hard_delete_entity_file"),
    ("/api/entity-files/hard-delete-batch", "POST"): (
        "routers.entity_files",
        "hard_delete_entity_files_batch",
    ),
    ("/api/entity-files/migrate", "POST"): ("routers.entity_files", "run_entity_file_migration"),
    ("/api/files/upload", "POST"): ("routers.legacy_files", "upload_file"),
    ("/api/files/{file_id}/download", "GET"): ("routers.legacy_files", "download_file"),
    ("/api/files/{file_id}", "DELETE"): ("routers.legacy_files", "delete_file"),
    ("/api/episodes/{episode_id}/audio-tracks", "GET"): ("routers.audio", "get_audio_tracks"),
    ("/api/episodes/{episode_id}/audio-tracks", "POST"): ("routers.audio", "create_audio_track"),
    ("/api/audio-tracks/{track_id}", "DELETE"): ("routers.audio", "delete_audio_track"),
    ("/api/audio/generate-speech", "POST"): ("routers.audio", "gen_speech"),
    ("/api/audio/generate-sfx", "POST"): ("routers.audio", "gen_sfx"),
    ("/api/audio/generate-music", "POST"): ("routers.audio", "gen_music"),
    ("/api/minimax/voice-design", "POST"): ("routers.audio", "minimax_voice_design"),
    ("/api/minimax/voice-clone", "POST"): ("routers.audio", "minimax_voice_clone"),
    ("/api/minimax/voices", "GET"): ("routers.audio", "minimax_list_voices"),
    ("/api/minimax/voices/{voice_id}", "GET"): ("routers.audio", "minimax_get_voice"),
    ("/api/minimax/voices/{voice_id}", "DELETE"): ("routers.audio", "minimax_delete_voice"),
    ("/api/minimax/tts", "POST"): ("routers.audio", "minimax_tts"),
    ("/api/minimax/tts/sync", "POST"): ("routers.audio", "minimax_tts_sync"),
    ("/api/minimax/tts/{task_id}", "GET"): ("routers.audio", "minimax_tts_query"),
    ("/api/minimax/music", "POST"): ("routers.audio", "minimax_music"),
    ("/api/minimax/lyrics", "POST"): ("routers.audio", "minimax_lyrics"),
    ("/api/minimax/files/upload", "POST"): ("routers.audio", "minimax_file_upload"),
    ("/api/minimax/files/{file_id}", "GET"): ("routers.audio", "minimax_file_retrieve"),
    ("/api/minimax/files/{file_id}", "DELETE"): ("routers.audio", "minimax_file_delete"),
    ("/api/character-voices", "POST"): ("routers.audio", "create_character_voice"),
    ("/api/projects/{project_id}/character-voices", "GET"): ("routers.audio", "get_character_voices"),
    ("/api/character-voices/{voice_id}", "PUT"): ("routers.audio", "update_character_voice"),
    ("/api/character-voices/{voice_id}", "DELETE"): ("routers.audio", "delete_character_voice"),
    ("/api/episodes/{episode_id}/script-segments", "GET"): ("routers.script_timeline", "list_script_segments"),
    ("/api/episodes/{episode_id}/script-segments/batch", "PUT"): ("routers.script_timeline", "batch_save_script_segments"),
    ("/api/episodes/{episode_id}/script-segments", "DELETE"): ("routers.script_timeline", "delete_script_segments"),
    ("/api/episodes/{episode_id}/script", "GET"): ("routers.script_timeline", "get_script"),
    ("/api/episodes/{episode_id}/script", "PUT"): ("routers.script_timeline", "update_script"),
    ("/api/episodes/{episode_id}/scripts", "GET"): ("routers.script_timeline", "list_scripts"),
    ("/api/episodes/{episode_id}/scripts", "POST"): ("routers.script_timeline", "create_script"),
    ("/api/episodes/{episode_id}/scripts/{script_id}", "PUT"): ("routers.script_timeline", "update_script_by_id"),
    ("/api/episodes/{episode_id}/scripts/{script_id}", "DELETE"): ("routers.script_timeline", "delete_script_by_id"),
    ("/api/episodes/{episode_id}/timeline-tracks", "GET"): ("routers.script_timeline", "get_timeline_tracks"),
    ("/api/episodes/{episode_id}/timeline-tracks", "POST"): ("routers.script_timeline", "create_timeline_track"),
    ("/api/timeline-tracks/{track_id}", "PUT"): ("routers.script_timeline", "update_timeline_track"),
    ("/api/canvas/boards", "POST"): ("routers.canvas", "create_canvas_board"),
    ("/api/canvas/boards", "GET"): ("routers.canvas", "get_canvas_boards"),
    ("/api/canvas/boards/{board_id}", "GET"): ("routers.canvas", "get_canvas_board_detail"),
    ("/api/canvas/boards/{board_id}", "PUT"): ("routers.canvas", "update_canvas_board"),
    ("/api/canvas/boards/{board_id}", "DELETE"): ("routers.canvas", "delete_canvas_board"),
    ("/api/canvas/nodes", "POST"): ("routers.canvas", "create_canvas_node"),
    ("/api/canvas/nodes/{node_id}", "PUT"): ("routers.canvas", "update_canvas_node"),
    ("/api/canvas/nodes/{node_id}", "DELETE"): ("routers.canvas", "delete_canvas_node"),
    ("/api/canvas/connections", "POST"): ("routers.canvas", "create_canvas_connection"),
    ("/api/canvas/connections/{connection_id}", "DELETE"): ("routers.canvas", "delete_canvas_connection"),
}

FORBIDDEN_EXTERNAL_API_FASTAPI_NAMES = {"APIRouter", "FastAPI"}


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def import_app():
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))
    import cluster_main  # noqa: PLC0415

    return cluster_main.app


def openapi_operation_count(schema: dict) -> int:
    return sum(
        1
        for path_item in schema.get("paths", {}).values()
        for method in path_item
        if method in OPENAPI_METHODS
    )


def runtime_routes(app) -> dict[tuple[str, str], list[tuple[int, str | None, str | None]]]:
    routes: dict[tuple[str, str], list[tuple[int, str | None, str | None]]] = defaultdict(list)
    for idx, route in enumerate(app.routes):
        path = getattr(route, "path", None)
        endpoint = getattr(route, "endpoint", None)
        methods = (getattr(route, "methods", set()) or set()) & HTTP_METHODS
        for method in sorted(methods):
            routes[(path, method)].append(
                (
                    idx,
                    getattr(endpoint, "__module__", None),
                    getattr(endpoint, "__name__", None),
                )
            )
    return routes


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def ast_call_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = ast_call_name(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return None


def iter_py_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        yield path


def parse_py_file(path: Path) -> ast.Module:
    try:
        return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except Exception as exc:
        fail(f"Unable to parse {path}: {exc}")


def check_external_api_has_no_fastapi_routes(root: Path) -> tuple[int, int]:
    """external_api is provider/client code only; FastAPI routes live in routers/."""
    external_root = root / "external_api"
    if not external_root.exists():
        fail("external_api directory is missing")

    checked_files = 0
    violations: list[str] = []
    for path in iter_py_files(external_root):
        checked_files += 1
        tree = parse_py_file(path)
        rel = path.relative_to(root)

        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "fastapi":
                imported = {alias.name for alias in node.names}
                forbidden = sorted(imported & FORBIDDEN_EXTERNAL_API_FASTAPI_NAMES)
                if forbidden:
                    violations.append(f"{rel}:{node.lineno} imports {forbidden}")

            if isinstance(node, ast.Call):
                name = ast_call_name(node.func)
                if name in FORBIDDEN_EXTERNAL_API_FASTAPI_NAMES:
                    violations.append(f"{rel}:{node.lineno} constructs {name}")

            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for decorator in node.decorator_list:
                    target = decorator.func if isinstance(decorator, ast.Call) else decorator
                    name = ast_call_name(target)
                    if not name:
                        continue
                    owner, _, method = name.rpartition(".")
                    if owner in {"app", "router"} and method.lower() in OPENAPI_METHODS:
                        violations.append(f"{rel}:{decorator.lineno} route decorator @{name}")

    if violations:
        fail("external_api must not register FastAPI routes:\n" + "\n".join(violations))
    return checked_files, 0


def check_counts(schema: dict, expected_paths: int, expected_operations: int) -> tuple[int, int]:
    path_count = len(schema.get("paths", {}))
    operation_count = openapi_operation_count(schema)
    if path_count != expected_paths:
        fail(f"OpenAPI path count changed: expected {expected_paths}, got {path_count}")
    if operation_count != expected_operations:
        fail(f"OpenAPI operation count changed: expected {expected_operations}, got {operation_count}")
    return path_count, operation_count


def check_duplicates(routes: dict[tuple[str, str], list[tuple[int, str | None, str | None]]]) -> list[tuple[str, str]]:
    duplicates = sorted(key for key, items in routes.items() if len(items) > 1)
    unexpected = [key for key in duplicates if key not in ALLOWED_DUPLICATES]
    if unexpected:
        details = []
        for key in unexpected:
            details.append(f"{key}: {routes[key]}")
        fail("Unexpected duplicate route registrations:\n" + "\n".join(details))
    return duplicates


def check_fallback_static_route_order(routes: dict[tuple[str, str], list[tuple[int, str | None, str | None]]]) -> None:
    catch_all = routes.get(("/{path:path}", "GET"))
    if not catch_all:
        fail("Missing final fallback route /{path:path}")

    last_http_route_index = max(idx for entries in routes.values() for idx, _, _ in entries)
    catch_all_index = catch_all[0][0]
    if catch_all_index != last_http_route_index:
        fail(
            "Final fallback route /{path:path} must be the last HTTP route; "
            f"found index {catch_all_index}, last index {last_http_route_index}"
        )


def check_expected_endpoints(routes: dict[tuple[str, str], list[tuple[int, str | None, str | None]]]) -> None:
    for key, expected in EXPECTED_ENDPOINTS.items():
        found = routes.get(key, [])
        if key in ALLOWED_DUPLICATES:
            candidates = [(module, name) for _, module, name in found]
            if expected not in candidates:
                fail(f"{key} should include endpoint {expected}, found {found}")
            continue
        if len(found) != 1:
            fail(f"{key} should be registered exactly once, found {found}")
        _, module, name = found[0]
        if (module, name) != expected:
            fail(f"{key} endpoint changed: expected {expected}, got {(module, name)}")


def check_api_routes_is_assembly_only(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    api_tree = parse_py_file(api_routes_path)
    handlers: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call:
                continue
            name = ast_call_name(call.func)
            owner, _, method = name.rpartition(".") if name else ("", "", "")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                handlers.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if handlers:
        fail("api_routes.py should only assemble routers; direct route handlers remain:\n" + "\n".join(handlers))
    return 0


def check_admin_api_config_routes_extracted(root: Path) -> int:
    admin_routes_path = root / "admin_routes.py"
    api_config_routes_path = root / "admin_api_config_routes.py"
    if not api_config_routes_path.exists():
        fail("admin_api_config_routes.py is missing")

    admin_tree = parse_py_file(admin_routes_path)
    violations: list[str] = []
    for node in ast.walk(admin_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and "/api-configs" in arg.value:
                violations.append(f"{admin_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("API config route handlers must live in admin_api_config_routes.py:\n" + "\n".join(violations))

    api_tree = parse_py_file(api_config_routes_path)
    route_count = 0
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count < 10:
        fail(f"admin_api_config_routes.py should own the API config route set, found {route_count}")

    api_text = api_config_routes_path.read_text(encoding="utf-8")
    required_snippets = [
        "targets: Optional[List[Dict[str, Optional[str]]]] = None",
        "targets=body.targets",
        "async def admin_check_provider_health(provider_id: str, model_name: Optional[str] = None)",
        "check_provider_health(provider_id, model_name=model_name)",
        "async def _record_api_config_audit(",
        "api_key_changed",
        "custom_proxy_changed",
        "planned_action_types",
        'action="api_config_create"',
        'action="api_config_update"',
        'action="api_config_delete"',
        'action="api_config_import_presets"',
        'action="api_config_reload_env"',
        'action="api_config_repair_conflicts"',
    ]
    for snippet in required_snippets:
        if snippet not in api_text:
            fail(f"Missing admin API config route contract snippet: {snippet}")
        route_count += 1
    return route_count


def check_cluster_main_has_no_direct_http_routes(root: Path) -> None:
    cluster_main_path = root / "cluster_main.py"
    removed_api_router_path = root / "api_router.py"
    if removed_api_router_path.exists():
        fail("api_router.py SmartApiRouter dead code should stay deleted; use services.ai_proxy_service and provider runtime registry")

    cluster_text = cluster_main_path.read_text(encoding="utf-8")
    for forbidden in ("set_api_router_redis", "from api_router import"):
        if forbidden in cluster_text:
            fail(f"cluster_main.py must not inject the removed SmartApiRouter: {forbidden}")
    for forbidden in (
        "import requests",
        "from requests import",
        "requests.",
        "aiohttp.ClientSession",
        "import httpx",
        "httpx.",
    ):
        if forbidden in cluster_text:
            fail(f"cluster_main.py should only compose services/routers and must not perform direct HTTP transport: {forbidden}")

    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    legacy_reference_names = {"get_admin_users", "update_user_permissions"}
    shared_helper_names = {
        "_storage_path_safe",
        "data_url_to_base64",
        "parse_jsonb_field",
        "to_doubao_image_input",
    }

    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name in legacy_reference_names:
            violations.append(f"{cluster_main_path.name}:{node.lineno} legacy reference function {node.name}")
        if node.name in shared_helper_names:
            violations.append(f"{cluster_main_path.name}:{node.lineno} shared helper should live outside cluster_main.py: {node.name}")
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "app" and method.lower() in OPENAPI_METHODS:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} direct route decorator @{name}")

    if violations:
        fail("cluster_main.py should only compose routers, not own direct HTTP routes or legacy admin references:\n" + "\n".join(violations))


def check_prompt_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    prompt_routes_path = root / "routers" / "prompts.py"
    prompt_service_path = root / "services" / "prompt_service.py"
    if not prompt_routes_path.exists():
        fail("routers/prompts.py is missing")
    if not prompt_service_path.exists():
        fail("services/prompt_service.py is missing")

    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and "/api/prompts" in arg.value:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Prompt route handlers must live in routers/prompts.py:\n" + "\n".join(violations))

    prompt_tree = parse_py_file(prompt_routes_path)
    route_count = 0
    for node in ast.walk(prompt_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 3:
        fail(f"routers/prompts.py should own 3 prompt route handlers, found {route_count}")

    router_text = prompt_routes_path.read_text(encoding="utf-8")
    service_text = prompt_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.prompt_service import (", prompt_routes_path),
        (router_text, "get_prompt_template_service(username, template_type)", prompt_routes_path),
        (router_text, "save_prompt_template_service(username, template_type, request.content)", prompt_routes_path),
        (router_text, "delete_prompt_template_service(username, template_type)", prompt_routes_path),
        (service_text, "DEFAULT_PROMPTS", prompt_service_path),
        (service_text, "from dao_content import PromptTemplateDAO", prompt_service_path),
        (service_text, "prompt_template_dao.load_template", prompt_service_path),
        (service_text, "prompt_template_dao.save_template", prompt_service_path),
        (service_text, "prompt_template_dao.delete_template", prompt_service_path),
        (service_text, "提示词模板已保存", prompt_service_path),
    ]
    forbidden_snippets = [
        (router_text, "from dao_content import PromptTemplateDAO", prompt_routes_path),
        (router_text, "PromptTemplateDAO.", prompt_routes_path),
        (router_text, "DEFAULT_PROMPTS = {", prompt_routes_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing prompt service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Prompt router must delegate DAO/default prompt logic to service: {path.relative_to(root)} {snippet}")
    return route_count


def check_cluster_status_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    cluster_status_path = root / "routers" / "cluster_status.py"
    if not cluster_status_path.exists():
        fail("routers/cluster_status.py is missing")

    route_paths = {"/api/cluster/stats", "/api/cluster/nodes", "/health"}
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Cluster status route handlers must live in routers/cluster_status.py:\n" + "\n".join(violations))

    status_tree = parse_py_file(cluster_status_path)
    route_count = 0
    for node in ast.walk(status_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 3:
        fail(f"routers/cluster_status.py should own 3 cluster status route handlers, found {route_count}")
    return route_count


def check_frontend_pages_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    frontend_pages_path = root / "routers" / "frontend_pages.py"
    if not frontend_pages_path.exists():
        fail("routers/frontend_pages.py is missing")

    route_paths = {
        "/",
        "/login",
        "/favicon.ico",
        "/favicon.png",
        "/editor",
        "/materials",
        "/generation",
        "/workspace",
        "/app",
        "/projects",
        "/projects/{path:path}",
        "/canvas",
        "/canvas/{path:path}",
        "/admin",
        "/admin/",
        "/admin/login",
        "/admin/operations",
        "/admin/settings",
        "/admin/login/{path:path}",
        "/admin/operations/{path:path}",
        "/admin/settings/{path:path}",
    }
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Frontend page route handlers must live in routers/frontend_pages.py:\n" + "\n".join(violations))

    frontend_tree = parse_py_file(frontend_pages_path)
    route_count = 0
    for node in ast.walk(frontend_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 21:
        fail(f"routers/frontend_pages.py should own 21 frontend route registrations, found {route_count}")
    return route_count


def check_user_session_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    user_session_path = root / "routers" / "user_session.py"
    if not user_session_path.exists():
        fail("routers/user_session.py is missing")

    route_paths = {
        "/api/logout",
        "/api/user/info",
        "/api/me/organizations",
        "/api/me/organizations/{org_id}/leave",
    }
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("User session route handlers must live in routers/user_session.py:\n" + "\n".join(violations))

    user_session_tree = parse_py_file(user_session_path)
    route_count = 0
    for node in ast.walk(user_session_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 4:
        fail(f"routers/user_session.py should own 4 user session route registrations, found {route_count}")
    return route_count


def check_workspace_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    workspace_path = root / "routers" / "workspace.py"
    if not workspace_path.exists():
        fail("routers/workspace.py is missing")

    route_paths = {
        "/api/workspace/save-task",
        "/api/workspace/tasks",
        "/api/workspace/save-session",
        "/api/workspace/save-beacon",
        "/api/workspace/load-session",
    }
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Workspace route handlers must live in routers/workspace.py:\n" + "\n".join(violations))

    workspace_tree = parse_py_file(workspace_path)
    route_count = 0
    for node in ast.walk(workspace_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 5:
        fail(f"routers/workspace.py should own 5 workspace route registrations, found {route_count}")
    return route_count


def check_task_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    tasks_path = root / "routers" / "tasks.py"
    if not tasks_path.exists():
        fail("routers/tasks.py is missing")

    route_paths = {
        "/api/generate",
        "/api/task/{task_id}",
        "/api/task/{task_id}/delete",
        "/api/tasks/stream",
        "/api/tasks",
    }
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Task route handlers must live in routers/tasks.py:\n" + "\n".join(violations))

    tasks_tree = parse_py_file(tasks_path)
    route_count = 0
    for node in ast.walk(tasks_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 6:
        fail(f"routers/tasks.py should own 6 task route registrations, found {route_count}")
    return route_count


def check_task_notification_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    task_notifications_path = root / "routers" / "task_notifications.py"
    if not task_notifications_path.exists():
        fail("routers/task_notifications.py is missing")

    route_paths = {
        "/api/tasks/recent",
        "/api/tasks/{task_id}/files",
        "/api/tasks/active",
        "/api/tasks/notifications",
        "/api/notifications/unread-count",
        "/api/notifications",
        "/api/notifications/{notification_id}/read",
        "/api/notifications/read-all",
        "/api/notifications/{notification_id}",
    }
    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Task/notification route handlers must live in routers/task_notifications.py:\n" + "\n".join(violations))

    task_notifications_tree = parse_py_file(task_notifications_path)
    route_count = 0
    for node in ast.walk(task_notifications_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 9:
        fail(f"routers/task_notifications.py should own 9 task/notification route registrations, found {route_count}")
    return route_count


def check_task_stale_cleanup_notification_contract(root: Path) -> int:
    """Auto-cleaned stale tasks must not create a recent notification burst."""
    task_dao_path = root / "dao" / "business" / "task.py"
    task_dao_text = task_dao_path.read_text(encoding="utf-8")

    marker = "Auto-cleanup: stale task exceeded timeout"
    if "async def cleanup_stale(hours: int = 24, limit: int = 50)" not in task_dao_text:
        fail("TaskDAO.cleanup_stale must keep a bounded batch limit")
    if "LIMIT $2" not in task_dao_text:
        fail("TaskDAO.cleanup_stale must update stale tasks in bounded batches")
    if "completed_at = NOW()" in task_dao_text:
        fail("TaskDAO.cleanup_stale must not stamp stale tasks as recently completed")
    if "completed_at = COALESCE(started_at, created_at)" not in task_dao_text:
        fail("TaskDAO.cleanup_stale must preserve old completion time for auto-cleaned stale tasks")
    if marker not in task_dao_text:
        fail("TaskDAO notification lookup must filter auto-cleaned stale task failures")
    return 2


def check_task_notification_toast_dedupe_contract(root: Path) -> int:
    """Global toast polling must not replay historical terminal tasks as new failures."""
    manager_text = (root / "new_html" / "services" / "globalTaskManager.ts").read_text(encoding="utf-8")
    context_text = (root / "new_html" / "contexts" / "TaskContext.tsx").read_text(encoding="utf-8")
    test_text = (root / "new_html" / "__tests__" / "services" / "globalTaskManager.test.ts").read_text(encoding="utf-8")
    toast_text = (root / "new_html" / "components" / "GlobalToast.tsx").read_text(encoding="utf-8")
    toast_test_text = (root / "new_html" / "__tests__" / "components" / "GlobalToast.test.tsx").read_text(encoding="utf-8")

    required_snippets = {
        "notificationBaselineReady": "global task manager tracks notification baseline",
        "const since = this.lastPollTime || pollStartedAt": "initial poll uses a timestamp baseline, not undefined",
        "!isBaselinePoll": "baseline poll does not emit toast notifications",
        "rememberNotificationId": "transport-level task notification id dedupe",
        "seenNotificationIdsRef": "TaskContext unread count dedupes notification events",
        "FAILURE_BURST_INDIVIDUAL_LIMIT": "GlobalToast folds failure bursts instead of rendering every failed task",
        "failure-burst-": "GlobalToast uses a synthetic id for folded failure bursts",
        "does not toast historical failures": "unit test covers historical failure burst",
        "emits only new notification ids": "unit test covers duplicate terminal task suppression",
        "folds failed notification bursts": "unit test covers failure burst folding",
    }
    sources = "\n".join([manager_text, context_text, test_text, toast_text, toast_test_text])
    missing = [
        f"{label}: missing {snippet}"
        for snippet, label in required_snippets.items()
        if snippet not in sources
    ]
    if missing:
        fail("Task notification toast dedupe contract failed:\n" + "\n".join(missing))
    return len(required_snippets)


def check_lifespan_shutdown_contract(root: Path) -> int:
    """Lifespan background workers must shut down without a long 502 window."""
    cluster_main_text = (root / "cluster_main.py").read_text(encoding="utf-8")
    required_snippets = {
        "process_signal_handlers": "original process signal handler capture",
        "loop_signal_handlers": "original event loop signal handler capture",
        "_restore_process_signal_handlers": "process signal handler restore",
        "add_signal_handler": "event loop signal handler restore",
        "_suppress_worker_signal_registration": "worker signal override suppression",
        "guarded_signal": "worker signal override guard",
        "_create_background_task": "background task tracking helper",
        "_create_worker_task": "worker task tracking helper",
        "BACKGROUND_TASK_SHUTDOWN_TIMEOUT_SECONDS": "bounded background task shutdown",
        "WORKER_STOP_TIMEOUT_SECONDS": "bounded Worker.stop shutdown",
        "WORKER_TASK_CANCEL_TIMEOUT_SECONDS": "bounded worker task cancellation",
        "workers.clear()": "worker registry cleanup",
    }
    missing = [
        f"{label}: missing {snippet}"
        for snippet, label in required_snippets.items()
        if snippet not in cluster_main_text
    ]
    if missing:
        fail("cluster_main lifespan shutdown contract failed:\n" + "\n".join(missing))
    return len(required_snippets)


def check_storyboard_paged_reload_contract(root: Path) -> int:
    """Storyboard workflow should keep large episodes paged after mutations."""
    page_text = (root / "new_html" / "pages" / "StoryboardGenPage.tsx").read_text(encoding="utf-8")
    episode_data_text = (root / "new_html" / "services" / "episodeDataService.ts").read_text(encoding="utf-8")
    context_text = (root / "new_html" / "contexts" / "EpisodeContext.tsx").read_text(encoding="utf-8")
    workspace_text = (root / "new_html" / "WorkspaceApp.tsx").read_text(encoding="utf-8")
    hook_text = (root / "new_html" / "hooks" / "useEpisodeData.ts").read_text(encoding="utf-8")
    video_page_text = (root / "new_html" / "pages" / "VideoGenPage.tsx").read_text(encoding="utf-8")
    episode_data_test_text = (root / "new_html" / "__tests__" / "services" / "episodeDataService.test.ts").read_text(encoding="utf-8")
    context_test_text = (
        root / "new_html" / "__tests__" / "contexts" / "EpisodeContext.test.tsx"
    ).read_text(encoding="utf-8")
    router_text = (root / "routers" / "storyboard.py").read_text(encoding="utf-8")
    storyboard_service_text = (root / "services" / "storyboard_service.py").read_text(encoding="utf-8")
    router_test_text = (
        root / "tests" / "test_storyboard_stale_script_fallback.py"
    ).read_text(encoding="utf-8")
    forbidden_snippets = [
        "forceReloadSlices('storyboardItems')",
        'forceReloadSlices("storyboardItems")',
        "reload();",
    ]
    forbidden = [snippet for snippet in forbidden_snippets if snippet in page_text]
    if forbidden:
        fail(
            "StoryboardGenPage must not force full storyboard reloads after mutations:\n"
            + "\n".join(forbidden)
        )
    unbounded_sources = {
        "WorkspaceApp": (
            workspace_text,
            [
                "getStoryboardItems(propEpisodeId).catch",
                "getStoryboardItems(propEpisodeId, initialStoryboardScriptId).catch",
            ],
        ),
        "EpisodeContext": (
            context_text,
            [
                "getStoryboardItems(episodeId, sid).catch",
            ],
        ),
        "useEpisodeData": (
            hook_text,
            [
                "getStoryboardItems(episodeId!)",
            ],
        ),
    }
    unbounded = [
        f"{name}: {snippet}"
        for name, (text, snippets) in unbounded_sources.items()
        for snippet in snippets
        if snippet in text
    ]
    if unbounded:
        fail(
            "Storyboard shared loaders must keep storyboard requests bounded:\n"
            + "\n".join(unbounded)
        )
    required_snippets = [
        (page_text, "reloadVisibleStoryboardPage", "paged post-mutation reload helper"),
        (page_text, "loadStoryboardItemsPage({ limit: visibleEntityShotCount", "current-page storyboard reload"),
        (workspace_text, "WORKSPACE_INITIAL_STORYBOARD_COUNT = 10", "legacy workspace initial storyboard limit"),
        (workspace_text, "limit: WORKSPACE_INITIAL_STORYBOARD_COUNT", "legacy workspace bounded storyboard preload"),
        (workspace_text, "handleWorkspaceVisibleShotCountChange", "legacy workspace load-more bridge"),
        (workspace_text, "onVisibleShotCountChange={handleWorkspaceVisibleShotCountChange}", "legacy workspace GenerationPage load-more callback"),
        (context_text, "EPISODE_CONTEXT_INITIAL_STORYBOARD_COUNT = 10", "episode context initial storyboard limit"),
        (context_text, "limit: EPISODE_CONTEXT_INITIAL_STORYBOARD_COUNT", "episode context bounded storyboard slice"),
        (hook_text, "STORYBOARD_QUERY_INITIAL_LIMIT = 10", "legacy storyboard query hook bounded limit"),
        (video_page_text, "getStoryboardItems(episodeId, selectedScriptId || undefined, { fields: 'video' })", "video import uses lightweight storyboard fields"),
        (episode_data_text, "fallbackToEpisode", "storyboard stale script fallback option"),
        (episode_data_text, "function normalizeStoryboardFallbackResult(", "storyboard backend fallback metadata normalizer"),
        (episode_data_text, "result.fallbackScriptId ?? result.fallback_script_id", "storyboard fallback script id supports snake case"),
        (episode_data_text, "fallbackReason: 'empty_script_storyboard'", "storyboard stale script fallback marker"),
        (episode_data_test_text, "falls back to episode storyboard when selected script has no rows", "storyboard fallback unit test"),
        (episode_data_test_text, "normalizes backend storyboard fallback metadata", "storyboard backend fallback metadata unit test"),
        (context_text, "clearStaleScriptSelectionFromStoryboardFallback", "storyboard context clears stale script fallback"),
        (context_text, "res?.fallbackScriptId ?? res?.fallback_script_id", "storyboard context supports snake fallback metadata"),
        (context_text, "const previousScriptId = prevScriptIdRef.current", "storyboard context tracks previous script selection"),
        (context_text, "if (previousScriptId === selectedScriptId) return", "storyboard context reloads first real script selection"),
        (context_text, "void fetchSlices({ quiet: true }, ...slicesToReload)", "storyboard context quietly reloads script-scoped slices"),
        (context_test_text, "clears stale script selection when storyboard falls back to episode scope", "storyboard stale script context unit test"),
        (context_test_text, "reloads script scoped slices on first script selection", "storyboard first script selection reload test"),
        (context_test_text, "reloads loaded script scoped slices after stale storyboard fallback clears selection", "storyboard fallback clears and reloads script-scoped slices test"),
        (storyboard_service_text, "episode_script_dao.get_by_id(script_id)", "storyboard backend stale script ownership check"),
        (storyboard_service_text, 'fallback_reason = "stale_script_storyboard"', "storyboard backend stale script fallback marker"),
        (storyboard_service_text, 'payload["fallback_scope"] = "episode"', "storyboard backend fallback scope marker"),
        (router_test_text, "test_storyboard_items_fallback_for_stale_script_id", "storyboard backend stale script fallback test"),
        (router_test_text, "test_storyboard_items_do_not_fallback_for_valid_empty_script", "storyboard backend valid empty script test"),
        (page_text, "import { runWhenIdle } from '../utils/idleScheduler';", "StoryboardGenPage uses shared idle scheduler"),
        (page_text, "cancelIdle = runWhenIdle(run, { timeout: 1500 })", "StoryboardGenPage idle asset preload can be cancelled"),
        (video_page_text, "import { runWhenIdle } from '../utils/idleScheduler';", "VideoGenPage uses shared idle scheduler"),
        (video_page_text, "return runWhenIdle(loadSupportSlices, { timeout: 1500 })", "VideoGenPage idle support slice preload can be cancelled"),
    ]
    missing = [f"{label}: missing {snippet}" for text, snippet, label in required_snippets if snippet not in text]
    if missing:
        fail("StoryboardGenPage paged reload contract failed:\n" + "\n".join(missing))
    return len(required_snippets)


def check_enhance_lightweight_storyboard_contract(root: Path) -> int:
    """Enhance workflow should not fetch full storyboard rows just to build audio clips."""
    page_text = (root / "new_html" / "pages" / "EnhancePage.tsx").read_text(encoding="utf-8")
    episode_data_text = (root / "new_html" / "services" / "episodeDataService.ts").read_text(encoding="utf-8")
    router_text = (root / "routers" / "storyboard.py").read_text(encoding="utf-8")
    dao_text = (root / "dao" / "creative" / "storyboard.py").read_text(encoding="utf-8")

    forbidden_snippets = [
        "loadSlices('videoSegments', 'storyboardItems')",
        'loadSlices("videoSegments", "storyboardItems")',
    ]
    forbidden = [snippet for snippet in forbidden_snippets if snippet in page_text]
    if forbidden:
        fail("EnhancePage must not load full storyboard rows on mount:\n" + "\n".join(forbidden))

    required_snippets = {
        "fields: 'audio'": "EnhancePage lightweight audio field query",
        "params.set('fields'": "episodeDataService storyboard fields query option",
        "fields: Optional[str]": "storyboard route fields query parameter",
        "fields=selected_fields": "storyboard route passes selected fields to DAO",
        '"audio": (': "StoryboardDAO audio field set",
    }
    sources = "\n".join([page_text, episode_data_text, router_text, dao_text])
    missing = [
        f"{label}: missing {snippet}"
        for snippet, label in required_snippets.items()
        if snippet not in sources
    ]
    if missing:
        fail("Enhance lightweight storyboard contract failed:\n" + "\n".join(missing))
    return len(required_snippets)


def check_generation_lightweight_storyboard_contract(root: Path) -> int:
    """Video generation workflow should keep storyboard metadata and image rendering bounded."""
    page_text = (root / "new_html" / "pages" / "GenerationPage.tsx").read_text(encoding="utf-8")
    router_text = (root / "routers" / "storyboard.py").read_text(encoding="utf-8")
    dao_text = (root / "dao" / "creative" / "storyboard.py").read_text(encoding="utf-8")

    forbidden_snippets = [
        "loadSlices('storyboardItems'",
        'loadSlices("storyboardItems"',
        "getStoryboardItems(episodeId, selectedScriptId || undefined, { fields: 'video' })",
    ]
    forbidden = [snippet for snippet in forbidden_snippets if snippet in page_text]
    if forbidden:
        fail("GenerationPage must not load full storyboard rows on mount:\n" + "\n".join(forbidden))

    required_snippets = {
        "fields: 'video'": "GenerationPage lightweight video field query",
        "limit: fetchLimit": "GenerationPage bounded video field query",
        "includeTotal: true": "GenerationPage total-aware video field query",
        "storyboardVideoTotalCount": "GenerationPage tracks backend storyboard total",
        "storyboardScopeRef": "GenerationPage resets bounded query by episode/script scope",
        "GENERATION_INITIAL_STORYBOARD_COUNT = 10": "bounded initial storyboard card render",
        "visibleStoryboardItems": "visible storyboard card list",
        "loading=\"lazy\"": "lazy storyboard image loading",
        "decoding=\"async\"": "async storyboard image decoding",
        '{"audio", "video", "audio_stage", "materials"}': "storyboard route allows only known lightweight field sets",
        '"video": (': "StoryboardDAO video field set",
    }
    sources = "\n".join([page_text, router_text, dao_text])
    missing = [
        f"{label}: missing {snippet}"
        for snippet, label in required_snippets.items()
        if snippet not in sources
    ]
    if missing:
        fail("Generation lightweight storyboard contract failed:\n" + "\n".join(missing))
    return len(required_snippets)


def check_audio_stage_lightweight_storyboard_contract(root: Path) -> int:
    """Audio workflow should use lightweight storyboard rows and bounded dubbing-card rendering."""
    page_text = (root / "new_html" / "pages" / "AudioStagePage.tsx").read_text(encoding="utf-8")
    panel_text = (root / "new_html" / "components" / "audio" / "DubbingPanel.tsx").read_text(encoding="utf-8")
    router_text = (root / "routers" / "storyboard.py").read_text(encoding="utf-8")
    dao_text = (root / "dao" / "creative" / "storyboard.py").read_text(encoding="utf-8")

    forbidden_snippets = [
        "forceReloadSlices('storyboardItems'",
        'forceReloadSlices("storyboardItems"',
        "loadSlices('storyboardItems'",
        'loadSlices("storyboardItems"',
    ]
    forbidden = [snippet for snippet in forbidden_snippets if snippet in page_text]
    if forbidden:
        fail("AudioStagePage must not reload full storyboard rows:\n" + "\n".join(forbidden))

    required_snippets = {
        "fields: 'audio_stage'": "AudioStagePage lightweight audio-stage field query",
        "AUDIO_STAGE_STORYBOARD_INITIAL_LOAD_LIMIT = 20": "AudioStagePage bounded initial audio-stage field request",
        "AUDIO_STAGE_STORYBOARD_BACKGROUND_PAGE_SIZE = 80": "AudioStagePage background audio-stage field page size",
        "includeTotal: true": "AudioStagePage total-aware initial audio-stage field query",
        "offset: nextOffset": "AudioStagePage background paged audio-stage field query",
        "loadRemainingAudioStageStoryboardPages": "AudioStagePage idle background storyboard completion",
        "waitForIdle()": "AudioStagePage shared idle background paging",
        "normalizeAudioStageStoryboardItem": "AudioStagePage audio-stage normalizer",
        "updateAudioStageStoryboardItem": "AudioStagePage local patch helper",
        "forceReloadSlices('assets', 'characterVoices', 'script', 'audioTracks')": "AudioStagePage non-storyboard force refresh",
        "DUBBING_INITIAL_ITEM_COUNT = 20": "bounded initial dubbing card render",
        "visibleStoryboardItems": "visible dubbing card list",
        "revealAndScrollToItem": "timeline jump reveals hidden dubbing cards",
        '{"audio", "video", "audio_stage", "materials"}': "storyboard route allows audio-stage field set",
        '"audio_stage": (': "StoryboardDAO audio-stage field set",
    }
    sources = "\n".join([page_text, panel_text, router_text, dao_text])
    missing = [
        f"{label}: missing {snippet}"
        for snippet, label in required_snippets.items()
        if snippet not in sources
    ]
    if missing:
        fail("Audio-stage lightweight storyboard contract failed:\n" + "\n".join(missing))
    return len(required_snippets)


def check_materials_lightweight_storyboard_contract(root: Path) -> int:
    """Material binding workflow should not load or render the whole storyboard up front."""
    page_text = (root / "new_html" / "pages" / "MaterialsPage.tsx").read_text(encoding="utf-8")
    panel_text = (root / "new_html" / "components" / "MaterialPage.tsx").read_text(encoding="utf-8")
    router_text = (root / "routers" / "storyboard.py").read_text(encoding="utf-8")
    dao_text = (root / "dao" / "creative" / "storyboard.py").read_text(encoding="utf-8")

    forbidden_snippets = [
        "forceReloadSlices('storyboardItems'",
        'forceReloadSlices("storyboardItems"',
        "loadSlices('storyboardItems'",
        'loadSlices("storyboardItems"',
        "saveStoryboardItem",
        "reload()",
    ]
    forbidden = [snippet for snippet in forbidden_snippets if snippet in page_text]
    if forbidden:
        fail("MaterialsPage must not reload full storyboard rows:\n" + "\n".join(forbidden))

    required_snippets = {
        "fields: 'materials'": "MaterialsPage lightweight material field query",
        "MATERIALS_STORYBOARD_INITIAL_LOAD_LIMIT = 20": "MaterialsPage bounded initial material field request",
        "MATERIALS_STORYBOARD_BACKGROUND_PAGE_SIZE = 80": "MaterialsPage background material field page size",
        "includeTotal: true": "MaterialsPage total-aware initial material field query",
        "offset: nextOffset": "MaterialsPage background paged material field query",
        "loadRemainingMaterialsStoryboardPages": "MaterialsPage idle background storyboard completion",
        "waitForIdle()": "MaterialsPage shared idle background paging",
        "normalizeMaterialsStoryboardItem": "MaterialsPage material normalizer",
        "updateMaterialsStoryboardItem": "MaterialsPage local patch helper",
        "forceReloadSlices('assets', 'script')": "MaterialsPage non-storyboard force refresh",
        "MATERIAL_INITIAL_SHOT_COUNT = 20": "bounded initial material shot render",
        "visibleStoryboardItems": "visible material shot list",
        "加载更多镜头": "material shot manual reveal control",
        '{"audio", "video", "audio_stage", "materials"}': "storyboard route allows material field set",
        '"materials": (': "StoryboardDAO material field set",
    }
    sources = "\n".join([page_text, panel_text, router_text, dao_text])
    missing = [
        f"{label}: missing {snippet}"
        for snippet, label in required_snippets.items()
        if snippet not in sources
    ]
    if missing:
        fail("Materials lightweight storyboard contract failed:\n" + "\n".join(missing))
    return len(required_snippets)


def check_fallback_static_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    fallback_static_path = root / "routers" / "fallback_static.py"
    if not fallback_static_path.exists():
        fail("routers/fallback_static.py is missing")

    route_paths = {"/{filename}", "/{path:path}"}
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Fallback/static route handlers must live in routers/fallback_static.py:\n" + "\n".join(violations))

    fallback_tree = parse_py_file(fallback_static_path)
    route_count = 0
    for node in ast.walk(fallback_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 2:
        fail(f"routers/fallback_static.py should own 2 fallback route registrations, found {route_count}")
    return route_count


def check_generation_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    generation_path = root / "routers" / "generation.py"
    if not generation_path.exists():
        fail("routers/generation.py is missing")

    route_paths = {
        "/api/generate/image",
        "/api/generate/comfyui-workflow",
        "/api/generate/angle-adjust",
        "/api/generate/human-multi-angle",
        "/api/generate/around-angle",
        "/api/generate/matting",
        "/api/generate/image-fusion",
        "/api/generate/panorama-360",
        "/api/generate/panorama-fusion",
        "/api/generate/auto-storyboard",
        "/api/generate/multi-grid-storyboard",
        "/api/materials/process",
    }
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Generation route handlers must live in routers/generation.py:\n" + "\n".join(violations))

    generation_tree = parse_py_file(generation_path)
    route_count = 0
    for node in ast.walk(generation_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 12:
        fail(f"routers/generation.py should own 12 generation route registrations, found {route_count}")
    return route_count


def check_auth_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    auth_path = root / "routers" / "auth.py"
    auth_user_service_path = root / "services" / "auth_user_service.py"
    if not auth_path.exists():
        fail("routers/auth.py is missing")
    if not auth_user_service_path.exists():
        fail("services/auth_user_service.py is missing")

    cluster_text = cluster_main_path.read_text(encoding="utf-8")
    auth_text = auth_path.read_text(encoding="utf-8")
    auth_user_service_text = auth_user_service_path.read_text(encoding="utf-8")
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and arg.value == "/api/login":
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Auth route handlers must live in routers/auth.py:\n" + "\n".join(violations))

    auth_tree = parse_py_file(auth_path)
    route_count = 0
    for node in ast.walk(auth_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 1:
        fail(f"routers/auth.py should own 1 auth route registration, found {route_count}")

    service_snippets = [
        "async def verify_database_credentials",
        "async def ensure_login_user_record",
        "async def ensure_authenticated_user_record",
        "from dao_user import UserDAO",
    ]
    for snippet in service_snippets:
        if snippet not in auth_user_service_text:
            fail(f"Missing auth user service snippet: {snippet}")

    purity_violations = []
    for snippet in ["get_db_manager", "db_manager"]:
        if snippet in auth_text:
            purity_violations.append(f"routers/auth.py still depends on DB plumbing: {snippet}")
    if re.search(r"create_auth_router\([\s\S]{0,400}get_db_manager\s*=", cluster_text):
        purity_violations.append("cluster_main.py still passes DB plumbing into create_auth_router")
    if purity_violations:
        fail("Auth router purity contract failed:\n" + "\n".join(purity_violations))

    return route_count + len(service_snippets) + 3


def check_auth_legacy_routes_extracted(root: Path) -> int:
    auth_legacy_path = root / "routers" / "auth_legacy.py"
    if not auth_legacy_path.exists():
        fail("routers/auth_legacy.py is missing")

    auth_legacy_tree = parse_py_file(auth_legacy_path)
    route_count = 0
    for node in ast.walk(auth_legacy_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 3:
        fail(f"routers/auth_legacy.py should own 3 legacy auth route registrations, found {route_count}")
    return route_count


def check_password_minimum_contract(root: Path) -> int:
    """New password entry points must enforce at least 8 characters."""
    required_snippets = [
        (root / "admin_routes.py", "password: str = Field(..., min_length=8)"),
        (root / "admin_routes.py", "new_password: str = Field(..., min_length=8)"),
        (root / "admin_routes.py", "len(body.new_password) < 8"),
        (root / "routers" / "auth_legacy.py", "len(user_data.password) < 8"),
        (root / "routers" / "admin_compat.py", "len(str(password)) < 8"),
        (root / "cluster_main.py", "def _load_builtin_users() -> dict[str, str]:"),
        (root / "cluster_main.py", 'os.getenv("ADMIN_PASSWORD")'),
        (root / "cluster_main.py", 'if _env_bool("ALLOW_DEV_ADMIN_PASSWORD", False):'),
        (root / "cluster_main.py", "len(admin_password) < 8"),
        (root / "cluster_main.py", "Built-in admin login disabled because ADMIN_PASSWORD is not configured"),
    ]
    for path, snippet in required_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing password minimum contract snippet in {path.relative_to(root)}: {snippet}")

    forbidden_snippets = [
        "min_length=4",
        "min_length: 4",
        "len(body.new_password) < 4",
    ]
    for path in [
        root / "admin_routes.py",
        root / "routers" / "auth_legacy.py",
        root / "routers" / "admin_compat.py",
        root / "schemas" / "auth.py",
        root / "cluster_main.py",
    ]:
        text = path.read_text(encoding="utf-8")
        for snippet in forbidden_snippets:
            if snippet in text:
                fail(f"Forbidden password minimum contract snippet in {path.relative_to(root)}: {snippet}")
    cluster_main_text = (root / "cluster_main.py").read_text(encoding="utf-8")
    for snippet in [
        "os.getenv('ADMIN_PASSWORD', 'admin123')",
        'os.getenv("ADMIN_PASSWORD", "admin123")',
        "os.environ.get('ADMIN_PASSWORD', 'admin123')",
        'os.environ.get("ADMIN_PASSWORD", "admin123")',
    ]:
        if snippet in cluster_main_text:
            fail(f"Forbidden built-in admin default password in cluster_main.py: {snippet}")
    return len(required_snippets)


def check_cors_allowlist_contract(root: Path) -> int:
    """CORS defaults must be explicit allowlists, not wildcard credentials."""
    required_snippets = [
        (root / "cluster_config.py", 'DEFAULT_CORS_ALLOW_ORIGINS = ('),
        (root / "cluster_config.py", '"https://mecha.one,"'),
        (root / "cluster_config.py", 'def parse_cors_allow_origins(value: str | None = None) -> list[str]:'),
        (root / "cluster_config.py", 'os.getenv("CORS_ALLOW_ORIGINS", DEFAULT_CORS_ALLOW_ORIGINS)'),
        (root / "cluster_config.py", "ALLOW_ORIGINS = parse_cors_allow_origins()"),
        (root / "config.py", 'DEFAULT_CORS_ALLOW_ORIGINS = ('),
        (root / "config.py", '"https://mecha.one,"'),
        (root / "config.py", "ALLOW_ORIGINS = parse_cors_allow_origins()"),
        (root / "cluster_config_generated.py", 'DEFAULT_CORS_ALLOW_ORIGINS = ('),
        (root / "cluster_config_generated.py", '"https://mecha.one,"'),
        (root / "cluster_config_generated.py", "ALLOW_ORIGINS = parse_cors_allow_origins()"),
        (root / "auto_deploy_cluster.py", 'DEFAULT_CORS_ALLOW_ORIGINS = ('),
        (root / "auto_deploy_cluster.py", '"https://mecha.one,"'),
        (root / "auto_deploy_cluster.py", "ALLOW_ORIGINS = parse_cors_allow_origins()"),
        (root / "cluster_main.py", "allow_origins=SystemConfig.ALLOW_ORIGINS"),
    ]
    checks = 0
    for path, snippet in required_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing CORS allowlist contract snippet in {path.relative_to(root)}: {snippet}")
        checks += 1

    forbidden_snippets = [
        'ALLOW_ORIGINS = ["*"]',
        "ALLOW_ORIGINS = ['*']",
        'allow_origins=["*"]',
        "allow_origins=['*']",
    ]
    for path in [
        root / "cluster_config.py",
        root / "config.py",
        root / "cluster_config_generated.py",
        root / "auto_deploy_cluster.py",
        root / "cluster_main.py",
    ]:
        text = path.read_text(encoding="utf-8")
        for snippet in forbidden_snippets:
            if snippet in text:
                fail(f"Forbidden wildcard CORS snippet in {path.relative_to(root)}: {snippet}")
            checks += 1
    return checks


def check_admin_compat_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    admin_compat_path = root / "routers" / "admin_compat.py"
    if not admin_compat_path.exists():
        fail("routers/admin_compat.py is missing")
    cluster_text = cluster_main_path.read_text(encoding="utf-8")
    admin_compat_text = admin_compat_path.read_text(encoding="utf-8")

    route_paths = {
        "/api/admin/stats",
        "/api/admin/logs",
        "/api/admin/users/create",
        "/api/admin/users/{user_id}",
    }
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Admin compatibility route handlers must live in routers/admin_compat.py:\n" + "\n".join(violations))

    compat_tree = parse_py_file(admin_compat_path)
    route_count = 0
    for node in ast.walk(compat_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 4:
        fail(f"routers/admin_compat.py should own 4 admin compatibility route registrations, found {route_count}")

    purity_violations = []
    for snippet in ["get_db_manager", "db_manager"]:
        if snippet in admin_compat_text:
            purity_violations.append(f"routers/admin_compat.py still depends on DB plumbing: {snippet}")
    if re.search(r"create_admin_compat_router\([\s\S]{0,400}get_db_manager\s*=", cluster_text):
        purity_violations.append("cluster_main.py still passes DB plumbing into create_admin_compat_router")
    if purity_violations:
        fail("Admin compatibility router purity contract failed:\n" + "\n".join(purity_violations))

    return route_count + 3


def check_project_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    projects_path = root / "routers" / "projects.py"
    if not projects_path.exists():
        fail("routers/projects.py is missing")

    route_paths = {
        "/api/projects/save",
        "/api/projects/list",
        "/api/projects/{project_id}",
        "/api/projects/{project_id}/images/{shot_id}",
        "/api/projects/{project_id}/export-to-video",
        "/api/projects/{project_id}/clear-video-tasks",
    }
    cluster_tree = parse_py_file(cluster_main_path)
    violations: list[str] = []
    for node in ast.walk(cluster_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{cluster_main_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Project route handlers must live in routers/projects.py:\n" + "\n".join(violations))

    projects_tree = parse_py_file(projects_path)
    route_count = 0
    for node in ast.walk(projects_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 7:
        fail(f"routers/projects.py should own 7 project route registrations, found {route_count}")
    return route_count


def check_project_core_routes_extracted(root: Path) -> int:
    project_core_path = root / "routers" / "project_core.py"
    project_core_service_path = root / "services" / "project_core_service.py"
    if not project_core_path.exists():
        fail("routers/project_core.py is missing")
    if not project_core_service_path.exists():
        fail("services/project_core_service.py is missing")

    project_core_tree = parse_py_file(project_core_path)
    route_count = 0
    for node in ast.walk(project_core_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 3:
        fail(f"routers/project_core.py should own 3 DAO project route registrations, found {route_count}")

    router_text = project_core_path.read_text(encoding="utf-8")
    service_text = project_core_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.project_core_service import (", project_core_path),
        (router_text, "create_project_service(", project_core_path),
        (router_text, "list_user_projects_service(", project_core_path),
        (router_text, "get_project_detail_service(", project_core_path),
        (router_text, "organization_member_dao: Any", project_core_path),
        (service_text, "project_dao.create_project(", project_core_service_path),
        (service_text, "version_dao.create_version(", project_core_service_path),
        (service_text, "project_member_dao.add_member(", project_core_service_path),
        (service_text, "activity_log_dao.log_activity(", project_core_service_path),
        (service_text, "organization_member_dao.is_member(", project_core_service_path),
        (service_text, "project_member_dao.get_org_accessible_projects(", project_core_service_path),
        (service_text, "project_member_dao.get_user_accessible_projects(", project_core_service_path),
        (service_text, "project_dao.get_project(", project_core_service_path),
        (service_text, "project_member_dao.check_permission(", project_core_service_path),
        (service_text, "user_dao.is_admin_user(", project_core_service_path),
        (service_text, "project_dao.update_project_access(", project_core_service_path),
        (service_text, "version_dao.get_project_versions(", project_core_service_path),
        (service_text, "project_member_dao.get_project_members(", project_core_service_path),
        (root / "api_routes.py", "from dao_organization import OrganizationMemberDAO", root / "api_routes.py"),
        (root / "api_routes.py", "organization_member_dao=OrganizationMemberDAO", root / "api_routes.py"),
    ]
    forbidden_snippets = [
        (router_text, "ProjectDAO.create_project(", project_core_path),
        (router_text, "VersionDAO.create_version(", project_core_path),
        (router_text, "ProjectMemberDAO.add_member(", project_core_path),
        (router_text, "ActivityLogDAO.log_activity(", project_core_path),
        (router_text, "OrganizationMemberDAO.is_member(", project_core_path),
        (router_text, "ProjectMemberDAO.get_org_accessible_projects(", project_core_path),
        (router_text, "ProjectMemberDAO.get_user_accessible_projects(", project_core_path),
        (router_text, "ProjectDAO.get_project(", project_core_path),
        (router_text, "ProjectMemberDAO.check_permission(", project_core_path),
        (router_text, "UserDAO.is_admin_user(", project_core_path),
        (router_text, "ProjectDAO.update_project_access(", project_core_path),
        (router_text, "VersionDAO.get_project_versions(", project_core_path),
        (router_text, "ProjectMemberDAO.get_project_members(", project_core_path),
        (router_text, "from dao_organization import", project_core_path),
    ]
    for text_or_path, snippet, path in required_snippets:
        text = text_or_path.read_text(encoding="utf-8") if isinstance(text_or_path, Path) else text_or_path
        if snippet not in text:
            fail(f"Missing project core service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Project core router must delegate DAO orchestration to service: {path.relative_to(root)} {snippet}")
    return route_count + len(required_snippets)


def check_project_admin_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    project_admin_path = root / "routers" / "project_admin.py"
    project_admin_service_path = root / "services" / "project_admin_service.py"
    if not project_admin_path.exists():
        fail("routers/project_admin.py is missing")
    if not project_admin_service_path.exists():
        fail("services/project_admin_service.py is missing")

    route_pairs = {
        ("/api/projects/{project_id}", "put"),
        ("/api/projects/{project_id}/archive", "post"),
        ("/api/projects/{project_id}/unarchive", "post"),
        ("/api/projects/{project_id}/members", "get"),
        ("/api/projects/{project_id}/members", "post"),
        ("/api/projects/{project_id}/members/{member_user_id}", "put"),
        ("/api/projects/{project_id}/members/{member_user_id}", "delete"),
    }
    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            target = call.func
            name = ast_call_name(target)
            _, _, method = name.rpartition(".") if name else ("", "", "")
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and (arg.value, method.lower()) in route_pairs
            ):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Project admin route handlers must live in routers/project_admin.py:\n" + "\n".join(violations))

    project_admin_tree = parse_py_file(project_admin_path)
    route_count = 0
    for node in ast.walk(project_admin_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 7:
        fail(f"routers/project_admin.py should own 7 project admin route registrations, found {route_count}")

    router_text = project_admin_path.read_text(encoding="utf-8")
    service_text = project_admin_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.project_admin_service import (", project_admin_path),
        (router_text, "update_project_service(", project_admin_path),
        (router_text, "archive_project_service(", project_admin_path),
        (router_text, "unarchive_project_service(", project_admin_path),
        (router_text, "list_members_service(", project_admin_path),
        (router_text, "add_member_service(", project_admin_path),
        (router_text, "update_member_service(", project_admin_path),
        (router_text, "remove_member_service(", project_admin_path),
        (service_text, "project_member_dao.check_permission(", project_admin_service_path),
        (service_text, "project_dao.update_project_metadata(", project_admin_service_path),
        (service_text, "project_dao.archive_project(", project_admin_service_path),
        (service_text, "project_dao.unarchive_project(", project_admin_service_path),
        (service_text, "project_member_dao.get_project_members(", project_admin_service_path),
        (service_text, "user_dao.get_user_by_id(", project_admin_service_path),
        (service_text, "project_member_dao.add_member(", project_admin_service_path),
        (service_text, "project_member_dao.update_member_role(", project_admin_service_path),
        (service_text, "project_member_dao.update_member_responsibility(", project_admin_service_path),
        (service_text, "project_member_dao.get_member(", project_admin_service_path),
        (service_text, "project_member_dao.remove_member(", project_admin_service_path),
    ]
    forbidden_snippets = [
        (router_text, "ProjectMemberDAO.check_permission(", project_admin_path),
        (router_text, "ProjectDAO.update_project_metadata(", project_admin_path),
        (router_text, "ProjectDAO.archive_project(", project_admin_path),
        (router_text, "ProjectDAO.unarchive_project(", project_admin_path),
        (router_text, "ProjectMemberDAO.get_project_members(", project_admin_path),
        (router_text, "UserDAO.get_user_by_id(", project_admin_path),
        (router_text, "ProjectMemberDAO.add_member(", project_admin_path),
        (router_text, "ProjectMemberDAO.update_member_role(", project_admin_path),
        (router_text, "ProjectMemberDAO.update_member_responsibility(", project_admin_path),
        (router_text, "ProjectMemberDAO.get_member(", project_admin_path),
        (router_text, "ProjectMemberDAO.remove_member(", project_admin_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing project admin service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Project admin router must delegate DAO orchestration to service: {path.relative_to(root)} {snippet}")
    return route_count + len(required_snippets)


def check_content_version_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    content_versions_path = root / "routers" / "content_versions.py"
    content_version_service_path = root / "services" / "content_version_service.py"
    if not content_versions_path.exists():
        fail("routers/content_versions.py is missing")
    if not content_version_service_path.exists():
        fail("services/content_version_service.py is missing")

    route_pairs = {
        ("/api/versions", "post"),
        ("/api/versions/{version_id}", "get"),
        ("/api/versions/{version_id}/restore", "post"),
        ("/api/versions/{version_id}", "delete"),
        ("/api/texts", "post"),
        ("/api/texts/{content_id}", "get"),
    }
    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            name = ast_call_name(call.func)
            _, _, method = name.rpartition(".") if name else ("", "", "")
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and (arg.value, method.lower()) in route_pairs
            ):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Version/text route handlers must live in routers/content_versions.py:\n" + "\n".join(violations))

    content_tree = parse_py_file(content_versions_path)
    route_count = 0
    for node in ast.walk(content_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 6:
        fail(f"routers/content_versions.py should own 6 version/text route registrations, found {route_count}")

    router_text = content_versions_path.read_text(encoding="utf-8")
    service_text = content_version_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.content_version_service import (", content_versions_path),
        (router_text, "create_version_service(", content_versions_path),
        (router_text, "get_version_detail_service(", content_versions_path),
        (router_text, "restore_version_service(", content_versions_path),
        (router_text, "delete_version_service(", content_versions_path),
        (router_text, "create_text_service(", content_versions_path),
        (router_text, "get_text_service(", content_versions_path),
        (service_text, "project_dao.get_project(", content_version_service_path),
        (service_text, "version_dao.get_current_version(", content_version_service_path),
        (service_text, "version_dao.create_version(", content_version_service_path),
        (service_text, "activity_log_dao.log_activity(", content_version_service_path),
        (service_text, "file_dao.get_version_files(", content_version_service_path),
        (service_text, "text_content_dao.get_version_texts(", content_version_service_path),
        (service_text, "text_content_dao.create_text_content(", content_version_service_path),
    ]
    forbidden_snippets = [
        (router_text, "ProjectDAO.get_project(", content_versions_path),
        (router_text, "VersionDAO.get_current_version(", content_versions_path),
        (router_text, "VersionDAO.create_version(", content_versions_path),
        (router_text, "VersionDAO.get_version(", content_versions_path),
        (router_text, "VersionDAO.set_current_version(", content_versions_path),
        (router_text, "VersionDAO.delete_version(", content_versions_path),
        (router_text, "FileDAO.get_version_files(", content_versions_path),
        (router_text, "TextContentDAO.get_version_texts(", content_versions_path),
        (router_text, "TextContentDAO.create_text_content(", content_versions_path),
        (router_text, "TextContentDAO.get_text_content(", content_versions_path),
        (router_text, "ActivityLogDAO.log_activity(", content_versions_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing content version service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Content version router must delegate DAO orchestration to service: {path.relative_to(root)} {snippet}")
    return route_count + len(required_snippets)


def check_episode_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    episodes_path = root / "routers" / "episodes.py"
    episode_service_path = root / "services" / "episode_service.py"
    if not episodes_path.exists():
        fail("routers/episodes.py is missing")
    if not episode_service_path.exists():
        fail("services/episode_service.py is missing")

    route_pairs = {
        ("/api/projects/{project_id}/episodes", "get"),
        ("/api/projects/{project_id}/episodes", "post"),
        ("/api/episodes/{episode_id}", "get"),
        ("/api/episodes/{episode_id}", "put"),
        ("/api/episodes/{episode_id}", "delete"),
        ("/api/episodes/{episode_id}/duplicate", "post"),
        ("/api/projects/{project_id}/episodes/reorder", "post"),
    }
    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            name = ast_call_name(call.func)
            _, _, method = name.rpartition(".") if name else ("", "", "")
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and (arg.value, method.lower()) in route_pairs
            ):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Episode route handlers must live in routers/episodes.py:\n" + "\n".join(violations))

    episodes_tree = parse_py_file(episodes_path)
    route_count = 0
    for node in ast.walk(episodes_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 7:
        fail(f"routers/episodes.py should own 7 episode route registrations, found {route_count}")

    router_text = episodes_path.read_text(encoding="utf-8")
    service_text = episode_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.episode_service import (", episodes_path),
        (router_text, "list_episodes_service(project_id, episode_dao=EpisodeDAO)", episodes_path),
        (router_text, "create_episode_service(", episodes_path),
        (router_text, "get_episode_service(", episodes_path),
        (router_text, "update_episode_service(", episodes_path),
        (router_text, "delete_episode_service(", episodes_path),
        (router_text, "duplicate_episode_service(", episodes_path),
        (router_text, "reorder_episodes_service(", episodes_path),
        (service_text, "episode_dao.get_episodes(", episode_service_path),
        (service_text, "episode_dao.get_next_episode_number(", episode_service_path),
        (service_text, "episode_dao.create_episode(", episode_service_path),
        (service_text, "episode_dao.get_episode(", episode_service_path),
        (service_text, "episode_script_dao.list_by_episode(", episode_service_path),
        (service_text, "episode_script_dao.create(", episode_service_path),
        (service_text, "episode_dao.reorder_episodes(", episode_service_path),
    ]
    forbidden_snippets = [
        (router_text, "EpisodeDAO.get_episodes(", episodes_path),
        (router_text, "EpisodeDAO.get_next_episode_number(", episodes_path),
        (router_text, "EpisodeDAO.create_episode(", episodes_path),
        (router_text, "EpisodeDAO.get_episode(", episodes_path),
        (router_text, "EpisodeDAO.update_episode(", episodes_path),
        (router_text, "EpisodeDAO.delete_episode(", episodes_path),
        (router_text, "EpisodeDAO.reorder_episodes(", episodes_path),
        (router_text, "EpisodeScriptDAO.list_by_episode(", episodes_path),
        (router_text, "EpisodeScriptDAO.create(", episodes_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing episode service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Episode router must delegate DAO orchestration to service: {path.relative_to(root)} {snippet}")
    return route_count + len(required_snippets)


def check_episode_video_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    episode_video_path = root / "routers" / "episode_video.py"
    episode_video_service_path = root / "services" / "episode_video_service.py"
    if not episode_video_path.exists():
        fail("routers/episode_video.py is missing")
    if not episode_video_service_path.exists():
        fail("services/episode_video_service.py is missing")

    route_pairs = {
        ("/api/episodes/{episode_id}/video-segments", "get"),
        ("/api/episodes/{episode_id}/video-takes", "get"),
        ("/api/episodes/{episode_id}/compose", "post"),
        ("/api/episodes/{episode_id}/compose/status", "get"),
        ("/api/episodes/{episode_id}/video-segments", "post"),
        ("/api/video-segments/{segment_id}", "put"),
        ("/api/video-segments/{segment_id}", "delete"),
    }
    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            name = ast_call_name(call.func)
            _, _, method = name.rpartition(".") if name else ("", "", "")
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and (arg.value, method.lower()) in route_pairs
            ):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Episode video route handlers must live in routers/episode_video.py:\n" + "\n".join(violations))

    episode_video_tree = parse_py_file(episode_video_path)
    route_count = 0
    for node in ast.walk(episode_video_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 7:
        fail(f"routers/episode_video.py should own 7 episode video route registrations, found {route_count}")

    router_text = episode_video_path.read_text(encoding="utf-8")
    service_text = episode_video_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.episode_video_service import (", episode_video_path),
        (router_text, "return await list_video_segments(episode_id, video_segment_dao=VideoSegmentDAO)", episode_video_path),
        (router_text, "return await get_video_takes(episode_id)", episode_video_path),
        (router_text, "start_episode_compose(", episode_video_path),
        (router_text, "create_video_segment_service(", episode_video_path),
        (router_text, "update_video_segment_service(", episode_video_path),
        (router_text, "delete_video_segment_service(", episode_video_path),
        (service_text, "from services import episode_compose_service", episode_video_service_path),
        (service_text, "video_segment_dao.get_by_episode(", episode_video_service_path),
        (service_text, "episode_dao.get_project_id(", episode_video_service_path),
        (service_text, "compose_service.start_compose(", episode_video_service_path),
    ]
    forbidden_snippets = [
        (router_text, "from services import episode_compose_service", episode_video_path),
        (router_text, "episode_compose_service.", episode_video_path),
        (router_text, "VideoSegmentDAO.get_by_episode(", episode_video_path),
        (router_text, "VideoSegmentDAO.create(", episode_video_path),
        (router_text, "VideoSegmentDAO.update(", episode_video_path),
        (router_text, "VideoSegmentDAO.delete(", episode_video_path),
        (router_text, "EpisodeDAO.get_project_id(", episode_video_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing episode video service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Episode video router must delegate DAO/compose logic to service: {path.relative_to(root)} {snippet}")
    return route_count


def check_video_capabilities_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    video_capabilities_path = root / "routers" / "video_capabilities.py"
    video_capability_service_path = root / "services" / "video_capability_service.py"
    if not video_capabilities_path.exists():
        fail("routers/video_capabilities.py is missing")
    if not video_capability_service_path.exists():
        fail("services/video_capability_service.py is missing")

    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and arg.value == "/api/video/capabilities":
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Video capability route handlers must live in routers/video_capabilities.py:\n" + "\n".join(violations))

    video_capabilities_tree = parse_py_file(video_capabilities_path)
    route_count = 0
    for node in ast.walk(video_capabilities_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 1:
        fail(f"routers/video_capabilities.py should own 1 video capability route registration, found {route_count}")

    router_text = video_capabilities_path.read_text(encoding="utf-8")
    service_text = video_capability_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.video_capability_service import get_video_capabilities", video_capabilities_path),
        (router_text, "return await get_video_capabilities()", video_capabilities_path),
        (service_text, 'resolve_seedance_model_name("standard")', video_capability_service_path),
        (service_text, "AgentDAO.get_online_agents()", video_capability_service_path),
    ]
    forbidden_snippets = [
        (router_text, "from dao_agent import AgentDAO", video_capabilities_path),
        (router_text, "AgentDAO.get_online_agents()", video_capabilities_path),
        (router_text, "resolve_seedance_model_name", video_capabilities_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing video capability service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Video capability router must delegate business checks to service: {path.relative_to(root)} {snippet}")
    return route_count


def check_storyboard_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    storyboard_path = root / "routers" / "storyboard.py"
    storyboard_service_path = root / "services" / "storyboard_service.py"
    if not storyboard_path.exists():
        fail("routers/storyboard.py is missing")
    if not storyboard_service_path.exists():
        fail("services/storyboard_service.py is missing")

    route_pairs = {
        ("/api/episodes/{episode_id}/storyboard-items", "get"),
        ("/api/episodes/{episode_id}/storyboard-items", "post"),
        ("/api/storyboard-items/{item_id}", "put"),
        ("/api/storyboard-items/{item_id}", "delete"),
        ("/api/episodes/{episode_id}/storyboard-items/all", "delete"),
        ("/api/episodes/{episode_id}/export-script", "post"),
        ("/api/episodes/{episode_id}/storyboard-items/reorder", "post"),
        ("/api/storyboard/mix-audio", "post"),
        ("/api/episodes/{episode_id}/storyboard-items/batch", "post"),
        ("/api/episodes/{episode_id}/extract-to-assets", "post"),
    }

    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            name = ast_call_name(call.func)
            _, _, method = name.rpartition(".") if name else ("", "", "")
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and (arg.value, method.lower()) in route_pairs
            ):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Storyboard route handlers must live in routers/storyboard.py:\n" + "\n".join(violations))

    storyboard_tree = parse_py_file(storyboard_path)
    route_count = 0
    for node in ast.walk(storyboard_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 10:
        fail(f"routers/storyboard.py should own 10 storyboard route registrations, found {route_count}")

    router_text = storyboard_path.read_text(encoding="utf-8")
    service_text = storyboard_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.storyboard_service import (", storyboard_path),
        (router_text, "get_storyboard_items_service(", storyboard_path),
        (router_text, "create_storyboard_item_service(", storyboard_path),
        (router_text, "update_storyboard_item_service(", storyboard_path),
        (router_text, "delete_storyboard_item_service(", storyboard_path),
        (router_text, "delete_all_storyboard_items_service(", storyboard_path),
        (router_text, "export_script_service(", storyboard_path),
        (router_text, "reorder_storyboard_items_service(", storyboard_path),
        (router_text, "mix_storyboard_audio_service(", storyboard_path),
        (router_text, "batch_create_storyboard_items_service(", storyboard_path),
        (router_text, "extract_to_assets_service(", storyboard_path),
        (service_text, "storyboard_dao.get_by_episode(", storyboard_service_path),
        (service_text, "storyboard_dao.count_by_episode(", storyboard_service_path),
        (service_text, "episode_script_dao.get_by_id(script_id)", storyboard_service_path),
        (service_text, "episode_script_dao.list_by_episode(", storyboard_service_path),
        (service_text, "storyboard_dao.create(", storyboard_service_path),
        (service_text, "storyboard_dao.update(", storyboard_service_path),
        (service_text, "storyboard_dao.delete(", storyboard_service_path),
        (service_text, "storyboard_dao.delete_by_episode(", storyboard_service_path),
        (service_text, "storyboard_dao.export_script_transaction(", storyboard_service_path),
        (service_text, "storyboard_dao.reorder(", storyboard_service_path),
        (service_text, "storyboard_dao.batch_create(", storyboard_service_path),
        (service_text, "episode_dao.get_episode(", storyboard_service_path),
        (service_text, "asset_dao.get_by_project(", storyboard_service_path),
        (service_text, "asset_dao.create(", storyboard_service_path),
    ]
    forbidden_snippets = [
        (router_text, "StoryboardDAO.get_by_episode(", storyboard_path),
        (router_text, "StoryboardDAO.count_by_episode(", storyboard_path),
        (router_text, "StoryboardDAO.create(", storyboard_path),
        (router_text, "StoryboardDAO.update(", storyboard_path),
        (router_text, "StoryboardDAO.delete(", storyboard_path),
        (router_text, "StoryboardDAO.delete_by_episode(", storyboard_path),
        (router_text, "StoryboardDAO.export_script_transaction(", storyboard_path),
        (router_text, "StoryboardDAO.reorder(", storyboard_path),
        (router_text, "StoryboardDAO.batch_create(", storyboard_path),
        (router_text, "EpisodeScriptDAO.get_by_id(", storyboard_path),
        (router_text, "EpisodeScriptDAO.list_by_episode(", storyboard_path),
        (router_text, "AssetDAO.get_by_project(", storyboard_path),
        (router_text, "AssetDAO.create(", storyboard_path),
        (router_text, "EpisodeDAO.get_episode(", storyboard_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing storyboard service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Storyboard router must delegate DAO orchestration to service: {path.relative_to(root)} {snippet}")
    return route_count + len(required_snippets)


def check_asset_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    assets_path = root / "routers" / "assets.py"
    asset_service_path = root / "services" / "asset_service.py"
    if not assets_path.exists():
        fail("routers/assets.py is missing")
    if not asset_service_path.exists():
        fail("services/asset_service.py is missing")

    route_pairs = {
        ("/api/projects/{project_id}/assets", "get"),
        ("/api/assets", "post"),
        ("/api/assets/{asset_id}", "put"),
        ("/api/assets/{asset_id}", "delete"),
        ("/api/assets/{asset_id}/share", "post"),
    }

    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            name = ast_call_name(call.func)
            _, _, method = name.rpartition(".") if name else ("", "", "")
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and (arg.value, method.lower()) in route_pairs
            ):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Asset route handlers must live in routers/assets.py:\n" + "\n".join(violations))

    assets_tree = parse_py_file(assets_path)
    route_count = 0
    for node in ast.walk(assets_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 5:
        fail(f"routers/assets.py should own 5 asset route registrations, found {route_count}")

    router_text = assets_path.read_text(encoding="utf-8")
    service_text = asset_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.asset_service import (", assets_path),
        (router_text, "return await list_assets(", assets_path),
        (router_text, "create_asset_service(", assets_path),
        (router_text, "update_asset_service(", assets_path),
        (router_text, "delete_asset_service(", assets_path),
        (router_text, "share_asset_service(", assets_path),
        (service_text, "asset_dao.get_by_project(", asset_service_path),
        (service_text, "entity_file_dao.get_files_for_entities(", asset_service_path),
        (service_text, "asset_dao.create(", asset_service_path),
        (service_text, "asset_dao.copy_to(", asset_service_path),
        (service_text, "entity_file_dao.copy_file(", asset_service_path),
    ]
    forbidden_snippets = [
        (router_text, "AssetDAO.get_by_project(", assets_path),
        (router_text, "AssetDAO.create(", assets_path),
        (router_text, "AssetDAO.update(", assets_path),
        (router_text, "AssetDAO.delete(", assets_path),
        (router_text, "AssetDAO.copy_to(", assets_path),
        (router_text, "EntityFileDAO.get_files_for_entities(", assets_path),
        (router_text, "EntityFileDAO.get_entity_files(", assets_path),
        (router_text, "EntityFileDAO.copy_file(", assets_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing asset service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Asset router must delegate DAO orchestration to service: {path.relative_to(root)} {snippet}")
    return route_count


def check_entity_file_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    entity_files_path = root / "routers" / "entity_files.py"
    entity_file_service_path = root / "services" / "entity_file_service.py"
    if not entity_files_path.exists():
        fail("routers/entity_files.py is missing")
    if not entity_file_service_path.exists():
        fail("services/entity_file_service.py is missing")
    api_text = api_routes_path.read_text(encoding="utf-8")
    entity_files_text = entity_files_path.read_text(encoding="utf-8")

    route_pairs = {
        ("/api/user-files", "get"),
        ("/api/entity-files", "get"),
        ("/api/entity-files/link", "post"),
        ("/api/entity-files/{file_id}/select", "put"),
        ("/api/entity-files/upload", "post"),
        ("/api/entity-files/{file_id}", "delete"),
        ("/api/entity-files/{file_id}/hard", "delete"),
        ("/api/entity-files/hard-delete-batch", "post"),
        ("/api/entity-files/migrate", "post"),
    }

    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            name = ast_call_name(call.func)
            _, _, method = name.rpartition(".") if name else ("", "", "")
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and (arg.value, method.lower()) in route_pairs
            ):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Entity file route handlers must live in routers/entity_files.py:\n" + "\n".join(violations))

    entity_files_tree = parse_py_file(entity_files_path)
    route_count = 0
    for node in ast.walk(entity_files_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 9:
        fail(f"routers/entity_files.py should own 9 entity-file route registrations, found {route_count}")

    purity_violations = []
    for snippet in ["get_db_manager_func", "get_db_manager"]:
        if snippet in entity_files_text:
            purity_violations.append(f"routers/entity_files.py still depends on DB plumbing: {snippet}")
    for snippet in ["get_db_manager_func=", "from db_manager import get_db_manager"]:
        if snippet in api_text:
            purity_violations.append(f"api_routes.py still passes DB plumbing into entity file routes: {snippet}")
    if purity_violations:
        fail("Entity file router purity contract failed:\n" + "\n".join(purity_violations))

    service_text = entity_file_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (entity_files_text, "from services.entity_file_service import (", entity_files_path),
        (entity_files_text, "return await list_user_files(", entity_files_path),
        (entity_files_text, "return await list_entity_files(", entity_files_path),
        (entity_files_text, "link_entity_file_service(", entity_files_path),
        (entity_files_text, "select_entity_file_service(", entity_files_path),
        (entity_files_text, "upload_entity_file_service(", entity_files_path),
        (entity_files_text, "soft_delete_entity_file(", entity_files_path),
        (entity_files_text, "hard_delete_entity_file_service(", entity_files_path),
        (entity_files_text, "hard_delete_entity_files_batch_service(", entity_files_path),
        (entity_files_text, "run_entity_file_migration_service(", entity_files_path),
        (service_text, "file_dao.get_user_files(", entity_file_service_path),
        (service_text, "entity_file_dao.count_user_files(", entity_file_service_path),
        (service_text, "entity_file_dao.get_entity_files(", entity_file_service_path),
        (service_text, "entity_file_dao.link_file(", entity_file_service_path),
        (service_text, "entity_file_dao.select_file(", entity_file_service_path),
        (service_text, "entity_file_dao.sync_legacy_url(", entity_file_service_path),
        (service_text, "entity_file_dao.hard_delete_batch(", entity_file_service_path),
    ]
    forbidden_snippets = [
        (entity_files_text, "FileDAO.get_user_files(", entity_files_path),
        (entity_files_text, "EntityFileDAO.count_user_files(", entity_files_path),
        (entity_files_text, "EntityFileDAO.get_entity_files(", entity_files_path),
        (entity_files_text, "EntityFileDAO.link_file(", entity_files_path),
        (entity_files_text, "EntityFileDAO.select_file(", entity_files_path),
        (entity_files_text, "EntityFileDAO.sync_legacy_url(", entity_files_path),
        (entity_files_text, "EntityFileDAO.soft_delete(", entity_files_path),
        (entity_files_text, "EntityFileDAO.hard_delete(", entity_files_path),
        (entity_files_text, "EntityFileDAO.hard_delete_batch(", entity_files_path),
        (entity_files_text, "import media_library_service", entity_files_path),
        (entity_files_text, "from migrate_existing_files import", entity_files_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing entity file service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Entity file router must delegate DAO/media/migration orchestration to service: {path.relative_to(root)} {snippet}")

    return route_count + 4 + len(required_snippets)


def check_legacy_file_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    legacy_files_path = root / "routers" / "legacy_files.py"
    if not legacy_files_path.exists():
        fail("routers/legacy_files.py is missing")

    route_pairs = {
        ("/api/files/upload", "post"),
        ("/api/files/{file_id}/download", "get"),
        ("/api/files/{file_id}", "delete"),
    }

    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            name = ast_call_name(call.func)
            _, _, method = name.rpartition(".") if name else ("", "", "")
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and (arg.value, method.lower()) in route_pairs
            ):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Legacy file route handlers must live in routers/legacy_files.py:\n" + "\n".join(violations))

    legacy_tree = parse_py_file(legacy_files_path)
    route_count = 0
    for node in ast.walk(legacy_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 3:
        fail(f"routers/legacy_files.py should own 3 legacy file route registrations, found {route_count}")
    return route_count


def check_audio_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    audio_path = root / "routers" / "audio.py"
    if not audio_path.exists():
        fail("routers/audio.py is missing")

    route_paths = {
        "/api/episodes/{episode_id}/audio-tracks",
        "/api/audio-tracks/{track_id}",
        "/api/audio/generate-speech",
        "/api/audio/generate-sfx",
        "/api/audio/generate-music",
        "/api/minimax/voice-design",
        "/api/minimax/voice-clone",
        "/api/minimax/voices",
        "/api/minimax/voices/{voice_id}",
        "/api/minimax/tts",
        "/api/minimax/tts/sync",
        "/api/minimax/tts/{task_id}",
        "/api/minimax/music",
        "/api/minimax/lyrics",
        "/api/minimax/files/upload",
        "/api/minimax/files/{file_id}",
        "/api/character-voices",
        "/api/projects/{project_id}/character-voices",
        "/api/character-voices/{voice_id}",
    }
    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Audio/MiniMax route handlers must live in routers/audio.py:\n" + "\n".join(violations))

    audio_tree = parse_py_file(audio_path)
    route_count = 0
    for node in ast.walk(audio_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 23:
        fail(f"routers/audio.py should own 23 audio route registrations, found {route_count}")
    return route_count


def check_script_timeline_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    script_timeline_path = root / "routers" / "script_timeline.py"
    script_timeline_service_path = root / "services" / "script_timeline_service.py"
    if not script_timeline_path.exists():
        fail("routers/script_timeline.py is missing")
    if not script_timeline_service_path.exists():
        fail("services/script_timeline_service.py is missing")

    route_paths = {
        "/api/episodes/{episode_id}/script-segments",
        "/api/episodes/{episode_id}/script-segments/batch",
        "/api/episodes/{episode_id}/script",
        "/api/episodes/{episode_id}/scripts",
        "/api/episodes/{episode_id}/scripts/{script_id}",
        "/api/episodes/{episode_id}/timeline-tracks",
        "/api/timeline-tracks/{track_id}",
    }
    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value in route_paths:
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Script/timeline route handlers must live in routers/script_timeline.py:\n" + "\n".join(violations))

    script_tree = parse_py_file(script_timeline_path)
    route_count = 0
    for node in ast.walk(script_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 12:
        fail(f"routers/script_timeline.py should own 12 script/timeline route registrations, found {route_count}")

    router_text = script_timeline_path.read_text(encoding="utf-8")
    service_text = script_timeline_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.script_timeline_service import (", script_timeline_path),
        (router_text, "list_script_segments_service(", script_timeline_path),
        (router_text, "batch_save_script_segments_service(", script_timeline_path),
        (router_text, "delete_script_segments_service(", script_timeline_path),
        (router_text, "get_primary_script(", script_timeline_path),
        (router_text, "update_primary_script(", script_timeline_path),
        (router_text, "create_script_file(", script_timeline_path),
        (router_text, "update_script_file(", script_timeline_path),
        (router_text, "delete_script_file(", script_timeline_path),
        (router_text, "list_timeline_tracks(", script_timeline_path),
        (router_text, "create_timeline_track_service(", script_timeline_path),
        (router_text, "update_timeline_track_service(", script_timeline_path),
        (service_text, "episode_script_segment_dao.list_by_script(", script_timeline_service_path),
        (service_text, "episode_script_segment_dao.batch_replace(", script_timeline_service_path),
        (service_text, "episode_script_dao.save_or_update(", script_timeline_service_path),
        (service_text, "episode_script_dao.get_next_sort_order(", script_timeline_service_path),
        (service_text, "timeline_dao.get_by_episode(", script_timeline_service_path),
        (service_text, "timeline_dao.create(", script_timeline_service_path),
        (service_text, "timeline_dao.update(", script_timeline_service_path),
    ]
    forbidden_snippets = [
        (router_text, "EpisodeScriptSegmentDAO.list_by_script(", script_timeline_path),
        (router_text, "EpisodeScriptSegmentDAO.list_by_episode(", script_timeline_path),
        (router_text, "EpisodeScriptSegmentDAO.batch_replace(", script_timeline_path),
        (router_text, "EpisodeScriptSegmentDAO.delete_by_script(", script_timeline_path),
        (router_text, "EpisodeScriptDAO.get_by_episode(", script_timeline_path),
        (router_text, "EpisodeScriptDAO.save_or_update(", script_timeline_path),
        (router_text, "EpisodeScriptDAO.list_by_episode(", script_timeline_path),
        (router_text, "EpisodeScriptDAO.get_next_sort_order(", script_timeline_path),
        (router_text, "EpisodeScriptDAO.create(", script_timeline_path),
        (router_text, "EpisodeScriptDAO.update(", script_timeline_path),
        (router_text, "EpisodeScriptDAO.delete_by_id(", script_timeline_path),
        (router_text, "TimelineDAO.get_by_episode(", script_timeline_path),
        (router_text, "TimelineDAO.create(", script_timeline_path),
        (router_text, "TimelineDAO.update(", script_timeline_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing script/timeline service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Script/timeline router must delegate DAO orchestration to service: {path.relative_to(root)} {snippet}")
    return route_count


def check_canvas_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    canvas_path = root / "routers" / "canvas.py"
    canvas_service_path = root / "services" / "canvas_service.py"
    if not canvas_path.exists():
        fail("routers/canvas.py is missing")
    if not canvas_service_path.exists():
        fail("services/canvas_service.py is missing")

    api_tree = parse_py_file(api_routes_path)
    violations: list[str] = []
    for node in ast.walk(api_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if not call or not call.args:
                continue
            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value.startswith("/api/canvas/"):
                violations.append(f"{api_routes_path.name}:{decorator.lineno} {node.name}")

    if violations:
        fail("Canvas route handlers must live in routers/canvas.py:\n" + "\n".join(violations))

    canvas_tree = parse_py_file(canvas_path)
    route_count = 0
    for node in ast.walk(canvas_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            name = ast_call_name(target)
            if not name:
                continue
            owner, _, method = name.rpartition(".")
            if owner == "router" and method.lower() in OPENAPI_METHODS:
                route_count += 1

    if route_count != 10:
        fail(f"routers/canvas.py should own 10 canvas route registrations, found {route_count}")

    router_text = canvas_path.read_text(encoding="utf-8")
    service_text = canvas_service_path.read_text(encoding="utf-8")
    required_snippets = [
        (router_text, "from services.canvas_service import (", canvas_path),
        (router_text, "create_canvas_board_service(", canvas_path),
        (router_text, "list_canvas_boards(", canvas_path),
        (router_text, "get_canvas_board_detail_service(", canvas_path),
        (router_text, "update_canvas_board_service(", canvas_path),
        (router_text, "delete_canvas_board_service(", canvas_path),
        (router_text, "create_canvas_node_service(", canvas_path),
        (router_text, "update_canvas_node_service(", canvas_path),
        (router_text, "delete_canvas_node_service(", canvas_path),
        (router_text, "create_canvas_connection_service(", canvas_path),
        (router_text, "delete_canvas_connection_service(", canvas_path),
        (service_text, "project_member_dao.check_permission(", canvas_service_path),
        (service_text, "canvas_board_dao.create_board(", canvas_service_path),
        (service_text, "canvas_board_dao.get_project_boards(", canvas_service_path),
        (service_text, "canvas_board_dao.get_board(", canvas_service_path),
        (service_text, "canvas_node_dao.get_board_nodes(", canvas_service_path),
        (service_text, "canvas_connection_dao.get_board_connections(", canvas_service_path),
        (service_text, "canvas_node_dao.create_node(", canvas_service_path),
        (service_text, "canvas_connection_dao.create_connection(", canvas_service_path),
    ]
    forbidden_snippets = [
        (router_text, "ProjectMemberDAO.check_permission(", canvas_path),
        (router_text, "CanvasBoardDAO.create_board(", canvas_path),
        (router_text, "CanvasBoardDAO.get_project_boards(", canvas_path),
        (router_text, "CanvasBoardDAO.get_board(", canvas_path),
        (router_text, "CanvasBoardDAO.update_board(", canvas_path),
        (router_text, "CanvasBoardDAO.delete_board(", canvas_path),
        (router_text, "CanvasNodeDAO.get_board_nodes(", canvas_path),
        (router_text, "CanvasNodeDAO.create_node(", canvas_path),
        (router_text, "CanvasNodeDAO.update_node(", canvas_path),
        (router_text, "CanvasNodeDAO.delete_node(", canvas_path),
        (router_text, "CanvasConnectionDAO.get_board_connections(", canvas_path),
        (router_text, "CanvasConnectionDAO.create_connection(", canvas_path),
        (router_text, "CanvasConnectionDAO.delete_connection(", canvas_path),
    ]
    for text, snippet, path in required_snippets:
        if snippet not in text:
            fail(f"Missing canvas service boundary snippet in {path.relative_to(root)}: {snippet}")
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Canvas router must delegate permission and DAO orchestration to service: {path.relative_to(root)} {snippet}")
    return route_count


def check_api_provider_runtime_model_contract(root: Path) -> int:
    required_snippets = [
        (
            root / "services" / "api_provider_registry.py",
            "def get_model_env_key",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "get_model_env_key(env_key)",
        ),
        (
            root / "services" / "api_provider_runtime.py",
            "runtime_model_name, model_env = _first_env(model_envs)",
        ),
        (
            root / "services" / "api_provider_runtime.py",
            '"model": "request" if model_name else',
        ),
        (
            root / "services" / "api_provider_runtime.py",
            "resolved = resolve_provider(provider, model_name)",
        ),
        (
            root / "services" / "api_provider_runtime.py",
            "resolve_provider_with_failover(\n            provider,\n            model_name,",
        ),
        (
            root / "schemas" / "generation.py",
            "model: Optional[str] = Field(None",
        ),
        (
            root / "schemas" / "generation.py",
            "Gemini image model override; omitted uses admin runtime config",
        ),
        (
            root / "schemas" / "generation.py",
            "DeepSeek model override; omitted uses admin runtime config",
        ),
        (
            root / "schemas" / "generation.py",
            "Doubao image model override; omitted uses admin runtime config",
        ),
        (
            root / "routers" / "ai_proxy.py",
            "model=request.model",
        ),
        (
            root / "services" / "ai_proxy_service.py",
            "requested_model: Optional[str]",
        ),
        (
            root / "services" / "ai_proxy_service.py",
            'config = resolve_provider("gemini-image", explicit_model)',
        ),
        (
            root / "services" / "ai_proxy_service.py",
            "def _deepseek_chat_url(model: Optional[str])",
        ),
        (
            root / "services" / "ai_proxy_service.py",
            'config = resolve_provider("doubao", model)',
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_explicit_model_overrides_runtime_model_env",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_gemini_image_uses_runtime_model_env_when_request_omits_model",
        ),
        (
            root / "services" / "video_reverse_service.py",
            "generate_gemini_chat_result(",
        ),
        (
            root / "services" / "video_reverse_service.py",
            "allow_failover=False",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_video_reverse_uses_runtime_gemini_text_model",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_deepseek_generate_text_uses_runtime_model_env_when_request_omits_model",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_doubao_image_uses_runtime_model_env_when_request_omits_model",
        ),
        (
            root / "external_api" / "video" / "minimax.py",
            "DEFAULT_MINIMAX_VIDEO_MODEL =",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "def minimax_runtime_model_override",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "def normalize_minimax_video_model",
        ),
        (
            root / "external_api" / "video" / "minimax.py",
            "minimax_runtime_model_override(model)",
        ),
        (
            root / "external_api" / "video" / "minimax.py",
            "normalize_minimax_video_model",
        ),
        (
            root / "external_api" / "video" / "minimax.py",
            'config = resolve_provider("minimax", model_override)',
        ),
        (
            root / "external_api" / "audio" / "minimax_audio.py",
            'config = resolve_provider("minimax", MINIMAX_DEFAULT_PROVIDER_MODEL)',
        ),
        (
            root / "services" / "api_provider_registry.py",
            "MINIMAX_DEFAULT_PROVIDER_MODEL = MINIMAX_DEFAULT_VIDEO_MODEL",
        ),
        (
            root / "external_api" / "audio" / "minimax_audio.py",
            'extra.get("group_id")',
        ),
        (
            root / "external_api" / "audio" / "minimax_audio.py",
            '"GroupId"',
        ),
        (
            root / "services" / "api_provider_registry.py",
            "PROVIDER_EXTRA_ENV_MAP",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "PROVIDER_EXTRA_FIELD_CATALOG",
        ),
        (
            root / "services" / "api_provider_registry.py",
            '"extra_fields": get_provider_extra_fields(provider)',
        ),
        (
            root / "services" / "api_provider_registry.py",
            '"default_endpoint": default_preset.get("endpoint")',
        ),
        (
            root / "services" / "api_provider_registry.py",
            '"default_model_name": default_preset.get("model_name")',
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "extra_fields?: ProviderExtraField[]",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "docs_url?: string",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "console_url?: string",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "key_help?: string",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "const ProviderCredentialLinks",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "Key 获取入口",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "const ProviderQuickCard",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "providerMetaToForm(meta)",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "厂商快速配置",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "配置 / 修改 API Key",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "function dbKeyStateText",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "生效 Key：",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "DB Key：",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "DB 未保存 Key，真实调用使用运行时 Key",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "运行时连通正常；DB 仍未保存 Key",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "const RUNTIME_KEY_IMPORT_BODY",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "const migrateRuntimeKeys = useCallback",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "dry_run: true",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "runtimeOnlyKeyProviders",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "运行时 Key 未落库",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "迁移运行时 Key",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "刷新生效健康",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "测试 DB 配置",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "测试生效配置",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "新增 / 修改厂商 API",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "raw === 'apiconfig' || raw === 'legacy-apiconfig'",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "Key 来源",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "此条 DB 记录未保存 Key",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "applyExtraValuesToRecords(",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "get_provider_extra_env_keys(provider)",
        ),
        (
            root / "scripts" / "check_audio_provider_runtime.py",
            "minimax_audio_group_id_wired=1",
        ),
        (
            root / "tests" / "test_minimax_audio_runtime.py",
            "test_minimax_audio_query_sends_group_id_param",
        ),
        (
            root / "tests" / "test_minimax_audio_runtime.py",
            "test_minimax_audio_voice_clone_sends_runtime_group_proxy",
        ),
        (
            root / "tests" / "test_minimax_audio_runtime.py",
            "test_minimax_audio_file_upload_sends_runtime_group_proxy",
        ),
        (
            root / "tests" / "test_minimax_audio_runtime.py",
            "test_minimax_audio_voice_clone_error_has_diagnostics",
        ),
        (
            root / "external_api" / "audio" / "minimax_audio.py",
            "_raise_for_minimax_response",
        ),
        (
            root / "external_api" / "audio" / "minimax_audio.py",
            "async def _request_json(",
        ),
        (
            root / "external_api" / "audio" / "minimax_audio.py",
            "async def _download_bytes(",
        ),
        (
            root / "external_api" / "video" / "minimax.py",
            "model: Optional[str] = None",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_minimax_video_uses_runtime_model_when_worker_passes_legacy_default",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_minimax_video_explicit_non_default_model_overrides_runtime_model",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_minimax_sora2_and_veo_video_alias_helpers_live_in_registry",
        ),
        (
            root / "services" / "api_provider_registry.py",
            '"model_name": SORA2_DEFAULT_VIDEO_MODEL',
        ),
        (
            root / "services" / "api_provider_registry.py",
            "SORA2_LEGACY_VIDEO_MODELS",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "def sora2_runtime_model_override",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "def normalize_sora2_video_model",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "SORA2_NEW_MODEL = SORA2_DEFAULT_VIDEO_MODEL",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "SORA2_LEGACY_VIDEO_MODELS",
        ),
        (
            root / "external_api" / "video" / "sora2.py",
            "DEFAULT_SORA2_VIDEO_MODEL =",
        ),
        (
            root / "external_api" / "video" / "sora2.py",
            "sora2_runtime_model_override(model)",
        ),
        (
            root / "external_api" / "video" / "sora2.py",
            "normalize_sora2_video_model",
        ),
        (
            root / "external_api" / "video" / "sora2.py",
            'config = resolve_provider("sora2", model_override)',
        ),
        (
            root / "external_api" / "video" / "sora2.py",
            "model: Optional[str] = None",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_sora2_video_uses_runtime_model_env_when_request_omits_model",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_sora2_video_legacy_model_env_maps_to_callable_default",
        ),
        (
            root / "services" / "api_provider_registry.py",
            '"model_name": VEO_DEFAULT_VIDEO_MODEL',
        ),
        (
            root / "services" / "api_provider_registry.py",
            "VEO_LEGACY_VIDEO_MODELS",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "def veo_runtime_model_override",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "def normalize_veo_video_model",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "VEO_NEW_MODEL = VEO_DEFAULT_VIDEO_MODEL",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "VEO_LEGACY_VIDEO_MODELS",
        ),
        (
            root / "external_api" / "video" / "veo.py",
            "DEFAULT_VEO_VIDEO_MODEL =",
        ),
        (
            root / "external_api" / "video" / "veo.py",
            "veo_runtime_model_override(model)",
        ),
        (
            root / "external_api" / "video" / "veo.py",
            "normalize_veo_video_model",
        ),
        (
            root / "external_api" / "video" / "veo.py",
            'config = resolve_provider("veo", model_override)',
        ),
        (
            root / "external_api" / "video" / "veo.py",
            "model: Optional[str] = None",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_veo_video_uses_runtime_model_env_when_request_omits_model",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_veo_video_legacy_model_env_maps_to_callable_default",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "SEEDANCE_SUB_MODEL_ENV_MAP",
        ),
        (
            root / "services" / "api_provider_runtime.py",
            "def resolve_seedance_model_name",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "get_seedance_sub_model_env_key(sub_model)",
        ),
        (
            root / "external_api" / "video" / "seedance.py",
            "resolve_seedance_model_name(normalized_sub_model)",
        ),
        (
            root / "services" / "video_capability_service.py",
            "resolve_seedance_model_name(\"standard\")",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_seedance_video_uses_standard_sub_model_runtime_env",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_seedance_video_uses_fast_sub_model_runtime_env",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_seedance_video_uses_callable_default_when_runtime_model_missing",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "DASHSCOPE_SUB_MODEL_ENV_MAP",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "DASHSCOPE_MODEL_KLING_STANDARD",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "DASHSCOPE_MODEL_KLING_OMNI",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "DASHSCOPE_MODEL_VIDU_REFERENCE_Q3",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "DASHSCOPE_MODEL_VIDU_STARTEND_Q3_TURBO",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "DASHSCOPE_MODEL_HAPPYHORSE",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "dashscope_model_matches_sub_model",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "dashscope_sub_model_for_model",
        ),
        (
            root / "services" / "api_provider_runtime.py",
            "def resolve_dashscope_model_name",
        ),
        (
            root / "services" / "api_provider_runtime.py",
            "def resolve_dashscope_default_model_name",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "DASHSCOPE_VIDU_REFERENCE_SUB_MODEL_MAP",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "DASHSCOPE_VIDU_STARTEND_SUB_MODEL_MAP",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "def dashscope_vidu_reference_sub_model",
        ),
        (
            root / "services" / "api_provider_registry.py",
            "def dashscope_vidu_startend_sub_model",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "dashscope_sub_model_for_model(model_name)",
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            "get_dashscope_sub_model_env_key(dashscope_sub_model)",
        ),
        (
            root / "external_api" / "video" / "wan2.py",
            "resolve_dashscope_model_name(\"wan26\", model)",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "resolve_dashscope_model_name(kling_sub_model)",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "resolve_dashscope_model_name(\"kling-standard\")",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "resolve_dashscope_model_name(\"kling-omni\")",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "dashscope_vidu_reference_sub_model(sub_vidu)",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "dashscope_vidu_startend_sub_model(sub_vidu)",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "resolve_dashscope_model_name(vidu_sub_model)",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "resolve_dashscope_model_name(\"happyhorse\")",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "resolve_dashscope_default_model_name(model)",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_wan26_video_uses_runtime_sub_model_env",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_wan26_video_uses_callable_default_when_runtime_model_missing",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_dashscope_kling_ignores_unrelated_generic_model_env",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_dashscope_vidu_ignores_unrelated_generic_model_env",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_dashscope_vidu_sub_model_helpers_live_in_registry",
        ),
        (
            root / "tests" / "test_api_provider_runtime_model_env.py",
            "test_dashscope_default_model_name_resolves_through_sub_model_runtime_env",
        ),
        (
            root / "tests" / "test_dashscope_video_payload_extension.py",
            "test_kling_standard_uses_runtime_sub_model_env",
        ),
        (
            root / "tests" / "test_dashscope_video_payload_extension.py",
            "test_kling_omni_uses_runtime_sub_model_env",
        ),
        (
            root / "tests" / "test_dashscope_video_payload_extension.py",
            "test_kling_submit_default_uses_runtime_sub_model_env",
        ),
        (
            root / "tests" / "test_dashscope_video_payload_extension.py",
            "test_vidu_reference_uses_runtime_sub_model_env",
        ),
        (
            root / "tests" / "test_dashscope_video_payload_extension.py",
            "test_vidu_startend_uses_runtime_sub_model_env",
        ),
        (
            root / "tests" / "test_dashscope_video_payload_extension.py",
            "test_vidu_direct_default_uses_runtime_sub_model_env",
        ),
        (
            root / "tests" / "test_dashscope_video_payload_extension.py",
            "test_happyhorse_uses_runtime_sub_model_env",
        ),
        (
            root / "tests" / "test_dashscope_video_payload_extension.py",
            "test_happyhorse_direct_default_uses_runtime_sub_model_env",
        ),
    ]
    checks = 0
    for path, snippet in required_snippets:
        if not path.exists():
            fail(f"Missing API provider runtime model contract file: {path.relative_to(root)}")
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing API provider runtime model contract snippet in {path.relative_to(root)}: {snippet}")
        checks += 1
    admin_settings_text = (root / "new_html" / "admin" / "AdminSettingsPage.tsx").read_text(encoding="utf-8")
    for forbidden in (
        "LEGACY_API_CONFIG_ROUTE",
        "打开旧版 API 编辑",
        "window.location.assign(LEGACY_API_CONFIG_ROUTE);",
        "'legacy-apiconfig': 'apiconfig'",
        "旧版编辑",
    ):
        target_text = admin_settings_text
        if forbidden == "旧版编辑":
            target_text = (root / "new_html" / "admin" / "adminMenu.ts").read_text(encoding="utf-8")
        if forbidden in target_text:
            fail(f"Admin API settings page must not route API editing back to legacy console: {forbidden}")
        checks += 1
    cluster_text = (root / "cluster_main.py").read_text(encoding="utf-8")
    router_text = (root / "routers" / "ai_proxy.py").read_text(encoding="utf-8")
    if "DOUBAO_MODEL =" in cluster_text:
        fail("cluster_main.py must not cache the Doubao image model at import time")
    if "doubao_model_provider" in router_text or "doubao_model_provider" in cluster_text:
        fail("Doubao route must resolve runtime model through services.ai_proxy_service, not injected model providers")
    seedance_text = (root / "external_api" / "video" / "seedance.py").read_text(encoding="utf-8")
    if "os.getenv" in seedance_text or "import os" in seedance_text:
        fail("Seedance client must not cache/read model env directly; use runtime resolver helpers")
    minimax_audio_text = (root / "external_api" / "audio" / "minimax_audio.py").read_text(encoding="utf-8")
    api_routes_text = (root / "api_routes.py").read_text(encoding="utf-8")
    audio_provider_text = (root / "services" / "audio_provider.py").read_text(encoding="utf-8")
    for path, text, required in (
        (
            root / "api_routes.py",
            api_routes_text,
            "from external_api.audio.minimax_audio import get_minimax_audio_client",
        ),
        (
            root / "services" / "audio_provider.py",
            audio_provider_text,
            "from external_api.audio.minimax_audio import get_minimax_audio_client",
        ),
        (
            root / "tests" / "test_audio_provider.py",
            (root / "tests" / "test_audio_provider.py").read_text(encoding="utf-8"),
            "external_api.audio.minimax_audio.get_minimax_audio_client",
        ),
    ):
        if required not in text:
            fail(f"MiniMax audio runtime import should use external_api implementation in {path.relative_to(root)}")
        checks += 1
    for path, text in (
        (root / "api_routes.py", api_routes_text),
        (root / "services" / "audio_provider.py", audio_provider_text),
    ):
        if "from minimax_audio import get_minimax_audio_client" in text:
            fail(f"{path.relative_to(root)} must not import the legacy minimax_audio shim")
        checks += 1
    for snippet in (
        "async def _request_form_json(",
        "url = self._runtime_config.url_for_operation(operation)",
        'data = await self._request_json(\n            "post",\n            "voice_clone"',
        'data = await self._request_json(\n            "post",\n            "tts_sync"',
        'return await self._request_json(\n            "get",\n            "tts_query"',
        'data = await self._request_json(\n            "post",\n            "music_generation"',
        'return await self._request_form_json(\n                "files_upload"',
        'return await self._request_json("get", "files_retrieve", params=params)',
        'content = await self._download_bytes(download_url, action="tts_download")',
    ):
        if snippet not in minimax_audio_text:
            fail(f"MiniMax audio client must route runtime request through shared helper: {snippet}")
        checks += 1
    if minimax_audio_text.count("aiohttp.ClientSession(") != 3:
        fail("MiniMax audio client should centralize aiohttp sessions in JSON, download, and form helpers")
    checks += 1
    dashscope_video_text = (root / "external_api" / "video" / "dashscope.py").read_text(encoding="utf-8")
    for snippet in (
        "async def _request_json(",
        'data = await self._request_json("post", self._create_url, headers=self._headers_create, json=body)',
        'return await self._request_json("get", self._query_url(task_id), headers=self._headers_query, task_id=task_id)',
    ):
        if snippet not in dashscope_video_text:
            fail(f"DashScope video client must route create/query through shared helper: {snippet}")
        checks += 1
    if dashscope_video_text.count("aiohttp.ClientSession(") != 1:
        fail("DashScope video client should centralize aiohttp session creation in _request_json")
    checks += 1
    ai_proxy_text = (root / "services" / "ai_proxy_service.py").read_text(encoding="utf-8")
    for snippet in (
        "def _post_json_request(",
        "async def _post_json_request_async(",
        'label="DeepSeek",',
        'label="Gemini text",',
        'label="Gemini image",',
        "def _post_form_request(",
        "async def _post_form_request_async(",
        'label="GPT Image edit",',
        'label="GPT Image generate",',
        "def _post_stream_request(",
        "def _ensure_stream_response_ok(",
        'label="DeepSeek stream",',
        "def generated_image_content(",
        'label="Doubao image",',
    ):
        if snippet not in ai_proxy_text:
            fail(f"AI proxy providers must route through shared helpers: {snippet}")
        checks += 1
    if ai_proxy_text.count("requests.post(") > 3:
        fail("AI proxy service should keep direct requests.post limited to JSON helper, form helper, and stream helper")
    checks += 1
    video_reverse_text = (root / "services" / "video_reverse_service.py").read_text(encoding="utf-8")
    if "requests.post(" in video_reverse_text or "import requests" in video_reverse_text:
        fail("video_reverse_service must call Gemini through services.ai_proxy_service, not direct requests.post")
    checks += 1
    if "generated_image_content(" not in router_text:
        fail("AI proxy router must delegate generated image URL/data decoding to services.ai_proxy_service")
    checks += 1
    if "requests." in router_text or "import requests" in router_text:
        fail("AI proxy router must not perform direct HTTP requests")
    checks += 1
    return checks


def check_provider_endpoint_single_source_contract(root: Path) -> int:
    """Third-party provider hostnames must live in the provider registry only."""
    registry = root / "services" / "api_provider_registry.py"
    allowed_paths = {registry}
    provider_domains = [
        "api.laozhang.ai",
        "api.deepseek.com",
        "generativelanguage.googleapis.com",
        "ark.cn-beijing.volces.com",
        "dashscope.aliyuncs.com",
        "api.minimaxi.com",
    ]

    checks = 0
    registry_text = registry.read_text(encoding="utf-8")
    for domain in provider_domains:
        if domain not in registry_text:
            fail(f"Provider endpoint registry is missing expected domain: {domain}")
        checks += 1

    scan_roots = [
        root / "external_api",
        root / "routers",
        root / "services",
    ]
    scan_files: list[Path] = [root / "cluster_main.py", root / "api_routes.py"]
    for scan_root in scan_roots:
        scan_files.extend(scan_root.rglob("*.py"))

    violations: list[str] = []
    for path in sorted(set(scan_files)):
        if not path.exists() or path in allowed_paths or "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for domain in provider_domains:
            if domain in text:
                rel = path.relative_to(root)
                violations.append(f"{rel}: hardcoded provider endpoint domain {domain}")
            checks += 1

    if violations:
        fail(
            "Provider endpoint domains must stay centralized in services/api_provider_registry.py:\n"
            + "\n".join(violations)
        )
    return checks


def check_frontend_ai_proxy_contract(root: Path) -> int:
    """Frontend AI text calls must route through backend provider management."""
    new_html = root / "new_html"
    http_client = new_html / "services" / "httpClient.ts"
    gemini_service = new_html / "services" / "geminiService.ts"
    prompt_rewriter = new_html / "services" / "promptRewriter.ts"
    ai_provider_services = [
        new_html / "services" / "deepseekService.ts",
        new_html / "services" / "geminiProxyService.ts",
        new_html / "services" / "geminiImageService.ts",
        new_html / "services" / "doubaoService.ts",
        new_html / "services" / "gptImageService.ts",
    ]

    required_snippets = [
        (http_client, "export async function apiFetch("),
        (http_client, "export async function apiJson<T>("),
        (gemini_service, "import { callGeminiProxyWithRetry } from './geminiProxyService';"),
        (gemini_service, "export const callGeminiText = async"),
        (gemini_service, "return callGeminiProxyWithRetry(prompt, systemPrompt, 3, model);"),
        (prompt_rewriter, "历史兼容别名"),
        (prompt_rewriter, "result = await callGeminiProxyWithRetry(userPrompt, SYSTEM_PROMPT);"),
    ]
    forbidden_snippets = [
        (gemini_service, "@google/genai"),
        (gemini_service, "GoogleGenAI"),
        (gemini_service, "process.env.API_KEY"),
        (gemini_service, "process.env.GEMINI_API_KEY"),
        (gemini_service, "ai.models.generateContent"),
        (prompt_rewriter, "await import('./geminiService')"),
        (prompt_rewriter, "直连 / 需本地 key"),
    ]

    checks = 0
    for path, snippet in required_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing frontend AI proxy contract snippet in {path.relative_to(root)}: {snippet}")
        checks += 1
    for path, snippet in forbidden_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet in text:
            fail(f"Forbidden frontend direct-AI snippet in {path.relative_to(root)}: {snippet}")
        checks += 1

    violations: list[str] = []
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if "node_modules" in path.parts or "__tests__" in path.parts or path.name == "vite.config.ts":
            continue
        text = path.read_text(encoding="utf-8")
        if "process.env." in text:
            violations.append(f"{path.relative_to(root)} uses process.env")
        if "@google/genai" in text or "GoogleGenAI" in text:
            violations.append(f"{path.relative_to(root)} imports direct Gemini SDK")
    if violations:
        fail("Frontend AI calls must use backend proxies:\n" + "\n".join(violations))
    checks += 1

    for path in ai_provider_services:
        text = path.read_text(encoding="utf-8")
        if "./httpClient" not in text:
            fail(f"Frontend AI provider service must use shared httpClient: {path.relative_to(root)}")
        for snippet in ["localStorage.getItem('auth_token')", 'localStorage.getItem("auth_token")', "Authorization:", "'Authorization'", '"Authorization"', "Bearer ", "fetch("]:
            if snippet in text:
                fail(f"Frontend AI provider service has duplicated request/auth logic in {path.relative_to(root)}: {snippet}")
            checks += 1
        checks += 1

    frontend_docs = [
        new_html / ".env.example",
        new_html / "README.md",
        new_html / "GEMINI_API_CONFIG.md",
    ]
    required_doc_snippets = [
        (new_html / ".env.example", "Do not put third-party AI provider API keys in this file."),
        (new_html / "README.md", "/admin/settings?item=apiconfig"),
        (new_html / "GEMINI_API_CONFIG.md", "Frontend services call backend proxies:"),
    ]
    forbidden_doc_snippets = [
        "VITE_GEMINI_TEXT_API_KEY",
        "VITE_GEMINI_IMAGE_API_KEY",
        "VITE_GEMINI_PROXY_API_KEY",
        "localStorage.setItem('gemini_",
        "localStorage.setItem(\"gemini_",
        "Set the `GEMINI_API_KEY`",
        "api.laozhang.ai/v1beta/models/",
    ]
    for path, snippet in required_doc_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Frontend API docs must direct provider keys to backend admin config in {path.relative_to(root)}: {snippet}")
        checks += 1
    for path in frontend_docs:
        text = path.read_text(encoding="utf-8")
        for snippet in forbidden_doc_snippets:
            if snippet in text:
                fail(f"Frontend API docs must not instruct browser/provider-key config in {path.relative_to(root)}: {snippet}")
            checks += 1
    return checks


def check_frontend_http_client_contract(root: Path) -> int:
    """Selected frontend services should share auth/error handling via httpClient."""
    new_html = root / "new_html"
    http_client = new_html / "services" / "httpClient.ts"
    api_service = new_html / "services" / "apiService.ts"
    video_page = new_html / "components" / "VideoPage.tsx"
    project_hub = new_html / "components" / "ProjectHub.tsx"
    episode_hub = new_html / "pages" / "EpisodeHubPage.tsx"
    history_page = new_html / "components" / "HistoryPage.tsx"
    header = new_html / "components" / "Header.tsx"
    project_context = new_html / "contexts" / "ProjectContext.tsx"
    workspace_app = new_html / "WorkspaceApp.tsx"
    workflow_generation_page = new_html / "pages" / "GenerationPage.tsx"
    video_gen_page = new_html / "pages" / "VideoGenPage.tsx"
    dash_scope_cards = new_html / "components" / "video" / "DashScopeCards.tsx"
    global_task_manager = new_html / "services" / "globalTaskManager.ts"
    task_notification_service = new_html / "services" / "taskNotificationService.ts"
    episode_data_service = new_html / "services" / "episodeDataService.ts"
    audio_generation_service = new_html / "services" / "audioGenerationService.ts"
    video_model_service = new_html / "services" / "videoModelService.ts"
    video_task_service = new_html / "services" / "videoTaskService.ts"
    task_control_service = new_html / "services" / "taskControlService.ts"
    video_task_types = new_html / "services" / "videoTaskTypes.ts"
    video_workspace_service = new_html / "services" / "videoWorkspaceService.ts"
    video_workflow_service = new_html / "services" / "videoWorkflowService.ts"
    video_media_service = new_html / "services" / "videoMediaService.ts"
    comfyui_generation_service = new_html / "services" / "comfyuiGenerationService.ts"
    comfyui_task_wait_service = new_html / "services" / "comfyuiTaskWaitService.ts"
    gemini_image_generation_service = new_html / "services" / "geminiImageGenerationService.ts"
    asset_mutation_service = new_html / "services" / "assetMutationService.ts"
    storyboard_mutation_service = new_html / "services" / "storyboardMutationService.ts"
    script_timeline_service = new_html / "services" / "scriptTimelineService.ts"
    admin_compat_service = new_html / "services" / "adminCompatService.ts"
    comfyui_bridge_service = new_html / "services" / "comfyuiBridgeService.ts"
    project_workflow_service = new_html / "services" / "projectWorkflowService.ts"
    canvas_service = new_html / "services" / "canvasService.ts"
    use_episode_data = new_html / "hooks" / "useEpisodeData.ts"
    episode_context = new_html / "contexts" / "EpisodeContext.tsx"
    audio_stage_page = new_html / "pages" / "AudioStagePage.tsx"
    enhance_page = new_html / "pages" / "EnhancePage.tsx"
    final_product_page = new_html / "pages" / "FinalProductPage.tsx"
    storyboard_page = new_html / "pages" / "StoryboardGenPage.tsx"
    workflow_materials_page = new_html / "pages" / "MaterialsPage.tsx"
    voice_sidebar = new_html / "components" / "audio" / "VoiceSidebar.tsx"
    music_modal = new_html / "components" / "audio" / "MusicModal.tsx"
    seedance_multimodal_panel = new_html / "components" / "SeedanceMultimodalPanel.tsx"
    video_card = new_html / "components" / "video" / "VideoCard.tsx"
    seedance_panel_with_candidates = new_html / "components" / "video" / "SeedancePanelWithCandidates.tsx"
    dash_scope_card_with_candidates = new_html / "components" / "video" / "DashScopeCardWithCandidates.tsx"
    admin_login_page = new_html / "admin" / "AdminLoginPage.tsx"
    design_page = new_html / "pages" / "DesignPage.tsx"
    material_page = new_html / "components" / "MaterialPage.tsx"
    generation_page = new_html / "components" / "GenerationPage.tsx"
    admin_feature_tabs = new_html / "components" / "AdminFeatureTabs.tsx"
    admin_organizations_tab = new_html / "admin" / "AdminOrganizationsTab.tsx"
    admin_hub_page = new_html / "admin" / "AdminHubPage.tsx"
    admin_page = new_html / "components" / "AdminPage.tsx"
    admin_settings_page = new_html / "admin" / "AdminSettingsPage.tsx"
    migrated_services = [
        new_html / "services" / "videoReverseService.ts",
        new_html / "services" / "imageLoaderService.ts",
        new_html / "services" / "shareService.ts",
        new_html / "services" / "entityFileService.ts",
        new_html / "services" / "mediaLibraryService.ts",
        new_html / "services" / "creditService.ts",
        new_html / "services" / "organizationService.ts",
        task_notification_service,
        episode_data_service,
        audio_generation_service,
        task_control_service,
        video_task_service,
        video_workspace_service,
        video_workflow_service,
        video_media_service,
        comfyui_generation_service,
        comfyui_task_wait_service,
        asset_mutation_service,
        storyboard_mutation_service,
        script_timeline_service,
        admin_compat_service,
        comfyui_bridge_service,
        project_workflow_service,
        canvas_service,
        global_task_manager,
    ]
    migrated_pages = [
        project_hub,
        episode_hub,
        workflow_generation_page,
        video_gen_page,
        history_page,
        header,
        project_context,
        admin_login_page,
        design_page,
        material_page,
        generation_page,
        admin_feature_tabs,
        admin_organizations_tab,
        admin_hub_page,
        admin_page,
        admin_settings_page,
    ]

    direct_fetch_violations: list[str] = []
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if (
            path == http_client
            or "node_modules" in path.parts
            or "__tests__" in path.parts
            or path.name == "vite.config.ts"
        ):
            continue
        if "fetch(" in path.read_text(encoding="utf-8"):
            direct_fetch_violations.append(str(path.relative_to(root)))
    if direct_fetch_violations:
        fail(
            "Frontend production code must route HTTP through services/httpClient.ts:\n"
            + "\n".join(direct_fetch_violations)
        )
    checks = 1

    required_snippets = [
        (http_client, "import { pickTokenForCurrentRoute } from '../admin/adminAuth';"),
        (http_client, "export function buildAuthHeaders("),
        (http_client, "export async function handleResponse("),
        (http_client, "export function handleUnauthorized("),
        (http_client, "export function getAuthToken("),
        (http_client, "return pickTokenForCurrentRoute();"),
        (http_client, "export function getHeaders("),
        (http_client, "includeContentType?: boolean"),
        (http_client, "export function authTokenFromHeaders("),
        (http_client, "export function secureApiUrl("),
        (http_client, "export async function apiBlob("),
        (http_client, "export async function publicBlob("),
        (http_client, "includeAuth?: boolean"),
        (new_html / "services" / "entityFileService.ts", "{ includeContentType: false }"),
        (new_html / "services" / "mediaLibraryService.ts", "{ includeContentType: false }"),
        (new_html / "services" / "mediaLibraryService.ts", "apiBlob('/api/media-library/batch-download'"),
        (new_html / "services" / "videoService.ts", "from './videoMediaService';"),
        (video_media_service, "import { apiJson, buildAuthHeaders, handleUnauthorized, secureApiUrl } from './httpClient';"),
        (video_media_service, "export function secureMediaUrl("),
        (video_media_service, "export async function uploadImage("),
        (video_media_service, "export async function uploadImageToComfyUI("),
        (video_media_service, "export async function uploadAudio("),
        (video_media_service, "export async function uploadVideoFile("),
        (video_media_service, "export async function getProjectVideoTasks("),
        (video_media_service, "export async function clearProjectVideoTasks("),
        (video_media_service, "export async function cropVideo("),
        (video_media_service, "export async function reuploadVideo("),
        (video_media_service, "const data = await apiJson<{ success?: boolean; project?: { video_tasks?: ProjectVideoTask[] } }>("),
        (video_media_service, "`/api/projects/${projectId}/clear-video-tasks`"),
        (video_media_service, "return apiJson<{\n    filename: string;\n    url: string;\n  }>('/api/video/crop'"),
        (video_media_service, "`/api/comfyui/reupload/video?filename=${encodeURIComponent(filename)}&file_type=${fileType}`"),
        (new_html / "services" / "imageLoaderService.ts", "import { apiBlob, apiJson, secureApiUrl } from './httpClient'"),
        (new_html / "services" / "imageLoaderService.ts", "import { runWhenIdle } from '../utils/idleScheduler';"),
        (new_html / "services" / "imageLoaderService.ts", "apiJson<any>(\n        `/api/projects/${projectId}/images/${shotId}`"),
        (new_html / "services" / "imageLoaderService.ts", "apiBlob(securedUrl, { method: 'GET' }, '下载图片'"),
        (new_html / "services" / "imageLoaderService.ts", "runWhenIdle(() => {"),
        (new_html / "services" / "geminiService.ts", "import { callGeminiProxyWithRetry } from './geminiProxyService';"),
        (new_html / "services" / "geminiService.ts", "from './geminiImageGenerationService';"),
        (gemini_image_generation_service, "import { generateGeminiImageViaProxy, GeminiImageOptions, GeneratedFileResult } from './geminiImageService';"),
        (gemini_image_generation_service, "export const generateGeminiImageVariant = async"),
        (gemini_image_generation_service, "export const generateMaterialImage = async"),
        (gemini_image_generation_service, "export const generateFinalIllustration = async"),
        (comfyui_generation_service, "import { apiJson } from './httpClient'"),
        (comfyui_generation_service, "from './comfyuiTaskWaitService';"),
        (comfyui_generation_service, "const postGenerationTask = async ("),
        (comfyui_generation_service, "postGenerationTask('/api/generate/comfyui-workflow'"),
        (comfyui_generation_service, "await import('./comfyuiBridgeService')"),
        (comfyui_task_wait_service, "import { apiJson } from './httpClient'"),
        (comfyui_task_wait_service, "import { taskRegistry } from './taskRegistry';"),
        (comfyui_task_wait_service, "export { getComfyUIQueueStatus };"),
        (comfyui_task_wait_service, "export function toQueueMeta("),
        (comfyui_task_wait_service, "export const checkComfyUITaskStatus = async"),
        (comfyui_task_wait_service, "export const waitForComfyUITask = async"),
        (comfyui_task_wait_service, "export const waitForComfyUITaskAllImages = async"),
        (comfyui_task_wait_service, "apiJson<any>(\n            `/api/task/${taskId}`"),
        (new_html / "services" / "videoService.ts", "from './videoTaskService';"),
        (new_html / "services" / "videoService.ts", "from './videoModelService';"),
        (new_html / "services" / "videoService.ts", "from './videoTaskTypes';"),
        (new_html / "services" / "videoService.ts", "from './videoWorkspaceService';"),
        (video_task_service, "import { apiFetch, apiJson, buildAuthHeaders, handleUnauthorized } from './httpClient';"),
        (video_task_service, "import { enqueueComfyUITask } from './comfyuiTaskQueue';"),
        (video_task_service, "export async function submitTask("),
        (video_task_service, "export async function getTaskStatus("),
        (video_task_service, "export async function submitTaskQueued("),
        (video_task_service, "export async function submitSeedanceTask("),
        (video_task_service, "export async function submitDashScopeVideoTask("),
        (video_task_service, "export async function mixStoryboardAudio("),
        (video_task_service, "export async function runWithConcurrency"),
        (video_model_service, "export type VideoModel ="),
        (video_model_service, "export interface SeedanceParams"),
        (video_model_service, "export function inferSeedanceTaskType("),
        (video_model_service, "export interface DashScopeVideoParams"),
        (video_model_service, "export function makeDefaultDashScopeParams("),
        (video_model_service, "export function inferDashScopeTaskType("),
        (video_model_service, "export function getModelDisplayName("),
        (video_model_service, "export const ALL_MODELS: VideoModel[]"),
        (video_model_service, "export const SELECTABLE_MODELS: VideoModel[]"),
        (video_model_service, "'HappyHorse', 'Vidu', 'Kling', '大能', 'Seedance2', 'Seedance2Fast', 'MINI'"),
        (video_task_types, "export interface UploadedImage"),
        (video_task_types, "export interface TaskGroup"),
        (video_task_types, "export interface TaskStatus"),
        (video_task_types, "export interface VideoTask"),
        (video_workspace_service, "import { apiFetch } from './httpClient';"),
        (video_workspace_service, "export interface StoryboardMeta"),
        (video_workspace_service, "export interface WorkspaceSession"),
        (video_workspace_service, "export async function saveWorkspaceSession("),
        (video_workspace_service, "export async function loadWorkspaceSession("),
        (video_workspace_service, "export function computeReactiveDurationFromMeta("),
        (video_workspace_service, "export async function patchWorkspaceSession("),
        (video_gen_page, "from '../services/videoWorkspaceService'"),
        (video_gen_page, "from '../services/videoTaskService'"),
        (video_page, "from '../services/videoWorkspaceService'"),
        (video_page, "from '../services/videoTaskService'"),
        (video_page, "from '../services/videoMediaService'"),
        (enhance_page, "from '../services/videoTaskService'"),
        (new_html / "services" / "videoTaskPoller.ts", "from './videoTaskService'"),
        (new_html / "services" / "ttsTaskPoller.ts", "from './videoTaskService'"),
        (new_html / "contexts" / "TaskContext.tsx", "import('../services/taskControlService')"),
        (task_control_service, "import { apiFetch } from './httpClient';"),
        (task_control_service, "export async function cancelTask("),
        (task_control_service, "export async function deleteTask("),
        (video_task_service, "export { cancelTask, deleteTask } from './taskControlService';"),
        (new_html / "components" / "video" / "VideoCard.tsx", "from '../../services/videoWorkspaceService'"),
        (api_service, "export { getAuthToken, getHeaders, handleResponse } from './httpClient';"),
        (api_service, "from './taskNotificationService';"),
        (api_service, "from './episodeDataService';"),
        (api_service, "from './audioGenerationService';"),
        (api_service, "from './videoWorkflowService';"),
        (api_service, "from './assetMutationService';"),
        (api_service, "from './storyboardMutationService';"),
        (api_service, "from './scriptTimelineService';"),
        (api_service, "from './adminCompatService';"),
        (api_service, "from './comfyuiBridgeService';"),
        (api_service, "from './projectWorkflowService';"),
        (api_service, "from './canvasService';"),
        (task_notification_service, "import { apiJson } from './httpClient';"),
        (task_notification_service, "return apiJson<any>('/api/tasks/active'"),
        (task_notification_service, "return apiJson<any>(url, { method: 'GET' }, 'getTaskNotifications')"),
        (task_notification_service, "return apiJson<any>('/api/notifications/unread-count'"),
        (task_notification_service, "return apiJson<any>(`/api/notifications?${params}`"),
        (task_notification_service, "return apiJson<any>(`/api/notifications/${notificationId}/read`"),
        (task_notification_service, "return apiJson<any>('/api/notifications/read-all'"),
        (task_notification_service, "return apiJson<any>(`/api/notifications/${notificationId}`"),
        (episode_data_service, "import { apiJson } from './httpClient';"),
        (episode_data_service, "export interface StoryboardItemsQueryOptions"),
        (episode_data_service, "async function getStoryboardItemsRaw("),
        (episode_data_service, "fallbackScriptId: scriptId"),
        (episode_data_service, "return apiJson<any>(`/api/projects/${projectId}/assets${qs}`"),
        (episode_data_service, "return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items${qs}`"),
        (episode_data_service, "return apiJson<any>(`/api/storyboard-items/${itemId}`"),
        (episode_data_service, "return apiJson<any>(`/api/episodes/${episodeId}/video-segments`"),
        (episode_data_service, "return apiJson<any>(`/api/episodes/${episodeId}/audio-tracks`"),
        (episode_data_service, "return apiJson<any>(`/api/episodes/${episodeId}/script`"),
        (episode_data_service, "return apiJson<any>(`/api/projects/${projectId}/character-voices`"),
        (episode_data_service, "return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/batch`"),
        (episode_data_service, "return apiJson<any>(`/api/episodes/${episodeId}/extract-to-assets`"),
        (audio_generation_service, "import { apiJson } from './httpClient';"),
        (audio_generation_service, "return apiJson<any>(`/api/episodes/${episodeId}/audio-tracks`"),
        (audio_generation_service, "return apiJson<any>(`/api/audio-tracks/${trackId}`"),
        (audio_generation_service, "return apiJson<any>('/api/audio/generate-speech'"),
        (audio_generation_service, "return apiJson<any>('/api/audio/generate-sfx'"),
        (audio_generation_service, "return apiJson<any>('/api/audio/generate-music'"),
        (audio_generation_service, "return apiJson<any>('/api/character-voices'"),
        (audio_generation_service, "return apiJson<any>(`/api/character-voices/${voiceId}`"),
        (audio_generation_service, "return apiJson<any>('/api/minimax/voice-design'"),
        (audio_generation_service, "return apiJson<any>('/api/minimax/voice-clone'"),
        (audio_generation_service, "return apiJson<any>(`/api/minimax/voices?voice_type=${encodeURIComponent(voiceType)}`"),
        (audio_generation_service, "return apiJson<any>(`/api/minimax/voices/${voiceId}`"),
        (audio_generation_service, "return apiJson<any>('/api/minimax/tts'"),
        (audio_generation_service, "return apiJson<any>('/api/minimax/tts/sync'"),
        (audio_generation_service, "return apiJson<any>('/api/minimax/music'"),
        (audio_generation_service, "return apiJson<any>('/api/minimax/lyrics'"),
        (audio_generation_service, "return apiJson<any>('/api/minimax/files/upload'"),
        (audio_generation_service, "return apiJson<any>(`/api/minimax/files/${fileId}`"),
        (video_workflow_service, "import { apiJson } from './httpClient';"),
        (video_workflow_service, "return apiJson<any>(`/api/episodes/${episodeId}/video-segments`"),
        (video_workflow_service, "return apiJson<any>(`/api/video-segments/${segmentId}`"),
        (video_workflow_service, "apiJson<any>('/api/video/capabilities'"),
        (video_workflow_service, "return apiJson<any>(`/api/episodes/${episodeId}/video-takes`"),
        (video_workflow_service, "return apiJson<any>(`/api/episodes/${episodeId}/compose`"),
        (video_workflow_service, "return apiJson<any>(`/api/episodes/${episodeId}/compose/status`"),
        (asset_mutation_service, "import { apiJson } from './httpClient';"),
        (asset_mutation_service, "return apiJson<any>('/api/assets'"),
        (asset_mutation_service, "return apiJson<any>(`/api/assets/${assetId}`"),
        (asset_mutation_service, "return apiJson<any>(`/api/assets/${assetId}/share`"),
        (storyboard_mutation_service, "import { apiJson } from './httpClient';"),
        (storyboard_mutation_service, "return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items`"),
        (storyboard_mutation_service, "return apiJson<any>(`/api/storyboard-items/${itemId}`"),
        (storyboard_mutation_service, "`/api/episodes/${episodeId}/storyboard-items/all${qs}`"),
        (storyboard_mutation_service, "return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/reorder`"),
        (storyboard_mutation_service, "return apiJson<any>(`/api/episodes/${episodeId}/export-script`"),
        (script_timeline_service, "import { apiJson } from './httpClient';"),
        (script_timeline_service, "return apiJson<any>(`/api/episodes/${episodeId}/scripts`"),
        (script_timeline_service, "return apiJson<any>(`/api/episodes/${episodeId}/scripts/${scriptId}`"),
        (script_timeline_service, "return apiJson<any>(\n    `/api/episodes/${episodeId}/script-segments${qs}`"),
        (script_timeline_service, "return apiJson<any>(`/api/episodes/${episodeId}/script-segments/batch`"),
        (script_timeline_service, "return apiJson<any>(`/api/episodes/${episodeId}/timeline-tracks`"),
        (script_timeline_service, "return apiJson<any>(`/api/timeline-tracks/${trackId}`"),
        (admin_compat_service, "import { apiJson } from './httpClient';"),
        (admin_compat_service, "return apiJson<any>('/api/admin/users'"),
        (admin_compat_service, "return apiJson<any>('/api/admin/users/create'"),
        (admin_compat_service, "return apiJson<any>(`/api/admin/users/${userId}/permissions`"),
        (admin_compat_service, "return apiJson<any>(`/api/admin/users/${userId}`"),
        (admin_compat_service, "return apiJson<any>(`/api/admin/logs?limit=${limit}`"),
        (admin_compat_service, "return apiJson<any>(`/api/admin/stats${qs}`"),
        (comfyui_bridge_service, "import { apiBlob, apiJson, getAuthToken, publicBlob, secureApiUrl } from './httpClient';"),
        (comfyui_bridge_service, "function normalizeImageSourceUrl("),
        (comfyui_bridge_service, "function isSameOriginUrl("),
        (comfyui_bridge_service, "secureApiUrl(absolute, { requireAuth: false })"),
        (comfyui_bridge_service, "apiBlob("),
        (comfyui_bridge_service, "publicBlob(imageUrlOrDataUrl"),
        (comfyui_bridge_service, "publicBlob(absolute"),
        (comfyui_bridge_service, "return apiJson<any>('/api/comfyui/upload'"),
        (comfyui_bridge_service, "return apiJson<any>('/api/materials/process'"),
        (project_workflow_service, "import { apiJson } from './httpClient';"),
        (project_workflow_service, "return apiJson<any>('/api/projects/save'"),
        (project_workflow_service, "return apiJson<any>(`/api/projects/list${suffix}`"),
        (project_workflow_service, "return apiJson<any>(`/api/projects/${projectId}`"),
        (project_workflow_service, "return apiJson<any>(`/api/projects/${projectId}/export-to-video`"),
        (project_workflow_service, "return apiJson<any>(`/api/projects/${projectId}/members`"),
        (project_workflow_service, "return apiJson<any>(`/api/projects/${projectId}/members/${memberUserId}`"),
        (project_workflow_service, "return apiJson<any>(`/api/projects/${projectId}/episodes`"),
        (project_workflow_service, "return apiJson<any>(`/api/episodes/${episodeId}`"),
        (canvas_service, "import { apiJson } from './httpClient';"),
        (canvas_service, "return apiJson<any>('/api/canvas/boards'"),
        (canvas_service, "return apiJson<any>(`/api/canvas/boards?${qs.toString()}`"),
        (canvas_service, "return apiJson<any>(`/api/canvas/boards/${boardId}`"),
        (canvas_service, "return apiJson<any>('/api/canvas/nodes'"),
        (canvas_service, "return apiJson<any>(`/api/canvas/nodes/${nodeId}`"),
        (canvas_service, "return apiJson<any>('/api/canvas/connections'"),
        (canvas_service, "return apiJson<any>(`/api/canvas/connections/${connectionId}`"),
        (new_html / "__tests__" / "services" / "audioGenerationService.test.ts", "starts asynchronous MiniMax TTS tasks with AbortSignal passthrough"),
        (new_html / "__tests__" / "services" / "videoWorkflowService.test.ts", "fetchSeedanceOmni caches video capability responses"),
        (new_html / "__tests__" / "services" / "videoMediaService.test.ts", "secures media URLs with the current auth token"),
        (new_html / "__tests__" / "services" / "dashScopeParams.test.ts", "from '../../services/videoModelService'"),
        (new_html / "__tests__" / "components" / "DashScopeCards.test.tsx", "from '../../services/videoModelService'"),
        (new_html / "__tests__" / "services" / "assetMutationService.test.ts", "shares assets to target episode and script"),
        (new_html / "__tests__" / "services" / "storyboardMutationService.test.ts", "deletes all storyboard items for a script scope"),
        (new_html / "__tests__" / "services" / "scriptTimelineService.test.ts", "batch saves and deletes script segments"),
        (new_html / "__tests__" / "services" / "adminCompatService.test.ts", "updates user permissions by id"),
        (new_html / "__tests__" / "services" / "minimaxTTSSync.test.ts", "from '../../services/audioGenerationService'"),
        (new_html / "__tests__" / "services" / "comfyuiBridgeService.test.ts", "downloads same-origin image through shared authenticated blob client"),
        (new_html / "__tests__" / "services" / "comfyuiBridgeService.test.ts", "does not attach local auth token to external image downloads"),
        (new_html / "__tests__" / "services" / "comfyuiBridgeService.test.ts", "downloads blob URLs through public blob helper without auth headers"),
        (new_html / "__tests__" / "services" / "projectWorkflowService.test.ts", "exports selected storyboard items to video"),
        (new_html / "__tests__" / "services" / "canvasService.test.ts", "creates, lists, updates, and deletes canvas boards"),
        (video_page, "secureMediaUrl("),
        (video_page, "getProjectVideoTasks("),
        (video_page, "clearProjectVideoTasks("),
        (video_page, "import('./video/SeedancePanelWithCandidates')"),
        (video_page, "import('./video/DashScopeCardWithCandidates')"),
        (video_page, "import('./video/SeedanceDetailModal')"),
        (video_page, "import('./video/StoryboardSyncModal')"),
        (video_page, "VideoProviderPanelFallback"),
        (video_page, "VideoModalFallback"),
        (video_page, "import type { SyncMode } from './video/StoryboardSyncModal';"),
        (video_page, "{syncModalOpen && ("),
        (video_card, "Heavy provider panels live in separate lazy-loaded modules."),
        (seedance_panel_with_candidates, "from '../SeedanceMultimodalPanel'"),
        (seedance_panel_with_candidates, "useSeedanceCandidates"),
        (dash_scope_card_with_candidates, "from './DashScopeCards'"),
        (dash_scope_card_with_candidates, "SeedanceMentionPromptEditor"),
        (project_hub, "import { apiJson } from '../services/httpClient'"),
        (project_hub, "apiJson<any>(`/api/projects?"),
        (episode_hub, "import { apiJson } from '../services/httpClient'"),
        (episode_hub, "apiJson<any>(`/api/projects/${projectId}/episodes`"),
        (history_page, "import { apiJson, secureApiUrl } from '../services/httpClient'"),
        (history_page, "secureApiUrl(file.fileUrl, { absolute: true })"),
        (header, "import { apiFetch } from '../services/httpClient'"),
        (header, "apiFetch('/api/logout'"),
        (project_context, "import { apiJson } from '../services/httpClient'"),
        (project_context, "apiJson<any>(`/api/projects/${projectId}`"),
        (workspace_app, "import { getAuthToken } from './services/httpClient'"),
        (workspace_app, "const token = getAuthToken();"),
        (workflow_generation_page, "import { secureApiUrl } from '../services/httpClient'"),
        (workflow_generation_page, "return secureApiUrl(url, { requireAuth: false });"),
        (video_gen_page, "import { secureApiUrl } from '../services/httpClient'"),
        (video_gen_page, "return secureApiUrl(url, { absolute: true, requireAuth: false });"),
        (dash_scope_cards, "import { secureApiUrl } from '../../services/httpClient'"),
        (dash_scope_cards, "secureApiUrl(firstRefUrl, { absolute: true, requireAuth: false })"),
        (global_task_manager, "import { authTokenFromHeaders } from './httpClient'"),
        (global_task_manager, "from './taskNotificationService'"),
        (global_task_manager, "authTokenFromHeaders({ requireAuth: false })"),
        (episode_context, "from '../services/episodeDataService'"),
        (use_episode_data, "from '../services/episodeDataService'"),
        (workspace_app, "from './services/episodeDataService'"),
        (workspace_app, "from './services/storyboardMutationService'"),
        (workspace_app, "from './services/scriptTimelineService'"),
        (workspace_app, "import('./services/projectWorkflowService')"),
        (audio_stage_page, "from '../services/audioGenerationService'"),
        (audio_stage_page, "from '../services/episodeDataService'"),
        (audio_stage_page, "from '../services/storyboardMutationService'"),
        (workflow_generation_page, "from '../services/episodeDataService'"),
        (workflow_generation_page, "from '../services/videoWorkflowService'"),
        (video_gen_page, "from '../services/episodeDataService'"),
        (enhance_page, "from '../services/episodeDataService'"),
        (enhance_page, "from '../services/videoWorkflowService'"),
        (final_product_page, "from '../services/videoWorkflowService'"),
        (video_page, "from '../services/videoWorkflowService'"),
        (seedance_multimodal_panel, "from '../services/videoWorkflowService'"),
        (seedance_multimodal_panel, "from '../services/videoMediaService'"),
        (workflow_materials_page, "from '../services/episodeDataService'"),
        (workflow_materials_page, "from '../services/assetMutationService'"),
        (storyboard_page, "from '../services/storyboardMutationService'"),
        (design_page, "from '../services/assetMutationService'"),
        (voice_sidebar, "from '../../services/audioGenerationService'"),
        (music_modal, "from '../../services/audioGenerationService'"),
        (admin_login_page, "import { apiJson } from '../services/httpClient'"),
        (admin_login_page, "apiJson<any>('/api/login'"),
        (admin_login_page, "{ requireAuth: false }"),
        (design_page, "import { apiBlob, secureApiUrl } from '../services/httpClient'"),
        (design_page, "secureApiUrl(normalized, { absolute: true })"),
        (design_page, "apiBlob(secured, { method: 'GET' }, '下载图片'"),
        (material_page, "import { apiBlob, secureApiUrl } from '../services/httpClient'"),
        (material_page, "secureApiUrl(normalized, { absolute: true })"),
        (material_page, "apiBlob(downloadUrl, { method: 'GET' }, '下载生成的图片'"),
        (generation_page, "import { apiBlob, secureApiUrl } from '../services/httpClient'"),
        (generation_page, "from '../services/comfyuiGenerationService'"),
        (generation_page, "from '../services/comfyuiTaskWaitService'"),
        (generation_page, "from '../services/geminiImageGenerationService'"),
        (material_page, "from '../services/comfyuiGenerationService'"),
        (material_page, "from '../services/comfyuiTaskWaitService'"),
        (material_page, "from '../services/geminiImageGenerationService'"),
        (design_page, "from '../services/comfyuiGenerationService'"),
        (design_page, "from '../services/comfyuiTaskWaitService'"),
        (design_page, "from '../services/geminiImageGenerationService'"),
        (generation_page, "function normalizeImageDownloadUrl("),
        (generation_page, "downloadImageBlob(imageUrl, '加载完整图片')"),
        (admin_feature_tabs, "import { apiJson } from '../services/httpClient'"),
        (admin_feature_tabs, "apiJson<T>(url, { method: 'GET' }, 'Admin API')"),
        (admin_organizations_tab, "import { apiJson } from '../services/httpClient'"),
        (admin_organizations_tab, "apiJson<{ users: any[] }>('/api/admin/users?limit=500'"),
        (admin_hub_page, "import { apiJson } from '../services/httpClient'"),
        (admin_hub_page, "apiJson<any>(url, { method: 'GET' }, 'Admin Hub KPI')"),
        (admin_page, "from '../services/adminCompatService'"),
        (admin_page, "import { apiJson } from '../services/httpClient'"),
        (admin_page, "const normalizeClusterNodeRows = (nodes: ClusterNodesResponse['nodes'])"),
        (admin_page, "const mapClusterNode = ([nodeId, nodeData]: [string, any]): ServerNode =>"),
        (admin_page, "const data = (await apiJson("),
        (admin_page, ")) as ClusterNodesResponse;"),
        (admin_page, "data.agent_only_mode"),
        (admin_page, "const hasStorageMetric = node.storageTotal > 0;"),
        (admin_settings_page, "import { apiJson } from '../services/httpClient'"),
        (admin_settings_page, "apiJson<ApiConfigsResponse>('/api/admin/api-configs')"),
        (new_html / "components" / "ShareResourceDialog.tsx", "from '../services/projectWorkflowService'"),
    ]
    forbidden_snippets = [
        "function getHeaders",
        "const getHeaders",
        "localStorage.getItem('auth_token')",
        'localStorage.getItem("auth_token")',
        "localStorage.removeItem('auth_token')",
        'localStorage.removeItem("auth_token")',
        "Authorization:",
        "'Authorization'",
        '"Authorization"',
        "Bearer ",
        "API_BASE",
        "handleResponse",
        "fetch(",
    ]

    for path, snippet in required_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing frontend httpClient contract snippet in {path.relative_to(root)}: {snippet}")
        checks += 1

    video_card_text = video_card.read_text(encoding="utf-8")
    for snippet in [
        "SeedanceMultimodalPanel",
        "DashScopeCards",
        "DashScopeVideoCard",
        "SeedanceMentionPromptEditor",
    ]:
        if snippet in video_card_text:
            fail(f"VideoCard core must not statically import heavy provider panels: {snippet}")
        checks += 1

    video_page_text = video_page.read_text(encoding="utf-8")
    for snippet in [
        "import { SeedanceDetailModal }",
        "import { StoryboardSyncModal",
    ]:
        if snippet in video_page_text:
            fail(f"VideoPage must lazy-load modal/provider chunks: {snippet}")
        checks += 1

    video_task_service_text = video_task_service.read_text(encoding="utf-8")
    for snippet in [
        "export async function cancelTask(",
        "export async function deleteTask(",
    ]:
        if snippet in video_task_service_text:
            fail(f"videoTaskService must delegate task controls to taskControlService: {snippet}")
        checks += 1

    for path in migrated_services:
        text = path.read_text(encoding="utf-8")
        if "./httpClient" not in text:
            fail(f"Frontend service must use shared httpClient: {path.relative_to(root)}")
        checks += 1
        for snippet in forbidden_snippets:
            if snippet in text:
                fail(f"Frontend service has duplicated request/auth logic in {path.relative_to(root)}: {snippet}")
            checks += 1

    for path in migrated_pages:
        text = path.read_text(encoding="utf-8")
        if "../services/httpClient" not in text:
            fail(f"Frontend page must use shared httpClient: {path.relative_to(root)}")
        checks += 1
        for snippet in ["getHeaders(", "Authorization:", "'Authorization'", '"Authorization"', "Bearer ", "handleResponse", "fetch("]:
            if snippet in text:
                fail(f"Frontend page has duplicated request/auth logic in {path.relative_to(root)}: {snippet}")
            checks += 1

    api_service_text = api_service.read_text(encoding="utf-8")
    comfyui_generation_service_text = comfyui_generation_service.read_text(encoding="utf-8")
    for snippet in [
        "const API_BASE",
        "fetch(`${API_BASE}/api/",
        "localStorage.getItem('auth_token')",
        'localStorage.getItem("auth_token")',
    ]:
        if snippet in api_service_text:
            fail(f"apiService must not own API-base fetch/auth plumbing: {snippet}")
        checks += 1

    for snippet in ["await import('./apiService')", 'await import("./apiService")']:
        if snippet in comfyui_generation_service_text:
            fail(f"comfyuiGenerationService must import comfyuiBridgeService instead of apiService: {snippet}")
        checks += 1

    gemini_service_text = (new_html / "services" / "geminiService.ts").read_text(encoding="utf-8")
    for snippet in [
        "from './comfyuiGenerationService'",
        'from "./comfyuiGenerationService"',
        "export * from './comfyuiGenerationService'",
        'export * from "./comfyuiGenerationService"',
    ]:
        if snippet in gemini_service_text:
            fail(f"geminiService must not re-export or import ComfyUI generation service: {snippet}")
        checks += 1

    for path in [generation_page, material_page, design_page]:
        text = path.read_text(encoding="utf-8")
        for snippet in [
            "from '../services/geminiService'",
            'from "../services/geminiService"',
            "import('../services/geminiService')",
            'import("../services/geminiService")',
        ]:
            if snippet in text:
                fail(f"Image-heavy pages must import Gemini image helpers directly: {path.relative_to(root)} has {snippet}")
            checks += 1

    direct_auth_token_allowed = {
        new_html / "admin" / "adminAuth.ts",
    }
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or "__tests__" in path.parts:
            continue
        if path in direct_auth_token_allowed:
            continue
        text = path.read_text(encoding="utf-8")
        for snippet in [
            "localStorage.getItem('auth_token')",
            'localStorage.getItem("auth_token")',
        ]:
            if snippet in text:
                fail(f"Frontend auth token reads must go through httpClient/adminAuth: {path.relative_to(root)}")
            checks += 1

    direct_fetch_allowed = {
        new_html / "services" / "httpClient.ts",
    }
    direct_xhr_allowed = {
        video_media_service,
    }
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if (
            path in direct_fetch_allowed
            or "__tests__" in path.parts
            or "node_modules" in path.parts
            or path.name == "vite.config.ts"
        ):
            continue
        text = path.read_text(encoding="utf-8")
        if "fetch(" in text:
            fail(f"Frontend direct fetch must go through services/httpClient.ts: {path.relative_to(root)}")
        checks += 1

        if "XMLHttpRequest" in text and path not in direct_xhr_allowed:
            fail(
                "Frontend XMLHttpRequest is only allowed in services/videoMediaService.ts "
                f"for upload progress: {path.relative_to(root)}"
            )
        checks += 1

    video_media_service_text = video_media_service.read_text(encoding="utf-8")
    for snippet in [
        "const xhr = new XMLHttpRequest();",
        "const headers = buildAuthHeaders(undefined, { requireAuth: false, includeContentType: false });",
        "handleUnauthorized('uploadMedia')",
    ]:
        if snippet not in video_media_service_text:
            fail(f"videoMediaService upload XHR must stay on shared auth/error helpers: missing {snippet}")
        checks += 1

    for snippet in [
        "fetch(`${API_BASE}/api/tasks/active`",
        "fetch(`${API_BASE}/api/notifications/unread-count`",
        "fetch(`${API_BASE}/api/notifications?${params}`",
        "fetch(`${API_BASE}/api/notifications/${notificationId}/read`",
        "fetch(`${API_BASE}/api/notifications/read-all`",
        "fetch(`${API_BASE}/api/notifications/${notificationId}`",
        "fetch(`${API_BASE}/api/projects/save`",
        "fetch(`${API_BASE}/api/projects/list${suffix}`",
        "fetch(`${API_BASE}/api/projects/${projectId}`",
        "fetch(`${API_BASE}/api/projects/${projectId}/export-to-video`",
        "fetch(`${API_BASE}/api/materials/process`",
        "fetch(`${API_BASE}/api/projects/${projectId}/members`",
        "fetch(`${API_BASE}/api/projects/${projectId}/members/${memberUserId}`",
        "fetch(`${API_BASE}/api/projects/${projectId}/episodes`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}`",
        "fetch(`${API_BASE}/api/projects/${projectId}/assets${qs}`",
        "fetch(`${API_BASE}/api/assets`",
        "fetch(`${API_BASE}/api/assets/${assetId}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items${qs}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items`",
        "fetch(`${API_BASE}/api/storyboard-items/${itemId}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items/all${qs}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items/reorder`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/video-segments`",
        "fetch(`${API_BASE}/api/video-segments/${segmentId}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/audio-tracks`",
        "fetch(`${API_BASE}/api/audio-tracks/${trackId}`",
        "fetch(`${API_BASE}/api/video/capabilities`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/video-takes`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/compose`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/compose/status`",
        "fetch(`${API_BASE}/api/audio/generate-speech`",
        "fetch(`${API_BASE}/api/audio/generate-sfx`",
        "fetch(`${API_BASE}/api/audio/generate-music`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/script`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/scripts`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/scripts/${scriptId}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/script-segments${qs}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/script-segments/batch`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/timeline-tracks`",
        "fetch(`${API_BASE}/api/timeline-tracks/${trackId}`",
        "fetch(`${API_BASE}/api/projects/${projectId}/character-voices`",
        "fetch(`${API_BASE}/api/character-voices`",
        "fetch(`${API_BASE}/api/character-voices/${voiceId}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items/batch`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/extract-to-assets`",
        "fetch(`${API_BASE}/api/assets/${assetId}/share`",
        "fetch(`${API_BASE}/api/minimax/voice-design`",
        "fetch(`${API_BASE}/api/minimax/voice-clone`",
        "fetch(`${API_BASE}/api/minimax/voices?voice_type=${encodeURIComponent(voiceType)}`",
        "fetch(`${API_BASE}/api/minimax/voices/${voiceId}`",
        "fetch(`${API_BASE}/api/minimax/tts`",
        "fetch(`${API_BASE}/api/minimax/tts/sync`",
        "fetch(`${API_BASE}/api/minimax/music`",
        "fetch(`${API_BASE}/api/minimax/lyrics`",
        "fetch(`${API_BASE}/api/minimax/files/${fileId}`",
        "fetch(`${API_BASE}/api/episodes/${episodeId}/export-script`",
        "fetch(`${API_BASE}/api/canvas/boards`",
        "fetch(`${API_BASE}/api/canvas/boards?project_id=${projectId}`",
        "fetch(`${API_BASE}/api/canvas/boards/${boardId}`",
        "fetch(`${API_BASE}/api/canvas/nodes`",
        "fetch(`${API_BASE}/api/canvas/nodes/${nodeId}`",
        "fetch(`${API_BASE}/api/canvas/connections`",
        "fetch(`${API_BASE}/api/canvas/connections/${connectionId}`",
    ]:
        if snippet in api_service_text:
            fail(f"apiService task/notification endpoints must use shared httpClient: {snippet}")
        checks += 1

    video_page_text = video_page.read_text(encoding="utf-8")
    for snippet in [
        "localStorage.getItem('auth_token')",
        'localStorage.getItem("auth_token")',
        "Authorization:",
        "'Authorization'",
        '"Authorization"',
        "Bearer ",
        "fetch(",
    ]:
        if snippet in video_page_text:
            fail(f"VideoPage must route video requests/media auth through videoService: {snippet}")
        checks += 1

    admin_page_text = admin_page.read_text(encoding="utf-8")
    for snippet in [
        "storageUsed: Math.floor(Math.random() * 1000)",
        "gpuUsage: nodeData.gpu_usage || Math.floor(Math.random() * 100)",
        "setNodes(generateLocalNodes())",
        "name: 'Local-Node-01'",
    ]:
        if snippet in admin_page_text:
            fail(f"AdminPage cluster nodes must not use fake local/random metrics: {snippet}")
        checks += 1
    return checks


def check_service_mapper_purity_contract(root: Path) -> int:
    """Service layer should not grow new direct SQL outside tracked transaction exceptions."""
    allowed_direct_sql: set[Path] = set()
    service_root = root / "services"
    dao_root = root / "dao"
    forbidden_snippets = [
        "SELECT ",
        "INSERT ",
        "UPDATE ",
        "DELETE ",
        "conn.fetch",
        "conn.execute",
        "pool.acquire(",
        "db.acquire(",
        "db.pool.acquire(",
        "from database import",
        "import database",
        "get_pool(",
        "get_connection(",
        "conn=",
        "conn =",
    ]
    forbidden_service_patterns = [
        (re.compile(r"(['\"]{3}|['\"])\s*(SELECT|INSERT|UPDATE|DELETE)\b", re.IGNORECASE), "SQL literal"),
        (re.compile(r"\bconn\.(fetch|fetchrow|fetchval|execute|executemany)\s*\("), "connection operation"),
        (re.compile(r"\bpool\.(fetch|fetchrow|fetchval|execute|executemany|acquire)\s*\("), "pool operation"),
        (re.compile(r"\bdb\.(fetch|fetchrow|fetchval|execute|executemany|acquire)\s*\("), "database operation"),
        (re.compile(r"\b(pool|conn|connection)\s*="), "service-local DB handle"),
    ]
    forbidden_dao_exposure_patterns = [
        (re.compile(r"\breturn\s+(conn|connection|pool|db)\b"), "DAO returns a DB handle"),
        (re.compile(r"\b(?:async\s+)?def\s+(?:get_)?(?:conn|connection|pool)\s*\("), "DAO exposes a DB handle getter"),
    ]
    violations: list[str] = []
    checks = 0
    for path in service_root.rglob("*.py"):
        if path in allowed_direct_sql:
            continue
        text = path.read_text(encoding="utf-8")
        for snippet in forbidden_snippets:
            if snippet in text:
                violations.append(f"{path.relative_to(root)} contains direct DB operation: {snippet}")
            checks += 1
        for pattern, label in forbidden_service_patterns:
            if pattern.search(text):
                violations.append(f"{path.relative_to(root)} contains direct {label}")
            checks += 1

    for path in dao_root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for pattern, label in forbidden_dao_exposure_patterns:
            if pattern.search(text):
                violations.append(f"{path.relative_to(root)} exposes connection plumbing: {label}")
            checks += 1

    required_snippets = [
        (root / "dao" / "content" / "entity_file.py", "async def sync_legacy_url("),
        (root / "dao" / "content" / "entity_file.py", "async def count_user_files("),
        (root / "dao" / "business" / "credit.py", "class CreditLedgerDAO:"),
        (root / "dao" / "business" / "credit.py", "async def freeze_credits("),
        (root / "dao" / "business" / "credit.py", "async def confirm_task_freeze("),
        (root / "dao" / "business" / "task.py", "async def get_active_tasks_for_user("),
        (root / "dao" / "business" / "task.py", "async def get_terminal_tasks_for_notifications("),
        (root / "dao" / "business" / "task.py", "if not db:\n            return None"),
        (root / "dao" / "content" / "content.py", "async def soft_delete_user_files_by_path_fragment("),
        (root / "dao" / "content" / "content.py", "get_file skipped because database manager is unavailable"),
        (root / "dao" / "content" / "content.py", "async def update_project_metadata("),
        (root / "dao" / "creative" / "episode.py", "async def get_project_id("),
        (root / "dao" / "creative" / "episode_compose.py", "class EpisodeComposeDAO:"),
        (root / "dao" / "creative" / "episode_compose.py", "async def list_shot_take_rows("),
        (root / "dao" / "creative" / "episode_compose.py", "async def create_final_cut_records("),
        (root / "dao" / "creative" / "asset.py", "async def create_missing_episode_assets_transactional("),
        (root / "dao" / "creative" / "storyboard.py", "async def export_script_transaction("),
        (root / "dao" / "creative" / "storyboard.py", "async def delete_by_episode_transactional("),
        (root / "dao" / "user" / "user.py", "async def admin_get_user_detail("),
        (root / "dao" / "user" / "user.py", "async def delete_user_by_id("),
        (root / "dao" / "admin" / "admin_stats.py", "class AdminStatsDAO:"),
        (root / "dao" / "admin" / "admin_stats.py", "async def get_summary_stats("),
        (root / "dao" / "admin" / "admin_stats.py", "async def get_generation_logs("),
        (root / "dao" / "admin" / "admin_stats.py", "async def get_stats_breakdown("),
        (root / "services" / "file_service.py", "EntityFileDAO.sync_legacy_url("),
        (root / "routers" / "entity_files.py", "list_user_files("),
        (root / "routers" / "entity_files.py", "select_entity_file_service("),
        (root / "services" / "entity_file_service.py", "entity_file_dao.count_user_files("),
        (root / "services" / "entity_file_service.py", "entity_file_dao.sync_legacy_url("),
        (root / "routers" / "task_notifications.py", "TaskDAO.get_active_tasks_for_user("),
        (root / "routers" / "task_notifications.py", "TaskDAO.get_terminal_tasks_for_notifications("),
        (root / "services" / "episode_video_service.py", "episode_dao.get_project_id("),
        (root / "routers" / "episode_video.py", "start_episode_compose("),
        (root / "routers" / "video_capabilities.py", "get_video_capabilities("),
        (root / "services" / "video_capability_service.py", "AgentDAO.get_online_agents("),
        (root / "routers" / "prompts.py", "get_prompt_template_service("),
        (root / "services" / "prompt_service.py", "prompt_template_dao.load_template("),
        (root / "routers" / "tasks.py", "get_task_status_response("),
        (root / "routers" / "tasks.py", "list_user_tasks_response("),
        (root / "routers" / "tasks.py", "soft_delete_user_file_by_path_fragment("),
        (root / "services" / "task_read_service.py", "async def get_task_status_response("),
        (root / "services" / "task_read_service.py", "async def list_user_tasks_response("),
        (root / "services" / "task_read_service.py", "async def soft_delete_user_file_by_path_fragment("),
        (root / "services" / "credit_service.py", "CreditLedgerDAO.freeze_credits("),
        (root / "services" / "episode_compose_service.py", "EpisodeComposeDAO.list_shot_take_rows("),
        (root / "services" / "episode_compose_service.py", "EpisodeComposeDAO.create_final_cut_records("),
        (root / "services" / "project_admin_service.py", "project_dao.update_project_metadata("),
        (root / "services" / "storyboard_service.py", "storyboard_dao.export_script_transaction("),
        (root / "routers" / "admin_compat.py", "UserDAO.delete_user_by_id("),
        (root / "routers" / "admin_compat.py", "AdminStatsDAO.get_summary_stats("),
        (root / "routers" / "admin_compat.py", "AdminStatsDAO.get_generation_logs("),
        (root / "routers" / "admin_compat.py", "AdminStatsDAO.get_stats_breakdown("),
        (root / "admin_routes.py", "UserDAO.admin_get_user_detail("),
    ]
    for path, snippet in required_snippets:
        if snippet not in path.read_text(encoding="utf-8"):
            violations.append(f"Missing mapper purity snippet in {path.relative_to(root)}: {snippet}")
        checks += 1

    entity_files_router_text = (root / "routers" / "entity_files.py").read_text(encoding="utf-8")
    for snippet in [
        "SELECT COUNT(*) FROM files WHERE user_id",
        "fetchval(count_query",
        "count_query =",
    ]:
        if snippet in entity_files_router_text:
            violations.append(f"routers/entity_files.py must delegate user file counts to EntityFileDAO: {snippet}")
        checks += 1

    task_notifications_router_text = (root / "routers" / "task_notifications.py").read_text(encoding="utf-8")
    for snippet in [
        "SELECT task_id, task_type, status, project_id, category",
        "get_db_manager_func",
        "db = get_db_manager_func()",
        "tasks = await db.fetch(query",
    ]:
        if snippet in task_notifications_router_text:
            violations.append(f"routers/task_notifications.py must delegate task lookups to TaskDAO: {snippet}")
        checks += 1

    admin_compat_router_text = (root / "routers" / "admin_compat.py").read_text(encoding="utf-8")
    for snippet in [
        "DELETE FROM users WHERE user_id",
        "WITH u_files AS",
        "FROM organization_members om",
        "per_user_sql",
        "stats['totalProjects'] = await db_manager.fetchval",
        "SELECT COUNT(*) FROM projects",
        "SELECT COUNT(*) FROM text_contents",
        "SELECT COUNT(*) FROM storyboard_items",
        "total_videos = await db_manager.fetchval",
        "SELECT storyboard FROM projects LIMIT 1",
        "SELECT p.project_id, p.user_id",
        "SELECT t.task_id, t.user_id",
        "video_types = [",
        "image_types = [",
        "text_types = [",
        "model_name_map = {",
    ]:
        if snippet in admin_compat_router_text:
            violations.append(f"routers/admin_compat.py must delegate admin reporting/deletion SQL to DAO methods: {snippet}")
        checks += 1

    admin_routes_text = (root / "admin_routes.py").read_text(encoding="utf-8")
    for snippet in [
        "db.fetchrow(",
        "SELECT user_id, username, email, avatar_url, role, status",
        "FROM users WHERE user_id = $1",
    ]:
        if snippet in admin_routes_text:
            violations.append(f"admin_routes.py must delegate admin user detail SQL to UserDAO: {snippet}")
        checks += 1

    episode_video_router_text = (root / "routers" / "episode_video.py").read_text(encoding="utf-8")
    episode_video_service_text = (root / "services" / "episode_video_service.py").read_text(encoding="utf-8")
    for path, snippet in [
        (root / "services" / "episode_video_service.py", "from services import episode_compose_service"),
        (root / "services" / "episode_video_service.py", "compose_service.get_takes("),
        (root / "services" / "episode_video_service.py", "compose_service.start_compose("),
        (root / "services" / "episode_video_service.py", "compose_service.get_status("),
        (root / "compose_service.py", "from services.episode_compose_service import *"),
    ]:
        if snippet not in path.read_text(encoding="utf-8"):
            violations.append(f"Missing episode compose boundary snippet in {path.relative_to(root)}: {snippet}")
        checks += 1
    for snippet in [
        "SELECT project_id FROM episodes",
        "get_db_manager_func",
        "db.fetchrow(",
        "import compose_service",
    ]:
        if snippet in episode_video_router_text:
            violations.append(f"routers/episode_video.py must delegate episode project lookup to EpisodeDAO: {snippet}")
        checks += 1
    if re.search(r"(?<!episode_)compose_service\.", episode_video_router_text):
        violations.append("routers/episode_video.py must call services.episode_compose_service, not legacy compose_service")
    checks += 1
    if "episode_compose_service." in episode_video_service_text:
        violations.append("services/episode_video_service.py must use injected compose_service calls")
    checks += 1
    compose_shim_text = (root / "compose_service.py").read_text(encoding="utf-8")
    for snippet in [
        "get_db_manager",
        "SELECT ",
        "INSERT ",
        "UPDATE ",
        "DELETE ",
        "db.fetch",
        "db.execute",
    ]:
        if snippet in compose_shim_text:
            violations.append(f"compose_service.py must stay a compatibility shim with no DB logic: {snippet}")
        checks += 1

    tasks_router_text = (root / "routers" / "tasks.py").read_text(encoding="utf-8")
    for snippet in [
        "UPDATE files",
        "RETURNING file_id",
        "result = await db.execute(",
        "if get_db_manager():",
        "db = get_db_manager()",
        "get_db_manager: Any",
        "get_db_manager=get_db_manager",
        "await task_dao.get_task_by_task_id(",
        "await task_dao.get_task(",
        "await task_dao.get_user_tasks(",
        "await task_dao.delete_task(",
        "FileDAO.soft_delete_user_files_by_path_fragment(",
    ]:
        if snippet in tasks_router_text:
            violations.append(f"routers/tasks.py must delegate task read/DB fallback work to task_read_service/DAO boundaries: {snippet}")
        checks += 1

    task_read_service_text = (root / "services" / "task_read_service.py").read_text(encoding="utf-8")
    for snippet in [
        "get_db_manager",
        "database_available(",
    ]:
        if snippet in task_read_service_text:
            violations.append(f"services/task_read_service.py must not receive DB connection plumbing: {snippet}")
        checks += 1

    files_router_text = (root / "routers" / "files.py").read_text(encoding="utf-8")
    cluster_main_text = (root / "cluster_main.py").read_text(encoding="utf-8")
    for snippet in [
        "get_db_manager",
        "if get_db_manager():",
        "get_db_manager=lambda",
    ]:
        if snippet in files_router_text:
            violations.append(f"routers/files.py must delegate DB availability to FileDAO: {snippet}")
        checks += 1
    if re.search(r"create_files_router\([\s\S]{0,400}get_db_manager\s*=", cluster_main_text):
        violations.append("cluster_main.py still passes DB plumbing into create_files_router")
    checks += 1

    project_admin_router_text = (root / "routers" / "project_admin.py").read_text(encoding="utf-8")
    for snippet in [
        "get_db_manager_func",
        "UPDATE projects SET",
        "await db.execute(",
    ]:
        if snippet in project_admin_router_text:
            violations.append(f"routers/project_admin.py must delegate project metadata updates to ProjectDAO: {snippet}")
        checks += 1

    storyboard_router_text = (root / "routers" / "storyboard.py").read_text(encoding="utf-8")
    for snippet in [
        "get_db_manager_func",
        "db.acquire()",
        "conn.execute(",
        "conn.fetch(",
        "EpisodeScriptDAO.upsert_transactional(",
        "StoryboardDAO.batch_create_transactional(",
        "DELETE FROM storyboard_items",
        "SELECT asset_type, name FROM assets",
        "INSERT INTO assets",
    ]:
        if snippet in storyboard_router_text:
            violations.append(f"routers/storyboard.py must delegate export-script transaction SQL to DAO methods: {snippet}")
        checks += 1

    if violations:
        fail("Service mapper purity contract failed:\n" + "\n".join(violations))
    return checks


def check_frontend_lazy_video_contract(root: Path) -> int:
    lazy_video = root / "new_html" / "components" / "LazyVideo.tsx"
    video_page = root / "new_html" / "components" / "VideoPage.tsx"
    final_page = root / "new_html" / "pages" / "FinalProductPage.tsx"
    history_page = root / "new_html" / "components" / "HistoryPage.tsx"
    media_page = root / "new_html" / "pages" / "MediaLibraryPage.tsx"
    reverse_page = root / "new_html" / "pages" / "VideoReversePage.tsx"

    required_snippets = [
        (lazy_video, "IntersectionObserver"),
        (lazy_video, "src={videoSrc}"),
        (lazy_video, "preload={inView ? preload : 'none'}"),
        (lazy_video, "export const withVideoFirstFrame"),
        (video_page, "import { LazyVideo } from './LazyVideo';"),
        (final_page, "import { LazyVideo } from '../components/LazyVideo';"),
        (history_page, "import { LazyVideo } from './LazyVideo';"),
        (media_page, "import { LazyVideo } from '../components/LazyVideo';"),
        (reverse_page, "import { LazyVideo } from '../components/LazyVideo';"),
    ]
    forbidden_snippets = [
        (video_page, "const LazyVideo:"),
        (final_page, '<video src={featured.file_url}'),
        (final_page, '<video src={v.file_url}'),
        (final_page, '<video src={withFirstFrame(t.video_url)}'),
        (history_page, '<video\n                            src={mediaUrl}'),
        (media_page, '<video src={item.file_url}'),
        (reverse_page, '<video src={task.video_file_url}'),
    ]

    checks = 0
    for path, snippet in required_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing frontend lazy-video contract snippet in {path.relative_to(root)}: {snippet}")
        checks += 1
    for path, snippet in forbidden_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet in text:
            fail(f"Forbidden eager video snippet in {path.relative_to(root)}: {snippet}")
            checks += 1
    return checks


def check_frontend_lazy_image_contract(root: Path) -> int:
    """Storyboard/video preview images should delay binding src until near viewport."""
    lazy_image = root / "new_html" / "components" / "LazyImage.tsx"
    video_card = root / "new_html" / "components" / "video" / "VideoCard.tsx"
    lazy_image_test = root / "new_html" / "__tests__" / "components" / "LazyImage.test.tsx"

    required_snippets = [
        (lazy_image, "IntersectionObserver"),
        (lazy_image, "src={inView ? src : undefined}"),
        (lazy_image, "loading={loading}"),
        (lazy_image, "decoding={decoding}"),
        (video_card, "import { LazyImage } from '../LazyImage';"),
        (video_card, "<LazyImage src={image.url}"),
        (lazy_image_test, "does not bind src until the image enters the viewport"),
        (lazy_image_test, "expect(img.getAttribute('src')).toBeNull()"),
    ]
    forbidden_snippets = [
        (video_card, "<img src={image.url}"),
    ]

    checks = 0
    for path, snippet in required_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing frontend lazy-image contract snippet in {path.relative_to(root)}: {snippet}")
        checks += 1
    for path, snippet in forbidden_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet in text:
            fail(f"Forbidden eager image snippet in {path.relative_to(root)}: {snippet}")
        checks += 1
    return checks


def check_frontend_video_preload_contract(root: Path) -> int:
    """Video previews must not rely on browser-default eager preload behavior."""
    new_html = root / "new_html"
    violations: list[str] = []
    checks = 0

    for path in new_html.rglob("*.tsx"):
        if "node_modules" in path.parts or "dist" in path.parts:
            continue
        if path.name == "LazyVideo.tsx":
            continue
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"<video\b(?P<body>[\s\S]*?)(?:/>|>)", text):
            checks += 1
            body = match.group("body")
            if "preload=" not in body:
                line = text[: match.start()].count("\n") + 1
                violations.append(f"{path.relative_to(root)}:{line}: raw <video> must set preload explicitly")

    high_density_expectations = [
        (
            root / "new_html" / "components" / "VideoPage.tsx",
            3,
            "Video workflow result lists should keep LazyVideo preload='none'",
        ),
        (
            root / "new_html" / "components" / "HistoryPage.tsx",
            1,
            "History video grid should keep LazyVideo preload='none'",
        ),
        (
            root / "new_html" / "pages" / "FinalProductPage.tsx",
            2,
            "Final product video grids should keep LazyVideo preload='none'",
        ),
        (
            root / "new_html" / "pages" / "GenerationPage.tsx",
            1,
            "Workflow video preview should use preload='none'",
        ),
        (
            root / "new_html" / "pages" / "EnhancePage.tsx",
            1,
            "Enhance timeline video preview should use preload='none'",
        ),
    ]
    for path, minimum, label in high_density_expectations:
        text = path.read_text(encoding="utf-8")
        count = text.count('preload="none"')
        checks += 1
        if count < minimum:
            violations.append(f"{label}: expected at least {minimum}, found {count} in {path.relative_to(root)}")

    if violations:
        fail("Frontend video preload contract failed:\n" + "\n".join(violations))
    return checks


def check_frontend_thumbnail_contract(root: Path) -> int:
    """Workflow thumbnail surfaces should use cached server thumbnails instead of full files."""
    image_loader = root / "new_html" / "services" / "imageLoaderService.ts"
    generation_page = root / "new_html" / "components" / "GenerationPage.tsx"
    storyboard_page = root / "new_html" / "pages" / "StoryboardGenPage.tsx"

    required_snippets = [
        (image_loader, "export function getImageThumbnailUrl"),
        (image_loader, "`/api/thumbnail?url=${encodeURIComponent(source)}"),
        (image_loader, "return secureApiUrl(thumbUrl, { requireAuth: false });"),
        (generation_page, "getImageThumbnailUrl(rawThumb, 144, 96)"),
        (generation_page, "getImageThumbnailUrl(img.thumbnail || img.url, 360, 220)"),
        (storyboard_page, "import { getImageThumbnailUrl } from '../services/imageLoaderService';"),
        (storyboard_page, "imageUrl: getImageThumbnailUrl(imgUrl, 320, 180),"),
    ]

    checks = 0
    for path, snippet in required_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing frontend thumbnail contract snippet in {path.relative_to(root)}: {snippet}")
        checks += 1
    return checks


def check_frontend_ai_chunk_split_contract(root: Path) -> int:
    """AI model service should stay out of the initial script workspace chunk."""
    new_html = root / "new_html"
    workspace_app = new_html / "WorkspaceApp.tsx"
    workspace_text = workspace_app.read_text(encoding="utf-8")
    required_snippets = [
        "const loadAiModelService = () => import('./services/aiModelService');",
        "await loadAiModelService()",
    ]
    checks = 0
    for snippet in required_snippets:
        if snippet not in workspace_text:
            fail(f"Missing frontend AI chunk split snippet in {workspace_app.relative_to(root)}: {snippet}")
        checks += 1

    static_import_violations: list[str] = []
    static_import_re = re.compile(r"from\s+['\"][^'\"]*aiModelService['\"]")
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if "node_modules" in path.parts or "dist" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for idx, line in enumerate(text.splitlines(), start=1):
            if static_import_re.search(line):
                static_import_violations.append(f"{path.relative_to(root)}:{idx}: {line.strip()}")
    if static_import_violations:
        fail(
            "aiModelService must be dynamically imported so script pages can split the AI chunk:\n"
            + "\n".join(static_import_violations)
        )
    checks += 1
    return checks


def check_frontend_workflow_chunk_contract(root: Path) -> int:
    """Heavy workflow workbench components should be lazy-loaded by route shells."""
    new_html = root / "new_html"
    storyboard_page = new_html / "pages" / "StoryboardGenPage.tsx"
    video_page = new_html / "pages" / "VideoGenPage.tsx"
    script_page = new_html / "pages" / "ScriptPage.tsx"
    workspace_app = new_html / "WorkspaceApp.tsx"
    storyboard_text = storyboard_page.read_text(encoding="utf-8")
    video_text = video_page.read_text(encoding="utf-8")
    script_text = script_page.read_text(encoding="utf-8")
    workspace_text = workspace_app.read_text(encoding="utf-8")

    required_snippets = [
        (storyboard_text, "const GenerationPage = React.lazy(() => import('../components/GenerationPage')", "StoryboardGenPage lazy-loads GenerationPage"),
        (storyboard_text, '<React.Suspense fallback={<WorkflowChunkFallback label="加载分镜工作台..." />}>', "StoryboardGenPage wraps GenerationPage in Suspense"),
        (video_text, "const VideoPage = React.lazy(() => import('../components/VideoPage')", "VideoGenPage lazy-loads VideoPage"),
        (script_text, "const WorkspaceApp = React.lazy(() => import('../WorkspaceApp'));", "ScriptPage lazy-loads WorkspaceApp"),
        (script_text, "<React.Suspense fallback={<ScriptWorkspaceFallback />}>", "ScriptPage wraps WorkspaceApp in Suspense"),
        (workspace_text, "const LegacyMaterialPage = React.lazy(() => import('./components/MaterialPage')", "WorkspaceApp lazy-loads legacy MaterialPage"),
        (workspace_text, "const LegacyGenerationPage = React.lazy(() => import('./components/GenerationPage')", "WorkspaceApp lazy-loads legacy GenerationPage"),
        (workspace_text, "const LegacyVideoPage = React.lazy(() => import('./components/VideoPage')", "WorkspaceApp lazy-loads legacy VideoPage"),
        (workspace_text, "const LegacyAdminPage = React.lazy(() => import('./components/AdminPage')", "WorkspaceApp lazy-loads legacy AdminPage"),
        (workspace_text, "const LegacyHistoryPage = React.lazy(() => import('./components/HistoryPage')", "WorkspaceApp lazy-loads legacy HistoryPage"),
        (workspace_text, "const FileColumn = React.lazy(() => import('./components/FileColumn')", "WorkspaceApp lazy-loads FileColumn"),
        (workspace_text, "const ViewerColumn = React.lazy(() => import('./components/ViewerColumn')", "WorkspaceApp lazy-loads ViewerColumn"),
        (workspace_text, "const ScriptColumn = React.lazy(() => import('./components/ScriptColumn')", "WorkspaceApp lazy-loads ScriptColumn"),
        (workspace_text, "const StoryboardColumn = React.lazy(() => import('./components/StoryboardColumn')", "WorkspaceApp lazy-loads StoryboardColumn"),
        (workspace_text, '<React.Suspense fallback={<LegacyViewFallback label="video" />}>', "WorkspaceApp wraps lazy legacy VideoPage locally"),
        (workspace_text, '<React.Suspense fallback={<LegacyColumnFallback label="script" />}>', "WorkspaceApp wraps lazy ScriptColumn locally"),
        (video_text, '<React.Suspense fallback={<WorkflowChunkFallback label="加载视频工作台..." />}>', "VideoGenPage wraps VideoPage in Suspense"),
    ]
    forbidden_snippets = [
        (storyboard_text, "import { GenerationPage } from '../components/GenerationPage';", "StoryboardGenPage must not statically import GenerationPage"),
        (video_text, "import { VideoPage } from '../components/VideoPage';", "VideoGenPage must not statically import VideoPage"),
        (script_text, "import WorkspaceApp from '../WorkspaceApp';", "ScriptPage must not statically import WorkspaceApp"),
        (workspace_text, "import { MaterialPage } from './components/MaterialPage';", "WorkspaceApp must not statically import legacy MaterialPage"),
        (workspace_text, "import { GenerationPage } from './components/GenerationPage';", "WorkspaceApp must not statically import legacy GenerationPage"),
        (workspace_text, "import { VideoPage } from './components/VideoPage';", "WorkspaceApp must not statically import legacy VideoPage"),
        (workspace_text, "import { AdminPage } from './components/AdminPage';", "WorkspaceApp must not statically import legacy AdminPage"),
        (workspace_text, "import { HistoryPage } from './components/HistoryPage';", "WorkspaceApp must not statically import legacy HistoryPage"),
        (workspace_text, "import { FileColumn } from './components/FileColumn';", "WorkspaceApp must not statically import FileColumn"),
        (workspace_text, "import { ViewerColumn } from './components/ViewerColumn';", "WorkspaceApp must not statically import ViewerColumn"),
        (workspace_text, "import { ScriptColumn } from './components/ScriptColumn';", "WorkspaceApp must not statically import ScriptColumn"),
        (workspace_text, "import { StoryboardColumn } from './components/StoryboardColumn';", "WorkspaceApp must not statically import StoryboardColumn"),
    ]

    checks = len(required_snippets) + len(forbidden_snippets)
    missing = [f"{label}: missing {snippet}" for text, snippet, label in required_snippets if snippet not in text]
    forbidden = [f"{label}: forbidden {snippet}" for text, snippet, label in forbidden_snippets if snippet in text]
    if missing or forbidden:
        fail("Frontend workflow chunk contract failed:\n" + "\n".join(missing + forbidden))
    return checks


def check_frontend_three_chunk_contract(root: Path) -> int:
    """Three.js should stay in its own cacheable chunk for the optional 3D controller."""
    vite_config = root / "new_html" / "vite.config.ts"
    multi_angle = root / "new_html" / "components" / "MultiAngle3DController.tsx"
    config_text = vite_config.read_text(encoding="utf-8")
    multi_angle_text = multi_angle.read_text(encoding="utf-8")
    required_snippets = [
        (config_text, "'three-vendor': ['three']", "Vite manualChunks splits three"),
        (multi_angle_text, "import * as THREE from 'three';", "3D controller owns the only runtime three import"),
    ]

    new_html = root / "new_html"
    three_import_violations: list[str] = []
    three_import_re = re.compile(r"from\s+['\"]three['\"]|import\s+['\"]three['\"]")
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if "node_modules" in path.parts or "dist" in path.parts:
            continue
        if path == multi_angle or "multiangle" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for idx, line in enumerate(text.splitlines(), start=1):
            if three_import_re.search(line):
                three_import_violations.append(f"{path.relative_to(root)}:{idx}: {line.strip()}")

    checks = len(required_snippets) + 1
    missing = [f"{label}: missing {snippet}" for text, snippet, label in required_snippets if snippet not in text]
    if missing or three_import_violations:
        fail(
            "Frontend three chunk contract failed:\n"
            + "\n".join(missing + [
                "Unexpected static three imports outside MultiAngle3DController:",
                *three_import_violations,
            ] if three_import_violations else missing)
        )
    return checks


def check_frontend_flow_chunk_contract(root: Path) -> int:
    """React Flow should stay in a cacheable chunk scoped to the Canvas route."""
    vite_config = root / "new_html" / "vite.config.ts"
    canvas_page = root / "new_html" / "pages" / "CanvasPage.tsx"
    config_text = vite_config.read_text(encoding="utf-8")
    canvas_text = canvas_page.read_text(encoding="utf-8")
    required_snippets = [
        (config_text, "'flow-vendor': ['@xyflow/react']", "Vite manualChunks splits React Flow"),
        (canvas_text, "from '@xyflow/react';", "CanvasPage owns the React Flow workbench import"),
        (canvas_text, "import '@xyflow/react/dist/style.css';", "CanvasPage owns the React Flow stylesheet"),
    ]

    new_html = root / "new_html"
    flow_import_violations: list[str] = []
    flow_import_re = re.compile(r"from\s+['\"]@xyflow/react['\"]|import\s+['\"]@xyflow/react")
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if "node_modules" in path.parts or "dist" in path.parts:
            continue
        if path == canvas_page or "canvas" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for idx, line in enumerate(text.splitlines(), start=1):
            if flow_import_re.search(line):
                flow_import_violations.append(f"{path.relative_to(root)}:{idx}: {line.strip()}")

    checks = len(required_snippets) + 1
    missing = [f"{label}: missing {snippet}" for text, snippet, label in required_snippets if snippet not in text]
    if missing or flow_import_violations:
        fail(
            "Frontend flow chunk contract failed:\n"
            + "\n".join(missing + [
                "Unexpected React Flow imports outside Canvas boundary:",
                *flow_import_violations,
            ] if flow_import_violations else missing)
        )
    return checks


def check_frontend_core_vendor_chunk_contract(root: Path) -> int:
    """Core app infrastructure libraries should be cacheable vendor chunks."""
    vite_config = root / "new_html" / "vite.config.ts"
    config_text = vite_config.read_text(encoding="utf-8")
    required_snippets = [
        "'router-vendor': ['react-router-dom']",
        "'query-vendor': ['@tanstack/react-query']",
    ]
    checks = 0
    for snippet in required_snippets:
        if snippet not in config_text:
            fail(f"Missing frontend core vendor chunk snippet in {vite_config.relative_to(root)}: {snippet}")
        checks += 1
    return checks


def check_frontend_utility_vendor_chunk_contract(root: Path) -> int:
    """Utility libraries should stay in explicit cacheable vendor chunks."""
    vite_config = root / "new_html" / "vite.config.ts"
    config_text = vite_config.read_text(encoding="utf-8")
    required_snippets = [
        "'icons-vendor': ['lucide-react']",
        "'id-vendor': ['uuid']",
    ]
    forbidden_snippets = [
        "utils: ['uuid', 'lucide-react']",
        "'utils': ['uuid', 'lucide-react']",
    ]
    checks = 0
    for snippet in required_snippets:
        if snippet not in config_text:
            fail(f"Missing frontend utility vendor chunk snippet in {vite_config.relative_to(root)}: {snippet}")
        checks += 1
    for snippet in forbidden_snippets:
        if snippet in config_text:
            fail(f"Frontend utility vendor chunks are still merged in {vite_config.relative_to(root)}: {snippet}")
        checks += 1
    return checks


def check_frontend_dependency_contract(root: Path) -> int:
    """Keep frontend dependencies and browser scheduling helpers centralized."""
    new_html = root / "new_html"
    package_json_path = new_html / "package.json"
    package_lock_path = new_html / "package-lock.json"
    package_data = json.loads(package_json_path.read_text(encoding="utf-8"))
    lock_data = json.loads(package_lock_path.read_text(encoding="utf-8"))
    lock_packages = lock_data.get("packages", {})
    root_lock_package = lock_packages.get("", {})
    index_html = (new_html / "index.html").read_text(encoding="utf-8")
    login_html = (root / "login.html").read_text(encoding="utf-8")
    legacy_admin_css = (root / "admin" / "style.css").read_text(encoding="utf-8")
    design_tokens_css = (new_html / "styles" / "design-tokens.css").read_text(encoding="utf-8")
    tailwind_config_path = new_html / "tailwind.config.cjs"
    postcss_config_path = new_html / "postcss.config.cjs"

    forbidden_packages = ("react-markdown", "remark-gfm")
    package_sections = {
        "dependencies": package_data.get("dependencies", {}),
        "devDependencies": package_data.get("devDependencies", {}),
        "lock.dependencies": root_lock_package.get("dependencies", {}),
        "lock.devDependencies": root_lock_package.get("devDependencies", {}),
    }

    violations: list[str] = []
    checks = 0
    for package_name in forbidden_packages:
        for section, values in package_sections.items():
            checks += 1
            if package_name in values:
                violations.append(f"{package_name} is still listed in package.json/package-lock {section}")
        checks += 1
        if f"node_modules/{package_name}" in lock_packages:
            violations.append(f"{package_name} still has a package-lock node_modules entry")

    for package_name in ("tailwindcss", "postcss", "autoprefixer"):
        checks += 1
        if package_name not in package_sections["devDependencies"]:
            violations.append(f"{package_name} must be listed in package.json devDependencies")
        checks += 1
        if package_name not in package_sections["lock.devDependencies"]:
            violations.append(f"{package_name} must be listed in package-lock root devDependencies")
        checks += 1
        if f"node_modules/{package_name}" not in lock_packages:
            violations.append(f"{package_name} must have a package-lock node_modules entry")

    for path in (tailwind_config_path, postcss_config_path):
        checks += 1
        if not path.exists():
            violations.append(f"{path.relative_to(root)} is required for local Tailwind builds")

    required_frontend_build_snippets = [
        (design_tokens_css, "@tailwind base;", new_html / "styles" / "design-tokens.css"),
        (design_tokens_css, "@tailwind components;", new_html / "styles" / "design-tokens.css"),
        (design_tokens_css, "@tailwind utilities;", new_html / "styles" / "design-tokens.css"),
        (tailwind_config_path.read_text(encoding="utf-8") if tailwind_config_path.exists() else "", "content: [", tailwind_config_path),
        (tailwind_config_path.read_text(encoding="utf-8") if tailwind_config_path.exists() else "", "primary: {", tailwind_config_path),
        (tailwind_config_path.read_text(encoding="utf-8") if tailwind_config_path.exists() else "", "'PingFang SC'", tailwind_config_path),
        (tailwind_config_path.read_text(encoding="utf-8") if tailwind_config_path.exists() else "", "'ui-monospace'", tailwind_config_path),
        (postcss_config_path.read_text(encoding="utf-8") if postcss_config_path.exists() else "", "tailwindcss: {}", postcss_config_path),
        (postcss_config_path.read_text(encoding="utf-8") if postcss_config_path.exists() else "", "autoprefixer: {}", postcss_config_path),
        (design_tokens_css, "--font-sans: -apple-system", new_html / "styles" / "design-tokens.css"),
        (design_tokens_css, "--font-mono: ui-monospace", new_html / "styles" / "design-tokens.css"),
        (login_html, "fetch('/api/login'", root / "login.html"),
        (login_html, "localStorage.setItem(TOKEN_KEY", root / "login.html"),
    ]
    for text, snippet, path in required_frontend_build_snippets:
        checks += 1
        if snippet not in text:
            violations.append(f"Missing local Tailwind build snippet in {path.relative_to(root)}: {snippet}")

    forbidden_runtime_dependency_snippets = (
        "cdn.tailwindcss.com",
        "tailwind.config",
        "type=\"importmap\"",
        "aistudiocdn.com",
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "cdn.jsdelivr.net",
        "unpkg.com",
        "/static/js/auth.js",
        "/static/js/api.js",
        "Auth.login(",
    )
    for label, text in (
        ("new_html/index.html", index_html),
        ("login.html", login_html),
        ("admin/style.css", legacy_admin_css),
    ):
        for snippet in forbidden_runtime_dependency_snippets:
            checks += 1
            if snippet in text:
                violations.append(f"{label} must not depend on runtime CDN/importmap/webfont: {snippet}")

    import_re = re.compile(
        r"(?:from\s+|import\s*\(\s*|import\s+)['\"](react-markdown|remark-gfm)['\"]"
    )
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if "node_modules" in path.parts or "dist" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for idx, line in enumerate(text.splitlines(), start=1):
            if import_re.search(line):
                violations.append(f"{path.relative_to(root)}:{idx}: forbidden Markdown renderer import")
    checks += 1

    idle_scheduler_path = new_html / "utils" / "idleScheduler.ts"
    for path in new_html.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if "node_modules" in path.parts or "dist" in path.parts or "__tests__" in path.parts:
            continue
        if path == idle_scheduler_path:
            continue
        text = path.read_text(encoding="utf-8")
        for snippet in ("requestIdleCallback", "cancelIdleCallback"):
            if snippet in text:
                violations.append(
                    f"{path.relative_to(root)} must use utils/idleScheduler.ts instead of direct {snippet}"
                )
            checks += 1

    if violations:
        fail("Frontend dependency contract failed:\n" + "\n".join(violations))
    return checks


def check_frontend_app_shell_chunk_contract(root: Path) -> int:
    """App shell should defer nonessential global UI hosts out of the entry chunk."""
    app_path = root / "new_html" / "App.tsx"
    task_context_path = root / "new_html" / "contexts" / "TaskContext.tsx"
    workspace_context_path = root / "new_html" / "contexts" / "WorkspaceContext.tsx"
    sse_hook_path = root / "new_html" / "hooks" / "useSSEInvalidation.ts"
    idle_scheduler_path = root / "new_html" / "utils" / "idleScheduler.ts"
    app_text = app_path.read_text(encoding="utf-8")
    task_context_text = task_context_path.read_text(encoding="utf-8")
    workspace_context_text = workspace_context_path.read_text(encoding="utf-8")
    idle_scheduler_text = idle_scheduler_path.read_text(encoding="utf-8")
    required_source = "\n".join([app_text, task_context_text, workspace_context_text, idle_scheduler_text])
    required_snippets = [
        "import { runWhenIdle } from './utils/idleScheduler';",
        "export function runWhenIdle(",
        "export function waitForIdle(",
        "const CrmHost = React.lazy(() => import('./admin/crmUI').then(m => ({ default: m.CrmHost })));",
        "const DeferredCrmHost: React.FC = () => {",
        "runWhenIdle(() => setMounted(true), { timeout: 1500, fallbackDelayMs: 300 })",
        "<DeferredCrmHost />",
        "const GlobalToast = React.lazy(() => import('./components/GlobalToast').then(m => ({ default: m.GlobalToast })));",
        "const DeferredGlobalToastWithNav: React.FC = () => {",
        "runWhenIdle(() => setMounted(true), { timeout: 1200, fallbackDelayMs: 250 })",
        "<DeferredGlobalToastWithNav />",
        "import('../services/taskControlService')",
        "import('../services/globalTaskManager')",
        "import('../services/taskNotificationService')",
        "import('../services/organizationService')",
        "queryClient.invalidateQueries({ queryKey: ['storyboardItems', n.episodeId] })",
    ]
    forbidden_snippets = [
        (app_text, "import { CrmHost } from './admin/crmUI';", app_path),
        (app_text, 'import { CrmHost } from "./admin/crmUI";', app_path),
        (app_text, "import * as crmUI from './admin/crmUI';", app_path),
        (app_text, 'import * as crmUI from "./admin/crmUI";', app_path),
        (app_text, "import { GlobalToast } from './components/GlobalToast';", app_path),
        (app_text, 'import { GlobalToast } from "./components/GlobalToast";', app_path),
        (app_text, "requestIdleCallback", app_path),
        (app_text, "cancelIdleCallback", app_path),
        (app_text, "useSSEInvalidation", app_path),
        (app_text, "SSEInvalidationProvider", app_path),
        (task_context_text, "from '../services/globalTaskManager';", task_context_path),
        (task_context_text, 'from "../services/globalTaskManager";', task_context_path),
        (task_context_text, "from '../services/taskNotificationService';", task_context_path),
        (task_context_text, 'from "../services/taskNotificationService";', task_context_path),
        (workspace_context_text, "import { listMyOrganizations", workspace_context_path),
        (workspace_context_text, 'import { listMyOrganizations', workspace_context_path),
        (task_context_text, "from '../services/videoTaskService';", task_context_path),
        (task_context_text, 'from "../services/videoTaskService";', task_context_path),
        (task_context_text, "import('../services/videoTaskService')", task_context_path),
    ]
    checks = 0
    for snippet in required_snippets:
        if snippet not in required_source:
            fail(f"Missing frontend app-shell chunk snippet: {snippet}")
        checks += 1
    for text, snippet, path in forbidden_snippets:
        if snippet in text:
            fail(f"Forbidden eager app-shell import in {path.relative_to(root)}: {snippet}")
        checks += 1
    checks += 1
    if sse_hook_path.exists():
        fail("hooks/useSSEInvalidation.ts should stay deleted; TaskContext owns task runtime invalidation")
    return checks


def check_live_deploy_frontend_contract(root: Path) -> int:
    """Production deploy script must ship and build the Vite frontend."""
    script_path = root / "scripts" / "live_deploy_mvc2.sh"
    text = script_path.read_text(encoding="utf-8")
    required_snippets = [
        '"dao"',
        '"cluster_config.py"',
        '"cluster_config_generated.py"',
        '"config.py"',
        '"auto_deploy_cluster.py"',
        '"compose_service.py"',
        '"ARCHITECTURE.md"',
        '"Agent.md"',
        '"login.html"',
        '"admin"',
        '"docs"',
        '"routers"',
        '"schemas"',
        '"scripts/live_deploy_mvc2.sh"',
        '"services"',
        '"utils"',
        '"external_api/video/base.py"',
        "scripts/check_*.py",
        "tests/test_api_provider_runtime_model_env.py",
        "tests/test_asset_service.py",
        "tests/test_audio_provider.py",
        "tests/test_canvas_service.py",
        "tests/test_content_version_service.py",
        "tests/test_storyboard_service.py",
        "tests/test_storyboard_stale_script_fallback.py",
        "tests/test_comfyui_file_service.py",
        "tests/test_dao_api_config_category.py",
        "tests/test_episode_compose_service.py",
        "tests/test_episode_service.py",
        "tests/test_episode_video_service.py",
        "tests/test_entity_file_service.py",
        "tests/test_minimax_tts_sync.py",
        "tests/test_prompt_service.py",
        "tests/test_project_admin_service.py",
        "tests/test_project_core_service.py",
        "tests/test_script_timeline_service.py",
        "tests/test_video_client_base.py",
        "tests/test_video_capability_service.py",
        '"new_html/.env.example"',
        '"new_html/README.md"',
        '"new_html/GEMINI_API_CONFIG.md"',
        "FRONTEND_HASH_REMOTE",
        ".new_html_build_source.sha256",
        "FORCE_FRONTEND_BUILD",
        "frontend_source_hash",
        "! -path 'new_html/*.md'",
        "sed -E 's/^([0-9a-f]+)[[:space:]]+\\*?(.+)$/\\1  \\2/'",
        "REMOTE_DIST_PRESENT",
        "Skipping frontend build: new_html source hash unchanged",
        "new_html-src.tgz",
        "--exclude='new_html/node_modules'",
        "--exclude='new_html/.env'",
        "dist.bak.",
        "npm run build",
        "tar -xzf '$FRONTEND_TAR_REMOTE' -C '$REMOTE_DIR'",
        "rm -f '$REMOTE_DIR'/api_router.py",
        "RUN_REMOTE_CONTRACTS",
        "RUN_REMOTE_SMOKE",
        "REQUIRE_REMOTE_SMOKE",
        "SMOKE_BASE_URL",
        "run_remote_architecture_contracts",
        "run_remote_smoke_test",
        "scripts/check_architecture_contracts.py",
        "ADMIN_PASSWORD",
        "/tmp/smoke_test.py",
        "✅ 部署成功",
        "⚠️ 部署失败，已回滚",
    ]
    forbidden_snippets = [
        "new_html/node_modules\"",
        "new_html/.env\"",
        "agent_routes.py",
        "workflows/",
        "services/ai_proxy_service.py",
        "services/admin_audit_service.py",
        "services/audio_provider.py",
        "services/api_config_health_service.py",
        "services/api_provider_runtime.py",
        "services/credit_service.py",
        "services/file_service.py",
        "services/image_webp_service.py",
        "services/media_library_service.py",
        "services/video_reverse_service.py",
        "utils/config_helpers.py",
        "pipeline/",
    ]
    checks = 0
    for snippet in required_snippets:
        if snippet not in text:
            fail(f"Missing frontend deploy contract snippet in {script_path.relative_to(root)}: {snippet}")
        checks += 1
    for snippet in forbidden_snippets:
        if snippet in text:
            fail(f"Forbidden frontend deploy secret/dependency upload in {script_path.relative_to(root)}: {snippet}")
        checks += 1
    return checks


def check_comfyui_file_service_contract(root: Path) -> int:
    """ComfyUI file routes should delegate transport details to a service."""
    route_path = root / "routers" / "comfyui_files.py"
    route_text = route_path.read_text(encoding="utf-8")
    service_path = root / "services" / "comfyui_file_service.py"
    service_text = service_path.read_text(encoding="utf-8")

    required_route_snippets = [
        "from services.comfyui_file_service import",
        "ComfyUIFileRequestError",
        "fetch_comfyui_view_response(",
        "upload_comfyui_file_response(",
    ]
    required_service_snippets = [
        "class ComfyUIFileRequestError(RuntimeError):",
        "def fetch_comfyui_view_response(",
        "def upload_comfyui_file_response(",
        "return _request(\"comfyui_view\", requests.get",
        "return _request(\"comfyui_upload\", requests.post",
    ]

    checks = 0
    for snippet in required_route_snippets:
        if snippet not in route_text:
            fail(f"ComfyUI file router must delegate transport to service: {snippet}")
        checks += 1
    if "requests." in route_text or "import requests" in route_text:
        fail("routers/comfyui_files.py must not perform direct HTTP requests")
    checks += 1
    for snippet in required_service_snippets:
        if snippet not in service_text:
            fail(f"ComfyUI file service missing transport helper snippet: {snippet}")
        checks += 1
    return checks


def check_video_client_base_contract(root: Path) -> int:
    """Synchronous external video clients should share download plumbing."""
    video_dir = root / "external_api" / "video"
    base_path = video_dir / "base.py"
    base_text = base_path.read_text(encoding="utf-8")
    video_route_path = root / "routers" / "video.py"
    video_route_text = video_route_path.read_text(encoding="utf-8")
    video_source_service_path = root / "services" / "video_source_service.py"
    video_source_service_text = video_source_service_path.read_text(encoding="utf-8")
    required_base_snippets = [
        "def request_json(",
        "response = requests.request(",
        "response.raise_for_status()",
        "return data",
        "def request_multipart_json(",
        "files=files",
        "data=data",
        "def download_streaming_video(",
        "response = requests.get(",
        "stream=True",
        "response.iter_content(chunk_size=chunk_size)",
        "return data",
    ]
    client_files = [
        video_dir / "minimax.py",
        video_dir / "seedance.py",
        video_dir / "sora2.py",
        video_dir / "veo.py",
        video_dir / "wan2.py",
    ]
    json_only_client_files = [
        video_dir / "minimax.py",
        video_dir / "seedance.py",
        video_dir / "veo.py",
        video_dir / "wan2.py",
    ]
    required_client_snippets = [
        "from external_api.video.base import download_streaming_video, request_json",
        "return request_json(",
        "return download_streaming_video(",
    ]
    forbidden_client_snippets = [
        "for chunk in response.iter_content",
        "for chunk in resp.iter_content",
        "video_bytes = b",
        "chunks: List[bytes] = []",
        "return response.json()",
        "return resp.json()",
    ]

    checks = 0
    for snippet in required_base_snippets:
        if snippet not in base_text:
            fail(f"Missing video client base helper snippet in {base_path.relative_to(root)}: {snippet}")
        checks += 1
    for path in client_files:
        text = path.read_text(encoding="utf-8")
        for snippet in required_client_snippets:
            if snippet not in text:
                fail(f"Video client must use shared base helper in {path.relative_to(root)}: {snippet}")
            checks += 1
        for snippet in forbidden_client_snippets:
            if snippet in text:
                fail(f"Video client has duplicated streaming download code in {path.relative_to(root)}: {snippet}")
            checks += 1
    for path in json_only_client_files:
        text = path.read_text(encoding="utf-8")
        if "requests." in text or "import requests" in text:
            fail(f"JSON-only video client must route HTTP through external_api.video.base: {path.relative_to(root)}")
        checks += 1
    for snippet in (
        "def get_comfyui_view_response(",
        "def fetch_comfyui_file_bytes(",
        "response = requests.get(",
    ):
        if snippet not in video_source_service_text:
            fail(f"Video source service missing shared ComfyUI fetch helper snippet: {snippet}")
        checks += 1
    if "get_comfyui_view_response(" not in video_route_text:
        fail("routers/video.py must delegate ComfyUI fetches to services.video_source_service")
    checks += 1
    if "requests." in video_route_text or "import requests" in video_route_text:
        fail("routers/video.py must not perform direct HTTP requests")
    checks += 1
    sora2_text = (video_dir / "sora2.py").read_text(encoding="utf-8")
    if 'label="Sora2 create"' not in sora2_text:
        fail("Sora2 text-to-video create path must use shared request_json helper")
    checks += 1
    if "request_multipart_json(" not in sora2_text:
        fail("Sora2 image-to-video create path must use shared request_multipart_json helper")
    checks += 1
    if "requests." in sora2_text or "import requests" in sora2_text:
        fail("Sora2 video client must route HTTP through external_api.video.base")
    checks += 1
    return checks


def check_admin_api_config_ui_contract(root: Path) -> int:
    """Admin API config UI should avoid stale or provider-only runtime status."""
    page_path = root / "new_html" / "admin" / "AdminSettingsPage.tsx"
    text = page_path.read_text(encoding="utf-8")
    required_snippets = [
        "function healthStatusFromResult",
        "function healthStatusFromConfigTest",
        "function mergedHealthStatus",
        "if (hasEffectiveKey) return runtimeStatus;",
        "const status = mergedHealthStatus(health, runtime, runtimeHasKey, configTest);",
        "const status = healthStatusFromResult(result)",
        "function runtimeStatusKey",
        "function providerHealthKey",
        "function buildProviderHealthMap",
        "function providerHealthFrom",
        "const runtimeByKey = useMemo",
        "const runtimeForProviderModel = useCallback",
        "const runtimeForConfig = useCallback",
        "return runtimeForProviderModel(provider, config.model_name || '');",
        "const runtime = runtimeForConfig(config);",
        "const modelNameHint = primaryConfig?.model_name || meta.default_model_name || null;",
        "const runtime = runtimeForProviderModel(provider, modelNameHint);",
        "const modelName = modelNameHint || runtime?.runtime_model_name || null;",
        "runtime={runtime}",
        "health={providerHealthFrom(healthMap, provider, modelName)}",
        "checking={Boolean(checking[providerHealthKey(provider, modelName)])}",
        "interface ProviderHealthMonitorState",
        "operation_paths?: Record<string, string>",
        "default_operation_url_templates?: Record<string, string>",
        "operation_urls?: Record<string, string>",
        "const ProviderOperationPaths",
        "const operationUrls = runtime?.operation_urls || meta?.default_operation_url_templates || {};",
        "<ProviderOperationPaths meta={meta}",
        "runtime={runtime}",
        "monitor_state?: ProviderHealthMonitorState",
        "const ProviderHealthMonitorStrip",
        "setMonitorState(data.monitor_state || null)",
        "setHealthMap(buildProviderHealthMap(data.provider_health || []))",
        "<ProviderHealthMonitorStrip state={monitorState} />",
        "setMonitorState(result.monitor_state || null)",
        "setHealthMap(buildProviderHealthMap(rows))",
        "query.set('model_name', model)",
        "onCheck(provider, config.model_name || runtime?.runtime_model_name || null)",
        "onCheck(provider, model || null)",
        "body: JSON.stringify({ targets })",
        "putProviderHealth(next, item)",
        "测试 DB 配置",
        "测试生效配置",
        "生效配置状态",
        "DB 配置测试：",
        "只测试这条数据库记录保存的 Key、Endpoint 和模型；结果不会覆盖生效配置健康状态",
    ]
    forbidden_snippets = [
        "const status = healthStatusFrom(result, runtimeMap.get(provider))",
        "const runtime = primaryConfig ? runtimeForConfig(primaryConfig) : runtimeMap.get(provider);",
        "测试连通性",
    ]
    checks = 0
    for snippet in required_snippets:
        if snippet not in text:
            fail(f"Missing admin API config UI contract snippet in {page_path.relative_to(root)}: {snippet}")
        checks += 1
    for snippet in forbidden_snippets:
        if snippet in text:
            fail(f"Forbidden provider-only admin API runtime snippet in {page_path.relative_to(root)}: {snippet}")
        checks += 1
    try:
        refresh_block = text.split("const refreshHealthCache = useCallback", 1)[1].split("const providerMetaMap", 1)[0]
    except IndexError:
        fail(f"Could not locate refreshHealthCache block in {page_path.relative_to(root)}")
    if "setHealthMap(prev =>" in refresh_block:
        fail(f"refreshHealthCache must replace healthMap from cache response, not merge stale state in {page_path.relative_to(root)}")
    checks += 1
    return checks


def check_current_architecture_docs_contract(root: Path) -> int:
    """Current architecture docs must describe the active API provider path."""
    docs = {
        "ARCHITECTURE.md": (root / "ARCHITECTURE.md").read_text(encoding="utf-8"),
        "docs/安全加固清单.md": (root / "docs" / "安全加固清单.md").read_text(encoding="utf-8"),
        "docs/架构审计与重构计划.md": (root / "docs" / "架构审计与重构计划.md").read_text(encoding="utf-8"),
    }
    required = [
        ("ARCHITECTURE.md", "routers/                    # MVC 增量拆出的领域路由"),
        ("docs/安全加固清单.md", "旧 `SmartApiRouter custom proxy` 死代码已删除"),
        ("docs/架构审计与重构计划.md", "DB `api_configs.endpoint` 已变活"),
        ("docs/架构审计与重构计划.md", "Provider runtime 已落地"),
        ("docs/架构审计与重构计划.md", "旧 `api_router.py` / `SmartApiRouter` 已删除"),
        ("docs/架构审计与重构计划.md", "自建 API provider adapter 接入"),
    ]
    forbidden = [
        ("ARCHITECTURE.md", "api_router.py / config.py"),
        ("docs/安全加固清单.md", "api_router.py:55,68"),
        ("docs/架构审计与重构计划.md", "DB endpoint 列是死配置"),
        ("docs/架构审计与重构计划.md", "可作为抽象层骨架"),
        ("docs/架构审计与重构计划.md", "api_router.py:87-89"),
        ("docs/架构审计与重构计划.md", "ProviderConfig 解析器（DB endpoint 变活）"),
    ]
    checks = 0
    for rel, snippet in required:
        if snippet not in docs[rel]:
            fail(f"Missing current architecture doc snippet in {rel}: {snippet}")
        checks += 1
    for rel, snippet in forbidden:
        if snippet in docs[rel]:
            fail(f"Stale current architecture doc snippet in {rel}: {snippet}")
        checks += 1
    return checks


def check_architecture_contract_runner(root: Path) -> int:
    """Architecture checks should have a single pre-refactor runner."""
    script_path = root / "scripts" / "check_architecture_contracts.py"
    if not script_path.exists():
        fail("Missing architecture contract runner: scripts/check_architecture_contracts.py")
    text = script_path.read_text(encoding="utf-8")
    required_snippets = [
        "CONTRACT_SCRIPTS",
        "scripts/check_api_config_runtime_loader.py",
        "scripts/check_admin_api_config_crud.py",
        "scripts/check_admin_api_config_import.py",
        "scripts/check_admin_api_config_health.py",
        "scripts/check_provider_contract.py",
        "scripts/check_provider_health_monitor.py",
        "scripts/check_ai_proxy_failover.py",
        "scripts/check_audio_provider_runtime.py",
        "scripts/check_route_contract.py",
        "Architecture contract suite OK",
    ]
    checks = 0
    for snippet in required_snippets:
        if snippet not in text:
            fail(f"Missing architecture contract runner snippet in {script_path.relative_to(root)}: {snippet}")
        checks += 1
    return checks


def format_duplicates(
    duplicates: Iterable[tuple[str, str]],
    routes: dict[tuple[str, str], list[tuple[int, str | None, str | None]]],
) -> str:
    rows = []
    for key in duplicates:
        status = "allowed" if key in ALLOWED_DUPLICATES else "unexpected"
        rows.append(f"  {status}: {key} -> {routes[key]}")
    return "\n".join(rows) if rows else "  none"


def main() -> int:
    parser = argparse.ArgumentParser(description="Check MECHA FastAPI route contract.")
    parser.add_argument("--expected-paths", type=int, default=DEFAULT_EXPECTED_PATHS)
    parser.add_argument("--expected-operations", type=int, default=DEFAULT_EXPECTED_OPERATIONS)
    parser.add_argument("--show-routes", action="store_true", help="Print checked route endpoints.")
    args = parser.parse_args()

    root = deploy_root()
    external_api_files, external_api_routes = check_external_api_has_no_fastapi_routes(root)
    check_cluster_main_has_no_direct_http_routes(root)
    api_routes_direct_handlers = check_api_routes_is_assembly_only(root)
    api_config_route_handlers = check_admin_api_config_routes_extracted(root)
    prompt_route_handlers = check_prompt_routes_extracted(root)
    cluster_status_route_handlers = check_cluster_status_routes_extracted(root)
    frontend_page_route_handlers = check_frontend_pages_routes_extracted(root)
    user_session_route_handlers = check_user_session_routes_extracted(root)
    workspace_route_handlers = check_workspace_routes_extracted(root)
    task_route_handlers = check_task_routes_extracted(root)
    task_notification_route_handlers = check_task_notification_routes_extracted(root)
    task_stale_cleanup_checks = check_task_stale_cleanup_notification_contract(root)
    task_notification_toast_dedupe_checks = check_task_notification_toast_dedupe_contract(root)
    lifespan_shutdown_checks = check_lifespan_shutdown_contract(root)
    storyboard_paged_reload_checks = check_storyboard_paged_reload_contract(root)
    enhance_lightweight_storyboard_checks = check_enhance_lightweight_storyboard_contract(root)
    generation_lightweight_storyboard_checks = check_generation_lightweight_storyboard_contract(root)
    audio_stage_lightweight_storyboard_checks = check_audio_stage_lightweight_storyboard_contract(root)
    materials_lightweight_storyboard_checks = check_materials_lightweight_storyboard_contract(root)
    api_provider_runtime_model_checks = check_api_provider_runtime_model_contract(root)
    provider_endpoint_single_source_checks = check_provider_endpoint_single_source_contract(root)
    frontend_ai_proxy_checks = check_frontend_ai_proxy_contract(root)
    frontend_http_client_checks = check_frontend_http_client_contract(root)
    service_mapper_purity_checks = check_service_mapper_purity_contract(root)
    frontend_lazy_video_checks = check_frontend_lazy_video_contract(root)
    frontend_lazy_image_checks = check_frontend_lazy_image_contract(root)
    frontend_video_preload_checks = check_frontend_video_preload_contract(root)
    frontend_thumbnail_checks = check_frontend_thumbnail_contract(root)
    frontend_ai_chunk_split_checks = check_frontend_ai_chunk_split_contract(root)
    frontend_workflow_chunk_checks = check_frontend_workflow_chunk_contract(root)
    frontend_three_chunk_checks = check_frontend_three_chunk_contract(root)
    frontend_flow_chunk_checks = check_frontend_flow_chunk_contract(root)
    frontend_core_vendor_chunk_checks = check_frontend_core_vendor_chunk_contract(root)
    frontend_utility_vendor_chunk_checks = check_frontend_utility_vendor_chunk_contract(root)
    frontend_dependency_checks = check_frontend_dependency_contract(root)
    frontend_app_shell_chunk_checks = check_frontend_app_shell_chunk_contract(root)
    live_deploy_frontend_checks = check_live_deploy_frontend_contract(root)
    comfyui_file_service_checks = check_comfyui_file_service_contract(root)
    video_client_base_checks = check_video_client_base_contract(root)
    admin_api_config_ui_checks = check_admin_api_config_ui_contract(root)
    current_architecture_docs_checks = check_current_architecture_docs_contract(root)
    architecture_contract_runner_checks = check_architecture_contract_runner(root)
    fallback_static_route_handlers = check_fallback_static_routes_extracted(root)
    generation_route_handlers = check_generation_routes_extracted(root)
    auth_route_handlers = check_auth_routes_extracted(root)
    auth_legacy_route_handlers = check_auth_legacy_routes_extracted(root)
    password_minimum_checks = check_password_minimum_contract(root)
    cors_allowlist_checks = check_cors_allowlist_contract(root)
    admin_compat_route_handlers = check_admin_compat_routes_extracted(root)
    project_route_handlers = check_project_routes_extracted(root)
    project_core_route_handlers = check_project_core_routes_extracted(root)
    project_admin_route_handlers = check_project_admin_routes_extracted(root)
    content_version_route_handlers = check_content_version_routes_extracted(root)
    episode_route_handlers = check_episode_routes_extracted(root)
    episode_video_route_handlers = check_episode_video_routes_extracted(root)
    video_capability_route_handlers = check_video_capabilities_routes_extracted(root)
    storyboard_route_handlers = check_storyboard_routes_extracted(root)
    asset_route_handlers = check_asset_routes_extracted(root)
    entity_file_route_handlers = check_entity_file_routes_extracted(root)
    legacy_file_route_handlers = check_legacy_file_routes_extracted(root)
    audio_route_handlers = check_audio_routes_extracted(root)
    script_timeline_route_handlers = check_script_timeline_routes_extracted(root)
    canvas_route_handlers = check_canvas_routes_extracted(root)
    app = import_app()
    schema = app.openapi()
    path_count, operation_count = check_counts(schema, args.expected_paths, args.expected_operations)
    routes = runtime_routes(app)
    duplicates = check_duplicates(routes)
    check_fallback_static_route_order(routes)
    check_expected_endpoints(routes)

    print("Route contract OK")
    print(f"  openapi_paths={path_count}")
    print(f"  openapi_operations={operation_count}")
    print(f"  external_api_python_files={external_api_files}")
    print(f"  external_api_route_handlers={external_api_routes}")
    print(f"  api_routes_direct_handlers={api_routes_direct_handlers}")
    print(f"  admin_api_config_route_handlers={api_config_route_handlers}")
    print(f"  prompt_route_handlers={prompt_route_handlers}")
    print(f"  cluster_status_route_handlers={cluster_status_route_handlers}")
    print(f"  frontend_page_route_handlers={frontend_page_route_handlers}")
    print(f"  user_session_route_handlers={user_session_route_handlers}")
    print(f"  workspace_route_handlers={workspace_route_handlers}")
    print(f"  task_route_handlers={task_route_handlers}")
    print(f"  task_notification_route_handlers={task_notification_route_handlers}")
    print(f"  task_stale_cleanup_checks={task_stale_cleanup_checks}")
    print(f"  task_notification_toast_dedupe_checks={task_notification_toast_dedupe_checks}")
    print(f"  lifespan_shutdown_checks={lifespan_shutdown_checks}")
    print(f"  storyboard_paged_reload_checks={storyboard_paged_reload_checks}")
    print(f"  enhance_lightweight_storyboard_checks={enhance_lightweight_storyboard_checks}")
    print(f"  generation_lightweight_storyboard_checks={generation_lightweight_storyboard_checks}")
    print(f"  audio_stage_lightweight_storyboard_checks={audio_stage_lightweight_storyboard_checks}")
    print(f"  materials_lightweight_storyboard_checks={materials_lightweight_storyboard_checks}")
    print(f"  api_provider_runtime_model_checks={api_provider_runtime_model_checks}")
    print(f"  provider_endpoint_single_source_checks={provider_endpoint_single_source_checks}")
    print(f"  frontend_ai_proxy_checks={frontend_ai_proxy_checks}")
    print(f"  frontend_http_client_checks={frontend_http_client_checks}")
    print(f"  service_mapper_purity_checks={service_mapper_purity_checks}")
    print(f"  frontend_lazy_video_checks={frontend_lazy_video_checks}")
    print(f"  frontend_lazy_image_checks={frontend_lazy_image_checks}")
    print(f"  frontend_video_preload_checks={frontend_video_preload_checks}")
    print(f"  frontend_thumbnail_checks={frontend_thumbnail_checks}")
    print(f"  frontend_ai_chunk_split_checks={frontend_ai_chunk_split_checks}")
    print(f"  frontend_workflow_chunk_checks={frontend_workflow_chunk_checks}")
    print(f"  frontend_three_chunk_checks={frontend_three_chunk_checks}")
    print(f"  frontend_flow_chunk_checks={frontend_flow_chunk_checks}")
    print(f"  frontend_core_vendor_chunk_checks={frontend_core_vendor_chunk_checks}")
    print(f"  frontend_utility_vendor_chunk_checks={frontend_utility_vendor_chunk_checks}")
    print(f"  frontend_dependency_checks={frontend_dependency_checks}")
    print(f"  frontend_app_shell_chunk_checks={frontend_app_shell_chunk_checks}")
    print(f"  live_deploy_frontend_checks={live_deploy_frontend_checks}")
    print(f"  comfyui_file_service_checks={comfyui_file_service_checks}")
    print(f"  video_client_base_checks={video_client_base_checks}")
    print(f"  admin_api_config_ui_checks={admin_api_config_ui_checks}")
    print(f"  current_architecture_docs_checks={current_architecture_docs_checks}")
    print(f"  architecture_contract_runner_checks={architecture_contract_runner_checks}")
    print(f"  fallback_static_route_handlers={fallback_static_route_handlers}")
    print(f"  generation_route_handlers={generation_route_handlers}")
    print(f"  auth_route_handlers={auth_route_handlers}")
    print(f"  auth_legacy_route_handlers={auth_legacy_route_handlers}")
    print(f"  password_minimum_checks={password_minimum_checks}")
    print(f"  cors_allowlist_checks={cors_allowlist_checks}")
    print(f"  admin_compat_route_handlers={admin_compat_route_handlers}")
    print(f"  project_route_handlers={project_route_handlers}")
    print(f"  project_core_route_handlers={project_core_route_handlers}")
    print(f"  project_admin_route_handlers={project_admin_route_handlers}")
    print(f"  content_version_route_handlers={content_version_route_handlers}")
    print(f"  episode_route_handlers={episode_route_handlers}")
    print(f"  episode_video_route_handlers={episode_video_route_handlers}")
    print(f"  video_capability_route_handlers={video_capability_route_handlers}")
    print(f"  storyboard_route_handlers={storyboard_route_handlers}")
    print(f"  asset_route_handlers={asset_route_handlers}")
    print(f"  entity_file_route_handlers={entity_file_route_handlers}")
    print(f"  legacy_file_route_handlers={legacy_file_route_handlers}")
    print(f"  audio_route_handlers={audio_route_handlers}")
    print(f"  script_timeline_route_handlers={script_timeline_route_handlers}")
    print(f"  canvas_route_handlers={canvas_route_handlers}")
    print("  duplicate_routes:")
    print(format_duplicates(duplicates, routes))

    if args.show_routes:
        print("  expected_endpoints:")
        for key in sorted(EXPECTED_ENDPOINTS):
            print(f"    {key} -> {routes[key][0]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
