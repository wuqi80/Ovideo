import React from 'react';
import { Clock3, Monitor, Sparkles, Wand2 } from 'lucide-react';
import {
    DEFAULT_MINIMAX_VIDEO_PARAMS,
    getMiniMaxVideoParamsError,
    normalizeMiniMaxVideoParams,
    type MiniMaxVideoDuration,
    type MiniMaxVideoModelName,
    type MiniMaxVideoParams,
    type MiniMaxVideoResolution,
} from '../../services/videoModelService';

interface MiniMaxVideoPanelProps {
    value: MiniMaxVideoParams;
    prompt: string;
    onChange: (next: MiniMaxVideoParams) => void;
    onPromptChange: (next: string) => void;
    modelOptions?: Array<{ value: MiniMaxVideoModelName; label?: string }>;
    compact?: boolean;
}

const MODEL_OPTIONS: Array<{ value: MiniMaxVideoModelName; label: string }> = [
    { value: 'MiniMax-Hailuo-2.3', label: 'MiniMax-Hailuo-2.3' },
    { value: 'MiniMax-Hailuo-2.3-Fast', label: 'MiniMax-Hailuo-2.3-Fast' },
];

function normalizeModelOptions(
    options: Array<{ value: MiniMaxVideoModelName; label?: string }> | undefined,
    currentModel: MiniMaxVideoModelName,
): Array<{ value: MiniMaxVideoModelName; label: string }> {
    const seen = new Set<string>();
    const rows = (options && options.length ? options : MODEL_OPTIONS)
        .map(option => ({
            value: String(option.value || '').trim(),
            label: String(option.label || option.value || '').trim(),
        }))
        .filter(option => {
            if (!option.value || seen.has(option.value)) return false;
            seen.add(option.value);
            return true;
        });
    if (currentModel && !rows.some(option => option.value === currentModel)) {
        rows.unshift({ value: currentModel, label: currentModel });
    }
    return rows.length ? rows : MODEL_OPTIONS;
}

export const MiniMaxVideoPanel: React.FC<MiniMaxVideoPanelProps> = ({
    value,
    prompt,
    onChange,
    onPromptChange,
    modelOptions,
    compact = false,
}) => {
    const defaultModel = modelOptions?.[0]?.value || DEFAULT_MINIMAX_VIDEO_PARAMS.model;
    const params = normalizeMiniMaxVideoParams(value, defaultModel);
    const panelModelOptions = React.useMemo(
        () => normalizeModelOptions(modelOptions, params.model),
        [modelOptions, params.model],
    );
    const validationError = getMiniMaxVideoParamsError(params);

    const setDuration = (duration: MiniMaxVideoDuration) => {
        onChange({ ...params, duration });
    };

    const setResolution = (resolution: MiniMaxVideoResolution) => {
        onChange({ ...params, resolution });
    };

    if (compact) {
        return (
            <div className="flex flex-1 min-w-0 items-center gap-1.5" title={validationError || undefined}>
                <select
                    value={params.model}
                    onChange={(event) => onChange(normalizeMiniMaxVideoParams({
                        ...params,
                        model: event.target.value as MiniMaxVideoModelName,
                    }))}
                    className="w-24 shrink-0 rounded border border-n40 bg-n20 px-1.5 py-1 text-[10px] text-n700 focus:border-primary focus:outline-none"
                    aria-label="MiniMax 模型"
                >
                    {panelModelOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
                <select
                    value={params.duration}
                    onChange={(event) => setDuration(Number(event.target.value) as MiniMaxVideoDuration)}
                    className="w-[58px] shrink-0 rounded border border-n40 bg-n20 px-1.5 py-1 text-[10px] text-n700 focus:border-primary focus:outline-none"
                    aria-label="MiniMax 时长"
                >
                    <option value={6}>6 秒</option>
                    <option value={10} disabled={params.resolution === '1080P'}>10 秒</option>
                </select>
                <select
                    value={params.resolution}
                    onChange={(event) => setResolution(event.target.value as MiniMaxVideoResolution)}
                    className="w-[70px] shrink-0 rounded border border-n40 bg-n20 px-1.5 py-1 text-[10px] text-n700 focus:border-primary focus:outline-none"
                    aria-label="MiniMax 清晰度"
                >
                    <option value="768P">768P</option>
                    <option value="1080P" disabled={params.duration === 10}>1080P</option>
                </select>
                <label className="flex shrink-0 items-center gap-1 text-[10px] text-n300">
                    <input
                        type="checkbox"
                        checked={params.promptOptimizer}
                        onChange={(event) => onChange({ ...params, promptOptimizer: event.target.checked })}
                        className="h-3.5 w-3.5 rounded border-n40 text-primary"
                    />
                    优化
                </label>
                <textarea
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    placeholder="描述动作内容..."
                    className="h-10 min-w-[160px] flex-1 resize-none rounded border border-n40 bg-n20 px-2 py-1 text-xs text-n700 focus:border-primary focus:outline-none"
                />
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-card">
            <div className="flex min-h-[132px] flex-1 flex-col px-4 pb-3 pt-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-n100">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span>首帧/首尾帧生成；输入文字描述动作、镜头和变化过程</span>
                </div>
                <textarea
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    placeholder="输入文字，描述画面内容、运动方式等……"
                    className="min-h-[88px] flex-1 resize-none overflow-y-auto rounded-xl border-0 bg-n20/70 px-3 py-2.5 text-xs leading-5 text-n700 outline-none ring-1 ring-inset ring-n40 transition focus:ring-primary"
                />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-n40 bg-n20/45 px-3 py-2">
                <label className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1 text-[10px] text-n300">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <select
                        value={params.model}
                        onChange={(event) => onChange({ ...params, model: event.target.value })}
                        className="max-w-[160px] border-0 bg-transparent p-0 text-[10px] font-semibold text-n700 focus:outline-none"
                        aria-label="MiniMax 模型"
                    >
                        {panelModelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <label className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1 text-[10px] text-n300">
                    <Clock3 className="h-3 w-3" />
                    <select
                        value={params.duration}
                        onChange={(event) => setDuration(Number(event.target.value) as MiniMaxVideoDuration)}
                        className="border-0 bg-transparent p-0 text-[10px] font-semibold text-n700 focus:outline-none"
                    >
                        <option value={6}>6 秒</option>
                        <option value={10} disabled={params.resolution === '1080P'}>10 秒</option>
                    </select>
                </label>
                <label className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1 text-[10px] text-n300">
                    <Monitor className="h-3 w-3" />
                    <select
                        value={params.resolution}
                        onChange={(event) => setResolution(event.target.value as MiniMaxVideoResolution)}
                        className="border-0 bg-transparent p-0 text-[10px] font-semibold text-n700 focus:outline-none"
                    >
                        <option value="768P">768P</option>
                        <option value="1080P" disabled={params.duration === 10}>1080P</option>
                    </select>
                </label>
                <label className="inline-flex items-center">
                    <span className="flex items-center gap-1.5 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] text-n700">
                        <Wand2 className="h-3 w-3 text-primary" />
                        <input
                            type="checkbox"
                            checked={params.promptOptimizer}
                            onChange={(event) => onChange({ ...params, promptOptimizer: event.target.checked })}
                            className="h-3.5 w-3.5 rounded border-n40 text-primary"
                        />
                        提示优化
                    </span>
                </label>
            </div>
            {validationError && (
                <div className="shrink-0 border-t border-r100 bg-r50 px-3 py-1.5 text-[10px] text-danger">
                    {validationError}
                </div>
            )}
        </div>
    );
};
