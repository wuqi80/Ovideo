# Seedance Card Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VideoPage card view show all 飞升 / 渡劫 Seedance 2.0 parameters by default, with Seedance-only large cards and left/right cards kept at the same adaptive height.

**Architecture:** Add a small pure layout helper for model-specific card sizing, then use it in both `renderStoryboardCard` and `renderResultCard`. Refactor `SeedanceMultimodalPanel` into always-visible sections with media lists constrained by local scrolling, while normal video models keep the existing compact card layout.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind utility classes, Vitest + Testing Library, project-memory docs workflow.

---

## Scope Check

This plan touches one vertical frontend slice: `VideoGenPage / VideoPage`.

No backend API, worker, DAO, or database behavior changes are included. The only runtime behavior change is card layout and parameter visibility for `Seedance2` / `Seedance2Fast`.

## Files

**Create**

- `new_html/utils/videoCardLayout.ts` — pure helpers for Seedance model detection and card/preview height classes.
- `new_html/__tests__/utils/videoCardLayout.test.ts` — helper unit tests.
- `new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx` — component visibility tests for always-expanded params and audio-only validation.

**Modify**

- `new_html/components/VideoPage.tsx` — use layout helper in both left and right cards; compress image preview in Seedance cards; let right result card use larger visual area.
- `new_html/components/SeedanceMultimodalPanel.tsx` — remove default-collapsed advanced section; restructure into prompt / media / output params / constraints; keep upload handlers and validation.
- `docs/frontend.md` and `deploy/docs/frontend.md` — document Seedance large-card behavior.
- `docs/faq.md` and `deploy/docs/faq.md` — add/extend bug entry for parameters not fully visible and unequal card heights.

**Do not modify**

- `seedance_api.py`
- `worker.py`
- `cluster_main.py`
- `new_html/services/videoService.ts`
- SQL migrations

---

## Task 1: Add Card Layout Helpers + Unit Tests

**Files:**

- Create: `new_html/utils/videoCardLayout.ts`
- Create: `new_html/__tests__/utils/videoCardLayout.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `new_html/__tests__/utils/videoCardLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    getCardHeightClass,
    getPreviewImageHeightClass,
    isSeedanceModel,
} from '../../utils/videoCardLayout';

describe('videoCardLayout', () => {
    it('detects only Seedance2 and Seedance2Fast as Seedance models', () => {
        expect(isSeedanceModel('Seedance2')).toBe(true);
        expect(isSeedanceModel('Seedance2Fast')).toBe(true);
        expect(isSeedanceModel('Wan2')).toBe(false);
        expect(isSeedanceModel('Sora2')).toBe(false);
        expect(isSeedanceModel('大能')).toBe(false);
    });

    it('returns large card height only for Seedance models', () => {
        expect(getCardHeightClass('Seedance2')).toBe('min-h-[620px] max-h-[760px]');
        expect(getCardHeightClass('Seedance2Fast')).toBe('min-h-[620px] max-h-[760px]');
        expect(getCardHeightClass('Wan2')).toBe('min-h-[380px] max-h-[420px]');
    });

    it('compresses preview image heights only for Seedance cards', () => {
        expect(getPreviewImageHeightClass('Seedance2', false)).toBe('h-40');
        expect(getPreviewImageHeightClass('Seedance2', true)).toBe('h-28');
        expect(getPreviewImageHeightClass('Wan2', false)).toBe('h-52');
        expect(getPreviewImageHeightClass('Wan2', true)).toBe('h-32');
    });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd h:\MY2\new_html
npx vitest run __tests__/utils/videoCardLayout.test.ts
```

Expected:

```text
FAIL __tests__/utils/videoCardLayout.test.ts
Cannot find module '../../utils/videoCardLayout'
```

- [ ] **Step 3: Implement the helper**

Create `new_html/utils/videoCardLayout.ts`:

```ts
import type { VideoModel } from '../services/videoService';

export const COMPACT_CARD_HEIGHT_CLASS = 'min-h-[380px] max-h-[420px]';
export const SEEDANCE_CARD_HEIGHT_CLASS = 'min-h-[620px] max-h-[760px]';

export function isSeedanceModel(model: VideoModel): boolean {
    return model === 'Seedance2' || model === 'Seedance2Fast';
}

export function getCardHeightClass(model: VideoModel): string {
    return isSeedanceModel(model)
        ? SEEDANCE_CARD_HEIGHT_CLASS
        : COMPACT_CARD_HEIGHT_CLASS;
}

export function getPreviewImageHeightClass(model: VideoModel, isPair: boolean): string {
    if (isSeedanceModel(model)) {
        return isPair ? 'h-28' : 'h-40';
    }
    return isPair ? 'h-32' : 'h-52';
}

export function getResultVisualHeightClass(model: VideoModel): string {
    return isSeedanceModel(model) ? 'h-[420px]' : 'h-52';
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
cd h:\MY2\new_html
npx vitest run __tests__/utils/videoCardLayout.test.ts
```

Expected:

```text
PASS __tests__/utils/videoCardLayout.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add new_html/utils/videoCardLayout.ts new_html/__tests__/utils/videoCardLayout.test.ts
git commit -m "test(seedance): add card layout helper coverage"
```

---

## Task 2: Apply Seedance Card Heights in VideoPage

**Files:**

- Modify: `new_html/components/VideoPage.tsx`

- [ ] **Step 1: Import layout helpers**

In `new_html/components/VideoPage.tsx`, near the existing imports:

```ts
import {
    getCardHeightClass,
    getPreviewImageHeightClass,
    getResultVisualHeightClass,
    isSeedanceModel,
} from '../utils/videoCardLayout';
```

- [ ] **Step 2: Replace left card hardcoded height**

In `renderStoryboardCard`, replace:

```ts
// 统一卡片高度 - 左右同步
const cardHeight = 'min-h-[380px] max-h-[420px]';
```

with:

```ts
// 统一卡片高度 - 左右同步；Seedance 参数更多，使用专用大卡片
const cardHeight = getCardHeightClass(group.model);
const previewHeight = getPreviewImageHeightClass(group.model, isPair);
const seedanceCard = isSeedanceModel(group.model);
```

- [ ] **Step 3: Make left card overflow safe**

In `renderStoryboardCard`, replace the root card class:

```tsx
className={`bg-slate-800 rounded-xl border border-slate-700 p-4 transition-all hover:border-slate-600 group mb-4 flex flex-col ${cardHeight}`}
```

with:

```tsx
className={`bg-slate-800 rounded-xl border border-slate-700 p-4 transition-all hover:border-slate-600 group mb-4 flex flex-col overflow-hidden ${cardHeight} ${
    seedanceCard ? 'border-cyan-700/40 bg-gradient-to-b from-slate-800 to-slate-900' : ''
}`}
```

- [ ] **Step 4: Use preview height helper in left card images**

Replace the pair preview image class:

```tsx
<img src={img1.url} className="w-full h-32 object-contain bg-black/50" />
```

with:

```tsx
<img src={img1.url} className={`w-full ${previewHeight} object-contain bg-black/50`} />
```

Replace the second pair image similarly:

```tsx
<img src={img2.url} className={`w-full ${previewHeight} object-contain bg-black/50`} />
```

Replace the single preview image:

```tsx
<img src={img1.url} className="w-full h-52 object-contain bg-black/50" />
```

with:

```tsx
<img src={img1.url} className={`w-full ${previewHeight} object-contain bg-black/50`} />
```

- [ ] **Step 5: Keep Seedance panel inside bounded scroll**

In the Seedance branch of `renderStoryboardCard`, replace:

```tsx
<div className="flex-1 overflow-y-auto">
    <SeedanceMultimodalPanel
        value={getSeedanceParams(group.uuid, group.model)}
        onChange={(next) => setSeedanceParams(group.uuid, next)}
    />
</div>
```

with:

```tsx
<div className="flex-1 min-h-0 overflow-y-auto pr-1">
    <SeedanceMultimodalPanel
        value={getSeedanceParams(group.uuid, group.model)}
        onChange={(next) => setSeedanceParams(group.uuid, next)}
    />
</div>
```

- [ ] **Step 6: Replace right card hardcoded height**

In `renderResultCard`, replace:

```ts
// 统一卡片高度 - 与左侧对齐
const cardHeight = 'min-h-[380px] max-h-[420px]';
```

with:

```ts
// 统一卡片高度 - 与左侧对齐；Seedance 结果卡跟随大卡片
const cardHeight = getCardHeightClass(group.model);
const seedanceCard = isSeedanceModel(group.model);
const resultVisualHeight = getResultVisualHeightClass(group.model);
```

- [ ] **Step 7: Make right card overflow safe**

In `renderResultCard`, replace the root card class that contains `cardHeight` with the same overflow-safe pattern:

```tsx
className={`bg-slate-800 rounded-xl border border-slate-700 p-4 transition-all mb-4 flex flex-col overflow-hidden ${cardHeight} ${
    seedanceCard ? 'border-cyan-700/40 bg-gradient-to-b from-slate-800 to-slate-900' : ''
}`}
```

If the exact existing class differs, preserve all current non-height classes and only add `overflow-hidden`, `${cardHeight}`, and the conditional Seedance visual class.

- [ ] **Step 8: Use larger visual area on right card video grid**

In `renderVisual`, replace fixed visual heights that use `h-52` for video preview grids with:

```tsx
className={`grid grid-cols-3 gap-2 ${resultVisualHeight}`}
```

For single-video preview containers, replace fixed `h-52` or equivalent with:

```tsx
className={`w-full ${resultVisualHeight}`}
```

Keep button rows and selected state behavior unchanged.

- [ ] **Step 9: Run typecheck focused on VideoPage**

Run:

```bash
cd h:\MY2\new_html
npx tsc --noEmit 2>&1 | Select-String -Pattern "VideoPage|videoCardLayout|Seedance" | Select-Object -First 20
```

Expected:

```text
No output for VideoPage/videoCardLayout/Seedance-related errors.
```

The repo currently has unrelated pre-existing TypeScript errors; do not fix unrelated files in this task.

- [ ] **Step 10: Commit**

```bash
git add new_html/components/VideoPage.tsx
git commit -m "fix(seedance): use large synchronized cards in VideoPage"
```

---

## Task 3: Refactor SeedanceMultimodalPanel to Always-Expanded Sections

**Files:**

- Modify: `new_html/components/SeedanceMultimodalPanel.tsx`
- Create: `new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SeedanceMultimodalPanel } from '../../components/SeedanceMultimodalPanel';
import type { SeedanceParams } from '../../services/videoService';

const baseParams: SeedanceParams = {
    sub_model: 'standard',
    prompt: '',
    media_inputs: [],
    resolution: '720p',
    ratio: 'adaptive',
    duration: 5,
    seed: -1,
    watermark: false,
    generate_audio: true,
    camera_fixed: false,
};

describe('SeedanceMultimodalPanel', () => {
    it('shows output parameters without clicking an advanced toggle', () => {
        render(<SeedanceMultimodalPanel value={baseParams} onChange={vi.fn()} />);

        expect(screen.getByText('输出参数')).toBeInTheDocument();
        expect(screen.getByText('分辨率')).toBeInTheDocument();
        expect(screen.getByText('画面比例')).toBeInTheDocument();
        expect(screen.getByText('时长')).toBeInTheDocument();
        expect(screen.getByText('Seed')).toBeInTheDocument();
        expect(screen.getByText('水印')).toBeInTheDocument();
        expect(screen.getByText('AI 配音')).toBeInTheDocument();
        expect(screen.getByText('固定镜头（仅 1.5pro）')).toBeInTheDocument();
    });

    it('keeps media sections visible with documented limits', () => {
        render(<SeedanceMultimodalPanel value={baseParams} onChange={vi.fn()} />);

        expect(screen.getByText('图片 0/9')).toBeInTheDocument();
        expect(screen.getByText('视频 0/3')).toBeInTheDocument();
        expect(screen.getByText('音频 0/3')).toBeInTheDocument();
    });

    it('shows audio-only validation when audio exists without image or video', () => {
        render(
            <SeedanceMultimodalPanel
                value={{
                    ...baseParams,
                    prompt: '一段带音乐的画面',
                    media_inputs: [{ kind: 'audio', url: '/storage/audio/a.mp3', role: 'reference_audio' }],
                }}
                onChange={vi.fn()}
            />
        );

        expect(screen.getByText('不可单独输入音频，必须至少包含 1 张图或 1 段视频')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run component test and verify it fails**

Run:

```bash
cd h:\MY2\new_html
npx vitest run __tests__/components/SeedanceMultimodalPanel.test.tsx
```

Expected failure now:

```text
FAIL __tests__/components/SeedanceMultimodalPanel.test.tsx
Unable to find an element with the text: 输出参数
```

This fails because output params are still behind the current “高级设置” collapsed section.

- [ ] **Step 3: Remove unused collapsed state/imports**

In `SeedanceMultimodalPanel.tsx`, replace:

```ts
import { Upload, X, ChevronDown, ChevronUp, AlertCircle, Info } from 'lucide-react';
```

with:

```ts
import { Upload, X, AlertCircle, Info } from 'lucide-react';
```

Replace:

```ts
const [advancedOpen, setAdvancedOpen] = useState(false);
const [draftOpen, setDraftOpen] = useState(false);
```

with no declarations. Keep:

```ts
const [uploadBusy, setUploadBusy] = useState(false);
```

- [ ] **Step 4: Replace the panel root with a stronger Seedance identity**

Replace:

```tsx
<div className="space-y-2 bg-slate-900/40 border border-slate-700 rounded p-2">
```

with:

```tsx
<div className="space-y-3 bg-slate-950/70 border border-cyan-800/40 rounded-lg p-3 shadow-inner shadow-cyan-950/20">
```

- [ ] **Step 5: Add a compact header above prompt**

Immediately after the root `<div ...>` line, insert:

```tsx
<div className="flex items-center justify-between border-b border-cyan-900/40 pb-2">
    <div>
        <div className="text-[11px] font-semibold text-cyan-200 tracking-wide">Seedance 2.0 多模态控制台</div>
        <div className="text-[9px] text-slate-500">图片 0-9 · 视频 0-3 · 音频 0-3 · 参数默认展开</div>
    </div>
    <span className="text-[9px] px-1.5 py-0.5 rounded border border-cyan-700/40 text-cyan-300 bg-cyan-950/30">
        {value.sub_model === 'fast' ? '渡劫 Fast' : '飞升 Standard'}
    </span>
</div>
```

- [ ] **Step 6: Replace the prompt textarea block**

Replace the current prompt textarea block:

```tsx
{/* 提示词 */}
<textarea
    value={value.prompt}
    onChange={e => patch({ prompt: e.target.value })}
    placeholder="提示词（可空 / 至少给一个媒体或文本）"
    disabled={disabled}
    className="w-full bg-black/30 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none resize-none h-12"
/>
```

with:

```tsx
<section className="space-y-1">
    <div className="flex items-center justify-between">
        <label className="text-[10px] font-medium text-slate-300">提示词</label>
        <span className="text-[9px] text-slate-500">可空，但必须有媒体或文本</span>
    </div>
    <textarea
        value={value.prompt}
        onChange={e => patch({ prompt: e.target.value })}
        placeholder="描述动作、镜头、声音或剪辑意图..."
        disabled={disabled}
        className="w-full bg-black/30 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none resize-none h-14"
    />
</section>
```

- [ ] **Step 7: Remove disabled draft button block**

Delete this block entirely:

```tsx
{/* 复用样片任务 ID（draft，2.0 不支持，预留入口） */}
<div className="flex items-center gap-1 text-[10px]">
    <button
        type="button"
        onClick={() => setDraftOpen(v => !v)}
        disabled
        className="px-2 py-0.5 bg-slate-700/40 text-slate-500 rounded text-[10px] cursor-not-allowed"
        title="2.0 系列不支持复用样片，仅 1.5pro 可用"
    >
        复用样片任务 ID（仅 1.5pro）
    </button>
</div>
```

The 2.0 draft limitation is still shown in the constraints section.

- [ ] **Step 8: Replace media section wrappers with a three-column cockpit layout**

Wrap the existing image/audio/video sections in:

```tsx
<section className="space-y-2">
    <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium text-slate-300">媒体输入</div>
        <div className="text-[9px] text-slate-500">不可仅音频</div>
    </div>
    <div className="grid grid-cols-3 gap-2">
        {/* 图片输入 block */}
        {/* 视频输入 block */}
        {/* 音频输入 block */}
    </div>
</section>
```

Within each media block, use these outer classes:

```tsx
<div className="rounded-md border border-slate-700/70 bg-slate-900/60 p-2 min-h-[122px]">
```

Use these header labels exactly:

```tsx
<span>图片 {images.length}/9</span>
<span>视频 {videos.length}/3</span>
<span>音频 {audios.length}/3</span>
```

For image thumbnails, replace:

```tsx
<div className="grid grid-cols-3 gap-1">
```

with:

```tsx
<div className="grid grid-cols-3 gap-1 max-h-28 overflow-y-auto pr-0.5">
```

For video and audio lists, replace their `<ul>` class with:

```tsx
className="text-[10px] text-slate-300 space-y-0.5 max-h-28 overflow-y-auto pr-0.5"
```

This satisfies the frontend-design review rule: controls remain visible, but media lists scroll locally when many files are uploaded.

- [ ] **Step 9: Replace collapsed advanced settings with always-visible output params**

Delete the entire block from:

```tsx
{/* 高级设置折叠 */}
<div className="border-t border-slate-700 pt-1">
```

through its closing `</div>` after the fixed camera checkbox.

Insert this always-visible block in its place:

```tsx
<section className="space-y-2 border-t border-cyan-900/40 pt-2">
    <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium text-slate-300">输出参数</div>
        <div className="text-[9px] text-slate-500">核心参数默认展开</div>
    </div>
    <div className="grid grid-cols-2 gap-2 text-[10px]">
        <label className="space-y-1">
            <span className="text-slate-400">分辨率</span>
            <select
                value={value.resolution || '720p'}
                onChange={e => patch({ resolution: e.target.value as SeedanceParams['resolution'] })}
                disabled={disabled}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
                {RESOLUTION_OPTIONS.map(r => (
                    <option key={r} value={r} disabled={r === '1080p' && value.sub_model === 'fast'}>
                        {r}{r === '1080p' && value.sub_model === 'fast' ? '（渡劫不支持）' : ''}
                    </option>
                ))}
            </select>
        </label>

        <label className="space-y-1">
            <span className="text-slate-400">画面比例</span>
            <select
                value={value.ratio || 'adaptive'}
                onChange={e => patch({ ratio: e.target.value as SeedanceParams['ratio'] })}
                disabled={disabled}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
                {RATIO_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
        </label>

        <label className="space-y-1">
            <span className="text-slate-400">时长</span>
            <input
                type="number"
                min={-1}
                max={15}
                value={value.duration ?? 5}
                onChange={e => patch({ duration: parseInt(e.target.value, 10) })}
                disabled={disabled}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            />
        </label>

        <label className="space-y-1">
            <span className="text-slate-400">Seed</span>
            <input
                type="number"
                value={value.seed ?? -1}
                onChange={e => patch({ seed: parseInt(e.target.value, 10) })}
                disabled={disabled}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            />
        </label>

        <label className="flex items-center gap-2 rounded border border-slate-700/70 bg-slate-900/60 px-2 py-1 text-slate-300">
            <input
                type="checkbox"
                checked={!!value.watermark}
                onChange={e => patch({ watermark: e.target.checked })}
                disabled={disabled}
            />
            水印
        </label>

        <label className="flex items-center gap-2 rounded border border-cyan-800/40 bg-cyan-950/20 px-2 py-1 text-cyan-200">
            <input
                type="checkbox"
                checked={value.generate_audio !== false}
                onChange={e => patch({ generate_audio: e.target.checked })}
                disabled={disabled}
            />
            AI 配音
        </label>

        <label className="col-span-2 flex items-center gap-2 rounded border border-slate-800 bg-slate-950/40 px-2 py-1 text-slate-500 opacity-70" title="Seedance 2.0 系列不支持 camera_fixed">
            <input type="checkbox" disabled />
            固定镜头（仅 1.5pro）
        </label>
    </div>
</section>
```

- [ ] **Step 10: Move warnings into a compact constraints section**

Replace the existing真人脸 hint block:

```tsx
{/* 真人脸来源约束提示（Seedance 2.0 不支持直接上传含真人人脸的素材） */}
<div className="flex items-start gap-1 text-[10px] text-amber-400/90 bg-amber-900/10 border border-amber-700/30 rounded px-1.5 py-1">
    <Info size={10} className="mt-0.5 shrink-0" />
    <span>Seedance 2.0 不支持直接上传含真人人脸的图/视频。如需使用人物，请用：本平台模型生成的产物 / 预置虚拟人像 / 已授权真人素材。</span>
</div>
```

with:

```tsx
<section className="space-y-1">
    <div className="flex items-start gap-1 text-[10px] text-amber-300 bg-amber-950/20 border border-amber-800/40 rounded px-1.5 py-1">
        <Info size={10} className="mt-0.5 shrink-0" />
        <span>Seedance 2.0 不支持直接上传含真人人脸的图/视频；请使用模型产物、预置虚拟人像或已授权真人素材。</span>
    </div>
    <div className="text-[9px] text-slate-500">
        样片任务 ID / draft 仅 1.5pro 支持，2.0 系列不开放。
    </div>
</section>
```

- [ ] **Step 11: Keep validation at bottom with stronger visual priority**

Replace:

```tsx
{!validation.ok && (
    <div className="flex items-center gap-1 text-[10px] text-red-400">
        <AlertCircle size={10} />{validation.msg}
    </div>
)}
```

with:

```tsx
{!validation.ok && (
    <div className="flex items-center gap-1 text-[10px] text-red-300 bg-red-950/30 border border-red-800/40 rounded px-1.5 py-1">
        <AlertCircle size={10} />{validation.msg}
    </div>
)}
```

- [ ] **Step 12: Run component tests**

Run:

```bash
cd h:\MY2\new_html
npx vitest run __tests__/components/SeedanceMultimodalPanel.test.tsx
```

Expected:

```text
PASS __tests__/components/SeedanceMultimodalPanel.test.tsx
```

- [ ] **Step 13: Run helper + component tests together**

Run:

```bash
cd h:\MY2\new_html
npx vitest run __tests__/utils/videoCardLayout.test.ts __tests__/components/SeedanceMultimodalPanel.test.tsx
```

Expected:

```text
PASS __tests__/utils/videoCardLayout.test.ts
PASS __tests__/components/SeedanceMultimodalPanel.test.tsx
```

- [ ] **Step 14: Commit**

```bash
git add new_html/components/SeedanceMultimodalPanel.tsx new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx
git commit -m "fix(seedance): show all card parameters by default"
```

---

## Task 4: Documentation Sync

**Files:**

- Modify: `docs/frontend.md`
- Modify: `docs/faq.md`
- Modify: `deploy/docs/frontend.md`
- Modify: `deploy/docs/faq.md`

- [ ] **Step 1: Update `docs/frontend.md` Seedance panel section**

In `docs/frontend.md`, replace the current SeedanceMultimodalPanel bullets that mention “7 个高级参数（折叠）” with:

```md
- **输出参数默认全部展开**：`resolution` / `ratio` / `duration` / `seed` / `watermark` / `generate_audio` / `camera_fixed`（2.0 系列灰显）直接可见，不再默认藏在“高级设置”折叠里。
- **Seedance 专用大卡片**：VideoPage card 视图中，普通模型保持 `min-h-[380px] max-h-[420px]`；`Seedance2` / `Seedance2Fast` 使用 `min-h-[620px] max-h-[760px]`。左右配置卡 / 结果卡通过 `getCardHeightClass(model)` 使用同一高度策略。
- **媒体列表局部滚动**：参数控件必须可见；图片/视频/音频缩略列表可以在各自区域内 `max-height + overflow-y-auto`，避免 9 张图撑破卡片。
- **视觉层级**：核心参数（分辨率、比例、时长、AI 配音）优先显示；次要参数（seed、水印、camera_fixed）弱化显示；camera_fixed 明确标注仅 1.5pro。
```

- [ ] **Step 2: Update `docs/faq.md` top bug entry**

Find the top entry:

```md
### Q: 视频页选了"飞升 / 渡劫"模型却看不到 SD2.0 多模态参数面板
```

Append this subsection before `**Files**`:

```md
**Follow-up Fix (2026-05-13)**:
用户进一步发现：即使卡片视图开始渲染 Seedance 面板，参数仍显示不全，且左右卡片高度不一致。

Root cause:
- 普通卡片高度仍是 `min-h-[380px] max-h-[420px]`，无法容纳完整 Seedance 参数。
- 左侧配置卡和右侧结果卡各自硬编码高度，没有共享模型感知的高度 helper。
- 高级参数默认折叠，不符合“飞升/渡劫参数全部可见”的使用目标。

Fix:
- 新增 `new_html/utils/videoCardLayout.ts`，集中定义 `isSeedanceModel()` / `getCardHeightClass()` / preview height helpers。
- Seedance 卡片使用 `min-h-[620px] max-h-[760px]`，普通模型保持原高度。
- 左右卡片共用同一个 height helper。
- Seedance 参数面板改为默认全部展开；媒体缩略图列表使用局部滚动，不挤压输出参数。
```

- [ ] **Step 3: Mirror docs to deploy**

Run:

```powershell
Copy-Item h:\MY2\docs\frontend.md h:\MY2\deploy\docs\frontend.md -Force
Copy-Item h:\MY2\docs\faq.md h:\MY2\deploy\docs\faq.md -Force
```

- [ ] **Step 4: Verify docs mirror**

Run:

```powershell
$a=(Get-FileHash h:\MY2\docs\frontend.md).Hash
$b=(Get-FileHash h:\MY2\deploy\docs\frontend.md).Hash
if ($a -ne $b) { throw "frontend.md deploy mirror differs" }
$c=(Get-FileHash h:\MY2\docs\faq.md).Hash
$d=(Get-FileHash h:\MY2\deploy\docs\faq.md).Hash
if ($c -ne $d) { throw "faq.md deploy mirror differs" }
"docs mirror OK"
```

Expected:

```text
docs mirror OK
```

- [ ] **Step 5: Commit**

```bash
git add docs/frontend.md docs/faq.md deploy/docs/frontend.md deploy/docs/faq.md
git commit -m "docs(seedance): document expanded card parameter layout"
```

---

## Task 5: Build, Project Memory Gate, and Manual QA Checklist

**Files:**

- Generated: `dist/` by Vite build
- Generated: `context/*.json` by project-memory scan

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
cd h:\MY2\new_html
npx vitest run __tests__/utils/videoCardLayout.test.ts __tests__/components/SeedanceMultimodalPanel.test.tsx
```

Expected:

```text
PASS __tests__/utils/videoCardLayout.test.ts
PASS __tests__/components/SeedanceMultimodalPanel.test.tsx
```

- [ ] **Step 2: Run TypeScript check and filter known unrelated errors**

Run:

```powershell
cd h:\MY2\new_html
npx tsc --noEmit 2>&1 | Select-String -Pattern "VideoPage|SeedanceMultimodalPanel|videoCardLayout|Seedance" | Select-Object -First 20
```

Expected:

```text
No output for changed files or Seedance-related symbols.
```

Note: the repo currently has unrelated pre-existing TypeScript errors. Do not broaden this task to fix unrelated files.

- [ ] **Step 3: Build production frontend**

Run:

```bash
cd h:\MY2\new_html
npm run build
```

Expected:

```text
vite v6.x building for production...
✓ built in <time>
```

Warnings about large chunks are acceptable and pre-existing.

- [ ] **Step 4: Run project-memory scan and strict sync check**

Run:

```bash
cd h:\MY2
python .claude/skills/project-memory/scripts/scan_project.py .
python .claude/skills/project-memory/scripts/sync_check.py . --strict --levels ERROR
```

Expected:

```text
[OK] No drift detected. Code and docs are in sync.
```

- [ ] **Step 5: Manual UI QA**

Open VideoPage in card view and verify:

1. Select normal model `Wan2`.
   - Left and right cards remain compact.
   - Prompt textarea behavior is unchanged.
2. Select `飞升 (Seedance2)`.
   - Left card becomes taller than normal cards.
   - Right result card matches left card height.
   - Prompt, media inputs, output params, and warning section are visible without clicking “高级设置”.
   - Image preview is shorter than normal mode, leaving space for params.
3. Select `渡劫 (Seedance2Fast)`.
   - Same layout as 飞升.
   - 1080p option is disabled or visually marked unsupported.
4. Upload many images.
   - Image list scrolls inside its media block.
   - Output params remain visible.
5. Add only audio and prompt.
   - Validation shows: `不可单独输入音频，必须至少包含 1 张图或 1 段视频`.
6. Switch to list view.
   - Seedance panel still renders.
   - List view remains usable; no card-height-specific regressions.

- [ ] **Step 6: Commit generated context if changed and relevant**

If `scan_project.py` modified `context/*.json`, review whether changes are caused by this frontend slice. If only `context/modules/new_html__components.json`, `context/modules/new_html__utils.json`, or `context/project-summary.json` changed, commit them:

```bash
git add context/modules/new_html__components.json context/modules/new_html__utils.json context/project-summary.json
git commit -m "chore(context): refresh project memory after seedance card layout"
```

If context files include unrelated changes, do not commit them; leave them for the user.

- [ ] **Step 7: Final implementation commit check**

Run:

```bash
git status --short
git log --oneline -8
```

Expected:

```text
No unstaged changes except known unrelated local files such as .agents/skills/gstack or .claude/settings.local.json.
Recent commits include:
- test(seedance): add card layout helper coverage
- fix(seedance): use large synchronized cards in VideoPage
- fix(seedance): show all card parameters by default
- docs(seedance): document expanded card parameter layout
```

---

## Self-Review

### Spec Coverage

- Seedance-only large card height 620-760px: Task 1 + Task 2.
- Left/right same height: Task 2 applies shared helper to both cards.
- All parameters visible by default: Task 3 removes collapsed advanced behavior and adds component tests.
- Media lists do not break height: Task 3 adds local max-height scrolling to image/video/audio lists.
- Right result card uses large space: Task 2 adds result visual height helper.
- Docs + FAQ + deploy mirrors: Task 4.
- Build + project-memory gate: Task 5.

### Placeholder Scan

No TBD / TODO / “implement later” placeholders remain. Every code-modifying step includes exact file paths, code blocks, commands, and expected outcomes.

### Type Consistency

- `VideoModel` comes from `new_html/services/videoService.ts`.
- `Seedance2` and `Seedance2Fast` are the only Seedance models.
- Helper names are consistent across tests and implementation:
  - `isSeedanceModel`
  - `getCardHeightClass`
  - `getPreviewImageHeightClass`
  - `getResultVisualHeightClass`

### Risk Notes

- `VideoPage.tsx` is a large file; keep edits tightly scoped to card rendering sections.
- Do not touch backend or API request shape.
- Do not fix unrelated TypeScript errors.
