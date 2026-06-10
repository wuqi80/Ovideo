-- ============================================
-- 数据库迁移：添加用户权限字段
-- 执行时间：2025-12-13
-- 用途：为用户表添加permissions字段，支持模型权限管理
-- ============================================

-- 1. 添加permissions字段（如果不存在）
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;

-- 2. 为所有现有用户设置默认权限
UPDATE users
SET permissions = '{
    "allowedModels": [
        "gemini-2.5-flash",
        "gemini-2.5-flash-image", 
        "wan2-i2v",
        "wan2-morph",
        "sora2-i2v",
        "veo-i2v",
        "minimax-i2v"
    ],
    "priority": "normal",
    "canExport": true
}'::jsonb
WHERE permissions IS NULL OR permissions = '{}'::jsonb;

-- 3. 创建索引以加速权限查询
CREATE INDEX IF NOT EXISTS idx_users_permissions ON users USING GIN (permissions);

-- 4. 验证迁移结果
SELECT 
    user_id, 
    username, 
    permissions 
FROM users 
LIMIT 5;

-- ============================================
-- 迁移完成
-- ============================================

