from dao.user import user as user_module
from dao.user.user import UserDAO


class _FakeDB:
    def __init__(self):
        self.calls = []

    async def execute(self, query, *args):
        self.calls.append((query, args))
        return "DELETE 1"


async def test_delete_user_by_id_returns_none_when_db_unavailable(monkeypatch):
    monkeypatch.setattr(user_module, "get_db_manager", lambda: None)

    result = await UserDAO.delete_user_by_id("user_missing_db")

    assert result is None


async def test_delete_user_by_id_uses_user_id_parameter(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(user_module, "get_db_manager", lambda: db)

    result = await UserDAO.delete_user_by_id("user_123")

    assert result == "DELETE 1"
    assert len(db.calls) == 1
    query, args = db.calls[0]
    assert "DELETE FROM users WHERE user_id = $1" in query
    assert args == ("user_123",)
