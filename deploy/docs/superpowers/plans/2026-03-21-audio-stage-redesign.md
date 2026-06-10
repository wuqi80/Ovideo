# 音频工作台重设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AudioStagePage 从三个 Tab 重构为统一工作台（左侧角色列表 + 中间台词配音 + 底部多轨时间轴），修复数据源 bug，增加逐条情绪控制。

**Architecture:** 将 1071 行的单文件拆为 5 个独立组件（AudioStagePage 壳 + VoiceSidebar + DubbingPanel + DubbingCard + MultiTrackTimeline），以 AudioStagePage 为数据协调中心，通过 props 向子组件分发数据。时间轴基于全部 storyboardItems（不是 clips），无台词镜头用 plannedDurationMs 占位。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, MiniMax TTS API, Lucide Icons

**Spec:** [`docs/superpowers/specs/2026-03-21-audio-stage-redesign.md`](../specs/2026-03-21-audio-stage-redesign.md)

---

## File Map

| 文件 | 动作 | 职责 |
|------|------|------|
| `new_html/pages/AudioStagePage.tsx` | 重写 | 页面壳：布局 + 数据加载 + clips builder + localOverrides state |
| `new_html/components/audio/DubbingCard.tsx` | 新建 | 单条台词卡片：双行布局 + 情绪/语速/音调/文本编辑/说话人 |
| `new_html/components/audio/DubbingPanel.tsx` | 新建 | 台词配音区：批量操作栏 + 分镜分组卡片列表 + scrollToItem |
| `new_html/components/audio/VoiceSidebar.tsx` | 新建 | 角色列表 + 声音设计 Drawer |
| `new_html/components/audio/MultiTrackTimeline.tsx` | 新建 | 4 轨时间轴 + 音乐 Modal |
| `new_html/components/audio/MusicModal.tsx` | 新建 | BGM 歌词+音乐生成弹窗（从 MusicTab 提取） |
| `new_html/pages/StoryboardGenPage.tsx` | 小修 | L121 timeline label 修复 |
| `new_html/WorkspaceApp.tsx` | 小修 | parseDurationToMs 增强 |
| `new_html/types.ts` | 小修 | 新增 ClipOverride 类型 |

---

### Task 1: 增强 parseDurationToMs + 修复 StoryboardGenPage label

**Files:**
- Modify: `new_html/WorkspaceApp.tsx:1747-1752`
- Modify: `new_html/pages/StoryboardGenPage.tsx:121`

这两个是独立的小修复，不依赖其他 Task，先做掉。

- [ ] **Step 1: 增强 parseDurationToMs**

在 `new_html/WorkspaceApp.tsx` L1747-1752，替换现有函数：

```typescript
// 旧代码（只匹配 "X秒"，1分30秒 会丢失分钟）
const parseDurationToMs = (durationStr?: string): number | null => {
    if (!durationStr) return null;
    const match = durationStr.match(/([\d.]+)\s*秒/);
    if (match) return Math.round(parseFloat(match[1]) * 1000);
    return null;
};

// 新代码
const parseDurationToMs = (durationStr?: string): number | null => {
    if (!durationStr) return null;
    const s = durationStr.trim();
    let totalMs = 0;
    const minMatch = s.match(/([\d.]+)\s*分/);
    if (minMatch) totalMs += parseFloat(minMatch[1]) * 60 * 1000;
    const secMatch = s.match(/([\d.]+)\s*秒/);
    if (secMatch) totalMs += parseFloat(secMatch[1]) * 1000;
    if (totalMs === 0) {
        const sMatch = s.match(/([\d.]+)\s*s\b/i);
        if (sMatch) totalMs = parseFloat(sMatch[1]) * 1000;
    }
    if (totalMs === 0) {
        const numMatch = s.match(/([\d.]+)/);
        if (numMatch) totalMs = parseFloat(numMatch[1]) * 1000;
    }
    return totalMs > 0 ? Math.round(totalMs) : null;
};
```

- [ ] **Step 2: 修复 StoryboardGenPage timeline label**

在 `new_html/pages/StoryboardGenPage.tsx` L121，将：
```typescript
label: (item.actionText || '').slice(0, 20) || '旁白',
```
改为：
```typescript
label: (item.dialogue || '').slice(0, 20) || '旁白',
```

- [ ] **Step 3: 验证构建**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无类型错误

---

### Task 2: 新增 ClipOverride 类型

**Files:**
- Modify: `new_html/types.ts`

- [ ] **Step 1: 在 AudioClipInfo 下方添加 ClipOverride 接口**

在 `new_html/types.ts` 的 `AudioClipInfo` 接口（L435-444）下方添加：

```typescript
export interface ClipOverride {
  emotion?: string;
  speed?: number;
  pitch?: number;
  text?: string;
  speaker?: string;
}
```

- [ ] **Step 2: 验证构建**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无类型错误

---

### Task 3: 创建 DubbingCard 组件

**Files:**
- Create: `new_html/components/audio/DubbingCard.tsx`

这是最底层的 UI 组件，不依赖其他新组件。

- [ ] **Step 1: 创建 audio 目录**

Run: `mkdir -p new_html/components/audio`（如果不存在）

- [ ] **Step 2: 编写 DubbingCard 组件**

创建 `new_html/components/audio/DubbingCard.tsx`：

```typescript
import React, { useCallback, useRef, useState } from 'react';
import {
  Play, Pause, Mic, RefreshCw, Loader, User, ChevronDown,
} from 'lucide-react';
import type { AudioClipInfo, CharacterVoice, ClipOverride, AssetItem } from '../../types';

const EMOTIONS = [
  { value: '', label: '默认(继承)' },
  { value: 'neutral', label: '中性' },
  { value: 'happy', label: '快乐' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'fearful', label: '恐惧' },
  { value: 'surprised', label: '惊讶' },
  { value: 'excited', label: '兴奋' },
];

function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/')) return path;
  return `/${path}`;
}

function fmtSec(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

function getAssetThumb(asset: AssetItem | undefined): string {
  if (!asset) return '';
  const t = (asset as any).thumbnailUrl || (asset as any).thumbnail_url || '';
  if (t) return resolveUrl(t);
  const refs = (asset as any).referenceImages || (asset as any).reference_images || [];
  if (Array.isArray(refs) && refs.length > 0) {
    const first = typeof refs[0] === 'string' ? refs[0] : refs[0]?.url || '';
    return resolveUrl(first);
  }
  return '';
}

export interface DubbingCardProps {
  clip: AudioClipInfo;
  clipKey: string;
  voice: CharacterVoice | undefined;
  charAsset: AssetItem | undefined;
  override: ClipOverride;
  onOverrideChange: (key: string, patch: Partial<ClipOverride>) => void;
  audioUrl: string;
  audioDurationMs: number | null;
  isGenerating: boolean;
  error: string | null;
  isPlaying: boolean;
  onGenerate: () => void;
  onTogglePlay: () => void;
  plannedDurationMs: number | null;
  allCharNames: string[];
}

export const DubbingCard: React.FC<DubbingCardProps> = ({
  clip, clipKey, voice, charAsset, override, onOverrideChange,
  audioUrl, audioDurationMs, isGenerating, error, isPlaying,
  onGenerate, onTogglePlay, plannedDurationMs, allCharNames,
}) => {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const displayText = override.text ?? clip.text;
  const displaySpeaker = override.speaker ?? clip.characterName;
  const thumb = getAssetThumb(charAsset);

  const actualMs = audioDurationMs;
  const overDuration = plannedDurationMs && actualMs && actualMs > plannedDurationMs;

  const effectiveEmotion = override.emotion || (voice?.voiceParams as any)?.emotion || 'neutral';
  const effectiveSpeed = override.speed ?? (voice?.voiceParams as any)?.speed ?? 1.0;

  const handleTextBlur = useCallback(() => {
    setEditing(false);
    const val = editRef.current?.value.trim();
    if (val && val !== clip.text) {
      onOverrideChange(clipKey, { text: val });
    }
  }, [clip.text, clipKey, onOverrideChange]);

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg bg-gray-800/50 border border-gray-700/50">
      {/* Row 1: speaker + text + play/generate */}
      <div className="flex items-center gap-3">
        {/* Avatar */}
        {thumb ? (
          <img src={thumb} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
            <User size={14} className="text-gray-500" />
          </div>
        )}

        {/* Speaker dropdown */}
        <div className="relative shrink-0">
          <select
            value={displaySpeaker}
            onChange={e => onOverrideChange(clipKey, { speaker: e.target.value })}
            className="appearance-none bg-transparent text-xs font-semibold text-indigo-400 pr-4 cursor-pointer focus:outline-none"
          >
            {allCharNames.map(n => <option key={n} value={n}>{n}</option>)}
            {!allCharNames.includes('旁白') && <option value="旁白">旁白</option>}
          </select>
          <ChevronDown size={10} className="absolute right-0 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" />
        </div>

        {/* Text (click to edit) */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea
              ref={editRef}
              defaultValue={displayText}
              onBlur={handleTextBlur}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextBlur(); } }}
              autoFocus
              rows={2}
              className="w-full bg-gray-900 border border-indigo-500/50 rounded px-2 py-1 text-sm text-gray-200 resize-none focus:outline-none"
            />
          ) : (
            <p
              className="text-sm text-gray-300 truncate cursor-text"
              onDoubleClick={() => setEditing(true)}
              title="双击编辑台词"
            >
              {displayText}
            </p>
          )}
          {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
        </div>

        {/* Play + Generate */}
        <div className="flex items-center gap-1.5 shrink-0">
          {audioUrl && (
            <button
              onClick={onTogglePlay}
              className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            </button>
          )}
          <button
            disabled={isGenerating}
            onClick={onGenerate}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 transition-all"
          >
            {isGenerating ? <Loader size={11} className="animate-spin" /> : audioUrl ? <RefreshCw size={11} /> : <Mic size={11} />}
            {audioUrl ? '重新' : '生成'}
          </button>
        </div>
      </div>

      {/* Row 2: emotion + speed + pitch + duration */}
      <div className="flex items-center gap-3 pl-11 text-xs">
        {/* Emotion */}
        <select
          value={override.emotion || ''}
          onChange={e => onOverrideChange(clipKey, { emotion: e.target.value || undefined })}
          className="bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-gray-300 text-[11px]"
        >
          {EMOTIONS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>

        {/* Speed */}
        <div className="flex items-center gap-1">
          <span className="text-gray-600">速</span>
          <input
            type="range" min="0.5" max="2.0" step="0.1"
            value={override.speed ?? (voice?.voiceParams as any)?.speed ?? 1.0}
            onChange={e => onOverrideChange(clipKey, { speed: parseFloat(e.target.value) })}
            className="w-16 h-1 accent-indigo-500"
          />
          <span className="text-gray-500 tabular-nums w-7">{effectiveSpeed.toFixed(1)}x</span>
        </div>

        {/* Pitch */}
        <div className="flex items-center gap-1">
          <span className="text-gray-600">调</span>
          <input
            type="range" min="-12" max="12" step="1"
            value={override.pitch ?? (voice?.voiceParams as any)?.pitch ?? 0}
            onChange={e => onOverrideChange(clipKey, { pitch: parseInt(e.target.value) })}
            className="w-12 h-1 accent-indigo-500"
          />
          <span className="text-gray-500 tabular-nums w-5">{override.pitch ?? (voice?.voiceParams as any)?.pitch ?? 0}</span>
        </div>

        {/* Duration badge */}
        <span className="ml-auto text-gray-500 tabular-nums">
          {plannedDurationMs ? `设计${fmtSec(plannedDurationMs)}` : ''}
          {actualMs ? (
            <span className={overDuration ? 'text-amber-400 ml-1' : 'text-green-400 ml-1'}>
              / 音频{fmtSec(actualMs)} {overDuration ? '⚠' : '✓'}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: 验证构建**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无类型错误（组件还未使用，但类型要通过）

---

### Task 4: 创建 DubbingPanel 组件

**Files:**
- Create: `new_html/components/audio/DubbingPanel.tsx`

依赖 Task 3 的 DubbingCard。

- [ ] **Step 1: 编写 DubbingPanel 组件**

创建 `new_html/components/audio/DubbingPanel.tsx`：

```typescript
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Volume2, Loader, Clock } from 'lucide-react';
import { DubbingCard } from './DubbingCard';
import type {
  AudioClipInfo, CharacterVoice, ClipOverride, AssetItem, StoryboardItemDB,
} from '../../types';
import { parseBoundAssetTags } from '../../utils/episodeAdapters';

export interface DubbingPanelHandle {
  scrollToItem: (itemId: string) => void;
}

export interface DubbingPanelProps {
  storyboardItems: StoryboardItemDB[];
  clips: AudioClipInfo[];
  voiceMap: Map<string, CharacterVoice>;
  charAssetMap: Map<string, AssetItem>;
  localOverrides: Record<string, ClipOverride>;
  setLocalOverrides: React.Dispatch<React.SetStateAction<Record<string, ClipOverride>>>;
  localAudio: Record<string, { url: string; durationMs?: number }>;
  generatingIds: Set<string>;
  errors: Record<string, string>;
  playingKey: string;
  onGenerate: (clip: AudioClipInfo) => void;
  onTogglePlay: (key: string) => void;
  onBatchGenerate: () => void;
  batchRunning: boolean;
  allCharNames: string[];
  clipKeyFn: (clip: AudioClipInfo) => string;
}

export const DubbingPanel = forwardRef<DubbingPanelHandle, DubbingPanelProps>((props, ref) => {
  const {
    storyboardItems, clips, voiceMap, charAssetMap,
    localOverrides, setLocalOverrides,
    localAudio, generatingIds, errors, playingKey,
    onGenerate, onTogglePlay, onBatchGenerate, batchRunning,
    allCharNames, clipKeyFn,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useImperativeHandle(ref, () => ({
    scrollToItem(itemId: string) {
      const el = itemRefs.current.get(itemId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  }));

  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  const clipsByItem = useMemo(() => {
    const m = new Map<string, AudioClipInfo[]>();
    for (const c of clips) {
      const list = m.get(c.itemId) || [];
      list.push(c);
      m.set(c.itemId, list);
    }
    return m;
  }, [clips]);

  const handleOverrideChange = useCallback((key: string, patch: Partial<ClipOverride>) => {
    setLocalOverrides(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), ...patch },
    }));
  }, [setLocalOverrides]);

  const totalDurationMs = useMemo(() => {
    return clips.reduce((sum, c) => {
      const key = clipKeyFn(c);
      return sum + (localAudio[key]?.durationMs || c.durationMs || 0);
    }, 0);
  }, [clips, localAudio, clipKeyFn]);

  const generatedCount = clips.filter(c => localAudio[clipKeyFn(c)]?.url || c.audioUrl).length;

  const overItems = sortedItems.filter(i =>
    i.plannedDurationMs && i.audioDurationMs && i.audioDurationMs > i.plannedDurationMs
  );

  return (
    <div ref={containerRef} className="flex-1 overflow-auto space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-4 sticky top-0 bg-gray-950/90 backdrop-blur-sm z-10 pb-3 border-b border-gray-800">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
          <Clock size={14} className="text-indigo-400" />
          <span className="text-xs text-gray-500">总时长</span>
          <span className="text-sm font-bold tabular-nums">
            {totalDurationMs > 0 ? `${(totalDurationMs / 1000).toFixed(1)}s` : '—'}
          </span>
        </div>
        <button
          disabled={batchRunning || clips.length === 0}
          onClick={onBatchGenerate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all disabled:opacity-50"
        >
          {batchRunning ? <Loader size={14} className="animate-spin" /> : <Volume2 size={14} />}
          全部生成
        </button>
        <span className="text-xs text-gray-600 ml-auto">
          {generatedCount}/{clips.length} 已生成
        </span>
      </div>

      {/* Duration warnings */}
      {overItems.length > 0 && (
        <div className="px-4 py-2 bg-amber-900/20 border border-amber-600/30 rounded-lg text-amber-400 text-sm flex items-center gap-2">
          <Clock size={14} />
          {overItems.length} 个镜头的音频时长超过设计时长
        </div>
      )}

      {/* Shot groups */}
      {sortedItems.length === 0 ? (
        <div className="py-16 text-center text-gray-500 bg-gray-900 rounded-xl border border-dashed border-gray-800">
          暂无分镜条目。请先在剧本流程中创建分镜。
        </div>
      ) : (
        sortedItems.map(item => {
          const itemClips = clipsByItem.get(item.itemId) || [];
          const hasDialogue = itemClips.length > 0;
          return (
            <div
              key={item.itemId}
              ref={el => { if (el) itemRefs.current.set(item.itemId, el); }}
              className="bg-gray-900 rounded-xl border border-gray-800 p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                  #{item.sortOrder}
                </span>
                {item.plannedDurationMs && (
                  <span className="text-[10px] text-gray-500">
                    设计时长 {(item.plannedDurationMs / 1000).toFixed(1)}s
                  </span>
                )}
                {!hasDialogue && (
                  <span className="text-[10px] text-gray-600 italic ml-auto">
                    无台词 — 按设计时长占位
                  </span>
                )}
              </div>
              {hasDialogue ? (
                <div className="space-y-2">
                  {itemClips.map(clip => {
                    const key = clipKeyFn(clip);
                    const audio = localAudio[key];
                    return (
                      <DubbingCard
                        key={key}
                        clip={clip}
                        clipKey={key}
                        voice={voiceMap.get(clip.characterName)}
                        charAsset={charAssetMap.get(clip.characterName)}
                        override={localOverrides[key] || {}}
                        onOverrideChange={handleOverrideChange}
                        audioUrl={audio?.url || (clip.audioUrl ? (clip.audioUrl.startsWith('/') ? clip.audioUrl : `/${clip.audioUrl}`) : '')}
                        audioDurationMs={audio?.durationMs || clip.durationMs}
                        isGenerating={generatingIds.has(key)}
                        error={errors[key] || null}
                        isPlaying={playingKey === key}
                        onGenerate={() => onGenerate(clip)}
                        onTogglePlay={() => onTogglePlay(key)}
                        plannedDurationMs={item.plannedDurationMs}
                        allCharNames={allCharNames}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="h-8 rounded bg-gray-800/30 border border-dashed border-gray-700 flex items-center justify-center text-xs text-gray-600">
                  无配音内容（设计时长 {item.plannedDurationMs ? `${(item.plannedDurationMs / 1000).toFixed(1)}s` : '未设置'}）
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
});

DubbingPanel.displayName = 'DubbingPanel';
```

- [ ] **Step 2: 验证构建**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无类型错误

---

### Task 5: 创建 VoiceSidebar 组件

**Files:**
- Create: `new_html/components/audio/VoiceSidebar.tsx`

从现有 `VoiceDesignTab`（AudioStagePage.tsx L159-523）提取改造。

- [ ] **Step 1: 编写 VoiceSidebar 组件**

创建 `new_html/components/audio/VoiceSidebar.tsx`。核心结构：

```typescript
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  User, ChevronRight, Settings, Play, Save, Trash2, Loader,
  Volume2, Copy, Wand2, Upload, X,
} from 'lucide-react';
import {
  generateSpeech, createCharacterVoice, updateCharacterVoice, deleteCharacterVoice,
  minimaxVoiceDesign, minimaxVoiceClone, minimaxFileUpload,
} from '../../services/apiService';
import type { AssetItem, CharacterVoice, VoiceDesignSetting } from '../../types';

// 复用 resolveUrl, getAssetThumb（与 DubbingCard 相同）
function resolveUrl(path: string) { /* ... */ }
function getAssetThumb(asset: AssetItem | undefined): string { /* ... */ }

const SYSTEM_VOICES = [
  { id: 'narrator', label: '旁白' },
  { id: 'male_young', label: '青年男声' },
  { id: 'female_young', label: '青年女声' },
  { id: 'elder', label: '长者' },
  { id: 'child', label: '儿童' },
];

type VoiceSource = 'system' | 'clone' | 'design';

export interface VoiceSidebarProps {
  assets: AssetItem[];
  characterVoices: CharacterVoice[];
  projectId: string;
  reload: () => Promise<void>;
}

export const VoiceSidebar: React.FC<VoiceSidebarProps> = ({
  assets, characterVoices, projectId, reload,
}) => {
  // --- 角色列表 ---
  const characterAssets = useMemo(
    () => assets.filter(a => ((a as any).assetType || (a as any).asset_type) === 'character'),
    [assets],
  );
  const roles = useMemo(() => {
    const list: { name: string; asset?: AssetItem; voice?: CharacterVoice }[] = [];
    const voiceMap = new Map(characterVoices.map(v => [v.characterName, v]));
    for (const a of characterAssets) {
      const name = (a as any).name || '未命名';
      list.push({ name, asset: a, voice: voiceMap.get(name) });
    }
    if (!list.some(r => r.name === '旁白')) {
      list.push({ name: '旁白', voice: voiceMap.get('旁白') });
    }
    return list;
  }, [characterAssets, characterVoices]);

  // --- Drawer state ---
  const [drawerRole, setDrawerRole] = useState<string | null>(null);
  // ... 声音设计逻辑（复用现有 VoiceDesignTab 的 handlePreview, handleSave, handleDeleteVoice）

  return (
    <div className="w-52 shrink-0 flex flex-col border-r border-gray-800 bg-gray-950">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-3 pt-4 pb-2">
        角色声音
      </h3>
      <div className="flex-1 overflow-auto space-y-1 px-2">
        {roles.map(role => {
          const thumb = getAssetThumb(role.asset);
          return (
            <button
              key={role.name}
              onClick={() => setDrawerRole(role.name)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all hover:bg-gray-900 group"
            >
              {thumb ? (
                <img src={thumb} alt="" className="w-8 h-8 rounded-lg object-cover bg-gray-800" />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center">
                  <User size={14} className="text-gray-600" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{role.name}</div>
                {role.voice ? (
                  <div className="text-[10px] text-emerald-400 truncate">
                    {role.voice.voiceName || '已配音'}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-600">未配音</div>
                )}
              </div>
              <ChevronRight size={12} className="text-gray-700 group-hover:text-gray-500 shrink-0" />
            </button>
          );
        })}
      </div>

      {/* Drawer overlay */}
      {drawerRole && (
        <VoiceDrawer
          roleName={drawerRole}
          role={roles.find(r => r.name === drawerRole)}
          projectId={projectId}
          onClose={() => setDrawerRole(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
};

// --- VoiceDrawer 子组件 ---
// 复用现有 VoiceDesignTab L200-523 的声音配置面板逻辑
// 包含：系统预设选择、声音克隆上传、声音设计参数、试听、保存、删除
interface VoiceDrawerProps {
  roleName: string;
  role?: { name: string; asset?: AssetItem; voice?: CharacterVoice };
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const VoiceDrawer: React.FC<VoiceDrawerProps> = ({
  roleName, role, projectId, onClose, onSaved,
}) => {
  const [voiceSource, setVoiceSource] = useState<VoiceSource>('system');
  const [systemVoiceId, setSystemVoiceId] = useState('narrator');
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [designSetting, setDesignSetting] = useState<VoiceDesignSetting>({
    voice_type: 'female', emotion: 'neutral', speed: 1.0, pitch: 0,
  });
  const [designText, setDesignText] = useState('你好，这是一段测试语音。');
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // handlePreview, handleSave, handleDeleteVoice — 逻辑与现有 VoiceDesignTab 完全相同
  // 参见设计文档 spec 的 "2. VoiceSidebar" 部分

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-96 bg-gray-900 border-l border-gray-800 h-full overflow-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Settings size={16} className="text-indigo-400" />
            {roleName} — 声音配置
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>
        {/* 三种来源切换 + 配置面板 + 试听/保存 */}
        {/* 复用现有 VoiceDesignTab L367-517 的 JSX，适配 Drawer 宽度 */}
      </div>
    </div>
  );
};
```

**关键说明：** VoiceDrawer 内部的 handlePreview / handleSave / handleDeleteVoice 逻辑直接从现有 `VoiceDesignTab`（AudioStagePage.tsx L225-309）复制，不需要改动业务逻辑，只需要适配 Drawer 的关闭行为（保存后调用 `onSaved` + `onClose`）。

- [ ] **Step 2: 验证构建**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无类型错误

---

### Task 6: 创建 MultiTrackTimeline 组件

**Files:**
- Create: `new_html/components/audio/MultiTrackTimeline.tsx`
- Create: `new_html/components/audio/MusicModal.tsx`

- [ ] **Step 1: 编写 MusicModal**

创建 `new_html/components/audio/MusicModal.tsx`：从现有 `MusicTab`（AudioStagePage.tsx L902-1069）提取歌词生成+音乐生成逻辑，包裹在 Modal 中。

```typescript
import React, { useCallback, useState } from 'react';
import { X, FileText, Music, Wand2, Loader } from 'lucide-react';
import { minimaxLyrics, minimaxMusic, createAudioTrack } from '../../services/apiService';

export interface MusicModalProps {
  episodeId: string;
  script: any;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export const MusicModal: React.FC<MusicModalProps> = ({
  episodeId, script, onClose, onCreated,
}) => {
  // 复用 MusicTab 的 handleGenerateLyrics + handleGenerateMusic 逻辑
  // 保存到 audio_tracks 后调用 onCreated + onClose
  // ...（与现有 MusicTab L928-969 相同的业务逻辑）

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-800 rounded-2xl w-[600px] max-h-[80vh] overflow-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold">添加背景音乐</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>
        {/* 歌词生成区 + 音乐生成区（复用 MusicTab L976-1038 的 JSX） */}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: 编写 MultiTrackTimeline**

创建 `new_html/components/audio/MultiTrackTimeline.tsx`：

```typescript
import React, { useMemo, useState, useCallback, useRef } from 'react';
import { Play, Pause, Plus, Music } from 'lucide-react';
import { MusicModal } from './MusicModal';
import type { StoryboardItemDB, AudioClipInfo } from '../../types';

export interface TimelineSegment {
  itemId: string;
  sortOrder: number;
  durationMs: number;
  hasDialogue: boolean;
  hasAudio: boolean;
  clip: AudioClipInfo | null;
  label: string;
}

export interface MultiTrackTimelineProps {
  storyboardItems: StoryboardItemDB[];
  clips: AudioClipInfo[];
  localAudio: Record<string, { url: string; durationMs?: number }>;
  audioTracks: any[];
  clipKeyFn: (clip: AudioClipInfo) => string;
  onClickItem: (itemId: string) => void;
  episodeId: string;
  script: any;
  reload: () => Promise<void>;
}

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({
  storyboardItems, clips, localAudio, audioTracks, clipKeyFn,
  onClickItem, episodeId, script, reload,
}) => {
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40);

  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  // 基于 ALL storyboardItems 构建 segments（不是 clips）
  const segments: TimelineSegment[] = useMemo(() => {
    return sortedItems.map(item => {
      const clip = clips.find(c => c.itemId === item.itemId);
      const key = clip ? clipKeyFn(clip) : '';
      const audio = key ? localAudio[key] : undefined;
      const hasAudio = !!(clip && (audio?.url || clip.audioUrl));
      const durationMs = hasAudio
        ? (audio?.durationMs || clip!.durationMs || item.plannedDurationMs || 2000)
        : (item.plannedDurationMs || 2000);
      return {
        itemId: item.itemId,
        sortOrder: item.sortOrder,
        durationMs,
        hasDialogue: !!clip,
        hasAudio,
        clip,
        label: clip
          ? `${clip.characterName}: ${clip.text.slice(0, 12)}`
          : `#${item.sortOrder}`,
      };
    });
  }, [sortedItems, clips, localAudio, clipKeyFn]);

  const totalMs = segments.reduce((s, seg) => s + seg.durationMs, 0);

  const bgmTracks = useMemo(
    () => audioTracks.filter(t => (t.trackType || t.track_type) === 'bgm'),
    [audioTracks],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPixelsPerSecond(prev => Math.max(10, Math.min(200, prev - e.deltaY * 0.1)));
    }
  }, []);

  const msToWidth = (ms: number) => `${(ms / 1000) * pixelsPerSecond}px`;

  return (
    <div className="border-t border-gray-800 bg-gray-950 flex flex-col" style={{ height: '200px' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-bold text-gray-500 uppercase">时间轴</span>
        <span className="text-[10px] text-gray-600 tabular-nums">
          总 {(totalMs / 1000).toFixed(1)}s | {pixelsPerSecond}px/s
        </span>
        <span className="flex-1" />
        <span className="text-[10px] text-gray-600">Ctrl+滚轮缩放</span>
      </div>

      {/* Tracks */}
      <div className="flex-1 overflow-auto" onWheel={handleWheel}>
        <div style={{ minWidth: msToWidth(totalMs) }}>
          {/* Track 1: 镜头标记 */}
          <div className="flex items-center h-7 border-b border-gray-800/50">
            <span className="w-16 shrink-0 text-[10px] text-gray-600 px-2">镜头</span>
            <div className="flex h-full">
              {segments.map(seg => (
                <div
                  key={`mark-${seg.itemId}`}
                  style={{ width: msToWidth(seg.durationMs) }}
                  className="border-r border-gray-800/30 flex items-center justify-center text-[10px] text-gray-500 cursor-pointer hover:bg-gray-900/50"
                  onClick={() => onClickItem(seg.itemId)}
                >
                  #{seg.sortOrder}
                </div>
              ))}
            </div>
          </div>

          {/* Track 2: 台词音频 */}
          <div className="flex items-center h-8 border-b border-gray-800/50">
            <span className="w-16 shrink-0 text-[10px] text-gray-600 px-2">台词</span>
            <div className="flex h-full py-0.5 gap-px">
              {segments.map(seg => (
                <div
                  key={`audio-${seg.itemId}`}
                  style={{ width: msToWidth(seg.durationMs) }}
                  className={`rounded-sm flex items-center justify-center text-[9px] truncate px-1 cursor-pointer transition-colors ${
                    seg.hasAudio
                      ? 'bg-sky-500/50 text-sky-200 hover:bg-sky-500/70'
                      : seg.hasDialogue
                        ? 'bg-amber-500/30 text-amber-300 hover:bg-amber-500/50'
                        : 'bg-gray-800/30 text-gray-600 border border-dashed border-gray-700/50'
                  }`}
                  onClick={() => onClickItem(seg.itemId)}
                  title={seg.label}
                >
                  {seg.hasDialogue ? seg.label : `${(seg.durationMs / 1000).toFixed(1)}s`}
                </div>
              ))}
            </div>
          </div>

          {/* Track 3: BGM */}
          <div className="flex items-center h-8 border-b border-gray-800/50">
            <span className="w-16 shrink-0 text-[10px] text-gray-600 px-2">BGM</span>
            <div className="flex-1 h-full py-0.5 relative">
              {bgmTracks.map((t: any) => {
                const durMs = t.durationMs || t.duration_ms || 0;
                return (
                  <div
                    key={t.trackId || t.track_id}
                    style={{ width: durMs > 0 ? msToWidth(durMs) : '100%' }}
                    className="h-full bg-emerald-500/30 rounded-sm flex items-center px-2 text-[9px] text-emerald-300 truncate"
                  >
                    <Music size={10} className="mr-1 shrink-0" /> {t.name || 'BGM'}
                  </div>
                );
              })}
              <button
                onClick={() => setShowMusicModal(true)}
                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white text-[10px] font-semibold transition-all"
              >
                <Plus size={10} /> 添加音乐
              </button>
            </div>
          </div>

          {/* Track 4: 音效 */}
          <div className="flex items-center h-7">
            <span className="w-16 shrink-0 text-[10px] text-gray-600 px-2">音效</span>
            <div className="flex h-full py-0.5 gap-px">
              {segments.map(seg => {
                const item = sortedItems.find(i => i.itemId === seg.itemId);
                const hasSfx = item?.sfxAudioUrl;
                return (
                  <div
                    key={`sfx-${seg.itemId}`}
                    style={{ width: msToWidth(seg.durationMs) }}
                    className={`rounded-sm ${hasSfx ? 'bg-purple-500/30' : ''}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Music Modal */}
      {showMusicModal && (
        <MusicModal
          episodeId={episodeId}
          script={script}
          onClose={() => setShowMusicModal(false)}
          onCreated={async () => { await reload(); setShowMusicModal(false); }}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 3: 验证构建**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无类型错误

---

### Task 7: 重写 AudioStagePage 壳

**Files:**
- Rewrite: `new_html/pages/AudioStagePage.tsx`

这是最后的组装步骤，将所有子组件拼接到一起。

- [ ] **Step 1: 备份旧文件**

Run: `copy new_html\pages\AudioStagePage.tsx new_html\pages\AudioStagePage.old.tsx`

- [ ] **Step 2: 重写 AudioStagePage**

`new_html/pages/AudioStagePage.tsx` 新内容（~150 行）：

```typescript
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, ArrowRight } from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import {
  minimaxTTS, generateSpeech,
  updateStoryboardItem as apiUpdateStoryboardItem,
} from '../services/apiService';
import { parseBoundAssetTags } from '../utils/episodeAdapters';
import { VoiceSidebar } from '../components/audio/VoiceSidebar';
import { DubbingPanel, type DubbingPanelHandle } from '../components/audio/DubbingPanel';
import { MultiTrackTimeline } from '../components/audio/MultiTrackTimeline';
import type { AudioClipInfo, ClipOverride, CharacterVoice, AssetItem } from '../types';

function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/')) return path;
  return `/${path}`;
}

export const AudioStagePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    storyboardItems, assets, characterVoices, audioTracks,
    projectId, episodeId, script, isLoading, error, reload, loadSlices,
  } = useEpisode();

  useEffect(() => {
    loadSlices('storyboardItems', 'assets', 'characterVoices', 'script', 'audioTracks');
  }, [loadSlices]);

  // --- Derived data ---
  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  const voiceMap = useMemo(() => {
    const m = new Map<string, CharacterVoice>();
    characterVoices.forEach(v => m.set(v.characterName, v));
    return m;
  }, [characterVoices]);

  const charAssetMap = useMemo(() => {
    const m = new Map<string, AssetItem>();
    assets
      .filter(a => ((a as any).assetType || (a as any).asset_type) === 'character')
      .forEach(a => m.set((a as any).name, a));
    return m;
  }, [assets]);

  const allCharNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of storyboardItems) {
      const { charNames } = parseBoundAssetTags(Array.isArray(item.boundAssets) ? item.boundAssets : []);
      charNames.forEach(n => names.add(n));
    }
    names.add('旁白');
    return Array.from(names);
  }, [storyboardItems]);

  // --- Clips builder (修复后: 只用 dialogue, 过滤 "无") ---
  const clips: AudioClipInfo[] = useMemo(() => {
    const result: AudioClipInfo[] = [];
    for (const item of sortedItems) {
      const raw = (item.dialogue || '').trim();
      if (!raw || /^(无|无台词|无对白|\(无台词\))$/.test(raw)) continue;
      const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
      const { charNames } = parseBoundAssetTags(boundAssets);
      let speaker = '';
      let text = raw;
      const candidates = [...charNames, '旁白'];
      for (const name of candidates) {
        if (raw.startsWith(name)) {
          speaker = name;
          text = raw.slice(name.length).replace(/^[：:，,\s]+/, '').trim() || raw;
          break;
        }
      }
      if (!speaker) speaker = charNames[0] || '旁白';
      const type = speaker === '旁白' ? 'narration' as const : 'dialogue' as const;
      const audioField = type === 'narration' ? item.narrationAudioUrl : item.dialogueAudioUrl;
      result.push({
        itemId: item.itemId, sortOrder: item.sortOrder, type, text,
        characterName: speaker,
        audioUrl: audioField ? resolveUrl(audioField) : null,
        durationMs: audioField ? (item.audioDurationMs || null) : null,
        voiceId: voiceMap.get(speaker)?.voiceModelId || null,
      });
    }
    return result;
  }, [sortedItems, voiceMap]);

  const clipKey = (c: AudioClipInfo) => `${c.itemId}_${c.type}`;

  // --- Per-clip overrides ---
  const [localOverrides, setLocalOverrides] = useState<Record<string, ClipOverride>>({});
  const [localAudio, setLocalAudio] = useState<Record<string, { url: string; durationMs?: number }>>({});
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [playingKey, setPlayingKey] = useState('');
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const dubbingRef = useRef<DubbingPanelHandle>(null);

  // --- TTS generate ---
  const runGenerate = useCallback(async (clip: AudioClipInfo) => {
    const key = clipKey(clip);
    const override = localOverrides[key] || {};
    const voice = voiceMap.get(override.speaker ?? clip.characterName);
    setErrors(p => { const n = { ...p }; delete n[key]; return n; });
    setGeneratingIds(p => new Set(p).add(key));
    try {
      const textToSpeak = override.text ?? clip.text;
      const emotion = override.emotion ?? (voice?.voiceParams as any)?.emotion ?? 'neutral';
      const speed = override.speed ?? (voice?.voiceParams as any)?.speed ?? 1.0;
      const pitch = override.pitch ?? (voice?.voiceParams as any)?.pitch ?? 0;

      let result: any;
      if (voice?.voiceProvider === 'minimax' && voice.voiceModelId) {
        result = await minimaxTTS({ text: textToSpeak, voice_id: voice.voiceModelId, speed, emotion, pitch });
      } else {
        result = await generateSpeech({ text: textToSpeak, persona: voice?.voiceModelId || 'narrator', emotion });
      }
      if (!result?.success && !result?.audio_url) throw new Error(result?.detail || '生成失败');
      const url = result.audio_url as string;
      const durationMs = result.duration_ms as number | undefined;
      setLocalAudio(p => ({ ...p, [key]: { url: resolveUrl(url), durationMs } }));

      const updateFields: Record<string, any> = {};
      if (clip.type === 'narration') updateFields.narration_audio_url = url;
      else updateFields.dialogue_audio_url = url;
      if (durationMs && Number.isFinite(durationMs)) updateFields.audio_duration_ms = durationMs;
      try { await apiUpdateStoryboardItem(clip.itemId, updateFields); } catch {}
    } catch (e: any) {
      setErrors(p => ({ ...p, [key]: e.message || String(e) }));
    } finally {
      setGeneratingIds(p => { const n = new Set(p); n.delete(key); return n; });
    }
  }, [voiceMap, localOverrides]);

  const handleBatchGenerate = useCallback(async () => {
    if (batchRunning || clips.length === 0) return;
    setBatchRunning(true);
    try { for (const clip of clips) await runGenerate(clip); }
    finally { setBatchRunning(false); }
  }, [clips, batchRunning, runGenerate]);

  const togglePlay = useCallback((key: string) => {
    const el = audioRefs.current.get(key);
    if (!el) {
      const audioUrl = localAudio[key]?.url || clips.find(c => clipKey(c) === key)?.audioUrl;
      if (!audioUrl) return;
      const newEl = new Audio(audioUrl);
      audioRefs.current.set(key, newEl);
      newEl.onended = () => setPlayingKey(k => k === key ? '' : k);
      newEl.play().catch(() => {});
      setPlayingKey(key);
      return;
    }
    if (!el.paused) { el.pause(); setPlayingKey(''); return; }
    audioRefs.current.forEach((a, k) => { if (k !== key) a.pause(); });
    el.play().catch(() => {});
    setPlayingKey(key);
  }, [localAudio, clips]);

  // --- Loading / Error ---
  if (isLoading) {
    return <div className="min-h-full bg-gray-950 flex items-center justify-center text-gray-500">加载中...</div>;
  }
  if (error) {
    return <div className="min-h-full bg-gray-950 text-red-400 p-6">{error}</div>;
  }

  // --- Render ---
  return (
    <div className="h-full bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800 shrink-0">
        <Mic size={20} className="text-indigo-400" />
        <h1 className="text-lg font-bold tracking-tight">声音与配音</h1>
        <span className="flex-1" />
        <button
          onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all"
        >
          导出到分镜 <ArrowRight size={14} />
        </button>
      </header>

      {/* Main: Sidebar + DubbingPanel */}
      <div className="flex flex-1 min-h-0">
        <VoiceSidebar
          assets={assets}
          characterVoices={characterVoices}
          projectId={projectId}
          reload={reload}
        />
        <DubbingPanel
          ref={dubbingRef}
          storyboardItems={storyboardItems}
          clips={clips}
          voiceMap={voiceMap}
          charAssetMap={charAssetMap}
          localOverrides={localOverrides}
          setLocalOverrides={setLocalOverrides}
          localAudio={localAudio}
          generatingIds={generatingIds}
          errors={errors}
          playingKey={playingKey}
          onGenerate={runGenerate}
          onTogglePlay={togglePlay}
          onBatchGenerate={handleBatchGenerate}
          batchRunning={batchRunning}
          allCharNames={allCharNames}
          clipKeyFn={clipKey}
        />
      </div>

      {/* Timeline */}
      <MultiTrackTimeline
        storyboardItems={storyboardItems}
        clips={clips}
        localAudio={localAudio}
        audioTracks={audioTracks}
        clipKeyFn={clipKey}
        onClickItem={(itemId) => dubbingRef.current?.scrollToItem(itemId)}
        episodeId={episodeId}
        script={script}
        reload={reload}
      />
    </div>
  );
};
```

- [ ] **Step 3: 验证构建**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 验证 dev 运行**

Run: `cd new_html && npm run build`
Expected: 构建成功

---

### Task 8: 端到端验证

- [ ] **Step 1: 功能验证清单**

手动验证以下流程：

1. 左侧角色列表显示所有角色 + "旁白"
2. 点击角色弹出声音设计抽屉，可以试听和保存
3. 中间区域只显示有台词的镜头配音卡片（"无" 已被过滤）
4. 无台词镜头显示灰色占位条
5. 每条台词卡片可以：
   - 切换说话人
   - 双击编辑文本
   - 调整情绪/语速/音调
   - 点击生成配音
   - 播放已生成音频
6. "全部生成" 批量生成所有台词
7. 底部时间轴显示全部镜头（含无台词的占位）
8. 时间轴无台词块使用 plannedDurationMs 宽度
9. BGM 轨道 "+ 添加音乐" 弹出音乐 Modal
10. 点击时间轴色块联动到配音区对应卡片
11. Ctrl+滚轮缩放时间轴

- [ ] **Step 2: 清理旧文件**

确认一切正常后，删除备份：
Run: `del new_html\pages\AudioStagePage.old.tsx`
