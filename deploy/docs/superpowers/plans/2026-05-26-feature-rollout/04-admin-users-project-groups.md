# Slice 4 — Admin: users + project_groups (stage-1, no teams table)

Goal: 管理员可在后台管理账号（启用/禁用/重置密码/改角色和权限）和项目分组（创建/编辑/移动项目）。

User-visible result (admin only):
- Admin → "账号" tab: 列表 / 搜索 / 禁用 / 重置密码 / 改权限
- Admin → "项目分组" tab: CRUD + 把项目挪到指定分组
- 普通用户表面无感（仅看到被禁用后无法登录）

## Existing system relationships

- Frontend pages/routes/components: `new_html/components/AdminPage.tsx`.
- Backend endpoints: `admin_routes.py` (prefix `/api/admin`).
- Backend services/DAOs: `dao_user.py` extended; new `dao_project_group.py`.
- Database tables: ALTER `users`, new `project_groups`, ALTER `projects`.
- Auth: existing admin auth dep in `admin_routes.py`.

## Reuse / extend / new decisions

- **Reuse**: admin shell, admin auth, existing dao_user reading helpers.
- **Extend**: `users` table (ALTER); `projects` table (ALTER); `AdminPage.tsx` (new tabs); `dao_user.py` (set_role, set_status).
- **New**: `project_groups` table, `dao_project_group.py`, related admin endpoints, frontend admin tabs.
- **Defer**: `teams` / `team_members` (Stage-2).

## Database changes

- New migration `db_migration_admin_users_groups.sql` (+ deploy mirror):
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(30) DEFAULT 'user'`
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active'`
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason TEXT`
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP`
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_by VARCHAR(50)`
  - `CREATE TABLE IF NOT EXISTS project_groups (...)` — `team_id` column nullable (for Stage-2), `user_id` mandatory in Stage-1
  - `ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_id VARCHAR(50) REFERENCES project_groups(group_id) ON DELETE SET NULL`
  - `ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility VARCHAR(30) DEFAULT 'private'`
- No `teams`/`team_id` on projects this round.

## Backend changes

- Extend `dao_user.py`:
  - `set_role(user_id, role)`, `set_status(user_id, status, disabled_reason=None, disabled_by=None)`, `update_permissions(user_id, perms)`, `reset_password(user_id, new_hash)`.
  - `list_users(filters)`, `get_user_by_id(user_id)`.
- New `dao_project_group.py`:
  - `ProjectGroupDAO.create/list/get/update/delete/move_project_into`
- Endpoints inside `admin_routes.py`:
  - `GET /users` (filters: `keyword, role, status, limit, offset`)
  - `POST /users` (create new user; same logic as register but admin-only)
  - `GET /users/{user_id}`
  - `PUT /users/{user_id}` (profile + role updates)
  - `POST /users/{user_id}/disable {reason?}`
  - `POST /users/{user_id}/enable`
  - `POST /users/{user_id}/reset-password {new_password}`
  - `PUT /users/{user_id}/permissions {permissions}`
  - `GET /project-groups`, `POST /project-groups`, `PUT /project-groups/{group_id}`, `DELETE /project-groups/{group_id}`
  - `POST /projects/{project_id}/move {group_id}`
- All endpoints log no audit yet (Slice 5 adds that).
- Login flow (`api_routes.py`): if `status != 'active'`, reject with 403 `Account disabled: <reason>`.

## Frontend changes

- `new_html/components/AdminPage.tsx`:
  - Add two new tabs "账号" and "项目分组" alongside existing tabs.
  - "账号" tab: table + search + actions (disable / enable / reset password / edit permissions modal).
  - "项目分组" tab: list + create + edit + delete + "把项目移入此分组" picker.

## Admin changes

Listed above.

## Permission rules

- Admin endpoints: require existing admin auth dep (`users.role IN ('super_admin','admin')`).
- Reset password requires admin's password verification? — Out of scope; just gate on admin role.
- Cannot demote/disable yourself.

## Credit/quota rules

- N/A.

## Execution steps

1. Write migration + deploy mirror.
2. Extend `dao_user.py`.
3. New `dao_project_group.py` (+ deploy mirror).
4. Add endpoints to `admin_routes.py`.
5. Modify login (`api_routes.py`) to reject `status != 'active'`.
6. Frontend tabs in `AdminPage.tsx`.
7. Mirror to deploy/.

## Verification

- Disable a test user → that user cannot login.
- Enable → can login.
- Create a project group → move 2 projects in → list shows them under that group.
- Edit user permissions → reflects on `users.permissions` JSON.

## Risks

- Login change might break existing tokens. Mitigate by only blocking new logins, not invalidating existing tokens.
- Field `status` default `'active'` — existing rows backfill automatically because of DEFAULT.
- Don't break existing `is_active` column logic if any.

## Out of scope

- `teams` / `team_members` / team_id on projects (Stage-2)
- SSO / oauth
- Audit logging (Slice 5)
- Manual credit adjust (Slice 5)
