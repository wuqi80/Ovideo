-- 2026-06-15：项目软删除（删除可恢复），防止误删导致内容永久丢失。
-- 删除改为 UPDATE is_deleted=TRUE；列表过滤 is_deleted IS NOT TRUE；可 restore。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_projects_is_deleted ON projects(is_deleted);
