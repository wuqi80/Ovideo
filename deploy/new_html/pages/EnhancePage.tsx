import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Wand2, MonitorPlay, Zap, Mic2, Volume2, Film, Play, Pause,
  Scissors, Trash2, Music, ZoomIn, ZoomOut, GripHorizontal,
  Maximize, Loader, CheckCircle, Download,
} from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import type { VideoSegment, StoryboardItemDB } from '../types';
// 2026-05-20 (Task System Overhaul M4)：把 EnhancePage 的「假进度」改成真后端 worker。
// upscale 接到 videoService.submitUpscaleTaskQueued + videoTaskPoller，状态实时同步
// 到 taskRegistry，铃铛 / TaskBadge 都看得到。其它 enhancementKind（interpolate /
// dub / lipSync）后端目前没 worker，明确提示用户而非用假进度误导。
import * as videoService from '../services/videoService';
import { fetchComfyuiAvailable, startCompose, getComposeStatus, type ComposeStatus } from '../services/apiService';
import { getStoryboardItems } from '../services/episodeDataService';
import { startVideoPoll, attachVideoPollCallbacks, getKnownVideoTaskIds } from '../services/videoTaskPoller';

interface MediaClip {
  id: string;
  url: string;
  startTime: number;
  duration: number;
  sourceOffset: number;
  type: 'video' | 'audio';
  settings?: { upscale: boolean; interpolate: boolean; lipSync: boolean };
}

type EnhancementKind = 'dub' | 'upscale' | 'interpolate' | 'lipSync';

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
    generatedImageUrl: null,
    boundAssets: [],
    status: r.status ?? 'draft',
    dialogueAudioUrl: r.dialogue_audio_url ?? r.dialogueAudioUrl ?? null,
    narrationAudioUrl: r.narration_audio_url ?? r.narrationAudioUrl ?? null,
    sfxAudioUrl: r.sfx_audio_url ?? r.sfxAudioUrl ?? null,
    audioDurationMs: r.audio_duration_ms ?? r.audioDurationMs ?? null,
    plannedDurationMs: r.planned_duration_ms ?? r.plannedDurationMs ?? null,
  };
}

export const EnhancePage: React.FC = () => {
  const { videoSegments, isLoading, error, reload, loadSlices, projectId, episodeId, selectedScriptId } = useEpisode();
  const [storyboardAudioItems, setStoryboardAudioItems] = useState<StoryboardItemDB[]>([]);
  const [storyboardAudioReloadKey, setStoryboardAudioReloadKey] = useState(0);

  useEffect(() => {
    loadSlices('videoSegments');
  }, [loadSlices]);

  useEffect(() => {
    let active = true;
    if (!episodeId) {
      setStoryboardAudioItems([]);
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

  const [enhancementKind, setEnhancementKind] = useState<EnhancementKind>('upscale');
  const [targetResolution, setTargetResolution] = useState<'720p' | '1080p' | '4K'>('1080p');
  const [targetFps, setTargetFps] = useState<30 | 60 | 120>(60);
  const [dubVoiceStyle, setDubVoiceStyle] = useState<'neutral' | 'dramatic' | 'soft'>('neutral');
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  // GPU 类增强（放大/补帧/对口型）依赖 ComfyUI agent；无 agent 时禁用，避免点了必失败。
  // 默认 true 避免加载瞬间误禁；确认无 agent 后置 false。配音(dub)走外部 API，不受影响。
  const [comfyAvailable, setComfyAvailable] = useState<boolean>(true);
  useEffect(() => { fetchComfyuiAvailable().then(setComfyAvailable); }, []);

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
      const s = await startCompose(episodeId);
      setCompose({ ...s, status: (s.status as any) || 'running' });
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
      composeTimerRef.current = window.setTimeout(pollCompose, 3000);
    } catch (e: any) {
      setCompose({ status: 'failed', total: 0, done: 0, error: e?.message || '启动失败' });
    }
  }, [episodeId, pollCompose]);
  useEffect(() => () => { if (composeTimerRef.current) clearTimeout(composeTimerRef.current); }, []);
  // 进入页面时恢复正在进行/已完成的合成状态
  useEffect(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      if (s.status && s.status !== 'idle') {
        setCompose(s);
        if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 3000);
      }
    }).catch(() => {});
  }, [episodeId]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const playTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if ((videoSegments.length > 0 || storyboardAudioItems.length > 0) && clips.length === 0) {
      const allClips: MediaClip[] = [];
      let t = 0;

      const sortedSegs = [...videoSegments].sort((a, b) => a.sortOrder - b.sortOrder);
      for (let i = 0; i < sortedSegs.length; i++) {
        const seg = sortedSegs[i];
        const dur = (seg.durationMs || 5000) / 1000;
        allClips.push({
          id: seg.segmentId || `vid_${i}`,
          url: seg.videoUrl || '',
          startTime: t,
          duration: dur,
          sourceOffset: 0,
          type: 'video',
          settings: { upscale: false, interpolate: false, lipSync: false },
        });
        t += dur;
      }

      let audioTime = 0;
      const sortedItems = [...storyboardAudioItems]
        .sort((a, b) => ((a as any).sort_order ?? (a as any).sortOrder ?? 0) - ((b as any).sort_order ?? (b as any).sortOrder ?? 0));
      for (const item of sortedItems) {
        const audioUrl = (item as any).dialogue_audio_url ?? (item as any).dialogueAudioUrl;
        if (audioUrl) {
          const durMs = (item as any).audio_duration_ms ?? (item as any).audioDurationMs ?? 3000;
          const dur = durMs / 1000;
          allClips.push({
            id: `aud_sb_${(item as any).item_id ?? (item as any).itemId}`,
            url: audioUrl,
            startTime: audioTime,
            duration: dur,
            sourceOffset: 0,
            type: 'audio',
          });
          audioTime += dur;
        }
      }

      setClips(allClips);
      const firstVideo = allClips.find(c => c.type === 'video');
      if (firstVideo) setSelectedClipId(firstVideo.id);
    }
  }, [videoSegments, storyboardAudioItems]);

  useEffect(() => {
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, []);

  const videoClips = useMemo(() => clips.filter(c => c.type === 'video'), [clips]);
  const audioClips = useMemo(() => clips.filter(c => c.type === 'audio'), [clips]);
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const videoUnderPlayhead = videoClips.find(
    c => currentTime >= c.startTime && currentTime <= c.startTime + c.duration
  ) || videoClips[0];

  const totalDuration = useMemo(
    () => Math.max(...clips.map(c => c.startTime + c.duration), currentTime + 10, 60),
    [clips, currentTime]
  );

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

  const handleAudioUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.onloadedmetadata = () => {
        const newClip: MediaClip = {
          id: `aud_${Date.now()}`,
          url,
          startTime: currentTime,
          duration: audio.duration,
          sourceOffset: 0,
          type: 'audio',
        };
        setClips(prev => [...prev, newClip]);
        setSelectedClipId(newClip.id);
      };
    }
  }, [currentTime]);

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

  const handleDragStart = useCallback((e: React.MouseEvent, clip: MediaClip) => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    const startX = e.clientX;
    const initialStart = clip.startTime;
    const onMove = (me: MouseEvent) => {
      const delta = (me.clientX - startX) / scale;
      setClips(prev => prev.map(c => c.id === clip.id ? { ...c, startTime: Math.max(0, initialStart + delta) } : c));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [scale]);

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

  // 2026-05-20 (M4)：mount effect — 自动扫描 videoTaskPoller 已知的所有 polling 中
  // 以 `enhance-upscale:` 开头的（说明本页发起且未完成），把回调重接上来。
  // 这样用户切页 / 刷新后回到 EnhancePage 仍能看到 upscale 进度，并接到完成事件。
  useEffect(() => {
    const upscalePolls = getKnownVideoTaskIds().filter(uuid => uuid.startsWith('enhance-upscale:'));
    for (const uuid of upscalePolls) {
      attachVideoPollCallbacks(uuid, {
        onProgress: (progress) => {
          setProcessing(true);
          setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
        },
        onComplete: () => {
          setProcessProgress(100);
          window.setTimeout(() => { setProcessing(false); setProcessProgress(0); }, 800);
          reload();
        },
        onFail: (err) => {
          setProcessing(false);
          setProcessProgress(0);
          alert(`视频放大失败：${err}`);
        },
      });
      setProcessing(true);
    }
  }, [reload]);

  const applyEnhancement = useCallback(async () => {
    // GPU 类增强（放大/补帧/对口型）无 ComfyUI agent 时直接拦下，给清晰提示（双保险，
    // 按钮已禁用，这里防止意外触发）。
    if (enhancementKind !== 'dub' && !comfyAvailable) {
      alert('该功能需要 GPU 节点（ComfyUI agent），当前 Agent-Only 模式下无在线 agent，暂不可用。\n\n请连接 ComfyUI agent 后再用，或使用不依赖 GPU 的功能。');
      return;
    }
    // === interpolate / dub / lipSync：后端目前没 worker ===
    if (enhancementKind !== 'upscale') {
      const labelMap: Record<EnhancementKind, string> = {
        upscale: '高清放大',
        interpolate: '智能补帧',
        lipSync: '对口型',
        dub: '配音',
      };
      alert(`「${labelMap[enhancementKind]}」功能后端 worker 暂未启用。\n\n目前仅「高清放大」可用，请先切换到该选项再运行。`);
      return;
    }

    // === upscale：真后端任务 + taskRegistry ===
    const targetClip = videoUnderPlayhead || videoClips.find(c => c.id === selectedClipId) || videoClips[0];
    if (!targetClip || !targetClip.url) {
      alert('请先在时间线上选择一个视频片段。');
      return;
    }
    const filename = targetClip.url.split('/').pop()?.split('?')[0] || '';
    if (!filename) {
      alert('无法从视频 URL 解析文件名，无法发起放大任务。');
      return;
    }

    setProcessing(true);
    setProcessProgress(0);
    try {
      const result = await videoService.submitUpscaleTaskQueued(filename, {
        entity_type: 'video_segment',
        entity_id: targetClip.id,
        file_role: 'video',
        episode_id: episodeId || undefined,
      });
      const backendTaskId = result.task_id;
      const pollerUuid = `enhance-upscale:${targetClip.id}`;
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
          onProgress: (progress) => {
            setProcessing(true);
            setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
          },
          onComplete: () => {
            setProcessProgress(100);
            window.setTimeout(() => { setProcessing(false); setProcessProgress(0); }, 800);
            // 拉新数据让用户看到 upscaled 视频
            reload();
          },
          onFail: (err) => {
            setProcessing(false);
            setProcessProgress(0);
            alert(`视频放大失败：${err}`);
          },
        },
      });
    } catch (e: any) {
      setProcessing(false);
      setProcessProgress(0);
      alert(`提交放大任务失败：${e?.message || e}`);
    }
  }, [enhancementKind, videoUnderPlayhead, videoClips, selectedClipId, targetResolution, projectId, episodeId, reload, comfyAvailable]);

  return (
    <div className="layout-safe flex flex-col h-full bg-n20 text-n800 overflow-hidden">
      {/* Top section: preview + settings */}
      <div className="responsive-split flex-1 flex min-h-0 overflow-hidden">
        {/* Preview area */}
        <div className="responsive-pane flex-1 flex flex-col min-w-0">
          <div className="responsive-toolbar px-4 border-b border-n40 flex items-center justify-between bg-n0 backdrop-blur-sm shrink-0">
            <div className="toolbar-group">
              <Wand2 size={16} className="text-primary" />
              <h2 className="text-sm font-semibold">视频美化</h2>
            </div>
            <div className="toolbar-actions">
              <span className="text-xs font-mono text-n100">{formatTime(currentTime)}</span>
              <span className="text-[10px] text-n100">{videoClips.length}V · {audioClips.length}A</span>
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
                <span className="text-[10px] text-danger" title={compose.error || ''}>合成失败，点「合成成品」重试</span>
              )}
              <button
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg transition-colors"
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
                  src={videoUnderPlayhead.url}
                  controls={false}
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
        <div className="responsive-pane w-72 border-l border-n40 bg-n0 flex flex-col shrink-0">
          <div className="h-12 px-4 border-b border-n40 flex items-center shrink-0">
            <h2 className="text-sm font-semibold">片段美化选项</h2>
          </div>
          <div className="flex-1 p-4 space-y-4 overflow-y-auto">
            {selectedClip && selectedClip.type === 'video' ? (
              <>
                <div className="text-[11px] text-n100 truncate">
                  选中: {selectedClip.id.slice(0, 20)}{selectedClip.id.length > 20 ? '...' : ''}
                </div>
                <div className="space-y-2.5">
                  {ENHANCE_OPTIONS.map(opt => {
                    const settingsKey = opt.kind === 'dub' ? null
                      : opt.kind === 'lipSync' ? 'lipSync' as const
                      : opt.kind as 'upscale' | 'interpolate';
                    const checked = settingsKey ? (selectedClip.settings?.[settingsKey] ?? false) : false;
                    // GPU 类增强（有 settingsKey 的 放大/补帧/对口型）无 ComfyUI agent 时锁定
                    const gpuLocked = settingsKey !== null && !comfyAvailable;

                    return (
                      <label
                        key={opt.kind}
                        className={`flex items-center justify-between p-3 bg-n0 rounded-lg border border-n40 transition-all ${gpuLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary'}`}
                        title={gpuLocked ? '需 GPU 节点（ComfyUI agent），当前无在线 agent' : ''}
                      >
                        <div className="flex items-center gap-2.5">
                          <opt.Icon size={16} className="text-primary" />
                          <div>
                            <div className="text-sm font-medium">{opt.label}{gpuLocked && <span className="ml-1 text-[10px] text-amber-600">需 GPU</span>}</div>
                            <div className="text-[11px] text-n100">{opt.desc}</div>
                          </div>
                        </div>
                        {settingsKey ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={gpuLocked}
                            onChange={e => updateClipSettings({ [settingsKey]: e.target.checked })}
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

                <button
                  onClick={() => void applyEnhancement()}
                  disabled={processing || (enhancementKind !== 'dub' && !comfyAvailable)}
                  className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-sm transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <><Loader size={14} className="animate-spin" /> 处理中 {processProgress}%</>
                  ) : (
                    <><Wand2 size={14} /> 提交处理任务</>
                  )}
                </button>
                {enhancementKind !== 'dub' && !comfyAvailable && (
                  <div className="text-[11px] text-amber-600 text-center mt-1.5 leading-snug">
                    「{ENHANCE_OPTIONS.find(o => o.kind === enhancementKind)?.label}」需 GPU 节点（ComfyUI agent），
                    当前无在线 agent，暂不可用。
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-n100 text-center py-10">
                请在下方时间轴选择一个视频片段
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Timeline */}
      <div className="h-56 bg-n0 border-t border-n40 flex flex-col shrink-0 z-20">
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
              className="flex items-center gap-1 px-2 py-1.5 hover:bg-n20 rounded text-xs text-n300 hover:text-n700 transition-colors"
            >
              <Music size={12} /> 导入音频
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
            <div className="h-14 border-b border-n40 flex items-center justify-center text-[11px] text-n100 gap-1">
              <Music size={12} /> 音频
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
                    <div className="absolute inset-0 p-1 text-[9px] text-n700 font-mono z-10 truncate pointer-events-none">
                      {clip.id.slice(0, 12)}
                    </div>
                    <div className="absolute bottom-0.5 left-1 flex gap-0.5 z-10">
                      {clip.settings?.upscale && <MonitorPlay size={10} className="text-primary" />}
                      {clip.settings?.interpolate && <Zap size={10} className="text-warning" />}
                      {clip.settings?.lipSync && <Mic2 size={10} className="text-success" />}
                    </div>
                  </div>
                ))}
              </div>

              {/* Audio track */}
              <div className="h-14 border-b border-n40 relative bg-n0">
                {audioClips.map(clip => (
                  <div
                    key={clip.id}
                    onMouseDown={e => handleDragStart(e, clip)}
                    className={`absolute top-1.5 bottom-1.5 rounded border-2 overflow-hidden cursor-grab active:cursor-grabbing ${
                      selectedClipId === clip.id
                        ? 'border-primary z-20 bg-primary-light'
                        : 'border-primary z-10 hover:border-primary bg-primary-light'
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
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
