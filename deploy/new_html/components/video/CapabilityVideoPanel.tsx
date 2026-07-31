import React from 'react';
import type {
    VideoCapabilityNumberRule,
    VideoModelCapability,
} from '../../services/videoWorkflowService';

interface CapabilityVideoPanelProps {
    capability?: VideoModelCapability;
    value?: Record<string, string | number | boolean>;
    prompt: string;
    onChange: (next: Record<string, string | number | boolean>) => void;
    onPromptChange: (next: string) => void;
}

const CONTROL_LABELS: Record<string, string> = {
    duration: '时长',
    resolution: '清晰度',
    ratio: '画面比例',
    aspect_ratio: '画面比例',
    shot_type: '镜头模式',
    seed: '随机种子',
    negative_prompt: '排除内容',
};

const OPTION_LABELS: Record<string, string> = {
    multi: '智能多镜头',
    single: '单镜头',
};

function isRuleObject(rule: unknown): rule is Record<string, unknown> {
    return !!rule && typeof rule === 'object' && !Array.isArray(rule);
}

export function resolveCapabilityParamValue(
    rule: unknown,
    current: string | number | boolean | undefined,
): string | number | boolean {
    if (current !== undefined) return current;
    if (Array.isArray(rule)) return rule[0] ?? '';
    if (isRuleObject(rule) && rule.default !== undefined) {
        return rule.default as string | number | boolean;
    }
    return '';
}

export const CapabilityVideoPanel: React.FC<CapabilityVideoPanelProps> = ({
    capability,
    value = {},
    prompt,
    onChange,
    onPromptChange,
}) => {
    const rules = capability?.parameter_rules || {};
    const fieldEntries = Object.entries(rules).filter(([key]) => key !== 'normalization_policy');
    const setField = (key: string, next: string | number | boolean) => {
        onChange({ ...value, [key]: next });
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-2" data-testid="capability-video-panel">
            {fieldEntries.length > 0 ? (
                <div className="grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
                    {fieldEntries.map(([key, rule]) => {
                        const label = CONTROL_LABELS[key] || key;
                        const current = resolveCapabilityParamValue(rule, value[key]);
                        if (Array.isArray(rule)) {
                            return (
                                <label key={key} className="min-w-0">
                                    <span className="mb-1 block text-[10px] font-medium text-n300">{label}</span>
                                    <select
                                        value={String(current)}
                                        onChange={event => setField(key, event.target.value)}
                                        className="h-8 w-full rounded border border-n40 bg-n0 px-2 text-[11px] text-n700 focus:border-primary focus:outline-none"
                                    >
                                        {rule.map(option => (
                                            <option key={String(option)} value={String(option)}>
                                                {OPTION_LABELS[String(option)] || String(option)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            );
                        }
                        if (isRuleObject(rule) && rule.type === 'boolean') {
                            return (
                                <label key={key} className="flex min-w-0 items-end pb-1">
                                    <span className="flex h-7 w-full items-center gap-2 rounded border border-n40 bg-n0 px-2 text-[11px] text-n700">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(current)}
                                            onChange={event => setField(key, event.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-n40 text-primary"
                                        />
                                        {label}
                                    </span>
                                </label>
                            );
                        }
                        if (isRuleObject(rule) && (rule.options as unknown[] | undefined)?.length) {
                            const options = rule.options as Array<string | number>;
                            return (
                                <label key={key} className="min-w-0">
                                    <span className="mb-1 block text-[10px] font-medium text-n300">{label}</span>
                                    <select
                                        value={String(current)}
                                        onChange={event => setField(key, Number(event.target.value))}
                                        className="h-8 w-full rounded border border-n40 bg-n0 px-2 text-[11px] text-n700 focus:border-primary focus:outline-none"
                                    >
                                        {options.map(option => (
                                            <option key={String(option)} value={String(option)}>{option}{key === 'duration' ? ' 秒' : ''}</option>
                                        ))}
                                    </select>
                                </label>
                            );
                        }
                        if (isRuleObject(rule) && (rule.type === 'integer' || rule.type === 'number')) {
                            const numericRule = rule as VideoCapabilityNumberRule;
                            return (
                                <label key={key} className="min-w-0">
                                    <span className="mb-1 block text-[10px] font-medium text-n300">{label}</span>
                                    <input
                                        type="number"
                                        value={Number(current)}
                                        min={numericRule.minimum}
                                        max={numericRule.maximum}
                                        onChange={event => setField(key, Number(event.target.value))}
                                        className="h-8 w-full rounded border border-n40 bg-n0 px-2 text-[11px] text-n700 focus:border-primary focus:outline-none"
                                    />
                                </label>
                            );
                        }
                        return (
                            <label key={key} className="col-span-2 min-w-0 xl:col-span-4">
                                <span className="mb-1 block text-[10px] font-medium text-n300">{label}</span>
                                <input
                                    value={String(current)}
                                    onChange={event => setField(key, event.target.value)}
                                    className="h-8 w-full rounded border border-n40 bg-n0 px-2 text-[11px] text-n700 focus:border-primary focus:outline-none"
                                />
                            </label>
                        );
                    })}
                </div>
            ) : (
                <div className="shrink-0 text-[10px] text-n100">该模型使用后台配置的固定生成参数</div>
            )}
            <textarea
                value={prompt}
                onChange={event => onPromptChange(event.target.value)}
                placeholder="描述画面与动作内容..."
                className="min-h-[84px] flex-1 resize-none overflow-y-auto rounded border border-n40 bg-n20 px-3 py-2 text-xs leading-5 text-n700 focus:border-primary focus:outline-none"
            />
        </div>
    );
};
