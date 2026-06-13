# -*- coding: utf-8 -*-
"""
Credit Service
===============
统一的积分预估 / 冻结 / 结算 / 退还。

调用流程：
    estimate(feature_key, params) -> {estimated_cost, balance, enough, rule_version, ...}
    freeze(owner_type, owner_id, feature_key, amount, task_id) -> freeze_id
    confirm(task_id, final_amount, operator=None) -> dict   # 任务成功后
    release(task_id, operator=None, reason=None) -> dict   # 任务失败/取消后

所有变动都会写入 credit_transactions。线程安全靠 PG 行锁
(SELECT ... FOR UPDATE) 实现。

详见 docs/superpowers/plans/2026-05-26-feature-rollout/02-credits.md
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from dao_credit import (
    CreditAccountDAO,
    CreditFreezeDAO,
    CreditRuleDAO,
    CreditTransactionDAO,
)
from db_manager import get_db_manager

logger = logging.getLogger(__name__)


class InsufficientCreditsError(Exception):
    pass


class CreditServiceError(Exception):
    pass


# ============================================
# Factor evaluation
# ============================================

def _eval_factor(factor: Dict[str, Any], params: Dict[str, Any]) -> float:
    """单个 factor 返回 multiplier (默认 1.0)"""
    if not isinstance(factor, dict):
        return 1.0
    key = factor.get('key')
    if not key:
        return 1.0
    ftype = factor.get('type', 'multiplier')
    value = params.get(key)

    if ftype == 'multiplier':
        try:
            mult = float(factor.get('multiplier', 1))
        except (TypeError, ValueError):
            mult = 1.0
        # 如果 factor 声明 per_unit，则 final mult = value * multiplier
        per_unit = factor.get('per_unit')
        if per_unit and value is not None:
            try:
                return float(value) * mult
            except (TypeError, ValueError):
                return mult
        return mult

    if ftype == 'range':
        if value is None:
            return 1.0
        try:
            v = float(value)
        except (TypeError, ValueError):
            return 1.0
        for r in factor.get('rules', []) or []:
            lo = r.get('min')
            hi = r.get('max')
            ok_lo = (lo is None) or (v >= lo)
            ok_hi = (hi is None) or (v <= hi)
            if ok_lo and ok_hi:
                try:
                    return float(r.get('multiplier', 1))
                except (TypeError, ValueError):
                    return 1.0
        # 默认 fallback
        try:
            return float(factor.get('default_multiplier', 1))
        except (TypeError, ValueError):
            return 1.0

    if ftype == 'enum':
        # rules: [{value:'standard', multiplier: 1}, ...]
        for r in factor.get('rules', []) or []:
            if str(r.get('value')) == str(value):
                try:
                    return float(r.get('multiplier', 1))
                except (TypeError, ValueError):
                    return 1.0
        try:
            return float(factor.get('default_multiplier', 1))
        except (TypeError, ValueError):
            return 1.0

    return 1.0


def compute_cost(rule: Dict[str, Any], params: Dict[str, Any]) -> int:
    base = int(rule.get('base_cost', 0) or 0)
    factors = rule.get('factors') or []
    total = float(base)
    for f in factors:
        total *= _eval_factor(f, params)
    cost = int(round(total))
    min_c = int(rule.get('min_cost', 0) or 0)
    max_c = rule.get('max_cost')
    if cost < min_c:
        cost = min_c
    if max_c is not None and cost > int(max_c):
        cost = int(max_c)
    return cost


# ============================================
# Public API
# ============================================

async def estimate(
    feature_key: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    owner_type: str = 'user',
    owner_id: Optional[str] = None,
) -> Dict[str, Any]:
    """估算积分；若提供 owner_id，则同时返回 balance/enough。"""
    rule = await CreditRuleDAO.get_by_feature(feature_key)
    if not rule:
        return {
            'feature_key': feature_key,
            'enabled': False,
            'estimated_cost': 0,
            'rule_version': None,
            'balance': None,
            'enough': True,
            'message': '该功能未配置积分规则，按免费处理',
        }
    cost = compute_cost(rule, params or {})

    balance: Optional[int] = None
    enough = True
    if owner_id:
        account = await CreditAccountDAO.get_or_create(owner_type, owner_id)
        balance = int(account.get('available_credits') or 0)
        enough = balance >= cost
    return {
        'feature_key': feature_key,
        'enabled': True,
        'estimated_cost': cost,
        'rule_id': rule.get('rule_id'),
        'rule_version': rule.get('rule_version'),
        'base_cost': rule.get('base_cost'),
        'billing_unit': rule.get('billing_unit'),
        'min_cost': rule.get('min_cost'),
        'max_cost': rule.get('max_cost'),
        'balance': balance,
        'enough': enough,
    }


async def freeze(
    owner_type: str,
    owner_id: str,
    *,
    feature_key: str,
    amount: int,
    task_id: Optional[str] = None,
    rule_version: Optional[str] = None,
    project_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """冻结积分；返回 {freeze_id, account_id, balance_after}."""
    if amount <= 0:
        raise CreditServiceError("冻结金额必须 > 0")

    db = get_db_manager()
    async with db.acquire() as conn:
        async with conn.transaction():
            account_row = await conn.fetchrow(
                """
                SELECT * FROM credit_accounts
                WHERE owner_type = $1 AND owner_id = $2
                FOR UPDATE
                """,
                owner_type, owner_id,
            )
            if not account_row:
                # 在事务内 create_or_get；用 INSERT ON CONFLICT
                acct = await CreditAccountDAO.get_or_create(owner_type, owner_id)
                account_row = await conn.fetchrow(
                    "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                    acct['account_id'],
                )

            available = int(account_row['available_credits'] or 0)
            if available < amount:
                raise InsufficientCreditsError(
                    f"积分不足: 需要 {amount}, 可用 {available}"
                )

            balance_before = available
            balance_after = available - amount

            await conn.execute(
                """
                UPDATE credit_accounts
                SET available_credits = available_credits - $2,
                    frozen_credits    = frozen_credits + $2,
                    updated_at        = CURRENT_TIMESTAMP
                WHERE account_id = $1
                """,
                account_row['account_id'], amount,
            )

    # 冻结记录 + 流水（事务外即可，因为余额已落盘）
    freeze_row = await CreditFreezeDAO.create(
        account_row['account_id'],
        amount,
        task_id=task_id,
        feature_key=feature_key,
        rule_version=rule_version,
    )
    await CreditTransactionDAO.create(
        account_row['account_id'],
        change_type='freeze',
        amount=amount,
        balance_before=balance_before,
        balance_after=balance_after,
        user_id=owner_id if owner_type == 'user' else None,
        team_id=owner_id if owner_type == 'team' else None,
        project_id=project_id,
        task_id=task_id,
        feature_key=feature_key,
        rule_version=rule_version,
        metadata=metadata or {},
    )

    logger.info(
        "credit.freeze: owner=%s/%s amount=%d task=%s balance %d->%d",
        owner_type, owner_id, amount, task_id, balance_before, balance_after,
    )
    return {
        'freeze_id': freeze_row['freeze_id'],
        'account_id': account_row['account_id'],
        'balance_after': balance_after,
        'frozen_after': int(account_row['frozen_credits'] or 0) + amount,
    }


async def confirm(
    task_id: str,
    final_amount: int,
    *,
    operator: Optional[str] = None,
    project_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """结算：把冻结的 amount 中 final_amount 部分扣除（consume），其余退回（release）。"""
    if final_amount < 0:
        raise CreditServiceError("final_amount 不能为负数")

    freeze_row = await CreditFreezeDAO.get_active_for_task(task_id)
    if not freeze_row:
        raise CreditServiceError(f"未找到 task_id={task_id} 的有效冻结记录")

    account_id = freeze_row['account_id']
    frozen_amount = int(freeze_row['amount'] or 0)
    if final_amount > frozen_amount:
        # 业务上严禁多扣；若 cost 超出，调用方应先 freeze 差额或抛错
        raise CreditServiceError(
            f"实际花费 {final_amount} 超过冻结金额 {frozen_amount}"
        )
    refund = frozen_amount - final_amount

    db = get_db_manager()
    async with db.acquire() as conn:
        async with conn.transaction():
            account_row = await conn.fetchrow(
                "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                account_id,
            )
            balance_before = int(account_row['available_credits'] or 0)
            # 退回 refund 到 available，frozen -= frozen_amount, total_used += final_amount
            await conn.execute(
                """
                UPDATE credit_accounts
                SET available_credits = available_credits + $2,
                    frozen_credits    = frozen_credits - $3,
                    total_used_credits = total_used_credits + $4,
                    updated_at        = CURRENT_TIMESTAMP
                WHERE account_id = $1
                """,
                account_id, refund, frozen_amount, final_amount,
            )
            balance_after = balance_before + refund

    await CreditFreezeDAO.mark_status(freeze_row['freeze_id'], 'settled')

    if refund > 0:
        await CreditTransactionDAO.create(
            account_id, change_type='release', amount=refund,
            balance_before=balance_before, balance_after=balance_after,
            user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
            project_id=project_id,
            task_id=task_id,
            feature_key=freeze_row.get('feature_key'),
            rule_version=freeze_row.get('rule_version'),
            metadata=metadata or {},
            operated_by=operator,
        )

    if final_amount > 0:
        # consume 用相同的 balance_before/after（因为我们在事务里一起更新了）
        await CreditTransactionDAO.create(
            account_id, change_type='consume', amount=final_amount,
            balance_before=balance_after, balance_after=balance_after,
            user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
            project_id=project_id,
            task_id=task_id,
            feature_key=freeze_row.get('feature_key'),
            rule_version=freeze_row.get('rule_version'),
            metadata=metadata or {},
            operated_by=operator,
        )

    logger.info(
        "credit.confirm: task=%s frozen=%d final=%d refund=%d account=%s",
        task_id, frozen_amount, final_amount, refund, account_id,
    )
    return {
        'task_id': task_id,
        'account_id': account_id,
        'frozen_amount': frozen_amount,
        'final_amount': final_amount,
        'refund': refund,
        'balance_after': balance_after,
    }


async def release(
    task_id: str,
    *,
    operator: Optional[str] = None,
    reason: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """全额退还：用于任务失败或取消。幂等：未找到冻结时返回 None。"""
    freeze_row = await CreditFreezeDAO.get_active_for_task(task_id)
    if not freeze_row:
        logger.info("credit.release: task_id=%s 无激活冻结，跳过", task_id)
        return None

    account_id = freeze_row['account_id']
    amount = int(freeze_row['amount'] or 0)

    db = get_db_manager()
    async with db.acquire() as conn:
        async with conn.transaction():
            account_row = await conn.fetchrow(
                "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                account_id,
            )
            balance_before = int(account_row['available_credits'] or 0)
            await conn.execute(
                """
                UPDATE credit_accounts
                SET available_credits = available_credits + $2,
                    frozen_credits    = frozen_credits - $2,
                    updated_at        = CURRENT_TIMESTAMP
                WHERE account_id = $1
                """,
                account_id, amount,
            )
            balance_after = balance_before + amount

    await CreditFreezeDAO.mark_status(freeze_row['freeze_id'], 'released')

    await CreditTransactionDAO.create(
        account_id, change_type='release', amount=amount,
        balance_before=balance_before, balance_after=balance_after,
        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
        project_id=project_id,
        task_id=task_id,
        feature_key=freeze_row.get('feature_key'),
        rule_version=freeze_row.get('rule_version'),
        metadata={'reason': reason} if reason else {},
        operated_by=operator,
    )

    logger.info(
        "credit.release: task=%s amount=%d account=%s balance %d->%d",
        task_id, amount, account_id, balance_before, balance_after,
    )
    return {
        'task_id': task_id,
        'account_id': account_id,
        'amount': amount,
        'balance_after': balance_after,
    }


async def admin_adjust(
    account_id: str,
    *,
    amount: int,
    reason: str,
    operator: str,
    feature_key: Optional[str] = None,
) -> Dict[str, Any]:
    """管理员手动调整：amount 正数 = 充值/赠送，负数 = 扣减。"""
    if amount == 0:
        raise CreditServiceError("amount 不能为 0")

    db = get_db_manager()
    async with db.acquire() as conn:
        async with conn.transaction():
            account_row = await conn.fetchrow(
                "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                account_id,
            )
            if not account_row:
                raise CreditServiceError(f"账户不存在: {account_id}")
            balance_before = int(account_row['available_credits'] or 0)
            balance_after = balance_before + amount
            if balance_after < 0:
                raise CreditServiceError(
                    f"扣减后余额会变负 (before={balance_before}, delta={amount})"
                )
            await conn.execute(
                """
                UPDATE credit_accounts
                SET available_credits = available_credits + $2,
                    updated_at        = CURRENT_TIMESTAMP
                WHERE account_id = $1
                """,
                account_id, amount,
            )

    change_type = 'admin_credit' if amount > 0 else 'admin_debit'
    await CreditTransactionDAO.create(
        account_id, change_type=change_type, amount=abs(amount),
        balance_before=balance_before, balance_after=balance_after,
        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
        feature_key=feature_key,
        metadata={'reason': reason},
        operated_by=operator,
        operation_reason=reason,
    )
    logger.info(
        "credit.admin_adjust: account=%s by=%s amount=%d reason=%s",
        account_id, operator, amount, reason,
    )
    return {
        'account_id': account_id,
        'amount': amount,
        'balance_before': balance_before,
        'balance_after': balance_after,
    }
