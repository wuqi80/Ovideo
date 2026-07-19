import pytest

from dao.business import task as task_module


class _FakeDb:
    def __init__(self):
        self.args = None

    async def execute(self, query, *args):
        self.args = args
        return "UPDATE 4"


@pytest.mark.asyncio
async def test_cleanup_stale_defaults_to_twenty_four_hours(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(task_module, "get_db_manager", lambda: db)

    cleaned = await task_module.TaskDAO.cleanup_stale()

    assert cleaned == 4
    assert db.args == (24, 50)
