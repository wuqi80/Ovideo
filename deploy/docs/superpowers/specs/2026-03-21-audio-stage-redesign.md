# Audio Stage Page Redesign — 统一音频工作台

## 概述

将当前 AudioStagePage 的三个 Tab（声音设计、音频预演、音乐制作）合并为一个统一的工作台页面，解决数据源错误、操作割裂、预览不足等问题。

## 背景与问题

### 当前架构

`AudioStagePage.tsx`（1071 行）包含三个子组件：
- `VoiceDesignTab`: 角色列表 + 声音配置（系统预设/克隆/设计）
- `AudioPreviewTab`: 按镜头分组的配音卡片 + 简单时间轴
- `MusicTab`: 歌词生成 + BGM 生成管理

### 确认的 Bug

1. **`actionText` 被当作旁白（L568）**: `action_text` 存的是 `scriptSegment`（取景+角度+站位+动作），是画面描写，不是旁白
2. **`dialogue` = "无" 未过滤（L569）**: AI 生成 `人声：无` 时，"无" 被当成有效台词
3. **`sceneHeading` 被当作 fallback（L600-611）**: `scene_heading` 存的是完整镜头原文，被错误用作旁白

**根因**: `dialogue` 字段（来自 AI 脚本的 `人声`）是唯一正确的配音文本来源。`actionText` 是画面描写，`sceneHeading` 是完整原文，都不应配音。

### 体验问题

- 声音设计和配音割裂，需要在 Tab 间切换
- 同角色所有台词只能用一种情绪，无法区分"内心OS"与正常对话
- 时间轴太简陋，无法看到完整音频全貌
- 无台词镜头在时间轴上不显示
- BGM 与配音脱节

## 设计方案

### 整体布局

三栏固定布局，不使用 Tab 切换：

```
┌──────────┬──────────────────────────────────┐
│ Voice    │  DubbingPanel (可滚动)             │
│ Sidebar  │  双行台词卡片列表                    │
│ ~200px   │  + 批量操作栏                       │
│          │                                    │
├──────────┴──────────────────────────────────┤
│ MultiTrackTimeline (固定底部 ~200px)           │
│ 镜头标记 | 台词音频 | BGM | 音效                │
└────────────────────────────────────────────┘
```

### 组件拆分

从当前 1 个文件（1071 行）拆为 5 个文件：

| 文件 | 职责 | 估计行数 |
|------|------|---------|
| `AudioStagePage.tsx` | 页面壳：布局、数据加载、clips builder、状态协调 | ~150 |
| `VoiceSidebar.tsx` | 角色列表 + 声音设计抽屉 | ~250 |
| `DubbingPanel.tsx` | 台词配音区：批量操作 + 卡片列表容器 | ~300 |
| `DubbingCard.tsx` | 单条台词卡片：双行布局 + 所有控件 | ~150 |
| `MultiTrackTimeline.tsx` | 底部 4 轨时间轴 + 音乐弹窗入口 | ~200 |

### 数据流

```
EpisodeContext (storyboardItems, assets, characterVoices, audioTracks)
       ↓
AudioStagePage
  ├── clips builder (修复后: 只用 dialogue, 过滤 "无", 解析角色名)
  ├── voiceMap (characterName → CharacterVoice)
  ├── localOverrides state (per-clip 情绪/语速/文本覆盖)
  │
  ├──→ VoiceSidebar (characterVoices, assets, reload)
  ├──→ DubbingPanel (clips, voiceMap, localOverrides, setLocalOverrides)
  │     └──→ DubbingCard × N
  └──→ MultiTrackTimeline (storyboardItems, clips, audioTracks)
```

## 详细设计

### 1. Clips Builder（核心修复）

```typescript
const clips: AudioClipInfo[] = useMemo(() => {
  const result: AudioClipInfo[] = [];
  for (const item of sortedItems) {
    const raw = (item.dialogue || '').trim();
    // 过滤无配音内容的标记
    if (!raw || /^(无|无台词|无对白|\(无台词\))$/.test(raw)) continue;

    const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
    const { charNames } = parseBoundAssetTags(boundAssets);

    // 从 dialogue 文本开头匹配角色名
    let speaker = '';
    let text = raw;
    const allNames = [...charNames, '旁白'];
    for (const name of allNames) {
      if (raw.startsWith(name)) {
        speaker = name;
        text = raw.slice(name.length).replace(/^[：:，,\s]+/, '').trim() || raw;
        break;
      }
    }
    if (!speaker) speaker = charNames[0] || '旁白';

    const type = speaker === '旁白' ? 'narration' : 'dialogue';
    const audioField = type === 'narration' ? item.narrationAudioUrl : item.dialogueAudioUrl;

    result.push({
      itemId: item.itemId,
      sortOrder: item.sortOrder,
      type,
      text,
      characterName: speaker,
      audioUrl: audioField ? resolveUrl(audioField) : null,
      durationMs: audioField ? (item.audioDurationMs || null) : null,
      voiceId: voiceMap.get(speaker)?.voiceModelId || null,
    });
  }
  return result;
}, [sortedItems, voiceMap]);
```

### 2. VoiceSidebar

**角色列表（~200px 宽）:**
- 从 `assets`（type=character）+ 固定"旁白"条目构建
- 每个角色显示：头像缩略图、角色名、配音状态（已配/未配 + 声音名称）
- 点击角色 → 弹出侧滑抽屉（Drawer）

**声音设计抽屉:**
- 复用现有 `VoiceDesignTab` 的核心逻辑
- 三种来源切换：系统预设 / 声音克隆 / 声音设计
- 声音设计模式：voice_type、emotion、speed、pitch
- 试听 + 保存按钮
- 保存后 → `reload()` → `characterVoices` 更新 → `voiceMap` 重算 → 配音区自动使用新声音

### 3. DubbingCard 双行布局

**第一行（操作行）:**
- 角色头像 + 角色名下拉（可切换说话人）
- 台词文本（可双击进入编辑模式）
- 播放/暂停按钮
- 生成/重新生成按钮

**第二行（参数行）:**
- 情绪下拉：默认(继承角色) / 中性 / 快乐 / 悲伤 / 愤怒 / 恐惧 / 惊讶 / 兴奋
- 语速滑块：0.5x ~ 2.0x
- 音调滑块：-12 ~ +12
- 时长标签：`设计 Xs / 音频 Ys`，超出时显示 ⚠ 黄色警告

### 4. Per-Clip Override 机制

```typescript
// 页面级别 state
const [localOverrides, setLocalOverrides] = useState<
  Record<string, {
    emotion?: string;
    speed?: number;
    pitch?: number;
    text?: string;       // 修改后的台词文本
    speaker?: string;    // 切换后的说话人
  }>
>({});

// TTS 生成时参数解析（优先级: per-clip > 角色默认 > 系统默认）
function resolveParams(clipKey: string, clip: AudioClipInfo, voice: CharacterVoice | undefined) {
  const override = localOverrides[clipKey] || {};
  return {
    text: override.text ?? clip.text,
    speaker: override.speaker ?? clip.characterName,
    emotion: override.emotion ?? (voice?.voiceParams as any)?.emotion ?? 'neutral',
    speed: override.speed ?? (voice?.voiceParams as any)?.speed ?? 1.0,
    pitch: override.pitch ?? (voice?.voiceParams as any)?.pitch ?? 0,
    voiceId: voice?.voiceModelId ?? null,
  };
}
```

### 5. MultiTrackTimeline

**核心原则：时间轴基于 `storyboardItems`（所有镜头），不是 `clips`（只有有台词的镜头）。**

`clips` 数组跳过了无台词镜头，但时间轴需要展示所有镜头的完整时间序列。时间轴组件接收 `storyboardItems` 作为主数据源，再用 `clips` 和 `audioTracks` 叠加音频信息。

**四条轨道：**

| 轨道 | 数据来源 | 显示内容 |
|------|---------|---------|
| 镜头标记 | `storyboardItems`（全部） | 所有镜头编号，宽度 = 该镜头时长 |
| 台词音频 | `storyboardItems` + `clips` 匹配 | 有音频 = 实色块，无台词 = 灰色占位（用 plannedDurationMs） |
| BGM | `audioTracks` (type=bgm) | BGM 音频条 + [+ 添加音乐] 按钮 |
| 音效 | `storyboardItems.sfxAudioUrl` | 已有音效显示为色块，其余空白 |

**时间轴构建逻辑（遍历所有镜头，不是 clips）：**

```typescript
// 遍历 ALL storyboardItems，不是 clips
const timelineSegments = sortedItems.map(item => {
  // 查找该镜头是否有对应的 clip（台词音频）
  const clip = clips.find(c => c.itemId === item.itemId);
  const hasAudio = clip && (clip.audioUrl || localAudio[clipKey(clip)]?.url);

  // 时长计算：音频时长 > 设计时长 > 默认 2s
  const durationMs = hasAudio
    ? (localAudio[clipKey(clip!)]?.durationMs || clip!.durationMs || item.plannedDurationMs || 2000)
    : (item.plannedDurationMs || 2000);

  return {
    itemId: item.itemId,
    sortOrder: item.sortOrder,
    durationMs,
    hasDialogue: !!clip,
    hasAudio: !!hasAudio,
    clip: clip || null,
    label: clip ? `${clip.characterName}: ${clip.text.slice(0, 15)}` : `#${item.sortOrder} (无台词)`,
  };
});
```

**无台词镜头在各轨道的表现：**
- 镜头标记轨：正常显示编号，宽度 = `plannedDurationMs`
- 台词音频轨：灰色虚线占位块，标注"无台词 Xs"
- BGM 轨：BGM 跨越所有镜头，不受影响
- 音效轨：如果有 sfxAudioUrl 则显示，否则空白

**时长计算规则：**
- 有台词音频 → 用实际音频时长
- 无台词 → 用 `plannedDurationMs`（来自脚本中的"时间: X秒"）
- 两者都没有 → 默认 2000ms

**交互：**
- 全局播放按钮：按顺序播放台词音频 + 叠加 BGM
- 播放光标（红色竖线）
- 缩放（鼠标滚轮）
- 点击台词色块 → 配音区滚动到对应卡片
- BGM 轨道的 [+ 添加音乐] → 弹出 Modal，复用现有 MusicTab 的歌词生成+音乐生成逻辑

### 6. StoryboardGenPage 同步修复

`StoryboardGenPage.tsx` L121 的 timeline label 同样存在 `actionText` 误用：
- 旧：`label: (item.actionText || '').slice(0, 20) || '旁白'`
- 新：`label: (item.dialogue || '').slice(0, 20) || '旁白'`

### 7. parseDurationToMs 增强

当前解析器（`WorkspaceApp.tsx` L1747）只匹配 `/([\d.]+)\s*秒/`，存在以下问题：
- `1分30秒` → 错误解析为 30000ms（丢失分钟部分）
- `3s` → 不匹配，返回 null
- `约3秒` → 不匹配（前缀干扰）

增强后支持多种格式：

```typescript
function parseDurationToMs(durationStr?: string): number | null {
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
}
```

数据链路：AI 脚本 `时间: 3秒` → `storyboardParser` `duration: '3秒'` → 导出 `parseDurationToMs('3秒')` → DB `planned_duration_ms: 3000` → `EpisodeContext` `plannedDurationMs: 3000` → 时间轴占位块宽度

## 不需要修改的部分

- `storyboardParser.ts`: `dialogue = fields.人声` 映射正确
- `WorkspaceApp.tsx` 导出: `dialogue: item.dialogue` 映射正确
- `image_prompt` / `video_prompt`: 已正确分开
- DB schema: 无需新增字段
- AI prompt (`scriptPrompts.ts`): `人声` 定义正确
- `minimax_audio.py`: TTS API 已支持 emotion/speed/pitch
- `apiService.ts` `minimaxTTS`: 已接受 emotion/speed/pitch 参数
- `audio_provider.py`: `generate_speech` 已接受 emotion 参数

## 影响范围

| 文件 | 改动类型 |
|------|---------|
| `AudioStagePage.tsx` | 重写：拆分为 5 个文件 |
| `VoiceSidebar.tsx` | 新建：从 VoiceDesignTab 改造 |
| `DubbingPanel.tsx` | 新建 |
| `DubbingCard.tsx` | 新建 |
| `MultiTrackTimeline.tsx` | 新建 |
| `StoryboardGenPage.tsx` | 小修：L121 label 修复 |
| `types.ts` | 可能扩展 AudioClipInfo（增加 override 字段） |

## 实现顺序建议

1. 先修复 clips builder bug（数据源正确性）
2. 创建 DubbingCard 组件（双行布局 + per-clip 控件）
3. 创建 DubbingPanel（卡片列表 + 批量操作）
4. 创建 VoiceSidebar（角色列表 + 抽屉）
5. 创建 MultiTrackTimeline（4 轨时间轴）
6. 重写 AudioStagePage 壳（统一布局编排）
7. 修复 StoryboardGenPage timeline label
8. 验证端到端流程
