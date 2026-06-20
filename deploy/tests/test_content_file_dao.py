import pytest

from dao.content import content as content_module
from dao.content.content import FileDAO


class _FakeDB:
    def __init__(self):
        self.calls = []

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        return {"file_id": args[0], "file_path": "/tmp/example.png"}

    async def fetch(self, query, *args):
        self.calls.append((query, args))
        return [{"file_id": "file_1", "user_id": args[0]}]


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


@pytest.mark.asyncio
async def test_get_user_files_returns_empty_list_when_db_unavailable(monkeypatch):
    monkeypatch.setattr(content_module, "get_db_manager", lambda: None)

    result = await FileDAO.get_user_files("user_missing_db", limit=10, offset=0)

    assert result == []


@pytest.mark.asyncio
async def test_get_user_files_uses_user_filter_and_limit(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(content_module, "get_db_manager", lambda: db)

    result = await FileDAO.get_user_files("user_123", file_type="image", limit=10, offset=5)

    assert result == [{"file_id": "file_1", "user_id": "user_123"}]
    assert len(db.calls) == 1
    query, args = db.calls[0]
    assert "WHERE user_id = $1 AND file_type = $2 AND is_deleted = FALSE" in query
    assert args == ("user_123", "image", 10, 5)
