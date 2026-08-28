import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import phone_auth


class Logger:
    def __init__(self):
        self.warnings = []

    def error(self, *_args, **_kwargs):
        pass

    def warning(self, *args, **_kwargs):
        self.warnings.append((args, _kwargs))


class FailingEmailManager:
    def __init__(self, _redis):
        pass

    async def issue(self, **_kwargs):
        raise RuntimeError("mail queue unavailable")


@pytest.mark.asyncio
async def test_optional_email_delivery_failure_does_not_turn_registration_into_failure(monkeypatch):
    logger = Logger()
    user = {
        "user_id": "user_phone",
        "username": "13800138000",
        "phone_number": "13800138000",
        "email": "creator@example.com",
        "email_verified": False,
    }

    async def register(**_kwargs):
        return user

    async def grant(_user_id):
        return {"granted": False, "amount": 0, "account": {}}

    monkeypatch.setattr(phone_auth, "register_phone_account", register)
    monkeypatch.setattr(phone_auth, "grant_daily_login_points", grant)
    monkeypatch.setattr(phone_auth, "smtp_enabled", lambda: True)
    monkeypatch.setattr(phone_auth, "VerificationCodeManager", FailingEmailManager)

    api = FastAPI()
    api.include_router(
        phone_auth.create_phone_auth_router(
            get_redis_client=lambda: object(),
            create_session_token=lambda user_id: f"token:{user_id}",
            require_auth_dependency=lambda: {"user_id": "user_phone"},
            user_dao=object(),
            logger=logger,
        )
    )

    async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as client:
        response = await client.post(
            "/api/auth/phone/register",
            json={
                "phone": "13800138000",
                "code": "888888",
                "password": "secure-pass",
                "email": "creator@example.com",
            },
        )

    assert response.status_code == 200, response.text
    assert response.json()["token"] == "token:user_phone"
    assert response.json()["email_verification_sent"] is False
    assert logger.warnings
