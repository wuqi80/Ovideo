import type { AudioTrack, StoryboardItemDB, VideoSegment } from '../types';

export interface EnhanceMediaClip {
  id: string;
  url: string;
  thumbnailUrl?: string;
  referenceImageUrl?: string;
  model?: string;
  comfyFilename?: string;
  sourceLabel?: string;
  startTime: number;
  duration: number;
  sourceOffset: number;
  type: 'video' | 'audio';
  settings?: { upscale: boolean; interpolate: boolean; lipSync: boolean };
}

type UrlResolver = (url: string) => string;

function itemId(item: StoryboardItemDB & Record<string, any>): string {
  return String(item.itemId ?? item.item_id ?? '');
}

function itemSort(item: StoryboardItemDB & Record<string, any>): number {
  const raw = item.sortOrder ?? item.sort_order;
  return typeof raw === 'number' ? raw : 0;
}

function itemDurationMs(item: StoryboardItemDB & Record<string, any>): number {
  const raw = item.audioDurationMs ?? item.audio_duration_ms ?? item.plannedDurationMs ?? item.planned_duration_ms;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

export function withEntityFileVideoFallbacks(
  videoSegments: VideoSegment[],
  fallbackVideoUrls: Record<string, string>,
): VideoSegment[] {
  return videoSegments.map(segment => {
    if (!segment.segmentId) return segment;
    const fallbackUrl = fallbackVideoUrls[segment.segmentId];
    return fallbackUrl ? { ...segment, videoUrl: fallbackUrl } : segment;
  });
}

export function buildEnhanceSourceClips(
  videoSegments: VideoSegment[],
  storyboardAudioItems: StoryboardItemDB[],
  audioTracks: AudioTrack[],
  secureMediaUrl: UrlResolver = url => url,
): EnhanceMediaClip[] {
  const allClips: EnhanceMediaClip[] = [];
  let videoTime = 0;

  const sortedSegs = [...videoSegments].sort((a, b) => a.sortOrder - b.sortOrder);
  const storyboardById = new Map(
    storyboardAudioItems.map(item => [itemId(item as StoryboardItemDB & Record<string, any>), item]),
  );
  for (let i = 0; i < sortedSegs.length; i++) {
    const seg = sortedSegs[i];
    const storyboard = seg.storyboardItemId ? storyboardById.get(seg.storyboardItemId) : undefined;
    const dur = (seg.durationMs || 5000) / 1000;
    const videoUrl = seg.videoUrl ? secureMediaUrl(seg.videoUrl) : '';
    if (videoUrl) {
      allClips.push({
        id: seg.segmentId || `vid_${i}`,
        url: videoUrl,
        thumbnailUrl: seg.thumbnailUrl ? secureMediaUrl(seg.thumbnailUrl) : undefined,
        referenceImageUrl: storyboard?.generatedImageUrl
          ? secureMediaUrl(storyboard.generatedImageUrl)
          : undefined,
        model: seg.model,
        startTime: videoTime,
        duration: dur,
        sourceOffset: 0,
        type: 'video',
        settings: { upscale: false, interpolate: false, lipSync: false },
      });
    }
    videoTime += dur;
  }

  const sortedItems = [...storyboardAudioItems].sort((a, b) =>
    itemSort(a as StoryboardItemDB & Record<string, any>) - itemSort(b as StoryboardItemDB & Record<string, any>)
  );
  const itemStartMs = new Map<string, number>();
  let audioTimelineMs = 0;
  for (const raw of sortedItems) {
    const item = raw as StoryboardItemDB & Record<string, any>;
    const id = itemId(item);
    if (id) itemStartMs.set(id, audioTimelineMs);
    audioTimelineMs += itemDurationMs(item);
  }

  for (const raw of sortedItems) {
    const item = raw as StoryboardItemDB & Record<string, any>;
    const id = itemId(item);
    if (!id) continue;
    const startTime = (itemStartMs.get(id) || 0) / 1000;
    const duration = itemDurationMs(item) / 1000;
    const mixedUrl = item.mixedAudioUrl ?? item.mixed_audio_url;
    if (mixedUrl) {
      allClips.push({
        id: `aud_sb_${id}_mixed`,
        url: secureMediaUrl(String(mixedUrl)),
        startTime,
        duration,
        sourceOffset: 0,
        type: 'audio',
        sourceLabel: '参考配音',
      });
      continue;
    }

    const audioParts = [
      ['dialogue', item.dialogueAudioUrl ?? item.dialogue_audio_url],
      ['narration', item.narrationAudioUrl ?? item.narration_audio_url],
      ['sfx', item.sfxAudioUrl ?? item.sfx_audio_url],
    ] as const;
    for (const [kind, url] of audioParts) {
      if (!url) continue;
      allClips.push({
        id: `aud_sb_${id}_${kind}`,
        url: secureMediaUrl(String(url)),
        startTime,
        duration,
        sourceOffset: 0,
        type: 'audio',
        sourceLabel: kind === 'dialogue' ? '参考对白' : kind === 'narration' ? '参考旁白' : '参考音效',
      });
    }
  }

  for (const track of audioTracks) {
    if (!track.audioUrl) continue;
    const startMs = track.startItemId ? itemStartMs.get(track.startItemId) ?? 0 : 0;
    const durationMs = track.durationMs || Math.max(audioTimelineMs, 3000);
    allClips.push({
      id: `aud_track_${track.trackId}`,
      url: secureMediaUrl(track.audioUrl),
      startTime: startMs / 1000,
      duration: durationMs / 1000,
      sourceOffset: 0,
      type: 'audio',
      sourceLabel: track.name || '音频轨道',
    });
  }

  return allClips;
}
