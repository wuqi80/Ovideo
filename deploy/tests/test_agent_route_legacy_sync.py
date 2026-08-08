import agent_routes
import dao_content
import file_service


async def test_agent_persist_syncs_video_segment_legacy_url(monkeypatch):
    created = []
    synced = []

    async def fake_create_file(**kwargs):
        created.append(kwargs)
        return {"file_id": "file_1"}

    async def fake_sync(entity_type, entity_id, file_role, file_url):
        synced.append((entity_type, entity_id, file_role, file_url))

    monkeypatch.setattr(dao_content.FileDAO, "create_file", fake_create_file)
    monkeypatch.setattr(file_service, "_sync_legacy_on_file_create", fake_sync)

    entries = [
        {
            "filename": "clip.mp4",
            "file_path": "persistent_storage/videos/clip.mp4",
            "url": "/storage/videos/clip.mp4",
            "size": 123,
            "file_type": "video",
            "mime_type": "video/mp4",
        }
    ]
    await agent_routes._persist_to_db(
        entries,
        "task_1",
        {
            "entity_type": "video_segment",
            "entity_id": "seg_1",
            "file_role": "video",
        },
        "user_1",
    )

    assert created[0]["entity_type"] == "video_segment"
    assert entries[0]["file_id"] == "file_1"
    assert synced == [
        (
            "video_segment",
            "seg_1",
            "video",
            "/storage/videos/clip.mp4",
        )
    ]
