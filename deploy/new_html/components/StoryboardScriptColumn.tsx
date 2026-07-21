import React, { useEffect, useMemo, useRef } from 'react';
import { FileText, Film } from 'lucide-react';
import type { ProjectFile, StoryboardItem } from '../types';

interface StoryboardScriptColumnProps {
  selectedFile: ProjectFile | undefined;
  highlightedItemIds: Set<string>;
  onSelectItemIds: (selectedIds: Set<string>) => void;
}

const getShotLabel = (item: StoryboardItem, index: number): string => {
  const raw = String(item.shotNumber ?? '').trim();
  const numeric = raw.match(/\d+/)?.[0];
  return `镜头 ${String(numeric || index + 1).padStart(2, '0')}`;
};

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
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const items = useMemo(
    () => (selectedFile?.storyboard?.items || []).filter(item => !item.isPlaceholder),
    [selectedFile?.storyboard?.items],
  );

  useEffect(() => {
    const firstHighlightedId = items.find(item => highlightedItemIds.has(item.id))?.id;
    if (!firstHighlightedId) return;
    itemRefs.current.get(firstHighlightedId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [highlightedItemIds, items]);

  return (
    <section
      className="flex h-full min-w-0 flex-col border-r border-n40 bg-n20"
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
          <span>共 {items.length} 个分镜段落</span>
          <span className="ml-auto text-[10px] text-n300">点击段落联动右侧镜头</span>
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {items.length > 0 ? items.map((item, index) => {
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
              aria-pressed={isHighlighted}
              onClick={() => onSelectItemIds(new Set([item.id]))}
              className={`block w-full rounded-md border bg-n0 p-4 text-left shadow-card transition-colors ${
                isHighlighted
                  ? 'border-primary ring-1 ring-primary/30'
                  : 'border-n40 hover:border-primary'
              }`}
            >
              <span className={`mb-3 block text-xs font-semibold ${isHighlighted ? 'text-primary' : 'text-n700'}`}>
                {getShotLabel(item, index)}
              </span>
              <span className="block whitespace-pre-wrap font-mono text-sm leading-7 text-n700">
                {getScriptBlock(item)}
              </span>
            </button>
          );
        }) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-n100">
            <FileText className="h-8 w-8 opacity-30" />
            <p className="text-xs">当前镜头设计没有对应的分镜脚本</p>
          </div>
        )}
      </div>
    </section>
  );
};
