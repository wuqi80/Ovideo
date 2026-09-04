import React from 'react';
import { Clock3 } from 'lucide-react';

import {
    VIDEO_CONTROL_PILL_CLASS,
    VIDEO_CONTROL_POPOVER_CLASS,
} from './videoControlStyles';

interface VideoDurationControlProps {
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
    disabled?: boolean;
    ariaLabel?: string;
}

export const VideoDurationControl: React.FC<VideoDurationControlProps> = ({
    value,
    min,
    max,
    onChange,
    disabled,
    ariaLabel = '视频时长',
}) => (
    <details className="relative">
        <summary className={`${VIDEO_CONTROL_PILL_CLASS} cursor-pointer list-none select-none`} aria-label={`${ariaLabel}设置`}>
            <Clock3 className="h-3 w-3" />
            <span className="font-semibold text-n800">{value} 秒</span>
            <span className="text-[9px] text-n100">⌄</span>
        </summary>
        <div className={`${VIDEO_CONTROL_POPOVER_CLASS} w-64`}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                    <div className="text-[10px] font-semibold text-n700">选择视频生成时长</div>
                    <div className="text-[9px] text-n100">支持 {min}–{max} 秒</div>
                </div>
                <label className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n20 px-2 py-1 text-[10px] text-n500">
                    <input
                        type="number"
                        min={min}
                        max={max}
                        step={1}
                        value={value}
                        onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value))))}
                        disabled={disabled}
                        className="w-10 border-0 bg-transparent p-0 text-center font-semibold text-n800 outline-none"
                        aria-label={ariaLabel}
                    />
                    秒
                </label>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={value}
                onChange={event => onChange(Number(event.target.value))}
                disabled={disabled}
                className="h-1.5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
                aria-label={`${ariaLabel}滑杆`}
            />
            <div className="mt-1 flex justify-between text-[8px] text-n100"><span>{min}</span><span>{max}</span></div>
        </div>
    </details>
);
