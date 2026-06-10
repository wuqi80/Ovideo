# MY2 new features rollout — execution index

Status as of 2026-05-26. Mirror copy at `deploy/docs/superpowers/plans/2026-05-26-feature-rollout/`.

This directory contains executable per-slice implementation docs for the three new modules
(Media Library / Account+Team+Credits / Video Reverse Prompt) plus the Admin upgrade and
history migration. The slices are dependent and MUST be executed in order. Each module
doc is self-contained: read it before touching code, re-read existing call sites if needed,
then implement only that module before moving on.

## Module list & dependency order

| Slice | Status | Module doc | Depends on |
| ----- | ------ | ---------- | ---------- |
| 0     | done   | (this index + 6 module docs) | — |
| 1     | done   | [01-media-library.md](01-media-library.md) | 0 |
| 2     | done   | [02-credits.md](02-credits.md) | 0 |
| 3     | done   | [03-video-reverse.md](03-video-reverse.md) | 1, 2 |
| 4     | done   | [04-admin-users-project-groups.md](04-admin-users-project-groups.md) | 0 |
| 5     | done   | [05-admin-media-credit-audit.md](05-admin-media-credit-audit.md) | 1, 2, 4 |
| 6     | done   | [06-history-migration.md](06-history-migration.md) | 1 |

## Naming reservations (MUST NOT touch)

- Existing `assets` table = character / scene / prop. Don't repurpose.
- Existing `new_html/components/MaterialPage.tsx` + `MaterialLibrary` type = per-episode
  storyboard-binding UI sourced from `assets`. Don't repurpose.
- Existing `save_generated_file_to_db()` core in `file_service.py`. Don't change its
  signature or behavior; only add sync wrappers in business-layer call sites.

## Cross-cutting rules

- **deploy/ mirror**: every `*.py`, `new_html/**`, `*.sql` change has a sibling in
  `deploy/...` / `deploy/new_html/...` / `deploy/sql/...`. Use the same content;
  do not diverge.
- **Route prefixes**:
  - User API: `/api/...` (mounted via `app.include_router(api_router, prefix="")` in `cluster_main.py`)
  - Admin API: `/api/admin/...` (via `admin_routes.py:router = APIRouter(prefix="/api/admin")`)
- **Async tasks**: every long-running operation goes through
  `task_service.submit(task_type, task_data, user_id)`. Worker (`worker.py`) dispatches by
  `task.task_type`.
- **Permissions**: any list/get/mutation must enforce ownership or `project_members`
  membership for project-scoped resources. `role='readonly'` cannot mutate.
- **Credit gating**: any feature with a `credit_rules.feature_key` runs through
  `credit_service.estimate → freeze → confirm/release`. Never deduct credits in business
  code directly.

## Module-doc execution protocol

For each pending module:

1. Read `0X-*.md` end-to-end.
2. Re-confirm the existing-system anchors it references (grep the code, do not trust the
   doc alone — code is the truth).
3. Implement ONLY that module's `Execution steps`.
4. Run the module's `Verification` block.
5. Update status in this index.
6. Stop. Wait for human sign-off before starting the next module.
