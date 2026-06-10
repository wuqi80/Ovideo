# Entity-File 统一迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有内容生成路径统一到 Entity-File 架构，消除双源不同步问题

**Architecture:** 前端生成调用统一传递 entity 参数，后端 `save_generated_file_to_db()` 自动绑定 entity，前端通过 `useEntityFilesQuery` (React Query) 读取 files 表数据展示，legacy 字段仅作兜底

**Tech Stack:** React + TypeScript, React Query (`@tanstack/react-query`), SSE cache invalidation, Python FastAPI backend

**Spec:** `docs/superpowers/specs/2026-04-03-entity-file-unified-migration-design.md`

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `new_html/hooks/useGenerateToEntity.ts` | 统一生成调用封装 hook | 新建 |
| `new_html/pages/DesignPage.tsx` | 设计页面迁移 | 修改 |
| `new_html/services/geminiService.ts` | ComfyUI 工具函数添加 entity 参数 | 修改 |
| `new_html/components/GenerationPage.tsx` | 工具链迁移 | 修改 |
| `new_html/components/MaterialPage.tsx` | 素材页 AI 生成迁移 | 修改 |
| `new_html/pages/MaterialsPage.tsx` | 素材页数据源迁移 | 修改 |
| `new_html/pages/AudioStagePage.tsx` | 配音页 TTS 迁移 | 修改 |
| `new_html/services/apiService.ts` | TTS API 添加 entity 字段 | 修改 |
| `new_html/components/VideoPage.tsx` | 视频页迁移 | 修改 |
| `new_html/services/videoService.ts` | 视频 API 添加 entity 字段 | 修改 |

**迁移范围说明**：

- **Phase 1–5 主要目标**：确保所有生成调用传递 entity 参数到后端，使 files 表有正确的 entity 绑定
- **展示层迁移分两阶段**：Phase 1 (DesignPage) 完整迁移展示层到 `useEntityFilesQuery`；Phase 2–5 先传参数、保留即时 UI 更新 + legacy 兜底展示，展示层完整迁移在后续清理 Phase 处理
- **legacy 写入过渡期**：Phase 4/5 暂保留 legacy 字段写入（`apiUpdateStoryboardItem`），因为 `_sync_legacy_url` 会在 select 文件时自动同步，当前播放/展示仍依赖 legacy 字段，完全移除需要展示层全面迁移后

---

### Task 1: 创建 useGenerateToEntity hook

**Files:**
- Create: `new_html/hooks/useGenerateToEntity.ts`

- [ ] **Step 1: 创建 hook 文件**

```typescript
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useGenerateToEntity(entityType: string, entityId: string | undefined) {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(async <T>(
    generatorFn: () => Promise<T>
  ): Promise<T> => {
    setIsGenerating(true);
    try {
      const result = await generatorFn();
      if (entityId) {
        queryClient.invalidateQueries({ queryKey: ['entityFiles', entityType, entityId] });
      }
      return result;
    } finally {
      setIsGenerating(false);
    }
  }, [entityType, entityId, queryClient]);

  const invalidate = useCallback(() => {
    if (entityId) {
      queryClient.invalidateQueries({ queryKey: ['entityFiles', entityType, entityId] });
    }
  }, [entityType, entityId, queryClient]);

  return { generate, isGenerating, invalidate };
}
```

- [ ] **Step 2: 验证编译**

Run (PowerShell): `Set-Location h:\MY2\new_html; npx tsc --noEmit --skipLibCheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add new_html/hooks/useGenerateToEntity.ts
git commit -m "feat: add useGenerateToEntity hook for unified generation"
```

---

### Task 2: DesignPage 迁移 — 生成路径传递 entity 参数

**Files:**
- Modify: `new_html/pages/DesignPage.tsx`

**参考行号**（基于 subagent 审计结果）：
- `handleAIGeneration`: L196–221
- `handleCameraGenerate`: L224–245
- `handleProcessSubmit`: L248–263
- `handleBatchGenerate`: L266–307
- `handleUploadImage`: L169–182（已有 entity）
- 图片展示区: L383–437

- [ ] **Step 1: 添加 imports**

在 `DesignPage.tsx` 顶部添加：

```typescript
import { useEntityFilesQuery, EntityFile } from '../hooks/useEntityFilesQuery';
import { useSelectFileMutation, useDeleteFileMutation } from '../hooks/useFilesMutation';
import { useGenerateToEntity } from '../hooks/useGenerateToEntity';
```

- [ ] **Step 2: 修改 handleAIGeneration（L196–221）**

当前代码模式：
```typescript
const urls = result.map(...);
const freshData = await getAssets(projectId!, episodeId);
const freshAsset = (freshData.assets || []).find((a: any) => (a.asset_id ?? a.assetId) === payload.assetId);
const existing = freshAsset?.reference_images ?? freshAsset?.referenceImages ?? [];
await updateAsset(payload.assetId, { reference_images: [...existing, ...urls], thumbnail_url: ... });
await reload();
```

改为：
```typescript
const urls = result.map(...);
// 传 entity 参数让后端自动绑定 files 表 — 移除 getAssets/updateAsset
// generateGeminiImageVariant/generateDoubaoImages 的 options 已支持 entityType, entityId, fileRole, episodeId
// 在调用时传入：entityType: 'asset', entityId: payload.assetId, fileRole: 'reference_image', episodeId
// 后端 save_generated_file_to_db 会自动创建 files 记录
// 前端只需 invalidate React Query 缓存
queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', payload.assetId] });
```

具体需要修改的是 API 调用参数，在 `generateGeminiImageVariant()` 或 `generateDoubaoImages()` 的 options 中增加：
```typescript
entityType: 'asset',
entityId: payload.assetId,
fileRole: 'reference_image',
episodeId,
```

然后**移除**以下代码：
- `getAssets(projectId!, episodeId)` 调用
- `freshAsset` 查找逻辑
- `updateAsset(payload.assetId, { reference_images: ... })` 调用
- `await reload()` 调用

替换为：
```typescript
queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', payload.assetId] });
```

需要在组件内添加 `const queryClient = useQueryClient();`。

- [ ] **Step 3: 修改 geminiService.ts — adjustImageAngle 添加 entity 参数**

`adjustImageAngle`（`geminiService.ts` L420–447）是 ComfyUI 路径（`POST /api/generate/angle-adjust`）。
后端 `AngleAdjustRequest`（`cluster_main.py` L4079–4086）**已支持** `entity_type`、`entity_id`、`file_role`、`episode_id`。
但前端 `adjustImageAngle` 的签名只有 `(imageDataUrl, prompt, seed)`，需要扩展：

```typescript
export const adjustImageAngle = async (
    imageDataUrl: string,
    prompt: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    // ... 省略上传逻辑 ...
    body: JSON.stringify({
        image_filename: uploadResult.filename,
        prompt: prompt,
        seed: seed,
        entity_type: entityOptions?.entityType,
        entity_id: entityOptions?.entityId,
        file_role: entityOptions?.fileRole,
        episode_id: entityOptions?.episodeId,
    })
```

**同时修改**同文件中所有其他 ComfyUI 工具函数签名（详见 Task 4A）。

- [ ] **Step 4: 修改 handleCameraGenerate（L224–245）**

在 `adjustImageAngle()` 调用时传入 entity 参数：
```typescript
const result = await adjustImageAngle(baseImage, prompt, seed, {
  entityType: 'asset', entityId: payload.assetId, fileRole: 'reference_image', episodeId,
});
```

移除 `getAssets()` → `updateAsset()` → `reload()` 模式，替换为 `invalidateQueries`。

- [ ] **Step 5: 同样修改 handleProcessSubmit（L248–263）**

同 Step 4 模式。

- [ ] **Step 6: 修改 handleBatchGenerate（L266–307）**

循环内每次生成调用添加 entity 参数：
```typescript
entityType: 'asset',
entityId: asset.assetId,
fileRole: 'reference_image',
episodeId,
```

移除循环内 `getAssets()` → `updateAsset()` 模式。循环结束后 `reload()` 替换为针对各 assetId 的 `invalidateQueries`。

- [ ] **Step 7: 修改图片展示区（L383–437）— 数据源切换**

当前从 `asset.referenceImages` 读取显示。改为：

```typescript
// 对每个 asset，使用 useEntityFilesQuery 获取 files 表数据
// 由于在 map 内不能使用 hook，需要提取为子组件 AssetCard
// 或者在外层使用一个 useMemo 结合所有 assets 的 entity files

// 方案：新建 AssetImageGallery 子组件
// props: { assetId, legacyImages: asset.referenceImages, ... }
// 内部使用 useEntityFilesQuery('asset', assetId, 'reference_image')
// 兜底：如果 files 表无数据且 legacyImages 有值，显示 legacy
```

具体实现：创建一个内部组件 `AssetImageGallery`，接收 `assetId` 和 `legacyImages` 作为 props，内部调用 `useEntityFilesQuery` 并与 legacy 数据合并展示。

- [ ] **Step 8: 添加选图和删图功能**

```typescript
const selectFileMutation = useSelectFileMutation();
const deleteFileMutation = useDeleteFileMutation();

// 选图：点击图片时
const handleSelectImage = (file: EntityFile) => {
  selectFileMutation.mutate({
    fileId: file.fileId,
    entityType: 'asset',
    entityId: assetId,
    fileRole: 'reference_image',
  });
};

// 删图：点击删除按钮时
const handleDeleteImage = (file: EntityFile) => {
  deleteFileMutation.mutate({
    fileId: file.fileId,
    entityType: 'asset',
    entityId: assetId,
  });
};
```

- [ ] **Step 9: 验证编译**

Run (PowerShell): `Set-Location h:\MY2\new_html; npx tsc --noEmit --skipLibCheck`
Expected: 无错误

- [ ] **Step 10: 提交**

```bash
git add new_html/pages/DesignPage.tsx new_html/services/geminiService.ts
git commit -m "feat: migrate DesignPage to Entity-File architecture"
```

---

### Task 3: 运行数据库迁移脚本

**Files:**
- 使用现有: `migrate_existing_files.py`

- [ ] **Step 1: 备份 files 表**

使用 PostgreSQL 客户端（`psql` 或 pgAdmin）连接到**目标环境**数据库执行：

```sql
CREATE TABLE files_backup_20260403 AS SELECT * FROM files;
```

- [ ] **Step 2: 运行迁移脚本**

Run (PowerShell): `Set-Location h:\MY2; python migrate_existing_files.py`

Expected output 类似：
```
=== 开始迁移现有文件到统一 entity files ===
storyboard_items: migrated N URLs
assets: migrated N URLs
video_segments: migrated N URLs
=== 孤儿文件恢复完成: N 个 ===
=== 迁移完成 (恢复孤儿: N) ===
```

- [ ] **Step 3: 验证迁移结果**

```sql
-- 确认 files 表中 entity 绑定数量
SELECT entity_type, file_role, COUNT(*) FROM files 
WHERE entity_type IS NOT NULL AND entity_type != '' 
GROUP BY entity_type, file_role;

-- 确认无重复
SELECT entity_type, entity_id, file_role, file_url, COUNT(*) 
FROM files 
WHERE entity_type IS NOT NULL 
GROUP BY entity_type, entity_id, file_role, file_url 
HAVING COUNT(*) > 1;
```

- [ ] **Step 4: 再次运行验证幂等性**

Run (PowerShell): `Set-Location h:\MY2; python migrate_existing_files.py`
Expected: 迁移数量为 0 或极少（仅新增的数据）

---

### Task 4A: geminiService.ts — ComfyUI 工具函数添加 entity 参数

**Files:**
- Modify: `new_html/services/geminiService.ts`

**已确认**：所有后端 ComfyUI 端点（`/api/generate/angle-adjust`、`/api/generate/human-multi-angle`、`/api/generate/matting`、`/api/generate/image-fusion` 等）的 Request 模型均已包含 `entity_type`、`entity_id`、`file_role`、`episode_id` 可选字段。前端 `geminiService.ts` 中对应函数未透传这些字段。

**需要修改的函数列表**（均在 `geminiService.ts` 中）：

| 函数 | 底层端点 | 行号(约) |
|------|---------|---------|
| `adjustImageAngle` | `/api/generate/angle-adjust` | L420–447 |
| `generateHumanMultiAngle` | `/api/generate/human-multi-angle` | 需确认 |
| `generateAroundAngle` | `/api/generate/around-angle` | 需确认 |
| `generateMatting` | `/api/generate/matting` | 需确认 |
| `generateImageFusion` | `/api/generate/image-fusion` | 需确认 |

- [ ] **Step 1: 为每个 ComfyUI 工具函数添加 entityOptions 参数**

统一模式（以 `adjustImageAngle` 为例，Task 2 Step 3 已完成）：

```typescript
export const someComfyUIFunction = async (
    ...existingParams,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<...> => {
    // ...
    body: JSON.stringify({
        ...existingBody,
        entity_type: entityOptions?.entityType,
        entity_id: entityOptions?.entityId,
        file_role: entityOptions?.fileRole,
        episode_id: entityOptions?.episodeId,
    })
```

对每个函数：找到 `JSON.stringify({...})` 部分，追加 entity 字段。

- [ ] **Step 2: 验证编译**

Run (PowerShell): `Set-Location h:\MY2\new_html; npx tsc --noEmit --skipLibCheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add new_html/services/geminiService.ts
git commit -m "feat: add entity params to ComfyUI tool functions in geminiService"
```

---

### Task 4B: GenerationPage 工具链迁移

**Files:**
- Modify: `new_html/components/GenerationPage.tsx`

**参考行号**（基于审计）：
- Props: L17–29（含 `episodeId?: string`）
- `adjustImageAngleQueued`: L1163
- `generateHumanMultiAngleQueued`: L1208
- `generateAroundAngleQueued`: L1253
- `generateMattingQueued`: L1299
- `generateImageFusionQueued`: L1377–1420
- `generateAutoStoryboardQueued`: L1477
- `generateWithComfyUIWorkflowQueued`: L738–750（已有 entity 参数，作为参考模式）

**`itemId` 说明**：代码中使用 `selectedShot.id`（即 `StoryboardItem.id`），也称 `shot.id`。

- [ ] **Step 1: 确认参考模式**

`generateWithComfyUIWorkflowQueued`（L738–750）已正确传递 entity 参数：
```typescript
{ entityType: 'storyboard_item', entityId: shot.id, fileRole: 'generated_image', episodeId }
```
以此为模板修改其余函数。

- [ ] **Step 2: 修改 adjustImageAngleQueued（L1163）**

当前调用：
```typescript
const result = await adjustImageAngle(baseImage, prompt, params.seed);
```

改为（Task 4A 已扩展函数签名）：
```typescript
const result = await adjustImageAngle(baseImage, prompt, params.seed, {
  entityType: 'storyboard_item',
  entityId: selectedShot.id,
  fileRole: 'generated_image',
  episodeId,
});
```

结果处理（L1165–1181）：**保留** `onUpdateStoryboardItem` 用于即时 UI 更新（`generatedImage: dataUrl` 即时预览），后端异步入库后 `useEntityFilesQuery` 自动刷新。

- [ ] **Step 3: 同样修改 generateHumanMultiAngleQueued（L1208）**

添加 entity 参数。当前结果处理（L1211–1229）是**整表替换** `generatedImages`：
- **保留** `onUpdateStoryboardItem` 用于即时 UI 更新
- 后端写入 files 表后，`useEntityFilesQuery` 自动刷新为权威数据

- [ ] **Step 4: 同样修改其余工具函数**

按相同模式修改：
- `generateAroundAngleQueued`（L1253）— 添加 entity 参数
- `generateMattingQueued`（L1299）— 添加 entity 参数
- `generateImageFusionQueued`（L1377–1420，含 fusion/transfer 两个分支）— 添加 entity 参数
- `generateAutoStoryboardQueued`（L1477）— 添加 entity 参数
- `generateMultiGridStoryboard`（L1501）— 添加 entity 参数

每个函数：
1. API 调用添加 entity 参数（第四参数 `entityOptions`）
2. **保留** `onUpdateStoryboardItem` 用于即时 UI 更新
3. 添加 `queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot.id] })` 触发 files 表刷新

- [ ] **Step 5: 添加 queryClient 引用**

在组件顶部添加：
```typescript
import { useQueryClient } from '@tanstack/react-query';
```

在组件函数内添加：
```typescript
const queryClient = useQueryClient();
```

- [ ] **Step 6: 验证编译**

Run (PowerShell): `Set-Location h:\MY2\new_html; npx tsc --noEmit --skipLibCheck`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add new_html/components/GenerationPage.tsx
git commit -m "feat: migrate GenerationPage tools to Entity-File architecture"
```

---

### Task 5: MaterialPage 迁移

**Files:**
- Modify: `new_html/components/MaterialPage.tsx`
- Modify: `new_html/pages/MaterialsPage.tsx`

**参考行号**（MaterialPage.tsx）：
- Props: L162–178
- `handleMaterialAIGeneration`: L395–443
- `handleThreeViewGenerate`: L540–604
- `handleCameraGenerate`: L606–642
- `handleProcessMaterial`: L494–538
- `handleFileUpload`: L354–382（已有 entity，作为参考）

**参考行号**（MaterialsPage.tsx）：
- `materialLibraryFromDb`: L37–40
- `effectiveLibrary`: L42
- `handleUpdateLibrary`: L104–149
- 渲染传参: L346–361

- [ ] **Step 1: 修改 handleMaterialAIGeneration（L395–443）**

在 `generateGeminiImageVariant` 和 `generateDoubaoImages` 调用中添加 entity 参数：

```typescript
// generateGeminiImageVariant 调用时添加：
entityType: 'asset',
entityId: targetAssetId,  // 需要从 payload 获取或推断
fileRole: 'material_image',
episodeId,
```

保留 `onUpdateLibrary` 逻辑（用于即时 UI 更新），后续 files 表数据将通过 `useEntityFilesQuery` 补充。

- [ ] **Step 2: 修改 handleThreeViewGenerate（L540–604）和 handleCameraGenerate（L606–642）**

同 Step 1 模式，添加 entity 参数。

`handleCameraGenerate` 底层调用 `adjustImageAngle`（ComfyUI），Task 4A 已扩展其签名。调用时传入：
```typescript
await adjustImageAngle(payload.imageUrl, prompt, payload.seed, {
  entityType: 'asset', entityId: targetAssetId, fileRole: 'material_image', episodeId,
});
```

- [ ] **Step 3: 修改 handleProcessMaterial（L494–538）**

同模式，添加 entity 参数。

- [ ] **Step 4: 修改 MaterialsPage.tsx — 增加 files 表数据源**

在 `materialLibraryFromDb` 构建逻辑中（L37–40），增加从 files 表读取 `material_image` 角色的文件，合并到 `materialLibrary`：

```typescript
// 在 MaterialsPage 中，为每个 asset 查询 files 表中的 material_image
// 需要新增一个辅助函数或在 assetsToMaterialLibrary 中增加 files 参数
// 当前阶段：仅增加 files 表数据源作为补充，不替换 referenceImages
```

由于 `materialLibrary` 的构建依赖 `assets` 数组，可以在 `assetsToMaterialLibrary` 函数中增加一个可选的 `entityFiles` 参数，将 files 表数据合并进来。

- [ ] **Step 5: 验证编译**

Run (PowerShell): `Set-Location h:\MY2\new_html; npx tsc --noEmit --skipLibCheck`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add new_html/components/MaterialPage.tsx new_html/pages/MaterialsPage.tsx
git commit -m "feat: migrate MaterialPage to Entity-File architecture"
```

---

### Task 6: AudioStagePage 迁移

**Files:**
- Modify: `new_html/pages/AudioStagePage.tsx`
- Modify: `new_html/services/apiService.ts`

**参考行号**（AudioStagePage.tsx）：
- `runGenerate`: L119–157
- MiniMax TTS 调用: L134–135
- Gemini Speech 调用: L136–137
- 结果持久化: L142–151（`setLocalAudio` + `apiUpdateStoryboardItem`）
- `clips` 构建: L88–97
- 播放 URL 来源: L190

**参考行号**（apiService.ts）：
- `generateSpeech`: L723–730
- `minimaxTTS`: L882–891

**后端已确认**：`SpeechGenRequest`（L1821–1828）和 `MinimaxTTSRequest`（L1959–1969）已包含 `entity_type`、`entity_id`、`file_role`、`episode_id`。

- [ ] **Step 1: 修改 apiService.ts — 扩展 TTS 函数签名**

修改 `generateSpeech`（L723）的 `data` 参数类型，增加 entity 字段：

```typescript
export async function generateSpeech(data: {
  text: string;
  persona?: string;
  emotion?: string;
  entity_type?: string;
  entity_id?: string;
  file_role?: string;
  episode_id?: string;
}) {
```

修改 `minimaxTTS`（L882）的 `data` 参数类型，增加 entity 字段：

```typescript
export async function minimaxTTS(data: {
  text: string;
  voice_id: string;
  model?: string;
  speed?: number;
  pitch?: number;
  emotion?: string;
  entity_type?: string;
  entity_id?: string;
  file_role?: string;
  episode_id?: string;
}) {
```

函数体无需修改（`JSON.stringify(data)` 自动序列化新字段）。

- [ ] **Step 2: 修改 AudioStagePage.tsx — runGenerate 传递 entity 参数**

在 `runGenerate`（L119–157）中，TTS 调用时添加 entity 字段：

```typescript
// MiniMax 分支（L134–135）
const result = await minimaxTTS({
  text: textToSpeak,
  voice_id: voice.voiceModelId,
  speed, emotion, pitch,
  entity_type: 'storyboard_item',
  entity_id: clip.itemId,
  file_role: clip.type === 'narration' ? 'narration_audio' : 'dialogue_audio',
  episode_id: episodeId,
});

// Gemini 分支（L136–137）
const result = await generateSpeech({
  text: textToSpeak,
  persona: voice?.voiceModelId || 'narrator',
  emotion,
  entity_type: 'storyboard_item',
  entity_id: clip.itemId,
  file_role: clip.type === 'narration' ? 'narration_audio' : 'dialogue_audio',
  episode_id: episodeId,
});
```

- [ ] **Step 3: 保留 legacy 写入作为兜底**

暂时**保留** `apiUpdateStoryboardItem(clip.itemId, updateFields)`（L151），确保 `_sync_legacy_url` 不会因为缺少 legacy 字段而出问题。后续清理阶段再移除。

- [ ] **Step 4: 修改播放 URL 来源（可选，当前阶段可跳过）**

当前播放 URL 优先从 `localAudio` 取，其次从 `clips[].audioUrl`（来自 `item.dialogueAudioUrl`）。由于后端已通过 `_sync_legacy_url` 同步 legacy 字段，当前的播放 URL 来源仍然有效。

完整迁移到 `useEntityFilesQuery` 读取播放 URL 需要在每个 clip 维度调用 hook，复杂度较高，可在后续清理阶段处理。

- [ ] **Step 5: 验证编译**

Run (PowerShell): `Set-Location h:\MY2\new_html; npx tsc --noEmit --skipLibCheck`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add new_html/pages/AudioStagePage.tsx new_html/services/apiService.ts
git commit -m "feat: migrate AudioStagePage TTS to Entity-File architecture"
```

---

### Task 7: VideoPage 迁移

**Files:**
- Modify: `new_html/components/VideoPage.tsx`
- Modify: `new_html/services/videoService.ts`

**参考行号**（VideoPage.tsx）：
- `runTask`: L852–926
- `submitTaskQueued` 调用: L904–912
- 轮询结果处理: L943–984
- 会话恢复: L238–321
- 视频卡片展示: L1457, L1483–1484, L1932–2007

**参考行号**（videoService.ts）：
- `submitTask`: L255–263
- `submitTaskQueued`: L653–661

- [ ] **Step 1: 修改 videoService.ts — submitTask 添加 entity 参数**

```typescript
export async function submitTask(
    imageFilename: string,
    imageFilenameEnd: string | null,
    prompt: string,
    model: VideoModel,
    videoFilename?: string,
    audioFilename?: string,
    shotType: ShotType = 'multi',
    entityOptions?: {
      entity_type?: string;
      entity_id?: string;
      file_role?: string;
      episode_id?: string;
    }
): Promise<{ task_id: string }> {
```

在各模型分支的 `requestData` 构建中，添加 entity 字段：
```typescript
requestData = {
    ...requestData,
    entity_type: entityOptions?.entity_type,
    entity_id: entityOptions?.entity_id,
    file_role: entityOptions?.file_role || 'video',
    episode_id: entityOptions?.episode_id,
};
```

同样修改 `submitTaskQueued` 签名，透传 `entityOptions`。

- [ ] **Step 2: 修改 VideoPage.tsx — runTask 传递 entity 参数**

在 `runTask`（L852–926）中，调用 `submitTaskQueued` 时传递 entity 参数：

```typescript
const result = await videoService.submitTaskQueued(
    filename1, filename2, prompt, group.model,
    undefined, undefined, group.shotType || 'multi',
    {
      entity_type: 'video_segment',
      entity_id: uuid,  // 使用 group 的 uuid 作为 segment 标识
      file_role: 'video',
      episode_id: episodeId,
    }
);
```

**注意**：
- `entity_id` 使用 `uuid`（生成任务唯一标识），因为 VideoPage 当前没有 `video_segments` 表的 `segment_id`。后端 `save_generated_file_to_db` 接受任意字符串作为 `entity_id`。
- `episodeId`：VideoPage 通过 props 接收（检查 `VideoPageProps` 中是否有 `episodeId`；如无，需从 URL params 或 context 获取）。实现时需确认数据来源。

- [ ] **Step 3: 保留现有展示逻辑**

视频展示来源优先级：
1. `tasksStatus[uuid].videos`（轮询结果/session 恢复）— 保留
2. 后续可增加 `useEntityFilesQuery('video_segment', segmentId, 'video')` 作为补充

当前阶段主要目标是确保 entity 参数传递到后端，使 files 表有正确的 entity 绑定。展示层迁移可在后续清理阶段处理。

- [ ] **Step 4: 验证编译**

Run (PowerShell): `Set-Location h:\MY2\new_html; npx tsc --noEmit --skipLibCheck`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add new_html/components/VideoPage.tsx new_html/services/videoService.ts
git commit -m "feat: migrate VideoPage to Entity-File architecture"
```

---

### Task 8: 构建与部署

**Files:**
- Deploy: `deploy/new_html/`, `deploy/dist/`

- [ ] **Step 1: 前端构建**

Run (PowerShell): `Set-Location h:\MY2\new_html; npm run build`
Expected: 构建成功，产物输出到 `h:\MY2\dist`

- [ ] **Step 2: 复制修改的源文件到 deploy 目录**

```powershell
# hooks
Copy-Item "h:\MY2\new_html\hooks\useGenerateToEntity.ts" "h:\MY2\deploy\new_html\hooks\" -Force

# pages
Copy-Item "h:\MY2\new_html\pages\DesignPage.tsx" "h:\MY2\deploy\new_html\pages\" -Force
Copy-Item "h:\MY2\new_html\pages\AudioStagePage.tsx" "h:\MY2\deploy\new_html\pages\" -Force
Copy-Item "h:\MY2\new_html\pages\MaterialsPage.tsx" "h:\MY2\deploy\new_html\pages\" -Force

# components
Copy-Item "h:\MY2\new_html\components\GenerationPage.tsx" "h:\MY2\deploy\new_html\components\" -Force
Copy-Item "h:\MY2\new_html\components\MaterialPage.tsx" "h:\MY2\deploy\new_html\components\" -Force
Copy-Item "h:\MY2\new_html\components\VideoPage.tsx" "h:\MY2\deploy\new_html\components\" -Force

# services
Copy-Item "h:\MY2\new_html\services\apiService.ts" "h:\MY2\deploy\new_html\services\" -Force
Copy-Item "h:\MY2\new_html\services\videoService.ts" "h:\MY2\deploy\new_html\services\" -Force
Copy-Item "h:\MY2\new_html\services\geminiService.ts" "h:\MY2\deploy\new_html\services\" -Force
```

- [ ] **Step 3: 复制构建产物**

```powershell
xcopy "h:\MY2\dist\*" "h:\MY2\deploy\dist\" /E /Y
```

- [ ] **Step 4: 验证 deploy 目录完整性**

```powershell
dir h:\MY2\deploy\dist\index.html
dir h:\MY2\deploy\new_html\hooks\useGenerateToEntity.ts
```
Expected: 文件存在

- [ ] **Step 5: 更新 project-memory 文档**

更新 `docs/faq.md`、`docs/data-layer-reference.md`、`docs/frontend.md` 反映本次迁移的变更。

- [ ] **Step 6: 提交**

```bash
git add deploy/ docs/
git commit -m "deploy: Entity-File unified migration build"
```
