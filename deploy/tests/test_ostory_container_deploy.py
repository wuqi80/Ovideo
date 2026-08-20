from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
CONTAINER_DIR = DEPLOY_DIR / "containers"


def test_ostory_image_builds_both_frontends_and_runs_canonical_migrations():
    dockerfile = (CONTAINER_DIR / "app.Dockerfile").read_text(encoding="utf-8")
    entrypoint = (CONTAINER_DIR / "entrypoint.sh").read_text(encoding="utf-8")

    assert "FROM docker.io/library/node:22-bookworm-slim AS newui-build" in dockerfile
    assert "FROM docker.io/library/node:22-bookworm-slim AS studio-build" in dockerfile
    assert "FROM docker.io/library/python:3.12-slim-bookworm AS runtime" in dockerfile
    assert "COPY deploy/new_html /source/deploy/new_html" in dockerfile
    assert "COPY --from=newui-build /source/deploy/new_html/node_modules /source/deploy/new_html/node_modules" in dockerfile
    assert "COPY --from=newui-build /source/deploy/dist ./dist" in dockerfile
    assert "COPY --from=studio-build /source/studio/dist /studio/dist" in dockerfile
    assert "python db_build/build_fresh_db.py" in entrypoint
    assert "exec python cluster_main.py" in entrypoint


def test_ostory_pod_exposes_only_https_ingress_and_persists_state():
    script = (DEPLOY_DIR / "scripts" / "deploy_ostory_podman.sh").read_text(encoding="utf-8")

    assert "--publish 80:80" in script
    assert "--publish 443:443" in script
    assert "--ulimit nofile=1048576:1048576" in script
    assert "--publish 5432" not in script
    assert "--publish 6379" not in script
    assert "ostory-postgres:/var/lib/postgresql/data" in script
    assert "ostory-storage:/app/persistent_storage" in script
    assert "systemctl enable" in script
    assert "--privileged" not in script


def test_ostory_public_domain_and_production_defaults_are_explicit():
    caddy = (CONTAINER_DIR / "Caddyfile").read_text(encoding="utf-8")
    env_example = (CONTAINER_DIR / "ostory.env.example").read_text(encoding="utf-8")

    assert caddy.startswith("tv.ostory.ai {")
    assert "reverse_proxy 127.0.0.1:6006" in caddy
    assert "CORS_ALLOW_ORIGINS=https://tv.ostory.ai" in env_example
    assert "ALLOW_DEV_ADMIN_PASSWORD=false" in env_example
    assert "AGENT_ONLY_MODE=true" in env_example
    assert "change-me-" in env_example
