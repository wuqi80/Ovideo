from unittest.mock import AsyncMock, patch

import pytest

from worker import Worker


@pytest.mark.asyncio
async def test_dashscope_url_resolution_allows_soft_deleted_current_storage_url(tmp_path):
    source = tmp_path / "source.png"
    source.write_bytes(b"fake-png-bytes")
    fake_record = {
        "file_path": str(source),
        "mime_type": "image/png",
    }

    worker = Worker.__new__(Worker)
    with patch("core.worker.FileDAO.get_file_by_url", AsyncMock(return_value=fake_record)) as lookup:
        result = await worker._file_id_to_dashscope_url(
            "/storage/image/Yuan/proj/ep/202607/source.png?token=secret",
            label="seedance_image_0",
        )

    assert result.startswith("data:image/png;base64,")
    lookup.assert_awaited_once_with(
        "/storage/image/Yuan/proj/ep/202607/source.png?token=secret",
        include_deleted=True,
    )
