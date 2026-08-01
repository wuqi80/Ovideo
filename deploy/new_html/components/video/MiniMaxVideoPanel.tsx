import React from 'react';
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
        <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
                <div className="min-w-0">
                    <div className="mb-1 text-[10px] font-medium text-n300">模型</div>
                    <div className="grid h-8 grid-cols-2 overflow-hidden rounded border border-n40">
                        {panelModelOptions.map(option => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => onChange({ ...params, model: option.value })}
                                className={`text-[11px] font-medium transition-colors ${
                                    params.model === option.value
                                        ? 'bg-primary text-white'
                                        : 'bg-n0 text-n700 hover:bg-n20'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
                <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-medium text-n300">时长</span>
                    <select
                        value={params.duration}
                        onChange={(event) => setDuration(Number(event.target.value) as MiniMaxVideoDuration)}
                        className="h-8 w-full rounded border border-n40 bg-n0 px-2 text-[11px] text-n700 focus:border-primary focus:outline-none"
                    >
                        <option value={6}>6 秒</option>
                        <option value={10} disabled={params.resolution === '1080P'}>10 秒</option>
                    </select>
                </label>
                <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-medium text-n300">清晰度</span>
                    <select
                        value={params.resolution}
                        onChange={(event) => setResolution(event.target.value as MiniMaxVideoResolution)}
                        className="h-8 w-full rounded border border-n40 bg-n0 px-2 text-[11px] text-n700 focus:border-primary focus:outline-none"
                    >
                        <option value="768P">768P</option>
                        <option value="1080P" disabled={params.duration === 10}>1080P</option>
                    </select>
                </label>
                <label className="flex min-w-0 items-end pb-1">
                    <span className="flex h-7 w-full items-center gap-2 rounded border border-n40 bg-n0 px-2 text-[11px] text-n700">
                        <input
                            type="checkbox"
                            checked={params.promptOptimizer}
                            onChange={(event) => onChange({ ...params, promptOptimizer: event.target.checked })}
                            className="h-3.5 w-3.5 rounded border-n40 text-primary"
                        />
                        提示词优化
                    </span>
                </label>
            </div>
            <textarea
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder="描述画面与动作内容..."
                className="min-h-[84px] flex-1 resize-none overflow-y-auto rounded border border-n40 bg-n20 px-3 py-2 text-xs leading-5 text-n700 focus:border-primary focus:outline-none"
            />
            {validationError && (
                <div className="shrink-0 rounded border border-r100 bg-r50 px-2 py-1 text-[11px] text-danger">
                    {validationError}
                </div>
            )}
        </div>
    );
};
