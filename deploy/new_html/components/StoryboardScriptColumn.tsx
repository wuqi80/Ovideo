import React, { useEffect, useMemo, useRef } from 'react';
import { FileText, Film } from 'lucide-react';
import type { ProjectFile, StoryboardItem } from '../types';
import { buildStoryboardSegmentGroups } from '../utils/storyboardSegments';

interface StoryboardScriptColumnProps {
  selectedFile: ProjectFile | undefined;
  highlightedItemIds: Set<string>;
  onSelectItemIds: (selectedIds: Set<string>) => void;
}

const getScriptBlock = (item: StoryboardItem): string => (
  item.originalText?.trim()
  || item.videoScriptBlock?.trim()
  || item.scriptSegment?.trim()
  || '暂无对应分镜脚本内容'
);

export const StoryboardScriptColumn: React.FC<StoryboardScriptColumnProps> = ({
  selectedFile,
  highlightedItemIds,
  onSelectItemIds,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const items = useMemo(
    () => (selectedFile?.storyboard?.items || []).filter(item => !item.isPlaceholder),
    [selectedFile?.storyboard?.items],
  );
  const segmentGroups = useMemo(
    () => buildStoryboardSegmentGroups(items, selectedFile?.scriptSegments || []),
    [items, selectedFile?.scriptSegments],
  );

  useEffect(() => {
    const firstHighlightedId = items.find(item => highlightedItemIds.has(item.id))?.id;
    if (!firstHighlightedId) return;
    const container = scrollContainerRef.current;
    const target = itemRefs.current.get(firstHighlightedId);
    if (!container || !target) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const centeredTop = container.scrollTop
      + targetRect.top
      - containerRect.top
      - Math.max(0, (container.clientHeight - targetRect.height) / 2);
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTo({
      top: Math.min(Math.max(0, centeredTop), maxScrollTop),
      behavior: 'smooth',
    });
  }, [highlightedItemIds, items]);

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-n40 bg-n20"
      data-testid="storyboard-script-column"
      aria-label="当前镜头设计对应的分镜脚本"
    >
      <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-n40 bg-n0 px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-n700">
          <FileText className="h-4 w-4 text-primary" />
          分镜脚本
        </h2>
        <span className="text-xs text-n100">当前镜头设计对应版本</span>
      </header>

      <div className="flex h-[52px] flex-shrink-0 items-center border-b border-n40 bg-n0 px-3">
        <div className="flex w-full items-center gap-2 rounded border border-primary bg-primary-light px-3 py-2 text-xs text-primary">
          <Film className="h-4 w-4" />
          <span>共 {segmentGroups.length} 个分段 · {items.length} 个镜头</span>
          <span className="ml-auto text-[10px] text-n300">点击段落联动右侧镜头</span>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="custom-scrollbar relative min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
        data-testid="storyboard-script-scroll-container"
      >
        {items.length > 0 ? segmentGroups.map(group => (
          <section key={group.key} className="overflow-hidden rounded-md border border-n40 bg-n0 shadow-card">
            <header className="flex items-center gap-2 border-b border-n40 bg-n20 px-4 py-2.5">
              <span className="text-xs font-semibold text-n500">分段</span>
              <span className="font-mono text-sm font-bold text-warning">
                {String(group.segmentNo).padStart(2, '0')}
              </span>
              <span className="text-[10px] text-n100">
                {group.entries.length} 个镜头 · 约 {Number(group.estimatedDurationSec.toFixed(1))} 秒
              </span>
            </header>
            <div className="divide-y divide-n40">
              {group.entries.map(entry => {
                const { item } = entry;
                const isHighlighted = highlightedItemIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    ref={(element) => {
                      if (element) itemRefs.current.set(item.id, element);
                      else itemRefs.current.delete(item.id);
                    }}
                    type="button"
                    data-storyboard-item-id={item.id}
                    aria-label={`${group.segmentLabel} ${entry.localShotLabel}`}
                    aria-pressed={isHighlighted}
                    onClick={() => onSelectItemIds(new Set([item.id]))}
                    className={`block w-full border-l-2 p-4 text-left transition-colors ${
                      isHighlighted
                        ? 'border-l-primary bg-primary-light/30 ring-1 ring-inset ring-primary/20'
                        : 'border-l-transparent bg-n0 hover:bg-n20'
                    }`}
                  >
                    <span className={`mb-3 block text-xs font-semibold ${isHighlighted ? 'text-primary' : 'text-n700'}`}>
                      {entry.localShotLabel}
                    </span>
                    <span className="block whitespace-pre-wrap font-mono text-sm leading-7 text-n700">
                      {getScriptBlock(item)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-n100">
            <FileText className="h-8 w-8 opacity-30" />
            <p className="text-xs">当前镜头设计没有对应的分镜脚本</p>
          </div>
        )}
      </div>
    </section>
  );
};
