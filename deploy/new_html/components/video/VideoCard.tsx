// new_html/components/video/VideoCard.tsx
//
// Task 6 视频卡片组合层。包含三类导出：
//
//  1. <SeedancePanelWithCandidates>  — 包装 useSeedanceCandidates，向 SeedanceMultimodalPanel 注入 candidates。
//                                       用作 VideoPage 中现有 <SeedanceMultimodalPanel> 的 drop-in 替换。
//  2. <DurationFieldForGroup>        — 包装 useReactiveDuration + CardDurationField，可挂在任意卡片头部。
//  3. <StoryboardImageArea>          — 占位卡 / 真实图 + 音频徽章统一渲染。
//  4. <VideoCard>                    — 完整卡片（image + duration + seedance），未来可替换内联渲染。
//
// 写在同一个文件里是为了不引入额外公共组件（按 Task 6 约束），同时保留后续重构空间。

import React, { useCallback, useMemo } from 'react';
import { ImageOff } from 'lucide-react';
import * as videoService from '../../services/videoService';
import type { SeedanceParams, SeedanceMediaInput, DashScopeVideoParams } from '../../services/videoService';
import { SeedanceMultimodalPanel } from '../SeedanceMultimodalPanel';
import { SeedanceMentionPromptEditor } from '../SeedanceMentionPromptEditor';
import { DashScopeVideoCard, type DashScopePromptEditorProps } from './DashScopeCards';
import { useSeedanceCandidates } from '../../hooks/useSeedanceCandidates';
import { useReactiveDuration } from '../../hooks/useReactiveDuration';
import { CardDurationField } from './CardDurationField';

// ============================================================================
// 1) Seedance 面板 + candidates 注入器
// ============================================================================

export interface SeedancePanelWithCandidatesProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    disabled?: boolean;
    autoOpenMentionOnMount?: boolean;
    /** storyboard_item.item_id this card maps to. Forwards to useSeedanceCandidates
     *  so @-mention popover scopes storyboard_data + audio to this scene only. */
    storyboardItemId?: string;
    /** 2026-05-20 (Bug 4)：点击 mention token 缩略图时打开外层 lightbox。 */
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
}

export const SeedancePanelWithCandidates: React.FC<SeedancePanelWithCandidatesProps> = ({
    value, onChange, disabled, autoOpenMentionOnMount, storyboardItemId, onPreviewMedia,
}) => {
    const { candidates } = useSeedanceCandidates({
        currentParams: value,
        currentStoryboardItemId: storyboardItemId,
    });
    return (
        <SeedanceMultimodalPanel
            value={value}
            onChange={onChange}
            disabled={disabled}
            candidates={candidates}
            autoOpenMentionOnMount={autoOpenMentionOnMount}
            onPreviewMedia={onPreviewMedia}
        />
    );
};

// ============================================================================
// 1b) DashScope 卡 + candidates 注入器（mention + 素材库）
//    2026-05-25 #3 — 让 Kling/Vidu/HappyHorse 的 prompt 也支持 @ 素材库 + 分镜
// ============================================================================

export interface DashScopeCardWithCandidatesProps {
    params: DashScopeVideoParams;
    onChange: (next: DashScopeVideoParams) => void;
    onPickImage: (cb: (m: SeedanceMediaInput) => void) => void;
    onPreviewImage?: (url: string) => void;
    disabled?: boolean;
    /** storyboard_item.item_id 用于把 candidates 的 storyboard_data / audio scope 到本卡 */
    storyboardItemId?: string;
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
}

export const DashScopeCardWithCandidates: React.FC<DashScopeCardWithCandidatesProps> = (p) => {
    // 适配：useSeedanceCandidates 签名是 SeedanceParams；DashScope 的 prompt + media_inputs
    // 与之结构兼容，构造 minimal SeedanceParams 视图即可。
    const adapted = useMemo<SeedanceParams>(() => ({
        sub_model: 'standard',
        prompt: p.params.prompt || '',
        media_inputs: p.params.media_inputs || [],
    }), [p.params.prompt, p.params.media_inputs]);

    const { candidates } = useSeedanceCandidates({
        currentParams: adapted,
        currentStoryboardItemId: p.storyboardItemId,
    });

    // PromptEditor adapter：把 SeedanceMentionPromptEditor 的 SeedanceParams onChange
    // 投影回 DashScopeVideoParams。useCallback 保持引用稳定避免 textarea unmount/remount。
    const PromptEditor = useCallback<React.FC<DashScopePromptEditorProps>>((editorProps) => {
        const ep = editorProps;
        const fake: SeedanceParams = {
            sub_model: 'standard',
            prompt: ep.params.prompt || '',
            media_inputs: ep.params.media_inputs || [],
        };
        return (
            <SeedanceMentionPromptEditor
                value={fake}
                onChange={(next) => ep.onChange({
                    ...ep.params,
                    prompt: next.prompt,
                    media_inputs: next.media_inputs,
                })}
                candidates={candidates}
                disabled={ep.disabled}
                placeholder={ep.placeholder}
                onPreviewMedia={p.onPreviewMedia}
                hideTokensRow={true}
            />
        );
    }, [candidates, p.onPreviewMedia]);

    return (
        <DashScopeVideoCard
            params={p.params}
            onChange={p.onChange}
            onPickImage={p.onPickImage}
            onPreviewImage={p.onPreviewImage}
            disabled={p.disabled}
            PromptEditor={PromptEditor}
        />
    );
};

// ============================================================================
// 2) 与 group 绑定的 duration 字段
// ============================================================================

export interface DurationFieldForGroupProps {
    group: videoService.TaskGroup;
    meta: Partial<videoService.StoryboardMeta> | undefined;
    onPatchGroup: (uuid: string, patch: Partial<videoService.TaskGroup>) => void;
    disabled?: boolean;
}

export const DurationFieldForGroup: React.FC<DurationFieldForGroupProps> = ({
    group, meta, onPatchGroup, disabled,
}) => {
    const dur = useReactiveDuration({
        groupUuid: group.uuid,
        durationUserOverride: !!group.durationUserOverride,
        meta: meta || {},
        currentDuration: group.duration,
        onChange: (d, override) => onPatchGroup(group.uuid, { duration: d, durationUserOverride: override }),
    });
    return (
        <CardDurationField
            duration={dur.duration}
            userOverride={dur.userOverride}
            onChange={dur.setUserDuration}
            onClear={dur.clearOverride}
            disabled={disabled}
        />
    );
};

// ============================================================================
// 3) 图片预览区（占位卡 + 真实图 + 音频徽章）
// ============================================================================

export interface StoryboardImageAreaProps {
    image: videoService.UploadedImage;
    meta?: Partial<videoService.StoryboardMeta>;
    /**
     * 真实图片的 className（兼容卡片视图与列表视图的不同高度）
     */
    imgClassName?: string;
    /**
     * 占位卡的高度 className（与 imgClassName 对齐，避免布局抖动）
     */
    placeholderClassName?: string;
    onClick?: () => void;
    showBadges?: boolean;
}

export const StoryboardImageArea: React.FC<StoryboardImageAreaProps> = ({
    image, meta, imgClassName, placeholderClassName, onClick, showBadges = true,
}) => {
    const placeholderClass =
        placeholderClassName ??
        'w-full aspect-video bg-n30 border border-dashed border-n40 rounded flex flex-col items-center justify-center text-n100';

    const realImgClass =
        imgClassName ?? 'w-full aspect-video object-cover rounded';

    return (
        <div className="w-full" onClick={onClick}>
            {image.isPlaceholder || !image.url ? (
                <div className={placeholderClass} title="空分镜：用 @ 挑选首帧">
                    <ImageOff size={20} />
                    <div className="text-[10px] mt-1">空分镜</div>
                    <div className="text-[9px] mt-0.5">@ 选首帧</div>
                </div>
            ) : (
                <img src={image.url} alt={image.filename} className={realImgClass} />
            )}
            {showBadges && <AudioBadgesRow meta={meta} />}
        </div>
    );
};

// ============================================================================
// 4) 音频徽章独立导出（也可单独嵌入卡片任意位置）
// ============================================================================

export interface AudioBadgesRowProps {
    meta?: Partial<videoService.StoryboardMeta>;
}

export const AudioBadgesRow: React.FC<AudioBadgesRowProps> = ({ meta }) => {
    if (!meta) return null;
    const hasD = !!meta.audioUrls?.dialogue;
    const hasN = !!meta.audioUrls?.narration;
    const hasS = !!meta.audioUrls?.sfx;
    const hasMx = !!meta.mixedAudioUrl;
    if (!(hasD || hasN || hasS)) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {hasD && <span className="px-1 py-0.5 bg-b50 text-b400 rounded text-[9px]">对白</span>}
            {hasN && <span className="px-1 py-0.5 bg-primary-light text-primary rounded text-[9px]">旁白</span>}
            {hasS && <span className="px-1 py-0.5 bg-warning/15 text-warning rounded text-[9px]">音效</span>}
            {hasMx
                ? <span className="px-1 py-0.5 bg-success/15 text-success rounded text-[9px]">已混音</span>
                : <span className="px-1 py-0.5 bg-n30 text-n300 rounded text-[9px]">混音中...</span>}
        </div>
    );
};

// ============================================================================
// 5) 完整 VideoCard（占位 + duration + seedance），用作未来内联卡片重构的目标。
//    当前 VideoPage 仍保留 renderStoryboardCard / renderListViewCard 既有路径，
//    只通过上面的小积木做最小侵入式注入；此组件作为参考实现一并保留。
// ============================================================================

export interface VideoCardProps {
    group: videoService.TaskGroup;
    image: videoService.UploadedImage;
    seedanceParams?: SeedanceParams;
    meta?: Partial<videoService.StoryboardMeta>;
    onPatchGroup: (uuid: string, patch: Partial<videoService.TaskGroup>) => void;
    onPatchSeedance: (uuid: string, params: SeedanceParams) => void;
    disabled?: boolean;
}

function baseEmptySeedanceParams(): SeedanceParams {
    return {
        sub_model: 'standard',
        prompt: '',
        media_inputs: [],
        duration: 5,
    };
}

export const VideoCard: React.FC<VideoCardProps> = (p) => {
    const isSeedance = p.group.model === 'Seedance2' || p.group.model === 'Seedance2Fast';
    const seedanceParams = p.seedanceParams ?? baseEmptySeedanceParams();
    const autoOpenMention =
        !!p.image.isPlaceholder && (seedanceParams.prompt || '').trim() === '@';
    return (
        <div className="bg-n0 rounded-md border border-n40 shadow-card hover:shadow-atlas p-3 flex flex-col gap-2">
            <StoryboardImageArea image={p.image} meta={p.meta} />
            <DurationFieldForGroup
                group={p.group}
                meta={p.meta}
                onPatchGroup={p.onPatchGroup}
                disabled={p.disabled}
            />
            {isSeedance && (
                <SeedancePanelWithCandidates
                    value={seedanceParams}
                    onChange={(next) => p.onPatchSeedance(p.group.uuid, next)}
                    disabled={p.disabled}
                    autoOpenMentionOnMount={autoOpenMention}
                />
            )}
        </div>
    );
};
