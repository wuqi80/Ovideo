# DashScope 三卡紧凑化 + 空卡插入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两件事并行完成：
(A) 把视频页 DashScope 三卡片（合体 Kling / 大乘 Vidu / 炼虚 HappyHorse）的高度压到一屏能看见 2 张以上（仿 Seedance 卡片的「紧凑媒体槽 + 内部分段滚动」做法）。
(B) 让用户能在 storyboard 卡片列表的任意位置插入一张全新的空卡，本地上传图片后跟普通卡片一样选模型生成视频。

**Architecture:**
- 改动**完全限于前端**，不动 backend / DB / API contract。
- Track A：1) 在 `videoCardLayout.ts` 给 DashScope 模型加一个**带 `max-h-[640px] overflow-hidden`** 的高度 class，让 `DashScopeCardShell` 内部的 `overflow-y-auto` 真正生效；2) 在 `DashScopeCards.tsx` 里把媒体槽从 `aspect-video`（卡宽 280 → 158px）换成横向小缩略图（`w-20 h-14` = 56px）；3) 把 ViduCard / HappyHorseCard 里默认 open 的 `<details>` 拍平为 `<section>`（用户明确要求"参数显示都全"）；4) 给 Kling 多镜头自定义列表加内部 `max-h-[160px] overflow-y-auto`。
- Track B：基于已有的 `UploadedImage.isPlaceholder: boolean` 字段（`new_html/services/videoService.ts:125`），新增 `insertEmptyTaskGroup(insertIndex)` 函数，在左侧 group 卡片之间和列表末尾渲染"+ 空卡"按钮；点击空分镜占位区触发 `<input type="file">` 上传，上传完成后把对应 `UploadedImage` 的 `isPlaceholder` 翻为 `false` 并填充 `url`。右侧结果队列因共享 `sortedTaskGroups` 数组自动同步，无需额外逻辑。

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + Vitest + @testing-library/react；已有 `videoService.uploadImage(file, { onProgress })` 工具函数（`new_html/services/videoService.ts`，line 827 处已被 `handleFiles` 流程消费）。

---

## File Structure

| File | Track | 责任 |
|------|-------|------|
| `new_html/utils/videoCardLayout.ts` | A | 新增 `DASHSCOPE_CARD_HEIGHT_CLASS` 常量 + 在 `getCardHeightClass`/`getPreviewImageHeightClass` 中给 DashScope 分支 |
| `new_html/__tests__/utils/videoCardLayout.test.ts` | A | 扩展原有 6 个用例，加 DashScope 三家分支断言 |
| `new_html/components/video/DashScopeCards.tsx` | A | 新增紧凑 `ImageSlot` 变体；KlingCard / ViduCard / HappyHorseCard 应用紧凑槽；Kling 多镜头列表加 max-h；Vidu/HH 的 `<details open>` 改 `<section>` |
| `new_html/__tests__/components/DashScopeCards.test.tsx` | A | 扩展原测试，断言新尺寸与 Vidu/HH 的"无 `<details>`"渲染 |
| `new_html/components/VideoPage.tsx` | B | 新增 `insertEmptyTaskGroup(idx)` + "+ 空卡"按钮 + 空分镜占位区改可点击上传 |
| `new_html/__tests__/components/VideoPage.insertEmptyGroup.test.tsx` | B | 新文件：测试 insertEmptyTaskGroup 行为 + 上传转正行为 |
| `docs/faq.md` & `deploy/docs/faq.md` | A+B | 新增 1 个 entry：「DashScope 卡片太长 / 卡片间插入空卡」symptom-root cause-fix 记录 |

**保持双源同步：** 本仓库使用 `new_html/` 与 `deploy/new_html/` 双源（git history 显示历来如此），每次实现完成后**必须**手工镜像到 `deploy/new_html/`。Track 末尾有专门的镜像 step。

---

## Track A — DashScope 三卡片紧凑化

### Task A1: 给 DashScope 模型加专属高度 class

**Files:**
- Modify: `new_html/utils/videoCardLayout.ts`
- Test: `new_html/__tests__/utils/videoCardLayout.test.ts`

- [ ] **Step 1: 写失败测试 — `getCardHeightClass` 对 DashScope 返回新 class**

在 `new_html/__tests__/utils/videoCardLayout.test.ts` 添加：

```typescript
it('returns DashScope-specific bounded height for Kling/Vidu/HappyHorse', () => {
    // 2026-05-25: COMPACT 只有 min-h 没 max-h 会让 DashScope 卡涨到 ~800px，
    // 加 max-h-[640px] overflow-hidden 让 DashScopeCardShell 内部滚动真正生效。
    const expected = 'min-h-[420px] max-h-[640px] h-full flex flex-col overflow-hidden';
    expect(getCardHeightClass('Kling')).toBe(expected);
    expect(getCardHeightClass('Vidu')).toBe(expected);
    expect(getCardHeightClass('HappyHorse')).toBe(expected);
});

it('keeps COMPACT min-h class for non-DashScope, non-Seedance models', () => {
    expect(getCardHeightClass('Wan2')).toBe('min-h-[420px] h-full flex flex-col');
    expect(getCardHeightClass('Sora2')).toBe('min-h-[420px] h-full flex flex-col');
});
```

- [ ] **Step 2: 运行测试看 FAIL**

Run: `cd new_html && npm test -- videoCardLayout`
Expected: 2 个新用例 FAIL（实际 `getCardHeightClass('Kling')` 返回旧 COMPACT class）

- [ ] **Step 3: 实现 — 在 `videoCardLayout.ts` 加 DashScope 分支**

```typescript
import type { VideoModel } from '../services/videoService';
import { isDashScopeVideoModel } from '../services/videoService';

export const COMPACT_CARD_MIN_HEIGHT_CLASS = 'min-h-[420px] h-full flex flex-col';
export const SEEDANCE_CARD_MIN_HEIGHT_CLASS = 'min-h-[640px] h-full flex flex-col';
// 2026-05-25：DashScope 三家卡片内容自然高度会涨到 600-800px，给 max-h 让内部 overflow 生效
export const DASHSCOPE_CARD_HEIGHT_CLASS = 'min-h-[420px] max-h-[640px] h-full flex flex-col overflow-hidden';

export function isSeedanceModel(model: VideoModel): boolean {
    return model === 'Seedance2' || model === 'Seedance2Fast';
}

export function getCardHeightClass(model: VideoModel): string {
    if (isSeedanceModel(model)) return SEEDANCE_CARD_MIN_HEIGHT_CLASS;
    if (isDashScopeVideoModel(model)) return DASHSCOPE_CARD_HEIGHT_CLASS;
    return COMPACT_CARD_MIN_HEIGHT_CLASS;
}
```

- [ ] **Step 4: 运行测试看 PASS**

Run: `cd new_html && npm test -- videoCardLayout`
Expected: 全部 PASS（含原 6 个 + 新 2 个）

- [ ] **Step 5: 提交**

```bash
git add new_html/utils/videoCardLayout.ts new_html/__tests__/utils/videoCardLayout.test.ts
git commit -m "feat(video-card): bound DashScope card height with max-h-[640px] overflow-hidden"
```

---

### Task A2: DashScope 模型使用紧凑预览图高度

**Files:**
- Modify: `new_html/utils/videoCardLayout.ts`（同 Task A1 文件）
- Test: `new_html/__tests__/utils/videoCardLayout.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
it('compresses preview image heights for DashScope cards (parity with Seedance)', () => {
    // 2026-05-25：DashScope 卡封顶 640，preview h-52 (208px) 太占空间，跟 Seedance 同档
    expect(getPreviewImageHeightClass('Kling', false)).toBe('h-40');
    expect(getPreviewImageHeightClass('Kling', true)).toBe('h-28');
    expect(getPreviewImageHeightClass('Vidu', false)).toBe('h-40');
    expect(getPreviewImageHeightClass('HappyHorse', false)).toBe('h-40');
});
```

- [ ] **Step 2: 运行 FAIL**

Run: `cd new_html && npm test -- videoCardLayout`
Expected: 新用例 FAIL（当前 `getPreviewImageHeightClass('Kling', false)` 返回 `'h-52'`）

- [ ] **Step 3: 实现**

```typescript
export function getPreviewImageHeightClass(model: VideoModel, isPair: boolean): string {
    if (isSeedanceModel(model) || isDashScopeVideoModel(model)) {
        return isPair ? 'h-28' : 'h-40';
    }
    return isPair ? 'h-32' : 'h-52';
}
```

- [ ] **Step 4: 运行 PASS**

Run: `cd new_html && npm test -- videoCardLayout`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add new_html/utils/videoCardLayout.ts new_html/__tests__/utils/videoCardLayout.test.ts
git commit -m "feat(video-card): use compact preview heights (h-40/h-28) for DashScope models"
```

---

### Task A3: 提取紧凑 `CompactImageSlot` 组件 + 单元测试

**目的：** 把 `aspect-video`（卡宽 280 → 158px）换成横向小缩略图（`w-20 h-14` = 56px），节省 100px 垂直空间。新增组件而不改 `ImageSlot`，让 Kling/Vidu 的 morph 双图槽和 i2v 单图槽都能用同一种紧凑形态。

**Files:**
- Modify: `new_html/components/video/DashScopeCards.tsx`
- Test: `new_html/__tests__/components/DashScopeCards.test.tsx`

- [ ] **Step 1: 写失败测试 — 渲染含首帧的 KlingCard，断言图槽用 `w-20 h-14` 而不是 `aspect-video`**

在测试文件加：

```tsx
import { render, screen } from '@testing-library/react';
import { KlingCard } from '../../components/video/DashScopeCards';
import { makeDefaultDashScopeParams } from '../../services/videoService';

describe('KlingCard - compact media slot (2026-05-25)', () => {
    it('uses w-20 h-14 thumbnail strip instead of aspect-video full slot in i2v mode', () => {
        const params = makeDefaultDashScopeParams('Kling');
        params.media_inputs = [{
            kind: 'image', url: 'data:image/png;base64,iVBOR0K=',
            file_id: 'fid-1', role: 'first_frame'
        }];
        const { container } = render(
            <KlingCard
                params={params}
                onChange={() => {}}
                onPickImage={() => {}}
            />
        );
        // 紧凑模式应该有 w-20 h-14 类名的图片容器
        expect(container.querySelector('.w-20.h-14')).not.toBeNull();
        // 不应该有 aspect-video 类名（旧大槽）
        expect(container.querySelector('.aspect-video')).toBeNull();
    });
});
```

- [ ] **Step 2: 运行 FAIL**

Run: `cd new_html && npm test -- DashScopeCards`
Expected: 新用例 FAIL（当前用 `aspect-video`）

- [ ] **Step 3: 实现 — 在 DashScopeCards.tsx 加 `CompactImageSlot` 并改 KlingCard 的 i2v / morph 渲染**

在 `// ─── 共享小组件 ────` 区块末尾（Multi​RefRow 之后）加：

```tsx
// 2026-05-25：紧凑图槽（w-20 h-14 缩略图 + 文字按钮），用于单图/双图模式
// 替代原 aspect-video 全宽槽，节省 ~100px 垂直空间
const CompactImageSlot: React.FC<ImageSlotProps & { label: string }> = ({
    media, label, accentBorder, accentBg,
    onUploadClick, onClear, onPreview,
}) => {
    const hasImage = !!media && (media.url || media.file_id);
    const previewUrl = media?.url && (media.url.startsWith('http') || media.url.startsWith('data:'))
        ? media.url : '';
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 shrink-0 w-10">{label}</span>
            {hasImage ? (
                <div className={`relative w-20 h-14 shrink-0 rounded border ${accentBorder} overflow-hidden bg-black group`}>
                    {previewUrl ? (
                        <img src={previewUrl}
                             className="w-full h-full object-cover cursor-zoom-in"
                             onClick={() => onPreview?.(previewUrl)} />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-slate-500 px-1 truncate">
                            {media?.file_id || '已选'}
                        </div>
                    )}
                    <button type="button"
                            onClick={(e) => { e.stopPropagation(); onClear?.(); }}
                            className="absolute top-0 right-0 p-0.5 bg-black/70 hover:bg-red-600 opacity-0 group-hover:opacity-100">
                        <X className="w-2.5 h-2.5 text-white" />
                    </button>
                </div>
            ) : (
                <button type="button" onClick={onUploadClick}
                        className={`w-20 h-14 shrink-0 rounded border border-dashed ${accentBorder} ${accentBg} hover:opacity-90 flex flex-col items-center justify-center text-slate-400`}>
                    <ImagePlus className="w-3.5 h-3.5 mb-0.5" />
                    <span className="text-[9px]">上传</span>
                </button>
            )}
        </div>
    );
};
```

然后改 KlingCard 内 `currentMode === 'i2v'` 和 `currentMode === 'morph'` 的渲染分支（line 422-454 区域）：

```tsx
{currentMode === 'i2v' && (
    <CompactImageSlot
        media={first}
        label="首帧"
        placeholder=""
        accentBorder={theme.accentBorder}
        accentBg={theme.accentBg}
        onUploadClick={() => onPickImage(updateFirst)}
        onClear={() => updateFirst(null)}
        onPreview={onPreviewImage}
    />
)}
{currentMode === 'morph' && (
    <div className="flex items-center gap-3">
        <CompactImageSlot
            media={first}
            label="首"
            placeholder=""
            accentBorder={theme.accentBorder}
            accentBg={theme.accentBg}
            onUploadClick={() => onPickImage(updateFirst)}
            onClear={() => updateFirst(null)}
            onPreview={onPreviewImage}
        />
        <Move className="w-3 h-3 text-slate-500 shrink-0" />
        <CompactImageSlot
            media={last}
            label="尾"
            placeholder=""
            accentBorder={theme.accentBorder}
            accentBg={theme.accentBg}
            onUploadClick={() => onPickImage(updateLast)}
            onClear={() => updateLast(null)}
            onPreview={onPreviewImage}
        />
    </div>
)}
```

（保持 `'refer'` 和 `'multi'` 模式不变。）

- [ ] **Step 4: 运行 PASS**

Run: `cd new_html && npm test -- DashScopeCards`
Expected: 新用例 PASS；原有用例不退化

- [ ] **Step 5: 提交**

```bash
git add new_html/components/video/DashScopeCards.tsx new_html/__tests__/components/DashScopeCards.test.tsx
git commit -m "feat(dashscope-cards): replace aspect-video slot with w-20 h-14 CompactImageSlot in Kling i2v/morph"
```

---

### Task A4: Kling 多镜头自定义列表加内部 max-h 滚动

**Files:**
- Modify: `new_html/components/video/DashScopeCards.tsx`
- Test: `new_html/__tests__/components/DashScopeCards.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
it('Kling multi-shot customize list is wrapped in max-h-[160px] overflow-y-auto', () => {
    const params = makeDefaultDashScopeParams('Kling');
    params.kling_multi_shot = true;
    params.kling_shot_type = 'customize';
    params.kling_multi_prompt = [
        { index: 1, prompt: 'shot 1', duration: 5 },
        { index: 2, prompt: 'shot 2', duration: 5 },
        { index: 3, prompt: 'shot 3', duration: 5 },
    ];
    const { container } = render(
        <KlingCard params={params} onChange={() => {}} onPickImage={() => {}} />
    );
    // 多镜头列表应该有 max-h-[160px] 的滚动容器
    expect(container.querySelector('.max-h-\\[160px\\].overflow-y-auto')).not.toBeNull();
});
```

- [ ] **Step 2: 运行 FAIL**

Run: `cd new_html && npm test -- DashScopeCards`
Expected: FAIL（当前列表无 max-h）

- [ ] **Step 3: 实现 — 包裹 `params.kling_shot_type === 'customize'` 下的列表**

找到 `{params.kling_shot_type === 'customize' && (` 块（DashScopeCards.tsx 约 line 491），把内部的 `<div className="flex flex-col gap-1.5">` 改为：

```tsx
<div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto pr-1">
```

- [ ] **Step 4: 运行 PASS**

Run: `cd new_html && npm test -- DashScopeCards`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add new_html/components/video/DashScopeCards.tsx new_html/__tests__/components/DashScopeCards.test.tsx
git commit -m "feat(dashscope-cards): cap Kling multi-shot customize list at max-h-[160px] with internal scroll"
```

---

### Task A5: ViduCard / HappyHorseCard 把 `<details open>` 改为 `<section>`

**为什么：** 用户明确说"参数显示都全"，不需要折叠。`<details>` 默认展开但允许用户折叠后参数消失，破坏"参数全可见"承诺。

**Files:**
- Modify: `new_html/components/video/DashScopeCards.tsx`
- Test: `new_html/__tests__/components/DashScopeCards.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
it('ViduCard advanced params are in <section>, not collapsible <details>', () => {
    const params = makeDefaultDashScopeParams('Vidu');
    const { container } = render(
        <ViduCard params={params} onChange={() => {}} onPickImage={() => {}} />
    );
    // 不应该有 <details> 元素
    expect(container.querySelector('details')).toBeNull();
    // 高级参数标签应该作为 <section> header 存在
    expect(screen.getByText('高级参数')).toBeInTheDocument();
});

it('HappyHorseCard advanced params are in <section>, not collapsible <details>', () => {
    const params = makeDefaultDashScopeParams('HappyHorse');
    const { container } = render(
        <HappyHorseCard params={params} onChange={() => {}} onPickImage={() => {}} />
    );
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByText('高级参数')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行 FAIL**

Run: `cd new_html && npm test -- DashScopeCards`
Expected: 2 个新用例 FAIL

- [ ] **Step 3: 实现 — 把 `<details open>...</details>` 改为 `<section>`**

ViduCard 内 line ≈798：

```tsx
<section className="border-t border-slate-700/50 pt-2">
    <div className="text-[10px] text-slate-400 mb-1.5">高级参数</div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {/* 原有 4 个 label … */}
    </div>
</section>
```

（删掉 `<details open>` 和 `<summary>`，把内容直接放进 `<section>`。）

HappyHorseCard 内 line ≈966：

```tsx
<section className="border-t border-slate-700/50 pt-2">
    <div className="text-[10px] text-slate-400 mb-1.5">高级参数</div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {/* 原有 2 个 label … */}
    </div>
</section>
```

- [ ] **Step 4: 运行 PASS**

Run: `cd new_html && npm test -- DashScopeCards`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add new_html/components/video/DashScopeCards.tsx new_html/__tests__/components/DashScopeCards.test.tsx
git commit -m "refactor(dashscope-cards): flatten <details open> to <section> in Vidu/HappyHorse (user wants all params always visible)"
```

---

### Task A6: ViduCard 应用 CompactImageSlot 到 startend 模式

**Files:**
- Modify: `new_html/components/video/DashScopeCards.tsx`
- Test: `new_html/__tests__/components/DashScopeCards.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
it('ViduCard startend mode uses CompactImageSlot (w-20 h-14)', () => {
    const params = makeDefaultDashScopeParams('Vidu');
    params.sub_model_vidu = 'q3-turbo';
    params.media_inputs = [
        { kind: 'image', url: 'data:image/png;base64,iVBOR0K=', file_id: 'f1', role: 'first_frame' },
        { kind: 'image', url: 'data:image/png;base64,iVBOR0K=', file_id: 'f2', role: 'last_frame' },
    ];
    const { container } = render(
        <ViduCard params={params} onChange={() => {}} onPickImage={() => {}} />
    );
    const slots = container.querySelectorAll('.w-20.h-14');
    expect(slots.length).toBe(2);  // 首 + 尾
    expect(container.querySelector('.aspect-video')).toBeNull();
});
```

- [ ] **Step 2: 运行 FAIL**

Run: `cd new_html && npm test -- DashScopeCards`
Expected: FAIL

- [ ] **Step 3: 实现 — ViduCard 内 `currentMode === 'startend'` 分支改用 CompactImageSlot**

找到 `currentMode === 'startend' ? (` 块（约 line 719-735）：

```tsx
{currentMode === 'startend' ? (
    <div className="flex items-center gap-3">
        <CompactImageSlot
            media={first} label="首"
            placeholder=""
            accentBorder={theme.accentBorder} accentBg={theme.accentBg}
            onUploadClick={() => onPickImage(updateFirst)}
            onClear={() => updateFirst(null)}
            onPreview={onPreviewImage}
        />
        <Move className="w-3 h-3 text-slate-500 shrink-0" />
        <CompactImageSlot
            media={last} label="尾"
            placeholder=""
            accentBorder={theme.accentBorder} accentBg={theme.accentBg}
            onUploadClick={() => onPickImage(updateLast)}
            onClear={() => updateLast(null)}
            onPreview={onPreviewImage}
        />
    </div>
) : (
    <MultiRefRow ... />  {/* 保留不变 */}
)}
```

- [ ] **Step 4: 运行 PASS**

Run: `cd new_html && npm test -- DashScopeCards`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add new_html/components/video/DashScopeCards.tsx new_html/__tests__/components/DashScopeCards.test.tsx
git commit -m "feat(dashscope-cards): apply CompactImageSlot to Vidu startend mode"
```

---

## Track B — 在 storyboard 任意位置插入空卡

### Task B1: 新增 `insertEmptyTaskGroup(insertIndex)` 函数

**Files:**
- Modify: `new_html/components/VideoPage.tsx`
- Test: `new_html/__tests__/components/VideoPage.insertEmptyGroup.test.tsx` (create)

由于 VideoPage 是个 3000+ 行的大组件，testing-library 渲染成本高。Task B1 把 `insertEmptyTaskGroup` 设计成接受 `setUploadedImages`/`setTaskGroups`/`generateUUID` 注入的**纯函数** helper（在 VideoPage 内部用 useCallback 包，对外测试由下游 Task B2 通过点按钮间接测）。本任务测试**函数本身**的行为。

把 helper 抽到 `new_html/utils/videoTaskInsert.ts` 单独测：

- [ ] **Step 1: 写失败测试 — `new_html/__tests__/utils/videoTaskInsert.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildEmptyTaskGroup } from '../../utils/videoTaskInsert';

describe('buildEmptyTaskGroup (2026-05-25)', () => {
    it('returns { image, group } with image.isPlaceholder=true and group.ids=[image.id]', () => {
        const { image, group } = buildEmptyTaskGroup('Sora2');
        expect(image.isPlaceholder).toBe(true);
        expect(image.url).toBe('');
        expect(image.filename).toBe('空卡片');
        expect(group.ids).toEqual([image.id]);
        expect(group.model).toBe('Sora2');
        expect(group.shotType).toBe('multi');
        expect(typeof group.uuid).toBe('string');
        expect(typeof image.id).toBe('string');
    });

    it('generates fresh ids on each call', () => {
        const a = buildEmptyTaskGroup('Kling');
        const b = buildEmptyTaskGroup('Kling');
        expect(a.image.id).not.toBe(b.image.id);
        expect(a.group.uuid).not.toBe(b.group.uuid);
    });
});
```

- [ ] **Step 2: 运行 FAIL**

Run: `cd new_html && npm test -- videoTaskInsert`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 实现 — `new_html/utils/videoTaskInsert.ts`**

```typescript
import { generateUUID, VideoModel, UploadedImage, TaskGroup } from '../services/videoService';

/**
 * 2026-05-25：构造一个"空卡"任务对——一个 placeholder UploadedImage + 一个关联它的 TaskGroup。
 * 用于在 storyboard 任意位置手工插入新卡，等待本地上传图片后转正。
 */
export function buildEmptyTaskGroup(model: VideoModel): {
    image: UploadedImage;
    group: TaskGroup;
} {
    const imageId = generateUUID();
    const image: UploadedImage = {
        id: imageId,
        url: '',
        filename: '空卡片',
        uploadTime: Date.now(),
        isPlaceholder: true,
    };
    const group: TaskGroup = {
        uuid: generateUUID(),
        ids: [imageId],
        model,
        shotType: 'multi',
    };
    return { image, group };
}
```

- [ ] **Step 4: 运行 PASS**

Run: `cd new_html && npm test -- videoTaskInsert`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add new_html/utils/videoTaskInsert.ts new_html/__tests__/utils/videoTaskInsert.test.ts
git commit -m "feat(video-task-insert): add buildEmptyTaskGroup helper for manual storyboard slot insertion"
```

---

### Task B2: 在 VideoPage 接线 `insertEmptyTaskGroup` + 渲染 "+ 空卡" 按钮

**Files:**
- Modify: `new_html/components/VideoPage.tsx`

不写单元测试，因 VideoPage 太大；本任务的行为通过 Task B4 端到端验证。但仍要写一个**渲染冒烟测试**：

- [ ] **Step 1: 在 VideoPage.tsx import 区加 `buildEmptyTaskGroup`**

定位 line 1-50 的 import block，加：

```tsx
import { buildEmptyTaskGroup } from '../utils/videoTaskInsert';
```

- [ ] **Step 2: 加 `insertEmptyTaskGroup` useCallback**

在 `linkGroups` / `unlinkGroup` 的附近（line ~1000-1040）加：

```tsx
// 2026-05-25：手工在 index 位置之后插入一张空卡；index = -1 = 插到最前
const insertEmptyTaskGroup = useCallback((insertIndex: number) => {
    const { image, group } = buildEmptyTaskGroup(globalModel);
    setUploadedImages(prev => [...prev, image]);
    setImagePrompts(prev => ({ ...prev, [image.id]: '' }));
    setTaskGroups(prev => {
        const next = [...prev];
        next.splice(insertIndex + 1, 0, group);
        return next;
    });
    // 用户手工新增的卡也写回 session
    setTimeout(() => saveSession(), 100);
}, [globalModel, saveSession]);
```

- [ ] **Step 3: 在左侧卡片列表渲染 "+ 空卡" 按钮**

定位 line 3256 的 `sortedTaskGroups.map`：

```tsx
<>
    {/* 最顶部插入按钮 */}
    <InsertEmptyCardButton onClick={() => insertEmptyTaskGroup(-1)} />

    {sortedTaskGroups.map(({ group, originalIndex }, displayIndex) => (
        <React.Fragment key={group.uuid}>
            {renderStoryboardCard(group, originalIndex)}

            {/* 现有 link 按钮 */}
            {originalIndex < taskGroups.length - 1 && /* ... */}

            {/* 新增：每张卡之间的"+ 空卡"按钮（除链接按钮存在的位置） */}
            <InsertEmptyCardButton onClick={() => insertEmptyTaskGroup(originalIndex)} />
        </React.Fragment>
    ))}
</>
```

并在 VideoPage.tsx 文件底部（return 语句之外）加内联组件：

```tsx
const InsertEmptyCardButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className="w-full my-1 py-1.5 border border-dashed border-slate-600 hover:border-cyan-500 hover:bg-cyan-950/20 text-slate-500 hover:text-cyan-300 rounded text-[10px] flex items-center justify-center gap-1 transition-colors"
        title="在此处插入一张空白卡片"
    >
        <Plus className="w-3 h-3" /> 插入空卡
    </button>
);
```

如果 `Plus` icon 还没 import，从 lucide-react 加：

```tsx
import { /* ...existing... */ Plus } from 'lucide-react';
```

- [ ] **Step 4: 手动验证（无回归测试时的替代）**

Run: `cd new_html && npm run dev`

打开浏览器到视频页：
- 空列表时应该顶部有一个"+ 插入空卡"按钮
- 点击后出现一张占位卡（dashed border + "空分镜"）
- 上传几张图片后，每张卡之间有"+ 插入空卡"按钮
- 点击中间任意按钮，新空卡插到正确位置（不是末尾）

- [ ] **Step 5: 提交**

```bash
git add new_html/components/VideoPage.tsx
git commit -m "feat(video-page): wire insertEmptyTaskGroup with '+ 插入空卡' buttons between storyboard cards"
```

---

### Task B3: 空分镜占位区改为可点击上传

**Files:**
- Modify: `new_html/components/VideoPage.tsx`

当前空分镜占位 div（line 2387-2391）是纯展示，提示"@ 选首帧"。改为：点击/拖入 → 触发 `<input type="file">` → 调 `videoService.uploadImage` → 上传成功后 patch 该 `UploadedImage`（`isPlaceholder=false`、`url` 填充）。

- [ ] **Step 1: 在 VideoPage.tsx 加 `handlePlaceholderUpload` useCallback**

在 `handleFiles`（处理拖入文件）附近，加：

```tsx
// 2026-05-25：把空卡的 placeholder image 转正——上传本地文件后填 url、isPlaceholder=false
const handlePlaceholderUpload = useCallback(async (imageId: string, file: File) => {
    // 立即用 blob: URL 占位预览 + 标记 isUploading
    const tempUrl = URL.createObjectURL(file);
    setUploadedImages(prev => prev.map(img =>
        img.id === imageId
            ? { ...img, url: tempUrl, filename: file.name, isPlaceholder: false, isUploading: true, uploadProgress: 0 }
            : img
    ));

    try {
        const result = await videoService.uploadImage(file, {
            onProgress: (p) => setUploadedImages(prev => prev.map(img =>
                img.id === imageId ? { ...img, uploadProgress: p } : img
            ))
        });
        setUploadedImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, url: result.url, storageUrl: result.storageUrl,
                    comfyuiFilename: result.comfyuiFilename, isUploading: false, uploadProgress: 100 }
                : img
        ));
        // blob 释放
        URL.revokeObjectURL(tempUrl);
        setTimeout(() => saveSession(), 100);
    } catch (err) {
        setUploadedImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, isUploading: false, uploadFailed: true }
                : img
        ));
        showToast(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
    }
}, [saveSession, showToast]);
```

- [ ] **Step 2: 改空分镜占位渲染（line 2385-2391）**

```tsx
) : img1.isPlaceholder || !img1.url ? (
    // 2026-05-25：空分镜占位卡可点击上传本地图片
    <label className={`relative w-full bg-slate-800 border border-dashed border-slate-600 hover:border-cyan-500 hover:bg-cyan-950/20 rounded-lg overflow-hidden flex flex-col items-center justify-center text-slate-500 cursor-pointer transition-colors ${previewHeight}`}>
        <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePlaceholderUpload(img1.id, file);
                e.target.value = '';  // 允许同一文件重选
            }}
        />
        <ImagePlus size={20} />
        <div className="text-[10px] mt-1">点击上传图片</div>
        <div className="text-[9px] mt-0.5 text-slate-600">或 @ 选首帧</div>
    </label>
) : (
```

确保 `ImagePlus` 已从 lucide-react import（已用过则跳过）。

- [ ] **Step 3: 手动验证**

Run: `cd new_html && npm run dev`

- 点击"+ 插入空卡"创建一张空卡
- 点击占位区 → 弹出文件选择框
- 选一张本地图片 → 缩略图出现 + 进度条 → 成功后 placeholder 消失
- 卡片右侧 (renderResultCard) 同步显示这张图片
- 可以切换模型（Kling/Vidu/Seedance2/...）
- 可以正常发起生成

- [ ] **Step 4: 提交**

```bash
git add new_html/components/VideoPage.tsx
git commit -m "feat(video-page): allow click-to-upload on empty-card placeholder, transitions isPlaceholder to false"
```

---

## Track C — 同步、文档、回归

### Task C1: 镜像 `new_html/` → `deploy/new_html/`

**Files:**
- Copy: `new_html/utils/videoCardLayout.ts` → `deploy/new_html/utils/videoCardLayout.ts`
- Copy: `new_html/utils/videoTaskInsert.ts` → `deploy/new_html/utils/videoTaskInsert.ts`
- Copy: `new_html/components/video/DashScopeCards.tsx` → `deploy/new_html/components/video/DashScopeCards.tsx`
- Copy: `new_html/components/VideoPage.tsx` → `deploy/new_html/components/VideoPage.tsx`
- Copy: test files mirroring

- [ ] **Step 1: 用 PowerShell 拷贝**

```powershell
Copy-Item -Force new_html/utils/videoCardLayout.ts deploy/new_html/utils/videoCardLayout.ts
Copy-Item -Force new_html/utils/videoTaskInsert.ts deploy/new_html/utils/videoTaskInsert.ts
Copy-Item -Force new_html/components/video/DashScopeCards.tsx deploy/new_html/components/video/DashScopeCards.tsx
Copy-Item -Force new_html/components/VideoPage.tsx deploy/new_html/components/VideoPage.tsx
Copy-Item -Force new_html/__tests__/utils/videoCardLayout.test.ts deploy/new_html/__tests__/utils/videoCardLayout.test.ts
Copy-Item -Force new_html/__tests__/utils/videoTaskInsert.test.ts deploy/new_html/__tests__/utils/videoTaskInsert.test.ts
Copy-Item -Force new_html/__tests__/components/DashScopeCards.test.tsx deploy/new_html/__tests__/components/DashScopeCards.test.tsx
```

- [ ] **Step 2: 验证 deploy 侧文件存在且与主侧一致**

```powershell
Compare-Object (Get-Content new_html/components/video/DashScopeCards.tsx) (Get-Content deploy/new_html/components/video/DashScopeCards.tsx)
```

Expected: 无输出（两个文件相同）

- [ ] **Step 3: 提交**

```bash
git add deploy/new_html/utils/videoCardLayout.ts deploy/new_html/utils/videoTaskInsert.ts deploy/new_html/components/video/DashScopeCards.tsx deploy/new_html/components/VideoPage.tsx deploy/new_html/__tests__/
git commit -m "chore(deploy): mirror DashScope card compaction + empty-card insertion to deploy/new_html"
```

---

### Task C2: 更新 `docs/faq.md` + `deploy/docs/faq.md`

**Files:**
- Modify: `docs/faq.md`
- Modify: `deploy/docs/faq.md`

- [ ] **Step 1: 在 `docs/faq.md` 顶部（最新条目位置）插入**

```markdown
## 视频页 DashScope 卡片太长 / 一屏只能看一张 + 不能在卡片之间插入空卡 (2026-05-25)

**Symptom:**
1. 选择「合体 (Kling) / 大乘 (Vidu) / 炼虚 (HappyHorse)」三个 DashScope 模型时，单张卡片高度 ~800px，一屏只能看到一张完整卡，第二张在视口下方。
2. 用户想在 storyboard 中间手工插入一张全新的空卡（不绑 storyboard_item），上传本地图片后选模型生成视频——之前没有入口。

**Root Cause:**
1. `new_html/utils/videoCardLayout.ts:26` 的 `COMPACT_CARD_MIN_HEIGHT_CLASS = 'min-h-[420px] h-full flex flex-col'` 只设了 `min-h` 没设 `max-h`，而 DashScopeCardShell 用 `flex-1` 撑父容器——结果整卡高度 = max(420, 内容自然高度) ≈ 600-800px，外层 `overflow-y-auto` 在父容器没上限时不触发。
2. `DashScopeCards.tsx` 的 i2v/morph 媒体槽用 `aspect-video` 占满卡宽 (~280px → 158px 高)，比 Seedance 同位置的 `w-20 h-14` 缩略图大 ~100px。
3. Vidu/HappyHorse 用 `<details open>` 包高级参数，虽然默认展开但用户折叠后参数消失，与"参数都显示全"的诉求冲突。
4. 之前 `TaskGroup` 只有跟 storyboard image 一起创建的路径 (`handleFiles`)，没有"手工 +1 空卡"的入口。但 `UploadedImage.isPlaceholder` 字段早已存在 (line 125)，只是没有 UI 触发。

**Fix:**
1. `videoCardLayout.ts` 新增 `DASHSCOPE_CARD_HEIGHT_CLASS = 'min-h-[420px] max-h-[640px] h-full flex flex-col overflow-hidden'`，`getCardHeightClass` 增加 DashScope 分支；`getPreviewImageHeightClass` 给 DashScope 同等于 Seedance 的紧凑高度 (h-40/h-28)。
2. `DashScopeCards.tsx` 新增 `CompactImageSlot` (w-20 h-14)，KlingCard i2v/morph 和 ViduCard startend 都改用紧凑槽；Kling 多镜头自定义列表加 `max-h-[160px] overflow-y-auto`；Vidu/HH 的 `<details open>` 改为 `<section>`（始终可见）。
3. `videoTaskInsert.ts` 新增 `buildEmptyTaskGroup(model)`，VideoPage 加 `insertEmptyTaskGroup(idx)` 函数 + 在每对卡之间渲染"+ 插入空卡"按钮。
4. VideoPage 的空分镜占位 div 改为 `<label>` 包裹 `<input type="file" hidden>`，点击即弹文件选择；上传成功后把 `isPlaceholder` 翻为 `false`、填充 `url`。

**Files:**
- `new_html/utils/videoCardLayout.ts` (+ 5 lines)
- `new_html/utils/videoTaskInsert.ts` (new, ~25 lines)
- `new_html/components/video/DashScopeCards.tsx` (~ -40 / +50 lines)
- `new_html/components/VideoPage.tsx` (+ 60 lines)
- 测试文件 3 个对应扩展
- `deploy/new_html/` 同步镜像

**Predicted future pitfalls:**
- 多镜头自定义列表 max-h 写死 160px，将来若每段 prompt 高度变化（rows={2} → rows={3}）需重新评估。
- 空卡上传走 `videoService.uploadImage` 跟普通拖拽上传同一路径；后端不区分这两类来源，所以不会破坏 task 提交流程。但如果将来加"必须关联 storyboard_item 才能生成"的后端校验，本功能会失效——需要同时给手工空卡也生成 storyboard_item（或在后端放行 `storyboardItemId=undefined` 的 group）。
- DashScope max-h-[640px] 是经验值；若将来 Kling 模型再加新参数（如 reference camera motion），可能溢出，需要重新评估 max-h 或把更多 section 改为内部 max-h 滚动。

**Lessons learned:**
- "只有 `min-h` 没有 `max-h`" 在 `flex-col flex-1` 子树里 = 子内容能任意撑高。父容器的 `overflow-y-auto` 在父没上限时是死的（chain regression：之前 Seedance 卡片定 720px 没遇到这问题，纯属"内容刚好够装"的偶然，DashScope 内容更多就翻车）。
- "参数都显示全" ≠ "用 details 默认展开"。用户的"全显示"承诺是绝对的，details 给了用户折叠的权利就破坏了承诺。
- 字段 `isPlaceholder` 早就存在但只在一条窄路径上有 UI（storyboard 同步生成的空 item）。新功能时**优先复用已有字段语义**而不是再造一个 `manuallyInserted` 字段——保持字段单一语义。
```

- [ ] **Step 2: 同样写入 `deploy/docs/faq.md`**

```powershell
Copy-Item -Force docs/faq.md deploy/docs/faq.md
```

- [ ] **Step 3: 提交**

```bash
git add docs/faq.md deploy/docs/faq.md
git commit -m "docs(faq): record DashScope card compaction + empty-card insertion (root cause + lessons)"
```

---

### Task C3: 全量回归 + Sync Check

**Files:**
- 无（纯验证）

- [ ] **Step 1: 跑前端测试**

Run: `cd new_html && npm test`
Expected: 所有测试 PASS（含 videoCardLayout / DashScopeCards / videoTaskInsert 新用例）

- [ ] **Step 2: 跑前端 build**

Run: `cd new_html && npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 3: 跑 sync_check**

Run: `python .claude/skills/project-memory/scripts/scan_project.py .`
Run: `python .claude/skills/project-memory/scripts/sync_check.py . --strict --levels ERROR`
Expected: exit 0

- [ ] **Step 4: 手动视觉验证 (browser)**

启动 dev server，覆盖以下场景：

1. **DashScope 卡片高度**：选 Kling/Vidu/HappyHorse 模型，**一屏能看见 ≥ 2 张完整卡片**。
2. **DashScope 参数全可见**：Vidu/HappyHorse 的"分辨率/seed/audio/水印"等所有字段默认可见，不需要点开折叠。
3. **Kling 多镜头**：切到 multi → customize 模式，添加 6 个分镜，列表内部出现滚动条，**不撑高整张卡**。
4. **空卡插入**：
   - 空列表顶部有"+ 插入空卡"按钮
   - 点击 → 占位卡出现 → 占位区可点击 → 选本地图 → 缩略图填入 → 选模型 → 可生成
   - 已有 3 张卡时，每张卡之间都有"+ 插入空卡"按钮
   - 点中间按钮 → 新空卡插在正确位置（index+1），不是末尾
   - 右侧结果队列同步出现对应的"等待状态"卡
5. **回归**：原有 Seedance 卡片、I2V/Morph 卡、大能模型卡片不受影响。

- [ ] **Step 5: 提交 wrap-up commit（如有视觉调整尾巴）**

如果手动验证发现细节问题（如按钮 padding 不对），fix 后 commit；否则跳过本步。

```bash
git status   # 确认无遗漏
```

---

## Self-Review

**1. Spec coverage:**
- ✅ "三个模型参数展示不全" → Track A 全 6 个 task 解决
- ✅ "学一学 seedance 卡片，自适应展示参数" → Track A 仿 Seedance 的 CompactImageSlot + 移除 details + 内部分段滚动
- ✅ "在两个分镜之间，添加新的空卡片" → Task B2 在每对卡之间渲染按钮
- ✅ "空卡片上可以上传图像" → Task B3 占位区改为 `<label>` 包 file input
- ✅ "右侧也会出现对应的卡片" → 共享 `sortedTaskGroups` 数组，无需额外逻辑（已验证 line 3293-3303）
- ✅ "上传图片后，和其他的卡片一样，可以切换模型生成视频" → `isPlaceholder=false` 后跟普通卡片走同一渲染分支

**2. Placeholder scan:**
- 无 "TBD" / "implement later"
- 所有代码 step 含真实代码
- 所有命令含 expected 输出

**3. Type consistency:**
- `buildEmptyTaskGroup(model: VideoModel)` 返回 `{ image: UploadedImage, group: TaskGroup }` ← 一致
- `handlePlaceholderUpload(imageId: string, file: File)` 参数顺序 (id, file) ← 一致
- `insertEmptyTaskGroup(insertIndex: number)` 命名 ← 一致（不是 `insertAt`/`addEmptySlot`）
- `DASHSCOPE_CARD_HEIGHT_CLASS` 常量名 ← 一致

**4. Cross-source mirror:**
- ✅ Task C1 显式列出每个新/改文件的 deploy 侧镜像
- ⚠️ 如果在 Track A/B 执行中发现额外改动文件（如 lucide-react 新增 icon import），需手动加入 Task C1 的拷贝列表

**5. Project-memory discipline:**
- ✅ Pre-edit impact check 已跑（DashScopeCards.tsx 只 VideoPage 消费；videoCardLayout.ts 只 VideoPage 消费）
- ✅ No single-layer fix（纯前端 task，不涉及 BE/DB；但 Task C2 的 faq 更新是必需的，已纳入）
- ✅ Pre-commit gate 在 Task C3 通过 sync_check 完成

---

## Risks

| Risk | Mitigation |
|------|-----------|
| `max-h-[640px]` 可能切掉某种 Kling 长内容模式 | Task A4 把多镜头列表加内部 max-h；其他模式实测 ~430px 内绰绰有余 |
| 手工插入的空卡 group 没有 `storyboardItemId`，下游某处假设非空可能崩 | 已 grep 确认 `getStoryboardItemId(group.uuid)` 已 handle undefined（line 2443 `?` 链）；如有遗漏可在 Task C3 手动验证发现 |
| `videoService.uploadImage` 失败时 placeholder image 状态混乱 | `handlePlaceholderUpload` 的 catch 分支显式恢复 `isUploading=false, uploadFailed=true`；UI 上的红色错误提示 (line 2406-2410) 已存在，会自动显示 |
| `deploy/new_html/` 镜像漏 | Task C1 显式列出每个文件，加 Compare-Object 验证 |
