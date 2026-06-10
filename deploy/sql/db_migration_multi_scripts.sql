-- ============================================
-- MY2 多文件剧本迁移脚本
-- 修改: episode_scripts 表支持每个分集多个文件
-- ============================================

-- 1. 去掉 episode_id 的 UNIQUE 约束（允许一个分集多条记录）
ALTER TABLE episode_scripts DROP CONSTRAINT IF EXISTS episode_scripts_episode_id_key;

-- 2. 新增字段
ALTER TABLE episode_scripts ADD COLUMN IF NOT EXISTS file_name VARCHAR(255) DEFAULT '未命名文件';
ALTER TABLE episode_scripts ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- 3. 为已有数据补充 file_name
UPDATE episode_scripts SET file_name = '分集剧本' WHERE file_name = '未命名文件' OR file_name IS NULL;

-- 4. 创建新索引（episode_id 非唯一索引已存在，确保有排序索引）
CREATE INDEX IF NOT EXISTS idx_episode_scripts_episode_sort ON episode_scripts(episode_id, sort_order);
