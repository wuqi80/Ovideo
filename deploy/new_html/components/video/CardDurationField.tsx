// new_html/components/video/CardDurationField.tsx
import React from 'react';
import { RotateCcw } from 'lucide-react';
import { DURATION_MIN_SEC, DURATION_MAX_SEC } from '../../utils/durationMapping';

export interface CardDurationFieldProps {
    duration: number;
    userOverride: boolean;
    onChange: (sec: number, override: boolean) => void;
    onClear: () => void;
    disabled?: boolean;
    maxDuration?: number;
    variant?: 'compact' | 'seedance15';
}

export const CardDurationField: React.FC<CardDurationFieldProps> = ({
    duration, userOverride, onChange, onClear, disabled, maxDuration, variant = 'compact',
}) => {
    const maxSec = maxDuration ?? DURATION_MAX_SEC;
    if (variant === 'seedance15') {
        const marks = Array.from(new Set([DURATION_MIN_SEC, 5, 10, maxSec]))
            .filter(mark => mark >= DURATION_MIN_SEC && mark <= maxSec)
            .sort((a, b) => a - b);
        return (
            <div className="flex min-w-[250px] items-center gap-2 rounded-lg border border-n40 bg-n0 px-2.5 py-1.5 text-[10px] shadow-sm">
                <div className="shrink-0">
                    <div className="font-medium text-n700">视频时长</div>
                    <div className="text-[9px] text-n100">{DURATION_MIN_SEC}–{maxSec} 秒</div>
                </div>
                <div className="min-w-0 flex-1">
                    <input
                        type="range"
                        min={DURATION_MIN_SEC}
                        max={maxSec}
                        step={1}
                        value={duration}
                        disabled={disabled}
                        className="h-1.5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
                        onChange={event => onChange(Number(event.target.value), true)}
                        aria-label="Seedance 1.5 Pro 视频时长"
                    />
                    <div className="flex justify-between text-[8px] leading-none text-n100">
                        {marks.map(mark => <span key={mark}>{mark}</span>)}
                    </div>
                </div>
                <div className="flex h-8 w-11 shrink-0 items-center justify-center rounded-md bg-n20 font-semibold text-n700">
                    {duration}<span className="ml-0.5 text-[9px] font-normal text-n100">s</span>
                </div>
                {userOverride && (
                    <button type="button" onClick={onClear} disabled={disabled} title="恢复跟随分镜时长" className="p-0.5 text-n300 hover:text-primary">
                        <RotateCcw size={11} />
                    </button>
                )}
            </div>
        );
    }
    return (
        <div className="flex items-center gap-1 text-[10px]">
            <label className="text-n300">时长</label>
            <input
                type="number"
                min={DURATION_MIN_SEC}
                max={maxSec}
                step={1}
                value={duration}
                disabled={disabled}
                className="w-12 px-1 py-0.5 bg-n0 border border-n40 rounded text-n700 text-center"
                onChange={e => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isFinite(n)) return;
                    onChange(Math.max(DURATION_MIN_SEC, Math.min(maxSec, n)), true);
                }}
                title={userOverride
                    ? `已手动设置（当前上限 ${maxSec}s，点 ↺ 恢复跟随音频）`
                    : `跟随音频/脚本（当前上限 ${maxSec}s）`}
            />
            <span className="text-n100">s</span>
            {userOverride && (
                <button
                    type="button"
                    onClick={onClear}
                    disabled={disabled}
                    title="清除手动设置，恢复跟随"
                    className="p-0.5 text-n300 hover:text-n700"
                >
                    <RotateCcw size={11} />
                </button>
            )}
        </div>
    );
};
