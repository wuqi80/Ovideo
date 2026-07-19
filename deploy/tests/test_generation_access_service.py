from types import SimpleNamespace

import pytest

from services.entity_access_service import EntityAccessDenied
from services.generation_access_service import (
    GenerationAccessDenied,
    require_generation_request_access,
)


class FakeFileDAO:
    def __init__(self, records=None):
        self.records = {row["file_id"]: row for row in (records or [])}

    async def get_file(self, file_id):
        return self.records.get(file_id)

    async def get_file_by_url(self, url):
        return next((row for row in self.records.values() if row.get("file_url") == url), None)

    async def get_file_by_comfyui_filename(self, filename):
        return next((row for row in self.records.values() if row.get("file_name") == filename), None)


async def allow_project(project_id, identity, role):
    return {"project_id": project_id, "role": role}


async def resolve_entity(entity_type, entity_id, identity, role):
    scopes = {
        ("episode", "ep_1"): {"project_id": "proj_1", "episode_id": "ep_1"},
        ("storyboard_item", "sb_1"): {"project_id": "proj_1", "episode_id": "ep_1"},
    }
    if (entity_type, entity_id) not in scopes:
        raise EntityAccessDenied("denied")
    return scopes[(entity_type, entity_id)]


async def allow_file(file_id, identity, role, *, file_dao):
    row = dict(await file_dao.get_by_id(file_id) or {})
    if not row:
        raise EntityAccessDenied("denied")
    row["_access_project_id"] = row.get("project_id", "")
    return row


def scoped_request(**overrides):
    values = {
        "project_id": "proj_1",
        "episode_id": "ep_1",
        "entity_type": "storyboard_item",
        "entity_id": "sb_1",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_generation_scope_and_owned_local_source_are_authorized():
    files = FakeFileDAO(
        [{"file_id": "file_1", "file_name": "source.png", "file_url": "/storage/source.png", "project_id": "proj_1"}]
    )

    scope = await require_generation_request_access(
        scoped_request(),
        "yuan",
        ["source.png"],
        file_dao=files,
        entity_access_checker=resolve_entity,
        project_access_checker=allow_project,
        file_access_checker=allow_file,
    )

    assert scope == {"project_id": "proj_1", "episode_id": "ep_1"}


@pytest.mark.asyncio
async def test_generation_rejects_cross_project_source_even_when_file_is_readable():
    files = FakeFileDAO(
        [{"file_id": "file_2", "file_name": "foreign.png", "file_url": "/storage/foreign.png", "project_id": "proj_2"}]
    )

    with pytest.raises(GenerationAccessDenied):
        await require_generation_request_access(
            scoped_request(),
            "yuan",
            ["foreign.png"],
            file_dao=files,
            entity_access_checker=resolve_entity,
            project_access_checker=allow_project,
            file_access_checker=allow_file,
        )


@pytest.mark.asyncio
async def test_generation_rejects_mismatched_entity_and_project_scope():
    with pytest.raises(GenerationAccessDenied):
        await require_generation_request_access(
            scoped_request(project_id="proj_other"),
            "yuan",
            [],
            file_dao=FakeFileDAO(),
            entity_access_checker=resolve_entity,
            project_access_checker=allow_project,
            file_access_checker=allow_file,
        )


@pytest.mark.asyncio
async def test_generation_rejects_untracked_local_filename():
    with pytest.raises(GenerationAccessDenied):
        await require_generation_request_access(
            scoped_request(),
            "yuan",
            ["missing-local.png"],
            file_dao=FakeFileDAO(),
            entity_access_checker=resolve_entity,
            project_access_checker=allow_project,
            file_access_checker=allow_file,
        )


@pytest.mark.asyncio
async def test_generation_allows_inline_data_without_file_lookup():
    scope = await require_generation_request_access(
        scoped_request(),
        "yuan",
        ["data:image/png;base64,AAAA"],
        file_dao=FakeFileDAO(),
        entity_access_checker=resolve_entity,
        project_access_checker=allow_project,
        file_access_checker=allow_file,
    )

    assert scope["project_id"] == "proj_1"
