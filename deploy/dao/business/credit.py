# -*- coding: utf-8 -*-
"""
Credit System DAO
==================
积分账户、规则、冻结、流水四张表的 CRUD。

详见 docs/superpowers/plans/2026-05-26-feature-rollout/02-credits.md
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

import asyncpg

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


class CreditDAOError(Exception):
    """Base error for credit persistence operations."""


class InsufficientCreditBalance(CreditDAOError):
    """Raised when a locked account cannot cover a debit/freeze."""


class CreditAccountNotFound(CreditDAOError):
    """Raised when an account-scoped credit operation cannot find the account."""


class CreditFreezeNotFound(CreditDAOError):
    """Raised when a task has no active credit freeze to settle/release."""


def _coerce_jsonb(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _normalize(row: Optional[Dict[str, Any]], json_fields: tuple = ('factors', 'metadata')) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    out = dict(row)
    for k in json_fields:
        if k in out:
            out[k] = _coerce_jsonb(out[k])
    return out


async def _get_or_create_account_for_update(conn, owner_type: str, owner_id: str) -> Dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT * FROM credit_accounts
        WHERE owner_type = $1 AND owner_id = $2
        FOR UPDATE
        """,
        owner_type,
        owner_id,
    )
    if not row:
        account_id = f"acct_{uuid.uuid4().hex[:16]}"
        await conn.fetchrow(
            """
            INSERT INTO credit_accounts (account_id, owner_type, owner_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (owner_type, owner_id) DO UPDATE
              SET updated_at = CURRENT_TIMESTAMP
            RETURNING account_id
            """,
            account_id,
            owner_type,
            owner_id,
        )
        row = await conn.fetchrow(
            """
            SELECT * FROM credit_accounts
            WHERE owner_type = $1 AND owner_id = $2
            FOR UPDATE
            """,
            owner_type,
            owner_id,
        )
    if not row:
        raise CreditAccountNotFound(f"credit account not found: {owner_type}/{owner_id}")
    return _normalize(row, json_fields=())


async def _insert_credit_transaction(
    conn,
    account_id: str,
    change_type: str,
    amount: int,
    balance_before: int,
    balance_after: int,
    *,
    user_id: Optional[str] = None,
    team_id: Optional[str] = None,
    project_id: Optional[str] = None,
    task_id: Optional[str] = None,
    feature_key: Optional[str] = None,
    rule_version: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    operated_by: Optional[str] = None,
    operation_reason: Optional[str] = None,
) -> Dict[str, Any]:
    txn_id = f"txn_{uuid.uuid4().hex[:16]}"
    try:
        # The managed schema includes operated_by/operation_reason. A nested
        # transaction gives older schemas a savepoint so the fallback does not
        # poison the outer ledger transaction.
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO credit_transactions (
                    transaction_id, account_id, user_id, team_id, project_id,
                    task_id, feature_key, change_type, amount,
                    balance_before, balance_after, rule_version, metadata,
                    operated_by, operation_reason
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
                RETURNING *
                """,
                txn_id,
                account_id,
                user_id,
                team_id,
                project_id,
                task_id,
                feature_key,
                change_type,
                amount,
                balance_before,
                balance_after,
                rule_version,
                json.dumps(metadata or {}),
                operated_by,
                operation_reason,
            )
    except asyncpg.UndefinedColumnError:
        meta = dict(metadata or {})
        if operated_by:
            meta['operated_by'] = operated_by
        if operation_reason:
            meta['operation_reason'] = operation_reason
        row = await conn.fetchrow(
            """
            INSERT INTO credit_transactions (
                transaction_id, account_id, user_id, team_id, project_id,
                task_id, feature_key, change_type, amount,
                balance_before, balance_after, rule_version, metadata
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
            RETURNING *
            """,
            txn_id,
            account_id,
            user_id,
            team_id,
            project_id,
            task_id,
            feature_key,
            change_type,
            amount,
            balance_before,
            balance_after,
            rule_version,
            json.dumps(meta),
        )
    return _normalize(row, json_fields=('metadata',))


# ============================================
# CreditAccountDAO
# ============================================
class CreditAccountDAO:

    @staticmethod
    async def get_or_create(owner_type: str, owner_id: str) -> Dict[str, Any]:
        """返回指定账户；不存在则自动创建（初始余额 0）。"""
        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT * FROM credit_accounts WHERE owner_type = $1 AND owner_id = $2",
            owner_type, owner_id,
        )
        if row:
            return _normalize(row, json_fields=())
        account_id = f"acct_{uuid.uuid4().hex[:16]}"
        row = await db.fetchrow(
            """
            INSERT INTO credit_accounts (account_id, owner_type, owner_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (owner_type, owner_id) DO UPDATE
              SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
            """,
            account_id, owner_type, owner_id,
        )
        return _normalize(row, json_fields=())

    @staticmethod
    async def get(account_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT * FROM credit_accounts WHERE account_id = $1", account_id,
        )
        return _normalize(row, json_fields=())

    @staticmethod
    async def adjust_balances(
        account_id: str,
        *,
        available_delta: int = 0,
        frozen_delta: int = 0,
        used_delta: int = 0,
    ) -> Dict[str, Any]:
        """原子更新余额。调用方应已在外层事务中持有该账户行的 FOR UPDATE 锁。"""
        db = get_db_manager()
        row = await db.fetchrow(
            """
            UPDATE credit_accounts
               SET available_credits = available_credits + $2,
                   frozen_credits    = frozen_credits    + $3,
                   total_used_credits = total_used_credits + $4
             WHERE account_id = $1
             RETURNING *
            """,
            account_id, available_delta, frozen_delta, used_delta,
        )
        return _normalize(row, json_fields=())

    @staticmethod
    async def list_all(
        *,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """2026-05-26 Slice 5: 管理员列出所有账户（带 owner 关联信息）。"""
        db = get_db_manager()
        where = ["TRUE"]
        params: List[Any] = []
        idx = 1
        if search:
            where.append(f"(ca.owner_id ILIKE ${idx} OR u.username ILIKE ${idx})")
            params.append(f"%{search}%"); idx += 1
        params.extend([limit, offset])
        try:
            rows = await db.fetch(
                f"""
                SELECT ca.*, u.username AS owner_username, u.email AS owner_email
                FROM credit_accounts ca
                LEFT JOIN users u ON u.user_id = ca.owner_id AND ca.owner_type = 'user'
                WHERE {' AND '.join(where)}
                ORDER BY ca.created_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params,
            )
            return [_normalize(r, json_fields=()) for r in rows]
        except Exception:
            # 兼容旧 schema（未 ALTER）
            rows = await db.fetch(
                """
                SELECT * FROM credit_accounts
                ORDER BY created_at DESC
                LIMIT $1 OFFSET $2
                """,
                limit, offset,
            )
            return [_normalize(r, json_fields=()) for r in rows]


# ============================================
# CreditLedgerDAO
# ============================================
class CreditLedgerDAO:
    """Transactional credit ledger operations across account/freeze/transaction tables."""

    @staticmethod
    async def freeze_credits(
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
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                account_row = await _get_or_create_account_for_update(conn, owner_type, owner_id)
                available = int(account_row['available_credits'] or 0)
                if available < amount:
                    raise InsufficientCreditBalance(
                        f"Insufficient credits: need {amount}, available {available}"
                    )

                balance_before = available
                balance_after = available - amount
                updated_account = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits - $2,
                        frozen_credits    = frozen_credits + $2,
                        updated_at        = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account_row['account_id'],
                    amount,
                )

                freeze_id = f"frz_{uuid.uuid4().hex[:16]}"
                freeze_row = await conn.fetchrow(
                    """
                    INSERT INTO credit_freezes (
                        freeze_id, account_id, task_id, feature_key, amount, rule_version, status
                    ) VALUES ($1,$2,$3,$4,$5,$6,'frozen')
                    RETURNING *
                    """,
                    freeze_id,
                    account_row['account_id'],
                    task_id,
                    feature_key,
                    amount,
                    rule_version,
                )
                transaction_row = await _insert_credit_transaction(
                    conn,
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

        updated_account = _normalize(updated_account, json_fields=())
        freeze = dict(freeze_row)
        return {
            'freeze': freeze,
            'transaction': transaction_row,
            'account': updated_account,
            'freeze_id': freeze['freeze_id'],
            'account_id': account_row['account_id'],
            'balance_before': balance_before,
            'balance_after': balance_after,
            'frozen_after': int(updated_account['frozen_credits'] or 0),
        }

    @staticmethod
    async def confirm_task_freeze(
        task_id: str,
        final_amount: int,
        *,
        operator: Optional[str] = None,
        project_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                freeze_row = await conn.fetchrow(
                    """
                    SELECT * FROM credit_freezes
                    WHERE task_id = $1 AND status = 'frozen'
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    task_id,
                )
                if not freeze_row:
                    raise CreditFreezeNotFound(f"No active credit freeze for task_id={task_id}")

                freeze = dict(freeze_row)
                account_id = freeze['account_id']
                frozen_amount = int(freeze['amount'] or 0)
                if final_amount > frozen_amount:
                    raise CreditDAOError(
                        f"Final credit amount {final_amount} exceeds frozen amount {frozen_amount}"
                    )
                refund = frozen_amount - final_amount

                account_row = await conn.fetchrow(
                    "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                    account_id,
                )
                if not account_row:
                    raise CreditAccountNotFound(f"credit account not found: {account_id}")
                balance_before = int(account_row['available_credits'] or 0)
                updated_account = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits + $2,
                        frozen_credits    = frozen_credits - $3,
                        total_used_credits = total_used_credits + $4,
                        updated_at        = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account_id,
                    refund,
                    frozen_amount,
                    final_amount,
                )
                balance_after = balance_before + refund

                await conn.execute(
                    """
                    UPDATE credit_freezes
                    SET status = 'settled', released_at = CURRENT_TIMESTAMP
                    WHERE freeze_id = $1
                    """,
                    freeze['freeze_id'],
                )

                release_txn = None
                consume_txn = None
                if refund > 0:
                    release_txn = await _insert_credit_transaction(
                        conn,
                        account_id,
                        change_type='release',
                        amount=refund,
                        balance_before=balance_before,
                        balance_after=balance_after,
                        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                        project_id=project_id,
                        task_id=task_id,
                        feature_key=freeze.get('feature_key'),
                        rule_version=freeze.get('rule_version'),
                        metadata=metadata or {},
                        operated_by=operator,
                    )

                if final_amount > 0:
                    consume_txn = await _insert_credit_transaction(
                        conn,
                        account_id,
                        change_type='consume',
                        amount=final_amount,
                        balance_before=balance_after,
                        balance_after=balance_after,
                        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                        project_id=project_id,
                        task_id=task_id,
                        feature_key=freeze.get('feature_key'),
                        rule_version=freeze.get('rule_version'),
                        metadata=metadata or {},
                        operated_by=operator,
                    )

        return {
            'task_id': task_id,
            'account_id': account_id,
            'account': _normalize(updated_account, json_fields=()),
            'freeze': freeze,
            'release_transaction': release_txn,
            'consume_transaction': consume_txn,
            'frozen_amount': frozen_amount,
            'final_amount': final_amount,
            'refund': refund,
            'balance_before': balance_before,
            'balance_after': balance_after,
        }

    @staticmethod
    async def release_task_freeze(
        task_id: str,
        *,
        operator: Optional[str] = None,
        reason: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                freeze_row = await conn.fetchrow(
                    """
                    SELECT * FROM credit_freezes
                    WHERE task_id = $1 AND status = 'frozen'
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    task_id,
                )
                if not freeze_row:
                    return None

                freeze = dict(freeze_row)
                account_id = freeze['account_id']
                amount = int(freeze['amount'] or 0)
                account_row = await conn.fetchrow(
                    "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                    account_id,
                )
                if not account_row:
                    raise CreditAccountNotFound(f"credit account not found: {account_id}")
                balance_before = int(account_row['available_credits'] or 0)
                updated_account = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits + $2,
                        frozen_credits    = frozen_credits - $2,
                        updated_at        = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account_id,
                    amount,
                )
                balance_after = balance_before + amount

                await conn.execute(
                    """
                    UPDATE credit_freezes
                    SET status = 'released', released_at = CURRENT_TIMESTAMP
                    WHERE freeze_id = $1
                    """,
                    freeze['freeze_id'],
                )

                transaction_row = await _insert_credit_transaction(
                    conn,
                    account_id,
                    change_type='release',
                    amount=amount,
                    balance_before=balance_before,
                    balance_after=balance_after,
                    user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                    project_id=project_id,
                    task_id=task_id,
                    feature_key=freeze.get('feature_key'),
                    rule_version=freeze.get('rule_version'),
                    metadata={'reason': reason} if reason else {},
                    operated_by=operator,
                )

        return {
            'task_id': task_id,
            'account_id': account_id,
            'account': _normalize(updated_account, json_fields=()),
            'freeze': freeze,
            'transaction': transaction_row,
            'amount': amount,
            'balance_before': balance_before,
            'balance_after': balance_after,
        }

    @staticmethod
    async def admin_adjust_account(
        account_id: str,
        *,
        amount: int,
        reason: str,
        operator: str,
        feature_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                account_row = await conn.fetchrow(
                    "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                    account_id,
                )
                if not account_row:
                    raise CreditAccountNotFound(f"credit account not found: {account_id}")

                balance_before = int(account_row['available_credits'] or 0)
                balance_after = balance_before + amount
                if balance_after < 0:
                    raise InsufficientCreditBalance(
                        f"Credit adjustment would make balance negative (before={balance_before}, delta={amount})"
                    )

                updated_account = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits + $2,
                        updated_at        = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account_id,
                    amount,
                )

                change_type = 'admin_credit' if amount > 0 else 'admin_debit'
                transaction_row = await _insert_credit_transaction(
                    conn,
                    account_id,
                    change_type=change_type,
                    amount=abs(amount),
                    balance_before=balance_before,
                    balance_after=balance_after,
                    user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                    feature_key=feature_key,
                    metadata={'reason': reason},
                    operated_by=operator,
                    operation_reason=reason,
                )

        return {
            'account_id': account_id,
            'account': _normalize(updated_account, json_fields=()),
            'transaction': transaction_row,
            'amount': amount,
            'balance_before': balance_before,
            'balance_after': balance_after,
        }


# ============================================
# CreditRuleDAO
# ============================================
class CreditRuleDAO:

    @staticmethod
    async def get_by_feature(feature_key: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT * FROM credit_rules
            WHERE feature_key = $1 AND enabled = TRUE
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            feature_key,
        )
        return _normalize(row)

    @staticmethod
    async def get(rule_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow("SELECT * FROM credit_rules WHERE rule_id = $1", rule_id)
        return _normalize(row)

    @staticmethod
    async def list_all(only_enabled: bool = False) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if only_enabled:
            rows = await db.fetch(
                "SELECT * FROM credit_rules WHERE enabled = TRUE ORDER BY feature_key",
            )
        else:
            rows = await db.fetch(
                "SELECT * FROM credit_rules ORDER BY feature_key",
            )
        return [_normalize(r) for r in rows]

    @staticmethod
    async def create(
        feature_key: str,
        feature_name: str,
        base_cost: int,
        *,
        rule_id: Optional[str] = None,
        billing_unit: str = 'task',
        factors: Optional[List[Dict[str, Any]]] = None,
        min_cost: int = 0,
        max_cost: Optional[int] = None,
        enabled: bool = True,
        rule_version: Optional[str] = None,
        description: str = '',
    ) -> Dict[str, Any]:
        db = get_db_manager()
        rid = rule_id or f"rule_{uuid.uuid4().hex[:16]}"
        ver = rule_version or '2026-05-26-001'
        row = await db.fetchrow(
            """
            INSERT INTO credit_rules (
                rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
                factors, min_cost, max_cost, rule_version, description
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
            RETURNING *
            """,
            rid, feature_key, feature_name, enabled, base_cost, billing_unit,
            json.dumps(factors or []), min_cost, max_cost, ver, description,
        )
        return _normalize(row)

    @staticmethod
    async def update(rule_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not fields:
            return await CreditRuleDAO.get(rule_id)
        allowed = {
            'feature_key', 'feature_name', 'enabled', 'base_cost', 'billing_unit',
            'factors', 'min_cost', 'max_cost', 'rule_version', 'description',
        }
        sets = []
        params: List[Any] = []
        idx = 1
        for k, v in fields.items():
            if k not in allowed:
                continue
            if k == 'factors':
                sets.append(f"{k} = ${idx}::jsonb")
                params.append(json.dumps(v or []))
            else:
                sets.append(f"{k} = ${idx}")
                params.append(v)
            idx += 1
        if not sets:
            return await CreditRuleDAO.get(rule_id)
        params.append(rule_id)
        db = get_db_manager()
        row = await db.fetchrow(
            f"UPDATE credit_rules SET {', '.join(sets)} WHERE rule_id = ${idx} RETURNING *",
            *params,
        )
        return _normalize(row)

    @staticmethod
    async def delete(rule_id: str) -> None:
        db = get_db_manager()
        await db.execute("DELETE FROM credit_rules WHERE rule_id = $1", rule_id)


# ============================================
# CreditFreezeDAO
# ============================================
class CreditFreezeDAO:

    @staticmethod
    async def create(
        account_id: str,
        amount: int,
        *,
        task_id: Optional[str] = None,
        feature_key: Optional[str] = None,
        rule_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        fid = f"frz_{uuid.uuid4().hex[:16]}"
        row = await db.fetchrow(
            """
            INSERT INTO credit_freezes (
                freeze_id, account_id, task_id, feature_key, amount, rule_version, status
            ) VALUES ($1,$2,$3,$4,$5,$6,'frozen')
            RETURNING *
            """,
            fid, account_id, task_id, feature_key, amount, rule_version,
        )
        return dict(row)

    @staticmethod
    async def get_active_for_task(task_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT * FROM credit_freezes
            WHERE task_id = $1 AND status = 'frozen'
            ORDER BY created_at DESC LIMIT 1
            """,
            task_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def mark_status(freeze_id: str, status: str) -> None:
        db = get_db_manager()
        await db.execute(
            """
            UPDATE credit_freezes
            SET status = $2, released_at = CURRENT_TIMESTAMP
            WHERE freeze_id = $1
            """,
            freeze_id, status,
        )


# ============================================
# CreditTransactionDAO
# ============================================
class CreditTransactionDAO:

    @staticmethod
    async def create(
        account_id: str,
        change_type: str,
        amount: int,
        balance_before: int,
        balance_after: int,
        *,
        user_id: Optional[str] = None,
        team_id: Optional[str] = None,
        project_id: Optional[str] = None,
        task_id: Optional[str] = None,
        feature_key: Optional[str] = None,
        rule_version: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        operated_by: Optional[str] = None,
        operation_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        txn_id = f"txn_{uuid.uuid4().hex[:16]}"
        # operated_by/operation_reason 是 Slice 5 才会 ALTER 出来的列；
        # 这里 try 用原生列，失败则降级到 metadata。
        try:
            row = await db.fetchrow(
                """
                INSERT INTO credit_transactions (
                    transaction_id, account_id, user_id, team_id, project_id,
                    task_id, feature_key, change_type, amount,
                    balance_before, balance_after, rule_version, metadata,
                    operated_by, operation_reason
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
                RETURNING *
                """,
                txn_id, account_id, user_id, team_id, project_id,
                task_id, feature_key, change_type, amount,
                balance_before, balance_after, rule_version, json.dumps(metadata or {}),
                operated_by, operation_reason,
            )
        except Exception:
            meta = dict(metadata or {})
            if operated_by:
                meta['operated_by'] = operated_by
            if operation_reason:
                meta['operation_reason'] = operation_reason
            row = await db.fetchrow(
                """
                INSERT INTO credit_transactions (
                    transaction_id, account_id, user_id, team_id, project_id,
                    task_id, feature_key, change_type, amount,
                    balance_before, balance_after, rule_version, metadata
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
                RETURNING *
                """,
                txn_id, account_id, user_id, team_id, project_id,
                task_id, feature_key, change_type, amount,
                balance_before, balance_after, rule_version, json.dumps(meta),
            )
        return _normalize(row, json_fields=('metadata',))

    @staticmethod
    async def list_for_user(
        user_id: str,
        *,
        feature_key: Optional[str] = None,
        change_type: Optional[str] = None,
        from_dt: Optional[str] = None,
        to_dt: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        where = ["user_id = $1"]
        params: List[Any] = [user_id]
        idx = 2
        if feature_key:
            where.append(f"feature_key = ${idx}"); params.append(feature_key); idx += 1
        if change_type:
            where.append(f"change_type = ${idx}"); params.append(change_type); idx += 1
        if from_dt:
            where.append(f"created_at >= ${idx}"); params.append(from_dt); idx += 1
        if to_dt:
            where.append(f"created_at <= ${idx}"); params.append(to_dt); idx += 1
        params.extend([limit, offset])
        db = get_db_manager()
        rows = await db.fetch(
            f"""
            SELECT * FROM credit_transactions
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *params,
        )
        return [_normalize(r, json_fields=('metadata',)) for r in rows]

    @staticmethod
    async def list_admin(
        *,
        user_id: Optional[str] = None,
        feature_key: Optional[str] = None,
        change_type: Optional[str] = None,
        tx_type: Optional[str] = None,            # alias for change_type
        operated_by: Optional[str] = None,
        business_type: Optional[str] = None,      # alias for feature_key
        from_dt: Optional[str] = None,
        to_dt: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        where = ["TRUE"]
        params: List[Any] = []
        idx = 1
        if user_id:
            where.append(f"user_id = ${idx}"); params.append(user_id); idx += 1
        if feature_key or business_type:
            where.append(f"feature_key = ${idx}")
            params.append(feature_key or business_type); idx += 1
        if change_type or tx_type:
            where.append(f"change_type = ${idx}")
            params.append(change_type or tx_type); idx += 1
        if operated_by:
            # operated_by 列由 Slice 5 ALTER 加入；旧库降级则跳过
            where.append(f"operated_by = ${idx}")
            params.append(operated_by); idx += 1
        if from_dt:
            where.append(f"created_at >= ${idx}"); params.append(from_dt); idx += 1
        if to_dt:
            where.append(f"created_at <= ${idx}"); params.append(to_dt); idx += 1
        params.extend([limit, offset])
        db = get_db_manager()
        try:
            rows = await db.fetch(
                f"""
                SELECT * FROM credit_transactions
                WHERE {' AND '.join(where)}
                ORDER BY created_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params,
            )
        except Exception:
            # 旧 schema 没有 operated_by 列时降级
            if operated_by:
                return []
            raise
        return [_normalize(r, json_fields=('metadata',)) for r in rows]
