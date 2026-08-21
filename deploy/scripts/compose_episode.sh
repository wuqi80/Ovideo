#!/bin/bash
# 一键合成成片：把某集的视频段（每镜取最新一条）按分镜顺序拼接成一个完整 mp4，
# 每镜对齐它的配音——视频比配音短则定格最后一帧补足，配音比视频短则补静音（两者都不裁剪）。
# 归一化到 1920x1080 / 30fps / h264+aac，再用 concat 无损拼接。
#
# 用法: bash compose_episode.sh <episode_id> [limit]
#   limit 可选，仅合成前 N 镜（用于小样测试）。
# 输出: 打印最终 mp4 路径（/tmp 下），不写库（注册由调用方另做）。
set -e
EPISODE_ID="$1"
LIMIT="${2:-100000}"
DB_NAME="${DB_NAME:-ostory_db}"
[ -z "$EPISODE_ID" ] && { echo "need episode_id"; exit 1; }

WORK="/tmp/compose_${EPISODE_ID}"
rm -rf "$WORK"; mkdir -p "$WORK"
LIST="$WORK/list.txt"; : > "$LIST"

# 存储根目录（app 的 persistent_storage 在此）。/storage/x → $BASE/persistent_storage/x。
BASE="${OSTORY_APP_ROOT:-/opt/ostory}"
# 直接在 SQL 里把 file_url(/storage/..) 解析成绝对本地路径，bash 不再做字符串处理（避免转义坑）。
# split_part 去掉 ?token；substr(..,9) 去掉开头的 "/storage"（8字符）。
ROWS=$(sudo -u postgres psql "$DB_NAME" -tA -F$'\t' -c "
SELECT '${BASE}/persistent_storage' || substr(split_part(v.video_url,'?',1), 9),
       CASE WHEN COALESCE(si.mixed_audio_url,'')='' THEN ''
            ELSE '${BASE}/persistent_storage' || substr(split_part(si.mixed_audio_url,'?',1), 9) END,
       COALESCE(si.audio_duration_ms,0)
FROM storyboard_items si
JOIN LATERAL (
   SELECT vs.video_url FROM video_segments vs
   WHERE vs.storyboard_item_id = si.item_id AND vs.video_url IS NOT NULL
   ORDER BY vs.created_at DESC LIMIT 1
) v ON TRUE
WHERE si.episode_id='${EPISODE_ID}'
ORDER BY si.sort_order
LIMIT ${LIMIT};")

i=0
while IFS=$'\t' read -r VID AUD ADUR; do
  [ -z "$VID" ] && continue
  [ ! -f "$VID" ] && { echo "skip(missing video): $VID"; continue; }
  i=$((i+1))
  OUT="$WORK/clip_$(printf '%03d' $i).mp4"
  # 时长解析加固：只保留数字，空则 0，避免 awk 除法崩溃
  ADUR=$(printf '%s' "$ADUR" | tr -dc '0-9'); [ -z "$ADUR" ] && ADUR=0
  VDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VID" </dev/null 2>/dev/null || echo 0)
  VDUR=$(printf '%s' "$VDUR" | tr -dc '0-9.'); [ -z "$VDUR" ] && VDUR=0
  ADUR_S=$(awk "BEGIN{printf \"%.3f\", ${ADUR}/1000}")
  VF="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"

  if [ -n "$AUD" ] && [ -f "$AUD" ] && [ "$ADUR" -gt 0 ]; then
    # 目标时长 = max(视频, 配音)
    TARGET=$(awk "BEGIN{print (${VDUR}>${ADUR_S})?${VDUR}:${ADUR_S}}")
    ffmpeg -nostdin -y -loglevel error -i "$VID" -i "$AUD" -filter_complex \
      "[0:v]${VF},tpad=stop_mode=clone:stop_duration=${TARGET}[v];[1:a]apad[a]" \
      -map "[v]" -map "[a]" -t "$TARGET" \
      -c:v libx264 -preset veryfast -pix_fmt yuv420p -r 30 -video_track_timescale 30000 \
      -c:a aac -ar 48000 -ac 2 "$OUT"
  else
    # 无配音：按视频时长，配静音轨
    ffmpeg -nostdin -y -loglevel error -i "$VID" -f lavfi -i anullsrc=r=48000:cl=stereo -filter_complex \
      "[0:v]${VF}[v]" -map "[v]" -map 1:a -t "$VDUR" -shortest \
      -c:v libx264 -preset veryfast -pix_fmt yuv420p -r 30 -video_track_timescale 30000 \
      -c:a aac -ar 48000 -ac 2 "$OUT"
  fi
  echo "file '$OUT'" >> "$LIST"
  echo "  [$i] ok dur_v=${VDUR} dur_a=${ADUR_S} -> $(basename $OUT)"
done <<< "$ROWS"

[ "$i" -eq 0 ] && { echo "no clips"; exit 1; }

FINAL="$WORK/final.mp4"
ffmpeg -nostdin -y -loglevel error -f concat -safe 0 -i "$LIST" -c copy "$FINAL"
echo "CLIPS=$i"
echo "FINAL=$FINAL"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$FINAL" 2>/dev/null | awk '{printf "DURATION=%.1fs\n",$1}'
