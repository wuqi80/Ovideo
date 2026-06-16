"""一键合成成片：把某集的视频段（每镜取最新）按分镜顺序拼成完整 mp4。

每镜对齐其配音——视频比配音短则定格最后一帧补足、配音短则补静音（两者都不裁剪）；
归一化 1920x1080 / 30fps / h264+aac 后 concat 拼接。合成完写入 files + media_library
（标题含"全片"，成品页会置顶展示）。

合成耗时较长（数十镜约数分钟），故做成后台 asyncio 任务，前端轮询 status。
与脚本 scripts/compose_episode.sh 同逻辑，但用 app 自身 DB 连接、避免 sudo/peer-auth。
"""
import os
import json
import shutil
import asyncio
import logging
import tempfile
from datetime import datetime

from db_manager import get_db_manager

logger = logging.getLogger(__name__)

_BASE = os.path.dirname(os.path.abspath(__file__))        # deploy/
_STORAGE = os.path.join(_BASE, 'persistent_storage')
_VF = ("scale=1920:1080:force_original_aspect_ratio=decrease,"
       "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30")

# episode_id -> {status: running|done|failed, total, done, url, error}
_jobs: dict = {}


def _local(file_url):
    """/storage/x → persistent_storage/x 的绝对本地路径。"""
    if not file_url:
        return None
    u = file_url.split('?')[0]
    if u.startswith('/storage'):
        u = u[len('/storage'):]
    return os.path.join(_STORAGE, u.lstrip('/'))


async def _run(cmd):
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode('utf-8', 'ignore'), err.decode('utf-8', 'ignore')


async def _probe_dur(path):
    rc, out, _ = await _run(['ffprobe', '-v', 'error', '-show_entries',
                             'format=duration', '-of', 'csv=p=0', path])
    try:
        return float(out.strip())
    except Exception:
        return 0.0


async def _list_shot_takes(episode_id):
    """按分镜顺序列出每镜的所有视频 take（含 audio 信息）。
    返回 [{item_id, sort_order, scene, dialogue, audio_url, audio_ms,
           takes:[{segment_id, video_url, thumbnail_url, created_at}]}]，按 take 新→旧。"""
    db = get_db_manager()
    rows = await db.fetch("""
        SELECT si.item_id, si.sort_order,
               si.scene_heading, si.dialogue,
               si.mixed_audio_url AS audio_url, COALESCE(si.audio_duration_ms,0) AS audio_ms,
               vs.segment_id, vs.video_url, vs.created_at,
               f.thumbnail_url
        FROM storyboard_items si
        JOIN video_segments vs ON vs.storyboard_item_id = si.item_id AND vs.video_url IS NOT NULL
        LEFT JOIN files f ON f.file_url = split_part(vs.video_url, '?', 1)
        WHERE si.episode_id = $1
        ORDER BY si.sort_order, vs.created_at DESC
    """, episode_id)
    shots = {}
    order = []
    seen_segs = set()  # LEFT JOIN files 对同一 video_url 可能多行 → 同一 segment 去重，防成片里镜头重复
    for r in rows:
        seg = r['segment_id']
        if seg in seen_segs:
            continue
        seen_segs.add(seg)
        iid = r['item_id']
        if iid not in shots:
            shots[iid] = {
                'item_id': iid, 'sort_order': r['sort_order'],
                'scene': r.get('scene_heading') or '', 'dialogue': r.get('dialogue') or '',
                'audio_url': r['audio_url'], 'audio_ms': r['audio_ms'], 'takes': [],
            }
            order.append(iid)
        shots[iid]['takes'].append({
            'segment_id': seg, 'video_url': r['video_url'],
            'thumbnail_url': r.get('thumbnail_url'),
            'created_at': r['created_at'].isoformat() if r.get('created_at') else None,
        })
    return [shots[i] for i in order]


async def get_takes(episode_id):
    """供前端挑选面板：每镜所有 take（缺省第一条=最新）。"""
    return await _list_shot_takes(episode_id)


async def _get_shots(episode_id, selections=None):
    """合成实际使用的镜头序列。selections: {item_id: segment_id} 指定每镜用哪条 take，
    未指定则用最新（takes[0]）。"""
    selections = selections or {}
    shots = await _list_shot_takes(episode_id)
    result = []
    for s in shots:
        if not s['takes']:
            continue
        sel_seg = selections.get(s['item_id'])
        chosen = next((t for t in s['takes'] if t['segment_id'] == sel_seg), s['takes'][0])
        result.append({'video_url': chosen['video_url'], 'audio_url': s['audio_url'], 'audio_ms': s['audio_ms']})
    return result


async def _compose(episode_id, user_id, project_id, job, selections=None):
    shots = await _get_shots(episode_id, selections)
    job['total'] = len(shots)
    if not shots:
        raise RuntimeError("该集没有可合成的视频段")

    tmp = tempfile.mkdtemp(prefix=f'compose_{episode_id}_')
    try:
        clips = []
        idx = 0
        for r in shots:
            vpath = _local(r['video_url'])
            if not vpath or not os.path.isfile(vpath):
                logger.warning("compose: 跳过缺失视频 %s", vpath)
                continue
            idx += 1
            out = os.path.join(tmp, f'clip_{idx:03d}.mp4')
            vdur = await _probe_dur(vpath)
            apath = _local(r.get('audio_url'))
            ams = int(r.get('audio_ms') or 0)
            # 防线：历史混音未回写时长 → audio_duration_ms=0。有音频文件但 ams=0 时直接探测，
            # 否则会走"无音频"分支或对齐错误，导致音画不同步。
            if apath and os.path.isfile(apath) and ams <= 0:
                ams = int(await _probe_dur(apath) * 1000)
            common = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
                      '-r', '30', '-video_track_timescale', '30000',
                      '-c:a', 'aac', '-ar', '48000', '-ac', '2', out]
            if apath and os.path.isfile(apath) and ams > 0:
                target = max(vdur, ams / 1000.0)
                cmd = ['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-i', vpath, '-i', apath,
                       '-filter_complex',
                       f"[0:v]{_VF},tpad=stop_mode=clone:stop_duration={target}[v];[1:a]apad[a]",
                       '-map', '[v]', '-map', '[a]', '-t', str(target)] + common
            else:
                cmd = ['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-i', vpath,
                       '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
                       '-filter_complex', f"[0:v]{_VF}[v]",
                       '-map', '[v]', '-map', '1:a', '-t', str(vdur or 5), '-shortest'] + common
            rc, _, err = await _run(cmd)
            if rc != 0:
                logger.warning("compose: 镜头 %d ffmpeg 失败: %s", idx, err[:200])
                continue
            clips.append(out)
            job['done'] = len(clips)

        if not clips:
            raise RuntimeError("没有成功合成的镜头")

        list_file = os.path.join(tmp, 'list.txt')
        with open(list_file, 'w', encoding='utf-8') as f:
            for c in clips:
                f.write(f"file '{c}'\n")

        # 每次合成生成唯一文件名/ID（带时间戳），不覆盖历史——同一集可多次合成、全部保留并列出。
        ts = datetime.now().strftime('%Y%m%d%H%M%S')
        ts_label = datetime.now().strftime('%m-%d %H:%M')
        ym = datetime.now().strftime('%Y%m')
        rel_dir = os.path.join(_STORAGE, 'video', user_id, ym)
        os.makedirs(rel_dir, exist_ok=True)
        out_name = f'composed_{episode_id}_{ts}.mp4'
        out_path = os.path.join(rel_dir, out_name)
        rc, _, err = await _run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error',
                                 '-f', 'concat', '-safe', '0', '-i', list_file,
                                 '-c', 'copy', out_path])
        if rc != 0:
            raise RuntimeError(f"拼接失败: {err[:200]}")

        dur = await _probe_dur(out_path)
        size = os.path.getsize(out_path)
        file_url = f"/storage/video/{user_id}/{ym}/{out_name}"
        file_path_rel = f"persistent_storage/video/{user_id}/{ym}/{out_name}"
        short = episode_id[-8:]
        file_id = f"file_cmp_{short}_{ts}"
        mli_id = f"mli_cmp_{short}_{ts}"
        title = f"全片成片 {ts_label}（{len(clips)}镜）"

        db = get_db_manager()
        await db.execute("""
            INSERT INTO files (file_id,user_id,file_type,file_name,file_path,file_url,
                               file_size_bytes,mime_type,duration_seconds,entity_type,entity_id,metadata,created_at)
            VALUES ($1,$2,'video',$3,$4,$5,$6,'video/mp4',$7,'episode',$8,$9::jsonb,now())
        """, file_id, user_id, out_name, file_path_rel, file_url,
             size, dur, episode_id, json.dumps({"source": "composed_final", "kind": "final_cut"}))

        await db.execute("""
            INSERT INTO media_library_items (library_item_id,file_id,user_id,item_type,source,title,project_id,episode_id,created_at)
            VALUES ($1,$2,$3,'video','composed_final',$4,$5,$6,now())
        """, mli_id, file_id, user_id, title, project_id, episode_id)

        job['url'] = file_url
        job['duration'] = round(dur, 1)
        job['status'] = 'done'
        logger.info("compose done: episode=%s clips=%d dur=%.1fs", episode_id, len(clips), dur)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def start_compose(episode_id, user_id, project_id, selections=None):
    """启动后台合成任务；若已在跑则返回现有 job。selections: {item_id: segment_id}。"""
    cur = _jobs.get(episode_id)
    if cur and cur.get('status') == 'running':
        return cur
    job = {'status': 'running', 'total': 0, 'done': 0, 'url': None, 'error': None}
    _jobs[episode_id] = job

    async def _runner():
        try:
            await _compose(episode_id, user_id, project_id, job, selections)
        except Exception as e:
            job['status'] = 'failed'
            job['error'] = str(e)[:300]
            logger.exception("compose 失败 episode=%s", episode_id)

    asyncio.create_task(_runner())
    return job


def get_status(episode_id):
    return _jobs.get(episode_id) or {'status': 'idle', 'total': 0, 'done': 0, 'url': None, 'error': None}
