# -*- coding: utf-8 -*-
"""
Credit API Routes
==================
/api/credits/* — 用户侧积分接口（余额 / 估算 / 流水）。

详见 docs/superpowers/plans/2026-05-26-feature-rollout/02-credits.md
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import credit_service
from api_routes import get_current_user
from dao_credit import CreditAccountDAO, CreditTransactionDAO

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/credits", tags=["credits"])


# ============================================
# 请求模型
# ============================================
class CreditEstimateRequest(BaseModel):
    feature_key: str
    params: Optional[Dict[str, Any]] = None


# ============================================
# 路由
# ============================================

@router.get("/balance")
async def get_balance(user_id: str = Depends(get_current_user)):
    """获取当前用户的积分账户余额（不存在则自动创建）。"""
    try:
        account = await CreditAccountDAO.get_or_create('user', user_id)
        return {
            "success": True,
            "account_id": account['account_id'],
            "available_credits": int(account.get('available_credits') or 0),
            "frozen_credits": int(account.get('frozen_credits') or 0),
            "total_used_credits": int(account.get('total_used_credits') or 0),
        }
    except Exception as e:
        logger.error(f"获取积分余额失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/estimate")
async def estimate_credits(
    payload: CreditEstimateRequest,
    user_id: str = Depends(get_current_user),
):
    """估算某 feature_key 在指定参数下的积分消耗。"""
    if not payload.feature_key:
        raise HTTPException(status_code=400, detail="feature_key 不能为空")
    try:
        result = await credit_service.estimate(
            payload.feature_key,
            payload.params or {},
            owner_type='user',
            owner_id=user_id,
        )
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"积分估算失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transactions")
async def list_transactions(
    user_id: str = Depends(get_current_user),
    feature_key: Optional[str] = None,
    change_type: Optional[str] = None,
    from_dt: Optional[str] = None,
    to_dt: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """当前用户的积分流水。"""
    try:
        limit = max(1, min(limit, 500))
        offset = max(0, offset)
        txns = await CreditTransactionDAO.list_for_user(
            user_id,
            feature_key=feature_key,
            change_type=change_type,
            from_dt=from_dt,
            to_dt=to_dt,
            limit=limit,
            offset=offset,
        )
        return {
            "success": True,
            "transactions": txns,
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        logger.error(f"获取积分流水失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
