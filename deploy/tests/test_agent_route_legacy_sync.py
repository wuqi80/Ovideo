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


async def test_agent_persist_keeps_upscale_source_metadata(monkeypatch):
    created = []

    async def fake_create_file(**kwargs):
        created.append(kwargs)
        return {"file_id": "file_result"}

    monkeypatch.setattr(dao_content.FileDAO, "create_file", fake_create_file)

    entries = [{
        "filename": "poster_50000px.png",
        "file_path": "agent://gpu-agent/output-large",
        "url": "/api/node-outputs/task-upscale/output-large/download",
        "size": 227852471,
        "file_type": "image",
        "mime_type": "image/png",
        "node_output_id": "output-large",
        "node_agent_id": "gpu-agent",
    }]
    await agent_routes._persist_to_db(
        entries,
        "task-upscale",
        {
            "file_role": "upscaled_image",
            "requested_workflow_type": "image_upscale",
            "display_name": "图片高清放大",
            "source_page": "image-upscale",
            "source_file_id": "file_source",
        },
        "user_1",
    )

    assert created[0]["metadata"] == {
        "task_id": "task-upscale",
        "source": "node_local_output",
        "requested_workflow_type": "image_upscale",
        "display_name": "图片高清放大",
        "source_page": "image-upscale",
        "source_file_id": "file_source",
        "node_output_id": "output-large",
        "node_agent_id": "gpu-agent",
        "expires_at": None,
    }


async def test_agent_persist_recovers_upscale_source_id_from_agent_files(monkeypatch):
    created = []

    async def fake_create_file(**kwargs):
        created.append(kwargs)
        return {"file_id": "file_result"}

    monkeypatch.setattr(dao_content.FileDAO, "create_file", fake_create_file)

    await agent_routes._persist_to_db(
        [{
            "filename": "poster_50000px.png",
            "file_path": "agent://gpu-agent/output-large",
            "url": "/api/node-outputs/task-upscale/output-large/download",
            "size": 227852471,
            "file_type": "image",
            "mime_type": "image/png",
        }],
        "task-upscale",
        {
            "file_role": "upscaled_image",
            "requested_workflow_type": "image_upscale",
            "agent_files": [{
                "param": "image_path",
                "filename": "file_source.png",
                "url": "/api/files/file_source/download",
            }],
        },
        "user_1",
    )

    assert created[0]["metadata"]["source_file_id"] == "file_source"
