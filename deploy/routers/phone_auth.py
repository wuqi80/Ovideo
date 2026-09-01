"""Public phone authentication, legacy phone binding, and verified email routes."""
from __future__ import annotations

import logging
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services.binding_token_service import verify_binding_token
from services.creation_point_service import grant_daily_login_points
from services.email_delivery_service import enqueue_verification_email, smtp_enabled
from services.phone_auth_service import (
    AccountDisabled,
    AccountExists,
    AccountNotFound,
    InvalidCredentials,
    InvalidEmail,
    InvalidPhone,
    PhoneAuthError,
    begin_email_binding,
    bind_legacy_phone,
    login_phone_code,
    login_phone_password,
    merge_email_preferences,
    normalize_phone,
    register_phone_account,
    reset_phone_password,
    verify_email_binding,
)
from services.sms_provider_service import SmsProviderError, build_sms_provider
from services.verification_code_service import (
    VerificationCodeInvalid,
    VerificationCodeManager,
    VerificationConfigurationError,
    VerificationRateLimited,
)


class SmsCodeRequest(BaseModel):
    phone: str
    purpose: Literal["register", "login", "bind_phone", "password_reset"]
    binding_token: Optional[str] = None
    captcha_verification: Optional[str] = None


class PhoneRegisterRequest(BaseModel):
    phone: str
    code: str = Field(..., min_length=6, max_length=6)
    password: str = Field(..., min_length=8, max_length=128)
    email: Optional[str] = None


class PhoneLoginRequest(BaseModel):
    phone: str
    method: Literal["password", "sms_code"] = "password"
    password: Optional[str] = None
    code: Optional[str] = None


class LegacyPhoneBindRequest(BaseModel):
    binding_token: str
    phone: str
    code: str = Field(..., min_length=6, max_length=6)


class PasswordResetRequest(BaseModel):
    phone: str
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)


class EmailBindingRequest(BaseModel):
    email: str


class EmailVerifyRequest(BaseModel):
    email: str
    code: str = Field(..., min_length=6, max_length=6)


class EmailPreferencesRequest(BaseModel):
    task_success: Optional[bool] = None
    task_failure: Optional[bool] = None
    credit_alert: Optional[bool] = None
    sharing: Optional[bool] = None


def create_phone_auth_router(
    *,
    get_redis_client: Any,
    create_session_token: Any,
    require_auth_dependency: Any,
    user_dao: Any,
    logger: logging.Logger,
    mark_user_online: Any = None,
) -> APIRouter:
    router = APIRouter()

    def manager() -> VerificationCodeManager:
        redis_client = get_redis_client()
        if redis_client is None:
            raise HTTPException(status_code=503, detail="验证码服务暂不可用")
        try:
            return VerificationCodeManager(redis_client)
        except VerificationConfigurationError as exc:
            logger.error("Verification configuration is invalid: %s", exc)
            raise HTTPException(status_code=503, detail="验证码服务配置不完整") from exc

    def token_response(user: dict[str, Any]) -> dict[str, Any]:
        user_id = str(user["user_id"])
        return {
            "success": True,
            "token": create_session_token(user_id),
            "user_id": user_id,
            "username": user.get("username") or user_id,
            "phone": user.get("phone_number"),
            "email": user.get("email"),
            "email_verified": bool(user.get("email_verified")),
        }

    async def authenticated_response(user: dict[str, Any]) -> dict[str, Any]:
        if hasattr(user_dao, "update_last_login"):
            await user_dao.update_last_login(str(user["user_id"]))
        if mark_user_online:
            await mark_user_online(str(user["user_id"]))
        response = token_response(user)
        try:
            gift = await grant_daily_login_points(str(user["user_id"]))
            account = gift.get("account") or {}
            response["daily_gift"] = {
                "granted": bool(gift.get("granted")),
                "amount": int(gift.get("amount") or 0),
                "expires_at": gift.get("expires_at"),
            }
            response["creation_points"] = {
                "available": int(account.get("available_credits") or 0),
                "account": int(account.get("account_credits") or 0),
                "gift": int(account.get("gift_credits") or 0),
                "gift_expires_at": account.get("gift_expires_at"),
            }
        except Exception as exc:
            # 登录不能被赠送点数的瞬时故障阻断；幂等日记录允许用户下次登录补领。
            logger.warning("Daily creation-point grant failed user_id=%s: %s", user.get("user_id"), exc)
        return response

    def map_auth_error(exc: Exception) -> HTTPException:
        if isinstance(exc, VerificationRateLimited):
            return HTTPException(status_code=429, detail="验证码发送过于频繁，请稍后重试")
        if isinstance(exc, VerificationCodeInvalid):
            return HTTPException(status_code=400, detail="验证码错误或已失效")
        if isinstance(exc, (InvalidPhone, InvalidEmail)):
            return HTTPException(status_code=400, detail="手机号或邮箱格式不正确")
        if isinstance(exc, AccountExists):
            return HTTPException(status_code=409, detail=str(exc))
        if isinstance(exc, AccountDisabled):
            return HTTPException(status_code=403, detail="账号已被禁用")
        if isinstance(exc, (InvalidCredentials, AccountNotFound)):
            return HTTPException(status_code=401, detail="账号或凭证错误")
        if isinstance(exc, SmsProviderError):
            return HTTPException(status_code=503, detail="短信发送失败，请稍后重试")
        return HTTPException(status_code=400, detail=str(exc) or "认证请求失败")

    @router.post("/api/auth/sms-code")
    async def send_sms_code(body: SmsCodeRequest):
        try:
            phone = normalize_phone(body.phone)
            if body.purpose == "bind_phone":
                user_id = verify_binding_token(body.binding_token or "")
                if not user_id or not await user_dao.get_user_auth_by_id(user_id):
                    raise InvalidCredentials("binding token is invalid")
            elif body.purpose in {"login", "password_reset"}:
                # Do not disclose registration state through the response body.
                if not await user_dao.get_user_by_phone(phone):
                    return {"success": True, "expires_in": 300, "resend_in": 60}
            elif await user_dao.get_user_by_phone(phone):
                raise AccountExists("手机号已注册，请直接登录")

            provider = build_sms_provider()
            result = await manager().issue(
                channel="sms",
                target=phone,
                purpose=body.purpose,
                sender=provider.send_code,
            )
            response = {
                "success": True,
                "expires_in": result["expires_in"],
                "resend_in": result["resend_in"],
            }
            if result.get("development_code"):
                response["development_code"] = result["development_code"]
            return response
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/phone/register")
    async def register(body: PhoneRegisterRequest):
        try:
            user = await register_phone_account(
                phone=body.phone,
                password=body.password,
                email=body.email,
                code=body.code,
                verification_manager=manager(),
                user_dao=user_dao,
            )
            email_sent = False
            if user.get("email") and smtp_enabled():
                try:
                    email_result = await manager().issue(
                        channel="email",
                        target=user["email"],
                        purpose="email_verify",
                        sender=enqueue_verification_email,
                    )
                    email_sent = bool(email_result)
                except Exception as email_exc:
                    # 邮箱是可选能力：SMTP/队列故障不能把已经成功创建的账号
                    # 伪装成注册失败，否则用户重试时会遇到“手机号已注册”。
                    logger.warning(
                        "Registration email verification enqueue failed user_id=%s: %s",
                        user.get("user_id"),
                        email_exc,
                    )
            response = await authenticated_response(user)
            response["email_verification_sent"] = email_sent
            return response
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/phone/login")
    async def phone_login(body: PhoneLoginRequest):
        try:
            if body.method == "sms_code":
                if not body.code:
                    raise InvalidCredentials("verification code is required")
                user = await login_phone_code(
                    phone=body.phone,
                    code=body.code,
                    verification_manager=manager(),
                    user_dao=user_dao,
                )
            else:
                if not body.password:
                    raise InvalidCredentials("password is required")
                user = await login_phone_password(phone=body.phone, password=body.password, user_dao=user_dao)
            return await authenticated_response(user)
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/legacy/bind-phone")
    async def bind_phone(body: LegacyPhoneBindRequest):
        user_id = verify_binding_token(body.binding_token)
        if not user_id:
            raise HTTPException(status_code=401, detail="绑定凭证已失效，请重新登录旧账号")
        try:
            user = await bind_legacy_phone(
                user_id=user_id,
                phone=body.phone,
                code=body.code,
                verification_manager=manager(),
                user_dao=user_dao,
            )
            return await authenticated_response(user)
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/phone/password-reset")
    async def reset_password(body: PasswordResetRequest):
        try:
            user = await reset_phone_password(
                phone=body.phone,
                code=body.code,
                new_password=body.new_password,
                verification_manager=manager(),
                user_dao=user_dao,
            )
            return await authenticated_response(user)
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/me/email/send-code")
    async def send_email_code(
        body: EmailBindingRequest,
        user_id: str = Depends(require_auth_dependency),
    ):
        if not smtp_enabled():
            raise HTTPException(status_code=503, detail="邮件服务尚未配置")
        try:
            row = await begin_email_binding(user_id=user_id, email=body.email, user_dao=user_dao)
            result = await manager().issue(
                channel="email",
                target=row["email"],
                purpose="email_verify",
                sender=enqueue_verification_email,
            )
            return {"success": True, "expires_in": result["expires_in"], "resend_in": result["resend_in"]}
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/me/email/verify")
    async def verify_email(
        body: EmailVerifyRequest,
        user_id: str = Depends(require_auth_dependency),
    ):
        try:
            row = await verify_email_binding(
                user_id=user_id,
                email=body.email,
                code=body.code,
                verification_manager=manager(),
                user_dao=user_dao,
            )
            return {"success": True, "email": row["email"], "email_verified": True}
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.get("/api/me/email-preferences")
    async def get_email_preferences(user_id: str = Depends(require_auth_dependency)):
        user = await user_dao.get_user_auth_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        return {
            "success": True,
            "email": user.get("email"),
            "email_verified": bool(user.get("email_verified")),
            "preferences": merge_email_preferences(user.get("email_notification_preferences"), {}),
        }

    @router.put("/api/me/email-preferences")
    async def update_email_preferences(
        body: EmailPreferencesRequest,
        user_id: str = Depends(require_auth_dependency),
    ):
        user = await user_dao.get_user_auth_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        updates = {key: value for key, value in body.model_dump().items() if value is not None}
        preferences = merge_email_preferences(user.get("email_notification_preferences"), updates)
        await user_dao.update_email_notification_preferences(user_id, preferences)
        return {"success": True, "preferences": preferences}

    return router
