import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Volume2, Loader, Clock } from 'lucide-react';
import { DubbingCard } from './DubbingCard';
import type {
  AudioClipInfo, CharacterVoice, ClipOverride, AssetItem, StoryboardItemDB,
} from '../../types';

const DUBBING_INITIAL_ITEM_COUNT = 20;
const DUBBING_ITEM_PAGE_SIZE = 20;

export interface DubbingPanelHandle {
  scrollToItem: (itemId: string) => void;
}

export interface DubbingPanelProps {
  storyboardItems: StoryboardItemDB[];
  clips: AudioClipInfo[];
  voiceMap: Map<string, CharacterVoice>;
  charAssetMap: Map<string, AssetItem>;
  localOverrides: Record<string, ClipOverride>;
  setLocalOverrides: React.Dispatch<React.SetStateAction<Record<string, ClipOverride>>>;
  localAudio: Record<string, { url: string; durationMs?: number }>;
  generatingIds: Set<string>;
  errors: Record<string, string>;
  playingKey: string;
  onGenerate: (clip: AudioClipInfo) => void;
  onTogglePlay: (key: string) => void;
  onBatchGenerate: () => void;
  batchRunning: boolean;
  allCharNames: string[];
  clipKeyFn: (clip: AudioClipInfo) => string;
  onTextPersist?: (itemId: string, speaker: string, newText: string) => void;
}

export const DubbingPanel = forwardRef<DubbingPanelHandle, DubbingPanelProps>((props, ref) => {
  const {
    storyboardItems, clips, voiceMap, charAssetMap,
    localOverrides, setLocalOverrides,
    localAudio, generatingIds, errors, playingKey,
    onGenerate, onTogglePlay, onBatchGenerate, batchRunning,
    allCharNames, clipKeyFn, onTextPersist,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [visibleItemCount, setVisibleItemCount] = useState(DUBBING_INITIAL_ITEM_COUNT);

  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  const itemIdSignature = useMemo(
    () => sortedItems.map(item => item.itemId).join('|'),
    [sortedItems],
  );

  useEffect(() => {
    setVisibleItemCount(DUBBING_INITIAL_ITEM_COUNT);
    itemRefs.current.clear();
  }, [itemIdSignature]);

  const visibleStoryboardItems = useMemo(
    () => sortedItems.slice(0, visibleItemCount),
    [sortedItems, visibleItemCount],
  );

  const hasMoreStoryboardItems = visibleItemCount < sortedItems.length;

  const revealAndScrollToItem = useCallback((itemId: string) => {
    const idx = sortedItems.findIndex(item => item.itemId === itemId);
    if (idx >= visibleItemCount) {
      setVisibleItemCount(Math.min(idx + 1, sortedItems.length));
    }
    window.setTimeout(() => {
      const el = itemRefs.current.get(itemId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }, [sortedItems, visibleItemCount]);

  useImperativeHandle(ref, () => ({
    scrollToItem: revealAndScrollToItem,
  }), [revealAndScrollToItem]);

  const clipsByItem = useMemo(() => {
    const m = new Map<string, AudioClipInfo[]>();
    for (const c of clips) {
      const list = m.get(c.itemId) || [];
      list.push(c);
      m.set(c.itemId, list);
    }
    return m;
  }, [clips]);

  const handleOverrideChange = useCallback((key: string, patch: Partial<ClipOverride>) => {
    setLocalOverrides(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), ...patch },
    }));
  }, [setLocalOverrides]);

  const totalDurationMs = useMemo(() => {
    return clips.reduce((sum, c) => {
      const key = clipKeyFn(c);
      return sum + (localAudio[key]?.durationMs || c.durationMs || 0);
    }, 0);
  }, [clips, localAudio, clipKeyFn]);

  const generatedCount = clips.filter(c => localAudio[clipKeyFn(c)]?.url || c.audioUrl).length;

  return (
    <div ref={containerRef} className="flex-1 overflow-auto p-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-4 sticky top-0 bg-n20/90 backdrop-blur-sm z-10 pb-3 border-b border-n40">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-n0 border border-n40">
          <Clock size={14} className="text-primary" />
          <span className="text-xs text-n100">总时长</span>
          <span className="text-sm font-bold tabular-nums">
            {totalDurationMs > 0 ? `${(totalDurationMs / 1000).toFixed(1)}s` : '—'}
          </span>
        </div>
        <button
          disabled={batchRunning || clips.length === 0}
          onClick={onBatchGenerate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50"
        >
          {batchRunning ? <Loader size={14} className="animate-spin" /> : <Volume2 size={14} />}
          全部生成
        </button>
        <span className="text-xs text-n100 ml-auto">
          {generatedCount}/{clips.length} 已生成
        </span>
      </div>

      {/* Shot groups */}
      {sortedItems.length === 0 ? (
        <div className="py-16 text-center text-n100 bg-n0 rounded-md border border-dashed border-n40">
          暂无分镜条目。请先在剧本流程中创建分镜。
        </div>
      ) : (
        visibleStoryboardItems.map(item => {
          const itemClips = clipsByItem.get(item.itemId) || [];
          const hasDialogue = itemClips.length > 0;
          return (
            <div
              key={item.itemId}
              ref={el => { if (el) itemRefs.current.set(item.itemId, el); }}
              className="bg-n0 rounded-md border border-n40 p-4 shadow-card"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-primary bg-primary-light px-2 py-0.5 rounded">
                  #{item.sortOrder}
                </span>
                {item.plannedDurationMs != null && item.plannedDurationMs > 0 && (
                  <span className="text-[10px] text-n100">
                    设计时长 {(item.plannedDurationMs / 1000).toFixed(1)}s
                  </span>
                )}
                {!hasDialogue && (
                  <span className="text-[10px] text-n100 italic ml-auto">
                    无台词 — 按设计时长占位
                  </span>
                )}
              </div>
              {hasDialogue ? (
                <div className="space-y-2">
                  {itemClips.map(clip => {
                    const key = clipKeyFn(clip);
                    const audio = localAudio[key];
                    return (
                      <DubbingCard
                        key={key}
                        clip={clip}
                        clipKey={key}
                        voice={voiceMap.get(clip.characterName)}
                        charAsset={charAssetMap.get(clip.characterName)}
                        override={localOverrides[key] || {}}
                        onOverrideChange={handleOverrideChange}
                        audioUrl={audio?.url || (clip.audioUrl ? (clip.audioUrl.startsWith('/') ? clip.audioUrl : `/${clip.audioUrl}`) : '')}
                        audioDurationMs={audio?.durationMs || clip.durationMs}
                        isGenerating={generatingIds.has(key)}
                        error={errors[key] || null}
                        isPlaying={playingKey === key}
                        onGenerate={() => onGenerate(clip)}
                        onTogglePlay={() => onTogglePlay(key)}
                        plannedDurationMs={item.plannedDurationMs}
                        allCharNames={allCharNames}
                        onTextPersist={onTextPersist}
                      />
                    );
                  })}
                </div>
              ) : (
                <div
                  className="px-3 py-4 text-center cursor-pointer hover:bg-n30 rounded transition-colors border border-dashed border-n40"
                  onClick={() => {
                    if (onTextPersist) {
                      onTextPersist(item.itemId, allCharNames[0] || '旁白', '（请输入台词）');
                    }
                  }}
                >
                  <p className="text-xs text-n100">+ 添加台词</p>
                  <p className="text-[10px] text-n100 mt-1">
                    设计时长 {item.plannedDurationMs ? `${(item.plannedDurationMs / 1000).toFixed(1)}s` : '未设置'}
                  </p>
                </div>
              )}
            </div>
          );
        })
      )}
      {hasMoreStoryboardItems && (
        <button
          type="button"
          onClick={() => setVisibleItemCount(count => Math.min(count + DUBBING_ITEM_PAGE_SIZE, sortedItems.length))}
          className="w-full px-3 py-2 rounded-lg border border-n40 bg-n0 hover:border-primary hover:text-primary text-xs text-n300 transition-colors"
        >
          加载更多台词（{Math.min(visibleItemCount, sortedItems.length)} / {sortedItems.length}）
        </button>
      )}
    </div>
  );
});

DubbingPanel.displayName = 'DubbingPanel';
