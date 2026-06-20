# -*- coding: utf-8 -*-
"""
Credit Service
==============
Application-level credit workflow:
    estimate(feature_key, params) -> cost preview
    freeze(owner_type, owner_id, feature_key, amount, task_id) -> reservation
    confirm(task_id, final_amount) -> settle reservation
    release(task_id) -> release reservation

Persistence and row-locking transactions live in dao.business.credit.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from dao_credit import (
    CreditAccountDAO,
    CreditAccountNotFound,
    CreditDAOError,
    CreditFreezeNotFound,
    CreditLedgerDAO,
    CreditRuleDAO,
    InsufficientCreditBalance,
)

logger = logging.getLogger(__name__)


class InsufficientCreditsError(Exception):
    pass


class CreditServiceError(Exception):
    pass


def _eval_factor(factor: Dict[str, Any], params: Dict[str, Any]) -> float:
    """Evaluate one billing factor and return its multiplier."""
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
        try:
            return float(factor.get('default_multiplier', 1))
        except (TypeError, ValueError):
            return 1.0

    if ftype == 'enum':
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


async def estimate(
    feature_key: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    owner_type: str = 'user',
    owner_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Estimate cost and, when an owner is provided, available balance."""
    rule = await CreditRuleDAO.get_by_feature(feature_key)
    if not rule:
        return {
            'feature_key': feature_key,
            'enabled': False,
            'estimated_cost': 0,
            'rule_version': None,
            'balance': None,
            'enough': True,
            'message': 'Credit rule is not configured; treating feature as free.',
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
    """Reserve credits and return {freeze_id, account_id, balance_after}."""
    if amount <= 0:
        raise CreditServiceError("freeze amount must be greater than 0")

    try:
        result = await CreditLedgerDAO.freeze_credits(
            owner_type,
            owner_id,
            feature_key=feature_key,
            amount=amount,
            task_id=task_id,
            rule_version=rule_version,
            project_id=project_id,
            metadata=metadata,
        )
    except InsufficientCreditBalance as e:
        raise InsufficientCreditsError(str(e)) from e

    logger.info(
        "credit.freeze: owner=%s/%s amount=%d task=%s balance %d->%d",
        owner_type,
        owner_id,
        amount,
        task_id,
        result['balance_before'],
        result['balance_after'],
    )
    return {
        'freeze_id': result['freeze_id'],
        'account_id': result['account_id'],
        'balance_after': result['balance_after'],
        'frozen_after': result['frozen_after'],
    }


async def confirm(
    task_id: str,
    final_amount: int,
    *,
    operator: Optional[str] = None,
    project_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Settle a reservation, consuming final_amount and releasing the rest."""
    if final_amount < 0:
        raise CreditServiceError("final_amount cannot be negative")

    try:
        result = await CreditLedgerDAO.confirm_task_freeze(
            task_id,
            final_amount,
            operator=operator,
            project_id=project_id,
            metadata=metadata,
        )
    except CreditFreezeNotFound as e:
        raise CreditServiceError(f"No active credit freeze for task_id={task_id}") from e
    except CreditDAOError as e:
        raise CreditServiceError(str(e)) from e

    logger.info(
        "credit.confirm: task=%s frozen=%d final=%d refund=%d account=%s",
        task_id,
        result['frozen_amount'],
        result['final_amount'],
        result['refund'],
        result['account_id'],
    )
    return {
        'task_id': task_id,
        'account_id': result['account_id'],
        'frozen_amount': result['frozen_amount'],
        'final_amount': result['final_amount'],
        'refund': result['refund'],
        'balance_after': result['balance_after'],
    }


async def release(
    task_id: str,
    *,
    operator: Optional[str] = None,
    reason: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Release a reservation for failed/cancelled work. Idempotent when absent."""
    try:
        result = await CreditLedgerDAO.release_task_freeze(
            task_id,
            operator=operator,
            reason=reason,
            project_id=project_id,
        )
    except CreditDAOError as e:
        raise CreditServiceError(str(e)) from e

    if not result:
        logger.info("credit.release: task_id=%s has no active freeze; skipped", task_id)
        return None

    logger.info(
        "credit.release: task=%s amount=%d account=%s balance %d->%d",
        task_id,
        result['amount'],
        result['account_id'],
        result['balance_before'],
        result['balance_after'],
    )
    return {
        'task_id': task_id,
        'account_id': result['account_id'],
        'amount': result['amount'],
        'balance_after': result['balance_after'],
    }


async def admin_adjust(
    account_id: str,
    *,
    amount: int,
    reason: str,
    operator: str,
    feature_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Admin manual adjustment. Positive amount credits; negative amount debits."""
    if amount == 0:
        raise CreditServiceError("amount cannot be 0")

    try:
        result = await CreditLedgerDAO.admin_adjust_account(
            account_id,
            amount=amount,
            reason=reason,
            operator=operator,
            feature_key=feature_key,
        )
    except CreditAccountNotFound as e:
        raise CreditServiceError(f"account does not exist: {account_id}") from e
    except InsufficientCreditBalance as e:
        raise CreditServiceError(str(e)) from e
    except CreditDAOError as e:
        raise CreditServiceError(str(e)) from e

    logger.info(
        "credit.admin_adjust: account=%s by=%s amount=%d reason=%s",
        account_id,
        operator,
        amount,
        reason,
    )
    return {
        'account_id': account_id,
        'amount': amount,
        'balance_before': result['balance_before'],
        'balance_after': result['balance_after'],
    }
