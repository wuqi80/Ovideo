-- 2026-05-21: 分镜页 GPT Image 2 系列接入 — 占位 provider 行
--
-- ⚠️ 这个文件【不是必须执行的】。同样的逻辑已搬到 cluster_main.py 的
--    seed_default_api_providers() 函数，启动时自动幂等 seed。
--    保留 SQL 文件作为：
--      1) 容灾手段（Python seed 失败时可手工执行）
--      2) 在脱机数据库（不带应用启动）上 bootstrap 用
--      3) 文档化记录："这两个占位是哪来的"
--
-- 在 api_configurations 表中插入两条 enabled=FALSE 的占位行，
-- 让管理员后台直接看到 "需要填入 Key" 的卡片，填好 key + 切到 enabled=TRUE 即可生效。
--
-- 幂等：通过 WHERE NOT EXISTS 按 (provider, name) 二元组判重，
-- 重复执行不会插入重复行。
--
-- 路由设计：
--   laozhang-gpt-image  → laozhang【默认分组】Token
--                         同时驱动：gpt-image-2-vip（天劫一阶）+ Gemini 化神
--                         环境变量：GPT_IMAGE_API_KEY
--   laozhang-sora2      → laozhang【Sora2Official 分组】Token
--                         驱动：gpt-image-2 官方混合（天劫二阶）
--                         环境变量：SORA2_GPT_IMAGE_API_KEY

INSERT INTO api_configurations (
    config_id, name, provider, endpoint, api_key_encrypted,
    model_name, request_template, headers, proxy_mode, enabled
)
SELECT
    'apicfg_seed_gptimg_v',
    'laozhang GPT Image (天劫一阶 / 化神)',
    'laozhang-gpt-image',
    'https://api.laozhang.ai/v1',
    NULL,
    'gpt-image-2-vip',
    '{}'::jsonb,
    '{}'::jsonb,
    'direct',
    FALSE
WHERE NOT EXISTS (
    SELECT 1 FROM api_configurations
    WHERE provider = 'laozhang-gpt-image'
);

INSERT INTO api_configurations (
    config_id, name, provider, endpoint, api_key_encrypted,
    model_name, request_template, headers, proxy_mode, enabled
)
SELECT
    'apicfg_seed_gptimg_o',
    'laozhang Sora2 分组 (天劫二阶 GPT Image 官方)',
    'laozhang-sora2',
    'https://api.laozhang.ai/v1',
    NULL,
    'gpt-image-2',
    '{}'::jsonb,
    '{}'::jsonb,
    'direct',
    FALSE
WHERE NOT EXISTS (
    SELECT 1 FROM api_configurations
    WHERE provider = 'laozhang-sora2'
);
