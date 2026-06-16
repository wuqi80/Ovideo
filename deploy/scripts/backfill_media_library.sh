#!/bin/bash
# 素材库兜底补全：把任何"已生成但未进素材库"的文件补进 media_library_items。
# 素材库页按 project_id 过滤，所以通过 storyboard_item / video_segment 关联反查出
# project_id + episode_id，保证补进的素材能在对应项目里看到。
#
# 背景：各生成路径（视频/图片/混音）都各自调 media_library_service.create_from_file
# 做 best-effort 同步，偶有遗漏（如 mix_audio）。本脚本作为统一兜底，由 cron 每 15 分钟
# 跑一次（NOT EXISTS 只补缺失项，已同步的不动），杜绝"生成了却不在素材库"。
#
# 手动跑：bash ~/deploy/scripts/backfill_media_library.sh
set -e

sudo -u postgres psql my2_db <<'SQL'
INSERT INTO media_library_items
  (library_item_id, file_id, user_id, item_type, source, title,
   project_id, episode_id, source_entity_type, source_entity_id, created_at)
SELECT 'mli_'||substr(md5(f.file_id),1,12), f.file_id, f.user_id, f.file_type,
       COALESCE(f.metadata->>'source','generated'),
       COALESCE(NULLIF(f.file_name,''), f.file_type),
       ep.project_id, ep.episode_id, f.entity_type, f.entity_id, f.created_at
FROM files f
LEFT JOIN LATERAL (
   SELECT e.project_id, e.episode_id
   FROM episodes e
   WHERE e.episode_id = COALESCE(
     (SELECT si.episode_id FROM storyboard_items si WHERE si.item_id = f.entity_id),
     (SELECT vs.episode_id FROM video_segments vs WHERE vs.segment_id = f.entity_id)
   )
) ep ON TRUE
WHERE f.file_type IN ('video','image','audio')
  AND f.is_deleted IS NOT TRUE
  AND f.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM media_library_items m WHERE m.file_id = f.file_id)
ON CONFLICT (library_item_id) DO NOTHING;
SQL
