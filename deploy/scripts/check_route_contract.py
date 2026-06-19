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
    api_config_route_handlers = check_admin_api_config_routes_extracted(root)
    prompt_route_handlers = check_prompt_routes_extracted(root)
    cluster_status_route_handlers = check_cluster_status_routes_extracted(root)
    frontend_page_route_handlers = check_frontend_pages_routes_extracted(root)
    user_session_route_handlers = check_user_session_routes_extracted(root)
    workspace_route_handlers = check_workspace_routes_extracted(root)
    task_route_handlers = check_task_routes_extracted(root)
    fallback_static_route_handlers = check_fallback_static_routes_extracted(root)
    generation_route_handlers = check_generation_routes_extracted(root)
    project_route_handlers = check_project_routes_extracted(root)
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
    print(f"  fallback_static_route_handlers={fallback_static_route_handlers}")
    print(f"  generation_route_handlers={generation_route_handlers}")
    print(f"  project_route_handlers={project_route_handlers}")
    print("  duplicate_routes:")
    print(format_duplicates(duplicates, routes))

    if args.show_routes:
        print("  expected_endpoints:")
        for key in sorted(EXPECTED_ENDPOINTS):
            print(f"    {key} -> {routes[key][0]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
