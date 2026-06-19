#!/usr/bin/env python3
"""Verify MECHA FastAPI route contract after refactor increments.

The script intentionally imports cluster_main without starting uvicorn. Use it
after moving handlers between modules to make sure the public API surface stays
stable and no unexpected duplicate route registrations were introduced.
"""
from __future__ import annotations

import argparse
import ast
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable


HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
OPENAPI_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}

DEFAULT_EXPECTED_PATHS = 231
DEFAULT_EXPECTED_OPERATIONS = 287

# Known legacy overlap: cluster_main still owns the old project JSON model while
# api_routes exposes the newer DAO-backed project model. This is high coupling
# and tracked as a later migration, so the checker allows it but reports it.
ALLOWED_DUPLICATES = {
    ("/api/projects/{project_id}", "GET"),
}

EXPECTED_ENDPOINTS = {
    ("/api/login", "POST"): ("routers.auth", "login"),
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
    if not auth_path.exists():
        fail("routers/auth.py is missing")

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
    return route_count


def check_admin_compat_routes_extracted(root: Path) -> int:
    cluster_main_path = root / "cluster_main.py"
    admin_compat_path = root / "routers" / "admin_compat.py"
    if not admin_compat_path.exists():
        fail("routers/admin_compat.py is missing")

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
    return route_count


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
    api_config_route_handlers = check_admin_api_config_routes_extracted(root)
    prompt_route_handlers = check_prompt_routes_extracted(root)
    cluster_status_route_handlers = check_cluster_status_routes_extracted(root)
    frontend_page_route_handlers = check_frontend_pages_routes_extracted(root)
    user_session_route_handlers = check_user_session_routes_extracted(root)
    workspace_route_handlers = check_workspace_routes_extracted(root)
    task_route_handlers = check_task_routes_extracted(root)
    task_notification_route_handlers = check_task_notification_routes_extracted(root)
    fallback_static_route_handlers = check_fallback_static_routes_extracted(root)
    generation_route_handlers = check_generation_routes_extracted(root)
    auth_route_handlers = check_auth_routes_extracted(root)
    admin_compat_route_handlers = check_admin_compat_routes_extracted(root)
    project_route_handlers = check_project_routes_extracted(root)
    project_admin_route_handlers = check_project_admin_routes_extracted(root)
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
    print(f"  admin_api_config_route_handlers={api_config_route_handlers}")
    print(f"  prompt_route_handlers={prompt_route_handlers}")
    print(f"  cluster_status_route_handlers={cluster_status_route_handlers}")
    print(f"  frontend_page_route_handlers={frontend_page_route_handlers}")
    print(f"  user_session_route_handlers={user_session_route_handlers}")
    print(f"  workspace_route_handlers={workspace_route_handlers}")
    print(f"  task_route_handlers={task_route_handlers}")
    print(f"  task_notification_route_handlers={task_notification_route_handlers}")
    print(f"  fallback_static_route_handlers={fallback_static_route_handlers}")
    print(f"  generation_route_handlers={generation_route_handlers}")
    print(f"  auth_route_handlers={auth_route_handlers}")
    print(f"  admin_compat_route_handlers={admin_compat_route_handlers}")
    print(f"  project_route_handlers={project_route_handlers}")
    print(f"  project_admin_route_handlers={project_admin_route_handlers}")
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
