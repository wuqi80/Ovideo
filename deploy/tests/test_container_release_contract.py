from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_release_image_and_metadata_are_bound_to_git_revision():
    script = (DEPLOY_DIR / "scripts" / "deploy_ostory_podman.sh").read_text(encoding="utf-8")

    assert 'GIT_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD)"' in script
    assert 'IMAGE="localhost/ostory-app:${GIT_SHA}"' in script
    assert 'release_metadata.json' in script
    assert '--env "GIT_SHA=$GIT_SHA"' in script
    assert '--env "RELEASED_AT=$RELEASED_AT"' in script


def test_release_builds_main_and_studio_frontends_from_one_revision():
    dockerfile = (DEPLOY_DIR / "containers" / "app.Dockerfile").read_text(encoding="utf-8")

    assert "AS web-build" in dockerfile
    assert "AS studio-build" in dockerfile
    assert "COPY --from=web-build /source/deploy/dist ./dist" in dockerfile
    assert "COPY --from=studio-build /source/studio/dist /studio/dist" in dockerfile


def test_release_preserves_runtime_and_uploaded_workflow_state():
    script = (DEPLOY_DIR / "scripts" / "deploy_ostory_podman.sh").read_text(encoding="utf-8")

    assert "ostory-storage:/app/persistent_storage" in script
    assert "ostory-workflows:/app/workflows" in script
    assert "ostory-postgres:/var/lib/postgresql/data" in script


def test_release_health_gate_fails_when_the_application_exits():
    script = (DEPLOY_DIR / "scripts" / "deploy_ostory_podman.sh").read_text(encoding="utf-8")

    assert "for attempt in $(seq 1 60)" in script
    assert 'if [[ "$app_state" == "exited" || "$app_state" == "dead" ]]' in script
    assert "ostory-app container exited before health verification" in script
