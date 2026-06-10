# MY2 UI 全面重构设计规格

> **状态**: 已确认  
> **日期**: 2026-03-22  
> **范围**: 前端页面重构 + 后端数据层扩展 + 无限画布 + 音频预演

---

## 1. 目标

将 MY2 视频创作平台从"单页面多视图"架构重构为"分集驱动的多页面"架构，引入音频预演解决时序依赖问题，新增无限画布实现自由创作模式，所有功能通过 TDD 驱动开发。

## 2. 核心设计决策

### 2.1 双模式创作

每个项目包含多集内容，每集同时提供两种创作入口：

- **流程化制作**（8步工作流）：剧本分镜 → 资产设计 → 素材绑定 → 音频预演 → 画面分镜 → 生成视频 → 视频美化 → 历史记录
- **自由创作**（无限画布）：基于 @xyflow/react 的节点化创作

两种模式共享同一集的数据（资产、分镜、生成结果），通过 `EpisodeProvider` Context 统一管理。

### 2.2 音频优先时序

传统流程中配音在最后，导致视频时长靠猜测。新流程将音频预演前置到画面分镜之前：

```
分镜对白文本 → TTS 生成配音 → 音频时长确定
                                ↓
                画面分镜/视频生成使用此时长
```

音频预演产出的 `audio_duration_ms` 作为后续所有视觉生成步骤的时长参考。

### 2.3 路由四层嵌套

```
/projects                                    → ProjectHub
/projects/:projectId                         → EpisodeHub（分集管理）
/projects/:projectId/ep/:episodeId/workflow/* → 流程化8步
/projects/:projectId/ep/:episodeId/canvas    → 无限画布
```

Context 层级：`TaskProvider > ProjectProvider > EpisodeProvider > 页面组件`

### 2.4 数据独立表

从 `projects.settings` JSONB 拆分为独立表（assets, episode_scripts, storyboard_items, video_segments, timeline_tracks, audio_tracks），提升查询性能、并发安全和数据完整性。

### 2.5 音频服务抽象

```
AudioProvider (接口)
  ├── GeminiAudioProvider (当前实现)
  ├── MinimaxAudioProvider (未来)
  └── DoubaoAudioProvider (未来)
```

## 3. 新增页面

### 3.1 EpisodeHub（分集管理）

卡片式分集列表，每集双入口（流程化 / 自由创作），支持 CRUD 和排序。

### 3.2 DesignPage（资产设计）

三 Tab（人物/场景/道具），左侧生成面板 + 右侧资产库。资产分项目级（所有集共享）和集级（本集特有）。

### 3.3 AudioStage（音频预演）

左栏分镜列表 + 中间音频编辑区（对白/旁白/音效/BGM）+ 底部时间轴。核心产出：每个分镜的 `audio_duration_ms`。

复用 SunStudio SonicStudio 的声音人设、情感选择、PCM 播放逻辑。

### 3.4 VideoWorkspace（生成视频）

三栏布局（资产库/片段编辑/预览）+ 底部多轨时间轴。时间轴显示音频轨（可编辑）+ 视频轨（已生成/待生成），音频时长作为视频生成的参考线。

### 3.5 EnhancePage（视频美化）

视频预览 + 美化选项（放大/补帧/口型同步）+ 多轨时间轴。后期精修阶段。

### 3.6 CanvasPage（无限画布）

@xyflow/react 底层 + SunStudio 视觉风格。6 种节点类型，左侧 Agent 栏（节点拖拽 + 工作流模板 + AI 编排），右侧 AI 助手面板。

## 4. 数据库设计

### 新增 7 张表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| assets | 人物/场景/道具资产 | project_id, episode_id(NULL=公共), asset_type, name, thumbnail_url |
| episode_scripts | 每集剧本文本 | episode_id(UNIQUE), original_content, adapted_script |
| storyboard_items | 分镜内容 | episode_id, sort_order, dialogue, image_prompt, dialogue_audio_url, audio_duration_ms |
| video_segments | 视频片段 | episode_id, storyboard_item_id, generation_mode, model, video_url, duration_ms |
| timeline_tracks | 时间轴轨道 | episode_id, track_type, items(JSONB) |
| audio_tracks | BGM和跨分镜音频 | episode_id, track_type, start_item_id, end_item_id, audio_url |
| canvas_boards(扩展) | 增加 episode_id | episode_id FK |

### 表关系

```
projects
  ├── assets (project_id, episode_id=NULL 为公共)
  └── episodes
        ├── assets (episode_id 不为NULL 为本集特有)
        ├── episode_scripts
        ├── storyboard_items
        │     └── video_segments
        ├── audio_tracks
        ├── timeline_tracks
        └── canvas_boards → canvas_nodes → canvas_connections
```

## 5. 后端 API

7 组新 API：

- `/api/projects/:pid/assets` — 资产 CRUD
- `/api/episodes/:eid/storyboard-items` — 分镜 CRUD + 排序
- `/api/episodes/:eid/video-segments` — 视频片段 CRUD
- `/api/episodes/:eid/timeline-tracks` — 时间轴 CRUD
- `/api/episodes/:eid/script` — 剧本读写
- `/api/episodes/:eid/audio-tracks` — 音频轨 CRUD
- `/api/audio/generate-speech|sfx|music` — AI 音频生成

## 6. 前端架构

### 文件组织

```
new_html/
├── layouts/WorkflowLayout.tsx        ← 流程化 Tab 容器
├── contexts/EpisodeContext.tsx        ← 集级数据管理
├── pages/                            ← 9 个独立页面
├── canvas/                           ← 画布节点和面板
├── components/TimelineEditor.tsx     ← 共用多轨时间轴
├── components/AssetLibraryPanel.tsx  ← 共用资产库面板
├── services/audioProvider.ts         ← 音频服务抽象
└── services/geminiAudioProvider.ts   ← Gemini 实现
```

### 从 WorkspaceApp 拆分

将 2500+ 行的 `WorkspaceApp.tsx` 拆分为 4 个独立页面（ScriptPage, MaterialsPage, GenerationPage, HistoryPage），通过 `useEpisode()` hook 获取数据。

## 7. 测试策略

- **后端**: pytest + pytest-asyncio + httpx，真实测试数据库 + 事务回滚
- **前端**: Vitest + @testing-library/react + jsdom
- **预估**: 后端 ~40 测试 + 前端 ~60 测试 = ~100 测试
- **TDD 铁律**: 没有失败测试就没有生产代码

## 8. 数据迁移

Python 脚本从 `projects.settings` JSONB 迁移到独立表，只读迁移（保留原数据），幂等可重复执行。

## 9. 技术栈

- 前端: React 19, Vite, TypeScript, React Router 7, @xyflow/react, Tailwind CSS, lucide-react
- 后端: FastAPI, asyncpg, Redis
- 测试: Vitest, @testing-library/react, pytest, pytest-asyncio, httpx
- AI: Gemini API (音频/文本/图片), ComfyUI (视频/图片生成)
