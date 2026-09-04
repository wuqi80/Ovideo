import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Cloud, Cpu, Info, Video } from 'lucide-react';

import type { VideoModel, VideoModelOption } from '../../services/videoModelService';

interface VideoModelPickerProps {
  value: VideoModel;
  options: readonly VideoModelOption[];
  onChange: (model: VideoModel) => void;
  compact?: boolean;
  className?: string;
}

function splitOptionLabel(label: string): { name: string; description: string } {
  const [name, ...description] = String(label || '').split('·').map(part => part.trim()).filter(Boolean);
  return {
    name: name || '选择模型',
    description: description.join(' · '),
  };
}

export const VideoModelPicker: React.FC<VideoModelPickerProps> = ({
  value,
  options,
  onChange,
  compact = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(
    () => options.find(option => option.value === value),
    [options, value],
  );
  const selectedLabel = splitOptionLabel(selected?.label || String(value));
  const onlineOptions = useMemo(
    () => options.filter(option => option.provider !== 'processing_cluster'),
    [options],
  );
  const localOptions = useMemo(
    () => options.filter(option => option.provider === 'processing_cluster'),
    [options],
  );

  const refreshPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const desiredWidth = compact ? 320 : 360;
    const width = Math.max(260, Math.min(desiredWidth, window.innerWidth - 24));
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const estimatedHeight = Math.min(420, 58 + options.length * 58);
    const opensUpward = rect.bottom + estimatedHeight + 12 > window.innerHeight
      && rect.top > estimatedHeight;
    const top = opensUpward
      ? Math.max(12, rect.top - estimatedHeight - 6)
      : Math.min(window.innerHeight - 12, rect.bottom + 6);
    setPosition({ left, top, width });
  }, [compact, options.length]);

  useEffect(() => {
    if (!open) return;
    refreshPosition();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', refreshPosition);
    window.addEventListener('scroll', refreshPosition, true);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', refreshPosition);
      window.removeEventListener('scroll', refreshPosition, true);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, refreshPosition]);

  const panel = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        role="listbox"
        aria-label="选择视频生成模型"
        className="fixed z-[120] overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-bottom"
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        <div className="border-b border-n40 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-n800"><Video className="h-3.5 w-3.5 text-primary" />选择视频模型</div>
          <div className="mt-0.5 text-[10px] text-n100">全部模型始终展示；灰色模型悬停可查看不可用原因</div>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {([
            { key: 'online', label: '在线 API', icon: Cloud, rows: onlineOptions },
            { key: 'local', label: '本地节点', icon: Cpu, rows: localOptions },
          ] as const).map(section => section.rows.length > 0 && (
            <section key={section.key} className="mb-2 last:mb-0">
              <div className="mb-1 flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold text-n300">
                <section.icon className="h-3 w-3" />{section.label}
              </div>
              <div className="space-y-0.5">
              {section.rows.map(option => {
            const label = splitOptionLabel(option.label);
            const isLocal = option.provider === 'processing_cluster';
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={!option.available}
                title={!option.available ? option.unavailableReason : option.label}
                onClick={() => {
                  if (!option.available) return;
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`group relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  option.available
                    ? 'hover:bg-p50'
                    : 'cursor-not-allowed bg-n20/80 text-n100 grayscale'
                } ${isSelected ? 'bg-p50' : ''}`}
              >
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  option.available ? 'bg-p75 text-primary' : 'bg-n30 text-n100'
                }`}>
                  <Video className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-xs font-semibold ${option.available ? 'text-n800' : 'text-n100'}`}>
                      {label.name}
                    </span>
                    {isLocal && (
                      <span className="shrink-0 rounded bg-n30 px-1.5 py-0.5 text-[9px] font-medium text-n300">本地节点</span>
                    )}
                    {!option.available && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-n30 px-1.5 py-0.5 text-[9px] font-medium text-n100"><Info className="h-2.5 w-2.5" />不可用</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-n100">
                    {option.available
                      ? (label.description || option.runtimeLabel || '视频生成模型')
                      : (option.unavailableReason || '当前暂不可用')}
                  </span>
                </span>
                {isSelected && <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
              })}
              </div>
            </section>
          ))}
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          refreshPosition();
          setOpen(current => !current);
        }}
        className={`inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full border border-n40 bg-n0 text-n700 shadow-sm transition-colors hover:border-primary hover:bg-p50 ${
          compact ? 'max-w-[170px] px-2 py-1 text-[10px]' : 'max-w-[260px] px-2.5 py-1.5 text-xs'
        } ${!selected?.available ? 'text-n100' : ''} ${className}`}
        title={selected?.available ? selected.label : selected?.unavailableReason}
      >
        <Video className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} shrink-0 text-primary`} />
        <span className="truncate font-semibold">{selectedLabel.name}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {panel}
    </>
  );
};
