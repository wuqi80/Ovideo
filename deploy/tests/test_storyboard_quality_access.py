from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import storyboard_quality
from services.project_access_service import ProjectAccessDenied


class StoryboardDAO:
    @staticmethod
    async def get_by_id(item_id):
        if item_id == "missing":
            return None
        return {"item_id": item_id, "episode_id": "ep_1"}


class EpisodeDAO:
    @staticmethod
    async def get_project_id(episode_id):
        return "project_1"


class FileDAO:
    @staticmethod
    async def get_file(file_id):
        return None

    @staticmethod
    async def merge_metadata(file_id, metadata):
        raise AssertionError("metadata must not be written in this test")


def _app(project_access_checker):
    async def get_current_user():
        return "user_1"

    app = FastAPI()
    app.include_router(storyboard_quality.create_storyboard_quality_router(
        get_current_user_dependency=get_current_user,
        file_dao=FileDAO,
        storyboard_dao=StoryboardDAO,
        episode_dao=EpisodeDAO,
        project_access_checker=project_access_checker,
    ))
    return app


def test_quality_review_rejects_non_project_member(monkeypatch):
    called = False

    async def deny(*_args, **_kwargs):
        raise ProjectAccessDenied("denied")

    async def review(**_kwargs):
        nonlocal called
        called = True
        return {"status": "passed"}

    monkeypatch.setattr(storyboard_quality, "review_storyboard_image", review)
    response = TestClient(_app(deny)).post(
        "/api/storyboard-items/sb_1/quality-review",
        json={"image_url": "/storage/candidate.webp"},
    )

    assert response.status_code == 404
    assert called is False


def test_quality_review_allows_project_member(monkeypatch):
    async def allow(project_id, identity, role):
        assert (project_id, identity, role) == ("project_1", "user_1", "readonly")
        return {"project_id": project_id}

    async def review(**_kwargs):
        return {"status": "passed"}

    monkeypatch.setattr(storyboard_quality, "review_storyboard_image", review)
    response = TestClient(_app(allow)).post(
        "/api/storyboard-items/sb_1/quality-review",
        json={"image_url": "/storage/candidate.webp"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "passed"}
