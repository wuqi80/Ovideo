import React, { useMemo, useState, useCallback } from 'react';
import { Plus, Music, Sparkles, Wand2 } from 'lucide-react';
import { MusicModal } from './MusicModal';
import { SfxModal } from './SfxModal';
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
  projectId?: string;
  script: any;
  reload: () => Promise<void>;
}

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({
  storyboardItems, clips, localAudio, audioTracks, clipKeyFn,
  onClickItem, episodeId, projectId, script, reload,
}) => {
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [showSfxModal, setShowSfxModal] = useState(false);
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

  const totalMs = segments.reduce((sum, seg) => sum + seg.durationMs, 0);
  const trackWidth = Math.max(560, (totalMs / 1000) * pixelsPerSecond);

  const bgmTracks = useMemo(
    () => audioTracks.filter((t: any) => (t.trackType || t.track_type) === 'bgm'),
    [audioTracks],
  );

  const sfxTracks = useMemo(
    () => audioTracks.filter((t: any) => (t.trackType || t.track_type) === 'sfx_global'),
    [audioTracks],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPixelsPerSecond(prev => Math.max(10, Math.min(200, prev - e.deltaY * 0.1)));
    }
  }, []);

  const msToWidth = (ms: number) => `${Math.max(10, (ms / 1000) * pixelsPerSecond)}px`;

  const renderTrackLabel = (
    label: string,
    extra?: React.ReactNode,
    className = '',
  ) => (
    <div className={`sticky left-0 z-20 flex h-full w-48 shrink-0 items-center justify-between border-r border-n40 bg-n20 px-3 text-[10px] text-n100 ${className}`}>
      <span className="font-medium">{label}</span>
      {extra}
    </div>
  );

  if (sortedItems.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center border-t border-n40 bg-n20 text-xs text-n100">
        暂无分镜数据
      </div>
    );
  }

  return (
    <div className="flex h-[224px] flex-col border-t border-n40 bg-n20">
      <div className="flex shrink-0 items-center gap-3 border-b border-n40 px-4 py-2">
        <span className="text-xs font-bold uppercase text-n100">时间轴</span>
        <span className="tabular-nums text-[10px] text-n100">
          总 {(totalMs / 1000).toFixed(1)}s | {pixelsPerSecond}px/s
        </span>
        <span className="flex-1" />
        <span className="text-[10px] text-n100">Ctrl+滚轮缩放</span>
      </div>

      <div className="flex-1 overflow-auto" onWheel={handleWheel}>
        <div style={{ minWidth: `${trackWidth + 192}px` }}>
          <div className="flex h-7 items-center border-b border-n40">
            {renderTrackLabel('镜头')}
            <div className="flex h-full" style={{ width: `${trackWidth}px` }}>
              {segments.map(seg => (
                <button
                  key={`mark-${seg.itemId}`}
                  type="button"
                  style={{ width: msToWidth(seg.durationMs) }}
                  className="flex items-center justify-center border-r border-n40 text-[10px] text-n100 transition-colors hover:bg-n30"
                  onClick={() => onClickItem(seg.itemId)}
                >
                  #{seg.sortOrder}
                </button>
              ))}
            </div>
          </div>

          <div className="flex h-8 items-center border-b border-n40">
            {renderTrackLabel('台词')}
            <div className="flex h-full gap-px py-0.5" style={{ width: `${trackWidth}px` }}>
              {segments.map(seg => (
                <button
                  key={`audio-${seg.itemId}`}
                  type="button"
                  style={{ width: msToWidth(seg.durationMs) }}
                  className={`truncate rounded-sm px-1 text-[9px] transition-colors ${
                    seg.hasAudio
                      ? 'bg-b50 text-b400 hover:bg-b75'
                      : seg.hasDialogue
                        ? 'bg-warning/20 text-warning hover:bg-warning/30'
                        : 'border border-dashed border-n40 bg-n30 text-n100'
                  }`}
                  onClick={() => onClickItem(seg.itemId)}
                  title={seg.label}
                >
                  {seg.hasDialogue ? seg.label : `${(seg.durationMs / 1000).toFixed(1)}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex h-10 items-center border-b border-n40">
            {renderTrackLabel(
              'BGM',
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowMusicModal(true)}
                  className="inline-flex items-center gap-1 rounded border border-n40 bg-n0 px-2 py-1 text-[10px] font-semibold text-n700 transition-colors hover:bg-n30"
                  title="上传已有背景音乐"
                >
                  <Plus size={11} /> 添加
                </button>
                <button
                  type="button"
                  onClick={() => setShowMusicModal(true)}
                  className="inline-flex items-center gap-1 rounded bg-success px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-success"
                  title="AI 音乐制作"
                >
                  <Wand2 size={11} /> AI 音乐制作
                </button>
              </div>,
            )}
            <div className="relative h-full py-1" style={{ width: `${trackWidth}px` }}>
              {bgmTracks.map((track: any) => {
                const durMs = track.durationMs || track.duration_ms || totalMs;
                return (
                  <div
                    key={track.trackId || track.track_id}
                    style={{ width: durMs > 0 ? msToWidth(durMs) : '100%' }}
                    className="flex h-full items-center truncate rounded-sm bg-success/20 px-2 text-[9px] text-success"
                    title={track.name || 'BGM'}
                  >
                    <Music size={10} className="mr-1 shrink-0" /> {track.name || 'BGM'}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex h-10 items-center">
            {renderTrackLabel(
              '音效',
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowSfxModal(true)}
                  className="inline-flex items-center gap-1 rounded border border-n40 bg-n0 px-2 py-1 text-[10px] font-semibold text-n700 transition-colors hover:bg-n30"
                  title="上传已有音效"
                >
                  <Plus size={11} /> 添加
                </button>
                <button
                  type="button"
                  onClick={() => setShowSfxModal(true)}
                  className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-primary-hover"
                  title="AI 音效制作"
                >
                  <Sparkles size={11} /> AI 音效制作
                </button>
              </div>,
            )}
            <div className="relative flex h-full gap-px py-1" style={{ width: `${trackWidth}px` }}>
              {sfxTracks.length > 0 && (
                <div className="absolute inset-y-1 left-0 flex items-center rounded-sm bg-primary/20 px-2 text-[9px] text-primary">
                  {sfxTracks.map((track: any) => track.name || '音效').join(' / ')}
                </div>
              )}
              {segments.map(seg => {
                const item = sortedItems.find(i => i.itemId === seg.itemId);
                const hasSfx = item?.sfxAudioUrl;
                return (
                  <div
                    key={`sfx-${seg.itemId}`}
                    style={{ width: msToWidth(seg.durationMs) }}
                    className={`rounded-sm ${hasSfx ? 'bg-primary/20' : ''}`}
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
          projectId={projectId}
          script={script}
          onClose={() => setShowMusicModal(false)}
          onCreated={async () => { await reload(); setShowMusicModal(false); }}
        />
      )}

      {showSfxModal && (
        <SfxModal
          episodeId={episodeId}
          projectId={projectId}
          script={script}
          onClose={() => setShowSfxModal(false)}
          onCreated={async () => { await reload(); setShowSfxModal(false); }}
        />
      )}
    </div>
  );
};
