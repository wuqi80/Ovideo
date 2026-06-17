-- 项目软删除字段补迁移
-- commit 8fb3690「删除项目改为软删除可恢复」把 dao/content/content.py 改为用
-- projects.is_deleted / deleted_at（列表过滤 WHERE p.is_deleted IS NOT TRUE、
-- 软删 SET is_deleted=TRUE,deleted_at=...），但当时漏建对应迁移，导致 projects 表
-- 无这两列 → 项目列表/软删除查询报 UndefinedColumnError(column p.is_deleted does not exist) 500。
-- 本迁移补上。幂等（IF NOT EXISTS）。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_projects_is_deleted ON projects(is_deleted);
