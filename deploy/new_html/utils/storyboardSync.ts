// new_html/utils/storyboardSync.ts
//
// 分镜 → 工作区会话 的同步策略实现。
//
// 三种模式：
//  - add_new:              仅追加 storyboard 上比 session.uploaded_images 新出现的 itemId
//  - overwrite_unmodified: 重写未被用户编辑过的卡片（durationUserOverride === false 且 media_inputs 仅 1 张图）
//  - full_reset:           清空当前 session，并通过返回值 { shouldReimport: true } 通知调用方重新触发导入流程
//
// 单条分镜 → workspace artifacts 的构造逻辑保持与 VideoGenPage.handleImportAll 的一份内联实现一致，
// 这里集中复刻为内部 helper buildArtifacts，避免两处漂移。

import type { SyncMode } from '../components/video/StoryboardSyncModal';
import { generateUUID } from '../services/videoTaskService';
import type { SeedanceParams, ShotType, VideoModel } from '../services/videoModelService';
import type { TaskGroup, UploadedImage } from '../services/videoTaskTypes';
import { buildStoryboardVideoPrompt } from './storyboardVideoPrompt';
import {
    computeReactiveDurationFromMeta,
    patchWorkspaceSession,
    saveWorkspaceSession,
    type StoryboardMeta,
    type WorkspaceSession,
} from '../services/videoWorkspaceService';

interface PerItemArtifacts {
    image: UploadedImage;
    group: TaskGroup;
    sp: SeedanceParams;
    meta: StoryboardMeta;
    prompt: string;
}

function storyboardItemId(item: any): string {
    return String(item?.item_id ?? item?.itemId ?? item?.id ?? '').trim();
}

/**
 * 把一条 storyboard item 翻译成一组 workspace artifacts（image / group / seedance params / meta / prompt）。
 *
 * 与 VideoGenPage.handleImportAll 内联逻辑保持一致：无文本占位卡 prompt='@'、默认模型 Seedance2、
 * 初始 duration 来自 computeReactiveDuration(meta)、有 mixedAudio 时挂 reference_audio。
 */
function buildArtifacts(item: any): PerItemArtifacts | null {
    const itemId = storyboardItemId(item);
    if (!itemId) return null;

    const rawUrl = (item.generated_image_url ?? item.generatedImageUrl ?? '') as string;
    const url = (rawUrl || '').toString().split('?')[0];
    let imgUrl = '';
    let isPlaceholder = true;
    if (url && (url.startsWith('http') || url.startsWith('/'))) {
        imgUrl = url;
        isPlaceholder = false;
    }

    const sortOrder = item.sort_order ?? item.sortOrder ?? 0;
    const prompt = buildStoryboardVideoPrompt(item);

    const audioUrls = {
        dialogue:  item.dialogue_audio_url ?? item.dialogueAudioUrl ?? undefined,
        narration: item.narration_audio_url ?? item.narrationAudioUrl ?? undefined,
        sfx:       item.sfx_audio_url ?? item.sfxAudioUrl ?? undefined,
    };
    const meta: StoryboardMeta = {
        plannedDurationMs: item.planned_duration_ms ?? item.plannedDurationMs ?? undefined,
        audioDurationMs:   item.audio_duration_ms ?? item.audioDurationMs ?? undefined,
        audioUrls: (audioUrls.dialogue || audioUrls.narration || audioUrls.sfx) ? audioUrls : undefined,
        mixedAudioUrl:  item.mixed_audio_url ?? item.mixedAudioUrl ?? undefined,
        mixedAudioHash: item.mixed_audio_hash ?? item.mixedAudioHash ?? undefined,
        sceneHeading: item.scene_heading ?? item.sceneHeading ?? undefined,
        actionText:   item.action_text ?? item.actionText ?? undefined,
        dialogue:     item.dialogue ?? undefined,
        lastSyncedAt: Date.now(),
    };

    const initialDuration = computeReactiveDurationFromMeta(meta);
    const groupUuid = generateUUID();

    const image: UploadedImage = {
        id: itemId,
        url: imgUrl,
        filename: imgUrl ? `storyboard_${sortOrder + 1}.png` : `placeholder_${sortOrder + 1}`,
        storageUrl: imgUrl || undefined,
        uploadTime: Date.now(),
        isPlaceholder,
        storyboardItemId: itemId,
        sortOrder,
        tags: [],
        linkedGroupUuids: [groupUuid],
    };
    const group: TaskGroup = {
        uuid: groupUuid,
        ids: [itemId],
        model: 'Seedance2' as VideoModel,
        shotType: 'single' as ShotType,
        duration: initialDuration,
        durationUserOverride: false,
    };
    const sp: SeedanceParams = {
        sub_model: 'standard',
        prompt: prompt || (isPlaceholder ? '@' : ''),
        // Mirrors VideoGenPage.handleImportAll: reference_image is the default.
        media_inputs: imgUrl
            ? [{ kind: 'image', url: imgUrl, role: 'reference_image' }]
            : [],
        duration: initialDuration,
        ratio: 'adaptive',
        seed: -1,
        watermark: false,
        generate_audio: true,
        camera_fixed: false,
    };
    const refAudio =
        meta.mixedAudioUrl
        || meta.audioUrls?.dialogue
        || meta.audioUrls?.narration
        || meta.audioUrls?.sfx
        || null;
    if (refAudio) {
        sp.media_inputs.push({
            kind: 'audio',
            url: refAudio,
            role: 'reference_audio',
        });
    }
    return { image, group, sp, meta, prompt };
}

export interface ApplySyncResult {
    /**
     * full_reset 模式下置 true，提示调用方在写完空 session 后重新触发 handleImportAll。
     * 其他模式下不需要外部处理。
     */
    shouldReimport?: boolean;
}

/**
 * 按指定策略把 storyboard items 同步到当前 workspace session。
 *
 * 注意 mode='full_reset' 时仅清空会话，调用方应通过返回值再触发 handleImportAll；
 * 这里不直接调用 handleImportAll 是为了避免循环依赖（utils → page）。
 */
export async function applySyncStrategy(
    mode: SyncMode,
    storyboardItems: any[],
    session: WorkspaceSession,
    scope: string | undefined,
): Promise<ApplySyncResult> {
    if (mode === 'full_reset') {
        await saveWorkspaceSession({
            uploaded_images: [],
            task_groups: [],
            image_prompts: {},
            tasks_status: {},
            seedance_params: {},
            storyboard_meta: {},
        }, scope);
        return { shouldReimport: true };
    }

    const wsIds = new Set(
        (session.uploaded_images || []).map(i => i.storyboardItemId).filter(Boolean) as string[]
    );

    if (mode === 'add_new') {
        const newItems = storyboardItems.filter(s => {
            const id = storyboardItemId(s);
            return id && !wsIds.has(id);
        });
        if (newItems.length === 0) return {};

        const addImages: UploadedImage[] = [];
        const addGroups: TaskGroup[] = [];
        const addPrompts: Record<string, string> = {};
        const addMeta: Record<string, StoryboardMeta> = {};
        const addSP: Record<string, SeedanceParams> = {};

        for (const it of newItems) {
            const a = buildArtifacts(it);
            if (!a) continue;
            addImages.push(a.image);
            addGroups.push(a.group);
            if (a.prompt) addPrompts[a.image.id] = a.prompt;
            addMeta[a.image.id] = a.meta;
            addSP[a.group.uuid] = a.sp;
        }

        await patchWorkspaceSession(scope, (cur) => ({
            uploaded_images: [...(cur.uploaded_images || []), ...addImages],
            task_groups:     [...(cur.task_groups || []), ...addGroups],
            image_prompts:   { ...(cur.image_prompts || {}), ...addPrompts },
            seedance_params: { ...(cur.seedance_params || {}), ...addSP },
            storyboard_meta: { ...(cur.storyboard_meta || {}), ...addMeta },
        }));
        return {};
    }

    // mode === 'overwrite_unmodified'
    // 规则：仅当 durationUserOverride === false 且 seedance_params.media_inputs.length <= 1 时认为未编辑
    const sbByItemId = new Map<string, any>();
    for (const s of storyboardItems) {
        const id = storyboardItemId(s);
        if (id) sbByItemId.set(id, s);
    }

    const groups = session.task_groups || [];
    const sps = session.seedance_params || {};
    const meta = session.storyboard_meta || {};

    const newPrompts: Record<string, string> = {};
    const newSP: Record<string, SeedanceParams> = {};
    const newMeta: Record<string, StoryboardMeta> = {};
    const newImages = new Map<string, UploadedImage>();
    for (const img of session.uploaded_images || []) {
        newImages.set(img.id, img);
    }
    const newGroups: TaskGroup[] = [];

    for (const g of groups) {
        const itemId = g.ids?.[0];
        if (!itemId) {
            newGroups.push(g);
            continue;
        }
        const sb = sbByItemId.get(itemId);
        const m = meta[itemId];
        const sp = sps[g.uuid];
        const cardEdited = !!g.durationUserOverride
            || (sp?.media_inputs?.length || 0) > 1;
        const updatedAt = sb ? ((sb as any).updated_at ?? (sb as any).updatedAt) : undefined;
        const updatedTs = updatedAt ? new Date(updatedAt).getTime() : NaN;
        const modifiedSinceSync = sb && m?.lastSyncedAt && Number.isFinite(updatedTs)
            && updatedTs > (m.lastSyncedAt as number);

        if (sb && !cardEdited && modifiedSinceSync) {
            const a = buildArtifacts(sb);
            if (a) {
                newGroups.push({ ...a.group, uuid: g.uuid });
                newSP[g.uuid] = a.sp;
                newMeta[itemId] = a.meta;
                if (a.prompt) newPrompts[itemId] = a.prompt;
                newImages.set(itemId, { ...a.image, linkedGroupUuids: [g.uuid] });
                continue;
            }
        }
        newGroups.push(g);
        if (sp) newSP[g.uuid] = sp;
        if (m) newMeta[itemId] = m;
    }

    await patchWorkspaceSession(scope, (cur) => ({
        uploaded_images: Array.from(newImages.values()),
        task_groups: newGroups,
        image_prompts: { ...(cur.image_prompts || {}), ...newPrompts },
        seedance_params: { ...(cur.seedance_params || {}), ...newSP },
        storyboard_meta: { ...(cur.storyboard_meta || {}), ...newMeta },
    }));
    return {};
}
