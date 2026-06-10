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
}

export const CardDurationField: React.FC<CardDurationFieldProps> = ({
    duration, userOverride, onChange, onClear, disabled,
}) => {
    return (
        <div className="flex items-center gap-1 text-[10px]">
            <label className="text-slate-400">时长</label>
            <input
                type="number"
                min={DURATION_MIN_SEC}
                max={DURATION_MAX_SEC}
                step={1}
                value={duration}
                disabled={disabled}
                className="w-12 px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-center"
                onChange={e => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isFinite(n)) return;
                    onChange(n, true);
                }}
                title={userOverride ? '已手动设置（点 ↺ 恢复跟随音频）' : '跟随音频/脚本'}
            />
            <span className="text-slate-500">s</span>
            {userOverride && (
                <button
                    type="button"
                    onClick={onClear}
                    disabled={disabled}
                    title="清除手动设置，恢复跟随"
                    className="p-0.5 text-slate-400 hover:text-slate-200"
                >
                    <RotateCcw size={11} />
                </button>
            )}
        </div>
    );
};
