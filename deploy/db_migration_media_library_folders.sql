-- ============================================
-- 2026-05-30 素材库文件夹（可嵌套，项目级）
-- media_library_folders: 用户自定义文件夹（人物 / 场景 / 道具 等），支持父子嵌套
-- media_library_items.folder_id: 素材所属文件夹（可空 = 未归类）
-- 删除文件夹 -> 子文件夹级联删除；素材的 folder_id 置 NULL（不删素材）
-- ============================================

CREATE TABLE IF NOT EXISTS media_library_folders (
    id SERIAL PRIMARY KEY,
    folder_id VARCHAR(50) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    parent_folder_id VARCHAR(50) REFERENCES media_library_folders(folder_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    folder_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mlf_project ON media_library_folders(project_id);
CREATE INDEX IF NOT EXISTS idx_mlf_parent  ON media_library_folders(parent_folder_id);

CREATE OR REPLACE FUNCTION update_media_library_folders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_library_folders_updated_at ON media_library_folders;
CREATE TRIGGER trg_media_library_folders_updated_at
    BEFORE UPDATE ON media_library_folders
    FOR EACH ROW
    EXECUTE FUNCTION update_media_library_folders_updated_at();

-- 在 media_library_items 上加 folder_id（可空，删除文件夹时置 NULL）
ALTER TABLE media_library_items
    ADD COLUMN IF NOT EXISTS folder_id VARCHAR(50)
    REFERENCES media_library_folders(folder_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_library_folder ON media_library_items(folder_id);
