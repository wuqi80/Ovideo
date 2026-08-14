import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import final_product_share_routes as routes


class MediaDAO:
    item = {
        "library_item_id": "mli_final_1",
        "source": "composed_final",
        "user_id": "user_1",
        "project_id": "proj_1",
        "episode_id": "ep_1",
        "duration_seconds": 90,
    }

    @classmethod
    async def get(cls, library_item_id):
        return dict(cls.item) if library_item_id == "mli_final_1" else None


class ShareDAO:
    share = None
    feedback = []

    @classmethod
    async def get_active_for_item(cls, _library_item_id):
        return cls.share

    @classmethod
    async def create_or_get(cls, **kwargs):
        cls.share = {
            "share_id": "fps_1",
            "share_token": "public-token",
            "library_item_id": kwargs["library_item_id"],
            "owner_user_id": kwargs["owner_user_id"],
            "is_active": True,
            "access_count": 0,
        }
        return cls.share

    @classmethod
    async def deactivate(cls, share_id, owner_user_id):
        if share_id != "fps_1" or owner_user_id != "user_1":
            return False
        cls.share = None
        return True

    @classmethod
    async def get_public(cls, share_token):
        if share_token != "public-token" or not cls.share:
            return None
        return {
            "share_id": "fps_1",
            "title": "全片成片",
            "file_url": "/storage/video/final.mp4",
            "duration_seconds": 90,
        }

    @staticmethod
    async def increment_access(_share_id):
        return None

    @classmethod
    async def add_feedback(cls, **kwargs):
        row = {"feedback_id": "fpf_1", **kwargs}
        cls.feedback.insert(0, row)
        return row

    @classmethod
    async def list_feedback_for_share(cls, _share_id, limit=100):
        return cls.feedback[:limit]

    @classmethod
    async def list_feedback_for_item(cls, _library_item_id, limit=200):
        return cls.feedback[:limit]


def app():
    api = FastAPI()

    async def current_user():
        return "user_1"

    api.include_router(routes.create_final_product_share_router(
        get_current_user_dependency=current_user,
        share_dao=ShareDAO,
        media_dao=MediaDAO,
    ))
    return api


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    ShareDAO.share = None
    ShareDAO.feedback = []

    async def allowed(_item, _user_id):
        return True

    monkeypatch.setattr(routes.media_library_service, "can_view", allowed)
    monkeypatch.setattr(routes.media_library_service, "can_mutate", allowed)


@pytest.mark.asyncio
async def test_share_link_is_scoped_to_one_final_and_accepts_timestamped_feedback():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        created = await client.post("/api/final-products/mli_final_1/share")
        public = await client.get("/api/public/final-products/public-token")
        feedback = await client.post("/api/public/final-products/public-token/feedback", json={
            "author_name": "审片人",
            "content": "第十二秒转场过快",
            "timestamp_seconds": 12,
        })
        owner = await client.get("/api/final-products/mli_final_1/feedback")

    assert created.status_code == 200
    assert public.status_code == 200
    assert public.json()["final"]["file_url"] == "/storage/video/final.mp4"
    assert feedback.status_code == 200
    assert owner.json()["feedback"][0]["content"] == "第十二秒转场过快"
    assert owner.json()["feedback"][0]["timestamp_seconds"] == 12


@pytest.mark.asyncio
async def test_public_feedback_rejects_timestamp_after_final_duration():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        await client.post("/api/final-products/mli_final_1/share")
        response = await client.post("/api/public/final-products/public-token/feedback", json={
            "content": "超出时长",
            "timestamp_seconds": 120,
        })
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_stopped_share_immediately_invalidates_public_link():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        await client.post("/api/final-products/mli_final_1/share")
        stopped = await client.delete("/api/final-products/mli_final_1/share/fps_1")
        public = await client.get("/api/public/final-products/public-token")
    assert stopped.status_code == 200
    assert public.status_code == 404
