import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Square, SkipBack } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────
export interface TimelineClip {
  id: string;
  label: string;
  track: 'narration' | 'dialogue' | 'bgm' | 'image';
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
}

// ─── Color Palette ─────────────────────────────────────────────────
const TRACK_COLORS: Record<string, string> = {
  narration: 'bg-amber-500/60',
  dialogue: 'bg-sky-500/60',
  bgm: 'bg-emerald-500/40',
  image: 'bg-violet-500/50',
};

const TRACK_LABELS: Record<string, string> = {
  narration: '旁白',
  dialogue: '台词',
  bgm: 'BGM',
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
      ? ['image', 'narration', 'dialogue', 'bgm']
      : ['narration', 'dialogue', 'bgm'];
    return order.filter(t => clips.some(c => c.track === t));
  }, [clips, mode]);

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
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className={showPreview ? 'flex gap-4' : ''}>
        {showPreview && (
          <div className="shrink-0 w-[200px]">
            <div className="w-[200px] h-[120px] bg-black rounded-lg overflow-hidden border border-gray-700 flex items-center justify-center">
              {currentImageClip?.imageUrl ? (
                <img
                  src={currentImageClip.imageUrl}
                  alt={currentImageClip.label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-gray-600 text-xs">无画面</span>
              )}
            </div>
            <p className="text-[10px] text-gray-500 mt-1 truncate text-center">
              {currentImageClip?.label || '—'}
            </p>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {/* Controls */}
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={handleStop}
              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 transition-colors"
            >
              <SkipBack size={14} />
            </button>
            <button
              onClick={isPlaying ? handlePause : handlePlay}
              className="w-10 h-10 rounded-lg bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center text-white transition-colors"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={handleStop}
              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 transition-colors"
            >
              <Square size={14} />
            </button>
            <span className="text-sm text-gray-400 tabular-nums ml-2">
              {fmtTime(currentTimeMs)} / {fmtTime(effectiveTotal)}
            </span>
          </div>

          {/* Tracks */}
          <div
            ref={containerRef}
            className="relative cursor-pointer select-none"
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
            <div className="h-5 relative mb-1 border-b border-gray-800">
              {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                <span
                  key={pct}
                  className="absolute text-[9px] text-gray-600 -translate-x-1/2"
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
                <div key={trackId} className="flex items-center h-10 relative mb-1">
                  <span className="absolute -left-0 text-[9px] text-gray-600 w-10 text-right pr-1 z-10">
                    {TRACK_LABELS[trackId] || trackId}
                  </span>
                  <div className="ml-11 flex-1 relative h-full bg-gray-800/30 rounded overflow-hidden">
                    {trackClips.map(clip => {
                      const leftPct = (clip.startMs / effectiveTotal) * 100;
                      const widthPct = (clip.durationMs / effectiveTotal) * 100;
                      const colorClass = clip.color || TRACK_COLORS[clip.track] || 'bg-gray-600';

                      return (
                        <div
                          key={clip.id}
                          className={`absolute top-0.5 bottom-0.5 rounded ${colorClass} flex items-center overflow-hidden cursor-pointer hover:brightness-110 transition-all`}
                          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                          onClick={e => { e.stopPropagation(); onClipClick?.(clip); }}
                          title={`${clip.label} (${fmtTime(clip.durationMs)})`}
                        >
                          {clip.track === 'image' && clip.imageUrl ? (
                            <img src={clip.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-[8px] text-white/70 truncate px-1">{clip.label}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
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
