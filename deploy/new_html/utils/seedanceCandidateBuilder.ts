// new_html/utils/seedanceCandidateBuilder.ts
// Pure function: builds the SeedanceAssetCandidate[] for the @-mention popover
// from EpisodeContext slices, current SeedanceParams, history, and user files.

import type { SeedanceParams } from '../services/videoService';
import type { SeedanceAssetCandidate, SeedanceMediaKind } from './seedanceMedia';

export interface CandidateBuildContext {
    currentParams: SeedanceParams;
    /** storyboard_item.item_id for the card the popover belongs to.
     *  When set, storyboard_data and per-item audio (dialogue/narration/sfx/mixed)
     *  are scoped to this item; episode-wide materialLibrary.audio is NOT bled in.
     *  characterVoices + audioTracks are episode/project-wide and ALWAYS shown
     *  (they're catalogue resources, not scene-specific).
     *  When undefined (e.g. tests, manual upload card), legacy "all" behavior. */
    currentStoryboardItemId?: string;
    materialLibrary: any;     // MaterialLibrary (loose typing intentional; see types/material.ts)
    storyboardItems: any[];
    historyVideos: any[];
    userFiles: any[];
    /** EpisodeContext.characterVoices — 角色配音库（按角色名聚合，sampleAudioUrl 作为预览音）。 */
    characterVoices?: any[];
    /** EpisodeContext.audioTracks — 项目级背景音 / 音效库。 */
    audioTracks?: any[];
}

function inferKindFromMime(mime: string | undefined): SeedanceMediaKind | null {
    if (!mime) return null;
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return null;
}

// 2026-05-20 (Bug 2): EpisodeContext.normalizeStoryboardItem renames every snake_case
// column to camelCase (item_id → itemId, dialogue_audio_url → dialogueAudioUrl, ...).
// Both shapes flow into useSeedanceCandidates depending on call-site (tests vs runtime),
// so every read goes through this adapter — single source of truth.
function sb(item: any) {
    return {
        itemId:            item.item_id            ?? item.itemId            ?? '',
        sortOrder:         item.sort_order         ?? item.sortOrder         ?? 0,
        sceneHeading:      item.scene_heading      ?? item.sceneHeading      ?? '',
        dialogue:          item.dialogue           ?? '',
        imagePrompt:       item.image_prompt       ?? item.imagePrompt       ?? '',
        videoPrompt:       item.video_prompt       ?? item.videoPrompt       ?? '',
        lines:             item.lines              ?? '',
        generatedImageUrl: item.generated_image_url ?? item.generatedImageUrl ?? '',
        dialogueAudioUrl:  item.dialogue_audio_url  ?? item.dialogueAudioUrl  ?? '',
        narrationAudioUrl: item.narration_audio_url ?? item.narrationAudioUrl ?? '',
        sfxAudioUrl:       item.sfx_audio_url       ?? item.sfxAudioUrl       ?? '',
        mixedAudioUrl:     item.mixed_audio_url     ?? item.mixedAudioUrl     ?? '',
    };
}

export function buildCandidates(ctx: CandidateBuildContext): SeedanceAssetCandidate[] {
    const out: SeedanceAssetCandidate[] = [];

    // 1. current_card
    ctx.currentParams.media_inputs.forEach((m, i) => {
        out.push({
            id: `current_${i}`,
            group: 'current_card',
            kind: m.kind,
            label: `${m.kind === 'image' ? '图片' : m.kind === 'video' ? '视频' : '音频'} #${i + 1}`,
            url: m.url,
            thumbnailUrl: m.kind === 'image' ? m.url : undefined,
        });
    });

    // 2. storyboard_data — text snippets + generated images + prompts (scoped)
    const sbItems = (ctx.storyboardItems || []).map(sb).filter(s =>
        ctx.currentStoryboardItemId ? s.itemId === ctx.currentStoryboardItemId : true
    );
    sbItems.forEach((s) => {
        if (s.sceneHeading) {
            out.push({
                id: `sb_text_heading_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 场景: ${String(s.sceneHeading).slice(0, 16)}`,
                text: s.sceneHeading,
                storyboardItemId: s.itemId,
            });
        }
        if (s.dialogue) {
            out.push({
                id: `sb_text_dialogue_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 台词: ${String(s.dialogue).slice(0, 16)}`,
                text: s.dialogue,
                storyboardItemId: s.itemId,
            });
        }
        if (s.imagePrompt) {
            out.push({
                id: `sb_text_image_prompt_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 图片提示词: ${String(s.imagePrompt).slice(0, 16)}`,
                text: s.imagePrompt,
                storyboardItemId: s.itemId,
            });
        }
        if (s.videoPrompt) {
            out.push({
                id: `sb_text_video_prompt_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 视频提示词: ${String(s.videoPrompt).slice(0, 16)}`,
                text: s.videoPrompt,
                storyboardItemId: s.itemId,
            });
        }
        if (s.lines) {
            out.push({
                id: `sb_text_lines_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 旁白: ${String(s.lines).slice(0, 16)}`,
                text: s.lines,
                storyboardItemId: s.itemId,
            });
        }
        if (s.generatedImageUrl) {
            out.push({
                id: `sb_img_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'image',
                label: `SB-${s.sortOrder} 画面`,
                url: s.generatedImageUrl,
                thumbnailUrl: s.generatedImageUrl,
                storyboardItemId: s.itemId,
            });
        }
    });

    // 3. assets — materialLibrary characters / scenes / props (kind=image)
    const lib = ctx.materialLibrary || {};
    const assetGroups: Array<{ key: string; items: any[] }> = [
        { key: 'characters', items: lib.characters || [] },
        { key: 'scenes',     items: lib.scenes || [] },
        { key: 'props',      items: lib.props || [] },
    ];
    assetGroups.forEach(({ key, items }) => {
        items.forEach((it: any) => {
            const url = it?.currentVersion?.url || it?.url;
            if (!url) return;
            out.push({
                id: `asset_${key}_${it.id}`,
                group: 'assets',
                kind: 'image',
                label: it.name || it.id,
                url,
                thumbnailUrl: url,
            });
        });
    });

    // 4. audio — strict scope:
    //   * if currentStoryboardItemId set → ONLY this item's dialogue/narration/sfx/mixed
    //     (public materialLibrary.audio is NOT bled in)
    //   * else (legacy / upload-only card) → public audio + all storyboard audios
    const sbAudioItems = (ctx.storyboardItems || []).map(sb).filter(s =>
        ctx.currentStoryboardItemId ? s.itemId === ctx.currentStoryboardItemId : true
    );
    sbAudioItems.forEach((s) => {
        const audioFields: Array<[string, string, string]> = [
            ['dialogue',  s.dialogueAudioUrl,  'dialogue'],
            ['narration', s.narrationAudioUrl, 'narration'],
            ['sfx',       s.sfxAudioUrl,       'sfx'],
        ];
        audioFields.forEach(([tag, url]) => {
            if (!url) return;
            out.push({
                id: `audio_sb_${s.itemId}_${tag}`,
                group: 'audio',
                kind: 'audio',
                label: `SB-${s.sortOrder} ${tag}`,
                url,
                storyboardItemId: s.itemId,
            });
        });
        if (s.mixedAudioUrl) {
            out.push({
                id: `audio_sb_${s.itemId}_mixed`,
                group: 'audio',
                kind: 'audio',
                label: `SB-${s.sortOrder} 混音`,
                url: s.mixedAudioUrl,
                storyboardItemId: s.itemId,
            });
        }
    });
    if (!ctx.currentStoryboardItemId) {
        (lib.audio || []).forEach((a: any) => {
            const url = a?.currentVersion?.url || a?.url;
            if (!url) return;
            out.push({
                id: `audio_lib_${a.id}`,
                group: 'audio',
                kind: 'audio',
                label: a.name || a.id,
                url,
                durationMs: a?.currentVersion?.durationMs,
            });
        });
    }

    // 4b. character_voices — 角色配音样本（episode/project-wide，scoped 模式下也显示）
    (ctx.characterVoices || []).forEach((cv: any) => {
        const url = cv.sampleAudioUrl ?? cv.sample_audio_url;
        if (!url) return;
        const character = cv.characterName ?? cv.character_name ?? cv.voiceId ?? cv.voice_id;
        const voice = cv.voiceName ?? cv.voice_name;
        const id = cv.voiceId ?? cv.voice_id;
        out.push({
            id: `cv_${id}`,
            group: 'audio',
            kind: 'audio',
            label: voice ? `${character} · ${voice}` : `${character}`,
            url,
        });
    });

    // 4c. audio_tracks — 项目级 BGM / SFX（episode-wide，scoped 模式下也显示）
    (ctx.audioTracks || []).forEach((t: any) => {
        const url = t.audioUrl ?? t.audio_url;
        if (!url) return;
        const id = t.trackId ?? t.track_id;
        const type = t.trackType ?? t.track_type;
        const name = t.name || id;
        out.push({
            id: `track_${id}`,
            group: 'audio',
            kind: 'audio',
            label: type ? `${name} (${type})` : name,
            url,
            durationMs: t.durationMs ?? t.duration_ms,
        });
    });

    // 5. video_segments — history videos
    (ctx.historyVideos || []).forEach((v: any) => {
        if (!v.url) return;
        out.push({
            id: `vid_${v.id}`,
            group: 'video_segments',
            kind: 'video',
            label: v.label || v.id,
            url: v.url,
            durationMs: v.durationMs,
        });
    });

    // 6. user_files — entity_files (image/video/audio only)
    (ctx.userFiles || []).forEach((f: any) => {
        const kind = inferKindFromMime(f.mime_type);
        if (!kind) return;
        out.push({
            id: `uf_${f.id}`,
            group: 'user_files',
            kind,
            label: f.file_name || f.id,
            url: f.file_url,
            thumbnailUrl: kind === 'image' ? f.file_url : undefined,
        });
    });

    // 7. ark_asset_id — single placeholder entry; user types asset:// in popover
    out.push({
        id: 'ark_input',
        group: 'ark_asset_id',
        kind: 'image',   // popover will let user pick the kind via small chip; default image
        label: '手输 asset://...（远程 ID）',
    });

    return out;
}
