-- 悟空项目恢复：按生成时间顺序分两集，视频/图片/音频都恢复并分配到两集。
-- 仅操作 user_id='Yuan' 的素材（即被删项目的内容）；wk 项目的素材在 admin 名下，不受影响。
BEGIN;

-- 1) 去掉我上一轮插入的重复 'recovered' 项（worker 早已同步过同一批文件）
DELETE FROM media_library_items WHERE user_id='Yuan' AND source='recovered';

-- 2) 第二集（第一集 ep_recover_wukong 已存在）
INSERT INTO episodes (episode_id, project_id, episode_number, episode_name, status)
  VALUES ('ep_recover_wukong_2','proj_recover_wukong',2,'恢复-第二集','draft')
  ON CONFLICT (episode_id) DO NOTHING;
UPDATE episodes SET episode_name='恢复-第一集' WHERE episode_id='ep_recover_wukong';

-- 3) 补齐缺失的素材项（files 有但素材库没有的，主要是部分音频），保证每个文件一条
INSERT INTO media_library_items (library_item_id, file_id, user_id, item_type, source, title, created_at)
SELECT 'mli_'||substr(md5(f.file_id),1,12), f.file_id, 'Yuan', f.file_type,
       COALESCE(f.metadata->>'source','generated'), COALESCE(f.file_name,f.file_type), f.created_at
FROM files f
WHERE f.user_id='Yuan' AND f.file_type IN ('video','image','audio') AND f.is_deleted IS NOT TRUE
  AND NOT EXISTS (SELECT 1 FROM media_library_items m WHERE m.file_id=f.file_id AND m.user_id='Yuan')
ON CONFLICT (library_item_id) DO NOTHING;

-- 4) 把 Yuan 所有素材（视频/图/音）按类型生成时间二分，归入恢复项目的两集
WITH ranked AS (
  SELECT library_item_id, NTILE(2) OVER (PARTITION BY item_type ORDER BY created_at) AS grp
  FROM media_library_items
  WHERE user_id='Yuan' AND item_type IN ('video','image','audio')
)
UPDATE media_library_items m
SET project_id='proj_recover_wukong',
    episode_id = CASE r.grp WHEN 1 THEN 'ep_recover_wukong' ELSE 'ep_recover_wukong_2' END
FROM ranked r WHERE m.library_item_id = r.library_item_id;

-- 5) 重建视频段，按生成时间二分到两集（美化页按集显示视频）
DELETE FROM video_segments WHERE episode_id IN ('ep_recover_wukong','ep_recover_wukong_2');
WITH vids AS (
  SELECT file_id, file_url,
         NTILE(2) OVER (ORDER BY created_at) AS grp,
         row_number() OVER (ORDER BY created_at) AS rn
  FROM files WHERE user_id='Yuan' AND file_type='video' AND is_deleted IS NOT TRUE
)
INSERT INTO video_segments (segment_id, episode_id, sort_order, video_url)
SELECT 'seg_'||substr(md5(file_id),1,12),
       CASE grp WHEN 1 THEN 'ep_recover_wukong' ELSE 'ep_recover_wukong_2' END,
       rn::int, file_url
FROM vids
ON CONFLICT (segment_id) DO NOTHING;

COMMIT;

-- 验证
SELECT '视频段/集' AS what, episode_id, count(*) FROM video_segments
  WHERE episode_id IN ('ep_recover_wukong','ep_recover_wukong_2') GROUP BY episode_id ORDER BY episode_id;
SELECT '素材/集/类型' AS what, episode_id, item_type, count(*) FROM media_library_items
  WHERE user_id='Yuan' AND project_id='proj_recover_wukong' GROUP BY episode_id, item_type ORDER BY episode_id, item_type;
