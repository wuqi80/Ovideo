-- ============================================
-- MY2 script_id 数据隔离迁移脚本
-- 为 storyboard_items 和 assets 添加 script_id 列
-- 支持按文件（script_id）隔离数据
-- ============================================

-- 1. storyboard_items 加 script_id
ALTER TABLE storyboard_items ADD COLUMN IF NOT EXISTS script_id VARCHAR(50);

-- 2. assets 加 script_id
ALTER TABLE assets ADD COLUMN IF NOT EXISTS script_id VARCHAR(50);

-- 3. 回填：将现有数据的 script_id 设为所属 episode 下第一个 script
UPDATE storyboard_items si
SET script_id = (
    SELECT script_id FROM episode_scripts es
    WHERE es.episode_id = si.episode_id
    ORDER BY sort_order, created_at LIMIT 1
)
WHERE si.script_id IS NULL;

UPDATE assets a
SET script_id = (
    SELECT script_id FROM episode_scripts es
    WHERE es.episode_id = a.episode_id
    ORDER BY sort_order, created_at LIMIT 1
)
WHERE a.script_id IS NULL AND a.episode_id IS NOT NULL;

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_storyboard_items_script ON storyboard_items(script_id);
CREATE INDEX IF NOT EXISTS idx_assets_script ON assets(script_id);
