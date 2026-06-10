# Slice 5 — Admin: media + credit + audit_logs

Goal: 管理员可全站搜索素材、查看/调整积分账户、查看/导出流水、查看每个管理操作的审计日志。

User-visible result (admin only):
- Admin → "素材" tab: 全站素材列表 + 筛选 + 编辑权限 + 删除并写理由
- Admin → "积分账户" tab: 列表 + 手动充值/扣减（写流水 + 审计）
- Admin → "积分流水" tab: 全站流水
- Admin → "审计日志" tab: 所有管理操作记录

## Existing system relationships

- Frontend: `new_html/components/AdminPage.tsx`.
- Backend: `admin_routes.py`.
- DAOs: `dao_media_library.py` (Slice 1), `dao_credit.py` (Slice 2).
- Tables: existing `media_library_items`, `credit_accounts`, `credit_transactions`. New: `admin_audit_logs`. ALTER existing for admin-only fields.

## Reuse / extend / new decisions

- **Reuse**: Slice 1 + Slice 2 DAOs and services.
- **Extend**: `credit_accounts`, `credit_transactions`, `media_library_items` (ALTER for admin fields). `credit_service.confirm/release` already takes an `operator` arg → admin uses it.
- **New**: `admin_audit_logs` table, `dao_admin_audit.py`, `admin_audit_service.py`, admin endpoints for media / credit / audit, frontend admin tabs.

## Database changes

- New migration `db_migration_admin_extra.sql` (+ deploy mirror):
  - `CREATE TABLE IF NOT EXISTS admin_audit_logs (...)`
  - `ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active'`
  - `ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS credit_limit INTEGER DEFAULT 0`
  - `ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS operated_by VARCHAR(50)`
  - `ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS operation_reason TEXT`
  - `ALTER TABLE media_library_items ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(50)`
  - `ALTER TABLE media_library_items ADD COLUMN IF NOT EXISTS deleted_reason TEXT`

## Backend changes

- `dao_admin_audit.py`:
  - `AdminAuditLogDAO.create(audit_id, admin_user_id, action, target_type, target_id, before, after, ip, ua)`
  - `AdminAuditLogDAO.list(filters)`
- `admin_audit_service.py`:
  - `record(request, admin_user_id, action, target_type, target_id, before=None, after=None)` — wraps DAO with extraction of `request.client.host` / `headers['user-agent']`.
- Endpoints in `admin_routes.py`:
  - `GET /media-library/items` (admin sees all)
  - `PUT /media-library/items/{library_item_id}` (admin can change permission_scope and metadata)
  - `DELETE /media-library/items/{library_item_id} {reason}` (writes `deleted_by`, `deleted_reason`, audit)
  - `GET /credit-accounts` (paginated)
  - `POST /credit-accounts/{account_id}/adjust {amount, reason}` — writes:
    - one credit_transactions row with `change_type='admin_adjust'`, `operated_by`, `operation_reason`
    - audit log
    - updates account
  - `GET /credit-transactions` (admin global)
  - `GET /audit-logs` (paginated filters: `admin_user_id, action, target_type, from, to`)
- Wire audit calls into Slice 4's admin user mutations:
  - disable/enable/reset-password/update permissions → `admin_audit_service.record(...)`
  - create/update/delete project_group + move_project → audit
- Credit-rule changes (Slice 2 admin endpoints) → audit.

## Frontend changes

- Extend `AdminPage.tsx`:
  - "素材" tab: table + filter (user_id, project_id, item_type, source, scope) + actions (edit scope, delete with reason)
  - "积分账户" tab: table + adjust modal (amount + reason)
  - "积分流水" tab: read-only table with filters + export CSV (out-of-scope: actual export, just stub)
  - "审计日志" tab: read-only table + filters

## Permission rules

- All admin endpoints require admin auth (existing dep).
- `admin_audit_logs` is append-only; no UI for delete.

## Credit/quota rules

- Admin `adjust` accepts positive (credit) or negative (debit) amounts. Writes transaction with `change_type IN ('admin_credit','admin_debit')`.

## Execution steps

1. Write migration + deploy mirror.
2. Implement DAO + service.
3. Add admin endpoints.
4. Wire audit into Slice 4 endpoints + Slice 2 admin credit-rules endpoints.
5. Frontend tabs.
6. Mirror to deploy/.

## Verification

- Adjust a user's balance from admin → balance updates, transaction with `change_type='admin_credit'`, audit_log row written with `action='credit_adjust'`.
- Delete a media item with reason → soft-deleted + reason + audit row.
- Modify a credit rule from Slice 2 admin UI → audit row appears in "审计日志" tab.

## Risks

- Audit table grows unbounded → ship a TODO to age out >90 days later.
- `change_type` enum must be consistent between Slice 2 and Slice 5; centralize in a constants module.

## Out of scope

- Bulk admin operations
- CSV export (link only)
- Email notification on disable
