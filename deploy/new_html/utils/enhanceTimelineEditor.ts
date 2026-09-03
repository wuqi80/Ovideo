import type { EnhanceMediaClip } from './enhanceSourceClips';

export const MIN_TIMELINE_CLIP_DURATION = 0.1;

export interface PersistedEnhanceTimelineItem {
  kind: 'video' | 'excluded_video';
  clipId?: string;
  sourceId: string;
  startMs?: number;
  durationMs?: number;
  sourceOffsetMs?: number;
  settings?: EnhanceMediaClip['settings'];
}

export interface ComposeTimelineItem {
  clip_id: string;
  segment_id: string;
  start_ms: number;
  duration_ms: number;
  source_offset_ms: number;
}

export interface SnapResult {
  time: number;
  guide: number | null;
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function cloneClip(clip: EnhanceMediaClip): EnhanceMediaClip {
  return {
    ...clip,
    settings: clip.settings ? { ...clip.settings } : undefined,
  };
}

export function cloneEnhanceClips(clips: EnhanceMediaClip[]): EnhanceMediaClip[] {
  return clips.map(cloneClip);
}

export function clipEnd(clip: EnhanceMediaClip): number {
  return clip.startTime + clip.duration;
}

export function layoutVideoClips(clips: EnhanceMediaClip[]): EnhanceMediaClip[] {
  const videos = clips
    .filter(clip => clip.type === 'video')
    .slice()
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  let cursor = 0;
  const positioned = new Map<string, EnhanceMediaClip>();
  for (const clip of videos) {
    const duration = Math.max(MIN_TIMELINE_CLIP_DURATION, finite(clip.duration, MIN_TIMELINE_CLIP_DURATION));
    positioned.set(clip.id, { ...clip, startTime: roundTime(cursor), duration: roundTime(duration) });
    cursor += duration;
  }
  return clips.map(clip => positioned.get(clip.id) || clip);
}

export function timelineSnapPoints(
  clips: EnhanceMediaClip[],
  excludeClipId?: string,
  playhead?: number,
): number[] {
  const points = new Set<number>([0]);
  if (Number.isFinite(playhead)) points.add(roundTime(Math.max(0, playhead || 0)));
  for (const clip of clips) {
    if (clip.id === excludeClipId) continue;
    points.add(roundTime(Math.max(0, clip.startTime)));
    points.add(roundTime(Math.max(0, clipEnd(clip))));
  }
  return [...points].sort((a, b) => a - b);
}

export function resolveTimelineSnap(
  rawTime: number,
  points: number[],
  thresholdSeconds: number,
): SnapResult {
  let guide: number | null = null;
  let closest = Math.max(0, finite(rawTime));
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const nextDistance = Math.abs(point - rawTime);
    if (nextDistance <= thresholdSeconds && nextDistance < distance) {
      distance = nextDistance;
      closest = point;
      guide = point;
    }
  }
  return { time: roundTime(Math.max(0, closest)), guide };
}

export function splitTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  splitTime: number,
  nextId: string,
): EnhanceMediaClip[] {
  const index = clips.findIndex(clip => clip.id === clipId);
  if (index < 0) return clips;
  const clip = clips[index];
  const relative = splitTime - clip.startTime;
  if (relative < MIN_TIMELINE_CLIP_DURATION || clip.duration - relative < MIN_TIMELINE_CLIP_DURATION) {
    return clips;
  }
  const left = { ...clip, duration: roundTime(relative) };
  const right = {
    ...clip,
    id: nextId,
    sourceId: clip.sourceId || clip.id,
    startTime: roundTime(splitTime),
    sourceOffset: roundTime(clip.sourceOffset + relative),
    duration: roundTime(clip.duration - relative),
  };
  const next = cloneEnhanceClips(clips);
  next.splice(index, 1, left, right);
  return clip.type === 'video' ? layoutVideoClips(next) : next;
}

export function deleteTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  ripple = true,
): EnhanceMediaClip[] {
  const target = clips.find(clip => clip.id === clipId);
  const next = clips.filter(clip => clip.id !== clipId);
  return target?.type === 'video' && ripple ? layoutVideoClips(next) : next;
}

export function duplicateTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  nextId: string,
): EnhanceMediaClip[] {
  const index = clips.findIndex(clip => clip.id === clipId);
  if (index < 0) return clips;
  const source = clips[index];
  const duplicate: EnhanceMediaClip = {
    ...cloneClip(source),
    id: nextId,
    sourceId: source.sourceId || source.id,
    startTime: roundTime(clipEnd(source)),
  };
  const next = cloneEnhanceClips(clips);
  next.splice(index + 1, 0, duplicate);
  return source.type === 'video' ? layoutVideoClips(next) : next;
}

export function moveTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  targetStart: number,
  options: { ripple?: boolean; snap?: boolean; playhead?: number; snapThreshold?: number } = {},
): { clips: EnhanceMediaClip[]; guide: number | null } {
  const target = clips.find(clip => clip.id === clipId);
  if (!target) return { clips, guide: null };
  const snapResult = options.snap === false
    ? { time: roundTime(Math.max(0, targetStart)), guide: null }
    : resolveTimelineSnap(
        targetStart,
        timelineSnapPoints(clips, clipId, options.playhead),
        options.snapThreshold ?? 0.2,
      );
  if (target.type !== 'video' || options.ripple === false) {
    return {
      clips: clips.map(clip => clip.id === clipId ? { ...clip, startTime: snapResult.time } : clip),
      guide: snapResult.guide,
    };
  }

  const videos = clips
    .filter(clip => clip.type === 'video' && clip.id !== clipId)
    .slice()
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  const insertIndex = videos.findIndex(clip => snapResult.time < clip.startTime + clip.duration / 2);
  videos.splice(insertIndex < 0 ? videos.length : insertIndex, 0, target);
  let cursor = 0;
  const positioned = new Map<string, EnhanceMediaClip>();
  for (const clip of videos) {
    positioned.set(clip.id, { ...clip, startTime: roundTime(cursor) });
    cursor += clip.duration;
  }
  return {
    clips: clips.map(clip => positioned.get(clip.id) || clip),
    guide: snapResult.guide,
  };
}

export function trimTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  side: 'left' | 'right',
  deltaSeconds: number,
  ripple = true,
): EnhanceMediaClip[] {
  const target = clips.find(clip => clip.id === clipId);
  if (!target) return clips;
  const sourceDuration = Math.max(target.sourceDuration || Number.POSITIVE_INFINITY, MIN_TIMELINE_CLIP_DURATION);
  let applied = finite(deltaSeconds);
  if (side === 'left') {
    const availableBefore = target.type === 'video' && ripple
      ? target.sourceOffset
      : Math.min(target.startTime, target.sourceOffset);
    applied = Math.max(-availableBefore, applied);
    applied = Math.min(target.duration - MIN_TIMELINE_CLIP_DURATION, applied);
  } else {
    const maxGrowth = sourceDuration - target.sourceOffset - target.duration;
    applied = Math.min(maxGrowth, applied);
    applied = Math.max(MIN_TIMELINE_CLIP_DURATION - target.duration, applied);
  }
  const next = clips.map(clip => {
    if (clip.id !== clipId) return clip;
    if (side === 'left') {
      return {
        ...clip,
        startTime: roundTime(clip.startTime + applied),
        sourceOffset: roundTime(clip.sourceOffset + applied),
        duration: roundTime(clip.duration - applied),
      };
    }
    return { ...clip, duration: roundTime(clip.duration + applied) };
  });
  return target.type === 'video' && ripple ? layoutVideoClips(next) : next;
}

export function serializeEnhanceTimeline(
  clips: EnhanceMediaClip[],
  knownVideoSourceIds: string[],
): PersistedEnhanceTimelineItem[] {
  const videoClips = clips.filter(clip => clip.type === 'video');
  const presentSources = new Set(videoClips.map(clip => clip.sourceId || clip.id));
  return [
    ...videoClips.map(clip => ({
      kind: 'video' as const,
      clipId: clip.id,
      sourceId: clip.sourceId || clip.id,
      startMs: Math.round(clip.startTime * 1000),
      durationMs: Math.round(clip.duration * 1000),
      sourceOffsetMs: Math.round(clip.sourceOffset * 1000),
      settings: clip.settings ? { ...clip.settings } : undefined,
    })),
    ...knownVideoSourceIds
      .filter(sourceId => !presentSources.has(sourceId))
      .map(sourceId => ({ kind: 'excluded_video' as const, sourceId })),
  ];
}

export function restoreEnhanceTimeline(
  sourceClips: EnhanceMediaClip[],
  items: PersistedEnhanceTimelineItem[],
): EnhanceMediaClip[] {
  const sourceVideos = sourceClips.filter(clip => clip.type === 'video');
  const sourceAudio = sourceClips.filter(clip => clip.type === 'audio');
  const sourceById = new Map(sourceVideos.map(clip => [clip.sourceId || clip.id, clip]));
  const excluded = new Set(items.filter(item => item.kind === 'excluded_video').map(item => item.sourceId));
  const restored: EnhanceMediaClip[] = [];
  const usedSources = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'video') continue;
    const source = sourceById.get(item.sourceId);
    if (!source) continue;
    usedSources.add(item.sourceId);
    restored.push({
      ...source,
      id: item.clipId || source.id,
      sourceId: item.sourceId,
      startTime: Math.max(0, finite(item.startMs) / 1000),
      duration: Math.max(MIN_TIMELINE_CLIP_DURATION, finite(item.durationMs, source.duration * 1000) / 1000),
      sourceOffset: Math.max(0, finite(item.sourceOffsetMs) / 1000),
      settings: item.settings ? { ...item.settings } : source.settings,
    });
  }
  let cursor = restored.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
  for (const source of sourceVideos) {
    const sourceId = source.sourceId || source.id;
    if (usedSources.has(sourceId) || excluded.has(sourceId)) continue;
    restored.push({ ...source, startTime: roundTime(cursor) });
    cursor += source.duration;
  }
  return [...layoutVideoClips(restored), ...sourceAudio];
}

export function composeTimelineItems(clips: EnhanceMediaClip[]): ComposeTimelineItem[] {
  return clips
    .filter(clip => clip.type === 'video')
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .map(clip => ({
      clip_id: clip.id,
      segment_id: clip.sourceId || clip.id,
      start_ms: Math.round(clip.startTime * 1000),
      duration_ms: Math.max(100, Math.round(clip.duration * 1000)),
      source_offset_ms: Math.max(0, Math.round(clip.sourceOffset * 1000)),
    }));
}

export function formatTimelineTime(seconds: number, fps = 30): string {
  const safe = Math.max(0, finite(seconds));
  const wholeSeconds = Math.floor(safe);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  const frames = Math.min(fps - 1, Math.floor((safe - wholeSeconds) * fps));
  return [hours, minutes, secs, frames].map(value => String(value).padStart(2, '0')).join(':');
}
