# -*- coding: utf-8 -*-
"""Episode final-video composition service."""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from datetime import datetime
from typing import Any, Dict, List, Optional

from dao.creative.episode_compose import EpisodeComposeDAO

logger = logging.getLogger(__name__)

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STORAGE = os.path.join(_BASE, "persistent_storage")
_VF = (
    "scale=1920:1080:force_original_aspect_ratio=decrease,"
    "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"
)

# episode_id -> {status: running|done|failed, total, done, url, error}
_jobs: Dict[str, Dict[str, Any]] = {}


def _ensure_media_tools() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if not shutil.which(tool)]
    if missing:
        raise RuntimeError(f"服务器缺少媒体合成工具: {', '.join(missing)}，请安装 ffmpeg 后重启服务")


def _local(file_url: Optional[str]) -> Optional[str]:
    if not file_url:
        return None
    url = file_url.split("?", 1)[0]
    if url.startswith("/storage"):
        url = url[len("/storage") :]
    return os.path.join(_STORAGE, url.lstrip("/"))


def _audio_urls_from_row(row: Dict[str, Any]) -> List[str]:
    urls: List[str] = []
    seen: set[str] = set()
    for key in ("audio_url", "dialogue_audio_url", "narration_audio_url", "sfx_audio_url"):
        value = row.get(key)
        if not value:
            continue
        url = str(value)
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


async def _run(cmd: List[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode("utf-8", "ignore"), err.decode("utf-8", "ignore")


async def _probe_dur(path: str) -> float:
    _rc, out, _err = await _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            path,
        ]
    )
    try:
        return float(out.strip())
    except Exception:
        return 0.0


async def _list_shot_takes(episode_id: str) -> List[Dict[str, Any]]:
    rows = await EpisodeComposeDAO.list_shot_take_rows(episode_id)
    shots: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    seen_segments: set[str] = set()

    for row in rows:
        segment_id = row["segment_id"]
        if segment_id in seen_segments:
            continue
        seen_segments.add(segment_id)

        item_id = row["item_id"]
        if item_id not in shots:
            audio_urls = _audio_urls_from_row(row)
            shots[item_id] = {
                "item_id": item_id,
                "sort_order": row["sort_order"],
                "scene": row.get("scene_heading") or "",
                "dialogue": row.get("dialogue") or "",
                "audio_url": audio_urls[0] if audio_urls else None,
                "audio_urls": audio_urls,
                "audio_ms": row.get("audio_ms") or 0,
                "takes": [],
            }
            order.append(item_id)

        created_at = row.get("created_at")
        shots[item_id]["takes"].append(
            {
                "segment_id": segment_id,
                "video_url": row.get("video_url"),
                "thumbnail_url": row.get("thumbnail_url"),
                "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
            }
        )

    return [shots[item_id] for item_id in order]


async def get_takes(episode_id: str) -> List[Dict[str, Any]]:
    return await _list_shot_takes(episode_id)


async def _get_shots(episode_id: str, selections: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    selected_segments = selections or {}
    shots = await _list_shot_takes(episode_id)
    result: List[Dict[str, Any]] = []
    for shot in shots:
        if not shot["takes"]:
            continue
        wanted_segment_id = selected_segments.get(shot["item_id"])
        chosen = next(
            (take for take in shot["takes"] if take["segment_id"] == wanted_segment_id),
            shot["takes"][0],
        )
        result.append(
            {
                "video_url": chosen["video_url"],
                "audio_url": shot.get("audio_url"),
                "audio_urls": shot.get("audio_urls") or ([shot["audio_url"]] if shot.get("audio_url") else []),
                "audio_ms": shot.get("audio_ms") or 0,
            }
        )
    return result


async def _compose(
    episode_id: str,
    user_id: str,
    project_id: str,
    job: Dict[str, Any],
    selections: Optional[Dict[str, str]] = None,
) -> None:
    _ensure_media_tools()
    shots = await _get_shots(episode_id, selections)
    job["total"] = len(shots)
    if not shots:
        raise RuntimeError("No video segments available for episode composition")

    tmp = tempfile.mkdtemp(prefix=f"compose_{episode_id}_")
    try:
        clips: List[str] = []
        idx = 0
        for row in shots:
            video_path = _local(row.get("video_url"))
            if not video_path or not os.path.isfile(video_path):
                logger.warning("compose: skipped missing video %s", video_path)
                continue
            idx += 1
            clip_path = os.path.join(tmp, f"clip_{idx:03d}.mp4")
            video_duration = await _probe_dur(video_path)
            audio_urls = row.get("audio_urls") or ([row.get("audio_url")] if row.get("audio_url") else [])
            audio_paths: List[str] = []
            seen_audio_paths: set[str] = set()
            for audio_url in audio_urls:
                audio_path = _local(audio_url)
                if not audio_path or not os.path.isfile(audio_path) or audio_path in seen_audio_paths:
                    continue
                seen_audio_paths.add(audio_path)
                audio_paths.append(audio_path)
            audio_ms = int(row.get("audio_ms") or 0)
            if audio_paths and audio_ms <= 0:
                durations = [await _probe_dur(audio_path) for audio_path in audio_paths]
                audio_ms = int(max(durations or [0.0]) * 1000)

            common = [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
                "-r",
                "30",
                "-video_track_timescale",
                "30000",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                clip_path,
            ]
            if audio_paths and audio_ms > 0:
                target_duration = max(video_duration, audio_ms / 1000.0)
                audio_inputs: List[str] = []
                for audio_path in audio_paths:
                    audio_inputs.extend(["-i", audio_path])
                if len(audio_paths) == 1:
                    audio_filter = "[1:a]apad[a]"
                else:
                    padded = "".join(f"[{i}:a]apad[a{i}];" for i in range(1, len(audio_paths) + 1))
                    mix_inputs = "".join(f"[a{i}]" for i in range(1, len(audio_paths) + 1))
                    audio_filter = (
                        f"{padded}{mix_inputs}"
                        f"amix=inputs={len(audio_paths)}:duration=longest:dropout_transition=0[a]"
                    )
                cmd = [
                    "ffmpeg",
                    "-nostdin",
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    video_path,
                    *audio_inputs,
                    "-filter_complex",
                    f"[0:v]{_VF},tpad=stop_mode=clone:stop_duration={target_duration}[v];{audio_filter}",
                    "-map",
                    "[v]",
                    "-map",
                    "[a]",
                    "-t",
                    str(target_duration),
                    *common,
                ]
            else:
                cmd = [
                    "ffmpeg",
                    "-nostdin",
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    video_path,
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=48000:cl=stereo",
                    "-filter_complex",
                    f"[0:v]{_VF}[v]",
                    "-map",
                    "[v]",
                    "-map",
                    "1:a",
                    "-t",
                    str(video_duration or 5),
                    "-shortest",
                    *common,
                ]

            rc, _out, err = await _run(cmd)
            if rc != 0:
                logger.warning("compose: clip %d failed: %s", idx, err[:200])
                continue
            clips.append(clip_path)
            job["done"] = len(clips)

        if not clips:
            raise RuntimeError("No clips were composed successfully")

        list_file = os.path.join(tmp, "list.txt")
        with open(list_file, "w", encoding="utf-8") as file:
            for clip_path in clips:
                file.write(f"file '{clip_path}'\n")

        now = datetime.now()
        ts = now.strftime("%Y%m%d%H%M%S")
        ts_label = now.strftime("%m-%d %H:%M")
        ym = now.strftime("%Y%m")
        rel_dir = os.path.join(_STORAGE, "video", user_id, ym)
        os.makedirs(rel_dir, exist_ok=True)
        out_name = f"composed_{episode_id}_{ts}.mp4"
        out_path = os.path.join(rel_dir, out_name)
        rc, _out, err = await _run(
            [
                "ffmpeg",
                "-nostdin",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_file,
                "-c",
                "copy",
                out_path,
            ]
        )
        if rc != 0:
            raise RuntimeError(f"Final concat failed: {err[:200]}")

        duration = await _probe_dur(out_path)
        size = os.path.getsize(out_path)
        file_url = f"/storage/video/{user_id}/{ym}/{out_name}"
        file_path_rel = f"persistent_storage/video/{user_id}/{ym}/{out_name}"
        short = episode_id[-8:]
        file_id = f"file_cmp_{short}_{ts}"
        library_item_id = f"mli_cmp_{short}_{ts}"
        title = f"全片成片 {ts_label} ({len(clips)} 镜)"

        await EpisodeComposeDAO.create_final_cut_records(
            file_id=file_id,
            library_item_id=library_item_id,
            user_id=user_id,
            project_id=project_id,
            episode_id=episode_id,
            file_name=out_name,
            file_path=file_path_rel,
            file_url=file_url,
            file_size_bytes=size,
            duration_seconds=duration,
            title=title,
            metadata={"source": "composed_final", "kind": "final_cut"},
        )

        job["url"] = file_url
        job["duration"] = round(duration, 1)
        job["status"] = "done"
        logger.info("compose done: episode=%s clips=%d dur=%.1fs", episode_id, len(clips), duration)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def start_compose(
    episode_id: str,
    user_id: str,
    project_id: str,
    selections: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    current = _jobs.get(episode_id)
    if current and current.get("status") == "running":
        return current

    job: Dict[str, Any] = {"status": "running", "total": 0, "done": 0, "url": None, "error": None}
    _jobs[episode_id] = job

    async def _runner() -> None:
        try:
            await _compose(episode_id, user_id, project_id, job, selections)
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = str(exc)[:300]
            logger.exception("compose failed episode=%s", episode_id)

    asyncio.create_task(_runner())
    return job


def get_status(episode_id: str) -> Dict[str, Any]:
    return _jobs.get(episode_id) or {"status": "idle", "total": 0, "done": 0, "url": None, "error": None}
