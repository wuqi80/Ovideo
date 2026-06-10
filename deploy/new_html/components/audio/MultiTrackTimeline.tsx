import React, { useMemo, useState, useCallback } from 'react';
import { Plus, Music } from 'lucide-react';
import { MusicModal } from './MusicModal';
import type { StoryboardItemDB, AudioClipInfo } from '../../types';

export interface TimelineSegment {
  itemId: string;
  sortOrder: number;
  durationMs: number;
  hasDialogue: boolean;
  hasAudio: boolean;
  clip: AudioClipInfo | null;
  label: string;
}

export interface MultiTrackTimelineProps {
  storyboardItems: StoryboardItemDB[];
  clips: AudioClipInfo[];
  localAudio: Record<string, { url: string; durationMs?: number }>;
  audioTracks: any[];
  clipKeyFn: (clip: AudioClipInfo) => string;
  onClickItem: (itemId: string) => void;
  episodeId: string;
  script: any;
  reload: () => Promise<void>;
}

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({
  storyboardItems, clips, localAudio, audioTracks, clipKeyFn,
  onClickItem, episodeId, script, reload,
}) => {
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40);

  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  const segments: TimelineSegment[] = useMemo(() => {
    return sortedItems.map(item => {
      const clip = clips.find(c => c.itemId === item.itemId);
      const key = clip ? clipKeyFn(clip) : '';
      const audio = key ? localAudio[key] : undefined;
      const hasAudio = !!(clip && (audio?.url || clip.audioUrl));
      const durationMs = hasAudio
        ? (audio?.durationMs || clip!.durationMs || item.plannedDurationMs || 2000)
        : (item.plannedDurationMs || 2000);
      return {
        itemId: item.itemId,
        sortOrder: item.sortOrder,
        durationMs,
        hasDialogue: !!clip,
        hasAudio,
        clip,
        label: clip
          ? `${clip.characterName}: ${clip.text.slice(0, 12)}`
          : `#${item.sortOrder}`,
      };
    });
  }, [sortedItems, clips, localAudio, clipKeyFn]);

  const totalMs = segments.reduce((s, seg) => s + seg.durationMs, 0);

  const bgmTracks = useMemo(
    () => audioTracks.filter((t: any) => (t.trackType || t.track_type) === 'bgm'),
    [audioTracks],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPixelsPerSecond(prev => Math.max(10, Math.min(200, prev - e.deltaY * 0.1)));
    }
  }, []);

  const msToWidth = (ms: number) => `${(ms / 1000) * pixelsPerSecond}px`;

  if (sortedItems.length === 0) {
    return (
      <div className="border-t border-gray-800 bg-gray-950 h-16 flex items-center justify-center text-xs text-gray-600">
        暂无分镜数据
      </div>
    );
  }

  return (
    <div className="border-t border-gray-800 bg-gray-950 flex flex-col" style={{ height: '200px' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-bold text-gray-500 uppercase">时间轴</span>
        <span className="text-[10px] text-gray-600 tabular-nums">
          总 {(totalMs / 1000).toFixed(1)}s | {pixelsPerSecond}px/s
        </span>
        <span className="flex-1" />
        <span className="text-[10px] text-gray-600">Ctrl+滚轮缩放</span>
      </div>

      {/* Tracks */}
      <div className="flex-1 overflow-auto" onWheel={handleWheel}>
        <div style={{ minWidth: msToWidth(totalMs) }}>
          {/* Track 1: Shot markers */}
          <div className="flex items-center h-7 border-b border-gray-800/50">
            <span className="w-16 shrink-0 text-[10px] text-gray-600 px-2">镜头</span>
            <div className="flex h-full">
              {segments.map(seg => (
                <div
                  key={`mark-${seg.itemId}`}
                  style={{ width: msToWidth(seg.durationMs) }}
                  className="border-r border-gray-800/30 flex items-center justify-center text-[10px] text-gray-500 cursor-pointer hover:bg-gray-900/50"
                  onClick={() => onClickItem(seg.itemId)}
                >
                  #{seg.sortOrder}
                </div>
              ))}
            </div>
          </div>

          {/* Track 2: Dialogue audio */}
          <div className="flex items-center h-8 border-b border-gray-800/50">
            <span className="w-16 shrink-0 text-[10px] text-gray-600 px-2">台词</span>
            <div className="flex h-full py-0.5 gap-px">
              {segments.map(seg => (
                <div
                  key={`audio-${seg.itemId}`}
                  style={{ width: msToWidth(seg.durationMs) }}
                  className={`rounded-sm flex items-center justify-center text-[9px] truncate px-1 cursor-pointer transition-colors ${
                    seg.hasAudio
                      ? 'bg-sky-500/50 text-sky-200 hover:bg-sky-500/70'
                      : seg.hasDialogue
                        ? 'bg-amber-500/30 text-amber-300 hover:bg-amber-500/50'
                        : 'bg-gray-800/30 text-gray-600 border border-dashed border-gray-700/50'
                  }`}
                  onClick={() => onClickItem(seg.itemId)}
                  title={seg.label}
                >
                  {seg.hasDialogue ? seg.label : `${(seg.durationMs / 1000).toFixed(1)}s`}
                </div>
              ))}
            </div>
          </div>

          {/* Track 3: BGM */}
          <div className="flex items-center h-8 border-b border-gray-800/50">
            <span className="w-16 shrink-0 text-[10px] text-gray-600 px-2">BGM</span>
            <div className="flex-1 h-full py-0.5 relative">
              {bgmTracks.map((t: any) => {
                const durMs = t.durationMs || t.duration_ms || 0;
                return (
                  <div
                    key={t.trackId || t.track_id}
                    style={{ width: durMs > 0 ? msToWidth(durMs) : '100%' }}
                    className="h-full bg-emerald-500/30 rounded-sm flex items-center px-2 text-[9px] text-emerald-300 truncate"
                  >
                    <Music size={10} className="mr-1 shrink-0" /> {t.name || 'BGM'}
                  </div>
                );
              })}
              <button
                onClick={() => setShowMusicModal(true)}
                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white text-[10px] font-semibold transition-all"
              >
                <Plus size={10} /> 添加音乐
              </button>
            </div>
          </div>

          {/* Track 4: SFX */}
          <div className="flex items-center h-7">
            <span className="w-16 shrink-0 text-[10px] text-gray-600 px-2">音效</span>
            <div className="flex h-full py-0.5 gap-px">
              {segments.map(seg => {
                const item = sortedItems.find(i => i.itemId === seg.itemId);
                const hasSfx = item?.sfxAudioUrl;
                return (
                  <div
                    key={`sfx-${seg.itemId}`}
                    style={{ width: msToWidth(seg.durationMs) }}
                    className={`rounded-sm ${hasSfx ? 'bg-purple-500/30' : ''}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {showMusicModal && (
        <MusicModal
          episodeId={episodeId}
          script={script}
          onClose={() => setShowMusicModal(false)}
          onCreated={async () => { await reload(); setShowMusicModal(false); }}
        />
      )}
    </div>
  );
};
