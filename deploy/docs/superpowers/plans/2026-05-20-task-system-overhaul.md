# 后台任务 + 通知系统改造（L4 全档）

**Date**: 2026-05-20
**Scope**: L4（合并双通知中心 + 全局 TaskRegistry + 持久化任务列表 + ComfyUI 排队可视化 + EnhancePage 真实接入）
**Target pages**: 全部 7 个 (VideoPage / GenerationPage 分镜 / DesignPage / AudioStagePage / EnhancePage / PostProcessPage / CanvasPage)
**UI position**: U2（顶栏铃铛 + 右上 Toast）

---

## 0. 现状摘要（基线）

后端能力齐：Redis 队列 + 多 Worker + ComfyUI 4 节点池 + 满载 requeue + SSE 推送。
前端缺口：
- 双通知中心未合并（`WorkspaceApp.taskNotifications` ↔ `TaskContext.notifications`）
- 轮询绑在组件 `setInterval`，unmount 即停 → 切页前端"瞎了"
- `taskRecovery.ts` 仅覆盖 ComfyUI 分镜，10 分钟过期
- `apiTaskQueue.ts` 是死代码
- `dao_notification` 表存了但前端不读 → 刷新页看不到历史
- workflow layout 没顶栏 → 没铃铛
- `EnhancePage` 是假进度条，根本没调后端
- SSE `targetView` 写死 `'Video'`，点 Toast 跳转不准

---

## 1. 设计思路（架构层）

### 1.1 单一信任源：`TaskRegistry`

替代当前两套零散状态。一个 store + 几个明确 API：

```typescript
// new_html/services/taskRegistry.ts
export interface RegisteredTask {
    taskId: string;                  // 后端返回的 task id
    kind: 'comfyui' | 'seedance' | 'wan2' | 'kling' | 'sora2' | 'veo' | 'tts' | 'gemini-img' | 'doubao-img' | 'video-enhance' | 'matting' | 'angle-adjust' | 'human-multi-angle' | 'around-angle' | 'image-fusion' | 'auto-storyboard' | ...;
    title: string;                   // 用户可读："视频生成 - 镜头3"
    status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress?: number;               // 0-1，可选
    queuePosition?: number;          // 排队中前面 N 个，用于 M6 显示
    startedAt: number;               // ms timestamp
    completedAt?: number;
    targetPage: SourcePage;          // 'storyboard' | 'audio' | 'video' | 'design' | 'enhance' | ...
    targetEntityType?: string;       // 'storyboard_item' | 'asset' | 'video_segment' | ...
    targetEntityId?: string;
    targetItemId?: string;           // 用于回页面定位（点徽章跳转 + 高亮）
    episodeId?: string;
    projectId?: string;
    fileRole?: string;               // 'generated_image' | 'narration_audio' | ...
    error?: string;
    resultUrls?: string[];           // 完成时的产物 URL
}

export interface TaskRegistryAPI {
    register(t: Omit<RegisteredTask, 'startedAt' | 'status'>): void;
    update(taskId: string, updates: Partial<RegisteredTask>): void;
    complete(taskId: string, result: { resultUrls?: string[] }): void;
    fail(taskId: string, error: string): void;
    cancel(taskId: string): void;
    list(filter?: { status?: RegisteredTask['status']; targetPage?: SourcePage }): RegisteredTask[];
    get(taskId: string): RegisteredTask | undefined;
    onChange(listener: (tasks: RegisteredTask[]) => void): () => void;
    onComplete(taskId: string, callback: (task: RegisteredTask) => void): () => void;
    onFail(taskId: string, callback: (task: RegisteredTask) => void): () => void;
    /** 全局后台轮询（自动驱动），只对 status === 'queued'|'running' 任务做后端查询。 */
    startGlobalPoller(): void;
    stopGlobalPoller(): void;
    /** 持久化：sessionStorage 缓存（M5 升级到从后端拉取） */
    rehydrate(): Promise<void>;
}
```

### 1.2 页面接入方式（统一 hook）

```typescript
// 页面提交一个生成任务时：
const { taskId } = await videoService.submitSeedanceTask({ ... });
taskRegistry.register({
    taskId,
    kind: 'seedance',
    title: `视频生成 - ${groupName}`,
    targetPage: 'video',
    targetEntityType: 'task_group',
    targetEntityId: group.uuid,
    targetItemId: linkedStoryboardItemId,
    episodeId, projectId,
});

// 注册的同时（页面 mount 期间）拿到 result（页面在前台时立即更新 UI）：
const offComplete = taskRegistry.onComplete(taskId, (t) => {
    setMyState(...);
});
useEffect(() => offComplete, []);
```

页面 unmount 后：
- `register/onComplete` 回调被解绑（**仅页面级**）
- TaskRegistry 全局 poller **照常**轮询后端
- 任务完成 → TaskRegistry 更新 + 通过 `useSSEInvalidation` 让 React Query 缓存失效（页面再次 mount 时自动从 API 拉新结果）
- Toast/铃铛通知用户"任务完成，点击回 X 页"

### 1.3 通信路径（合并版）

```
后端 Worker (worker.py)
  └─→ task_queue.complete_task / fail_task
        └─→ Redis publish task_complete:{user_id}
              └─→ /api/tasks/stream SSE
                    └─→ globalTaskManager (前端)
                          └─→ taskRegistry.complete/fail
                                ├─→ TaskContext.notifications  ← 单一来源
                                │     ├─→ GlobalToast (右上)
                                │     └─→ Header 铃铛 (顶栏)
                                ├─→ useSSEInvalidation (React Query 失效)
                                └─→ onComplete/onFail callbacks (页面在前台时)
```

废弃路径：
- `WorkspaceApp.taskNotifications` 删除（迁移到 TaskContext）
- `apiTaskQueue.ts` 死代码删除
- 各页面里的 `setInterval` 轮询 → 全局 poller 替代

---

## 2. 阶段拆分（每段独立可 ship）

### M0 — 基础设施（不动 UI，约 3-4h）

**目标**：建好 TaskRegistry + types + tests，不接入任何页面。

**Tasks**:
1. 新建 `new_html/services/taskRegistry.ts`：实现 `TaskRegistryAPI`
2. 新建 `new_html/services/__tests__/taskRegistry.test.ts`：覆盖 register/update/complete/fail/list/onChange/onComplete/onFail/persistence (sessionStorage)
3. 新建 `new_html/types/taskTypes.ts`（或扩展 types.ts）：`RegisteredTask` + `SourcePage` 枚举完善

**验收**:
- [ ] `npx vitest run __tests__/services/taskRegistry.test.ts` 全过
- [ ] 不引入 production 行为变化（旧通知系统仍工作）

**风险**: 低（纯新增）

---

### M1 — 统一通知中心 + 顶栏铃铛（约半天）

**目标**：所有通知走 `TaskContext`；workflow layout 接顶栏；点 Toast/铃铛能跳到正确页面。

**Tasks**:
1. 改 `TaskContext`：内部用 `taskRegistry` 作为 source；保持现有 API 兼容
2. 改 `WorkspaceApp.tsx`：删除本地 `taskNotifications` state，改读 `useTaskContext()`
3. 改 `Header.tsx`：铃铛连 `useTaskContext`；导航修正：`targetPage === 'video' → /workflow/video`，`targetPage === 'storyboard' → /workflow/storyboard`，依此类推
4. 改 `WorkflowLayout.tsx`：加顶栏（沿用 Header 组件 + 项目/剧集 breadcrumb）
5. 改 `globalTaskManager.ts`：SSE 解析时正确填 `targetPage`（不再写死 `'Video'`）
6. 改 `GlobalToast.tsx`：点击跳转复用同一 `targetPage → URL` 函数
7. 删除 `apiTaskQueue.ts`（死代码）

**验收**:
- [ ] 旧 WorkspaceApp 视频生成完成 → Header 铃铛 + Toast 都收到 1 条（不重复）
- [ ] workflow 路由（任意页面）能看到顶栏铃铛
- [ ] 点视频完成通知 → 跳到 `/workflow/video`，不再跳到 episodes 落地页

**风险**: 中（双通知合并需小心去重，需要写迁移测试）

---

### M2 — VideoPage 迁移（打样，约半天）

**目标**：VideoPage 所有 `submit + setInterval polling` 路径迁到 `taskRegistry.register + onComplete callback`，组件 unmount 后任务继续在后台显示。

**Tasks**:
1. 改 `VideoPage.tsx`：
   - 删除 `pollingIntervals` ref + 各 `startPolling` 函数
   - `runTask` 提交后改为 `taskRegistry.register({...})` + `taskRegistry.onComplete(taskId, ...)`
   - `useEffect` cleanup 仅解绑 callback，不停后端轮询
   - mount 时如果 `WorkspaceSession.tasks_status` 有 `pending` 任务，重新 `register` 到 registry（自动恢复）
2. 改 `taskRegistry.startGlobalPoller`：实现 5s 轮询所有 `queued|running` 任务（调用 `getTaskStatus` 复用现有 service）
3. 改 `videoService.ts`：保留 `submitTask` / `submitSeedanceTask` 但去除 `startPolling` 逻辑（搬到 registry）

**验收**:
- [ ] 视频页提交 5 个 Seedance 任务 → 切到分镜页 → 顶栏铃铛/徽章显示 5 个 running → 等任务完成 → Toast 弹出 → 点击跳回视频页 → 看到结果
- [ ] 视频页提交任务 → 刷新页面 → `WorkspaceSession.tasks_status` 把任务恢复到 registry → 继续轮询
- [ ] 现有 `__tests__/components/VideoPage*.test.tsx` 不破

**风险**: 高（视频页是主战场，回归风险大）。需要保留 saveSession 持久化路径作为兜底。

---

### M3 — Generation / Storyboard / Design / Audio 迁移（约 1 天）

**目标**：4 个生成页全部接 `taskRegistry`。

**Tasks**:
1. `GenerationPage.tsx`（分镜画面）：
   - `generateWithComfyUIWorkflowQueued` 等所有 `*Queued` 函数：提交后 `register` 到 registry，删除 `await waitForComfyUITask` 前的 `taskRecovery.saveRunningTask`（registry 自带持久化）
   - 删除 mount 时 `getRecoverableTasks` 恢复逻辑（registry rehydrate 替代）
   - 保留批量生成串行逻辑，但每次 `register` 一个 task，不阻塞 UI
2. `DesignPage.tsx`：
   - 角色/场景/道具生成：`generateGeminiImageVariant` / `processMaterialImage` 等改为 register
   - 批量生成：循环 register，前端仅启动队列，不 await 整批
3. `AudioStagePage.tsx`：
   - `runGenerate` 内 `await minimaxTTS / generateSpeech` 改为 register（即使 TTS 通常很快也走 registry，统一体验）
   - `handleBatchGenerate` 不阻塞，依次 register
4. 废弃 `taskRecovery.ts`（registry 已替代），删除文件

**验收**:
- [ ] 分镜页选 5 镜头批量生成 → 切到视频页 → 顶栏铃铛实时更新 → 完成时 Toast → 跳回分镜页看到 5 张图
- [ ] 设计页批量生成 10 个角色 → 切到剧本页 → 任务在后台继续 → 完成后回设计页看到结果
- [ ] 配音页批量生成 → 切到分镜页 → 完成后回配音页看到音频

**风险**: 中（多页面改动，但每页独立验证）

---

### M4 — EnhancePage 真实接入 + PostProcess/Canvas 启用（约半天-1 天）

**目标**：把 EnhancePage 的假进度条改成调真实后端；让 PostProcess / Canvas 至少能启动一个简单任务（如果用户希望）。

**Tasks**:
1. 调研后端是否已有 video-enhance worker / API（应该是 cluster_main 已有 video-enhance task_type）
2. 改 `EnhancePage.tsx`：
   - 删除 `setInterval` 假进度条
   - 调 `/api/generate` 或对应增强端点 → register 到 registry → 完成后展示
3. PostProcess / Canvas：可能需求低，**询问用户是否本轮不做**（M0-M3 已经覆盖核心生成流）

**验收**:
- [ ] EnhancePage 提交增强 → registry 显示 running → 切走仍能后台跑 → 完成后 Toast

**风险**: 中（需要后端能力对齐；如果 Enhance worker 还没做，本轮可降级为"只接管 UI 通知，后端真实功能后续补"）

---

### M5 — 持久化任务列表（dao_notification 打通，约半天）

**目标**：刷新页面后能看到历史任务（"昨天的 5 个视频生成已完成"）。

**Tasks**:
1. 后端：`/api/notifications` 已存在（基于 `dao_notification`），确认接口形态
2. 改 `taskRegistry.rehydrate`：启动时调 `/api/notifications?since=24h` 拉历史任务，合并到本地 store
3. 改 `Header` 铃铛下拉：分组显示「运行中」+「最近完成」+「最近失败」+「再早→点击「查看全部」进任务中心」
4. 任务中心页：先不做（U2 选项是顶栏铃铛，不需要侧栏入口；如果要看全历史，加个 modal 即可）

**验收**:
- [ ] 提交任务 → 刷新页 → 任务仍在铃铛里显示 + 状态正确
- [ ] 历史完成任务（24h 内）刷新后仍能看到

**风险**: 低（只是读现有表）

---

### M6 — ComfyUI 排队可视化（约 2-3h）

**目标**：徽章/Toast 显示"排队中（前面 N 个）"。

**Tasks**:
1. 后端：`cluster_manager.py` 加端点 `GET /api/cluster/queue-status` 返回 `{ pending_tasks, running_tasks, queue_position_for_user }`
2. 改 `taskRegistry`：把 `queuePosition` 字段填上（从后端拉）
3. 改 `Header` 铃铛 + Toast：当 `status === 'queued'` 时显示"排队中（前面 N 个）"

**验收**:
- [ ] 同时提交 6 个 ComfyUI 任务（节点池 4 节点） → 第 5、6 个任务在徽章里显示"排队中"

**风险**: 低（纯展示）

---

### M7 — 收尾（约 2-3h）

**Tasks**:
1. lint + ReadLints 清理所有 warnings
2. `npx vitest run`：本批次相关测试全过 + 总体不引入新失败
3. `python scripts/scan_project.py .` + `python scripts/sync_check.py . --strict --levels ERROR` → 0
4. `python scripts/sync_to_deploy.py --apply` → 镜像
5. `cd new_html && npm run build` → rebuild dist + mirror to deploy/dist
6. `docs/faq.md` 顶部加完整条目（症状/根因/修复/Files/影响范围）
7. `docs/conventions.md` 新增 Anti-Patterns：
   - **页面级 setInterval 轮询是反模式**：页面 unmount 即丢，必须用全局 TaskRegistry
   - **通知系统单源原则**：所有通知（运行中 + 完成）走 TaskContext，不允许并行 state
   - **任务必须有 targetPage**：通知点击必须能跳到正确页面 + 定位到对应 entity

---

## 3. 关键设计决策

### 3.1 页面级 vs 全局 callback 解耦

页面 mount 时调用 `taskRegistry.onComplete(taskId, callback)`，cleanup 时解绑。
完成时若页面在前台 → 立即更新 UI；
完成时若页面已 unmount → callback 不调，但 registry 状态已更新 → 用户回页面时 React Query 已被 invalidate → 自动从 API 拉新数据。

### 3.2 何时用 SSE，何时用轮询

- **首选 SSE**：`/api/tasks/stream` 已存在，页面 mount 时订阅；TaskContext 在 App 根级，订阅持续。
- **轮询兜底**：SSE 断线时降级到 5s 全局轮询（registry.startGlobalPoller）。
- **不再用页面级 setInterval**：所有页面 unmount 即丢的轮询消除。

### 3.3 saveSession（VideoPage） vs TaskRegistry 关系

不替代，互补：
- `WorkspaceSession` 持久化 **业务数据**（task_groups + uploaded_images + 配置），跟剧集绑定
- `TaskRegistry` 持久化 **任务状态机**，跟用户绑定，跨剧集
- 视频页 mount 时：先 `loadSession` 拿到 task_groups + tasks_status；如果 `tasks_status` 含 pending，再 `taskRegistry.register` 注入到全局

### 3.4 失败处理 + 错误恢复

- 任务失败：`taskRegistry.fail(taskId, error)` → Toast 显示错误 + 铃铛保留
- 用户主动取消：`taskRegistry.cancel(taskId)` + 后端 `/api/tasks/{id}/cancel`（如已存在）
- 后端 worker 卡死：用户点取消即可（不依赖前端）

---

## 4. 风险点 + 回退策略

| 风险 | 影响 | 回退 |
|---|---|---|
| TaskRegistry rehydrate 与 SSE 重复推送导致状态闪烁 | 中 | 按 taskId 去重 + lastUpdated 时间戳保留较新 |
| VideoPage 迁移后回归 Seedance/Wan2 视频不能正常完成 | 高 | 保留旧 `startPolling` 路径作 feature flag，先 A/B |
| 全局 poller 过于激进（5s 拉 50 个 task）导致后端压力 | 中 | 仅拉 status === 'queued'\|'running'；批量查询 API |
| 顶栏铃铛在 workflow 各 page 之间高度不一 | 低 | WorkflowLayout 统一固定高度 |
| dao_notification 表数据量大导致首屏慢 | 中 | 限制 since=24h + 分页 |
| EnhancePage 后端 worker 还没做 | 中 | 本轮仅接 UI，调 mock API；标记 EnhancePage 为"待后端实现"|

---

## 5. 工作量估算 + Milestone schedule

| Milestone | 估时 | 增量价值 |
|---|---|---|
| M0 基础设施 | 3-4h | TaskRegistry 可单元测试通过 |
| M1 通知合并 | 4-6h | workflow 全页可见铃铛 + 通知正确跳转 |
| M2 VideoPage 迁移 | 4-6h | 视频生成切走再回不再丢状态 |
| M3 4 页面迁移 | 6-8h | 全部生成页都能后台执行 + 切走 |
| M4 Enhance 真实接入 | 4-6h | EnhancePage 不再是占位 |
| M5 持久化任务列表 | 3-4h | 刷新页可见历史 |
| M6 排队可视化 | 2-3h | 用户知道为什么慢 |
| M7 收尾（doc/build/sync） | 2-3h | 一切就绪 |
| **合计** | **28-40h（3-4 工作日）** | — |

**Milestone gate**: 每段完成后 user demo + acceptance，再开下一段。M0-M2 是高风险段（架构 + 主战场），M3-M6 是滚动加新页面（风险低）。

---

## 5.5. 任务通知 UI 设计（U2 顶栏铃铛 + per-page indicator + 详细列表面板）

> 应用 frontend-design 原则：避免泛 AI 美学；选择一个明确方向。

### 5.5.1 设计方向：「精确仪表台」（Linear / Things 3 / Vercel Dashboard 风格）

- **不**用紫色渐变白底、糖果色徽章、emoji 装饰、玩具感。
- 选 **生产工具的克制感**：深色 slate-950 基底 + 中性灰 + 4 色窄域状态用色 + 一个亮点（微脉冲 spinner）。
- **字体**：保留项目已有字体（无需引入新字体），数字段用 `tabular-nums` 避免抖动。
- **动效**：高信息密度，但每个动效都有理由——脉冲告诉"还在跑"，stagger 入场告诉"新到达"，状态过渡告诉"刚刚改变"。

### 5.5.2 状态色板（窄域、克制）

| 状态 | 主色 | 辅色（hover/border） | 用途 |
|---|---|---|---|
| running | `bg-blue-500/15 text-blue-200 border-blue-400/40` + 脉冲光环 | `border-blue-400` | 正在执行 |
| queued | `bg-amber-500/15 text-amber-200 border-amber-400/40` | `border-amber-400` | 排队中（M6 显示前 N 个） |
| completed | `bg-emerald-500/15 text-emerald-200 border-emerald-400/40` | `border-emerald-400` | 已完成 |
| failed | `bg-rose-500/15 text-rose-200 border-rose-400/40` | `border-rose-400` | 失败 |
| cancelled | `bg-slate-500/15 text-slate-300 border-slate-400/30` | — | 已取消 |

**禁止**：紫色（已留给 AI 改写按钮）、绿色非 emerald（项目内统一用 emerald）。

### 5.5.3 三个 UI 组件

#### A. **WorkflowLayout 顶栏 + 铃铛（M1）**

```
┌─────────────────────────────────────────────────────────────┐
│  ◉ MY2 / 项目 ▸ 第3集    [🔍]    设置 ▸  🔔³ ▸  liulong ▾ │
└─────────────────────────────────────────────────────────────┘
```

- 高度 48px，深色 (`bg-slate-950 border-b border-slate-800`)
- 项目/剧集 breadcrumb 在左
- 铃铛在右，**红点是 unread 数（不是 active 数）**——只有完成/失败的未读才显数；若 active 任务存在，铃铛额外显示一个**微妙的脉冲光环**（`animate-pulse` + `ring-2 ring-blue-400/30`）
- 点击铃铛 → 下拉面板（见 C）

#### B. **侧栏 per-page indicator（M1）**

`WorkflowLayout` 左侧导航的每一项加一个右侧小指示器：

```
  剧本           
  设计           
  素材           
  配音 ●₁        ← amber 圆点 + 数字（1 个 queued/running 任务）
  分镜 ●₃        ← blue 脉冲圆点 + 数字（3 个 running，1 个 queued）
  视频 ●₅        ← blue 脉冲圆点 + 数字
  增强           
  历史           
```

- 指示器规则：`queued + running` 之和 > 0 时显示
- 颜色：含 running → blue 脉冲；仅 queued → amber 不脉冲
- 数字字体 `text-[10px] tabular-nums font-medium`
- `aria-label`="3 个任务运行中"
- 完成/失败任务 **不**计入此 indicator（避免噪音）

#### C. **铃铛下拉面板（M1，详细列表）**

宽 400px，最多 600px 高，三段（虚拟滚动可后续加）：

```
┌─────────────────────────────────────────┐
│  通知                            ⓧ ✓全部│ ← 标题 + 关闭 + 全部已读
├─────────────────────────────────────────┤
│  正在运行 · 5                            │ ← section header
│  ┌─────────────────────────────────────┐│
│  │ ⌬ 视频生成 镜头3 (Seedance)         ││
│  │   ━━━━━━━━━━━━━━━━━━━━━━ 47%      ││ ← 进度条（有进度时）
│  │   2 分钟前 · 查看 ▸                 ││
│  └─────────────────────────────────────┘│
│  ┌─────────────────────────────────────┐│
│  │ ⌬ 角色生成 林墨 (Gemini)            ││
│  │   ╳ 排队中 · 前面还有 2 个         ││ ← M6 排队
│  │   30 秒前                          ││
│  └─────────────────────────────────────┘│
│  ──────────────────────────────────────│
│  最近完成 · 12                           │
│  ┌─────────────────────────────────────┐│
│  │ ✓ 视频生成 镜头1 (Seedance)         ││
│  │   3 分钟前 · 查看 ▸ · ⌧ 关闭       ││
│  └─────────────────────────────────────┘│
│  ──────────────────────────────────────│
│  失败 · 1                                │
│  ┌─────────────────────────────────────┐│
│  │ ✗ TTS 旁白5                         ││
│  │   错误: 配额超限                    ││
│  │   1 分钟前 · 重试 ▸ · ⌧            ││
│  └─────────────────────────────────────┘│
├─────────────────────────────────────────┤
│  查看全部历史 ▸                          │
└─────────────────────────────────────────┘
```

- 每项：状态色块 + kind 图标 + title + 副信息（进度/排队/错误）+ 相对时间 + 操作链（查看/重试/关闭）
- **stagger 入场**：新通知到达时 80ms 间隔淡入 + 上滑（`translate-y-1 → 0`）
- **状态过渡**：running → completed 时颜色从 blue 渐变到 emerald（300ms ease）
- **空态**：无任务时显示一个克制的图案 + "还没有任务" 文案，不要花哨插图
- 滚动条：`scrollbar-thin scrollbar-thumb-slate-700`

#### D. **Toast（保留 + 增强，M1）**

- 现有 `GlobalToast` 改进：
  - **stack** 多个 toast（最多 3 个，更早的折叠成"还有 N 条"）
  - 完成时短促 `audio.play()` (低音量) + 桌面通知（已实现）
  - 进入动效：从右上角滑入 + 淡入（200ms cubic-bezier）
  - 失败的 Toast 多停留 8s（默认 5s）
  - 点击 Toast：跳转到 targetPage + 关闭面板

### 5.5.4 字体细节（保留 + 优化）

- 标题：`font-semibold text-sm`
- 副信息：`text-xs text-slate-400`
- 数字（计数/进度/时间）：`tabular-nums` 避免抖动
- 错误信息：`text-rose-300/90` 略低对比度（不刺眼）

### 5.5.5 微互动 / 易用性

- 铃铛 hover 时旋转 8°（`transform rotate-[-8deg]`，过渡 150ms）
- Per-page indicator hover 时圆点放大 1.2x
- 任务项 hover 时整行 `bg-slate-800/40` + 出现操作链
- 任务项点击区域：整行可点（除"关闭"按钮）
- 键盘可达：Tab 序、Enter 跳转、Esc 关闭面板
- Reduce motion 时禁用脉冲动画（`@media (prefers-reduced-motion)`）

### 5.5.6 实现顺序

1. M1.1：`useTaskManager().runningTasksByPage` 计算 hook（按 sourcePage 分组）
2. M1.2：新建 `components/TaskBadge.tsx`（per-page 圆点 + 数字）
3. M1.3：新建 `components/NotificationPanel.tsx`（铃铛下拉面板）
4. M1.4：改 `WorkflowLayout.tsx`：加顶栏（高度 48px）+ 集成铃铛 + per-page indicator 注入到导航项
5. M1.5：改 `Header.tsx`（旧 WorkspaceApp 用）→ 复用 `NotificationPanel.tsx`
6. M1.6：改 `GlobalToast.tsx`：stacking + 失败延长 + 跳转修正

---

## 6. 验收 checklist（最终态）

- [ ] 任意页面提交任意生成任务 → 顶栏铃铛立即出现 running 状态
- [ ] 切到任何其他页面 → 铃铛持续显示 running + 进度
- [ ] **侧栏导航的对应页面项右侧 per-page indicator 显示数字 + 颜色**（含 running → blue 脉冲，仅 queued → amber）
- [ ] 任务完成 → 右上 Toast（stack 最多 3 个）+ 铃铛红点 + 桌面通知 + 短音效
- [ ] 点 Toast/铃铛任务 → 跳回**正确的页面 + 定位到对应实体**
- [ ] 刷新页面 → 历史任务（24h 内）仍在铃铛里 + running 任务继续显示
- [ ] 同时提交 6+ ComfyUI 任务（4 节点）→ 第 5/6 显示"排队中（前面 N 个）"
- [ ] EnhancePage 增强任务真实跑后端（不再是假进度）
- [ ] 提交任务后立即关闭浏览器再打开 → 前端能从 dao_notification 拉到任务完成状态
- [ ] 所有 vitest 通过 + sync_check 0 ERROR + build 成功 + dist 已镜像
- [ ] Reduce motion 系统设置时禁用脉冲动画（accessibility）
- [ ] 键盘 Tab 可达铃铛 + 面板项；Esc 关闭面板
