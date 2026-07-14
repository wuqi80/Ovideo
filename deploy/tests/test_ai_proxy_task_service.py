import pytest

from services.ai_proxy_task_service import (
    complete_ai_proxy_image_task,
    complete_ai_proxy_text_task,
    create_completed_gemini_text_task,
    create_completed_image_task,
    create_deepseek_text_task,
    fail_ai_proxy_task,
    start_ai_proxy_task,
)


class _Logger:
    infos = []
    errors = []

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def error(cls, *args, **kwargs):
        cls.errors.append((args, kwargs))


class _TaskDAO:
    created = []
    updated = []
    create_error = None
    update_error = None

    @classmethod
    async def create_task(cls, **kwargs):
        if cls.create_error:
            raise cls.create_error
        cls.created.append(kwargs)

    @classmethod
    async def update_task_status(cls, **kwargs):
        if cls.update_error:
            raise cls.update_error
        cls.updated.append(kwargs)


@pytest.fixture(autouse=True)
def _reset_state():
    _Logger.infos = []
    _Logger.errors = []
    _TaskDAO.created = []
    _TaskDAO.updated = []
    _TaskDAO.create_error = None
    _TaskDAO.update_error = None


@pytest.mark.asyncio
async def test_create_deepseek_text_task_truncates_prompt_and_returns_id():
    task_id = await create_deepseek_text_task(
        user_id="yuan",
        prompt="x" * 600,
        response_format="json",
        temperature=0.3,
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 123,
    )

    assert task_id == "deepseek_text_123"
    assert _TaskDAO.created == [
        {
            "task_id": "deepseek_text_123",
            "user_id": "yuan",
            "task_type": "deepseek_text",
            "task_data": {
                "prompt": "x" * 500,
                "response_format": "json",
                "temperature": 0.3,
            },
        }
    ]


@pytest.mark.asyncio
async def test_complete_ai_proxy_text_task_truncates_result():
    ok = await complete_ai_proxy_text_task(
        task_id="task_1",
        text_content="a" * 2500,
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is True
    assert _TaskDAO.updated == [
        {
            "task_id": "task_1",
            "status": "completed",
            "result_data": {"text": "a" * 2000, "full_length": 2500},
        }
    ]


@pytest.mark.asyncio
async def test_create_completed_gemini_text_task_creates_and_completes():
    task_id = await create_completed_gemini_text_task(
        user_id="yuan",
        prompt="prompt",
        system_prompt="s" * 300,
        temperature=0.7,
        model="gemini-model",
        content="answer",
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 456,
    )

    assert task_id == "gemini_text_456"
    assert _TaskDAO.created[0]["task_data"] == {
        "prompt": "prompt",
        "system_prompt": "s" * 200,
        "temperature": 0.7,
        "model": "gemini-model",
    }
    assert _TaskDAO.updated[0]["task_id"] == "gemini_text_456"
    assert _TaskDAO.updated[0]["result_data"] == {"text": "answer", "full_length": 6}


@pytest.mark.asyncio
async def test_create_completed_image_task_creates_and_completes():
    task_id = await create_completed_image_task(
        task_id_prefix="gemini_img",
        user_id="yuan",
        task_type="gemini_image_flash",
        task_data={"prompt": "draw"},
        images_count=3,
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 789,
    )

    assert task_id == "gemini_img_789"
    assert _TaskDAO.created[0]["task_type"] == "gemini_image_flash"
    assert _TaskDAO.updated == [
        {
            "task_id": "gemini_img_789",
            "status": "completed",
            "result_data": {"images_count": 3},
        }
    ]


@pytest.mark.asyncio
async def test_start_and_fail_ai_proxy_task_updates_status():
    task_id = await start_ai_proxy_task(
        task_id_prefix="doubao_img",
        user_id="yuan",
        task_type="doubao_image",
        task_data={"prompt": "draw", "entity_id": "asset_1"},
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 111,
    )

    assert task_id == "doubao_img_111"
    assert _TaskDAO.created[0]["task_id"] == "doubao_img_111"
    assert _TaskDAO.updated == [
        {"task_id": "doubao_img_111", "status": "processing"}
    ]

    ok = await fail_ai_proxy_task(
        task_id=task_id,
        error_message="upstream failed",
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is True
    assert _TaskDAO.updated[-1] == {
        "task_id": "doubao_img_111",
        "status": "failed",
        "error_message": "upstream failed",
    }


@pytest.mark.asyncio
async def test_complete_ai_proxy_image_task_updates_existing_task():
    ok = await complete_ai_proxy_image_task(
        task_id="gemini_img_1",
        images_count=2,
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is True
    assert _TaskDAO.updated == [
        {
            "task_id": "gemini_img_1",
            "status": "completed",
            "result_data": {"images_count": 2},
        }
    ]


@pytest.mark.asyncio
async def test_task_persistence_failures_are_nonfatal():
    _TaskDAO.create_error = RuntimeError("db down")

    task_id = await create_deepseek_text_task(
        user_id="yuan",
        prompt="prompt",
        response_format=None,
        temperature=0.1,
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 1,
    )

    assert task_id is None
    assert _Logger.errors

    _TaskDAO.create_error = None
    _TaskDAO.update_error = RuntimeError("update down")

    ok = await complete_ai_proxy_text_task(
        task_id="task_2",
        text_content="answer",
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is False
