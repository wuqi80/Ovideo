# MY2 (Storyboard Copilot) — 系统架构

> 最后更新：2026-04-15

---

## 1. 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| Frontend | React 18 + TypeScript + Vite | SPA，路由 react-router-dom v6 |
| 状态管理 | TanStack React Query v5 | staleTime=30s, gcTime=5min |
| 实时推送 | SSE + Redis Pub/Sub | 任务完成 → 缓存自动失效 |
| Backend | FastAPI (Python 3.9+) | `cluster_main.py` 为入口，含多 Router |
| 数据库 | PostgreSQL | asyncpg 连接池，61 张表 |
| 缓存/队列 | Redis | 任务队列、SSE 分发、Pub/Sub |
| GPU Worker | ComfyUI | 分布式 worker 架构，WebSocket 通信 |
| 认证 | JWT | `jwt_auth.py` |
| 文件存储 | 本地磁盘 + `/storage/` HTTP 路由 | WebP 无损转换 |

---

## 2. 目录结构

### 后端 (项目根目录)

| 文件/目录 | 行数 | 职责 |
|-----------|------|------|
| `cluster_main.py` | ~5700 | FastAPI 主入口，lifespan、Redis/Worker 初始化、图片/视频/音频生成端点 |
| `api_routes.py` | ~2500 | 用户管理、项目 CRUD、版本管理、分镜/资产/视频片段 API |
| `agent_routes.py` | — | Agent 管理 API |
| `admin_routes.py` | — | 管理后台 API |
| `routers/` | — | MVC 增量拆分路由目录 |
| `task_queue.py` | ~675 | Redis 分布式任务队列，支持优先级/取消/重试 |
| `task_service.py` | — | 任务服务层 |
| `worker.py` | — | ComfyUI Worker：取任务 → 上传图片 → 提交工作流 → WebSocket 监听 → 保存结果 |
| `file_service.py` | — | `save_generated_file_to_db()` 统一保存 helper |
| `file_optimization.py` | — | 文件去重、优化服务 |
| `config.py` | ~240 | ComfyUI/系统/工作流配置 |
| `cluster_config.py` | — | Redis/集群/队列配置常量 |
| `cluster_manager.py` | — | ComfyUI 集群节点管理 |
| `comfyui_main.py` | ~1200 | ComfyUI 集成：工作流模板、节点操作 |
| `jwt_auth.py` | — | JWT 令牌生成/验证 |
| `db_manager.py` | — | asyncpg 连接池初始化 |
| `audio_provider.py` | — | 音频服务抽象层 |
| `minimax_audio.py` | — | MiniMax TTS/音乐客户端 |

### DAO 层 (项目根目录 `dao_*.py`)

| DAO 文件 | 管理表 | 关键说明 |
|----------|--------|---------|
| `dao_user.py` | users | 用户注册/登录/权限 |
| `dao_content.py` | files, projects, versions, text_contents, workspace_sessions, prompt_templates | **推荐的** FileDAO（支持 entity 字段） |
| `dao_file.py` | files | 早期 FileDAO（**不支持** entity 字段，逐步废弃） |
| `dao_entity_file.py` | files | Entity Files 查询/选定/删除 |
| `dao_task.py` | tasks, activity_logs | 任务持久化 |
| `dao_task_history.py` | task_history | 任务历史 |
| `dao_storyboard.py` | storyboard_items | 分镜条 CRUD |
| `dao_asset.py` | assets | 角色/场景/道具资产 |
| `dao_episode.py` | episodes | 分集管理 |
| `dao_episode_script.py` | episode_scripts | 分集剧本 |
| `dao_video_segment.py` | video_segments | 视频片段 |
| `dao_canvas.py` | canvas_boards, canvas_nodes, canvas_connections | 无限画布 |
| `dao_timeline.py` | timelines | 时间线 |
| `dao_audio_track.py` | audio_tracks | 音轨 |
| `dao_character_voice.py` | character_voices | 角色语音配置 |
| `dao_workflow_template.py` | workflow_templates | ComfyUI 工作流模板 |
| `dao_notification.py` | notifications | 通知 |
| `dao_api_config.py` | api_configs | API 密钥配置（加密存储） |
| `dao_system_settings.py` | system_configs | 系统设置 |
| `dao_agent.py` | agents | Agent 配置 |

### 前端 (`new_html/`)

| 路径 | 内容 |
|------|------|
| `App.tsx` | 路由定义、QueryClient 配置、Provider 嵌套 |
| `types.ts` | 全局类型定义（GeneratedImage, StoryboardItem, ProjectFile 等） |
| `layouts/WorkflowLayout.tsx` | 工作流布局容器 |

**Pages** (`new_html/pages/`)：

| 页面 | 路由路径 | 职责 |
|------|---------|------|
| `ScriptPage` | `/workflow/script` | 剧本编辑 |
| `MaterialsPage` | `/workflow/materials` | 素材 |
| `DesignPage` | `/workflow/design` | 角色/场景资产设计、AI 生图 |
| `StoryboardGenPage` | `/workflow/storyboard` | 分镜画面生成（核心页面） |
| `AudioStagePage` | `/workflow/audio` | 配音/音效/音乐 |
| `GenerationPage` | `/workflow/generation` | 视频生成 |
| `VideoGenPage` | `/workflow/video` | 视频合成 |
| `EnhancePage` | `/workflow/enhance` | 视频增强/后期 |
| `HistoryPage` | `/workflow/history` | 历史记录 |
| `EpisodeHubPage` | `/ep/:episodeId` | 分集入口（选择模式） |
| `CanvasPage` | `/ep/:episodeId/canvas` | 无限画布自由创作 |

**Services** (`new_html/services/`)：

| 文件 | 职责 |
|------|------|
| `apiService.ts` | 通用 API 调用（分镜/资产/TTS/项目/用户 CRUD） |
| `geminiService.ts` | Gemini 文本生成 + ComfyUI 工作流队列封装 |
| `geminiImageService.ts` | Gemini 图片生成代理 |
| `doubaoService.ts` | 豆包图片生成 |
| `deepseekService.ts` | DeepSeek 文本/剧本生成 |
| `entityFileService.ts` | Entity Files CRUD（查询/选定/删除/上传） |
| `globalTaskManager.ts` | SSE 连接管理 + 任务状态轮询 |
| `videoService.ts` | 视频合成/导出 |
| `imageLoaderService.ts` | 图片懒加载/缓存 |
| `comfyuiTaskQueue.ts` | ComfyUI 任务前端队列管理 |
| `apiTaskQueue.ts` | API 任务前端队列管理 |
| `aiModelService.ts` | AI 模型切换/配置 |
| `geminiProxyTextService.ts` | Gemini 文本代理 |
| `geminiProxyService.ts` | Gemini 通用代理 |
| `aiService.ts` | AI 服务抽象层 |
| `taskRecovery.ts` | 任务断线恢复 |

**Hooks** (`new_html/hooks/`)：

| Hook | queryKey | 职责 |
|------|----------|------|
| `useEntityFilesQuery` | `['entityFiles', entityType, entityId, fileRole]` | 查询实体关联文件 |
| `useEpisodeData` | `['storyboardItems']`, `['assets']`, `['videoSegments']`, `['script']` | 分集数据 CRUD hooks |
| `useFilesMutation` | — | 文件选定/删除/上传 mutations |
| `useSSEInvalidation` | — | SSE → React Query 缓存自动失效 |
| `useEntityFiles` | — | 早期 entity files hook（逐步废弃） |

**Contexts** (`new_html/contexts/`)：

| Context | 职责 |
|---------|------|
| `ProjectContext` | 当前项目 ID/名称 |
| `EpisodeContext` | 当前分集 ID/数据 |
| `TaskContext` | 任务状态管理、SSE 连接 |

---

## 3. 路由结构

```
/projects                                             → ProjectHub（项目列表）
/projects/:projectId                                  → ProjectWorkspace（分集列表）
/projects/:projectId/ep/:episodeId                    → EpisodeHubPage（模式选择）
/projects/:projectId/ep/:episodeId/workflow/script     → 剧本编辑
/projects/:projectId/ep/:episodeId/workflow/materials  → 素材
/projects/:projectId/ep/:episodeId/workflow/design     → 资产设计
/projects/:projectId/ep/:episodeId/workflow/storyboard → 分镜生成
/projects/:projectId/ep/:episodeId/workflow/audio      → 音频预演
/projects/:projectId/ep/:episodeId/workflow/generation → 视频生成
/projects/:projectId/ep/:episodeId/workflow/enhance    → 视频增强
/projects/:projectId/ep/:episodeId/workflow/history    → 历史记录
/projects/:projectId/ep/:episodeId/canvas              → 无限画布
```

---

## 4. 数据库核心表

| 表名 | 关键字段 | DAO | 说明 |
|------|----------|-----|------|
| `users` | user_id, username, password_hash, permissions | `dao_user.py` | 用户 + 权限 |
| `projects` | project_id, user_id, settings | `dao_content.py` | 项目/工作区 |
| `episodes` | episode_id, project_id, episode_number | `dao_episode.py` | 分集 |
| `versions` | version_id, project_id, is_current | `dao_content.py` | 版本管理 |
| `files` | file_id, entity_type, entity_id, file_role, is_selected | `dao_content.py`, `dao_entity_file.py` | **统一文件存储** |
| `storyboard_items` | item_id, episode_id, sort_order, image_prompt, video_prompt | `dao_storyboard.py` | 分镜条 |
| `assets` | asset_id, project_id, asset_type(character/scene/prop), reference_images | `dao_asset.py` | 角色/场景/道具 |
| `episode_scripts` | script_id, episode_id, content | `dao_episode_script.py` | 分集剧本 |
| `video_segments` | segment_id, episode_id | `dao_video_segment.py` | 视频片段 |
| `tasks` | task_id, task_type, status, task_data, result_data | `dao_task.py` | 任务持久化 |
| `task_files` | task_id, file_id, file_role(input/output) | — | 任务-文件关联 |
| `text_contents` | content_id, content_type(script/prompt/dialogue) | `dao_content.py` | AI 生成文本 |
| `canvas_boards` | board_id | `dao_canvas.py` | 无限画布 |
| `timelines` | timeline_id | `dao_timeline.py` | 时间线 |
| `audio_tracks` | track_id | `dao_audio_track.py` | 音轨 |
| `character_voices` | voice_id, character_name | `dao_character_voice.py` | 角色语音配置 |
| `api_configs` | provider, api_key_encrypted | `dao_api_config.py` | API 密钥（AES 加密） |
| `activity_logs` | action, resource_type, resource_id | `dao_task.py` | 用户操作日志 |
| `system_configs` | config_key, config_value | `dao_system_settings.py` | 系统配置 |
| `workflow_templates` | template_id | `dao_workflow_template.py` | ComfyUI 工作流模板 |

---

## 5. 外部集成

| 服务 | 用途 | 后端入口 | 前端 Service |
|------|------|---------|-------------|
| **ComfyUI** | GPU 图像/视频生成（分布式 worker） | `cluster_main.py`, `worker.py`, `comfyui_main.py` | `geminiService.ts`, `comfyuiTaskQueue.ts` |
| **Gemini API** | 图片生成、文本生成、语音合成 | `cluster_main.py` (`/api/gemini/*`) | `geminiImageService.ts`, `geminiProxyTextService.ts` |
| **豆包 (Doubao)** | 图片生成 (ByteDance) | `cluster_main.py` (`/api/materials/doubao`) | `doubaoService.ts` |
| **DeepSeek** | 文本/剧本 LLM 生成 | `cluster_main.py` | `deepseekService.ts` |
| **MiniMax** | TTS 配音、音乐生成 | `minimax_audio.py`, `cluster_main.py` (`/api/minimax/*`) | `apiService.ts` |
| **Redis** | 任务队列 + SSE Pub/Sub | `task_queue.py`, `cluster_main.py` | `globalTaskManager.ts` |
| **PostgreSQL** | 主数据库 | `db_manager.py` + 全部 `dao_*.py` | — |

---

## 6. 核心数据流

### 6.1 图片生成（ComfyUI Worker 路径）

```
用户操作 → Service.generateWithComfyUIWorkflow(params, entity字段)
  → POST /api/generate/comfyui-workflow (body 含 entity_type, entity_id, file_role)
  → task_queue.enqueue() → Redis 队列
  → Worker.process_task() → 上传图片到 ComfyUI → 提交工作流 → WebSocket 等待完成
  → Worker._save_result_file() → 下载结果 → WebP 转换 → 磁盘保存
  → FileDAO.create_file(entity_type, entity_id, file_role) → files 表
  → task_queue.complete_task() → Redis Pub/Sub "task_complete:{username}"
  → SSE → 前端 globalTaskManager → useSSEInvalidation
  → queryClient.invalidateQueries(['entityFiles', entityType, entityId])
  → 页面自动刷新
```

### 6.2 图片生成（直连 API 路径）

```
用户操作 → Service.generateGeminiImage / generateDoubaoImages(params, entity字段)
  → POST /api/gemini/image 或 /api/materials/doubao
  → 后端调用 AI API → save_generated_file_to_db() → files 表
  → 直接返回 { images: [dataURL], files: [{file_id, file_url}] }
  → 前端使用 GeneratedFileResult[] 更新 UI
```

### 6.3 SSE 缓存失效

```
后端 task_queue.complete_task()
  → redis.publish("task_complete:{username}", {
      task_id, task_type, entity_type, entity_id, file_role, episode_id
    })
  → SSE stream → globalTaskManager.handleSSEMessage()
  → useSSEInvalidation 监听 TaskNotification
  → invalidateQueries(['entityFiles', entityType, entityId])
  → invalidateQueries(['storyboardItems', episodeId])
  → invalidateQueries(['videoSegments', episodeId])
```

### 6.4 文件统一保存

```python
# file_service.py — 所有生成内容的唯一入口
save_generated_file_to_db(
    content, file_type, user_id, source,
    entity_type, entity_id, file_role,      # entity 关联
    original_ext, is_selected, episode_id
) → { file_id, file_url, file_path }
```

---

## 7. Provider 嵌套顺序

```tsx
QueryClientProvider → SSEInvalidationProvider → BrowserRouter → TaskProvider
  → Routes → WorkflowLayout → 具体 Page
```

---

## 8. API 端点分类

### 图片/视频生成（`cluster_main.py`）

| 端点 | task_type | 说明 |
|------|-----------|------|
| `POST /api/generate/comfyui-workflow` | qwen/kontext/qwenN/... | ComfyUI 通用工作流 |
| `POST /api/generate` | i2v/morph/upscale/voice/wan26_i2v | 通用生成 |
| `POST /api/generate/image` | i2i_fj | 图生图 |
| `POST /api/generate/angle-adjust` | i2i_fj | 角度调整 |
| `POST /api/generate/human-multi-angle` | i2i_human | 人物多角度 |
| `POST /api/generate/around-angle` | i2i_around | 环绕角度 |
| `POST /api/generate/matting` | matting_subject/split | 抠图 |
| `POST /api/generate/image-fusion` | image_fusion/transfer/pose | 图片融合 |
| `POST /api/generate/panorama-360` | panorama_360 | 全景图 |
| `POST /api/generate/auto-storyboard` | auto_storyboard | 自动分镜 |
| `POST /api/generate/multi-grid-storyboard` | — | 多格分镜（直连 Gemini） |
| `POST /api/gemini/image` | — | Gemini 图片生成（直连） |
| `POST /api/materials/doubao` | — | 豆包图片生成（直连） |
| `POST /api/materials/process` | upscale_hd/remove_watermark/three_view | 素材后处理 |

### 音频生成（`cluster_main.py`）

| 端点 | 说明 |
|------|------|
| `POST /api/minimax/tts` | MiniMax TTS 配音 |
| `POST /api/minimax/music` | MiniMax 音乐生成 |
| `POST /api/audio/generate-speech` | Gemini 语音合成 |
| `POST /api/audio/generate-sfx` | 音效生成 |
| `POST /api/audio/generate-music` | 音乐生成 |

### 数据 CRUD（`api_routes.py`）

| 端点 | 说明 |
|------|------|
| `POST /api/register`, `POST /api/login` | 用户注册/登录 |
| `/api/projects/*` | 项目 CRUD |
| `/api/episodes/*` | 分集 CRUD |
| `/api/episodes/{id}/storyboard-items` | 分镜条 CRUD |
| `/api/projects/{id}/assets` | 资产 CRUD |
| `/api/episodes/{id}/script` | 剧本 CRUD |
| `/api/episodes/{id}/video-segments` | 视频片段 CRUD |
| `/api/entity-files` | Entity Files 查询/选定/删除/上传 |
| `/api/tasks/*` | 任务查询/取消 |
| `/api/thumbnail` | 缩略图代理 |

---

## 9. 部署结构

| 目录 | 说明 |
|------|------|
| `deploy/` | 部署镜像（后端 + 前端 + SQL 完整副本） |
| `new_html1/`, `new_html2/` | 历史前端版本（不活跃，仅参考） |
| `sql/` → `deploy/sql/` | 数据库 schema + migration 脚本 |
| `temp/` | 实验代码（ComfyUI 自定义节点） |
| `admin/` | 管理后台脚本 |
| `tests/` | 测试文件 |

---

## 10. 关键设计约束

| 约束 | 说明 |
|------|------|
| **禁止 data URL 入库** | 所有文件必须先上传 → `/storage/...` 路径 → 再存数据库 |
| **GeneratedImage.id 必须用 fileId** | `id: r.fileId \|\| uuidv4()`，否则删除逻辑 ID 不匹配 |
| **存储路径用 fileUrl 优先** | `result.fileUrl \|\| result.url`（fileUrl 为持久化路径） |
| **assets 更新前刷新数据** | `getAssets()` 获取最新 → 再 `updateAsset()`，避免闭包覆盖 |
| **DubbingPanel 占位文本** | 添加台词时使用 `'（请输入台词）'`，空文本导致死循环 |
| **两个 FileDAO 的区别** | `dao_content.py` 的 FileDAO 支持 entity 字段（推荐），`dao_file.py` 的不支持（废弃中） |
| **SSE 降级限制** | 轮询降级不携带 entity 字段，仅 SSE 路径支持缓存自动失效 |
| **WorkspaceApp 仅分集模式** | `episodeId` 为必传 prop，只加载/保存当前分集数据。已移除 legacy 项目模式（`loadProjectsFromBackend`、`saveProject` 等） |
