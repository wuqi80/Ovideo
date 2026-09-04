import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Upload, X, AlertCircle, Info, Plus, Maximize2, Volume2, Loader2, ImagePlus, Film } from 'lucide-react';
import { uploadAudio, uploadImage, uploadVideoFile } from '../services/videoMediaService';
import {
    getModelDisplayName,
    type SeedanceMediaInput,
    type SeedanceMediaRole,
    type SeedanceParams,
} from '../services/videoModelService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { SeedanceMentionPromptEditor } from './SeedanceMentionPromptEditor';
import { SeedanceAssetPickerModal } from './SeedanceAssetPickerModal';

interface Props {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    disabled?: boolean;
    candidates: SeedanceAssetCandidate[];
    autoOpenMentionOnMount?: boolean;
    /** 2026-05-20 (Bug 4)：mention token 缩略图点击时打开外层 lightbox。 */
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    /** 从上一条已生成视频提取原声，作为当前卡片 reference_audio。 */
    onUsePreviousVideoAudio?: () => void;
    previousVideoAudioBusy?: boolean;
    audioReferenceNotice?: string;
    supportsMultimodal?: boolean;
}

// Role options split per mode (Issue 3/4):
// - 全能参考 (reference): image acts as a generic reference; first/last-frame disallowed
// - 首尾帧 (first_last):  exactly first_frame / last_frame; reference_image disallowed
const ROLE_OPTIONS_REFERENCE: { value: SeedanceMediaRole | ''; label: string }[] = [
    { value: '', label: '无角色' },
    { value: 'reference_image', label: '参考图' },
];
const ROLE_OPTIONS_FIRST_LAST: { value: SeedanceMediaRole | ''; label: string }[] = [
    { value: 'first_frame', label: '首帧' },
    { value: 'last_frame', label: '尾帧' },
];

const RATIO_OPTIONS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p'] as const;
const AGENT_PLAN_RATIO_OPTIONS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
const AGENT_PLAN_RESOLUTION_OPTIONS = ['720p', '1080p'] as const;

const SEEDANCE_TIER_LABELS: Record<SeedanceParams['sub_model'], string> = {
    agent_plan: getModelDisplayName('Seedance15'),
    standard: getModelDisplayName('Seedance2'),
    fast: getModelDisplayName('Seedance2Fast'),
    mini: getModelDisplayName('Seedance2Mini'),
};

export const SeedanceMultimodalPanel: React.FC<Props> = ({
    value,
    onChange,
    disabled,
    candidates,
    autoOpenMentionOnMount,
    onPreviewMedia,
    onUsePreviousVideoAudio,
    previousVideoAudioBusy,
    audioReferenceNotice,
    supportsMultimodal = true,
}) => {
    const [uploadBusy, setUploadBusy] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [promptModalOpen, setPromptModalOpen] = useState(false);
    const imgInputRef = useRef<HTMLInputElement>(null);
    const firstFrameInputRef = useRef<HTMLInputElement>(null);
    const lastFrameInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    const isAgentPlan = value.sub_model === 'agent_plan';
    const images = value.media_inputs.filter(m => m.kind === 'image');
    const videos = value.media_inputs.filter(m => m.kind === 'video');
    const audios = value.media_inputs.filter(m => m.kind === 'audio');

    // Issue 3/4: derive mode from existing media_inputs[].role (no new persisted field).
    const isFirstLastMode = images.some(m => m.role === 'first_frame' || m.role === 'last_frame');
    const mode: 'reference' | 'first_last' = isFirstLastMode ? 'first_last' : 'reference';
    const effectiveMode: 'reference' | 'first_last' = supportsMultimodal ? mode : 'first_last';

    const setMode = useCallback((newMode: 'reference' | 'first_last') => {
        if (newMode === mode) return;
        const nextInputs = value.media_inputs.map((m, idx) => {
            if (m.kind !== 'image') return m;
            if (newMode === 'first_last') {
                // 1st image -> first_frame, 2nd -> last_frame, 3+ cleared (panel will grey them)
                const imgIdx = value.media_inputs.slice(0, idx).filter(x => x.kind === 'image').length;
                if (imgIdx === 0) return { ...m, role: 'first_frame' as SeedanceMediaRole };
                if (imgIdx === 1) return { ...m, role: 'last_frame' as SeedanceMediaRole };
                return { ...m, role: undefined };
            }
            return { ...m, role: 'reference_image' as SeedanceMediaRole };
        });
        onChange({ ...value, media_inputs: nextInputs });
    }, [mode, value, onChange]);

    // 全能参考(r2v) 仅 Seedance 2.0 系列支持；Seedance15 / Agent Plan 走首尾帧兼容。
    const omniEnabled = supportsMultimodal;
    useEffect(() => {
        if (!omniEnabled && mode === 'reference' && images.length > 0) {
            setMode('first_last');
        }
    }, [omniEnabled, mode, images.length, setMode]);

    const validation = useMemo(() => {
        const hasFirst = images.some(m => m.role === 'first_frame');
        const hasLast = images.some(m => m.role === 'last_frame');
        const hasRef = images.some(m => m.role === 'reference_image');
        if ((hasFirst || hasLast) && hasRef) return { ok: false, msg: '首尾帧 与 参考图 不能同时使用' };
        if (hasLast && !hasFirst) return { ok: false, msg: '首帧 / 尾帧 必须成对出现' };
        if (value.media_inputs.length === 0 && !value.prompt.trim()) return { ok: false, msg: '至少提供 1 个媒体或非空提示词' };
        if (audios.length > 0 && images.length === 0 && videos.length === 0) {
            return { ok: false, msg: '不可单独输入音频，必须至少包含 1 张图或 1 段视频' };
        }
        if (!omniEnabled && videos.length > 0) {
            return { ok: false, msg: 'Seedance 1.5 Pro 不支持参考视频，请移除后再提交' };
        }
        if (!omniEnabled && images.length > 2) {
            return { ok: false, msg: '兼容通道最多支持 2 张图片（单图或首尾帧）' };
        }
        if ((value.sub_model === 'fast' || value.sub_model === 'mini') && value.resolution === '1080p') {
            return { ok: false, msg: `${SEEDANCE_TIER_LABELS[value.sub_model]}不支持 1080p` };
        }
        if (images.length > 9) return { ok: false, msg: '图片最多 9 张' };
        if (videos.length > 3) return { ok: false, msg: '参考视频最多 3 个' };
        if (audios.length > 3) return { ok: false, msg: '参考音频最多 3 个' };
        return { ok: true, msg: '' };
    }, [images, videos, audios, value.media_inputs, value.prompt, value.sub_model, value.resolution, omniEnabled]);

    const patch = useCallback((p: Partial<SeedanceParams>) => onChange({ ...value, ...p }), [value, onChange]);

    const addMedia = useCallback((m: SeedanceMediaInput) => {
        onChange({ ...value, media_inputs: [...value.media_inputs, m] });
    }, [value, onChange]);

    const updateMediaRole = useCallback((idx: number, role: SeedanceMediaRole | '') => {
        const next = [...value.media_inputs];
        if (role) next[idx] = { ...next[idx], role: role as SeedanceMediaRole };
        else next[idx] = { ...next[idx], role: undefined };
        onChange({ ...value, media_inputs: next });
    }, [value, onChange]);

    const removeMedia = useCallback((idx: number) => {
        onChange({ ...value, media_inputs: value.media_inputs.filter((_, i) => i !== idx) });
    }, [value, onChange]);

    const setAgentPlanFrame = useCallback((role: 'first_frame' | 'last_frame', url: string) => {
        const otherRole = role === 'first_frame' ? 'last_frame' : 'first_frame';
        const nextInputs = value.media_inputs.filter(m => (
            m.kind !== 'image' || m.role === otherRole
        ));
        onChange({
            ...value,
            media_inputs: [
                ...nextInputs,
                { kind: 'image', url, role },
            ],
        });
    }, [value, onChange]);

    const onPickAgentPlanFrame = useCallback(async (
        role: 'first_frame' | 'last_frame',
        files: FileList | null,
        inputRef: React.RefObject<HTMLInputElement>,
    ) => {
        const file = files?.[0];
        if (!file) return;
        setUploadBusy(true);
        try {
            const result = await uploadImage(file);
            setAgentPlanFrame(role, result.url || (result as any).storage_url);
        } finally {
            setUploadBusy(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    }, [setAgentPlanFrame]);

    const onPickImages = useCallback(async (files: FileList | null) => {
        if (!files) return;
        setUploadBusy(true);
        try {
            const uploadFiles = Array.from(files).slice(0, Math.max(0, 9 - images.length));
            for (const file of uploadFiles) {
                const r = await uploadImage(file);
                addMedia({ kind: 'image', url: r.url || (r as any).storage_url, role: 'reference_image' });
            }
        } finally {
            setUploadBusy(false);
            if (imgInputRef.current) imgInputRef.current.value = '';
        }
    }, [images.length, addMedia]);

    const onPickAudios = useCallback(async (files: FileList | null) => {
        if (!files) return;
        setUploadBusy(true);
        try {
            const uploadFiles = Array.from(files).slice(0, isAgentPlan ? 1 : Math.max(0, 3 - audios.length));
            for (const file of uploadFiles) {
                const r = await uploadAudio(file, 0, 5);
                if (isAgentPlan) {
                    onChange({
                        ...value,
                        media_inputs: [
                            ...value.media_inputs.filter(m => m.kind !== 'audio'),
                            { kind: 'audio', url: r.url, role: 'reference_audio' },
                        ],
                    });
                } else {
                    addMedia({ kind: 'audio', url: r.url, role: 'reference_audio' });
                }
                if (isAgentPlan) break;
            }
        } finally {
            setUploadBusy(false);
            if (audioInputRef.current) audioInputRef.current.value = '';
        }
    }, [audios.length, isAgentPlan, value, onChange, addMedia]);

    const onPickVideos = useCallback(async (files: FileList | null) => {
        if (!files) return;
        setUploadBusy(true);
        try {
            const uploadFiles = Array.from(files).slice(0, Math.max(0, 3 - videos.length));
            for (const file of uploadFiles) {
                const r = await uploadVideoFile(file);
                addMedia({
                    kind: 'video',
                    url: r.url || (r as any).storage_url,
                    role: 'reference_video',
                    duration_seconds: r.duration_seconds ?? undefined,
                });
            }
        } finally {
            setUploadBusy(false);
            if (videoInputRef.current) videoInputRef.current.value = '';
        }
    }, [videos.length, addMedia]);

    const firstFrame = images.find(m => m.role === 'first_frame') || images[0];
    const lastFrame = images.find(m => m.role === 'last_frame') || images[1];
    const firstFrameIndex = firstFrame ? value.media_inputs.indexOf(firstFrame) : -1;
    const lastFrameIndex = lastFrame ? value.media_inputs.indexOf(lastFrame) : -1;
    const selectedAgentPlanResolution = AGENT_PLAN_RESOLUTION_OPTIONS.includes(value.resolution as any)
        ? value.resolution
        : '720p';
    const selectedAgentPlanRatio = AGENT_PLAN_RATIO_OPTIONS.includes(value.ratio as any)
        ? value.ratio
        : '16:9';

    if (isAgentPlan) {
        const renderFrameSlot = (
            role: 'first_frame' | 'last_frame',
            label: string,
            media: SeedanceMediaInput | undefined,
            mediaIndex: number,
            inputRef: React.RefObject<HTMLInputElement>,
        ) => (
            <div className="relative w-[84px] h-[104px] shrink-0 rounded-lg border border-n40 bg-n20 shadow-sm overflow-hidden group">
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={event => onPickAgentPlanFrame(role, event.target.files, inputRef)}
                />
                {media ? (
                    <>
                        <button
                            type="button"
                            onClick={() => onPreviewMedia?.(media.url, 'image')}
                            className="block w-full h-[78px] bg-n30"
                            title={`预览${label}`}
                        >
                            <img src={media.url} alt={label} className="w-full h-full object-cover" />
                        </button>
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={disabled || uploadBusy}
                            className="absolute inset-x-0 bottom-0 h-[26px] bg-n0/95 text-[10px] font-medium text-n700 hover:text-primary"
                        >
                            {label} · 替换
                        </button>
                        <button
                            type="button"
                            onClick={() => removeMedia(mediaIndex)}
                            disabled={disabled}
                            className="absolute right-1 top-1 rounded-full bg-n900/70 p-0.5 text-white hover:bg-danger"
                            aria-label={`删除${label}`}
                        >
                            <X size={10} />
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={disabled || uploadBusy}
                        className="flex h-full w-full flex-col items-center justify-center gap-2 text-n300 hover:border-primary hover:text-primary"
                        title={`添加${label}`}
                    >
                        <ImagePlus size={20} />
                        <span className="text-[10px] font-medium">+ {label}</span>
                    </button>
                )}
            </div>
        );

        return (
            <div className="space-y-3 rounded-xl border border-n40 bg-n0 p-3 shadow-card">
                <div className="flex items-start gap-3 rounded-xl border border-n40 bg-n20/60 p-3">
                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        {renderFrameSlot('first_frame', '首帧', firstFrame, firstFrameIndex, firstFrameInputRef)}
                        {renderFrameSlot('last_frame', '尾帧', lastFrame, lastFrameIndex, lastFrameInputRef)}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                            <div>
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-n800">
                                    <Film size={13} className="text-primary" />
                                    Seedance 1.5 Pro · 首尾帧生成
                                </div>
                                <div className="mt-0.5 text-[9px] text-n100">首帧用于图生视频，尾帧可选；不再使用九图参考模式</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPromptModalOpen(true)}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-primary hover:bg-primary-light"
                            >
                                <Maximize2 size={11} /> 放大编辑
                            </button>
                        </div>
                        <SeedanceMentionPromptEditor
                            value={value}
                            onChange={onChange}
                            candidates={candidates.filter(candidate => candidate.kind === 'text')}
                            disabled={disabled}
                            autoOpenOnMount={autoOpenMentionOnMount}
                            rows={5}
                            placeholder="输入画面内容、动作和运镜方式，例如：人物缓慢转身，镜头平稳推进……"
                            onPreviewMedia={onPreviewMedia}
                        />
                    </div>
                </div>

                <section className="rounded-xl border border-n40 bg-n0 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                            <div className="text-[10px] font-semibold text-n700">参考配音</div>
                            <div className="text-[9px] text-n100">保留上一条原声或上传音频，切换支持参考音频的模型后可直接复用</div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            {onUsePreviousVideoAudio && (
                                <button
                                    type="button"
                                    onClick={onUsePreviousVideoAudio}
                                    disabled={disabled || previousVideoAudioBusy}
                                    className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-n0 px-2 py-1 text-[10px] text-success hover:bg-success hover:text-white disabled:opacity-40"
                                >
                                    {previousVideoAudioBusy ? <Loader2 size={11} className="animate-spin" /> : <Volume2 size={11} />}
                                    上一条原声
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => audioInputRef.current?.click()}
                                disabled={disabled || uploadBusy}
                                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] text-white hover:bg-primary-hover disabled:opacity-40"
                            >
                                <Upload size={11} /> 上传配音
                            </button>
                            <input
                                ref={audioInputRef}
                                type="file"
                                accept="audio/*"
                                hidden
                                onChange={event => onPickAudios(event.target.files)}
                            />
                        </div>
                    </div>
                    {audios[0] ? (
                        <div className="flex items-center justify-between gap-2 rounded-md bg-n20 px-2 py-1.5 text-[10px] text-n500">
                            <span className="min-w-0 truncate" title={audios[0].url}><Volume2 size={11} className="mr-1 inline" />{audios[0].url.split('/').pop()}</span>
                            <button type="button" onClick={() => removeMedia(value.media_inputs.indexOf(audios[0]))} className="text-danger">移除</button>
                        </div>
                    ) : (
                        <div className="rounded-md bg-n20 px-2 py-1.5 text-[10px] text-n100">暂未选择参考配音</div>
                    )}
                    <div className="mt-1.5 flex items-start gap-1 text-[9px] leading-relaxed text-warning">
                        <Info size={10} className="mt-0.5 shrink-0" />
                        <span>{audioReferenceNotice || 'Seedance 1.5 Pro 当前不接收参考音频；音频会保留在卡片中，提交生成时不会发送。'}</span>
                    </div>
                </section>

                <section className="space-y-2 rounded-xl border border-n40 bg-n0 p-3">
                    <div className="grid grid-cols-[1.15fr_1fr] gap-3">
                        <div>
                            <div className="mb-1.5 text-[10px] font-semibold text-n700">画面比例</div>
                            <div className="grid grid-cols-6 gap-1 rounded-lg bg-n20 p-1">
                                {AGENT_PLAN_RATIO_OPTIONS.map(ratio => (
                                    <button
                                        key={ratio}
                                        type="button"
                                        onClick={() => patch({ ratio })}
                                        disabled={disabled}
                                        className={`rounded-md px-1 py-1.5 text-[9px] transition-colors ${selectedAgentPlanRatio === ratio ? 'bg-n0 font-semibold text-primary shadow-sm' : 'text-n300 hover:text-n700'}`}
                                    >
                                        <span className="mx-auto mb-1 block h-2.5 w-4 rounded-[2px] border border-current" />
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="mb-1.5 text-[10px] font-semibold text-n700">选择分辨率</div>
                            <div className="grid grid-cols-2 gap-1 rounded-lg bg-n20 p-1">
                                {AGENT_PLAN_RESOLUTION_OPTIONS.map(resolution => (
                                    <button
                                        key={resolution}
                                        type="button"
                                        onClick={() => patch({ resolution })}
                                        disabled={disabled}
                                        className={`rounded-md px-2 py-2 text-[10px] transition-colors ${selectedAgentPlanResolution === resolution ? 'bg-n0 font-semibold text-primary shadow-sm' : 'text-n300 hover:text-n700'}`}
                                    >
                                        {resolution.toUpperCase()}{resolution === '1080p' ? ' ✦' : ''}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <label className="flex items-center gap-2 rounded-md border border-primary bg-primary-light px-2 py-1.5 text-primary">
                            <input type="checkbox" checked={value.generate_audio !== false} onChange={event => patch({ generate_audio: event.target.checked })} disabled={disabled} />
                            生成配音
                        </label>
                        <label className="flex items-center gap-2 rounded-md border border-n40 bg-n20 px-2 py-1.5 text-n500">
                            <input type="checkbox" checked={!!value.camera_fixed} onChange={event => patch({ camera_fixed: event.target.checked })} disabled={disabled} />
                            固定镜头
                        </label>
                        <label className="flex items-center gap-2 rounded-md border border-n40 bg-n20 px-2 py-1.5 text-n500">
                            <input type="checkbox" checked={!!value.watermark} onChange={event => patch({ watermark: event.target.checked })} disabled={disabled} />
                            添加水印
                        </label>
                    </div>
                    <details className="text-[10px] text-n300">
                        <summary className="cursor-pointer select-none hover:text-primary">高级设置</summary>
                        <label className="mt-2 flex items-center gap-2">
                            <span>Seed</span>
                            <input
                                type="number"
                                value={value.seed ?? -1}
                                onChange={event => patch({ seed: parseInt(event.target.value, 10) })}
                                disabled={disabled}
                                className="w-32 rounded-md border border-n40 bg-n0 px-2 py-1 text-n700"
                            />
                            <span className="text-n100">-1 为随机</span>
                        </label>
                    </details>
                </section>

                <div className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
                    <Info size={11} className="mt-0.5 shrink-0" />
                    <span>Seedance 1.5 Pro 支持单图或首尾帧生成；请仅使用模型产物、预置虚拟人像或已授权真人素材。</span>
                </div>

                {!validation.ok && (
                    <div className="flex items-center gap-1 rounded-md border border-danger/40 bg-r50 px-2 py-1.5 text-[10px] text-danger">
                        <AlertCircle size={11} />{validation.msg}
                    </div>
                )}

                {promptModalOpen && ReactDOM.createPortal(
                    <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-n900/50 backdrop-blur-sm p-4" onMouseDown={event => { if (event.target === event.currentTarget) setPromptModalOpen(false); }}>
                        <div role="dialog" aria-label="放大编辑提示词" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-n40 bg-n0 shadow-bottom">
                            <div className="flex items-center justify-between border-b border-n40 px-4 py-3">
                                <div>
                                    <div className="text-sm font-semibold text-primary">Seedance 1.5 Pro · 提示词编辑</div>
                                    <div className="text-[10px] text-n100">描述画面、动作、运镜和声音</div>
                                </div>
                                <button type="button" onClick={() => setPromptModalOpen(false)} className="rounded p-1.5 text-n300 hover:bg-n20 hover:text-n800" aria-label="关闭"><X size={16} /></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4">
                                <SeedanceMentionPromptEditor value={value} onChange={onChange} candidates={candidates.filter(candidate => candidate.kind === 'text')} disabled={disabled} rows={27} openUpward placeholder="描述动作、镜头、声音……" onPreviewMedia={onPreviewMedia} />
                            </div>
                            <div className="flex justify-end border-t border-n40 px-4 py-3">
                                <button type="button" onClick={() => setPromptModalOpen(false)} className="rounded bg-primary px-4 py-1.5 text-xs text-white hover:bg-primary-hover">完成</button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
            </div>
        );
    }

    if (supportsMultimodal) {
        const totalReferenceCount = images.length + videos.length + audios.length;
        const referenceHint = effectiveMode === 'reference'
            ? `最多输入 15 个参考素材（图片 9、视频 3、配音 3）；输入文字，或输入 @ 选择参考内容。`
            : '添加首帧与可选尾帧，再输入画面、动作和运镜；参考视频会保留但本次不提交。';
        const modeTitle = effectiveMode === 'reference' ? '全能参考' : '首尾帧';

        const renderFrame = (
            role: 'first_frame' | 'last_frame',
            label: string,
            media: SeedanceMediaInput | undefined,
            mediaIndex: number,
            inputRef: React.RefObject<HTMLInputElement>,
        ) => (
            <div className="relative h-[86px] w-[72px] shrink-0 overflow-hidden rounded-xl border border-n40 bg-n20 shadow-sm">
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={event => onPickAgentPlanFrame(role, event.target.files, inputRef)}
                />
                {media ? (
                    <>
                        <button type="button" onClick={() => onPreviewMedia?.(media.url, 'image')} className="block h-full w-full">
                            <img src={media.url} alt={label} className="h-full w-full object-cover" />
                        </button>
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-n900/65 py-1 text-center text-[9px] text-white">{label}</span>
                        <button type="button" onClick={() => removeMedia(mediaIndex)} className="absolute right-1 top-1 rounded-full bg-n900/70 p-0.5 text-white hover:bg-danger" aria-label={`删除${label}`}><X size={9} /></button>
                    </>
                ) : (
                    <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploadBusy} className="flex h-full w-full flex-col items-center justify-center gap-1 text-n100 hover:text-primary" title={`添加${label}`}>
                        <ImagePlus size={17} /><span className="text-[9px]">+ {label}</span>
                    </button>
                )}
            </div>
        );

        return (
            <div className="overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-card" data-testid="seedance-jimeng-composer">
                <div className="flex min-h-[150px] gap-3 p-3">
                    <div className="flex shrink-0 items-start gap-1.5 pt-1">
                        {effectiveMode === 'first_last' ? (
                            <>
                                {renderFrame('first_frame', '首帧', firstFrame, firstFrameIndex, firstFrameInputRef)}
                                <span className="pt-8 text-n100">→</span>
                                {renderFrame('last_frame', '尾帧', lastFrame, lastFrameIndex, lastFrameInputRef)}
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setPickerOpen(true)}
                                disabled={disabled || totalReferenceCount >= 15}
                                className="flex h-[86px] w-[72px] rotate-[-3deg] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-n40 bg-n20 text-n100 shadow-sm transition hover:border-primary hover:text-primary disabled:opacity-40"
                                title="从素材库添加参考内容"
                            >
                                <Plus size={18} /><span className="text-[9px]">参考内容</span>
                            </button>
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="text-[10px] leading-4 text-n100">{referenceHint}</div>
                            <button type="button" onClick={() => setPromptModalOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-primary hover:bg-primary-light">
                                <Maximize2 size={11} />放大编辑
                            </button>
                        </div>
                        <SeedanceMentionPromptEditor
                            value={value}
                            onChange={onChange}
                            candidates={candidates}
                            disabled={disabled}
                            autoOpenOnMount={autoOpenMentionOnMount}
                            rows={5}
                            placeholder={effectiveMode === 'reference'
                                ? '输入文字描述，或输入 @ 选择参考内容……'
                                : '描述首帧到尾帧的变化、动作与运镜……'}
                            onPreviewMedia={onPreviewMedia}
                        />
                    </div>
                </div>

                <div className="border-t border-n40 bg-n20/35 px-3 py-2">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        {value.media_inputs.map((media, index) => (
                            <div key={`${media.kind}-${media.url}-${index}`} className="group/ref relative flex h-11 max-w-[132px] items-center gap-1.5 overflow-hidden rounded-lg border border-n40 bg-n0 pr-6 text-[9px] text-n500">
                                {media.kind === 'image' ? (
                                    <img src={media.url} alt="" className="h-full w-12 shrink-0 object-cover" />
                                ) : (
                                    <span className="flex h-full w-12 shrink-0 items-center justify-center bg-n30 text-n300">{media.kind === 'video' ? <Film size={14} /> : <Volume2 size={14} />}</span>
                                )}
                                <span className="truncate" title={media.url}>{media.kind === 'image' ? '图片参考' : media.kind === 'video' ? '视频参考' : '参考配音'}</span>
                                <button type="button" onClick={() => removeMedia(index)} className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-n100 hover:bg-r50 hover:text-danger" aria-label="移除参考素材"><X size={10} /></button>
                            </div>
                        ))}
                        {totalReferenceCount === 0 && <span className="text-[9px] text-n100">尚未添加额外参考素材</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <label className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] font-medium text-n700">
                            <span>模式</span>
                            <select value={effectiveMode} onChange={event => setMode(event.target.value as 'reference' | 'first_last')} disabled={disabled} className="border-0 bg-transparent p-0 text-[10px] font-semibold text-n800 focus:outline-none" aria-label="Seedance 生成模式">
                                <option value="reference">全能参考</option>
                                <option value="first_last">首尾帧</option>
                            </select>
                        </label>
                        <label className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] text-n300">
                            <span>比例</span>
                            <select value={value.ratio || 'adaptive'} onChange={event => patch({ ratio: event.target.value as SeedanceParams['ratio'] })} disabled={disabled} className="border-0 bg-transparent p-0 text-[10px] font-semibold text-n700 focus:outline-none" aria-label="画面比例">
                                {RATIO_OPTIONS.map(ratio => <option key={ratio} value={ratio}>{ratio === 'adaptive' ? '自动' : ratio}</option>)}
                            </select>
                        </label>
                        <label className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] text-n300">
                            <span>清晰度</span>
                            <select value={value.resolution || '720p'} onChange={event => patch({ resolution: event.target.value as SeedanceParams['resolution'] })} disabled={disabled} className="border-0 bg-transparent p-0 text-[10px] font-semibold text-n700 focus:outline-none" aria-label="分辨率">
                                {RESOLUTION_OPTIONS.map(resolution => {
                                    const unavailable = resolution === '1080p' && (value.sub_model === 'fast' || value.sub_model === 'mini');
                                    return <option key={resolution} value={resolution} disabled={unavailable}>{resolution.toUpperCase()}{unavailable ? '（当前版本不支持）' : ''}</option>;
                                })}
                            </select>
                        </label>
                        <span className="inline-flex items-center rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] font-medium text-n700">{value.duration || 5}s</span>
                        <label className="inline-flex items-center gap-1.5 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] text-n700">
                            <input type="checkbox" checked={value.generate_audio !== false} onChange={event => patch({ generate_audio: event.target.checked })} disabled={disabled} />AI 配音
                        </label>
                        <button type="button" onClick={() => setPickerOpen(true)} disabled={disabled || totalReferenceCount >= 15} className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] text-primary hover:border-primary disabled:opacity-40"><Plus size={11} />素材库</button>
                        <button type="button" onClick={() => imgInputRef.current?.click()} disabled={disabled || uploadBusy || images.length >= 9 || effectiveMode === 'first_last'} className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] text-n500 disabled:opacity-35"><Upload size={11} />图片</button>
                        <button type="button" onClick={() => videoInputRef.current?.click()} disabled={disabled || uploadBusy || videos.length >= 3 || effectiveMode === 'first_last'} className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] text-n500 disabled:opacity-35"><Upload size={11} />视频</button>
                        <button type="button" onClick={() => audioInputRef.current?.click()} disabled={disabled || uploadBusy || audios.length >= 3} className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-[10px] text-n500 disabled:opacity-35"><Volume2 size={11} />配音</button>
                        {onUsePreviousVideoAudio && <button type="button" onClick={onUsePreviousVideoAudio} disabled={disabled || previousVideoAudioBusy || audios.length >= 3} className="inline-flex items-center gap-1 rounded-lg border border-success/40 bg-n0 px-2 py-1.5 text-[10px] text-success disabled:opacity-35">{previousVideoAudioBusy ? <Loader2 size={11} className="animate-spin" /> : <Volume2 size={11} />}上一条原声</button>}
                        <details className="relative text-[10px]">
                            <summary className="cursor-pointer list-none rounded-lg border border-n40 bg-n0 px-2 py-1.5 text-n500">高级设置</summary>
                            <div className="absolute bottom-9 right-0 z-20 w-52 space-y-2 rounded-xl border border-n40 bg-n0 p-3 shadow-bottom">
                                <label className="flex items-center justify-between gap-2 text-n500"><span>随机种子</span><input type="number" value={value.seed ?? -1} onChange={event => patch({ seed: parseInt(event.target.value, 10) })} className="w-20 rounded border border-n40 px-2 py-1" /></label>
                                <label className="flex items-center gap-2 text-n500"><input type="checkbox" checked={!!value.watermark} onChange={event => patch({ watermark: event.target.checked })} />添加水印</label>
                                <div className="text-[9px] leading-4 text-n100">{modeTitle}模式 · {referenceHint}</div>
                            </div>
                        </details>
                        <input ref={imgInputRef} type="file" accept="image/*" multiple hidden onChange={event => onPickImages(event.target.files)} />
                        <input ref={videoInputRef} type="file" accept="video/*" multiple hidden onChange={event => onPickVideos(event.target.files)} />
                        <input ref={audioInputRef} type="file" accept="audio/*" multiple hidden onChange={event => onPickAudios(event.target.files)} />
                    </div>
                    {audioReferenceNotice && <div className="mt-1.5 text-[9px] text-warning">{audioReferenceNotice}</div>}
                    {!validation.ok && <div className="mt-1.5 flex items-center gap-1 text-[10px] text-danger"><AlertCircle size={10} />{validation.msg}</div>}
                </div>

                <SeedanceAssetPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} value={value} onChange={onChange} candidates={candidates} />
                {promptModalOpen && ReactDOM.createPortal(
                    <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-n900/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setPromptModalOpen(false); }}>
                        <div role="dialog" aria-label="放大编辑提示词" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-bottom">
                            <div className="flex items-center justify-between border-b border-n40 px-4 py-3">
                                <div><div className="text-sm font-semibold text-primary">提示词 · 放大编辑</div><div className="text-[10px] text-n100">最多 15 个参考素材；输入文字，或输入 @ 选择参考内容</div></div>
                                <button type="button" onClick={() => setPromptModalOpen(false)} className="rounded p-1.5 text-n300 hover:bg-n20" aria-label="关闭"><X size={16} /></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4"><SeedanceMentionPromptEditor value={value} onChange={onChange} candidates={candidates} disabled={disabled} rows={27} openUpward placeholder="输入文字描述，或输入 @ 选择参考内容……" onPreviewMedia={onPreviewMedia} /></div>
                            <div className="flex justify-end border-t border-n40 px-4 py-3"><button type="button" onClick={() => setPromptModalOpen(false)} className="rounded-lg bg-primary px-4 py-1.5 text-xs text-white hover:bg-primary-hover">完成</button></div>
                        </div>
                    </div>,
                    document.body,
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3 bg-n0 border border-n40 rounded-md p-3 shadow-card">
            <div className="flex items-center justify-between border-b border-n40 pb-2">
                <div>
                    <div className="text-[11px] font-semibold text-primary tracking-wide">
                        {value.sub_model === 'agent_plan' ? 'Seedance 1.5 Pro · Agent Plan' : 'Seedance 2.0 多模态控制台'}
                    </div>
                    <div className="text-[9px] text-n100">
                        {effectiveMode === 'reference'
                            ? '全能参考：图片 0-9 · 视频 0-3 · 音频 0-3'
                            : '首尾帧：首/尾图；支持通道可发送参考配音，视频不发送'}
                    </div>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-primary text-primary bg-primary-light">
                    {SEEDANCE_TIER_LABELS[value.sub_model]}
                </span>
            </div>

            {/* Mode toggle (Issue 3/4) */}
            <div className="flex items-center gap-2 -mt-1">
                <span className="text-[10px] text-n300 shrink-0">模式</span>
                <div className="inline-flex rounded-md border border-n40 bg-n30 overflow-hidden text-[10px]">
                    {omniEnabled && (
                    <button
                        type="button"
                        aria-pressed={mode === 'reference'}
                        onClick={() => setMode('reference')}
                        disabled={disabled}
                        className={`px-2 py-1 transition-colors ${
                            mode === 'reference'
                                ? 'bg-primary text-white'
                                : 'text-n300 hover:text-primary'
                        }`}
                    >
                        全能参考
                    </button>
                    )}
                    <button
                        type="button"
                        aria-pressed={effectiveMode === 'first_last'}
                        onClick={() => setMode('first_last')}
                        disabled={disabled}
                        className={`px-2 py-1 transition-colors ${
                            effectiveMode === 'first_last'
                                ? 'bg-primary text-white'
                                : 'text-n300 hover:text-primary'
                        }`}
                    >
                        首尾帧{!omniEnabled && <span className="ml-1 opacity-70">（兼容通道）</span>}
                    </button>
                </div>
            </div>

            <section className="space-y-1">
                <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-medium text-n700">提示词</div>
                    <div className="flex items-center gap-1">
                        <span className="text-[9px] text-n100">可空，但必须有媒体或文本</span>
                        <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            disabled={disabled}
                            className="ml-1 p-1 text-n700 hover:text-n800 bg-n0 hover:bg-n20 rounded inline-flex items-center gap-0.5 text-[10px]"
                            title="从设计、素材、分镜及通用素材库添加"
                        >
                            <Plus size={11} /> 从库里添加
                        </button>
                        <button
                            type="button"
                            onClick={() => setPromptModalOpen(true)}
                            className="p-1 text-primary hover:text-white bg-n0 hover:bg-primary rounded inline-flex items-center gap-0.5 text-[10px]"
                            title="放大编辑提示词"
                        >
                            <Maximize2 size={11} /> 放大编辑
                        </button>
                    </div>
                </div>
                <SeedanceMentionPromptEditor
                    value={value}
                    onChange={onChange}
                    candidates={candidates}
                    disabled={disabled}
                    autoOpenOnMount={autoOpenMentionOnMount}
                    rows={5}
                    placeholder="描述动作、镜头、声音；@ 选素材..."
                    onPreviewMedia={onPreviewMedia}
                />
                <SeedanceAssetPickerModal
                    open={pickerOpen}
                    onClose={() => setPickerOpen(false)}
                    value={value}
                    onChange={onChange}
                    candidates={candidates}
                />
            </section>

            <section className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="text-[10px] font-medium text-n700">媒体输入</div>
                    <div className="text-[9px] text-n100">不可仅音频</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-n40 bg-n30 p-2 min-h-[122px]">
                        <div className="flex items-center justify-between text-[10px] text-n300 mb-1">
                            <span>图片 {images.length}/9</span>
                            <button
                                onClick={() => imgInputRef.current?.click()}
                                disabled={disabled || uploadBusy || images.length >= 9}
                                className="px-2 py-0.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded text-[10px]"
                            >
                                <Upload size={10} className="inline mr-1" />从外部添加
                            </button>
                            <input ref={imgInputRef} type="file" accept="image/*" multiple hidden
                                   onChange={e => onPickImages(e.target.files)} />
                        </div>
                        {images.length > 0 && (
                            <div className="grid grid-cols-3 gap-1 max-h-28 overflow-y-auto pr-0.5">
                                {value.media_inputs.map((m, i) => m.kind !== 'image' ? null : (
                                    <div key={i} className="relative bg-n0 rounded p-1">
                                        <img src={m.url} alt="" className="w-full h-12 object-cover rounded" />
                                        <select
                                            value={m.role || ''}
                                            onChange={e => updateMediaRole(i, e.target.value as SeedanceMediaRole | '')}
                                            disabled={disabled}
                                            className="w-full mt-1 bg-n0 border border-n40 text-[9px] text-n800 rounded px-1"
                                        >
                                            {(effectiveMode === 'first_last' ? ROLE_OPTIONS_FIRST_LAST : ROLE_OPTIONS_REFERENCE)
                                                .map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                        <button onClick={() => removeMedia(i)} disabled={disabled}
                                            className="absolute top-0 right-0 bg-danger text-white rounded p-0.5">
                                            <X size={8} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div
                        data-section="video"
                        data-greyed={effectiveMode === 'first_last' ? 'true' : 'false'}
                        className={`rounded-md border border-n40 bg-n30 p-2 min-h-[122px] ${
                            effectiveMode === 'first_last' ? 'opacity-30 pointer-events-none' : ''
                        }`}
                        title={effectiveMode === 'first_last' ? '首尾帧模式不发送视频给后端' : ''}
                    >
                        <div className="flex items-center justify-between text-[10px] text-n300 mb-1">
                            <span>视频 {videos.length}/3 {effectiveMode === 'first_last' && '(跳过)'}</span>
                            <button
                                onClick={() => videoInputRef.current?.click()}
                                disabled={disabled || uploadBusy || videos.length >= 3}
                                className="px-2 py-0.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded text-[10px]"
                            >
                                <Upload size={10} className="inline mr-1" />从外部添加
                            </button>
                            <input ref={videoInputRef} type="file" accept="video/*" multiple hidden
                                   onChange={e => onPickVideos(e.target.files)} />
                        </div>
                        {videos.length > 0 && (
                            <ul className="text-[10px] text-n700 space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
                                {value.media_inputs.map((m, i) => m.kind !== 'video' ? null : (
                                    <li key={i} className="flex items-center justify-between bg-n0 rounded px-1 py-0.5">
                                        <span className="truncate">{(m.url || '').split('/').pop()}</span>
                                        <button onClick={() => removeMedia(i)} disabled={disabled}>
                                            <X size={10} className="text-danger" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div
                        data-section="audio"
                        data-greyed={audioReferenceNotice ? 'true' : 'false'}
                        className="rounded-md border border-n40 bg-n30 p-2 min-h-[122px]"
                        title={audioReferenceNotice || ''}
                    >
                        <div className="flex items-start justify-between gap-1 text-[10px] text-n300 mb-1">
                            <span className="pt-0.5">参考配音 {audios.length}/3</span>
                            <div className="flex flex-wrap justify-end gap-1">
                                {onUsePreviousVideoAudio && (
                                    <button
                                        type="button"
                                        onClick={onUsePreviousVideoAudio}
                                        disabled={disabled || previousVideoAudioBusy}
                                        className="px-1.5 py-0.5 bg-n0 hover:bg-success disabled:opacity-40 text-success hover:text-white border border-success/40 rounded text-[10px] inline-flex items-center gap-1"
                                        title="提取上一条已生成视频的原声作为参考配音"
                                    >
                                        {previousVideoAudioBusy ? <Loader2 size={10} className="animate-spin" /> : <Volume2 size={10} />}
                                        上一条原声
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => audioInputRef.current?.click()}
                                    disabled={disabled || uploadBusy || audios.length >= 3}
                                    className="px-1.5 py-0.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded text-[10px] inline-flex items-center gap-1"
                                >
                                    <Upload size={10} />从外部添加
                                </button>
                            </div>
                            <input ref={audioInputRef} type="file" accept="audio/*" multiple hidden
                                   onChange={e => onPickAudios(e.target.files)} />
                        </div>
                        {audioReferenceNotice && (
                            <div className="mb-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-1 text-[9px] leading-relaxed text-warning">
                                {audioReferenceNotice}
                            </div>
                        )}
                        {audios.length > 0 && (
                            <ul className="text-[10px] text-n700 space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
                                {value.media_inputs.map((m, i) => m.kind !== 'audio' ? null : (
                                    <li key={i} className="flex items-center justify-between gap-1 bg-n0 rounded px-1 py-0.5">
                                        <span className="truncate" title={m.url}>{m.url.split('/').pop()}</span>
                                        <button onClick={() => removeMedia(i)} disabled={disabled}>
                                            <X size={10} className="text-danger" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </section>

            <section className="space-y-2 border-t border-n40 pt-2">
                <div className="flex items-center justify-between">
                    <div className="text-[10px] font-medium text-n700">输出参数</div>
                    <div className="text-[9px] text-n100">核心参数默认展开</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <label className="space-y-1">
                        <span className="text-n300">分辨率</span>
                        <select
                            value={value.resolution || '720p'}
                            onChange={e => patch({ resolution: e.target.value as SeedanceParams['resolution'] })}
                            disabled={disabled}
                            className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-n700"
                        >
                            {RESOLUTION_OPTIONS.map(r => {
                                const disabledResolution = r === '1080p' && (value.sub_model === 'fast' || value.sub_model === 'mini');
                                return (
                                <option key={r} value={r} disabled={disabledResolution}>
                                    {r}{disabledResolution ? `（${SEEDANCE_TIER_LABELS[value.sub_model]}不支持）` : ''}
                                </option>
                                );
                            })}
                        </select>
                    </label>

                    <label className="space-y-1">
                        <span className="text-n300">画面比例</span>
                        <select
                            value={value.ratio || 'adaptive'}
                            onChange={e => patch({ ratio: e.target.value as SeedanceParams['ratio'] })}
                            disabled={disabled}
                            className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-n700"
                        >
                            {RATIO_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </label>

                    <label className="space-y-1">
                        <span className="text-n300">Seed</span>
                        <input
                            type="number"
                            value={value.seed ?? -1}
                            onChange={e => patch({ seed: parseInt(e.target.value, 10) })}
                            disabled={disabled}
                            className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-n700"
                        />
                    </label>

                    <label className="flex items-center gap-2 rounded border border-n40 bg-n30 px-2 py-1 text-n700">
                        <input
                            type="checkbox"
                            checked={!!value.watermark}
                            onChange={e => patch({ watermark: e.target.checked })}
                            disabled={disabled}
                        />
                        水印
                    </label>

                    <label className="flex items-center gap-2 rounded border border-primary bg-primary-light px-2 py-1 text-primary">
                        <input
                            type="checkbox"
                            checked={value.generate_audio !== false}
                            onChange={e => patch({ generate_audio: e.target.checked })}
                            disabled={disabled}
                        />
                        AI 配音
                    </label>

                    <label className="col-span-2 flex items-center gap-2 rounded border border-n40 bg-n30 px-2 py-1 text-n100 opacity-70" title="Seedance 2.0 系列不支持 camera_fixed">
                        <input type="checkbox" disabled />
                        固定镜头（仅 1.5pro）
                    </label>
                </div>
            </section>

            <section className="space-y-1">
                <div className="flex items-start gap-1 text-[10px] text-warning bg-warning/15 border border-warning/40 rounded px-1.5 py-1">
                    <Info size={10} className="mt-0.5 shrink-0" />
                    <span>Seedance 2.0 不支持直接上传含真人人脸的图/视频；请使用模型产物、预置虚拟人像或已授权真人素材。</span>
                </div>
                <div className="text-[9px] text-n100">
                    样片任务 ID / draft 仅 1.5pro 支持，2.0 系列不开放。
                </div>
                {videos.length > 0 && (
                    <div className="text-[9px] text-warning">
                        参考视频会按总时长动态核算创作点数；无法读取时长时按每段 15 秒预估。
                    </div>
                )}
            </section>

            {!validation.ok && (
                <div className="flex items-center gap-1 text-[10px] text-danger bg-r50 border border-danger/40 rounded px-1.5 py-1">
                    <AlertCircle size={10} />{validation.msg}
                </div>
            )}

            {/* 放大编辑提示词弹窗：图像与提示词在小面板里会重叠，这里提供大画布全面编辑 */}
            {promptModalOpen && ReactDOM.createPortal(
                <div
                    className="fixed inset-0 z-[9500] flex items-center justify-center bg-n900/50 backdrop-blur-sm p-4"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setPromptModalOpen(false); }}
                >
                    <div
                        role="dialog"
                        aria-label="放大编辑提示词"
                        /* 2026-06-05：放大编辑弹窗整体再放大 1.5 倍（max-w-3xl 768px → max-w-6xl 1152px，max-h 88vh → 94vh） */
                        className="w-full max-w-6xl max-h-[94vh] flex flex-col bg-n0 border border-n40 rounded-md shadow-bottom overflow-hidden"
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-n40">
                            <div>
                                <div className="text-sm font-semibold text-primary">提示词 · 放大编辑</div>
                                <div className="text-[10px] text-n100">@ 从库里添加 · ✨ AI 改写 · 全面修改提示词</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPromptModalOpen(false)}
                                className="p-1.5 rounded hover:bg-n20 text-n300 hover:text-n800 transition-colors"
                                aria-label="关闭"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <SeedanceMentionPromptEditor
                                value={value}
                                onChange={onChange}
                                candidates={candidates}
                                disabled={disabled}
                                rows={27}
                                openUpward
                                placeholder="描述动作、镜头、声音；@ 选素材..."
                                onPreviewMedia={onPreviewMedia}
                            />
                        </div>
                        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-n40">
                            <button
                                type="button"
                                onClick={() => setPromptModalOpen(false)}
                                className="px-4 py-1.5 text-xs rounded bg-primary hover:bg-primary-hover text-white transition-colors"
                            >
                                完成
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};

export default SeedanceMultimodalPanel;
