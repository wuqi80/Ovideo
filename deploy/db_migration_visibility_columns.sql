-- ============================================
-- 2026-05-26 Organization Management MVP — Slice 1
-- 给现有资源表加 visibility / organization_id 列
-- 详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §4.2
-- ============================================

-- 1. media_library_items: 加 visibility（projects.visibility 在 db_migration_admin_users_groups.sql 已加）
ALTER TABLE media_library_items
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(30) DEFAULT 'private';

CREATE INDEX IF NOT EXISTS idx_media_visibility ON media_library_items(visibility);


-- 2. project_groups: 加 organization_id（团队/组织归属）
--    旧的 team_id 列（admin_users_groups slice 预留，从未启用）保留 backward-compat，
--    新逻辑全部走 organization_id。
ALTER TABLE project_groups
    ADD COLUMN IF NOT EXISTS organization_id VARCHAR(50)
        REFERENCES organizations(org_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_groups_org ON project_groups(organization_id);
