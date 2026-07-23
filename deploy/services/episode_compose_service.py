# -*- coding: utf-8 -*-
"""Episode final-video composition service."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from dao.creative.episode_compose import EpisodeComposeDAO

logger = logging.getLogger(__name__)

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STORAGE = os.path.join(_BASE, "persistent_storage")
_DEFAULT_OUTPUT_SIZE = (1920, 1080)
_ASPECT_PRESETS: List[Tuple[str, float, Tuple[int, int]]] = [
    ("9:16", 9 / 16, (1080, 1920)),
    ("3:4", 3 / 4, (1080, 1440)),
    ("1:1", 1.0, (1080, 1080)),
    ("4:3", 4 / 3, (1440, 1080)),
    ("16:9", 16 / 9, _DEFAULT_OUTPUT_SIZE),
]

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


def _ordered_audio_segments_from_row(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = row.get("audio_segments")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            raw = []
    if not isinstance(raw, list):
        return []

    segments: List[Dict[str, Any]] = []
    for index, value in enumerate(raw):
        if not isinstance(value, dict):
            continue
        kind = value.get("kind")
        if kind not in {"speech", "silence"}:
            continue
        try:
            sequence_index = int(value.get("sequenceIndex", value.get("sequence_index", index)))
        except (TypeError, ValueError):
            sequence_index = index
        try:
            duration_ms = max(
                0,
                int(float(value.get("durationMs", value.get("duration_ms", 0)) or 0)),
            )
        except (TypeError, ValueError):
            duration_ms = 0
        audio_url = value.get("audioUrl", value.get("audio_url"))
        segments.append(
            {
                "segment_id": str(value.get("segmentId", value.get("segment_id", f"segment-{index + 1}"))),
                "kind": kind,
                "sequence_index": sequence_index,
                "audio_url": str(audio_url) if audio_url else None,
                "duration_ms": duration_ms,
            }
        )
    return sorted(segments, key=lambda segment: segment["sequence_index"])


def _audio_ms_from_segments(segments: List[Dict[str, Any]]) -> int:
    return sum(max(0, int(segment.get("duration_ms") or 0)) for segment in segments)


def _finite_number(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if parsed == parsed else fallback
    except (TypeError, ValueError):
        return fallback


def _global_audio_timeline(
    row: Dict[str, Any],
    source_duration_ms: int,
    episode_duration_ms: int,
) -> Dict[str, Any]:
    params = row.get("generation_params") or {}
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except (TypeError, ValueError):
            params = {}
    timeline = params.get("timeline") if isinstance(params, dict) else {}
    if not isinstance(timeline, dict):
        timeline = {}

    source_duration_ms = max(100, int(source_duration_ms or episode_duration_ms or 100))
    source_offset_ms = max(
        0,
        min(
            int(_finite_number(timeline.get("sourceOffsetMs", timeline.get("source_offset_ms")))),
            source_duration_ms - 100,
        ),
    )
    maximum_duration_ms = max(100, source_duration_ms - source_offset_ms)
    default_duration_ms = min(maximum_duration_ms, max(100, episode_duration_ms))
    duration_ms = max(
        100,
        min(
            int(_finite_number(
                timeline.get("durationMs", timeline.get("duration_ms")),
                default_duration_ms,
            )),
            maximum_duration_ms,
        ),
    )
    start_ms = max(
        0,
        min(
            int(_finite_number(timeline.get("startMs", timeline.get("start_ms")))),
            max(0, episode_duration_ms - duration_ms),
        ),
    )
    is_bgm = row.get("track_type") == "bgm"
    fade_in_ms = (
        max(
            0,
            min(
                int(_finite_number(timeline.get("fadeInMs", timeline.get("fade_in_ms")))),
                duration_ms,
            ),
        )
        if is_bgm
        else 0
    )
    fade_out_ms = (
        max(
            0,
            min(
                int(_finite_number(timeline.get("fadeOutMs", timeline.get("fade_out_ms")))),
                duration_ms - fade_in_ms,
            ),
        )
        if is_bgm
        else 0
    )
    default_volume = 0.35 if is_bgm else 1.0
    volume = max(
        0.0,
        min(_finite_number(timeline.get("volume"), default_volume), 2.0),
    )
    return {
        "start_ms": start_ms,
        "source_offset_ms": source_offset_ms,
        "duration_ms": duration_ms,
        "fade_in_ms": fade_in_ms,
        "fade_out_ms": fade_out_ms,
        "volume": volume,
    }


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


async def _probe_has_audio(path: str) -> bool:
    _rc, out, _err = await _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            path,
        ]
    )
    return "audio" in out.strip().lower()


async def _probe_video_size(path: str) -> Optional[Tuple[int, int]]:
    _rc, out, _err = await _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            path,
        ]
    )
    text = out.strip().splitlines()[0] if out.strip() else ""
    try:
        width_text, height_text = text.lower().split("x", 1)
        width = int(width_text)
        height = int(height_text)
        if width > 0 and height > 0:
            return width, height
    except Exception:
        return None
    return None


async def _mix_global_audio_tracks(
    episode_id: str,
    video_path: str,
    video_duration: float,
    tmp: str,
) -> None:
    rows = await EpisodeComposeDAO.list_audio_tracks(episode_id)
    prepared_tracks: List[Dict[str, Any]] = []
    episode_duration_ms = max(100, int(video_duration * 1000))
    for row in rows:
        audio_path = _local(row.get("audio_url"))
        if not audio_path or not os.path.isfile(audio_path):
            continue
        source_duration_ms = int(row.get("duration_ms") or 0)
        if source_duration_ms <= 0:
            source_duration_ms = int((await _probe_dur(audio_path)) * 1000)
        prepared_tracks.append(
            {
                **row,
                "_audio_path": audio_path,
                "_timeline": _global_audio_timeline(
                    row,
                    source_duration_ms,
                    episode_duration_ms,
                ),
            }
        )
    if not prepared_tracks:
        return

    input_args: List[str] = []
    filters = [
        "[0:a]aresample=48000,"
        "aformat=sample_fmts=fltp:sample_rates=48000:"
        "channel_layouts=stereo[base]"
    ]
    mix_labels = ["[base]"]
    for index, track in enumerate(prepared_tracks, start=1):
        input_args.extend(["-i", track["_audio_path"]])
        timeline = track["_timeline"]
        duration_seconds = timeline["duration_ms"] / 1000.0
        filter_steps = [
            f"[{index}:a]atrim=start={timeline['source_offset_ms'] / 1000.0:.3f}:"
            f"duration={duration_seconds:.3f}",
            "asetpts=PTS-STARTPTS",
        ]
        if timeline["fade_in_ms"] > 0:
            filter_steps.append(
                f"afade=t=in:st=0:d={timeline['fade_in_ms'] / 1000.0:.3f}"
            )
        if timeline["fade_out_ms"] > 0:
            filter_steps.append(
                f"afade=t=out:"
                f"st={max(0.0, duration_seconds - timeline['fade_out_ms'] / 1000.0):.3f}:"
                f"d={timeline['fade_out_ms'] / 1000.0:.3f}"
            )
        filter_steps.extend(
            [
                f"volume={timeline['volume']:.3f}",
                f"adelay=delays={timeline['start_ms']}:all=1",
                f"aformat=sample_fmts=fltp:sample_rates=48000:"
                f"channel_layouts=stereo[global{index}]",
            ]
        )
        filters.append(",".join(filter_steps))
        mix_labels.append(f"[global{index}]")

    filters.append(
        f"{''.join(mix_labels)}"
        f"amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:"
        "normalize=0[a]"
    )
    mixed_path = os.path.join(tmp, "final_with_global_audio.mp4")
    rc, _out, err = await _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-i",
            video_path,
            *input_args,
            "-filter_complex",
            ";".join(filters),
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-t",
            f"{video_duration:.3f}",
            mixed_path,
        ]
    )
    if rc != 0:
        raise RuntimeError(f"Global audio mix failed: {err[:200]}")
    os.replace(mixed_path, video_path)


def _even(value: int) -> int:
    return max(2, value if value % 2 == 0 else value - 1)


def _output_size_for_source(width: int, height: int) -> Tuple[int, int, str]:
    if width <= 0 or height <= 0:
        return (*_DEFAULT_OUTPUT_SIZE, "16:9")

    ratio = width / height
    for label, preset_ratio, (target_width, target_height) in _ASPECT_PRESETS:
        if abs(ratio - preset_ratio) <= 0.04:
            return target_width, target_height, label

    if ratio < 1:
        target_width = 1080
        return target_width, _even(round(target_width / ratio)), f"{width}:{height}"

    target_height = 1080
    target_width = min(_even(round(target_height * ratio)), 1920)
    return target_width, target_height, f"{width}:{height}"


def _choose_output_size(sizes: List[Tuple[int, int]]) -> Tuple[int, int, str]:
    if not sizes:
        return (*_DEFAULT_OUTPUT_SIZE, "16:9")

    buckets: Dict[Tuple[int, int, str], int] = {}
    for width, height in sizes:
        bucket = _output_size_for_source(width, height)
        buckets[bucket] = buckets.get(bucket, 0) + 1

    # 多数镜头决定成片比例；票数相同则按原顺序选择先出现的比例。
    return max(buckets, key=lambda key: (buckets[key], -list(buckets).index(key)))


def _video_filter(output_width: int, output_height: int) -> str:
    return (
        f"scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,"
        f"pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"
    )


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
            audio_segments = _ordered_audio_segments_from_row(row)
            ordered_audio_urls = [
                segment["audio_url"]
                for segment in audio_segments
                if segment["kind"] == "speech" and segment.get("audio_url")
            ]
            audio_urls = ordered_audio_urls or _audio_urls_from_row(row)
            audio_ms = _audio_ms_from_segments(audio_segments) or row.get("audio_ms") or 0
            shots[item_id] = {
                "item_id": item_id,
                "sort_order": row["sort_order"],
                "scene": row.get("scene_heading") or "",
                "dialogue": row.get("dialogue") or "",
                "audio_url": audio_urls[0] if audio_urls else None,
                "audio_urls": audio_urls,
                "audio_segments": audio_segments,
                "sfx_audio_url": row.get("sfx_audio_url"),
                "audio_ms": audio_ms,
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
                "audio_segments": shot.get("audio_segments") or [],
                "sfx_audio_url": shot.get("sfx_audio_url"),
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
    audio_mode: str = "video_original",
) -> None:
    _ensure_media_tools()
    shots = await _get_shots(episode_id, selections)
    job["total"] = len(shots)
    if not shots:
        raise RuntimeError("No video segments available for episode composition")

    tmp = tempfile.mkdtemp(prefix=f"compose_{episode_id}_")
    try:
        prepared: List[Dict[str, Any]] = []
        probed_sizes: List[Tuple[int, int]] = []
        for row in shots:
            video_path = _local(row.get("video_url"))
            if not video_path or not os.path.isfile(video_path):
                logger.warning("compose: skipped missing video %s", video_path)
                continue
            size = await _probe_video_size(video_path)
            if size:
                probed_sizes.append(size)
            prepared.append({**row, "_video_path": video_path})

        output_width, output_height, output_aspect = _choose_output_size(probed_sizes)
        vf = _video_filter(output_width, output_height)
        job["output_width"] = output_width
        job["output_height"] = output_height
        job["output_aspect"] = output_aspect

        clips: List[str] = []
        idx = 0
        for row in prepared:
            video_path = row["_video_path"]
            idx += 1
            clip_path = os.path.join(tmp, f"clip_{idx:03d}.mp4")
            video_duration = await _probe_dur(video_path)
            audio_segments = row.get("audio_segments") or []
            ordered_parts: List[Dict[str, Any]] = []
            for segment in audio_segments:
                duration_ms = max(0, int(segment.get("duration_ms") or 0))
                if segment.get("kind") == "silence":
                    if duration_ms > 0:
                        ordered_parts.append({"kind": "silence", "duration_ms": duration_ms})
                    continue
                audio_path = _local(segment.get("audio_url"))
                if audio_path and os.path.isfile(audio_path):
                    if duration_ms <= 0:
                        duration_ms = int((await _probe_dur(audio_path)) * 1000)
                    ordered_parts.append(
                        {
                            "kind": "speech",
                            "path": audio_path,
                            "duration_ms": duration_ms,
                        }
                    )
                elif duration_ms > 0:
                    # 已记录时长但音频文件缺失时保留时间位置，避免后续对白提前。
                    ordered_parts.append({"kind": "silence", "duration_ms": duration_ms})

            audio_urls = row.get("audio_urls") or ([row.get("audio_url")] if row.get("audio_url") else [])
            audio_paths: List[str] = []
            seen_audio_paths: set[str] = set()
            if not ordered_parts:
                for audio_url in audio_urls:
                    audio_path = _local(audio_url)
                    if not audio_path or not os.path.isfile(audio_path) or audio_path in seen_audio_paths:
                        continue
                    seen_audio_paths.add(audio_path)
                    audio_paths.append(audio_path)
            audio_ms = sum(int(part.get("duration_ms") or 0) for part in ordered_parts)
            if not ordered_parts:
                audio_ms = int(row.get("audio_ms") or 0)
            if audio_paths and audio_ms <= 0:
                durations = [await _probe_dur(audio_path) for audio_path in audio_paths]
                audio_ms = int(max(durations or [0.0]) * 1000)
            sfx_path = _local(row.get("sfx_audio_url")) if ordered_parts else None
            if sfx_path and not os.path.isfile(sfx_path):
                sfx_path = None
            video_has_audio = await _probe_has_audio(video_path)
            use_reference_audio = bool(
                (ordered_parts or audio_paths)
                and audio_ms > 0
                and (audio_mode == "reference_dubbing" or not video_has_audio)
            )

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
            if use_reference_audio:
                target_duration = max(video_duration, audio_ms / 1000.0)
                if ordered_parts:
                    audio_inputs: List[str] = []
                    sequence_filters: List[str] = []
                    sequence_labels: List[str] = []
                    input_index = 1
                    for sequence_index, part in enumerate(ordered_parts):
                        label = f"seq{sequence_index}"
                        sequence_labels.append(f"[{label}]")
                        if part["kind"] == "speech":
                            audio_inputs.extend(["-i", part["path"]])
                            sequence_filters.append(
                                f"[{input_index}:a]aresample=48000,"
                                "aformat=sample_fmts=fltp:sample_rates=48000:"
                                f"channel_layouts=stereo[{label}]"
                            )
                            input_index += 1
                        else:
                            duration_seconds = max(0.1, part["duration_ms"] / 1000.0)
                            sequence_filters.append(
                                f"anullsrc=r=48000:cl=stereo:d={duration_seconds:.3f}[{label}]"
                            )

                    if len(sequence_labels) == 1:
                        sequence_filters.append(f"{sequence_labels[0]}anull[voice]")
                    else:
                        sequence_filters.append(
                            f"{''.join(sequence_labels)}"
                            f"concat=n={len(sequence_labels)}:v=0:a=1[voice]"
                        )

                    if sfx_path:
                        audio_inputs.extend(["-i", sfx_path])
                        sfx_duration = await _probe_dur(sfx_path)
                        target_duration = max(target_duration, sfx_duration)
                        sequence_filters.append(
                            f"[{input_index}:a]aresample=48000,"
                            "aformat=sample_fmts=fltp:sample_rates=48000:"
                            "channel_layouts=stereo[sfx]"
                        )
                        sequence_filters.append(
                            "[voice][sfx]amix=inputs=2:duration=longest:"
                            "dropout_transition=0,apad[a]"
                        )
                    else:
                        sequence_filters.append("[voice]apad[a]")
                    audio_filter = ";".join(sequence_filters)
                else:
                    audio_inputs = []
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
                    f"[0:v]{vf},tpad=stop_mode=clone:stop_duration={target_duration}[v];{audio_filter}",
                    "-map",
                    "[v]",
                    "-map",
                    "[a]",
                    "-t",
                    str(target_duration),
                    *common,
                ]
            else:
                target_duration = video_duration or 5
                if video_has_audio:
                    cmd = [
                        "ffmpeg",
                        "-nostdin",
                        "-y",
                        "-loglevel",
                        "error",
                        "-i",
                        video_path,
                        "-filter_complex",
                        f"[0:v]{vf}[v];[0:a]apad[a]",
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
                        f"[0:v]{vf}[v]",
                        "-map",
                        "[v]",
                        "-map",
                        "1:a",
                        "-t",
                        str(target_duration),
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
        await _mix_global_audio_tracks(episode_id, out_path, duration, tmp)
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
            metadata={
                "source": "composed_final",
                "kind": "final_cut",
                "output_width": output_width,
                "output_height": output_height,
                "output_aspect": output_aspect,
            },
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
    audio_mode: str = "video_original",
) -> Dict[str, Any]:
    current = _jobs.get(episode_id)
    if current and current.get("status") == "running":
        return current

    normalized_audio_mode = (
        "reference_dubbing" if audio_mode == "reference_dubbing" else "video_original"
    )
    job: Dict[str, Any] = {
        "status": "running",
        "total": 0,
        "done": 0,
        "url": None,
        "error": None,
        "audio_mode": normalized_audio_mode,
    }
    _jobs[episode_id] = job

    async def _runner() -> None:
        try:
            await _compose(
                episode_id,
                user_id,
                project_id,
                job,
                selections,
                normalized_audio_mode,
            )
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = str(exc)[:300]
            logger.exception("compose failed episode=%s", episode_id)

    asyncio.create_task(_runner())
    return job


def get_status(episode_id: str) -> Dict[str, Any]:
    return _jobs.get(episode_id) or {"status": "idle", "total": 0, "done": 0, "url": None, "error": None}
