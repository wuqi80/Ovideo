import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Wand2, MonitorPlay, Zap, Mic2, Volume2, Film, Play, Pause,
  Scissors, Trash2, Music, ZoomIn, ZoomOut, GripHorizontal,
  Maximize, Loader, CheckCircle, Download, RefreshCw, Sparkles, AlignStartVertical,
} from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import type { VideoSegment, StoryboardItemDB, AudioTrack } from '../types';
// 2026-05-20 (Task System Overhaul M4)：把 EnhancePage 的「假进度」改成真后端 worker。
// All enhancement actions use real GPU tasks and report through videoTaskPoller.
import { submitInterpolateTaskQueued, submitUpscaleTaskQueued, submitVoiceTaskQueued } from '../services/videoTaskService';
import {
  DEFAULT_COMPOSE_AUDIO_MODE,
  startCompose,
  getComposeStatus,
  updateVideoSegment,
  type ComposeAudioMode,
  type ComposeStatus,
} from '../services/videoWorkflowService';
import { getStoryboardItems } from '../services/episodeDataService';
import { fetchEntityFiles, uploadEntityFile } from '../services/entityFileService';
import { uploadAudio } from '../services/videoMediaService';
import { startVideoPoll, attachVideoPollCallbacks, getKnownVideoTaskIds } from '../services/videoTaskPoller';
import { apiFetch, secureApiUrl } from '../services/httpClient';
import { syncTimelineAudioPlayback } from '../utils/enhanceTimelineAudio';
import { resolveAudioTrackTimeline, patchAudioTrackTimeline } from '../utils/audioTrackTimeline';
import { updateAudioTrack } from '../services/audioGenerationService';
import LazyVideo from '../components/LazyVideo';
import { MusicModal } from '../components/audio/MusicModal';
import { SfxModal } from '../components/audio/SfxModal';
import { withEntityFileVideoFallbacks } from '../utils/enhanceSourceClips';
import {
  clusterNodePreferenceId,
  DEFAULT_GPU_NODE_NAME,
  fetchClusterNodes,
  getPreferredGpuNodeId,
  isClusterNodeUsable,
  setPreferredGpuNodeId,
  type ClusterNodeOption,
} from '../services/clusterNodeService';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';
import { InlineCreditEstimate } from '../components/InlineCreditEstimate';

interface MediaClip {
  id: string;
  url: string;
  thumbnailUrl?: string;
  referenceImageUrl?: string;
  model?: string;
  comfyFilename?: string;
  sourceLabel?: string;
  audioKind?: 'voice' | 'bgm' | 'sfx';
  audioTrackId?: string;
  sourceDuration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  startTime: number;
  duration: number;
  sourceOffset: number;
  type: 'video' | 'audio';
  settings?: { upscale: boolean; interpolate: boolean; lipSync: boolean };
}

type EnhancementKind = 'dub' | 'upscale' | 'interpolate' | 'lipSync';

function secureMediaUrl(url: string): string {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return url;
  return secureApiUrl(url, { requireAuth: false });
}

const ENHANCE_OPTIONS: { kind: EnhancementKind; label: string; desc: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { kind: 'upscale', label: '高清放大', desc: '提升至 4K 画质', Icon: Maximize },
  { kind: 'interpolate', label: '智能补帧', desc: '提升至 60 FPS', Icon: Zap },
  { kind: 'lipSync', label: '对口型', desc: '与音频轨道对齐', Icon: Mic2 },
  { kind: 'dub', label: '配音', desc: '对白 / 旁白合成', Icon: Volume2 },
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function normalizeStoryboardAudioItem(r: any): StoryboardItemDB {
  return {
    itemId: r.item_id ?? r.itemId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    sceneHeading: '',
    actionText: '',
    dialogue: r.dialogue ?? '',
    cameraMovement: '',
    imagePrompt: '',
    videoPrompt: '',
    generatedImageUrl: r.generated_image_url ?? r.generatedImageUrl ?? null,
    boundAssets: [],
    status: r.status ?? 'draft',
    dialogueAudioUrl: r.dialogue_audio_url ?? r.dialogueAudioUrl ?? null,
    narrationAudioUrl: r.narration_audio_url ?? r.narrationAudioUrl ?? null,
    sfxAudioUrl: r.sfx_audio_url ?? r.sfxAudioUrl ?? null,
    mixedAudioUrl: r.mixed_audio_url ?? r.mixedAudioUrl ?? null,
    audioDurationMs: r.audio_duration_ms ?? r.audioDurationMs ?? null,
    plannedDurationMs: r.planned_duration_ms ?? r.plannedDurationMs ?? null,
  } as StoryboardItemDB;
}

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

export function buildEnhanceSourceClips(
  videoSegments: VideoSegment[],
  storyboardAudioItems: StoryboardItemDB[],
  audioTracks: AudioTrack[],
): MediaClip[] {
  const allClips: MediaClip[] = [];
  let videoTime = 0;

  const sortedSegs = [...videoSegments].sort((a, b) => a.sortOrder - b.sortOrder);
  const storyboardById = new Map(
    storyboardAudioItems.map(item => [itemId(item as StoryboardItemDB & Record<string, any>), item]),
  );
  const videoTimelineByStoryboardId = new Map<string, { startMs: number; durationMs: number }>();
  for (let i = 0; i < sortedSegs.length; i++) {
    const seg = sortedSegs[i];
    const storyboard = seg.storyboardItemId ? storyboardById.get(seg.storyboardItemId) : undefined;
    const dur = (seg.durationMs || 5000) / 1000;
    const videoUrl = seg.videoUrl ? secureMediaUrl(seg.videoUrl) : '';
    if (videoUrl) {
      if (seg.storyboardItemId) {
        videoTimelineByStoryboardId.set(seg.storyboardItemId, {
          startMs: Math.round(videoTime * 1000),
          durationMs: Math.round(dur * 1000),
        });
      }
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
  for (const raw of sortedItems) {
    const item = raw as StoryboardItemDB & Record<string, any>;
    const id = itemId(item);
    if (!id) continue;
    const videoAnchor = videoTimelineByStoryboardId.get(id);
    // 美化工作区只展示已有视频段；未生成视频的分镜音频不能沿用完整分镜
    // 累计时间，否则会在只有部分镜头时被错误推到时间线末端。
    if (!videoAnchor) continue;
    const startTime = videoAnchor.startMs / 1000;
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
        audioKind: 'voice',
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
        audioKind: kind === 'sfx' ? 'sfx' : 'voice',
      });
    }
  }

  for (const track of audioTracks) {
    if (!track.audioUrl) continue;
    const episodeDurationMs = Math.max(100, Math.round(videoTime * 1000));
    const timeline = resolveAudioTrackTimeline(track, episodeDurationMs);
    const hasPersistedTimeline = Boolean(track.generationParams?.timeline && typeof track.generationParams.timeline === 'object');
    const anchoredStartMs = track.startItemId
      ? videoTimelineByStoryboardId.get(track.startItemId)?.startMs
      : undefined;
    const startMs = hasPersistedTimeline ? timeline.startMs : anchoredStartMs ?? timeline.startMs;
    const kind = track.trackType === 'bgm' ? 'bgm' : track.trackType === 'sfx_global' ? 'sfx' : 'voice';
    allClips.push({
      id: `aud_track_${track.trackId}`,
      url: secureMediaUrl(track.audioUrl),
      startTime: startMs / 1000,
      duration: timeline.durationMs / 1000,
      sourceOffset: timeline.sourceOffsetMs / 1000,
      type: 'audio',
      sourceLabel: track.name || '音频轨道',
      audioKind: kind,
      audioTrackId: track.trackId,
      sourceDuration: Math.max(0.1, (track.durationMs || timeline.durationMs) / 1000),
      volume: timeline.volume,
      fadeIn: timeline.fadeInMs / 1000,
      fadeOut: timeline.fadeOutMs / 1000,
    });
  }

  return allClips;
}

function mergeSourceClips(prev: MediaClip[], source: MediaClip[]): MediaClip[] {
  if (prev.length === 0) return source;
  const prevById = new Map(prev.map(clip => [clip.id, clip]));
  const sourceIds = new Set(source.map(clip => clip.id));
  const merged = source.map(clip => {
    const existing = prevById.get(clip.id);
    if (!existing) return clip;
    return {
      ...clip,
      startTime: existing.startTime,
      sourceOffset: existing.sourceOffset,
      settings: existing.settings ?? clip.settings,
    };
  });
  const manualClips = prev.filter(clip => !sourceIds.has(clip.id) && (/^aud_\d+/.test(clip.id) || clip.id.startsWith('aud_actor_') || clip.id.includes('_s_')));
  return [...merged, ...manualClips];
}

export const EnhancePage: React.FC = () => {
  const { videoSegments, audioTracks, isLoading, error, reload, loadSlices, projectId, episodeId, selectedScriptId } = useEpisode();
  const [storyboardAudioItems, setStoryboardAudioItems] = useState<StoryboardItemDB[]>([]);
  const [actorDubbingClips, setActorDubbingClips] = useState<MediaClip[]>([]);
  const [storyboardAudioLoaded, setStoryboardAudioLoaded] = useState(false);
  const [storyboardAudioReloadKey, setStoryboardAudioReloadKey] = useState(0);
  const [segmentVideoFallbacks, setSegmentVideoFallbacks] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSlices('videoSegments', 'audioTracks');
  }, [loadSlices]);

  useEffect(() => {
    let active = true;
    const segmentsWithId = videoSegments.filter(segment => segment.segmentId);
    if (segmentsWithId.length === 0) {
      setSegmentVideoFallbacks({});
      return () => { active = false; };
    }

    Promise.all(segmentsWithId.map(async segment => {
      try {
        const files = await fetchEntityFiles('video_segment', segment.segmentId, 'video');
        const latestVideo = files.items.find(file => file.isSelected && file.fileUrl)
          || files.items.find(file => file.fileUrl);
        return latestVideo?.fileUrl
          ? [segment.segmentId, latestVideo.fileUrl] as const
          : null;
      } catch (err) {
        console.warn('[EnhancePage] video fallback load failed:', segment.segmentId, err);
        return null;
      }
    })).then(entries => {
      if (!active) return;
      const next: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setSegmentVideoFallbacks(next);
    });

    return () => { active = false; };
  }, [videoSegments]);

  useEffect(() => {
    let active = true;
    setStoryboardAudioLoaded(false);
    if (!episodeId) {
      setStoryboardAudioItems([]);
      setStoryboardAudioLoaded(true);
      return () => { active = false; };
    }
    getStoryboardItems(episodeId, selectedScriptId || undefined, { fields: 'audio' })
      .then(res => {
        if (!active) return;
        setStoryboardAudioItems(res.success ? (res.items || []).map(normalizeStoryboardAudioItem) : []);
      })
      .catch(err => {
        console.warn('storyboard audio fields load failed:', err);
        if (active) setStoryboardAudioItems([]);
      })
      .finally(() => {
        if (active) setStoryboardAudioLoaded(true);
      });
    return () => { active = false; };
  }, [episodeId, selectedScriptId, storyboardAudioReloadKey]);

  const reloadEnhanceData = useCallback(() => {
    setStoryboardAudioReloadKey(key => key + 1);
    reload();
  }, [reload]);

  const [scale, setScale] = useState(20);
  const [currentTime, setCurrentTime] = useState(0);
  const [clips, setClips] = useState<MediaClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [showSfxModal, setShowSfxModal] = useState(false);

  const [enhancementKind, setEnhancementKind] = useState<EnhancementKind>('upscale');
  const [targetResolution, setTargetResolution] = useState<'720p' | '1080p' | '4K'>('1080p');
  const [targetFps, setTargetFps] = useState<30 | 60 | 120>(60);
  const [dubVoiceStyle, setDubVoiceStyle] = useState<'neutral' | 'dramatic' | 'soft'>('neutral');
  const [composeAudioMode, setComposeAudioMode] = useState<ComposeAudioMode>(DEFAULT_COMPOSE_AUDIO_MODE);
  const [lipSyncAudioClipId, setLipSyncAudioClipId] = useState<string>('');
  const [audioUploading, setAudioUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [processStage, setProcessStage] = useState('处理集群正在执行，可能需要数分钟');
  const [enhanceError, setEnhanceError] = useState('');
  const [enhanceNotice, setEnhanceNotice] = useState('');
  // All enhancement modes are dispatched through a selected GPU Agent.
  const [clusterNodes, setClusterNodes] = useState<ClusterNodeOption[]>([]);
  const [clusterNodesLoading, setClusterNodesLoading] = useState(false);
  const [clusterNodeMessage, setClusterNodeMessage] = useState('');
  const [selectedClusterNodeId, setSelectedClusterNodeId] = useState(getPreferredGpuNodeId);
  const selectedClusterNode = useMemo(() => {
    const selectedKey = selectedClusterNodeId.trim().toLowerCase();
    return clusterNodes.find(node => (
      [node.id, node.nodeId, node.agentId, node.name, node.routingName]
        .filter(Boolean)
        .some(value => String(value).trim().toLowerCase() === selectedKey)
    ));
  }, [clusterNodes, selectedClusterNodeId]);
  const selectedClusterNodeUsable = Boolean(selectedClusterNode && isClusterNodeUsable(selectedClusterNode));
  const loadClusterNodes = useCallback(async () => {
    setClusterNodesLoading(true);
    try {
      const result = await fetchClusterNodes();
      setClusterNodes(result.nodes);
      setClusterNodeMessage(result.message);
      const usableNodes = result.nodes.filter(isClusterNodeUsable);
      const requested = getPreferredGpuNodeId().trim().toLowerCase();
      const requestedNode = result.nodes.find(node => (
        [node.id, node.nodeId, node.agentId, node.name, node.routingName]
          .filter(Boolean)
          .some(value => String(value).trim().toLowerCase() === requested)
      ));
      const fallback = usableNodes.find(node => (
        node.routingName === DEFAULT_GPU_NODE_NAME || node.name === DEFAULT_GPU_NODE_NAME
      )) || usableNodes[0];
      const nextNode = requestedNode || fallback;
      if (nextNode) {
        const stableId = clusterNodePreferenceId(nextNode);
        setSelectedClusterNodeId(stableId);
        setPreferredGpuNodeId(stableId);
      }
    } catch (error) {
      console.warn('[EnhancePage] cluster nodes unavailable:', error);
      setClusterNodes([]);
      setClusterNodeMessage('处理集群节点状态获取失败，请刷新重试。');
    } finally {
      setClusterNodesLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadClusterNodes();
  }, [loadClusterNodes]);

  // 一键合成成片：后台拼接本集视频段+配音 → 完整 mp4 存入成品页，前端轮询进度。
  const [compose, setCompose] = useState<ComposeStatus | null>(null);
  const composeTimerRef = useRef<number | null>(null);
  const pollCompose = useCallback(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      setCompose(s);
      if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 4000);
    }).catch(() => {});
  }, [episodeId]);
  const handleCompose = useCallback(async () => {
    if (!episodeId) { alert('未找到当前集'); return; }
    try {
      const s = await startCompose(episodeId, undefined, composeAudioMode);
      setCompose({ ...s, status: (s.status as any) || 'running' });
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
      composeTimerRef.current = window.setTimeout(pollCompose, 3000);
    } catch (e: any) {
      setCompose({ status: 'failed', total: 0, done: 0, error: e?.message || '启动失败' });
    }
  }, [episodeId, pollCompose, composeAudioMode]);
  useEffect(() => () => { if (composeTimerRef.current) clearTimeout(composeTimerRef.current); }, []);
  // 进入页面时恢复正在进行/已完成的合成状态
  useEffect(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      if (s.status && s.status !== 'idle') {
        setCompose(s);
        // A completed legacy job must not override the safer default for the next compose.
        // While a job is running, show the mode that job is actually using.
        if (s.status === 'running' && s.audio_mode) setComposeAudioMode(s.audio_mode);
        if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 3000);
      }
    }).catch(() => {});
  }, [episodeId]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioElementRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playTimerRef = useRef<number | null>(null);
  const clipScopeRef = useRef('');

  useEffect(() => {
    let active = true;
    const sortedSegments = [...videoSegments].sort((a, b) => a.sortOrder - b.sortOrder);
    if (sortedSegments.length === 0) {
      setActorDubbingClips([]);
      return () => { active = false; };
    }

    const starts = new Map<string, number>();
    let cursor = 0;
    for (const segment of sortedSegments) {
      starts.set(segment.segmentId, cursor);
      cursor += (segment.durationMs || 5000) / 1000;
    }

    Promise.all(sortedSegments.map(async segment => {
      const files = await fetchEntityFiles('video_segment', segment.segmentId, 'actor_dubbing');
      return files.items.map(file => ({
        id: `aud_actor_${file.fileId}`,
        url: secureMediaUrl(file.fileUrl),
        startTime: starts.get(segment.segmentId) || 0,
        duration: (segment.durationMs || 5000) / 1000,
        sourceOffset: 0,
        type: 'audio' as const,
        sourceLabel: '演员录音',
        audioKind: 'voice' as const,
        volume: 1,
      }));
    }))
      .then(groups => {
        if (active) setActorDubbingClips(groups.flat());
      })
      .catch(() => {
        if (active) setActorDubbingClips([]);
      });

    return () => { active = false; };
  }, [videoSegments]);

  const enhanceVideoSegments = useMemo(
    () => withEntityFileVideoFallbacks(videoSegments, segmentVideoFallbacks),
    [videoSegments, segmentVideoFallbacks],
  );

  useEffect(() => {
    if (!storyboardAudioLoaded) return;
    const sourceClips = [
      ...buildEnhanceSourceClips(enhanceVideoSegments, storyboardAudioItems, audioTracks),
      ...actorDubbingClips,
    ];
    if (sourceClips.length === 0) return;
    setClips(prev => mergeSourceClips(prev, sourceClips));
    setSelectedClipId(prev => {
      if (prev && sourceClips.some(c => c.id === prev)) return prev;
      return sourceClips.find(c => c.type === 'video')?.id ?? sourceClips[0]?.id ?? null;
    });
  }, [enhanceVideoSegments, storyboardAudioItems, audioTracks, actorDubbingClips, storyboardAudioLoaded]);

  useEffect(() => {
    const scope = episodeId || '';
    if (clipScopeRef.current && clipScopeRef.current !== scope) {
      setClips([]);
      setSelectedClipId(null);
      setCurrentTime(0);
      setPlaying(false);
    }
    clipScopeRef.current = scope;
  }, [episodeId]);

  useEffect(() => {
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, []);

  const videoClips = useMemo(() => clips.filter(c => c.type === 'video'), [clips]);
  const audioClips = useMemo(() => clips.filter(c => c.type === 'audio'), [clips]);
  const voiceClips = useMemo(() => audioClips.filter(c => (c.audioKind || 'voice') === 'voice'), [audioClips]);
  const bgmClips = useMemo(() => audioClips.filter(c => c.audioKind === 'bgm'), [audioClips]);
  const sfxClips = useMemo(() => audioClips.filter(c => c.audioKind === 'sfx'), [audioClips]);
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const videoUnderPlayhead = videoClips.find(
    c => currentTime >= c.startTime && currentTime <= c.startTime + c.duration
  ) || videoClips[0];

  useEffect(() => {
    if (lipSyncAudioClipId && audioClips.some(clip => clip.id === lipSyncAudioClipId)) return;
    const activeAudio = audioClips.find(
      clip => currentTime >= clip.startTime && currentTime <= clip.startTime + clip.duration,
    ) || audioClips[0];
    setLipSyncAudioClipId(activeAudio?.id || '');
  }, [audioClips, currentTime, lipSyncAudioClipId]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !videoUnderPlayhead?.url) return;
    const target = Math.max(0, currentTime - videoUnderPlayhead.startTime + videoUnderPlayhead.sourceOffset);
    if (!playing || Math.abs(video.currentTime - target) > 0.75) {
      try { video.currentTime = Math.min(target, Math.max(0, videoUnderPlayhead.duration - 0.05)); } catch {}
    }
    if (playing) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [playing, currentTime, videoUnderPlayhead?.id, videoUnderPlayhead?.url, videoUnderPlayhead?.startTime, videoUnderPlayhead?.duration, videoUnderPlayhead?.sourceOffset]);

  useEffect(() => {
    void syncTimelineAudioPlayback({
      clips: audioClips.map(clip => ({
        id: clip.id,
        startTime: clip.startTime,
        duration: clip.duration,
        sourceOffset: clip.sourceOffset,
        volume: clip.volume,
      })),
      audioElements: audioElementRefs.current,
      currentTime,
      playing: playing && composeAudioMode === 'reference_dubbing',
    }).catch(() => {});
  }, [audioClips, currentTime, playing, composeAudioMode]);

  const videoDuration = useMemo(
    () => Math.max(0, ...videoClips.map(c => c.startTime + c.duration)),
    [videoClips],
  );
  const totalDuration = useMemo(
    () => Math.max(10, videoDuration, ...clips.map(c => c.startTime + c.duration), currentTime + 1),
    [clips, currentTime, videoDuration]
  );
  const modalScript = useMemo(() => ({
    adaptedScript: storyboardAudioItems
      .slice()
      .sort((a, b) => itemSort(a as StoryboardItemDB & Record<string, any>) - itemSort(b as StoryboardItemDB & Record<string, any>))
      .map(item => item.dialogue || '')
      .filter(Boolean)
      .join('\n'),
  }), [storyboardAudioItems]);

  const togglePlay = useCallback(() => {
    if (playing) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      playTimerRef.current = null;
      setPlaying(false);
    } else {
      setPlaying(true);
      playTimerRef.current = window.setInterval(() => {
        setCurrentTime(prev => {
          const next = prev + 0.1;
          if (next >= totalDuration) {
            if (playTimerRef.current) clearInterval(playTimerRef.current);
            playTimerRef.current = null;
            setPlaying(false);
            return 0;
          }
          return next;
        });
      }, 100);
    }
  }, [playing, totalDuration]);

  const handleAudioUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setAudioUploading(true);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const audio = new Audio(previewUrl);
        audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 5);
        audio.onerror = () => reject(new Error('无法读取录音时长'));
      });
      const targetVideo = videoClips.find(clip => clip.id === selectedClipId) || videoUnderPlayhead || videoClips[0];
      const entityId = targetVideo?.id || episodeId || '';
      if (!entityId) throw new Error('请先选择一个视频片段');

      const [saved, uploaded] = await Promise.all([
        uploadEntityFile(
          file,
          targetVideo ? 'video_segment' : 'episode',
          entityId,
          'actor_dubbing',
          episodeId || undefined,
        ),
        uploadAudio(file, 0, Math.max(1, Math.ceil(duration))),
      ]);
      const newClip: MediaClip = {
        id: `aud_actor_${saved.fileId || Date.now()}`,
        url: secureMediaUrl(saved.fileUrl),
        startTime: targetVideo?.startTime ?? currentTime,
        duration,
        sourceOffset: 0,
        type: 'audio',
        comfyFilename: uploaded.filename,
        sourceLabel: '演员录音',
        audioKind: 'voice',
        volume: 1,
      };
      setClips(prev => [...prev, newClip]);
      setLipSyncAudioClipId(newClip.id);
      setEnhancementKind(current => current === 'dub' ? 'dub' : 'lipSync');
    } catch (uploadError: any) {
      alert(`上传演员录音失败：${uploadError?.message || uploadError}`);
    } finally {
      URL.revokeObjectURL(previewUrl);
      setAudioUploading(false);
    }
  }, [currentTime, episodeId, selectedClipId, videoClips, videoUnderPlayhead]);

  const ensureGpuAudioFilename = useCallback(async (clip: MediaClip): Promise<string> => {
    if (clip.comfyFilename) return clip.comfyFilename;
    const response = await apiFetch(clip.url, { credentials: 'include' }, {
      apiName: 'loadLipSyncAudio',
      requireAuth: false,
      includeContentType: false,
    });
    if (!response.ok) throw new Error(`无法读取所选音频（HTTP ${response.status}）`);
    const blob = await response.blob();
    const extension = blob.type.includes('wav') ? 'wav' : blob.type.includes('mpeg') ? 'mp3' : 'audio';
    const file = new File([blob], `lip-sync-${Date.now()}.${extension}`, {
      type: blob.type || 'audio/mpeg',
    });
    const uploaded = await uploadAudio(file, 0, Math.max(1, Math.ceil(clip.duration)));
    setClips(prev => prev.map(item => item.id === clip.id ? { ...item, comfyFilename: uploaded.filename } : item));
    return uploaded.filename;
  }, []);

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return;
    const clipIdx = clips.findIndex(c => c.id === selectedClipId);
    if (clipIdx === -1) return;
    const clip = clips[clipIdx];
    if (currentTime > clip.startTime && currentTime < clip.startTime + clip.duration) {
      const splitPoint = currentTime - clip.startTime;
      const c1 = { ...clip, duration: splitPoint };
      const c2 = {
        ...clip,
        id: `${clip.id}_s_${Date.now()}`,
        startTime: currentTime,
        sourceOffset: clip.sourceOffset + splitPoint,
        duration: clip.duration - splitPoint,
      };
      const next = [...clips];
      next.splice(clipIdx, 1, c1, c2);
      setClips(next);
      setSelectedClipId(c2.id);
    }
  }, [selectedClipId, clips, currentTime]);

  const handleDelete = useCallback(() => {
    if (!selectedClipId) return;
    setClips(prev => prev.filter(c => c.id !== selectedClipId));
    setSelectedClipId(null);
  }, [selectedClipId]);

  const persistAudioClip = useCallback(async (clip: MediaClip) => {
    if (!clip.audioTrackId) return;
    const track = audioTracks.find(item => item.trackId === clip.audioTrackId);
    if (!track) return;
    await updateAudioTrack(track.trackId, {
      generation_params: patchAudioTrackTimeline(track, {
        startMs: Math.round(clip.startTime * 1000),
        sourceOffsetMs: Math.round(clip.sourceOffset * 1000),
        durationMs: Math.round(clip.duration * 1000),
        fadeInMs: Math.round((clip.fadeIn || 0) * 1000),
        fadeOutMs: Math.round((clip.fadeOut || 0) * 1000),
        volume: clip.volume ?? (track.trackType === 'bgm' ? 0.35 : 1),
      }),
    });
  }, [audioTracks]);

  const updateSelectedAudioClip = useCallback((updates: Partial<MediaClip>, persist = false) => {
    if (!selectedClipId) return;
    const current = clips.find(clip => clip.id === selectedClipId && clip.type === 'audio');
    if (!current) return;
    const updated = { ...current, ...updates };
    setClips(prev => prev.map(clip => clip.id === selectedClipId ? updated : clip));
    if (persist) void persistAudioClip(updated).catch(error => {
      console.warn('[EnhancePage] audio timeline update failed:', error);
      alert(`保存音频剪辑位置失败：${error instanceof Error ? error.message : error}`);
    });
  }, [clips, persistAudioClip, selectedClipId]);

  const alignSelectedAudioToVideo = useCallback(() => {
    if (!selectedClip || selectedClip.type !== 'audio') return;
    const target = videoClips.find(clip => (
      currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration
    )) || videoClips.find(clip => Math.abs(clip.startTime - selectedClip.startTime) < 0.5) || videoClips[0];
    if (!target) return;
    const duration = Math.min(selectedClip.sourceDuration || selectedClip.duration, target.duration);
    updateSelectedAudioClip({ startTime: target.startTime, sourceOffset: 0, duration }, true);
  }, [currentTime, selectedClip, updateSelectedAudioClip, videoClips]);

  const handleDragStart = useCallback((e: React.MouseEvent, clip: MediaClip) => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    const startX = e.clientX;
    const initialStart = clip.startTime;
    let finalStart = initialStart;
    const onMove = (me: MouseEvent) => {
      const delta = (me.clientX - startX) / scale;
      const rawStart = Math.max(0, initialStart + delta);
      const boundaries = videoClips.flatMap(item => [item.startTime, item.startTime + item.duration]);
      const nearby = boundaries.find(boundary => Math.abs(boundary - rawStart) <= 0.2);
      finalStart = nearby ?? Math.round(rawStart * 10) / 10;
      setClips(prev => prev.map(c => c.id === clip.id ? { ...c, startTime: finalStart } : c));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (clip.type === 'audio' && clip.audioTrackId) {
        void persistAudioClip({ ...clip, startTime: finalStart }).catch(error => {
          console.warn('[EnhancePage] audio drag persist failed:', error);
        });
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [persistAudioClip, scale, videoClips]);

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineContainerRef.current) return;
    const rect = timelineContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineContainerRef.current.scrollLeft;
    setCurrentTime(Math.max(0, x / scale));
  }, [scale]);

  const updateClipSettings = useCallback((updates: Partial<NonNullable<MediaClip['settings']>>) => {
    if (!selectedClipId) return;
    setClips(prev => prev.map(c =>
      c.id === selectedClipId && c.type === 'video'
        ? { ...c, settings: { ...c.settings!, ...updates } }
        : c
    ));
  }, [selectedClipId]);

  // 自动恢复本页发起且尚未完成的 GPU 美化任务，避免切页后丢失状态。
  useEffect(() => {
    const enhancePolls = getKnownVideoTaskIds().filter(uuid =>
      uuid.startsWith('enhance-upscale:')
        || uuid.startsWith('enhance-interpolate:')
        || uuid.startsWith('enhance-lipsync:')
        || uuid.startsWith('enhance-dub:'),
    );
    for (const uuid of enhancePolls) {
      const failureLabel = uuid.startsWith('enhance-interpolate:')
        ? '智能补帧'
        : uuid.startsWith('enhance-upscale:')
          ? '视频放大'
          : uuid.startsWith('enhance-dub:')
            ? '视频配音'
            : '配音对嘴';
      attachVideoPollCallbacks(uuid, {
        onProgress: (progress, status) => {
          setProcessing(true);
          setProcessStage(status === 'queued' ? '排队中' : '处理集群正在执行，可能需要数分钟');
          setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
        },
        onComplete: () => {
          setProcessProgress(100);
          setEnhanceNotice(`${failureLabel}处理完成，结果已更新。`);
          window.setTimeout(() => { setProcessing(false); setProcessProgress(0); setProcessStage('处理中'); }, 800);
          reload();
        },
        onFail: (err) => {
          setProcessing(false);
          setProcessProgress(0);
          setProcessStage('处理中');
          setEnhanceError(`${failureLabel}失败：${err}`);
        },
      });
      setProcessing(true);
    }
  }, [reload]);

  const applyEnhancement = useCallback(async () => {
    setEnhanceError('');
    setEnhanceNotice('');
    // GPU enhancement actions require an online ComfyUI Agent.
    // 按钮已禁用，这里防止意外触发）。
    if (!selectedClusterNodeUsable) {
      setEnhanceError('该功能需要处理集群节点。当前没有可用节点，请刷新节点状态或稍后重试。');
      return;
    }
    const targetClip = videoClips.find(c => c.id === selectedClipId) || videoUnderPlayhead || videoClips[0];
    if (!targetClip || !targetClip.url) {
      setEnhanceError('请先在时间线上选择一个视频片段。');
      return;
    }

    if (enhancementKind === 'lipSync' || enhancementKind === 'dub') {
      const audioClip = audioClips.find(clip => clip.id === lipSyncAudioClipId);
      if (!audioClip) {
        setEnhanceError('请选择参考配音或上传配音演员录音。');
        return;
      }
      const referenceImage = targetClip.referenceImageUrl || targetClip.thumbnailUrl;
      if (!referenceImage) {
        setEnhanceError('当前视频片段缺少首帧图片，无法发起对嘴任务。请先为对应分镜生成图片。');
        return;
      }

      setProcessing(true);
      setProcessProgress(0);
      setProcessStage('正在提交');
      try {
        const audioFilename = await ensureGpuAudioFilename(audioClip);
        const isDub = enhancementKind === 'dub';
        const dubPrompt = {
          neutral: '保持人物身份、构图和自然表情，使用中性自然的表演让嘴型与最终音频同步',
          dramatic: '保持人物身份和构图，使用更有张力的表演让嘴型与最终音频同步',
          soft: '保持人物身份和构图，使用柔和克制的表演让嘴型与最终音频同步',
        }[dubVoiceStyle];
        const result = await submitVoiceTaskQueued(
          referenceImage,
          targetClip.url,
          audioFilename,
          isDub ? dubPrompt : '保持人物身份、情绪和表情，自然地让嘴型与最终对白音频同步',
          'Wan2',
          {
            entity_type: 'video_segment',
            entity_id: targetClip.id,
            file_role: 'video',
            project_id: projectId || undefined,
            episode_id: episodeId || undefined,
            preferred_agent_id: selectedClusterNode?.agentId,
            preferred_node_id: selectedClusterNode?.nodeId || selectedClusterNode?.id,
          },
          { duration: targetClip.duration },
        );
        const pollerUuid = `enhance-${isDub ? 'dub' : 'lipsync'}:${targetClip.id}`;
        setProcessStage('排队中');
        setEnhanceNotice(`${isDub ? '视频配音' : '配音对嘴'}任务已进入处理队列。`);
        startVideoPoll(pollerUuid, {
          taskId: result.task_id,
          title: `${isDub ? '视频配音' : '配音对嘴'} · ${audioClip.sourceLabel || '音频轨道'}`,
          kind: 'video-voice',
          targetPage: 'enhance',
          targetEntityType: 'video_segment',
          targetEntityId: targetClip.id,
          episodeId: episodeId || undefined,
          projectId: projectId || undefined,
          callbacks: {
            onProgress: (progress, status) => {
              setProcessing(true);
              setProcessStage(status === 'queued' ? '排队中' : '处理集群正在执行，可能需要数分钟');
              setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
            },
            onComplete: ({ status }) => {
              const outputUrl = status.result?.videos?.[0]?.url;
              if (outputUrl) {
                void updateVideoSegment(targetClip.id, {
                  video_url: outputUrl,
                  task_id: status.task_id,
                  status: 'completed',
                }).catch(() => {});
              }
              setProcessProgress(100);
              setEnhanceNotice(`${isDub ? '视频配音' : '配音对嘴'}处理完成，结果已更新。`);
              window.setTimeout(() => { setProcessing(false); setProcessProgress(0); setProcessStage('处理中'); }, 800);
              reloadEnhanceData();
            },
            onFail: (err) => {
              setProcessing(false);
              setProcessProgress(0);
              setProcessStage('处理中');
              setEnhanceError(`${isDub ? '视频配音' : '配音对嘴'}失败：${err}`);
            },
          },
        });
      } catch (error: any) {
        setProcessing(false);
        setProcessProgress(0);
        setProcessStage('处理中');
        setEnhanceError(`提交${enhancementKind === 'dub' ? '视频配音' : '配音对嘴'}任务失败：${error?.message || error}`);
      }
      return;
    }

    if (enhancementKind === 'interpolate') {
      setProcessing(true);
      setProcessProgress(0);
      setProcessStage('正在提交');
      try {
        const result = await submitInterpolateTaskQueued(targetClip.url, targetFps, {
          entity_type: 'video_segment',
          entity_id: targetClip.id,
          file_role: 'video',
          project_id: projectId || undefined,
          episode_id: episodeId || undefined,
          preferred_agent_id: selectedClusterNode?.agentId,
          preferred_node_id: selectedClusterNode?.nodeId || selectedClusterNode?.id,
        });
        const pollerUuid = `enhance-interpolate:${targetClip.id}`;
        setProcessStage('排队中');
        setEnhanceNotice('智能补帧任务已进入处理队列。');
        startVideoPoll(pollerUuid, {
          taskId: result.task_id,
          title: `智能补帧 · ${targetFps} FPS`,
          kind: 'video-enhance',
          targetPage: 'enhance',
          targetEntityType: 'video_segment',
          targetEntityId: targetClip.id,
          episodeId: episodeId || undefined,
          projectId: projectId || undefined,
          callbacks: {
            onProgress: (progress, status) => {
              setProcessing(true);
              setProcessStage(status === 'queued' ? '排队中' : '处理集群正在执行，可能需要数分钟');
              setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
            },
            onComplete: ({ status }) => {
              const outputUrl = status.result?.videos?.[0]?.url;
              if (outputUrl) {
                void updateVideoSegment(targetClip.id, {
                  video_url: outputUrl,
                  task_id: status.task_id,
                  status: 'completed',
                }).catch(() => {});
              }
              setProcessProgress(100);
              setEnhanceNotice('智能补帧处理完成，结果已更新。');
              window.setTimeout(() => { setProcessing(false); setProcessProgress(0); setProcessStage('处理中'); }, 800);
              reloadEnhanceData();
            },
            onFail: (err) => {
              setProcessing(false);
              setProcessProgress(0);
              setProcessStage('处理中');
              setEnhanceError(`智能补帧失败：${err}`);
            },
          },
        });
      } catch (error: any) {
        setProcessing(false);
        setProcessProgress(0);
        setProcessStage('处理中');
        setEnhanceError(`提交智能补帧任务失败：${error?.message || error}`);
      }
      return;
    }

    // === upscale：真后端任务 + taskRegistry ===
    const filename = targetClip.url;
    if (!filename) {
      setEnhanceError('无法从视频 URL 解析文件名，无法发起放大任务。');
      return;
    }

    setProcessing(true);
    setProcessProgress(0);
    setProcessStage('正在提交');
    try {
      const result = await submitUpscaleTaskQueued(filename, {
        entity_type: 'video_segment',
        entity_id: targetClip.id,
        file_role: 'video',
        project_id: projectId || undefined,
        episode_id: episodeId || undefined,
        resolution: targetResolution,
        preferred_agent_id: selectedClusterNode?.agentId,
        preferred_node_id: selectedClusterNode?.nodeId || selectedClusterNode?.id,
      });
      const backendTaskId = result.task_id;
      const pollerUuid = `enhance-upscale:${targetClip.id}`;
      setProcessStage('排队中');
      setEnhanceNotice('视频放大任务已进入处理队列。');
      startVideoPoll(pollerUuid, {
        taskId: backendTaskId,
        title: `视频放大 · ${targetResolution}`,
        kind: 'video-upscale',
        targetPage: 'enhance',
        targetEntityType: 'video_segment',
        targetEntityId: targetClip.id,
        episodeId: episodeId || undefined,
        projectId: projectId || undefined,
        callbacks: {
          onProgress: (progress, status) => {
            setProcessing(true);
            setProcessStage(status === 'queued' ? '排队中' : '处理集群正在执行，可能需要数分钟');
            setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
          },
          onComplete: () => {
            setProcessProgress(100);
            setEnhanceNotice('视频放大处理完成，结果已更新。');
            window.setTimeout(() => { setProcessing(false); setProcessProgress(0); setProcessStage('处理中'); }, 800);
            // 拉新数据让用户看到 upscaled 视频
            reload();
          },
          onFail: (err) => {
            setProcessing(false);
            setProcessProgress(0);
            setProcessStage('处理中');
            setEnhanceError(`视频放大失败：${err}`);
          },
        },
      });
    } catch (e: any) {
      setProcessing(false);
      setProcessProgress(0);
      setProcessStage('处理中');
      setEnhanceError(`提交放大任务失败：${e?.message || e}`);
    }
  }, [
    enhancementKind,
    videoUnderPlayhead,
    videoClips,
    selectedClipId,
    audioClips,
    lipSyncAudioClipId,
    dubVoiceStyle,
    targetResolution,
    targetFps,
    projectId,
    episodeId,
    reload,
    reloadEnhanceData,
    selectedClusterNode,
    selectedClusterNodeUsable,
    ensureGpuAudioFilename,
  ]);

  return (
    <div className="layout-safe workflow-stage-layout flex-col text-n800">
      {/* Top section: preview + settings */}
      <div className="responsive-split workflow-stage-layout lg:flex-row-reverse">
        {/* Preview area */}
        <div className="responsive-pane workflow-stage-canvas">
          <div className="responsive-toolbar workflow-stage-toolbar px-4 flex items-center justify-between">
            <div className="toolbar-group">
              <Wand2 size={16} className="text-primary" />
              <h2 className="text-sm font-semibold">视频美化</h2>
            </div>
            <div className="toolbar-actions">
              <span className="text-xs font-mono text-n100">{formatTime(currentTime)}</span>
              <span className="text-[10px] text-n100">{videoClips.length}V · {audioClips.length}A</span>
              <div className="inline-flex h-7 rounded border border-n40 overflow-hidden" aria-label="成片音频来源">
                <button
                  type="button"
                  onClick={() => setComposeAudioMode('video_original')}
                  className={`px-2 text-[11px] transition-colors ${composeAudioMode === 'video_original' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:text-n700'}`}
                  title="使用源视频音轨，并忽略时间线中的参考对白和旁白；仅当源视频没有音轨时才回退参考配音"
                >
                  视频原声
                </button>
                <button
                  type="button"
                  onClick={() => setComposeAudioMode('reference_dubbing')}
                  className={`px-2 text-[11px] border-l border-n40 transition-colors ${composeAudioMode === 'reference_dubbing' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:text-n700'}`}
                  title="使用分镜阶段生成的参考配音替换视频原声"
                >
                  参考配音
                </button>
              </div>
              {audioClips.length > 0 && composeAudioMode === 'video_original' && (
                <span className="text-[10px] text-amber-600" title="切换到参考配音后，时间线对白和旁白才会进入成品">
                  将忽略时间线配音
                </span>
              )}
              {isLoading && <Loader size={14} className="animate-spin text-primary" />}
              <button
                onClick={reloadEnhanceData}
                className="text-xs text-n100 hover:text-n700 transition-colors"
              >
                刷新
              </button>
              {/* 一键合成成片 */}
              {compose?.status === 'running' ? (
                <span className="flex items-center gap-1 px-2.5 py-1 bg-primary-light text-primary text-xs rounded-lg border border-primary/20">
                  <Loader size={12} className="animate-spin" />
                  合成中 {compose.done}/{compose.total || '…'}
                </span>
              ) : compose?.status === 'done' ? (
                <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-lg border border-emerald-200">
                  <CheckCircle size={12} /> 成片已生成（在「成品」页查看）
                  <button onClick={handleCompose} className="ml-1 underline opacity-70 hover:opacity-100">重新合成</button>
                </span>
              ) : (
                <button
                  className="flex items-center gap-1 px-2.5 py-1 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                  title="把本集所有视频段按分镜顺序拼接、对齐配音，合成一个完整成片（约数分钟，可离开页面）"
                  onClick={handleCompose}
                  disabled={!episodeId || videoClips.length === 0}
                >
                  <Film size={12} /> 合成成品
                </button>
              )}
              {compose?.status === 'failed' && (
                <span className="text-[10px] text-danger" title={sanitizeProcessingTerminology(compose.error || '')}>合成失败，点「合成成品」重试</span>
              )}
              <button
                className="flex items-center gap-1 px-2.5 py-1 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors"
                title="导出时间线配置"
                onClick={() => {
                  const data = JSON.stringify({ clips, scale, totalDuration }, null, 2);
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'timeline-export.json'; a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={12} /> 导出
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center bg-black/30 p-4">
            {error && (
              <div className="absolute top-14 left-4 right-4 z-10 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-danger text-xs">
                {error}
              </div>
            )}
            <div className="w-full max-w-3xl aspect-video bg-black rounded-md border border-n40 shadow-2xl overflow-hidden relative">
              {videoUnderPlayhead?.url ? (
                <video
                  ref={previewVideoRef}
                  src={videoUnderPlayhead.url}
                  preload="none"
                  controls={false}
                  muted={composeAudioMode === 'reference_dubbing'}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-n100 gap-2">
                  <Film size={40} strokeWidth={1.2} />
                  <span className="text-sm">
                    {clips.length === 0 ? '暂无视频片段，请先在「视频」中生成' : '当前时间点无视频'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right settings panel */}
        <div className="responsive-pane workflow-stage-sidebar w-72 lg:border-r lg:border-l-0 flex flex-col shrink-0">
          <div className="workflow-stage-toolbar px-4 flex items-center">
            <h2 className="text-sm font-semibold">片段美化选项</h2>
          </div>
          <div className="workflow-stage-scroll flex-1 p-4 space-y-4">
            {selectedClip && selectedClip.type === 'video' ? (
              <>
                <div className="text-[11px] text-n100 truncate">
                  选中: {selectedClip.id.slice(0, 20)}{selectedClip.id.length > 20 ? '...' : ''}
                </div>
                <div className="rounded border border-n40 bg-n10 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-n500">处理节点</span>
                    <button
                      type="button"
                      onClick={() => void loadClusterNodes()}
                      disabled={clusterNodesLoading || processing}
                      className="inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-50"
                      title="刷新处理节点状态"
                    >
                      <RefreshCw size={12} className={clusterNodesLoading ? 'animate-spin' : ''} />
                      刷新
                    </button>
                  </div>
                  <select
                    value={selectedClusterNodeId}
                    onChange={event => {
                      setSelectedClusterNodeId(event.target.value);
                      setPreferredGpuNodeId(event.target.value);
                    }}
                    disabled={clusterNodesLoading || processing || clusterNodes.length === 0}
                    className="w-full px-2.5 py-2 rounded bg-n0 border border-n40 text-xs text-n700 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-n20"
                  >
                    {clusterNodes.length === 0 && (
                      <option value={selectedClusterNodeId}>{selectedClusterNodeId} · offline</option>
                    )}
                    {clusterNodes.map(node => (
                      <option key={node.id} value={clusterNodePreferenceId(node)}>
                        {node.name} · {node.status}{node.tasks != null && node.maxConcurrent != null ? ` · ${node.tasks}/${node.maxConcurrent}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className={`text-[10px] leading-4 ${selectedClusterNodeUsable ? 'text-g400' : 'text-amber-600'}`}>
                    {selectedClusterNodeUsable
                      ? `${selectedClusterNode?.name} 可用；繁忙时任务自动排队。`
                      : `节点 ${selectedClusterNodeId} 当前不可用。`}
                    {clusterNodeMessage ? ` ${clusterNodeMessage}` : ''}
                  </p>
                </div>
                <div className="space-y-2.5">
                  {ENHANCE_OPTIONS.map(opt => {
                    const settingsKey = opt.kind === 'dub' ? null
                      : opt.kind === 'lipSync' ? 'lipSync' as const
                      : opt.kind as 'upscale' | 'interpolate';
                    const checked = settingsKey ? (selectedClip.settings?.[settingsKey] ?? false) : false;
                    // GPU 类增强（有 settingsKey 的 放大/补帧/对口型）无 ComfyUI GPU 集群节点时锁定
                    const gpuLocked = !selectedClusterNodeUsable;

                    return (
                      <label
                        key={opt.kind}
                        className={`flex items-center justify-between p-3 bg-n0 rounded-lg border border-n40 transition-all ${gpuLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary'}`}
                        title={gpuLocked ? '需要处理集群节点，当前无可用节点' : ''}
                      >
                        <div className="flex items-center gap-2.5">
                          <opt.Icon size={16} className="text-primary" />
                          <div>
                            <div className="text-sm font-medium">{opt.label}{gpuLocked && <span className="ml-1 text-[10px] text-amber-600">需要处理节点</span>}</div>
                            <div className="text-[11px] text-n100">{opt.desc}</div>
                          </div>
                        </div>
                        {settingsKey ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={gpuLocked}
                            onChange={e => {
                              updateClipSettings({ [settingsKey]: e.target.checked });
                              if (e.target.checked) setEnhancementKind(opt.kind);
                            }}
                            className="rounded bg-n0 border-n40 text-primary w-4 h-4 disabled:cursor-not-allowed"
                          />
                        ) : (
                          <button
                            onClick={(e) => { e.preventDefault(); setEnhancementKind('dub'); }}
                            className={`text-xs px-2 py-1 rounded ${enhancementKind === 'dub' ? 'bg-primary-light text-primary' : 'bg-n0 text-n300'}`}
                          >
                            设置
                          </button>
                        )}
                      </label>
                    );
                  })}
                </div>

                {enhancementKind === 'upscale' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-n100">目标分辨率</span>
                    <select value={targetResolution} onChange={e => setTargetResolution(e.target.value as any)}
                      className="px-3 py-2 rounded-lg bg-n0 border border-n40 text-n700 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                      <option value="4K">4K</option>
                    </select>
                  </label>
                )}
                {enhancementKind === 'interpolate' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-n100">目标帧率</span>
                    <select value={targetFps} onChange={e => setTargetFps(Number(e.target.value) as any)}
                      className="px-3 py-2 rounded-lg bg-n0 border border-n40 text-n700 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                      <option value={120}>120 FPS</option>
                    </select>
                  </label>
                )}
                {enhancementKind === 'dub' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-n100">配音风格</span>
                    <select value={dubVoiceStyle} onChange={e => setDubVoiceStyle(e.target.value as any)}
                      className="px-3 py-2 rounded-lg bg-n0 border border-n40 text-n700 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="neutral">自然 / 中性</option>
                      <option value="dramatic">戏剧 / 张力</option>
                      <option value="soft">柔和 / 叙述</option>
                    </select>
                  </label>
                )}
                {(enhancementKind === 'lipSync' || enhancementKind === 'dub') && (
                  <div className="space-y-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs text-n100">
                        {enhancementKind === 'dub' ? '配音音轨' : '最终对白音频'}
                      </span>
                      <select
                        value={lipSyncAudioClipId}
                        onChange={e => setLipSyncAudioClipId(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-n0 border border-n40 text-n700 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">请选择音频</option>
                        {audioClips.map(clip => (
                          <option key={clip.id} value={clip.id}>
                            {clip.sourceLabel || '音频轨道'} · {clip.duration.toFixed(1)}s
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={audioUploading}
                      className="w-full h-9 rounded border border-n40 bg-n0 text-xs text-n500 hover:border-primary hover:text-primary disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {audioUploading ? <Loader size={13} className="animate-spin" /> : <Mic2 size={13} />}
                      {audioUploading ? '正在上传录音' : '上传配音演员录音'}
                    </button>
                    <p className="text-[11px] leading-4 text-n100">
                      {enhancementKind === 'dub'
                        ? '选择现有音轨或上传录音，处理集群将生成带该配音且嘴型同步的新视频。'
                        : '演员录音作为最终对白，提交后由处理集群让当前镜头嘴型匹配该音频。'}
                    </p>
                  </div>
                )}

                <InlineCreditEstimate
                  featureKey="video_enhancement"
                  params={{
                    operation: enhancementKind,
                    target_fps: targetFps,
                    resolution: targetResolution,
                  }}
                  fallbackCost={5}
                  className="mb-2 justify-center"
                />
                {enhanceError && (
                  <div role="alert" className="mb-2 rounded-lg border border-danger/20 bg-danger-light px-3 py-2 text-xs leading-5 text-danger">
                    {enhanceError}
                  </div>
                )}
                {enhanceNotice && !enhanceError && (
                  <div role="status" aria-live="polite" className="mb-2 rounded-lg border border-success/20 bg-success-light px-3 py-2 text-xs leading-5 text-success">
                    {enhanceNotice}
                  </div>
                )}
                <button
                  onClick={() => void applyEnhancement()}
                  disabled={processing || !selectedClusterNodeUsable || ((enhancementKind === 'lipSync' || enhancementKind === 'dub') && !lipSyncAudioClipId)}
                  className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-sm transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <><Loader size={14} className="animate-spin" /> {processStage}{processProgress > 0 ? ` ${processProgress}%` : ''}</>
                  ) : (
                    <><Wand2 size={14} /> 提交处理任务</>
                  )}
                </button>
                {!selectedClusterNodeUsable && (
                  <div className="text-[11px] text-amber-600 text-center mt-1.5 leading-snug">
                    「{ENHANCE_OPTIONS.find(o => o.kind === enhancementKind)?.label}」需要处理集群节点，
                    当前无可用节点，暂不可用。
                  </div>
                )}
              </>
            ) : selectedClip?.type === 'audio' ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Music size={15} className="text-primary" />
                    <h3 className="text-sm font-semibold text-n800">音频剪辑</h3>
                  </div>
                  <p className="truncate text-[11px] text-n100">{selectedClip.sourceLabel || '音频轨道'}</p>
                </div>

                <div className="rounded-lg border border-n40 bg-n0 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">开始时间（秒）</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={selectedClip.startTime.toFixed(1)}
                        onChange={event => updateSelectedAudioClip({ startTime: Math.max(0, Number(event.target.value) || 0) })}
                        onBlur={() => void persistAudioClip(selectedClip)}
                        className="w-full rounded border border-n40 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">使用时长（秒）</span>
                      <input
                        type="number"
                        min={0.1}
                        max={selectedClip.sourceDuration || undefined}
                        step={0.1}
                        value={selectedClip.duration.toFixed(1)}
                        onChange={event => updateSelectedAudioClip({
                          duration: Math.max(0.1, Math.min(selectedClip.sourceDuration || Number.POSITIVE_INFINITY, Number(event.target.value) || 0.1)),
                        })}
                        onBlur={() => void persistAudioClip(selectedClip)}
                        className="w-full rounded border border-n40 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1">
                    <span className="flex justify-between text-[11px] text-n300">
                      <span>音量</span><span>{Math.round((selectedClip.volume ?? 1) * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={Math.min(1, selectedClip.volume ?? 1)}
                      onChange={event => updateSelectedAudioClip({ volume: Number(event.target.value) })}
                      onPointerUp={() => void persistAudioClip(selectedClip)}
                      className="w-full accent-primary"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={alignSelectedAudioToVideo}
                    disabled={videoClips.length === 0}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-primary/30 bg-primary-light text-xs font-medium text-primary disabled:opacity-50"
                  >
                    <AlignStartVertical size={13} /> 对齐当前视频片段
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedAudioClip({ startTime: currentTime }, true)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-n40 bg-n0 text-xs text-n500 hover:border-primary hover:text-primary"
                  >
                    <Play size={12} /> 移到播放头
                  </button>
                </div>
                <p className="text-[11px] leading-5 text-n100">
                  可直接拖动下方音频块；靠近视频起止点时会自动吸附。背景音乐和特效音的位置会保存并用于后续合成。
                </p>
              </div>
            ) : (
              <div className="text-sm text-n100 text-center py-10">
                请在下方时间轴选择一个视频片段
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Timeline */}
      <div className="h-72 bg-n0 border-t border-n40 flex flex-col shrink-0 z-20">
        <div className="hidden" aria-hidden="true">
          {audioClips.map(clip => (
            <audio
              key={clip.id}
              ref={(el) => {
                if (el) audioElementRefs.current.set(clip.id, el);
                else audioElementRefs.current.delete(clip.id);
              }}
              src={clip.url}
              preload="metadata"
            />
          ))}
        </div>
        {/* Toolbar */}
        <div className="responsive-toolbar px-4 py-1.5 border-b border-n40 flex justify-between items-center shrink-0 bg-n0">
          <div className="toolbar-group">
            <button
              onClick={togglePlay}
              className="p-1.5 hover:bg-n20 rounded text-n300 hover:text-n800 transition-colors"
              title={playing ? '暂停' : '播放'}
            >
              {playing ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
            </button>
            <div className="w-px h-4 bg-n40 mx-1" />
            <button
              onClick={handleSplit}
              disabled={!selectedClipId}
              className={`p-1.5 rounded transition-colors ${selectedClipId ? 'hover:bg-n20 text-n300 hover:text-n800' : 'text-n100 cursor-not-allowed'}`}
              title="在播放头处切分"
            >
              <Scissors size={14} />
            </button>
            <button
              onClick={handleDelete}
              disabled={!selectedClipId}
              className={`p-1.5 rounded transition-colors ${selectedClipId ? 'hover:bg-n20 text-n300 hover:text-danger' : 'text-n100 cursor-not-allowed'}`}
              title="删除选中片段"
            >
              <Trash2 size={14} />
            </button>
            <div className="w-px h-4 bg-n40 mx-1" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={audioUploading}
              className="flex items-center gap-1 px-2 py-1.5 hover:bg-n20 rounded text-xs text-n300 hover:text-n700 transition-colors disabled:opacity-50"
            >
              {audioUploading ? <Loader size={12} className="animate-spin" /> : <Mic2 size={12} />}
              {audioUploading ? '正在上传' : '加入配音'}
            </button>
            <button
              type="button"
              onClick={() => setShowMusicModal(true)}
              disabled={!episodeId}
              className="flex items-center gap-1 px-2 py-1.5 hover:bg-n20 rounded text-xs text-n300 hover:text-success transition-colors disabled:opacity-50"
            >
              <Music size={12} /> 背景音乐
            </button>
            <button
              type="button"
              onClick={() => setShowSfxModal(true)}
              disabled={!episodeId}
              className="flex items-center gap-1 px-2 py-1.5 hover:bg-n20 rounded text-xs text-n300 hover:text-primary transition-colors disabled:opacity-50"
            >
              <Sparkles size={12} /> 特效音
            </button>
            <input type="file" accept="audio/*" className="hidden" ref={fileInputRef} onChange={handleAudioUpload} />
          </div>

          <div className="toolbar-actions">
            <button
              onClick={() => setScale(Math.max(5, scale - 5))}
              className="p-1.5 hover:bg-n20 rounded text-n300 hover:text-n800 transition-colors"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-[11px] text-n100 font-mono w-12 text-center">{scale}px/s</span>
            <button
              onClick={() => setScale(Math.min(100, scale + 5))}
              className="p-1.5 hover:bg-n20 rounded text-n300 hover:text-n800 transition-colors"
            >
              <ZoomIn size={14} />
            </button>
          </div>
        </div>

        {/* Tracks */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Track headers */}
          <div className="w-16 shrink-0 border-r border-n40 bg-n0 flex flex-col z-10">
            <div className="h-5 border-b border-n40" />
            <div className="h-16 border-b border-n40 flex items-center justify-center text-[11px] text-n100 gap-1">
              <MonitorPlay size={12} /> 视频
            </div>
            <div className="h-10 border-b border-n40 flex items-center justify-center text-[11px] text-n100 gap-1">
              <Mic2 size={12} /> 配音
            </div>
            <div className="h-10 border-b border-n40 flex items-center justify-center text-[11px] text-n100 gap-1">
              <Music size={12} /> 音乐
            </div>
            <div className="h-10 border-b border-n40 flex items-center justify-center text-[11px] text-n100 gap-1">
              <Sparkles size={12} /> 音效
            </div>
          </div>

          {/* Track content */}
          <div className="flex-1 overflow-auto relative" ref={timelineContainerRef}>
            <div style={{ width: `${totalDuration * scale}px`, minWidth: '100%' }} className="relative h-full">
              {/* Ruler */}
              <div className="h-5 border-b border-n40 relative cursor-pointer" onClick={handleRulerClick}>
                {Array.from({ length: Math.ceil(totalDuration) }).map((_, i) => (
                  <div key={i} className="absolute top-0 bottom-0 border-l border-n40" style={{ left: `${i * scale}px` }}>
                    {i % 5 === 0 && (
                      <span className="absolute top-0.5 left-1 text-[9px] text-n100 select-none">{formatTime(i)}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500 z-50 pointer-events-none"
                style={{ left: `${currentTime * scale}px` }}
              >
                <div className="absolute top-0 -translate-x-1/2 w-2.5 h-2.5 bg-red-500 rounded-full" />
              </div>

              {/* Video track */}
              <div className="h-16 border-b border-n40 relative bg-n0">
                {videoClips.map(clip => (
                  <div
                    key={clip.id}
                    onMouseDown={e => handleDragStart(e, clip)}
                    className={`absolute top-1.5 bottom-1.5 rounded border-2 overflow-hidden cursor-grab active:cursor-grabbing transition-colors ${
                      selectedClipId === clip.id
                        ? 'border-primary z-20 bg-n0'
                        : 'border-n40 z-10 hover:border-primary bg-n0'
                    }`}
                    style={{ left: `${clip.startTime * scale}px`, width: `${clip.duration * scale}px` }}
                  >
                    <div className="absolute inset-0 bg-black">
                      {clip.thumbnailUrl ? (
                        <img
                          src={clip.thumbnailUrl}
                          alt="视频片段预览"
                          loading="lazy"
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      ) : clip.url ? (
                        <LazyVideo
                          src={clip.url}
                          aria-label="视频片段预览"
                          className="w-full h-full object-cover pointer-events-none"
                          preload="none"
                          playsInline
                          controls={false}
                          hoverPreview={false}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-n100 bg-n20">
                          <Film size={14} />
                        </div>
                      )}
                    </div>
                    <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                    <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                    <div className="absolute top-1 left-1 right-10 text-[9px] text-white font-mono z-10 truncate pointer-events-none drop-shadow">
                      {clip.id.slice(0, 12)}
                    </div>
                    <div className="absolute top-0.5 right-1 px-1 rounded bg-black/50 text-[9px] text-white/90 font-mono z-10 pointer-events-none">
                      {clip.duration.toFixed(1)}s
                    </div>
                    <div className="absolute bottom-0.5 left-1 flex gap-0.5 z-10">
                      {clip.settings?.upscale && <MonitorPlay size={10} className="text-primary" />}
                      {clip.settings?.interpolate && <Zap size={10} className="text-warning" />}
                      {clip.settings?.lipSync && <Mic2 size={10} className="text-success" />}
                    </div>
                  </div>
                ))}
              </div>

              {/* Audio tracks */}
              {[
                { key: 'voice', clips: voiceClips },
                { key: 'bgm', clips: bgmClips },
                { key: 'sfx', clips: sfxClips },
              ].map(group => (
              <div key={group.key} className="h-10 border-b border-n40 relative bg-n0">
                {group.clips.map(clip => (
                  <div
                    key={clip.id}
                    onMouseDown={e => handleDragStart(e, clip)}
                    className={`absolute top-1 bottom-1 rounded border overflow-hidden cursor-grab active:cursor-grabbing ${
                      selectedClipId === clip.id
                        ? 'border-primary z-20 bg-primary-light shadow-sm'
                        : group.key === 'bgm'
                          ? 'border-success/40 z-10 hover:border-success bg-success/10'
                          : group.key === 'sfx'
                            ? 'border-warning/40 z-10 hover:border-warning bg-warning/10'
                            : 'border-primary/40 z-10 hover:border-primary bg-primary-light'
                    }`}
                    style={{ left: `${clip.startTime * scale}px`, width: `${clip.duration * scale}px` }}
                  >
                    <GripHorizontal size={10} className="text-primary absolute left-1 top-1/2 -translate-y-1/2 opacity-50" />
                    <div className="w-full h-full flex items-center justify-center overflow-hidden opacity-60">
                      <svg className="w-full h-6 text-primary" preserveAspectRatio="none" viewBox="0 0 100 100">
                        <path d="M0,50 Q5,10 10,50 T20,50 T30,50 T40,50 T50,50 T60,50 T70,50 T80,50 T90,50 T100,50" stroke="currentColor" fill="none" strokeWidth="2" />
                      </svg>
                    </div>
                    <div className="absolute top-0.5 right-1 text-[9px] text-primary font-mono z-10 pointer-events-none">
                      {clip.duration.toFixed(1)}s
                    </div>
                    <div className="absolute bottom-0.5 left-4 right-1 text-[9px] text-primary z-10 truncate pointer-events-none">
                      {clip.sourceLabel || '音频轨道'}
                    </div>
                  </div>
                ))}
              </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {showMusicModal && episodeId && (
        <MusicModal
          episodeId={episodeId}
          projectId={projectId || undefined}
          script={modalScript}
          onClose={() => setShowMusicModal(false)}
          onCreated={async () => {
            reloadEnhanceData();
            setShowMusicModal(false);
          }}
        />
      )}
      {showSfxModal && episodeId && (
        <SfxModal
          episodeId={episodeId}
          projectId={projectId || undefined}
          script={modalScript}
          onClose={() => setShowSfxModal(false)}
          onCreated={async () => {
            reloadEnhanceData();
            setShowSfxModal(false);
          }}
        />
      )}
    </div>
  );
};
