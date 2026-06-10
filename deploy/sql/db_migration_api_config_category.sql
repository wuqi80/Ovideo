-- =============================================================================
-- 2026-05-24 — api_configurations 表加 category 列 + 存量回填
--
-- 根因：PRESET_API_MODELS 字典里写了 category 字段，但 DAO/schema 不接受，
-- 导致前端 admin/app.js guessApiCategory 只能用 provider 关键词推断；
-- 空 provider 的行被兜底分到 text，让"飞升/渡劫"出现在「文本/推理」分类。
-- 详见 docs/faq.md 2026-05-24 条目 + recurring-pitfalls.md §S。
-- =============================================================================

BEGIN;

-- 1. schema：加列
ALTER TABLE api_configurations
    ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT ''
    CHECK (category IN ('', 'text', 'image', 'video', 'audio'));

CREATE INDEX IF NOT EXISTS idx_api_configurations_category
    ON api_configurations (category);

-- 2. 存量回填：按 provider + model_name 反推 category
--    优先 provider 关键词，next model_name 关键词，最后兜底空字符串（让前端 UI 引导用户手动选）

-- video 类（最常见的误分类源）
UPDATE api_configurations
SET category = 'video'
WHERE category = ''
  AND (
      LOWER(provider) IN ('seedance', 'sora2', 'veo', 'dashscope', 'kling', 'vidu', 'happyhorse')
      OR LOWER(provider) LIKE '%kling%'
      OR LOWER(provider) LIKE '%vidu%'
      OR LOWER(provider) LIKE '%happyhorse%'
      OR LOWER(provider) LIKE '%seedance%'
      OR LOWER(provider) LIKE '%wan2%'
      OR LOWER(model_name) LIKE 'doubao-seedance%'
      OR LOWER(model_name) LIKE 'wan2.6%'
      OR LOWER(model_name) LIKE 'kling%'
      OR LOWER(model_name) LIKE 'vidu%'
      OR LOWER(model_name) LIKE 'happyhorse%'
      OR LOWER(model_name) LIKE 'veo-%'
      OR LOWER(model_name) LIKE 'sora-%'
  );

-- audio 类
UPDATE api_configurations
SET category = 'audio'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%minimax%'
      OR LOWER(provider) LIKE '%tts%'
      OR LOWER(provider) LIKE '%gemini-tts%'
      OR LOWER(model_name) LIKE 'speech-%'
      OR LOWER(model_name) LIKE 'tts-%'
  );

-- image 类
UPDATE api_configurations
SET category = 'image'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%gemini-image%'
      OR LOWER(provider) LIKE '%laozhang-gpt-image%'
      OR LOWER(provider) = 'doubao'
      OR LOWER(provider) LIKE '%qwen-image%'
      OR LOWER(model_name) LIKE 'gpt-image%'
      OR LOWER(model_name) LIKE 'gemini%-image%'
      OR LOWER(model_name) LIKE 'seedream%'
  );

-- text 类
UPDATE api_configurations
SET category = 'text'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%gemini-text%'
      OR LOWER(provider) LIKE '%deepseek%'
      OR LOWER(model_name) LIKE 'deepseek-%'
      OR LOWER(model_name) LIKE 'gemini-%-flash'
      OR LOWER(model_name) LIKE 'gemini-%-pro'
  );

-- 兜底：仍为空的，让 admin UI 引导用户手动选；不强行猜测

COMMIT;

-- 验证（运行时不需要执行，仅供 dev 参考）：
-- SELECT category, COUNT(*) FROM api_configurations GROUP BY category;
