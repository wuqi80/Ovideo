import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Plus, Sparkles, Square, SkipBack, Wand2, Trash2 } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────
export interface TimelineClip {
  id: string;
  label: string;
  track: 'narration' | 'dialogue' | 'bgm' | 'sfx' | 'image';
  audioUrl?: string;
  imageUrl?: string;
  durationMs: number;
  startMs: number;
  color?: string;
}

export interface TimelineTrackProps {
  mode: 'audio-only' | 'combined';
  clips: TimelineClip[];
  totalDurationMs: number;
  onClipClick?: (clip: TimelineClip) => void;
  showPreview?: boolean;
  onAddBgm?: () => void;
  onGenerateBgm?: () => void;
  onAddSfx?: () => void;
  onGenerateSfx?: () => void;
  onDeleteClip?: (clip: TimelineClip) => void | Promise<void>;
}

// ─── Color Palette ─────────────────────────────────────────────────
const TRACK_COLORS: Record<string, string> = {
  narration: 'bg-amber-500/60',
  dialogue: 'bg-sky-500/60',
  bgm: 'bg-emerald-500/40',
  sfx: 'bg-blue-500/40',
  image: 'bg-violet-500/50',
};

const TRACK_LABELS: Record<string, string> = {
  narration: '旁白',
  dialogue: '台词',
  bgm: 'BGM',
  sfx: '音效',
  image: '分镜',
};

// ─── Helpers ───────────────────────────────────────────────────────
function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const sec = ms / 1000;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Component ─────────────────────────────────────────────────────
export const TimelineTrack: React.FC<TimelineTrackProps> = ({
  mode, clips, totalDurationMs, onClipClick, showPreview = false,
  onAddBgm, onGenerateBgm, onAddSfx, onGenerateSfx,
  onDeleteClip,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const rafRef = useRef<number>(0);
  const startTsRef = useRef(0);
  const pausedAtRef = useRef(0);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveTotal = totalDurationMs || 1;

  const tracks = useMemo(() => {
    const order = mode === 'combined'
      ? ['image', 'narration', 'dialogue', 'bgm', 'sfx']
      : ['narration', 'dialogue', 'bgm', 'sfx'];
    return order.filter(t => (
      clips.some(c => c.track === t)
      || (t === 'bgm' && Boolean(onAddBgm || onGenerateBgm))
      || (t === 'sfx' && Boolean(onAddSfx || onGenerateSfx))
    ));
  }, [clips, mode, onAddBgm, onAddSfx, onGenerateBgm, onGenerateSfx]);

  const renderTrackActions = (trackId: string) => {
    if (trackId !== 'bgm' && trackId !== 'sfx') return null;
    const onAdd = trackId === 'bgm' ? onAddBgm : onAddSfx;
    const onGenerate = trackId === 'bgm' ? onGenerateBgm : onGenerateSfx;
    return (
      <div className="flex items-center gap-1">
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-6 items-center gap-0.5 rounded border border-n40 bg-n0 px-1.5 text-[9px] font-semibold text-n700 hover:bg-n30"
            title={trackId === 'bgm' ? '添加本地 BGM' : '添加本地音效'}
          >
            <Plus size={10} /> 添加
          </button>
        )}
        {onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            className={`inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[9px] font-semibold text-white ${
              trackId === 'bgm' ? 'bg-success hover:bg-success' : 'bg-primary hover:bg-primary-hover'
            }`}
            title={trackId === 'bgm' ? 'AI 音乐制作' : 'AI 音效制作'}
          >
            {trackId === 'bgm' ? <Wand2 size={10} /> : <Sparkles size={10} />} AI 生成
          </button>
        )}
      </div>
    );
  };

  const clipsByTrack = useMemo(() => {
    const m = new Map<string, TimelineClip[]>();
    for (const c of clips) {
      const arr = m.get(c.track) || [];
      arr.push(c);
      m.set(c.track, arr);
    }
    return m;
  }, [clips]);

  // Playback loop
  const tick = useCallback(() => {
    const elapsed = Date.now() - startTsRef.current;
    const ms = pausedAtRef.current + elapsed;
    if (ms >= effectiveTotal) {
      setCurrentTimeMs(effectiveTotal);
      setIsPlaying(false);
      return;
    }
    setCurrentTimeMs(ms);
    rafRef.current = requestAnimationFrame(tick);
  }, [effectiveTotal]);

  const handlePlay = useCallback(() => {
    if (isPlaying) return;
    startTsRef.current = Date.now();
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);

    // Play audio clips that should be audible at current time
    clips.forEach(c => {
      if (!c.audioUrl) return;
      const el = audioRefs.current.get(c.id);
      if (!el) return;
      const relMs = pausedAtRef.current - c.startMs;
      if (relMs >= 0 && relMs < c.durationMs) {
        el.currentTime = relMs / 1000;
        el.play().catch(() => {});
      }
    });
  }, [isPlaying, tick, clips]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
    pausedAtRef.current = currentTimeMs;
    audioRefs.current.forEach(el => el.pause());
  }, [currentTimeMs]);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
    pausedAtRef.current = 0;
    setCurrentTimeMs(0);
    audioRefs.current.forEach(el => { el.pause(); el.currentTime = 0; });
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ms = pct * effectiveTotal;
    pausedAtRef.current = ms;
    setCurrentTimeMs(ms);
    if (isPlaying) {
      startTsRef.current = Date.now();
    }
  }, [effectiveTotal, isPlaying]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Start/stop audio clips as playhead passes over them
  useEffect(() => {
    if (!isPlaying) return;
    clips.forEach(c => {
      if (!c.audioUrl) return;
      const el = audioRefs.current.get(c.id);
      if (!el) return;
      const inRange = currentTimeMs >= c.startMs && currentTimeMs < c.startMs + c.durationMs;
      if (inRange && el.paused) {
        el.currentTime = (currentTimeMs - c.startMs) / 1000;
        el.play().catch(() => {});
      } else if (!inRange && !el.paused) {
        el.pause();
      }
    });
  }, [isPlaying, currentTimeMs, clips]);

  const playheadPct = (currentTimeMs / effectiveTotal) * 100;

  const currentImageClip = useMemo(() => {
    if (!showPreview) return null;
    return clips.find(c =>
      c.track === 'image' &&
      currentTimeMs >= c.startMs &&
      currentTimeMs < c.startMs + c.durationMs
    ) || clips.find(c => c.track === 'image') || null;
  }, [showPreview, clips, currentTimeMs]);

  return (
    <div className="bg-n0 rounded-md border border-n40 p-4 shadow-card">
      <div className={showPreview ? 'flex gap-4' : ''}>
        {showPreview && (
          <div className="shrink-0 w-[200px]">
            <div className="w-[200px] h-[120px] bg-black rounded-lg overflow-hidden border border-n40 flex items-center justify-center">
              {currentImageClip?.imageUrl ? (
                <img
                  src={currentImageClip.imageUrl}
                  alt={currentImageClip.label}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-n100 text-xs">无画面</span>
              )}
            </div>
            <p className="text-[10px] text-n100 mt-1 truncate text-center">
              {currentImageClip?.label || '—'}
            </p>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {/* Controls */}
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={handleStop}
              className="w-8 h-8 rounded-lg bg-n0 hover:bg-n20 flex items-center justify-center text-n300 transition-colors"
            >
              <SkipBack size={14} />
            </button>
            <button
              onClick={isPlaying ? handlePause : handlePlay}
              className="w-10 h-10 rounded-lg bg-primary hover:bg-primary-hover flex items-center justify-center text-white transition-colors"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={handleStop}
              className="w-8 h-8 rounded-lg bg-n0 hover:bg-n20 flex items-center justify-center text-n300 transition-colors"
            >
              <Square size={14} />
            </button>
            <span className="text-sm text-n300 tabular-nums ml-2">
              {fmtTime(currentTimeMs)} / {fmtTime(effectiveTotal)}
            </span>
          </div>

          {/* Tracks */}
          <div className="flex min-w-[640px] select-none">
            <div className="w-48 shrink-0 pr-2">
              <div className="h-5 mb-1 border-b border-n40" />
              {tracks.map(trackId => (
                <div key={`label-${trackId}`} className="mb-1 flex h-10 items-center justify-between gap-1 text-[9px] text-n100">
                  <span className="font-medium">{TRACK_LABELS[trackId] || trackId}</span>
                  {renderTrackActions(trackId)}
                </div>
              ))}
            </div>
            <div
              ref={containerRef}
              className="relative min-w-0 flex-1 cursor-pointer"
              onClick={handleSeek}
            >
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
                style={{ left: `${playheadPct}%` }}
              >
                <div className="w-2.5 h-2.5 bg-red-500 rounded-full -ml-1 -mt-1" />
              </div>

              {/* Time ruler */}
              <div className="h-5 relative mb-1 border-b border-n40">
                {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                  <span
                    key={pct}
                    className="absolute text-[9px] text-n100 -translate-x-1/2"
                    style={{ left: `${pct * 100}%` }}
                  >
                    {fmtTime(pct * effectiveTotal)}
                  </span>
                ))}
              </div>

              {/* Track rows */}
              {tracks.map(trackId => {
                const trackClips = clipsByTrack.get(trackId) || [];
                return (
                  <div key={trackId} className="mb-1 h-10 rounded bg-n30 relative overflow-hidden">
                    {trackClips.map(clip => {
                      const leftPct = (clip.startMs / effectiveTotal) * 100;
                      const widthPct = (clip.durationMs / effectiveTotal) * 100;
                      const colorClass = clip.color || TRACK_COLORS[clip.track] || 'bg-gray-600';
                      const canDelete = Boolean(onDeleteClip && (clip.track === 'bgm' || clip.track === 'sfx'));

                      return (
                        <div
                          key={clip.id}
                          className={`group absolute top-0.5 bottom-0.5 rounded ${colorClass} flex items-center overflow-hidden cursor-pointer hover:brightness-110 transition-all`}
                          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                          onClick={e => { e.stopPropagation(); onClipClick?.(clip); }}
                          title={`${clip.label} (${fmtTime(clip.durationMs)})`}
                        >
                          {clip.track === 'image' && clip.imageUrl ? (
                            <img src={clip.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <span className={`text-[8px] text-white/70 truncate px-1 ${canDelete ? 'pr-5' : ''}`}>{clip.label}</span>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                void onDeleteClip?.(clip);
                              }}
                              className="absolute right-0.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded bg-black/35 text-white/80 opacity-0 transition-opacity hover:bg-danger hover:text-white group-hover:opacity-100"
                              title={clip.track === 'bgm' ? '删除 BGM' : '删除音效'}
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden audio elements */}
      {clips.filter(c => c.audioUrl).map(c => (
        <audio
          key={c.id}
          ref={el => { if (el) audioRefs.current.set(c.id, el); else audioRefs.current.delete(c.id); }}
          src={c.audioUrl}
          preload="metadata"
          className="hidden"
        />
      ))}
    </div>
  );
};
