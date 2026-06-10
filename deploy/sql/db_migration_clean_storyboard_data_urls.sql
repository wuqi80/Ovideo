-- =====================================================================
-- 清理 storyboard_items 中残留的 data:/blob: 内联 URL（base64 内联图等）
-- =====================================================================
--
-- 背景：
--   2026-05-17 用户反馈视频页"导入分镜画面"全部被跳过。诊断发现
--   storyboard_items.generated_image_url 字段里残留了 'data:image/webp;base64,...'
--   这种内联 URL，导致：
--     1. 被前端写入端白名单拒绝（StoryboardGenPage.handleUpdateStoryboardItem
--        2026-05-17 起加了 isPersistentUrl 守卫）。
--     2. 浏览器拼到 origin 后产生 414 Request-URI Too Large（GET 请求超长）。
--     3. 视频页 loadSession() 拒收，工作区显示为空。
--   写入端守卫已堵住新数据流入，本脚本清理已存的脏数据。
--
-- 策略：
--   将 LIKE 'data:%' 或 LIKE 'blob:%' 的 generated_image_url 置 NULL。
--   置 NULL 后前端会回退到从 entity_files 表查询持久化的 generated_image
--   文件（如果用户重新生成过），UI 不会因此丢失图片。
--
-- 影响表：storyboard_items
-- 影响列：generated_image_url
-- 类型：幂等（多次执行无副作用）
-- 反向迁移：不可逆（脏数据不值得回滚）
-- =====================================================================

BEGIN;

-- 0. 先快照一下要清理的行数，留 audit 痕迹
DO $$
DECLARE
    v_data_count INT;
    v_blob_count INT;
BEGIN
    SELECT COUNT(*) INTO v_data_count
    FROM storyboard_items
    WHERE generated_image_url LIKE 'data:%';

    SELECT COUNT(*) INTO v_blob_count
    FROM storyboard_items
    WHERE generated_image_url LIKE 'blob:%';

    RAISE NOTICE '[clean_storyboard_data_urls] data: URL 行数 = %, blob: URL 行数 = %',
                 v_data_count, v_blob_count;
END $$;

-- 1. data:image/...base64,... 等内联 URL → NULL
UPDATE storyboard_items
SET generated_image_url = NULL,
    updated_at = NOW()
WHERE generated_image_url LIKE 'data:%';

-- 2. blob:... 临时 sandbox URL（refresh 即失效）→ NULL
UPDATE storyboard_items
SET generated_image_url = NULL,
    updated_at = NOW()
WHERE generated_image_url LIKE 'blob:%';

-- 3. 验证：清理后不应再有任何匹配
DO $$
DECLARE
    v_remaining INT;
BEGIN
    SELECT COUNT(*) INTO v_remaining
    FROM storyboard_items
    WHERE generated_image_url LIKE 'data:%'
       OR generated_image_url LIKE 'blob:%';

    IF v_remaining > 0 THEN
        RAISE EXCEPTION '[clean_storyboard_data_urls] 清理后仍有 % 行残留，事务回滚', v_remaining;
    END IF;

    RAISE NOTICE '[clean_storyboard_data_urls] ✅ 清理完成，残留 = 0';
END $$;

COMMIT;
