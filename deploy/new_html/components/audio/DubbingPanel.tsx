import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { Volume2, Loader, Clock } from 'lucide-react';
import { DubbingCard } from './DubbingCard';
import type {
  AudioClipInfo, CharacterVoice, ClipOverride, AssetItem, StoryboardItemDB,
} from '../../types';

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

  useImperativeHandle(ref, () => ({
    scrollToItem(itemId: string) {
      const el = itemRefs.current.get(itemId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  }));

  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

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
      <div className="flex items-center gap-4 sticky top-0 bg-gray-950/90 backdrop-blur-sm z-10 pb-3 border-b border-gray-800">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
          <Clock size={14} className="text-indigo-400" />
          <span className="text-xs text-gray-500">总时长</span>
          <span className="text-sm font-bold tabular-nums">
            {totalDurationMs > 0 ? `${(totalDurationMs / 1000).toFixed(1)}s` : '—'}
          </span>
        </div>
        <button
          disabled={batchRunning || clips.length === 0}
          onClick={onBatchGenerate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all disabled:opacity-50"
        >
          {batchRunning ? <Loader size={14} className="animate-spin" /> : <Volume2 size={14} />}
          全部生成
        </button>
        <span className="text-xs text-gray-600 ml-auto">
          {generatedCount}/{clips.length} 已生成
        </span>
      </div>

      {/* Shot groups */}
      {sortedItems.length === 0 ? (
        <div className="py-16 text-center text-gray-500 bg-gray-900 rounded-xl border border-dashed border-gray-800">
          暂无分镜条目。请先在剧本流程中创建分镜。
        </div>
      ) : (
        sortedItems.map(item => {
          const itemClips = clipsByItem.get(item.itemId) || [];
          const hasDialogue = itemClips.length > 0;
          return (
            <div
              key={item.itemId}
              ref={el => { if (el) itemRefs.current.set(item.itemId, el); }}
              className="bg-gray-900 rounded-xl border border-gray-800 p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                  #{item.sortOrder}
                </span>
                {item.plannedDurationMs != null && item.plannedDurationMs > 0 && (
                  <span className="text-[10px] text-gray-500">
                    设计时长 {(item.plannedDurationMs / 1000).toFixed(1)}s
                  </span>
                )}
                {!hasDialogue && (
                  <span className="text-[10px] text-gray-600 italic ml-auto">
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
                  className="px-3 py-4 text-center cursor-pointer hover:bg-gray-700/30 rounded transition-colors border border-dashed border-gray-700"
                  onClick={() => {
                    if (onTextPersist) {
                      onTextPersist(item.itemId, allCharNames[0] || '旁白', '（请输入台词）');
                    }
                  }}
                >
                  <p className="text-xs text-gray-500">+ 添加台词</p>
                  <p className="text-[10px] text-gray-600 mt-1">
                    设计时长 {item.plannedDurationMs ? `${(item.plannedDurationMs / 1000).toFixed(1)}s` : '未设置'}
                  </p>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
});

DubbingPanel.displayName = 'DubbingPanel';
