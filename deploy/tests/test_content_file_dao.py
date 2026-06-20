import pytest

from dao.content import content as content_module
from dao.content.content import FileDAO


class _FakeDB:
    def __init__(self):
        self.calls = []

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        return {"file_id": args[0], "file_path": "/tmp/example.png"}


@pytest.mark.asyncio
async def test_get_file_returns_none_when_db_unavailable(monkeypatch):
    monkeypatch.setattr(content_module, "get_db_manager", lambda: None)

    result = await FileDAO.get_file("file_missing_db")

    assert result is None


@pytest.mark.asyncio
async def test_get_file_uses_file_id_and_filters_deleted(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(content_module, "get_db_manager", lambda: db)

    result = await FileDAO.get_file("file_123")

    assert result == {"file_id": "file_123", "file_path": "/tmp/example.png"}
    assert len(db.calls) == 1
    query, args = db.calls[0]
    assert "WHERE file_id = $1 AND is_deleted = FALSE" in query
    assert args == ("file_123",)
