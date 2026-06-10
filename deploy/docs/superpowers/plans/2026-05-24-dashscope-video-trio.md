# DashScope 视频三模型接入计划（Kling / Vidu / HappyHorse）

**Owner**: cursor
**Created**: 2026-05-24
**Status**: Phase 1 ✅ DONE · Phase 2 ✅ DONE

---

## 一句话需求

把可灵 Kling、Vidu、HappyHorse 三家阿里云百炼旗下视频模型接入视频页，统一
走「阿里云百炼共享 API」（DashScope），admin 一份 `DASHSCOPE_API_KEY` 驱动
全家。Kling 和 Vidu 支持首尾帧，HappyHorse 仅多参考图。三家在视频页用差异
化的新卡片视觉风格（蓝 / 紫 / 橙）。

---

## 用户决策（2026-05-24 AskQuestion 表）

| 决策项 | 选择 |
|---|---|
| MVP 覆盖范围 | **full**：每家全部能力 + 分辨率/时长/水印/audio 全暴露 |
| 卡片重设计范围 | **new-only**：只给 Kling/Vidu/HappyHorse 设计新卡，老的 Seedance/Wan2 不动 |
| DashScope Key 配置策略 | **shared-new**：新建一条「阿里云百炼共享 API（DashScope）」配置项，明确标示 Wan2.6 + Kling + Vidu + HappyHorse 共用 |
| 首尾帧上传 UI | **复用现有设计**：按钮点击切换 → 首/尾两图并排 |

---

## API 调研结论

三家完全共享 DashScope endpoint：

```
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
GET  https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
Headers: Authorization: Bearer $DASHSCOPE_API_KEY
         X-DashScope-Async: enable
         Content-Type: application/json
状态机:  PENDING → RUNNING → SUCCEEDED / FAILED / CANCELED / UNKNOWN
task_id 有效期: 24h
轮询建议: 10-15s 间隔
```

| 维度 | Kling | Vidu | HappyHorse |
|---|---|---|---|
| model_name | `kling/kling-v3-video-generation`<br>`kling/kling-v3-omni-video-generation` | `vidu/viduq3-*_reference2video`<br>`vidu/viduq3-*_start-end2video` | `happyhorse-1.0-r2v` |
| 文生视频 | ✓ | — | — |
| 首帧生视频 | ✓ | — | — |
| 首尾帧生视频 | ✓ | ✓ | ✗ |
| 多参考图（1-N） | ✓ omni 1-7 | ✓ 1-7 | ✓ 1-9（`[Image N]` 引用） |
| 时长 | 3-15s | 1-16s (q3) / 1-10s (q2) | 3-15s |
| 分辨率 | std=720P / pro=1080P | 540P/720P/1080P | 720P/1080P |
| 宽高比 | 16:9 / 9:16 / 1:1 | 多档 size 可控 | 16:9 / 9:16 / 3:4 / 4:3 / 4:5 / 5:4 / 1:1 / 9:21 / 21:9 |
| audio 开关 | ✓ | ✓ (仅 q3) | ✗ |
| 水印 | ✓（自带 watermark_video_url） | ✓ | ✓ (默认开) |

---

## 架构选择（关键决策）

**不为每家新建独立路由，而是复用 `POST /api/generate` + 扩 `task_type` 枚举**。

理由（写进 recurring-pitfalls §P）：
1. `/api/generate` Pydantic `GenerateRequest` 已覆盖 `image_path / image_path_end / media_inputs / duration / resolution / ratio / watermark / seed / sub_model / entity_*`，新模型几乎不必添字段。
2. Worker 按 `task_type` 前缀派发已有 wan26 / seedance / sora2 / veo 范式可抄。
3. `_save_external_video` 已 entity-aware，自动同步到 `video_segments` 表 + 处理 entity binding。
4. 前端轮询路径 `/api/task/{task_id}` 一份代码统吃所有 provider。

**task_type 命名规范**：

| task_type | 模式 | 必填 task.data 字段 |
|---|---|---|
| `kling_t2v` | Kling 文生 | `prompt + aspect_ratio` |
| `kling_i2v` | Kling 首帧 | `prompt + image_path` |
| `kling_morph` | Kling 首尾帧 | `prompt + image_path + image_path_end` |
| `kling_refer` | Kling omni 参考生 | `prompt + media_inputs[image,...]` |
| `vidu_r2v` | Vidu 参考生 | `prompt + media_inputs[image,...]` |
| `vidu_morph` | Vidu 首尾帧 | `prompt + image_path + image_path_end` |
| `happyhorse_r2v` | HappyHorse 多图 | `prompt + media_inputs[image,...]` |

---

## Phase 1 ✅ 完成（后端 + Admin）

| 文件 | 改动 | 镜像 |
|---|---|---|
| `dashscope_video_api.py`（新建） | DashScope 视频生成共享异步客户端：aiohttp、统一 `create_task / query_task / wait_for_completion`、`kling_submit` / `vidu_reference_submit` / `vidu_startend_submit` / `happyhorse_submit` 各家 schema 适配、状态归一化、`extract_video_url(prefer_watermark)`、`get_dashscope_video_client()` 单例 | `deploy/dashscope_video_api.py` ✓ |
| `worker.py` | `VIDEO_TASK_TYPES` 扩 7 项；新增 elif → `_process_dashscope_video_task` 统一处理函数（按 task_type 前缀派发）；新增 `_file_id_to_dashscope_url` helper（file_id → Base64 data URI） | `deploy/worker.py` ✓ |
| `cluster_main.py` | `GenerateRequest.task_type` 描述扩展；任务统计 `video_types` 列表 + log_type 映射 + DB 统计 `task_type IN (...)` 均补全 7 个新 task_type + `wan26_i2v`(历史漏项) + `seedance_*`(历史漏项) | `deploy/cluster_main.py` ✓ |
| `admin_routes.py` | `PRESET_API_MODELS` 新增 3 条修真境界命名 preset：`化神 (Kling)` / `合体 (Vidu)` / `大乘 (HappyHorse)`，全部 `provider='dashscope'` → 共享 `DASHSCOPE_API_KEY` | `deploy/admin_routes.py` ✓ |
| `admin/app.js` | `guessApiCategory` 把 `seedance` 归入 `video`；`usageHints['dashscope']` 改文案为「一份 Key 驱动 Wan2.6 + Kling + Vidu + HappyHorse」；新增 `usageHints['seedance']` 提示 | `deploy/admin/app.js` ✓ |
| `docs/faq.md` | 新增 Phase 1 接入日志 + recurring-pitfalls §P 索引 | `deploy/docs/faq.md` ✓ |
| `.claude/skills/project-memory/references/recurring-pitfalls.md` | 新增 §P：multi-provider / shared-endpoint API 集成纪律 | — (源在 .claude/) |

**Phase 1 验收**：
- ✅ sync_check 干净（仅 1 项 pre-existing INFO，与本次无关）
- ✅ ReadLints: 无新增 lint 错误
- ✅ 全部新增 task_type 出现在 video_types / log_map / DB stats 三处一致
- ⏳ 真实接口调用待 Phase 2 前端打通后才能验证

---

## Phase 2 ✅ DONE（前端）

**完成时间**：2026-05-24

| 任务 | 文件 | 状态 |
|---|---|---|
| `videoService.ts` 扩 VideoModel enum + ALL_MODELS + getModelDisplayName + EXTERNAL_API_MODELS | `new_html/services/videoService.ts` | ✅ |
| `videoService.ts` `submitTask()` 加三家简化分支（0/1/2 张图场景） | 同上 | ✅ |
| **新增 `submitDashScopeVideoTask()`** + `DashScopeVideoParams` 类型 + `inferDashScopeTaskType()` | 同上 | ✅ |
| `types.ts` TaskKind 加 `'vidu' \| 'happyhorse'`（kling 已有） | `new_html/types.ts` | ✅ |
| **新建 `DashScopeCards.tsx`**（1 文件 = 3 卡片 + 共享件） | `new_html/components/video/DashScopeCards.tsx` | ✅ |
| · `KlingCard`（蓝调 sky）4 模式 toggle：T2V/I2V/Morph/Omni | 同上 | ✅ |
| · `ViduCard`（紫调 purple）2 模式 toggle：参考生 ↔ 首尾帧 | 同上 | ✅ |
| · `HappyHorseCard`（橙调 orange）1-9 多图横滑 | 同上 | ✅ |
| · 共享 shell + ImageSlot + MultiRefRow + makeDefaultDashScopeParams | 同上 | ✅ |
| `VideoPage.tsx` 新 state `dashScopeParamsByUuid` + getter/setter + runTask 分支 + kind 映射 | `new_html/components/VideoPage.tsx` | ✅ |
| · list view 简版 + card view `<DashScopeVideoCard>` 完整渲染 | 同上 | ✅ |
| · **图片选择器 modal**：从 uploadedImages 选图，写 file_id → worker Base64 | 同上 | ✅ |
| · saveSession / loadSession 持久化 `dashscope_params` | 同上 | ✅ |
| `NotificationPanel.tsx` KIND_ICON + KIND_LABEL 加 vidu/happyhorse | `new_html/components/NotificationPanel.tsx` | ✅ |
| `notificationMapping.ts` 推断正则加 vidu/happyhorse | `new_html/services/notificationMapping.ts` | ✅ |
| `modelNames.ts` videoModelNames 加 kling/vidu/happyhorse | `new_html/utils/modelNames.ts` | ✅ |
| `__tests__/services/notificationMapping.test.ts` 4 个新测试 PASS（24/24 总通过） | `new_html/__tests__/services/notificationMapping.test.ts` | ✅ |
| `npm run build` exit 0 + dist 镜像 deploy | `new_html/dist` → `deploy/new_html/dist` | ✅ |
| 修真境界命名修正：化神冲突 → 合体(Kling)/大乘(Vidu)/炼虚(HappyHorse) | admin_routes.py + 全文 | ✅ |
| 端到端集成测试：admin 填 Key → 视频页选模型 → 提交 → 任务面板看到进度 → 完成入库 | — | 🔜 待用户实测 |

**Phase 2 实际工作量**：1 个新 .tsx 文件（~720 行 DashScopeCards.tsx）+ 8 个文件改动 + 1 个测试文件扩展。

**Phase 2 关键设计决策**：

1. **1 文件 3 卡片**：避免 3 个独立 .tsx 文件 copy-drift；共享 shell 把"主题色 + 标题"做成 theme prop，差异只在参数表单。
2. **复用 Seedance media 模型**：`DashScopeVideoParams.media_inputs: SeedanceMediaInput[]` 借用现有 type；role 字段表达 first_frame / last_frame / reference_image 语义。
3. **first/last 抽离**：`submitDashScopeVideoTask` 把 `role=first_frame/last_frame` 的图单独抽出走 `image_path / image_path_end`，剩余 `reference_image` 走 `media_inputs[]`，与 worker `_process_dashscope_video_task` 约定对齐。
4. **image picker 极简**：modal 列 `uploadedImages` 缩略，点选写 `file_id`（不是 url），worker `_file_id_to_dashscope_url()` 转 Base64。避开"为支持多图必须先 OSS 上传"。
5. **list view 简化**：DashScope 三家在 list 模式只显示 sub_model 徽章 + 图数 + 单行 prompt（双向绑定 params.prompt），详情入口是切到 card view。

---

---

## 风险 & 已知坑

1. **DashScope Base64 大小限制**：Kling/Vidu 文档没明确说支持 Base64，HappyHorse 文档明确说支持。Wan2.6 实测可用——但若 Kling/Vidu 拒收，需要先把图片传到对象存储再传 URL（Phase 2 末测试时验证）。
2. **Vidu q2-pro 支持参考视频**：当前 `vidu_reference_submit` 已预留 `reference_video_urls` 参数，但 Phase 2 前端暂不暴露视频参考槽（仅参考图），等用户后续要求再做。
3. **Kling omni `multi_shot/multi_prompt/shot_type/element_list`** 高级能力：Phase 2 仅暴露 multi_shot=false 的基础模式，不接入"智能分镜 + 主体 ID"。
4. **Vidu 首尾帧分辨率比 0.8-1.25 要求**：UI 端不做硬校验，依赖后端返回的 `FAILED + message` 提示给用户。
5. **Watermark 默认值**：Wan2/Seedance 默认 false，HappyHorse 文档默认 true——`_process_dashscope_video_task` 统一 `data.get('watermark', False)`，HappyHorse 走默认 false（与项目其他模型对齐）。

---

## 决策记录

- **不新建独立路由**：复用 `/api/generate` + `task_type` 派发，与 wan26/seedance 一致（写入 recurring-pitfalls §P）
- **不新建独立 env**：所有 DashScope 视频共享 `DASHSCOPE_API_KEY`（与 wan2.6 同 env）
- **不新建独立 client class**：单 `DashScopeVideoClient` 提供 `kling_submit / vidu_reference_submit / vidu_startend_submit / happyhorse_submit` 各家方法
- **不为每家写独立 worker 函数**：统一 `_process_dashscope_video_task` 按 `task_type` 前缀派发
- **依然保留 Wan2.6 老 client**（`wan2_dashscope_api.py` + `_process_wan26_task`）：Wan2.6 已稳定运行，不在本次 scope 内重构（避免回归）
