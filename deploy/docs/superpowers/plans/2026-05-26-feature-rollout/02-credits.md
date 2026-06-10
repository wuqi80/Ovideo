# Slice 2 — Credits core

Goal: 给每个 user 一个积分账户；新增 estimate / freeze / confirm / release 服务；后台可配置功能价格规则；前端可见余额和流水。

User-visible result:
- 新增 `/credits` 页面：余额卡片 + 流水表格 + 筛选
- 任何"高成本"操作（视频反推、生成等）可先调 estimate 拿到预计积分
- 后台管理员可在 admin 增改 `credit_rules`

## Existing system relationships

- Frontend pages/routes: new only.
- Frontend services: `new_html/services/apiService.ts` for fetch base, but credits has its own client.
- Backend endpoints: routes register on `api_router`; admin endpoints register on `admin_routes.router`.
- Backend services/DAOs: new only; touches `users` for join.
- Database tables: existing `users`. New: `credit_accounts`, `credit_rules`, `credit_freezes`, `credit_transactions`.
- Auth: existing `jwt_auth.get_current_user`.
- Admin pages: `new_html/components/AdminPage.tsx` — add a "积分规则" tab.

## Reuse / extend / new decisions

- **Reuse**: jwt auth, admin auth dep, api_router/admin_routes infrastructure.
- **New**: all four tables, `dao_credit.py`, `credit_service.py`, `credits_routes.py`,
  admin credit-rules endpoints inside `admin_routes.py`, `CreditsPage.tsx`, `creditService.ts`,
  `CreditEstimateModal.tsx`.
- **Defer**: team account, admin manual adjust UI (Slice 5), per-plan multipliers,
  recharge / order integration.

## Database changes

- New migration `db_migration_credits.sql` (+ deploy mirror).
- Tables (schemas per `MY2新功能数据库与接口接入方案.md §2.3`):
  - `credit_accounts (account_id, owner_type, owner_id, available_credits, frozen_credits, total_used_credits, unique(owner_type, owner_id))`
  - `credit_rules (rule_id, feature_key, feature_name, enabled, base_cost, billing_unit, factors JSONB, min_cost, max_cost, rule_version)`
  - `credit_freezes (freeze_id, account_id, task_id, amount, status, released_at)`
  - `credit_transactions (transaction_id, account_id, user_id, team_id, project_id, task_id, feature_key, change_type, amount, balance_before, balance_after, rule_version, metadata)`
- Seed default rules with rule_version `2026-05-26-001`:
  - `image_generation` base 10
  - `video_reverse_prompt` base 20, factors on duration_seconds
  - `audio_generation_tts` base 2
  - `prompt_optimize` base 2
  - `video_generation` base 50

## Backend changes

- `dao_credit.py`:
  - `CreditAccountDAO.get_or_create(owner_type, owner_id) -> dict`
  - `CreditAccountDAO.update_balances(account_id, available_delta, frozen_delta, used_delta)` (SQL `... FOR UPDATE`).
  - `CreditRuleDAO.list/get/create/update/delete`
  - `CreditFreezeDAO.create/get/release`
  - `CreditTransactionDAO.create/list`
- `credit_service.py`:
  - `estimate(feature_key, params, owner_type='user', owner_id=None) -> {estimated_cost, balance, enough, rule_version}` — pulls active rule, evaluates factors (range/multiplier), enforces min/max.
  - `freeze(owner_type, owner_id, amount, task_id, feature_key, rule_version) -> freeze_id` — atomic; raises `InsufficientCreditsError` if balance < amount.
  - `confirm(task_id, final_amount, operator=None) -> dict` — finds freeze by task_id, settles: deduct `final_amount` from available, release `amount-final_amount`, write transaction with `change_type='consume'`.
  - `release(task_id, operator=None, reason=None)` — full refund, writes `change_type='release'`.
  - `write_credit_transaction(...)` — low-level helper.
- `credits_routes.py` (`api_router`):
  - `GET /api/credits/balance` → `{available, frozen, total_used}`
  - `POST /api/credits/estimate` → calls `credit_service.estimate`
  - `GET /api/credits/transactions` paginated, filters: `feature_key, change_type, from, to`
- Inside `admin_routes.py` (prefix `/api/admin`):
  - `GET /credit-rules`, `POST /credit-rules`, `PUT /credit-rules/{rule_id}`, `DELETE /credit-rules/{rule_id}`

## Frontend changes

- `new_html/services/creditService.ts` — `getBalance`, `estimate`, `listTransactions`, admin endpoints not here.
- `new_html/pages/CreditsPage.tsx` — balance card, transactions table with filters.
- `new_html/components/CreditEstimateModal.tsx` — reusable modal for confirm-before-action; reused by Slice 3.
- Route: register `/credits` in `WorkspaceApp.tsx`.
- Admin: extend `AdminPage.tsx` with a "积分规则" tab listing/editing `credit_rules` (CRUD).

## Admin changes

- Listed above. Only credit-rules CRUD this slice. Account adjust + transactions list = Slice 5.

## Permission rules

- User-facing endpoints: require `jwt_auth.get_current_user`. `owner_type='user'`, `owner_id=current_user.user_id`.
- Admin endpoints: require existing admin auth dependency (re-use whatever `admin_routes.py` uses).

## Credit/quota rules

- `feature_key`s introduced: `image_generation`, `video_reverse_prompt`,
  `audio_generation_tts`, `prompt_optimize`, `video_generation`.
- Estimate spec: `final = clamp(base_cost * product(factor_multipliers), min_cost, max_cost or +∞)`.
- Factor format (range example):
  ```json
  {"key":"duration_seconds","type":"range","rules":[{"min":5,"max":15,"multiplier":1},{"min":16,"max":30,"multiplier":1.5}]}
  ```

## Execution steps

1. Write `db_migration_credits.sql` + deploy mirror.
2. Add INSERT seeds for default rules.
3. Apply migration; verify tables.
4. Implement `dao_credit.py`.
5. Implement `credit_service.py`.
6. Implement `credits_routes.py`; mount it.
7. Add admin credit-rules endpoints inside `admin_routes.py`.
8. Implement frontend service + page + modal + admin tab.
9. Mirror to deploy/.

## Verification

- Database: rows in `credit_rules` for the seeded features.
- API: `POST /api/credits/estimate {feature_key:'video_reverse_prompt',params:{duration_seconds:20}}` returns expected cost.
- Service: manually freeze 30 credits with fake task_id; account `available -= 30`, `frozen += 30`. `confirm(task_id, 20)` → `available -= 20` final, `frozen -= 30`, transaction logged.
- Frontend: open `/credits`, see balance and transactions.
- Admin: edit a rule's base_cost, refresh, estimate reflects new cost.

## Risks

- Race conditions on simultaneous freezes — use `SELECT ... FOR UPDATE`.
- Factor evaluation must be deterministic for `rule_version` to mean anything; persist `rule_version` on every transaction and freeze.
- Auto-create account on first `get_balance` to avoid 404 for new users.

## Out of scope

- Team accounts, account adjust UI (Slice 5)
- Recharge / order / payment
- Free quota per plan
- Refunds beyond release-on-fail
