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
    ]
    for snippet in required_snippets:
        if snippet not in api_text:
            fail(f"Missing admin API config route contract snippet: {snippet}")
        route_count += 1
    return route_count


def check_cluster_main_has_no_direct_http_routes(root: Path) -> None:
    cluster_main_path = root / "cluster_main.py"
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
    if not prompt_routes_path.exists():
        fail("routers/prompts.py is missing")

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
        (router_text, "EpisodeScriptDAO.get_by_id(script_id)", "storyboard backend stale script ownership check"),
        (router_text, 'fallback_reason = "stale_script_storyboard"', "storyboard backend stale script fallback marker"),
        (router_text, 'payload["fallback_scope"] = "episode"', "storyboard backend fallback scope marker"),
        (router_test_text, "test_storyboard_items_fallback_for_stale_script_id", "storyboard backend stale script fallback test"),
        (router_test_text, "test_storyboard_items_do_not_fallback_for_valid_empty_script", "storyboard backend valid empty script test"),
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
    ]:
        text = path.read_text(encoding="utf-8")
        for snippet in forbidden_snippets:
            if snippet in text:
                fail(f"Forbidden password minimum contract snippet in {path.relative_to(root)}: {snippet}")
    return len(required_snippets)


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
    if not project_core_path.exists():
        fail("routers/project_core.py is missing")

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
    return route_count


def check_project_admin_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    project_admin_path = root / "routers" / "project_admin.py"
    if not project_admin_path.exists():
        fail("routers/project_admin.py is missing")

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
    return route_count


def check_content_version_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    content_versions_path = root / "routers" / "content_versions.py"
    if not content_versions_path.exists():
        fail("routers/content_versions.py is missing")

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
    return route_count


def check_episode_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    episodes_path = root / "routers" / "episodes.py"
    if not episodes_path.exists():
        fail("routers/episodes.py is missing")

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
    return route_count


def check_episode_video_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    episode_video_path = root / "routers" / "episode_video.py"
    if not episode_video_path.exists():
        fail("routers/episode_video.py is missing")

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
    return route_count


def check_video_capabilities_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    video_capabilities_path = root / "routers" / "video_capabilities.py"
    if not video_capabilities_path.exists():
        fail("routers/video_capabilities.py is missing")

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
    return route_count


def check_storyboard_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    storyboard_path = root / "routers" / "storyboard.py"
    if not storyboard_path.exists():
        fail("routers/storyboard.py is missing")

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
    return route_count


def check_asset_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    assets_path = root / "routers" / "assets.py"
    if not assets_path.exists():
        fail("routers/assets.py is missing")

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
    return route_count


def check_entity_file_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    entity_files_path = root / "routers" / "entity_files.py"
    if not entity_files_path.exists():
        fail("routers/entity_files.py is missing")
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

    return route_count + 4


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
    if not script_timeline_path.exists():
        fail("routers/script_timeline.py is missing")

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
    return route_count


def check_canvas_routes_extracted(root: Path) -> int:
    api_routes_path = root / "api_routes.py"
    canvas_path = root / "routers" / "canvas.py"
    if not canvas_path.exists():
        fail("routers/canvas.py is missing")

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
            'gemini_config = resolve_provider("gemini-text")',
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
            root / "external_api" / "video" / "minimax.py",
            'config = resolve_provider("minimax", model_override)',
        ),
        (
            root / "external_api" / "audio" / "minimax_audio.py",
            'config = resolve_provider("minimax", "MiniMax-Hailuo-02")',
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
            "DB 未保存 Key，已借用生效运行时 Key",
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
            "测试 DB 配置",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "刷新生效健康",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "window.location.assign(LEGACY_API_CONFIG_ROUTE);",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "高级诊断",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "测试连通性",
        ),
        (
            root / "new_html" / "admin" / "AdminSettingsPage.tsx",
            "新增 / 修改厂商 API",
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
            root / "services" / "api_provider_registry.py",
            '"model_name": "sora_video2-landscape-15s"',
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            'SORA2_NEW_MODEL = "sora_video2-landscape-15s"',
        ),
        (
            root / "external_api" / "video" / "sora2.py",
            "DEFAULT_SORA2_VIDEO_MODEL =",
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
            '"model_name": "veo-3.1-landscape-fast-fl"',
        ),
        (
            root / "services" / "api_config_runtime_loader.py",
            'VEO_NEW_MODEL = "veo-3.1-landscape-fast-fl"',
        ),
        (
            root / "external_api" / "video" / "veo.py",
            "DEFAULT_VEO_VIDEO_MODEL =",
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
            root / "routers" / "video_capabilities.py",
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
            "VIDU_REFERENCE_SUB_MODEL_MAP",
        ),
        (
            root / "external_api" / "video" / "dashscope.py",
            "VIDU_STARTEND_SUB_MODEL_MAP",
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
            "_resolve_default_dashscope_model(model)",
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
    cluster_text = (root / "cluster_main.py").read_text(encoding="utf-8")
    router_text = (root / "routers" / "ai_proxy.py").read_text(encoding="utf-8")
    if "DOUBAO_MODEL =" in cluster_text:
        fail("cluster_main.py must not cache the Doubao image model at import time")
    if "doubao_model_provider" in router_text or "doubao_model_provider" in cluster_text:
        fail("Doubao route must resolve runtime model through services.ai_proxy_service, not injected model providers")
    seedance_text = (root / "external_api" / "video" / "seedance.py").read_text(encoding="utf-8")
    if "os.getenv" in seedance_text or "import os" in seedance_text:
        fail("Seedance client must not cache/read model env directly; use runtime resolver helpers")
    checks += 3
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
    video_workflow_service = new_html / "services" / "videoWorkflowService.ts"
    use_episode_data = new_html / "hooks" / "useEpisodeData.ts"
    episode_context = new_html / "contexts" / "EpisodeContext.tsx"
    audio_stage_page = new_html / "pages" / "AudioStagePage.tsx"
    enhance_page = new_html / "pages" / "EnhancePage.tsx"
    final_product_page = new_html / "pages" / "FinalProductPage.tsx"
    workflow_materials_page = new_html / "pages" / "MaterialsPage.tsx"
    voice_sidebar = new_html / "components" / "audio" / "VoiceSidebar.tsx"
    music_modal = new_html / "components" / "audio" / "MusicModal.tsx"
    seedance_multimodal_panel = new_html / "components" / "SeedanceMultimodalPanel.tsx"
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
        new_html / "services" / "videoService.ts",
        new_html / "services" / "videoReverseService.ts",
        new_html / "services" / "imageLoaderService.ts",
        new_html / "services" / "geminiService.ts",
        new_html / "services" / "shareService.ts",
        new_html / "services" / "entityFileService.ts",
        new_html / "services" / "mediaLibraryService.ts",
        new_html / "services" / "creditService.ts",
        new_html / "services" / "organizationService.ts",
        task_notification_service,
        episode_data_service,
        audio_generation_service,
        video_workflow_service,
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

    required_snippets = [
        (http_client, "import { pickTokenForCurrentRoute } from '../admin/adminAuth';"),
        (http_client, "export function buildAuthHeaders("),
        (http_client, "export async function handleResponse("),
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
        (new_html / "services" / "videoService.ts", "export function secureMediaUrl("),
        (new_html / "services" / "videoService.ts", "export async function getProjectVideoTasks("),
        (new_html / "services" / "videoService.ts", "export async function clearProjectVideoTasks("),
        (new_html / "services" / "imageLoaderService.ts", "import { apiBlob, apiJson, secureApiUrl } from './httpClient'"),
        (new_html / "services" / "imageLoaderService.ts", "apiJson<any>(\n        `/api/projects/${projectId}/images/${shotId}`"),
        (new_html / "services" / "imageLoaderService.ts", "apiBlob(securedUrl, { method: 'GET' }, '下载图片'"),
        (new_html / "services" / "geminiService.ts", "import { apiJson } from './httpClient'"),
        (new_html / "services" / "geminiService.ts", "const postGenerationTask = async ("),
        (new_html / "services" / "geminiService.ts", "postGenerationTask('/api/generate/comfyui-workflow'"),
        (new_html / "services" / "geminiService.ts", "apiJson<any>(\n            `/api/task/${taskId}`"),
        (api_service, "import { apiBlob, apiJson, getAuthToken, getHeaders, handleResponse, publicBlob, secureApiUrl } from './httpClient'"),
        (api_service, "export { getAuthToken, getHeaders, handleResponse };"),
        (api_service, "from './taskNotificationService';"),
        (api_service, "from './episodeDataService';"),
        (api_service, "from './audioGenerationService';"),
        (api_service, "from './videoWorkflowService';"),
        (api_service, "function normalizeImageSourceUrl("),
        (api_service, "function isSameOriginUrl("),
        (api_service, "secureApiUrl(absolute, { requireAuth: false })"),
        (api_service, "apiBlob("),
        (api_service, "publicBlob(imageUrlOrDataUrl"),
        (api_service, "publicBlob(absolute"),
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
        (new_html / "__tests__" / "services" / "audioGenerationService.test.ts", "starts asynchronous MiniMax TTS tasks with AbortSignal passthrough"),
        (new_html / "__tests__" / "services" / "videoWorkflowService.test.ts", "fetchSeedanceOmni caches video capability responses"),
        (new_html / "__tests__" / "services" / "minimaxTTSSync.test.ts", "from '../../services/audioGenerationService'"),
        (new_html / "__tests__" / "services" / "apiService.test.ts", "downloads same-origin image through shared authenticated blob client"),
        (new_html / "__tests__" / "services" / "apiService.test.ts", "does not attach local auth token to external image downloads"),
        (new_html / "__tests__" / "services" / "apiService.test.ts", "downloads blob URLs through public blob helper without auth headers"),
        (api_service, "return apiJson<any>('/api/comfyui/upload'"),
        (api_service, "return apiJson<any>('/api/admin/users'"),
        (api_service, "return apiJson<any>('/api/admin/users/create'"),
        (api_service, "return apiJson<any>(`/api/admin/users/${userId}/permissions`"),
        (api_service, "return apiJson<any>(`/api/admin/users/${userId}`"),
        (api_service, "return apiJson<any>(`/api/admin/logs?limit=${limit}`"),
        (api_service, "return apiJson<any>(`/api/admin/stats${qs}`"),
        (api_service, "return apiJson<any>('/api/projects/save'"),
        (api_service, "return apiJson<any>(`/api/projects/list${suffix}`"),
        (api_service, "return apiJson<any>(`/api/projects/${projectId}`"),
        (api_service, "return apiJson<any>(`/api/projects/${projectId}/members`"),
        (api_service, "return apiJson<any>(`/api/projects/${projectId}/episodes`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}`"),
        (api_service, "return apiJson<any>('/api/materials/process'"),
        (api_service, "return apiJson<any>('/api/assets'"),
        (api_service, "return apiJson<any>(`/api/assets/${assetId}`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/all${qs}`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/reorder`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/scripts`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/scripts/${scriptId}`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/script-segments${qs}`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/script-segments/batch`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/timeline-tracks`"),
        (api_service, "return apiJson<any>(`/api/timeline-tracks/${trackId}`"),
        (api_service, "return apiJson<any>(`/api/assets/${assetId}/share`"),
        (api_service, "return apiJson<any>(`/api/episodes/${episodeId}/export-script`"),
        (api_service, "return apiJson<any>('/api/canvas/boards'"),
        (api_service, "return apiJson<any>(`/api/canvas/boards/${boardId}`"),
        (api_service, "return apiJson<any>('/api/canvas/nodes'"),
        (api_service, "return apiJson<any>('/api/canvas/connections'"),
        (video_page, "videoService.secureMediaUrl("),
        (video_page, "videoService.getProjectVideoTasks("),
        (video_page, "videoService.clearProjectVideoTasks("),
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
        (audio_stage_page, "from '../services/audioGenerationService'"),
        (audio_stage_page, "from '../services/episodeDataService'"),
        (workflow_generation_page, "from '../services/episodeDataService'"),
        (workflow_generation_page, "from '../services/videoWorkflowService'"),
        (video_gen_page, "from '../services/episodeDataService'"),
        (enhance_page, "from '../services/episodeDataService'"),
        (enhance_page, "from '../services/videoWorkflowService'"),
        (final_product_page, "from '../services/videoWorkflowService'"),
        (video_page, "from '../services/videoWorkflowService'"),
        (seedance_multimodal_panel, "from '../services/videoWorkflowService'"),
        (workflow_materials_page, "from '../services/episodeDataService'"),
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
        (generation_page, "function normalizeImageDownloadUrl("),
        (generation_page, "downloadImageBlob(imageUrl, '加载完整图片')"),
        (admin_feature_tabs, "import { apiJson } from '../services/httpClient'"),
        (admin_feature_tabs, "apiJson<T>(url, { method: 'GET' }, 'Admin API')"),
        (admin_organizations_tab, "import { apiJson } from '../services/httpClient'"),
        (admin_organizations_tab, "apiJson<{ users: any[] }>('/api/admin/users?limit=500'"),
        (admin_hub_page, "import { apiJson } from '../services/httpClient'"),
        (admin_hub_page, "apiJson<any>(url, { method: 'GET' }, 'Admin Hub KPI')"),
        (admin_page, "import { apiJson } from '../services/httpClient'"),
        (admin_page, "const data = (await apiJson("),
        (admin_page, ")) as ClusterNodesResponse;"),
        (admin_settings_page, "import { apiJson } from '../services/httpClient'"),
        (admin_settings_page, "apiJson<ApiConfigsResponse>('/api/admin/api-configs')"),
    ]
    forbidden_snippets = [
        "function getHeaders",
        "const getHeaders",
        "localStorage.getItem('auth_token')",
        'localStorage.getItem("auth_token")',
        "Authorization:",
        "'Authorization'",
        '"Authorization"',
        "Bearer ",
        "API_BASE",
        "handleResponse",
        "fetch(",
    ]

    checks = 0
    for path, snippet in required_snippets:
        text = path.read_text(encoding="utf-8")
        if snippet not in text:
            fail(f"Missing frontend httpClient contract snippet in {path.relative_to(root)}: {snippet}")
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
    for snippet in [
        "const API_BASE",
        "fetch(`${API_BASE}/api/",
        "localStorage.getItem('auth_token')",
        'localStorage.getItem("auth_token")',
    ]:
        if snippet in api_service_text:
            fail(f"apiService must not own API-base fetch/auth plumbing: {snippet}")
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
        (root / "dao" / "creative" / "asset.py", "async def create_missing_episode_assets_transactional("),
        (root / "dao" / "creative" / "storyboard.py", "async def export_script_transaction("),
        (root / "dao" / "creative" / "storyboard.py", "async def delete_by_episode_transactional("),
        (root / "dao" / "user" / "user.py", "async def delete_user_by_id("),
        (root / "dao" / "admin" / "admin_stats.py", "class AdminStatsDAO:"),
        (root / "dao" / "admin" / "admin_stats.py", "async def get_summary_stats("),
        (root / "dao" / "admin" / "admin_stats.py", "async def get_generation_logs("),
        (root / "dao" / "admin" / "admin_stats.py", "async def get_stats_breakdown("),
        (root / "services" / "file_service.py", "EntityFileDAO.sync_legacy_url("),
        (root / "routers" / "entity_files.py", "EntityFileDAO.count_user_files("),
        (root / "routers" / "entity_files.py", "EntityFileDAO.sync_legacy_url("),
        (root / "routers" / "task_notifications.py", "TaskDAO.get_active_tasks_for_user("),
        (root / "routers" / "task_notifications.py", "TaskDAO.get_terminal_tasks_for_notifications("),
        (root / "routers" / "episode_video.py", "EpisodeDAO.get_project_id("),
        (root / "routers" / "tasks.py", "get_task_status_response("),
        (root / "routers" / "tasks.py", "list_user_tasks_response("),
        (root / "routers" / "tasks.py", "soft_delete_user_file_by_path_fragment("),
        (root / "services" / "task_read_service.py", "async def get_task_status_response("),
        (root / "services" / "task_read_service.py", "async def list_user_tasks_response("),
        (root / "services" / "task_read_service.py", "async def soft_delete_user_file_by_path_fragment("),
        (root / "services" / "credit_service.py", "CreditLedgerDAO.freeze_credits("),
        (root / "routers" / "project_admin.py", "ProjectDAO.update_project_metadata("),
        (root / "routers" / "storyboard.py", "StoryboardDAO.export_script_transaction("),
        (root / "routers" / "admin_compat.py", "UserDAO.delete_user_by_id("),
        (root / "routers" / "admin_compat.py", "AdminStatsDAO.get_summary_stats("),
        (root / "routers" / "admin_compat.py", "AdminStatsDAO.get_generation_logs("),
        (root / "routers" / "admin_compat.py", "AdminStatsDAO.get_stats_breakdown("),
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

    episode_video_router_text = (root / "routers" / "episode_video.py").read_text(encoding="utf-8")
    for snippet in [
        "SELECT project_id FROM episodes",
        "get_db_manager_func",
        "db.fetchrow(",
    ]:
        if snippet in episode_video_router_text:
            violations.append(f"routers/episode_video.py must delegate episode project lookup to EpisodeDAO: {snippet}")
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
    workspace_app = new_html / "WorkspaceApp.tsx"
    storyboard_text = storyboard_page.read_text(encoding="utf-8")
    video_text = video_page.read_text(encoding="utf-8")
    workspace_text = workspace_app.read_text(encoding="utf-8")

    required_snippets = [
        (storyboard_text, "const GenerationPage = React.lazy(() => import('../components/GenerationPage')", "StoryboardGenPage lazy-loads GenerationPage"),
        (storyboard_text, '<React.Suspense fallback={<WorkflowChunkFallback label="加载分镜工作台..." />}>', "StoryboardGenPage wraps GenerationPage in Suspense"),
        (video_text, "const VideoPage = React.lazy(() => import('../components/VideoPage')", "VideoGenPage lazy-loads VideoPage"),
        (workspace_text, "const LegacyMaterialPage = React.lazy(() => import('./components/MaterialPage')", "WorkspaceApp lazy-loads legacy MaterialPage"),
        (workspace_text, "const LegacyGenerationPage = React.lazy(() => import('./components/GenerationPage')", "WorkspaceApp lazy-loads legacy GenerationPage"),
        (workspace_text, "const LegacyVideoPage = React.lazy(() => import('./components/VideoPage')", "WorkspaceApp lazy-loads legacy VideoPage"),
        (workspace_text, "const LegacyAdminPage = React.lazy(() => import('./components/AdminPage')", "WorkspaceApp lazy-loads legacy AdminPage"),
        (workspace_text, "const LegacyHistoryPage = React.lazy(() => import('./components/HistoryPage')", "WorkspaceApp lazy-loads legacy HistoryPage"),
        (workspace_text, '<React.Suspense fallback={<LegacyViewFallback label="video" />}>', "WorkspaceApp wraps lazy legacy VideoPage locally"),
        (video_text, '<React.Suspense fallback={<WorkflowChunkFallback label="加载视频工作台..." />}>', "VideoGenPage wraps VideoPage in Suspense"),
    ]
    forbidden_snippets = [
        (storyboard_text, "import { GenerationPage } from '../components/GenerationPage';", "StoryboardGenPage must not statically import GenerationPage"),
        (video_text, "import { VideoPage } from '../components/VideoPage';", "VideoGenPage must not statically import VideoPage"),
        (workspace_text, "import { MaterialPage } from './components/MaterialPage';", "WorkspaceApp must not statically import legacy MaterialPage"),
        (workspace_text, "import { GenerationPage } from './components/GenerationPage';", "WorkspaceApp must not statically import legacy GenerationPage"),
        (workspace_text, "import { VideoPage } from './components/VideoPage';", "WorkspaceApp must not statically import legacy VideoPage"),
        (workspace_text, "import { AdminPage } from './components/AdminPage';", "WorkspaceApp must not statically import legacy AdminPage"),
        (workspace_text, "import { HistoryPage } from './components/HistoryPage';", "WorkspaceApp must not statically import legacy HistoryPage"),
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
    """Keep unused Markdown renderer packages out of the production dependency set."""
    new_html = root / "new_html"
    package_json_path = new_html / "package.json"
    package_lock_path = new_html / "package-lock.json"
    package_data = json.loads(package_json_path.read_text(encoding="utf-8"))
    lock_data = json.loads(package_lock_path.read_text(encoding="utf-8"))
    lock_packages = lock_data.get("packages", {})
    root_lock_package = lock_packages.get("", {})

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

    if violations:
        fail("Frontend dependency contract failed:\n" + "\n".join(violations))
    return checks


def check_frontend_app_shell_chunk_contract(root: Path) -> int:
    """App shell should defer nonessential global UI hosts out of the entry chunk."""
    app_path = root / "new_html" / "App.tsx"
    app_text = app_path.read_text(encoding="utf-8")
    required_snippets = [
        "const CrmHost = React.lazy(() => import('./admin/crmUI').then(m => ({ default: m.CrmHost })));",
        "const DeferredCrmHost: React.FC = () => {",
        "requestIdleCallback",
        "<DeferredCrmHost />",
    ]
    forbidden_snippets = [
        "import { CrmHost } from './admin/crmUI';",
        'import { CrmHost } from "./admin/crmUI";',
        "import * as crmUI from './admin/crmUI';",
        'import * as crmUI from "./admin/crmUI";',
    ]
    checks = 0
    for snippet in required_snippets:
        if snippet not in app_text:
            fail(f"Missing frontend app-shell chunk snippet in {app_path.relative_to(root)}: {snippet}")
        checks += 1
    for snippet in forbidden_snippets:
        if snippet in app_text:
            fail(f"Forbidden eager app-shell import in {app_path.relative_to(root)}: {snippet}")
        checks += 1
    return checks


def check_live_deploy_frontend_contract(root: Path) -> int:
    """Production deploy script must ship and build the Vite frontend."""
    script_path = root / "scripts" / "live_deploy_mvc2.sh"
    text = script_path.read_text(encoding="utf-8")
    required_snippets = [
        '"dao"',
        '"scripts/live_deploy_mvc2.sh"',
        "scripts/check_*.py",
        "tests/test_storyboard_stale_script_fallback.py",
        "new_html-src.tgz",
        "--exclude='new_html/node_modules'",
        "--exclude='new_html/.env'",
        "dist.bak.",
        "npm run build",
        "tar -xzf '$FRONTEND_TAR_REMOTE' -C '$REMOTE_DIR'",
    ]
    forbidden_snippets = [
        "new_html/node_modules\"",
        "new_html/.env\"",
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


def check_admin_api_config_ui_contract(root: Path) -> int:
    """Admin API config UI should avoid stale or provider-only runtime status."""
    page_path = root / "new_html" / "admin" / "AdminSettingsPage.tsx"
    text = page_path.read_text(encoding="utf-8")
    required_snippets = [
        "function healthStatusFromResult",
        "const status = healthStatusFromResult(result)",
        "function runtimeStatusKey",
        "function providerHealthKey",
        "function providerHealthFrom",
        "const runtimeByKey = useMemo",
        "const runtimeForConfig = useCallback",
        "const runtime = runtimeForConfig(config);",
        "runtime={runtime}",
        "health={providerHealthFrom(healthMap, provider, modelName)}",
        "checking={Boolean(checking[providerHealthKey(provider, modelName)])}",
        "interface ProviderHealthMonitorState",
        "monitor_state?: ProviderHealthMonitorState",
        "const ProviderHealthMonitorStrip",
        "setMonitorState(data.monitor_state || null)",
        "<ProviderHealthMonitorStrip state={monitorState} />",
        "setMonitorState(result.monitor_state || null)",
        "query.set('model_name', model)",
        "onCheck(provider, config.model_name || runtime?.runtime_model_name || null)",
        "onCheck(provider, model || null)",
        "body: JSON.stringify({ targets })",
        "putProviderHealth(next, item)",
    ]
    forbidden_snippets = [
        "const status = healthStatusFrom(result, runtimeMap.get(provider))",
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
    frontend_ai_proxy_checks = check_frontend_ai_proxy_contract(root)
    frontend_http_client_checks = check_frontend_http_client_contract(root)
    service_mapper_purity_checks = check_service_mapper_purity_contract(root)
    frontend_lazy_video_checks = check_frontend_lazy_video_contract(root)
    frontend_ai_chunk_split_checks = check_frontend_ai_chunk_split_contract(root)
    frontend_workflow_chunk_checks = check_frontend_workflow_chunk_contract(root)
    frontend_three_chunk_checks = check_frontend_three_chunk_contract(root)
    frontend_flow_chunk_checks = check_frontend_flow_chunk_contract(root)
    frontend_core_vendor_chunk_checks = check_frontend_core_vendor_chunk_contract(root)
    frontend_utility_vendor_chunk_checks = check_frontend_utility_vendor_chunk_contract(root)
    frontend_dependency_checks = check_frontend_dependency_contract(root)
    frontend_app_shell_chunk_checks = check_frontend_app_shell_chunk_contract(root)
    live_deploy_frontend_checks = check_live_deploy_frontend_contract(root)
    admin_api_config_ui_checks = check_admin_api_config_ui_contract(root)
    architecture_contract_runner_checks = check_architecture_contract_runner(root)
    fallback_static_route_handlers = check_fallback_static_routes_extracted(root)
    generation_route_handlers = check_generation_routes_extracted(root)
    auth_route_handlers = check_auth_routes_extracted(root)
    auth_legacy_route_handlers = check_auth_legacy_routes_extracted(root)
    password_minimum_checks = check_password_minimum_contract(root)
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
    print(f"  frontend_ai_proxy_checks={frontend_ai_proxy_checks}")
    print(f"  frontend_http_client_checks={frontend_http_client_checks}")
    print(f"  service_mapper_purity_checks={service_mapper_purity_checks}")
    print(f"  frontend_lazy_video_checks={frontend_lazy_video_checks}")
    print(f"  frontend_ai_chunk_split_checks={frontend_ai_chunk_split_checks}")
    print(f"  frontend_workflow_chunk_checks={frontend_workflow_chunk_checks}")
    print(f"  frontend_three_chunk_checks={frontend_three_chunk_checks}")
    print(f"  frontend_flow_chunk_checks={frontend_flow_chunk_checks}")
    print(f"  frontend_core_vendor_chunk_checks={frontend_core_vendor_chunk_checks}")
    print(f"  frontend_utility_vendor_chunk_checks={frontend_utility_vendor_chunk_checks}")
    print(f"  frontend_dependency_checks={frontend_dependency_checks}")
    print(f"  frontend_app_shell_chunk_checks={frontend_app_shell_chunk_checks}")
    print(f"  live_deploy_frontend_checks={live_deploy_frontend_checks}")
    print(f"  admin_api_config_ui_checks={admin_api_config_ui_checks}")
    print(f"  architecture_contract_runner_checks={architecture_contract_runner_checks}")
    print(f"  fallback_static_route_handlers={fallback_static_route_handlers}")
    print(f"  generation_route_handlers={generation_route_handlers}")
    print(f"  auth_route_handlers={auth_route_handlers}")
    print(f"  auth_legacy_route_handlers={auth_legacy_route_handlers}")
    print(f"  password_minimum_checks={password_minimum_checks}")
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
