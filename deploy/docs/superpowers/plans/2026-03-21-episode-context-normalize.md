# EpisodeContext 数据规范化层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 EpisodeContext 数据入口处添加 snake_case → camelCase 规范化层，一次修复全工作流（MaterialsPage、StoryboardGenPage、AudioStagePage 等）的数据为空/功能异常问题。

**Architecture:** 后端 API 返回 PostgreSQL 原生 snake_case 字段，前端 TypeScript 接口全部 camelCase。当前 EpisodeContext 直接存储 API 原始数据无任何转换，导致下游页面读取 camelCase 属性全为 undefined。修复方案：在 EpisodeContext.loadData() 中统一调用 normalize 函数转换后再存入 state。另修复 WorkspaceApp 导出时的字段名映射错误。

**Tech Stack:** React, TypeScript, FastAPI (Python)

---

## File Structure

- **Modify:** `new_html/contexts/EpisodeContext.tsx` — 核心修改，添加 6 个 normalize 函数 + loadData 应用
- **Modify:** `new_html/WorkspaceApp.tsx` — 修复 handleExportStoryboards 字段映射
- **Sync:** `deploy/new_html/contexts/EpisodeContext.tsx` — 部署同步
- **Sync:** `deploy/new_html/WorkspaceApp.tsx` — 部署同步

参考（只读，不修改）:
- `new_html/types.ts:331-421` — 所有 6 个 TypeScript 接口定义
- `new_html/pages/DesignPage.tsx:70-86` — 已有的 normalizeAsset 实现作为参考模式

---

### Task 1: EpisodeContext 添加 normalize 函数

**Files:**
- Modify: `new_html/contexts/EpisodeContext.tsx:1-15` (imports 区域后，新增函数)

- [ ] **Step 1: 在 EpisodeContext.tsx 的 import 和 interface 之间添加 6 个 normalize 函数**

在第 15 行（`import type { ... } from '../types';`）之后、第 17 行（`interface EpisodeContextValue`）之前插入：

```typescript
/* ============ snake_case → camelCase 规范化 ============ */

function safeArr(v: unknown): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {} }
  return [];
}
function safeObj(v: unknown): Record<string, any> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, any>;
  if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') return p; } catch {} }
  return {};
}

function normalizeStoryboardItem(r: any): StoryboardItemDB {
  return {
    itemId: r.item_id ?? r.itemId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    sceneHeading: r.scene_heading ?? r.sceneHeading ?? '',
    actionText: r.action_text ?? r.actionText ?? '',
    dialogue: r.dialogue ?? '',
    cameraMovement: r.camera_movement ?? r.cameraMovement ?? '',
    imagePrompt: r.image_prompt ?? r.imagePrompt ?? '',
    videoPrompt: r.video_prompt ?? r.videoPrompt ?? '',
    generatedImageUrl: r.generated_image_url ?? r.generatedImageUrl ?? null,
    boundAssets: safeArr(r.bound_assets ?? r.boundAssets),
    status: r.status ?? 'draft',
    dialogueAudioUrl: r.dialogue_audio_url ?? r.dialogueAudioUrl ?? null,
    narrationAudioUrl: r.narration_audio_url ?? r.narrationAudioUrl ?? null,
    sfxAudioUrl: r.sfx_audio_url ?? r.sfxAudioUrl ?? null,
    audioDurationMs: r.audio_duration_ms ?? r.audioDurationMs ?? null,
  };
}

function normalizeAsset(r: any): AssetItem {
  return {
    assetId: String(r.asset_id ?? r.assetId ?? ''),
    projectId: String(r.project_id ?? r.projectId ?? ''),
    episodeId: r.episode_id ?? r.episodeId ?? null,
    assetType: (r.asset_type ?? r.assetType ?? 'character') as AssetItem['assetType'],
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    thumbnailUrl: r.thumbnail_url ?? r.thumbnailUrl ?? null,
    referenceImages: safeArr(r.reference_images ?? r.referenceImages),
    styleParams: safeObj(r.style_params ?? r.styleParams),
    tags: safeArr(r.tags),
    createdBy: String(r.created_by ?? r.createdBy ?? ''),
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
  };
}

function normalizeVideoSegment(r: any): VideoSegment {
  return {
    segmentId: r.segment_id ?? r.segmentId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    storyboardItemId: r.storyboard_item_id ?? r.storyboardItemId ?? null,
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    generationMode: r.generation_mode ?? r.generationMode ?? '',
    model: r.model ?? '',
    inputParams: safeObj(r.input_params ?? r.inputParams),
    videoUrl: r.video_url ?? r.videoUrl ?? null,
    thumbnailUrl: r.thumbnail_url ?? r.thumbnailUrl ?? null,
    durationMs: r.duration_ms ?? r.durationMs ?? null,
    taskId: r.task_id ?? r.taskId ?? null,
    status: r.status ?? 'pending',
  };
}

function normalizeAudioTrack(r: any): AudioTrack {
  return {
    trackId: r.track_id ?? r.trackId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    trackType: r.track_type ?? r.trackType ?? 'bgm',
    name: r.name ?? '',
    audioUrl: r.audio_url ?? r.audioUrl ?? null,
    durationMs: r.duration_ms ?? r.durationMs ?? null,
    startItemId: r.start_item_id ?? r.startItemId ?? null,
    endItemId: r.end_item_id ?? r.endItemId ?? null,
    generationParams: safeObj(r.generation_params ?? r.generationParams),
  };
}

function normalizeEpisodeScript(r: any): EpisodeScript {
  return {
    scriptId: r.script_id ?? r.scriptId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    originalContent: r.original_content ?? r.originalContent ?? '',
    adaptedScript: r.adapted_script ?? r.adaptedScript ?? '',
    metadata: safeObj(r.metadata),
  };
}

function normalizeCharacterVoice(r: any): CharacterVoice {
  return {
    voiceId: r.voice_id ?? r.voiceId ?? '',
    projectId: r.project_id ?? r.projectId ?? '',
    assetId: r.asset_id ?? r.assetId ?? null,
    characterName: r.character_name ?? r.characterName ?? '',
    voiceProvider: r.voice_provider ?? r.voiceProvider ?? null,
    voiceModelId: r.voice_model_id ?? r.voiceModelId ?? null,
    voiceName: r.voice_name ?? r.voiceName ?? null,
    voiceParams: safeObj(r.voice_params ?? r.voiceParams),
    sampleAudioUrl: r.sample_audio_url ?? r.sampleAudioUrl ?? null,
    createdAt: r.created_at ?? r.createdAt ?? '',
    updatedAt: r.updated_at ?? r.updatedAt ?? '',
  };
}
```

---

### Task 2: loadData 中应用规范化

**Files:**
- Modify: `new_html/contexts/EpisodeContext.tsx:94-113` (loadData 中 set* 调用)

- [ ] **Step 1: 修改 loadData 中的 6 个 set 调用，应用 normalize 函数**

将原始代码（第 94-113 行）：

```typescript
      if (scriptRes.success && scriptRes.script) {
        setScript(scriptRes.script);
      }
      if (sbRes.success) {
        setStoryboardItems(sbRes.items || []);
      }
      if (assetRes.success) {
        setAssets(assetRes.assets || []);
      }
      if (audioRes.success) {
        setAudioTracks(audioRes.tracks || []);
      }
      if (videoRes.success) {
        setVideoSegments(videoRes.segments || []);
      }
      if (voiceRes.success && Array.isArray(voiceRes.voices)) {
        setCharacterVoices(voiceRes.voices);
      } else {
        setCharacterVoices([]);
      }
```

替换为：

```typescript
      if (scriptRes.success && scriptRes.script) {
        setScript(normalizeEpisodeScript(scriptRes.script));
      }
      if (sbRes.success) {
        setStoryboardItems((sbRes.items || []).map(normalizeStoryboardItem));
      }
      if (assetRes.success) {
        setAssets((assetRes.assets || []).map(normalizeAsset));
      }
      if (audioRes.success) {
        setAudioTracks((audioRes.tracks || []).map(normalizeAudioTrack));
      }
      if (videoRes.success) {
        setVideoSegments((videoRes.segments || []).map(normalizeVideoSegment));
      }
      if (voiceRes.success && Array.isArray(voiceRes.voices)) {
        setCharacterVoices(voiceRes.voices.map(normalizeCharacterVoice));
      } else {
        setCharacterVoices([]);
      }
```

---

### Task 3: 修复 WorkspaceApp 导出字段映射

**Files:**
- Modify: `new_html/WorkspaceApp.tsx:1768-1783`

- [ ] **Step 1: 修正 handleExportStoryboards 中的字段名映射**

将第 1768-1783 行：

```typescript
              const dbItems = selectedFile.storyboard.items.map((item, idx) => ({
                sort_order: idx,
                scene_heading: item.sceneHeading || item.scene || '',
                action_text: item.actionText || item.description || '',
                dialogue: item.dialogue || '',
                camera_movement: item.cameraMovement || '',
                image_prompt: item.imagePrompt || '',
                video_prompt: item.videoPrompt || '',
                characters: item.characters || [],
                scene: item.scene || '',
                status: 'draft',
              }));
              await batchCreateStoryboardItems(eid, dbItems);
            } catch (e) {
              console.error('导出分镜数据失败:', e);
            }
```

替换为：

```typescript
              const dbItems = selectedFile.storyboard.items.map((item, idx) => ({
                sort_order: idx,
                scene_heading: item.originalText || item.scene || '',
                action_text: item.scriptSegment || '',
                dialogue: item.dialogue || '',
                camera_movement: item.cameraMovement || '',
                image_prompt: item.imagePrompt || '',
                video_prompt: item.videoPrompt || '',
                characters: item.characters || [],
                scene: item.scene || '',
                status: 'draft',
              }));
              await batchCreateStoryboardItems(eid, dbItems);
            } catch (e) {
              console.error('导出分镜数据失败:', e);
              alert('导出分镜数据失败，素材绑定页面可能没有数据。请检查控制台日志。');
            }
```

关键改动：
- `item.sceneHeading` → `item.originalText`（StoryboardItem 类型的正确属性名，见 types.ts:24）
- `item.actionText` → `item.scriptSegment`（types.ts:25）
- `item.description` fallback 删除（StoryboardItem 没有此属性）
- catch 块增加 `alert()` 让用户感知失败

---

### Task 4: 同步到 deploy 目录

**Files:**
- Sync: `deploy/new_html/contexts/EpisodeContext.tsx` ← `new_html/contexts/EpisodeContext.tsx`
- Sync: `deploy/new_html/WorkspaceApp.tsx` ← `new_html/WorkspaceApp.tsx`

- [ ] **Step 1: 复制 EpisodeContext.tsx 到 deploy**
- [ ] **Step 2: 复制 WorkspaceApp.tsx 到 deploy**

---

## 修复验证清单

修复后，以下数据流应全部正常：

1. **ScriptPage → "全部导出"** → 分镜数据写入 DB（字段内容正确）
2. **DesignPage** → 资产卡片正常显示（已有 normalizeAsset，继续兼容）
3. **DesignPage → "导出到素材绑定"** → MaterialsPage 显示分镜+素材（不再为空）
4. **StoryboardGenPage** → 分镜画面生成页面正常（不再空白）
5. **AudioStagePage** → 排序、生成、播放全部正常
6. **GenerationPage** → 视频生成页面继续正常（双格式 helpers 仍兼容）
7. **EpisodeProvider.updateStoryboardDuration** → item.itemId 匹配正确
8. **EpisodeProvider.saveStoryboardItem** → item.itemId 匹配正确
