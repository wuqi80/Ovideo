# FAQ — Known Issues & Solutions

AI 调试时优先搜索此文件。按时间倒序排列。

---

## 2026-05-30 · GPU 未开 / 无 ComfyUI agent 时 `tasks_task_id_key` 唯一约束冲突死循环刷屏

**症状**

后台（`AGENT_ONLY_MODE=true`，lite Worker 模式）启动后、即使没新发任务也持续刷：

```
task_queue - ERROR - ⚠️ 保存任务到数据库失败: duplicate key value violates unique constraint "tasks_task_id_key"
DETAIL:  Key (task_id)=(a3fedf69-...) already exists.
worker - INFO - 🪶 lite Worker worker-lite-2 跳过非外部 API 任务 a3fedf69-... (type=qwen_3)，丢回队列由 ComfyUI agent 接管
task_queue - INFO - 任务 a3fedf69-... 已加入队列 (优先级: 2)
... 每秒循环 ...
```

**根因（lite Worker 模式的链式回归）**

1. Redis 队列里残留一个 ComfyUI 类型任务（如 `qwen_3`）；GPU 关闭 ⇒ 没有 ComfyUI agent 来消费。
2. lite Worker `dequeue` 取出 → `_process_task` 的 lite 守卫判定非外部 API 任务 → 调 `task_queue.enqueue(task)` 丢回队列（`worker.py:255`）。
3. `enqueue` 调 `TaskDAO.create_task`，原本是**普通 `INSERT`**（`dao_task.py`）。首次入队时该行已写入 ⇒ 再次 INSERT 撞 `tasks_task_id_key` 唯一约束 ⇒ `UniqueViolationError`。
4. 错误被 catch 但 Redis 重新入队仍成功 ⇒ 任务弹回队列 ⇒ 另一个 lite Worker 再取 ⇒ **无限刷错误**。
   - 注：`dequeue` 只改 Redis 副本状态为 processing，**不写 DB**，所以 DB 行一直是 `pending`，重复 INSERT 纯属冗余。
   - 同一个非幂等 INSERT 在 `worker.py:263`（任务真正开始处理时）也会撞，只是被 try/except 吞掉（连带 `update_task_status('processing')` 被跳过）。

**修复**

`TaskDAO.create_task` 改为幂等 UPSERT：`INSERT ... ON CONFLICT (task_id) DO UPDATE SET task_id = EXCLUDED.task_id RETURNING *`。空更新不覆盖已有行数据，冲突时 `RETURNING *` 仍返回现有行（保持所有调用方语义）。重复入队 / 重复处理记录不再抛错。文件：`dao_task.py`（+ `deploy/` 镜像）。

**残留行为（非 bug）**：修复后错误消失，但「无 agent 的 ComfyUI 任务」仍会在队列里等待，lite Worker 会以 ~3s 节流持续「出队→丢回」。**开 GPU / 启动 ComfyUI agent 后该任务即被取走**；或手动清掉 Redis 队列里的残留 `qwen_3` 任务即可停止 INFO 级 churn。

---

## 2026-05-30 · 三项 UI/UX 修复 + 素材库文件夹归类

**症状 1 — 任务通知铃铛弹窗被页面盖住**：右上角铃铛的任务列表在多数页面被 main / overlay 等覆盖，看不全。
- 根因：`NotificationPanel.tsx` 下拉用 `absolute … z-[60]` 渲染在工具栏 DOM 内，受父级 stacking context / overflow 裁剪。
- 修复：用 `ReactDOM.createPortal` 把下拉挂到 `document.body`，改 `position: fixed` + `z-[9000]`，按 trigger 的 `getBoundingClientRect` 计算 `top/right`，并监听 `scroll`(capture)/`resize` 重新定位。

**症状 2 — 分镜页「图+音联合时间轴」高度固定、收起状态刷新即丢**：时间轴无法拉高充分显示。
- 修复：`StoryboardGenPage.tsx` 用 `usePersistedPageState`（page=`StoryboardGenPage:timelinePanel`, episodeId=`global`）持久化 `{collapsed, heightPx}`；底部新增拖拽手柄（鼠标拖动改 `heightPx`，clamp 到 `[140, 70vh]`），展开区 `overflow-y-auto`。

**症状 3 — 素材库无法按人物/场景/道具归类**：素材库原本只有 `item_type`（图片/视频/音频）维度，没有用户自定义分类。
- 修复：新增 `media_library_folders` 嵌套表 + `media_library_items.folder_id` 列（`ON DELETE SET NULL`）+ `dao_media_library_folder.py`（含 `would_create_cycle` 防环）+ 文件夹 CRUD 路由 + `MediaLibraryPage` 文件夹树侧栏 / 上传目标下拉 / 卡片拖拽归类。
- 关键文件：`db_migration_media_library_folders.sql`、`dao_media_library_folder.py`、`media_library_routes.py`、`new_html/utils/mediaFolderTree.ts`、`new_html/pages/MediaLibraryPage.tsx`。
- 约定：`folder_id` 过滤伪值 `__unfiled__`=未归类；`PATCH items` 传 `''`/`null`=移出文件夹；删文件夹级联删子文件夹但夹内素材只置空 `folder_id`（不删）。

---

## 2026-05-26 · ComfyUI agent 注册成功但 ~3min 后所有 heartbeat/poll `Read timed out` —— `AGENT_ONLY_MODE` 二选一陷阱根治（Follow-up A 落地）

**症状**

外部 GPU 节点跑 `comfyui_agent.py --server https://<autodl-tunnel>:8443`：

```
22:28:19 [INFO] Registered as agent_0db82e7e8ae7 (comfyui-01)
22:28:19 [INFO] Agent running. Polling every 3s...
22:31:00 [WARNING] Heartbeat failed: ... Read timed out. (read timeout=10)
22:31:10 [ERROR] Unexpected error: ... Read timed out. (read timeout=10)
... 此后每个 cycle 都 timeout, 永远跑不出来 ...
```

**真正的触发条件**

用户为了救 minimax_tts/seedance/kling/vidu/sora2/veo/wan26 等外部 API 任务死队列问题（见 2026-05-25 minimax-tts faq），把 `AGENT_ONLY_MODE=false` 写进环境变量并重启后端。

**根因（已写过的二选一陷阱，这次根治）**

| `AGENT_ONLY_MODE` | ComfyUI agent | 外部 API 任务 (minimax_tts / seedance / kling / vidu / happyhorse / sora2 / veo / wan26 / video_reverse_prompt) |
|-------------------|---------------|-------------------------------------------------------------------------------------------------------------------|
| `true`（默认）    | ✅ 走 agent    | ❌ 没有 Worker 消费，死在 Redis 队列                                                                              |
| `false`（用户当前）| ❌ 见下方       | ✅ 4 个本地 Worker 消费                                                                                            |

`AGENT_ONLY_MODE=false` 时 `cluster_main.py:328-358` 会:

1. 起 `image_cluster_manager` + `video_cluster_manager` 两个 `ClusterManager`，持续对多个遗留本地入口做健康检查 — autodl tunnel 后面那台机器很可能根本没有对应服务，健康检查反复超时挤占 event loop
2. 起 4 个本地 Worker 全部 `zpopmin comfyui:task_queue` — 和外部 agent 抢同一个 Redis 队列，agent 拉不到 ComfyUI workflow 任务
3. 加上 ClusterManager 的卡顿，FastAPI handler 拿不到 Redis 连接 / event loop 时间片，`/api/agent/heartbeat` 和 `/api/agent/poll` 全部 10s 读超时

注册那一刻 4 个 Worker 还没起完，所以 `POST /api/agent/register` 成功；~3 分钟后系统进稳定卡死状态，跟用户日志时间线完全对得上。

**修复（Follow-up A：lite Worker 模式根治）**

| 文件 | 改动 |
|------|------|
| `worker.py` | 顶部新增 `EXTERNAL_API_TASK_TYPES_EXACT` + `EXTERNAL_API_TASK_TYPE_PREFIXES` + `is_external_api_task()`；`Worker.__init__` 允许 `cluster_manager=None`（lite 模式标记 `self.is_lite=True`，并且 `video_cluster_manager` 不再 `or cluster_manager` 兜底，避免 None 被静默掩盖）；`_process_task` 顶部新增 lite 守卫：lite Worker 拿到非外部 API 任务时 `redis.zrem(processing_queue, task_id)` + `task_queue.enqueue(task)` 重新入队 + `sleep(3)` 让出 poll 窗口给 agent |
| `cluster_main.py` | `AGENT_ONLY_MODE=true` 分支不再"什么 Worker 都不起"，改为起 `SystemConfig.LITE_WORKERS_COUNT` 个 lite Worker（`cluster_manager=None, video_cluster_manager=None`），不创建任何 ClusterManager；shutdown 钩子停 Worker 不再依赖 `not AGENT_ONLY_MODE` 条件，直接 `for worker in workers` |
| `cluster_config.py` | `SystemConfig` 新增 `LITE_WORKERS_COUNT = int(os.environ.get("LITE_WORKERS_COUNT", "2"))` |
| `deploy/{worker,cluster_main,cluster_config}.py` | 镜像同步（SHA256 校验三对文件全部一致） |

**修后真值表**

| `AGENT_ONLY_MODE` | `LITE_WORKERS_COUNT` | ClusterManager | 本地 Worker | ComfyUI agent | 外部 API 任务 |
|-------------------|----------------------|----------------|-------------|---------------|---------------|
| `true`（默认）    | `2`（默认）           | 不起 ✅         | 2 个 lite ✅ | ✅ 拉走 ComfyUI 工作流 | ✅ lite Worker 消费 |
| `true`            | `0`                  | 不起           | 不起        | ✅            | ❌ 又死队列（自找）|
| `false`           | 任意                  | 起 ✅           | 4 个完整    | ❌（agent 又会被抢，老坑） | ✅              |

**用户操作（推荐配置）**

后端机器（autodl tunnel 暴露端的那台）`.env` 或启动脚本：

```bash
export AGENT_ONLY_MODE=true        # 默认就是 true，可以删掉之前 export 的 false
export LITE_WORKERS_COUNT=2        # 想多消费外部 API 调大；不需要外部 API 设 0
# 然后重启 cluster_main.py
```

外部 GPU 上的 `comfyui_agent.py` **无需任何改动**，重启后端后下一次 register 即可正常 polling。

**预防规则（新增条目，写进 conventions.md）**

12. **任何"两种部署模式"开关如果让两条路径互斥，要么改成"两条路径都能跑"，要么文档强制写明谁压谁** — 这次的根因不是某行代码错，而是"AGENT_ONLY_MODE 是个二选一开关，不管选哪边都死一边"的架构缺陷。Follow-up A 把它改成两条路径都能跑的合作模式（lite Worker + agent 各取所需）。
13. **新增一类后台任务（外部 API / ComfyUI / 其他）必须在 `worker.py::EXTERNAL_API_TASK_TYPES_EXACT` 或 `_PREFIXES` 登记**。lite Worker 守卫靠这两个集合决定丢回队列还是自己消费；漏登记 → 新任务被 lite Worker 当 ComfyUI 任务丢回队列 → agent 又不认（外部 API 不是 ComfyUI workflow）→ 死循环。grep `EXTERNAL_API_TASK_TYPES_EXACT` 检查最近所有 worker 新加的 task_type 都有登记。
14. **agent 注册成功不等于 agent 一直可用** — 注册是冷启动一瞬间，HTTP server 还没被后台任务占满。压力测试 / 部署回归必须包含"agent 跑满 5 分钟看是否还能正常 poll"。后续可以给 `/api/agent/poll` 加一个 P99 latency 监控告警。

**涉及文件**

```
worker.py                              (顶部 import + 常量 + helper, Worker.__init__, _process_task 守卫)
cluster_main.py                        (AGENT_ONLY_MODE=true 分支起 lite Workers, shutdown 解条件)
cluster_config.py                      (SystemConfig.LITE_WORKERS_COUNT)
deploy/worker.py                       (镜像)
deploy/cluster_main.py                 (镜像)
deploy/cluster_config.py               (镜像)
docs/faq.md                            (本条目)
docs/deployment.md                     (AGENT_ONLY_MODE + LITE_WORKERS_COUNT 描述更新)
docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md  (Follow-up A 标记 DONE)
```

**Date**: 2026-05-26
**Status**: 已修复（架构级根治，二选一陷阱关闭）

---

## 2026-05-26 · 打开 `/admin/login` 反被弹到 `/projects`；点"生成管理"又弹回 `/login`

**症状**

独立 Admin Shell 上线后第二次回归：

1. 用户在浏览器直接输入 `https://.../admin/login` → 页面**短暂闪现**后**自动跳转到 `/projects`**（主站项目列表），admin 登录页根本进不去
2. 用户假设已登录上 admin（输了密码 + 没报错），点击左侧导航"生成管理" → URL 变成 `/admin/operations` → 立刻又被弹到 `/login` → 再被 React Router `*` 兜底跳 `/projects`

**根因**（三层叠加，缺一不可）

### 层 1 — `apiService.handleResponse` 401 拦截器路径无关

```ts
if (response.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    window.location.href = '/login';      // ← 写死，不分主站 / 后台
}
```

无论触发 401 的是 `/api/admin/users`（后台请求）还是 `/api/projects/save`（主站请求），都清主站 token 跳 `/login`。admin 路径下的 401 触发它，会**把 admin 用户路由扔回主站登录**。

### 层 2 — `App.tsx` 没有 `/login` React 路由

App.tsx 路由表里 `/login` 不存在（主站 `/login` 是后端 `@app.get("/login")` 返回 `login.html`，**不在 React 路由内**）。所以 `window.location.href = '/login'` 这一步触发浏览器整页跳转 → 后端返回 `login.html` 静态页。**但如果用户是单页应用内 navigate（React Router 客户端跳）就会被 `<Route path="*" element={<Navigate to="/projects" replace />} />` 二次兜底**。

实际链路里两条都发生：

```
/admin/login 加载
  → React app 启动
  → TaskProvider mount → useEffect 触发 getNotifications() / getUnreadNotificationCount()
  → apiService.getAuthToken() 拿不到 admin token（用户还没登）
  → 但回落到 localStorage.auth_token（line 82）→ 主站也没登 / 已过期 → null
  → fetch 不带 Authorization → 后端 401
  → handleResponse 触发 window.location.href='/login'
  → 浏览器整页跳 /login → 后端 FileResponse('login.html')
```

用户看到的就是"我访问 admin 登录页结果跳到主站登录页"。

### 层 3 — `getAuthToken` 在 `/admin/*` 下静默 fallthrough 主站 token

```ts
function getAuthToken(): string | null {
    if (pathname.startsWith('/admin')) {
        const adminToken = sessionStorage.getItem('admin_session_token');
        if (adminToken) return adminToken;
    }
    return localStorage.getItem('auth_token');   // ← admin 路径下也会到达这里
}
```

这制造了一个隐蔽 bug：用户在 admin 后台**已登出**（sessionStorage 清空）但**主站还登着**（localStorage 有 token），下次 admin 请求会**带主站普通用户 token 去打 `/api/admin/*`**，`require_admin` 必拒 → 401 → 拦截器循环。

`/admin/operations` 弹回 `/login` 的链路就是这个：用户的 admin 会话已失效 / 后端 token 校验失败 / 主站 token 误用 → 任一情况都会触发。

**修复**（一次性堵三层，下次回归就不再发生）

| 层 | 文件 | 改动 |
|----|------|------|
| 拦截器 | `new_html/services/apiService.ts::handleResponse` | 401 处理改路径感知：`/admin/*` 清 sessionStorage admin session，跳 `/admin/login`；其他路径行为不变；**在 login 页本身上 401 不再跳**（防死循环） |
| token | `new_html/services/apiService.ts::getAuthToken` | admin 路径下 sessionStorage 为空时返回 null，**不再 fallthrough localStorage** — 强制走 admin 登录闸门，杜绝主站 token 误打 admin API |
| 启动 | `new_html/contexts/TaskContext.tsx::TaskProvider` | mount useEffect 加 path guard：`/admin/*` 路径下直接 return，不触发 `getNotifications` / `getUnreadCount` / `globalTaskManager.start` —— admin shell 不需要主站任务历史，硬性隔离 |

**修后链路**

```
访问 /admin/login
  → React app 启动
  → TaskProvider mount → path guard 命中 → 跳过所有主站 fetch
  → AdminLoginPage 渲染（无任何 fetch 触发 401）
  → 用户输账密 → setAdminSession → navigate('/admin')
  → AdminLayout 检查 sessionStorage → 有 admin token → 渲染 hub
  → 用户点"生成管理" → AdminPage 内 fetch 带 sessionStorage admin token → require_admin 通过 → 渲染
```

**涉及文件**

```
new_html/services/apiService.ts         (handleResponse + getAuthToken)
new_html/contexts/TaskContext.tsx       (TaskProvider useEffect 加 path guard)
deploy/new_html/services/apiService.ts  (镜像)
deploy/new_html/contexts/TaskContext.tsx (镜像)
dist/                                     (rebuild → index-DHhjO8EX.js)
```

**预防规则**（写进 conventions.md）

1. **任何全局 401 拦截器 / 任何 logout 跳转**，必须**路径感知** — 至少区分主站 / 独立后台两条路径线，避免"两个登录态被同一段代码当一个用"。
2. **任何"path-aware token 获取"**，要么**完全严格**（不在该路径下 sessionStorage 为空就返回 null），要么**完全宽容**（任何路径都先 session 再 local）；**不要半截**。最容易踩坑的就是 "admin 路径下先看 session、没有就拿 local" 这种"看起来兜底实际撞门"的写法。
3. **全局 Context Provider 包裹 admin 路由时**，Provider 内部 effect 必须有 admin path guard，或者把 admin 路由抽出 Provider 之外。Provider 里启动的 fetch 必然会在 admin 登录页前触发，是 401 拦截器的常驻燃料。
4. **加 hardcoded 跳转 URL 前**先 grep 现有路由表，确认目标存在 — `/login` 在 React 路由里**不存在**，是后端文件路由，所有 `window.location.href='/login'` 都依赖浏览器整页跳；如果有谁误用了 `navigate('/login')`，会被 `*` 兜底跳走，行为就完全失控。

**Date**: 2026-05-26
**Status**: 已修复（3 层）+ 第 4 层补丁详见下一条

---

## 2026-05-26 · 第 4 层：登录 URL 写错 (`/api/auth/login` → `/api/login`) —— 看似登录实际未登录

**症状**

修完前面三层防御后，用户报告：
> "现在 /admin/login 登录后，点击生成管理，就会又跳回这个登录页面。"

**最直接的根因**

`AdminLoginPage.tsx:44` 调用 `POST /api/auth/login`，但后端 `cluster_main.py:1104` 注册的路由是 `POST /api/login`。**`/api/auth/login` 后端根本不存在** → 404。

链路：

```
用户输账密 → fetch '/api/auth/login' → 后端无此路由 → 404
  → res.ok = false → AdminLoginPage 显示"登录失败 (HTTP 404)" 红色错误条
  → 用户**没注意到错误条**（一闪而过 / 视觉疲劳），以为登录成功
  → sessionStorage.admin_session_token 没写入（setAdminSession 被 return 短路）
  → 用户点击"生成管理" → NavLink to="/admin/operations"
  → AdminOperationsRoute 检查 getAdminToken() → null
  → <Navigate to="/admin/login" replace state={{from: '/admin/operations'}} />
  → 用户感觉"刚登录就被弹回来"
```

**为什么前 3 层修复堵不住这个**

前 3 层（apiService 401 路径感知 / getAuthToken 严格模式 / TaskContext path guard）都是**针对"已经收到 401"的下游防御**。这次 bug 在**更上游**：登录请求自己就失败了，根本没产生需要拦截的 401。前 3 层完全用不上。

**为什么诊断耗了 4 轮**

前 3 层都是从"401 怎么跳的"切入，因为用户最初描述的是"被弹去 /projects" / "被弹回 /login"。直到这次用户精确描述"登录后点生成管理弹回 /admin/login"（注意：是 admin login，不是主站 login），才能看出**401 拦截器其实工作正常**（路径感知没问题），问题在 **token 写入这个动作从来没发生过**。

**修复**

```ts
// new_html/admin/AdminLoginPage.tsx:44
- const res = await fetch('/api/auth/login', {...});
+ const res = await fetch('/api/login', {...});
```

后端响应格式 `{ success, message, token, username }` 与前端解构完全匹配（`cluster_main.py:1215-1220`），无需后端改动。

**涉及文件**

```
new_html/admin/AdminLoginPage.tsx   (URL + 注释)
deploy/new_html/admin/AdminLoginPage.tsx (镜像)
dist/                                (rebuild → index-Z229d_l5.js)
```

**预防规则**（写进 conventions.md）

5. **新建一个调用后端 API 的前端文件时，第一时间 grep `@app.post("/api/<your-path>")` 验证路由真存在**。404 在 dev tool Network 标签是显眼的红色，但在 SPA 内部 fetch 包装层里**容易被错误处理静默掉**（"登录失败 HTTP 404" 一行红字 vs. 用户一秒后才看到的"系统看起来登录成功"）。
6. **在 PR 前用 `python scripts/scan_project.py` 跑一遍**：`routes.json` 里有的才是后端真实接口；`api_calls.json` 里前端调的 URL 应该在 `routes.json` 里有对应 handler。把 "前端调的但后端没有" 当作 ERROR 级 sync_check 检查项（TODO：sync_check 加这条规则）。
7. **登录类页面登录失败时**，错误提示应该**持久显示**直到下次提交，且**禁止 useEffect 自动跳走**当前页面（避免"用户没看清错误就被自动跳进 hub 然后被踢回来"的诡异 UX）。
8. **绝不仅依赖文件级 lint / typecheck**：URL 是字符串，编译期发现不了。需要运行时 contract test 或 dev 阶段 fail-fast 校验（如启动时遍历 `api_calls.json` 验证后端路由全部存在）。

**Date**: 2026-05-26
**Status**: 已修复，硬刷新后 `/admin/login` 应能正常登录并访问 `/admin/operations`

---

## 2026-05-26 · `/api/cluster/nodes` 500 + 前端 `SyntaxError: Unexpected token 'I'`（AGENT_ONLY_MODE "幽灵符号"）

> **2026-05-26 后续**：本条修的是"`cluster_manager is None` 时调它的方法 → 500 plain text"的下游表象。
> 真正的"两种部署模式互斥"根因已由同一天的 **Follow-up A（lite Worker 模式）** 在 `worker.py` /
> `cluster_main.py` / `cluster_config.py` 根治；现在 `AGENT_ONLY_MODE=true` 默认下两条路径
> （ComfyUI agent + 外部 API 任务）都能跑，不再需要切换 `AGENT_ONLY_MODE=false` 来救外部 API。
> 详见本文件最顶部 "AGENT_ONLY_MODE 二选一陷阱根治" 条目。

**症状**

`/admin/operations` 进入"集群节点监控"或某些 tab 时浏览器报：

```
GET /api/cluster/nodes 500 (Internal Server Error)
加载集群节点失败: SyntaxError: Unexpected token 'I', "Internal S"... is not valid JSON
```

**根因**

`cluster_main.py:555` 声明全局：

```python
cluster_manager: Optional[ClusterManager] = None
```

只有在 `AGENT_ONLY_MODE=false` 时才被初始化（`cluster_main.py:328-342` 的 `if not SystemConfig.AGENT_ONLY_MODE:` 分支）。但**它的消费者裸调它的方法**：

| 行 | 文件 | 调用 |
|----|------|------|
| 2509 | `cluster_main.py` `/api/cluster/stats` | `cluster_manager.get_cluster_stats()` |
| 2525 | `cluster_main.py` `/api/cluster/nodes` | `cluster_manager.get_cluster_stats()` |
| 2542 | `cluster_main.py` `/health` | `cluster_manager.get_cluster_stats()` |

`AGENT_ONLY_MODE=true`（默认）下调用 `None.get_cluster_stats()` → `AttributeError: 'NoneType' object has no attribute 'get_cluster_stats'`。FastAPI 默认错误中间件返回 `text/plain` 的 `"Internal Server Error"` 而**不是 JSON**，前端 `response.json()` 解析时遇到 `I` 报 SyntaxError。

**典型"环境配置 + 代码假设"型 bug**：代码假设传统集群模式，但环境实际是 agent-only。

**修复**

| 文件 | 改动 |
|------|------|
| `cluster_main.py::get_cluster_stats` (line 2506) | `cluster_manager is None` 时返回空 stats + `agent_only_mode: True` 标志；保留队列 / Worker 统计 |
| `cluster_main.py::list_nodes` (line 2522) | `cluster_manager is None` 时返回 `{success: True, nodes: [], agent_only_mode: True}` + 友好 message |
| `cluster_main.py::health_check` (line 2531) | `cluster_manager is None` 时 cluster 块返回 `{healthy_nodes:0, total_nodes:0, agent_only_mode:True}` |

后端返回的 200 JSON 让前端正常拿到空数组（"无集群节点"是 agent-only 的预期状态，不是错误）。

**预防规则**

9. **任何 `Optional[T] = None` 的模块级全局变量**，所有消费者**必须**做 None 检查 — 这是"由配置 / 启动条件决定是否存在"的符号最容易踩的坑。可以加一个 helper：

    ```python
    def get_cluster_manager_or_empty_stats():
        if cluster_manager is None:
            return {"nodes": [], "healthy_nodes": 0, "total_nodes": 0, "agent_only_mode": True}
        return cluster_manager.get_cluster_stats()
    ```

10. **FastAPI 接口异常必须返回 JSON，永远不要让 plain text "Internal Server Error" 泄露到前端** — 加全局 `@app.exception_handler(Exception)` 把所有未捕获异常包成 JSON `{detail: ..., status: ...}`，让 `apiService.handleResponse` 能正常解析。当前还是用最朴素的 None 检查防御，后续可加全局兜底。
11. **任何"两种部署模式"开关（AGENT_ONLY_MODE / DB_AVAILABLE / etc）需要专门测试 false 路径** — 默认是 true 不代表 false 路径就不被访问；前端 admin 控制台天然会探测全部 cluster 接口。

**涉及文件**

```
cluster_main.py (3 处)
deploy/cluster_main.py (镜像)
```

**Date**: 2026-05-26
**Status**: 已修复，需重启 cluster_main 让新代码生效

---

## 2026-05-26 · AdminPage "生成统计分析" / "新功能管理" 长内容看不全也滚不动

**症状**

`/admin/operations` 切到"生成统计分析"或"新功能管理"等长内容 tab 时，下方的"模型使用分布 / 用户活跃度分析" 等显示不全，且**滚动条不响应**（鼠标滚轮、键盘 PgDn 都无效）。

**根因**

`AdminPage.tsx:725` 根容器：

```tsx
<div className="flex min-h-screen w-screen ... overflow-hidden ...">
```

- `min-h-screen` = `min-height: 100vh`，**允许容器撑得比 100vh 更大**
- `overflow-hidden` 把超出部分裁掉
- 内部 `<div className="flex-1 overflow-y-auto">` 是子级，在 **flex column 父容器没有明确高度** 时，`flex-1` 会按内容算高度 → 子 `overflow-y-auto` 永远等于内容高度 → **不形成滚动区域**

简单说：父容器允许长，子容器就跟着长，谁都不滚，全靠父容器 `overflow-hidden` 砍掉看不见的部分。

**修复**

`min-h-screen` → `h-screen`（精确 100vh）。这样父高度固定 = 100vh，子 `flex-1` 才会"在限定高度内分配剩余空间"，子 `overflow-y-auto` 才能正确触发滚动。

```tsx
- <div className="flex min-h-screen w-screen ... overflow-hidden ...">
+ <div className="flex h-screen w-screen ... overflow-hidden ...">
```

**预防规则**

12. **flex column 容器 + 子需要滚动**：父必须是**精确高度**（`h-screen` / `h-full` / `h-[400px]`），不能用 `min-h-*`。`min-h-*` + `overflow-hidden` + 子 `overflow-y-auto` 是常见错误组合 — 子拿不到滚动区域，长内容被裁掉。
13. **Tailwind 全屏容器三件套**：`h-screen overflow-hidden flex flex-col` （父）+ `flex-1 overflow-y-auto` （子）。这是"全屏面板 + 内部独立滚动"的标准 idiom，背下来。

**涉及文件**

```
new_html/components/AdminPage.tsx (line 725)
deploy/new_html/components/AdminPage.tsx (镜像)
dist/                                (rebuild → index-1y0s6ETR.js)
```

**Date**: 2026-05-26
**Status**: 已修复，硬刷新后所有 tab 长内容均可上下滚动

---

## 2026-05-26 · `/admin/login` 返回 404 + `/admin/index.html` 直接打开旧版控制台（绕开登录）

**症状**

刚上线独立 Admin Shell 后，用户报告两个并发现象：

1. 浏览器访问 `https://.../admin/login` → 返回 `{"detail":"Not Found"}`（404），白屏没看到 React 登录页
2. 用户改访问 `https://.../admin/index.html` → 直接打开了旧版 cluster_main 仪表盘（左侧 sidebar 是"仪表盘/集群管理/工作流管理/API 密钥"），**完全绕开**了新做的账号密码登录页

**根因**（同一根因，双向表现）

`cluster_main.py` line 533 历史代码：

```python
app.mount("/admin", StaticFiles(directory=admin_dir, html=True), name="admin")
```

这把 `/admin/*` **整个前缀**劫持给了旧版静态控制台目录（`admin/{index,app.js,style.css}`）。Starlette mount 优先级是按注册顺序，line 533 早早抢占了 `/admin/*` 前缀。具体匹配：

| 请求 | StaticFiles 行为 | 结果 |
|------|------------------|------|
| `/admin/login` | 查 `admin/login` 文件 → 不存在 | 404（图1） |
| `/admin/index.html` | 查 `admin/index.html` → 存在 | 直接返回旧版仪表盘（图2，绕过登录） |
| `/admin/`、`/admin` | `html=True` → 自动返回 index.html | 同上 |

React Router 中定义的 `/admin/login`、`/admin/operations`、`/admin/settings` 路由**永远收不到请求**，因为 FastAPI 在到达 SPA fallback 之前就被 mount 短路了。

文件末尾的 `@app.get("/admin")`（原 line 6261）也是**死代码** — mount 在前面，请求根本到不了显式路由。

**修复**（vertical-slice 路由层修正）

1. **`cluster_main.py` line 533**：mount path 从 `/admin` → `/admin-legacy`
   - 旧版仪表盘搬到 `https://.../admin-legacy/` 仍可访问（内部 `style.css` / `app.js` 均相对路径，自动 rewrite）
   - 调用 `/api/admin/*` 是绝对路径，跨 mount 不受影响

2. **`cluster_main.py` 新增 React Admin SPA fallback**（紧跟 `_serve_spa` 定义之后）：

   ```python
   @app.get("/admin")
   @app.get("/admin/")
   async def admin_spa_root(): return _serve_spa()

   @app.get("/admin/login")
   @app.get("/admin/operations")
   @app.get("/admin/settings")
   async def admin_spa_named(): return _serve_spa()

   @app.get("/admin/login/{path:path}")
   @app.get("/admin/operations/{path:path}")
   @app.get("/admin/settings/{path:path}")
   async def admin_spa_subpath(path: str): return _serve_spa()
   ```

3. **删除 line 6261-6267 死代码** `@app.get("/admin") serve_admin_index` —— 原本被 mount 拦截，现在路径转移后也不需要它（新的 admin_spa_root 接管）。

4. **前端外链**：`AdminLayout.tsx` / `AdminHubPage.tsx` / `AdminSettingsPage.tsx` 中的 `href="/admin/app.js"` 全部改为 `/admin-legacy/`（4 处 in Settings + 1 处 in Hub + 1 处 in Layout sidebar）。

5. 同步 `deploy/cluster_main.py` + `deploy/new_html/admin/*.tsx`，rebuild `dist/`（新 bundle `index-BQruKo13.js`）。

**Files**

| 层 | 文件 | 变更 |
|----|------|------|
| BE 路由 | `cluster_main.py` line 533 | mount path 改 `/admin-legacy` |
| BE 路由 | `cluster_main.py` line 1073+ | 新增 3 个 React Admin SPA handler |
| BE 路由 | `cluster_main.py` line 6261-6267 | 删除死代码 `@app.get("/admin")` |
| FE 链接 | `new_html/admin/AdminLayout.tsx` | `/admin/app.js` → `/admin-legacy/` |
| FE 链接 | `new_html/admin/AdminHubPage.tsx` | 同上 |
| FE 链接 | `new_html/admin/AdminSettingsPage.tsx` | 同上（4 处 tile href） |
| 镜像 | `deploy/cluster_main.py` + `deploy/new_html/admin/*` | 同步 |

**预防规则**

1. **StaticFiles mount 是"前缀强占"语义**。任何 `app.mount("/prefix", ...)` 之后，`/prefix/*` 下所有路径都不再走显式路由 — 即使在文件末尾定义 `@app.get("/prefix/some-path")` 也是死代码。Mount 与 SPA 路由共存时，必须让 mount 用**专有前缀**（不与 SPA 重叠）。

2. **SPA 子路由要在后端逐个枚举**（或注册 catch-all `@app.get("/admin/{path:path}")`）。仅注册 `/admin` 顶层不够 — 用户刷新 `/admin/login` 时仍会 404。

3. **前端外链到后端静态资源时把路径写进 `vertical-slices.md`**。一旦后端改 mount path，前端外链是隐式契约 — 必须同步。

4. **静态资源 mount 优先于 SPA fallback 路由注册时**：先注册 SPA 显式路由（写在 mount 之前 / 用更具体路径），再 mount 通用静态目录。

---

## 2026-05-26 · 管理后台抽离为独立 Shell + 创建分组 500 + 素材库无法切账号

**触发场景**

用户反馈三件事捆绑出现：

1. "管理按钮不要放在流程化页面，逻辑应该和 cluster_main 一样 — 总管页面 + 账号密码登录"（架构）
2. `POST /api/admin/project-groups → 500 Internal Server Error`（截图：user_id 输入 "1"，group_name "buer"）
3. "素材库管理不能切换账号"（用户视角：管理员看不到不同用户的素材库）

**根因**

| 问题 | 根因 |
|------|------|
| 架构耦合 | 此前 `WorkflowLayout` 顶栏挂了"管理"按钮 + `/admin` 直接渲染 `AdminPage`。后台与主站共享 `localStorage.auth_token`，没有真正的"sudo 边界"，用户主诉求是**安全感和清晰的入口分离**。 |
| 创建分组 500 | `project_groups.user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE` 是强外键。前端 UI 让管理员手填 `user_id` 字符串（参见旧版 GroupsTab line 304），填错 → PostgreSQL 抛 `ForeignKeyViolation` → `admin_create_project_group` 未 catch → 裸 500，前端只看到无意义 stack。"手填 ID"本身就是坏 UX。 |
| 素材库无法切账号 | `MediaListTab` 调 `/api/admin/media-library/items?limit=300`，没有 `user_id` query param；UI 也没下拉。后端其实早已支持 `user_id / item_type / keyword` 三个过滤参数，但前端从未暴露。 |

**修复**（vertical-slice 一次闭环）

A. 架构重组（Admin Shell 独立）：

1. 新建 `new_html/admin/`：`adminAuth.ts` / `AdminLayout.tsx` / `AdminLoginPage.tsx` / `AdminHubPage.tsx` / `AdminSettingsPage.tsx`
2. Token 隔离：`sessionStorage.admin_session_token` vs 主站 `localStorage.auth_token`；`apiService.getAuthToken()` + `AdminFeatureTabs.getHeaders` + `AdminPage` line 273 全部按路径择 token
3. 路由重组（`new_html/App.tsx`）：
   - `/admin/login` → AdminLoginPage（独立）
   - `/admin` (index) → AdminLayout → AdminHubPage
   - `/admin/settings` → AdminLayout → AdminSettingsPage
   - `/admin/operations` → AdminOperationsRoute → AdminPage 全屏（+ 浮层"返回 Hub"）
4. `WorkflowLayout.tsx` 移除"管理"按钮和 `ShieldCheck` import；流程化页面与后台彻底分离
5. 视觉 DNA：cluster_main 风格的暗黑工业风 — zinc-950 / emerald accent / JetBrains Mono ID / 顶部网格 + 径向辉光

B. 创建分组 500 → 400 友好错误：

1. **后端** `admin_routes.admin_create_project_group`：先 `UserDAO.get_user_by_id(body.user_id)` 校验 FK；不存在则 `raise HTTPException(400, "归属用户不存在：{user_id}")`；FK violation 也 catch 转 400
2. **前端** `AdminFeatureTabs.GroupsTab`：`<input placeholder="归属 user_id">` 改成 `<select>` 下拉 — 由共享 `useAdminUsers()` 提供选项（一次拉、跨 tab 缓存）
3. **错误展示** `readApiError(err)`：把 FastAPI `{ detail: '...' }` 形状从 `err.message` 末尾正则抽出，alert 显示中文，不再只看 stack

C. 素材库可切账号：

1. `MediaListTab` 增加三个 filter：`filterUserId`（用户下拉，同 GroupsTab 复用 `useAdminUsers`）/ `filterType`（图/视/音/...）/ `filterKeyword`（标题文件名搜索，Enter 触发）
2. `reload()` 把 filter 串成 query param 调 `/api/admin/media-library/items?user_id=...&item_type=...&keyword=...`
3. 表格"所有者"列：从单纯显示 user_id hash 升级为 `username · userid前8位`，配合用户下拉切换上下文

**Files**

| 层 | 文件 | 变更 |
|----|------|------|
| FE 新增 | `new_html/admin/{adminAuth.ts,AdminLayout.tsx,AdminLoginPage.tsx,AdminHubPage.tsx,AdminSettingsPage.tsx}` | 独立 Admin Shell |
| FE 修改 | `new_html/App.tsx` | 重组 /admin/* 路由 |
| FE 修改 | `new_html/layouts/WorkflowLayout.tsx` | 移除"管理"按钮 |
| FE 修改 | `new_html/services/apiService.ts` | `getAuthToken` 路径感知 |
| FE 修改 | `new_html/components/AdminFeatureTabs.tsx` | useAdminUsers / GroupsTab 下拉 / MediaListTab 三筛选 / readApiError |
| FE 修改 | `new_html/components/AdminPage.tsx` | embedded prop（保留接口）+ 终端 fetch token 路径感知 |
| BE 修改 | `admin_routes.py` | `admin_create_project_group` FK 友好错误 |
| 镜像 | `deploy/*` 全部对应文件 | 同步 |
| Docs | `docs/{frontend.md,vertical-slices.md,faq.md}` | 闭环 |

**预防规则**（写进 conventions / 下次新功能时自查）

1. **任何强 FK 外键写入路径都必须有 try/except 转 400**。`raise HTTPException(400)` 永远比 500 强。
2. **"让管理员手填 user_id / 任意 ID 字符串"是坏 UX**。所有 ID 输入都改下拉，用 `useAdminUsers()` / 类似 hook 拉到候选列表。
3. **新增 admin 子页面 = 新增独立路由**。不再向 `WorkflowLayout` 顶栏塞新按钮 — 后台和主站从今往后是两个 app。
4. **token 隔离规则**：任何在 `/admin/*` 路径下发出的 fetch，header 必须用 `pickTokenForCurrentRoute()`（或同等逻辑），不要直接 `localStorage.auth_token`。
5. **后端列表接口**：暴露 `user_id / type / keyword` 等过滤参数后，前端必须**真的暴露 UI**，否则等于没做。

---

## 2026-05-26 · AdminPage `Cannot read properties of undefined (reading 'allowedModels')`

**症状**

打开 `/admin`（或顶栏点"管理"），白屏 + 控制台报：

```
Uncaught TypeError: Cannot read properties of undefined (reading 'allowedModels')
    at Array.map (<anonymous>)
    at A5 (index-D6oNkmb-.js:4399:172131)
```

栈最里层是 `users.map((user) => …)` 中访问 `user.permissions.allowedModels`。

**根因**（三层契约同时缺失 — 经典 §E "多源真相"踩坑）

1. **DB 层**：`db_migration_add_permissions.sql` 把 `users.permissions` 定义为 `JSONB DEFAULT '{}'`，且只对历史用户做了一次性 `UPDATE … WHERE permissions IS NULL OR permissions = '{}'`。**之后新注册 / 新 fixture 的用户进库时 permissions 永远是空对象**，没人写完整 schema。
2. **后端 DAO**：`dao_user.admin_list_users` 的 `SELECT` 列表**根本没把 permissions 列查出来**（只 SELECT 了 `user_id/username/email/role/status/...is_active`），所以 API 返回的 user 行**完全没有 permissions 这个 key**。
3. **后端 admin_routes**：`admin_list_users` 用通用 `_row_to_jsonable` 直出 raw row，未做 snake→camel + 兜底；前端 `UserAccount` 期望的 `id / isActive / isOnline / lastLogin / permissions / stats` 全部缺。
4. **前端 AdminPage.tsx**：line 864 起 `user.permissions.allowedModels.length` 等所有访问**没有任何 `?.` / 兜底**。

为什么这之前从没崩过？历史上 AdminPage 只作为 `WorkspaceApp` 的 `AppView.Admin` 视图被打开，第一次 `getUsers()` 失败会 fallback 到 `generateLocalUsers()`（line 219-222）— 自造一份完整 camelCase mock，用户**根本没真正消费过后端数据**。2026-05-26 我把 AdminPage 抽成独立 `/admin` 路由 + 顶栏入口，第一次走真实 API 就立刻触雷。

**修复**（vertical-slice 一次性闭环，No single-layer fixes）

1. **`dao_user.py::admin_list_users`** — `SELECT` 增加 `permissions` 列；老 schema fallback 也尝试带上 `permissions`，再降级到不带这列。
2. **`admin_routes.py`**:
   - `_row_to_jsonable` 的 JSONB 解析列表增加 `"permissions"`
   - 新增 **`_normalize_admin_user(row)`** —— 返回 `{ id, username, email, role, isActive, isOnline, lastLogin(ms), permissions: { allowedModels, priority, canExport }, stats: { todayCount, totalCount, byModel } }`；缺字段时全部兜底
   - `admin_list_users` / `admin_get_user` 改用 `_normalize_admin_user(u)`
3. **`new_html/components/AdminPage.tsx`** — 顶部新增 `normalizeUserRow(raw)`（双保险，即使后端少字段也不崩）；`loadData()` 里 `setUsers(usersRes.users.map(normalizeUserRow))`
4. 同步 `deploy/dao_user.py` / `deploy/admin_routes.py` / `deploy/new_html/components/AdminPage.tsx`，rebuild `dist/`

**Files**

- `dao_user.py` (+`deploy/`)
- `admin_routes.py` (+`deploy/`)
- `new_html/components/AdminPage.tsx` (+`deploy/`)
- `docs/faq.md`, `docs/vertical-slices.md`

**Date**: 2026-05-26

**预防**（与本周已有 vertical-slice 规则对齐）

- **前端任何"展示后端数据"的循环**，对**嵌套对象字段**必须用 `?.` 或显式 normalize，**禁止假设后端形状一定完整**。
- **后端任何 admin API 返回数据库 raw row**，必须为前端契约写显式 normalize 函数（不要让 `_row_to_jsonable` 同时服务 N 个不同消费者），并在 `vertical-slices.md` 对应 page 段标注"normalize fn = …"。
- **跨页面/跨入口复用同一组件**（如 AdminPage 从 view 模式 → route 模式），必须重新跑一遍真实数据路径，不能依赖原入口的 fallback mock。

---

## 2026-05-25 · DashScope 三卡再次极简：删卡内首/尾槽 + 接入素材库 mention

**症状**（用户继续追问）

1. Vidu 还是有"首/尾帧占位槽"，多余 — 应该是点 storyboard 卡的「首尾帧连接按钮」就自动走首尾帧通道，否则就是参考生视频。
2. Kling 同样不应该有「首/尾帧按钮」+ 卡内首/尾槽 —— storyboard 链接两张图就够了。
3. 三个新模型（Kling/Vidu/HappyHorse）的 prompt 不支持 `@` 选素材库，跟 Seedance 不一致；还要能 `@` 引用分镜页面已生成的对应分镜（storyboard_data 候选）。

**根因**（系统级，跟 §E 多源真相 + §D 隐式契约 同源）

- **双源真相**：storyboard 顶部已展示 first/last 双图（pair 模式），DashScope 卡内又有独立的「首」「尾」上传槽 —— 用户在卡内点上传 ≠ storyboard 顶部图。两层 source-of-truth 让用户不知道哪个是真的。
- **role 注入策略错**：`getDashScopeParams` 把所有 storyboard 图统一注入为 `reference_image`，因此后端 `inferDashScopeTaskType` 永远看不到 `first_frame` / `last_frame`，Vidu 永远走不到 startend、Kling 永远走不到 morph / i2v。需要按 `group.ids.length` 即 `isPair` 拆分注入角色。
- **mention 编辑器孤岛化**：`SeedanceMentionPromptEditor` 强类型只接受 `SeedanceParams`；DashScope 卡的 prompt 是裸 `<textarea>`，无法复用 mention candidates。但 `insertMention` / `removeMediaInput` 实际只读写 `prompt + media_inputs` 两个字段 —— 结构与 `DashScopeVideoParams` 兼容，只需要在外层做投影适配即可。

**修复**（一次性闭环）

1. **`new_html/components/VideoPage.tsx::getDashScopeParams`**
   - 不再统一 `reference_image`。改为按 storyboard ids 顺序：
     - 单图 → `[{role: 'first_frame'}]`（Vidu reference 通道 / Kling i2v 通道）
     - 双图 → `[{role: 'first_frame'}, {role: 'last_frame'}]`（Vidu startend / Kling morph 通道）
     - HappyHorse 例外：始终 `reference_image`（仅支持 r2v）
   - 关键：按 `group.ids` 顺序而非 `uploadedImages` 顺序配对，否则 Morph 双图的 first/last 会随机翻转。

2. **`new_html/components/video/DashScopeCards.tsx::KlingCard`**
   - 删除「首/尾帧」mode 按钮 → mode toggle 只剩 2 个：`Omni 多参考` / `Multi 多镜头`，再次点击同一按钮 = toggle 回 `auto`。
   - 删除 `currentMode === 'i2v'` 分支下的 `<CompactImageSlot first>` + `<CompactImageSlot last>`：首/尾帧由 storyboard 顶部 image preview 接管，卡内不再有第二个上传入口。
   - `kling_active_mode` 默认值改为 `'auto'`（之前是 `'i2v'`），dispatchSubtitle 在 auto 模式下根据 `first`/`last` 派发「文生 / 图生 / 首尾帧过渡」。
   - `switchMode('omni')` 时把已注入的 `first/last` 同步转 `reference_image`，否则用户点 Omni 后会丢图。
   - `switchMode('auto')` 把 refs 重新映射回 `first/last`，避免来回 toggle 丢图。

3. **`new_html/components/video/DashScopeCards.tsx::ViduCard`**
   - 删除卡内独立的「首」「尾」`CompactImageSlot`。
   - 始终只展示一行 `MultiRefRow`（参考图行）。当 storyboard 已注入 first+last 时，subtitle 自动显示「首尾帧通道」并把 placeholder 改成「已通过分镜启用首尾帧通道」。
   - `sub_model_vidu` 在 first+last 同时存在时通过 `useEffect` 自动切到 `q3-turbo` / `q2-turbo`。

4. **三卡 prompt 注入 `@` mention**（新机制）
   - `DashScopeCardProps` 新增 `PromptEditor?: React.FC<DashScopePromptEditorProps>` 可选注入点；三卡内部 `props.PromptEditor ? ... : <textarea>` 降级回退。
   - 新增 `new_html/components/video/VideoCard.tsx::DashScopeCardWithCandidates` wrapper：
     - 用 `useSeedanceCandidates` 拿 candidates（含 `current_card` / `storyboard_data` / `assets` / `audio` / `video_segments` / `user_files`）。
     - 用 `useCallback` 构造一个 PromptEditor adapter：把 `DashScopeVideoParams` 投影为 minimal `SeedanceParams`，交给 `SeedanceMentionPromptEditor`，onChange 回调把 `prompt + media_inputs` 写回 DashScope 参数。
     - `hideTokensRow={true}`：DashScope 卡已有 MultiRefRow 显示参考图，不重复渲染 token 胶囊。
   - `VideoPage.tsx::renderStoryboardCard` 把原 `<DashScopeVideoCard>` 替换为 `<DashScopeCardWithCandidates>`，并把 `storyboardItemId + onPreviewMedia` 透传过去。

**Lesson**

- *Storyboard 是上层，模型卡是下层 —— first/last 角色应该由上层一次决定，下层只展示。* 在模型卡内复制一份「首/尾上传槽」就一定会形成 §E 类的双源真相，用户没法对账。 
- *复用强类型 helper 时优先做"鸭子类型投影"而不是改 helper 签名*。`insertMention` / `removeMediaInput` 用到的只是 `{prompt, media_inputs}` 两个字段，给 DashScope 加一个 adapter 比把 helper 签名改成泛型成本低 10 倍。
- *Mode toggle 不能既影响 UI 又影响 media_inputs*。Kling 的 `auto/omni/multi` 与 `media_inputs.role` 必须显式同步（switchMode 里手动映射 first↔ref），靠"反推"会丢图。

**Files**

- new_html/components/VideoPage.tsx（注入 role + DashScopeCardWithCandidates 替换）
- new_html/components/video/DashScopeCards.tsx（KlingCard / ViduCard / HappyHorseCard 三卡同时改）
- new_html/components/video/VideoCard.tsx（新增 `DashScopeCardWithCandidates`）
- new_html/services/videoService.ts（`kling_active_mode` 增加 `'auto'`、默认值改为 `'auto'`）
- new_html/__tests__/components/DashScopeCards.test.tsx（toggle 数量从 3 改为 2 / 默认无首尾槽 / startend 时 MultiRefRow 不渲染 first+last）

**Predicted next pitfall**

- `DashScopeCardWithCandidates` 的 `PromptEditor` 用 `useCallback` 包，依赖只有 `[candidates, onPreviewMedia]`。如果以后给 DashScope params 加新字段且必须在 PromptEditor 内部读取，可能因为 deps 不全导致 stale closure。届时优先把 PromptEditor 实现内联到 wrapper 而不是再包一层 useCallback。
- 当前 mention 选图后 `media_inputs.push({kind, url})` 不带 `role`，对 Vidu / Kling 是 reference_image 语义；如果未来 mention 候选要支持"指定为首/尾帧"，需要在 candidate metadata 上加 role 字段并改 `insertMention`。

---

## 2026-05-25 · 视频卡片 7 处批量修复（Seedance 滚动 / Kling 卡 T2V / 上传不预览 / 选素材 / 清空卡 / Vidu+Kling 简化）

**症状**（用户一次性 7 连击）

1. Seedance 所有参数前端没完全显示，仍出现内嵌"滑块"（scrollbar）。
2. Kling 切换 I2V / MORPH / Omni / Multi 时——第一次能点，点完两次之后被卡在 T2V，无法再切。
3. Vidu / HappyHorse / Kling 上传图片后预览画面是空的（看不到缩略图）。
4. DashScope 三家卡片不能像 Seedance 那样选素材替换。
5. 视频卡里的图像不能"删除变回空卡"——只能整卡删除丢失提示词与模型偏好。
6. Vidu 不需要"参考生 / 首尾帧"模式切换 toggle，按上传槽就能走相应通道。
7. Kling 不需要独立的 T2V / MORPH 按钮，应由 media 自动派发（无图=t2v / 单首帧=i2v / 双帧=morph）。

**根因**

1. **Seedance 卡只有 480px**：4 次收紧后 `PARAMETRIC_CARD_HEIGHT_CLASS = h-[480px]`，但 Seedance 内部 3 框媒体 (`min-h-[122px]×3 = 366px`) + 6 参数 + 警告 ≈ 600px，body `overflow-y-auto` 触发滚动条。
2. **Kling currentMode 从 media 反推**：旧逻辑 `if (first && last) return 'morph'; if (first) return 'i2v'; return 't2v'`，但 `switchMode('i2v'/'morph'/'omni')` 在 *没有 media* 时把 `media_inputs = []`，反推 → `t2v`。表象就是"点两次后回 T2V"。这是典型的**多源真相冲突**（UI 意图 vs media 状态）。
3. **previewUrl 过滤太严**：`CompactImageSlot` / `ImageSlot` 的 `previewUrl = media?.url && (url.startsWith('http') || url.startsWith('data:')) ? url : ''`，后端 `uploadImage` 在某些场景返回相对路径 `/api/file/...`（不带 host），被这层 startsWith 拦下来 → `<img>` 不渲染。
4. **DashScope picker 只能选历史**：之前 picker 只展示 `uploadedImages.filter(!isPlaceholder)`，没有"上传新图"入口，与 Seedance `SeedanceAssetPickerModal` 体验不对等。
5. **没有 clearTaskImage**：`removeTask` 是整卡删除（连同 group + prompts + status）。"图像变空卡"是一个新的 lifecycle 转换（保留 group/uuid，只重置图与 media_inputs）。
6. **Vidu / Kling 的模式 toggle 是 UI 噪音**：Vidu 的"参考 vs 首尾帧"实际靠 media role 派发，UI toggle 反而加剧"按了不响应"的认知负担；Kling 的 T2V 和 Morph 同样是 media 派发结果，独立按钮重复了媒体槽的语义。

**修复**

1. **卡高度二档化**：`videoCardLayout.ts` 拆出 `SEEDANCE_CARD_HEIGHT_CLASS = h-[680px]` / `DASHSCOPE_CARD_HEIGHT_CLASS = h-[580px]`，`getCardHeightClass` 按 `isSeedanceModel` / `isDashScopeVideoModel` 派发，左右两侧因为同一函数同一 model 保持像素级对齐。
2. **新增 `kling_active_mode: 'i2v'|'omni'|'multi'` 显式字段**：data 字段 (`kling_multi_shot`) 优先于 UI 偏好，UI 偏好优先于 media 反推（向后兼容）。`switchMode` 把 mode 写入字段，**清空 media 不再导致 mode 漂移**。
3. **previewUrl 放宽**：3 处 (`ImageSlot` / `CompactImageSlot` / `MultiRefRow`) 全部改为 `media?.url || ''` —— `<img src>` 自己处理相对路径、blob:、http、data: 全部形式。
4. **DashScope picker 增加"上传新图"按钮**：调 `videoService.uploadImage` 后直接 callback 给卡片，与现有"选历史"并存。
5. **新增 `clearTaskImage(uuid)`**：重置 `uploadedImages[*]` (`isPlaceholder=true`, `url=''`)，清 Seedance/DashScope `media_inputs`，保留 group/uuid/prompt 与模型偏好。X 按钮 hover 时显示在图像右上角。
6. **ViduCard 移除 mode toggle**：始终并列 `首槽 + 尾槽 + 参考行`，子模型默认全部列出；`updateFirst/updateLast` 在双帧齐时自动切到 turbo 子模型（startend 通道）。
7. **KlingCard 3 按钮（首/尾帧 / Omni / Multi）**：i2v 模式总是同时展示首+尾两个 CompactImageSlot；后端 task_type 由 `inferDashScopeTaskType` 从 media 推（无图 → kling_t2v，单首 → kling_i2v，双帧 → kling_morph）。

**修复文件**

- `new_html/services/videoService.ts`：`DashScopeVideoParams.kling_active_mode` 新字段 + `makeDefaultDashScopeParams('Kling')` 默认 `'i2v'`
- `new_html/components/video/DashScopeCards.tsx`：KlingCard / ViduCard / `ImageSlot` / `CompactImageSlot` / `MultiRefRow` 改造
- `new_html/components/VideoPage.tsx`：`clearTaskImage` useCallback + 图像右上角 X 按钮 + DashScope picker 上传新图按钮
- `new_html/utils/videoCardLayout.ts`：`SEEDANCE_CARD_HEIGHT_CLASS=680` / `DASHSCOPE_CARD_HEIGHT_CLASS=580` 二档化
- `new_html/__tests__/components/DashScopeCards.test.tsx`：6 个新回归测试（switchMode 写 active_mode / Vidu 无 toggle / previewUrl 相对路径 / 3 按钮）
- `new_html/__tests__/utils/videoCardLayout.test.ts`：分档断言更新
- `deploy/new_html/**`：全部镜像（pre-commit hook 自动 `sync_to_deploy.py --apply`）
- `dist/` + `deploy/dist/`：vite build 后同步

**Lesson**

- **从 derived state 反推用户意图是 §A 误归因常态**：`currentMode = first && last ? 'morph' : first ? 'i2v' : 't2v'` 看上去简洁，但用户在 *没传图时* 就要先点 mode 切按钮——derived state 在那一刹那是空的，UI 选择就被丢了。**遇到"切换两次后卡住"类 bug，第一时间检查是否存在 derived-only state**。修复模式：加显式持久字段，data 字段 > 显式偏好 > derive fallback（向后兼容旧 session）。
- **过滤 URL 协议是早期"安全防御"过度收紧**：`startsWith('http')` 假设了后端永远返回绝对路径，是错的假设。**`<img>` 自己接受所有 URL 形式**——除非有 XSS 注入风险，否则不要在 UI 层加协议白名单。
- **`max-h` 一旦小于内容自然高度就是滚动条**：用户明确说"不要滑块"=不要内部滚动。**把卡高度调到 ≥ 自然内容高度就是唯一正解**，左右对齐由同一 `getCardHeightClass(model, isPlaceholder)` 保证。这次 Seedance 680 / DashScope 580 是经验值；若将来加新参数仍可能溢出，要再升档。
- **UI toggle 重复 media 语义 = 用户认知负担**：Vidu 的"参考 vs 首尾帧"、Kling 的"T2V/I2V/Morph"按钮，本质都是 media role 派发的视觉副本。能从 media 推导出来的状态就别给用户独立按钮——少一个按钮少一次"两次后卡住"的可能。
- **lifecycle 转换要起名字**：`removeTask` 是 destroy，`clearTaskImage` 是 reset-to-placeholder。**新增一个 state 转换前，先想清楚保留什么、清空什么**——这次保留 group/uuid/prompt/模型偏好，清空 url/media_inputs，与"整卡删除"是两件不同的事。

**Predicted next pitfall**

- `kling_active_mode` 是新字段，旧 session 反序列化时该字段为 `undefined`，由 derive fallback 兜底；但**如果未来某天后端把多镜头能力扩到 omni / i2v 子状态**，derive fallback 会和新字段语义冲突——需要先 deprecate fallback。
- Vidu `updateFirst/updateLast` 自动切 sub_model 只覆盖 q3↔q3-turbo 与 q2↔q2-turbo，**若用户主动选了 q3-pro 然后填双帧，会被覆盖回 q3-turbo**——这是有意行为（startend 通道兼容性），但需要在 UI 上加 hint 或在 sub_model select 上禁用不兼容选项。

---

## 2026-05-25 · 视频页 DashScope 卡片太长 / 一屏只能看一张 + 不能在卡片之间插入空卡

**症状**
1. 选择「合体 (Kling) / 大乘 (Vidu) / 炼虚 (HappyHorse)」三个 DashScope 模型时，单张卡片自然高度涨到 ~800px，一屏只能看到一张完整卡，第二张完全在视口之外。
2. 用户希望在 storyboard 中间手工插入一张全新的空卡（不绑 storyboard_item），上传本地图片后选模型生成视频——之前没有入口。

**根因**
1. **卡高度无 max-h**：`new_html/utils/videoCardLayout.ts` 的 `COMPACT_CARD_MIN_HEIGHT_CLASS = 'min-h-[420px] h-full flex flex-col'` **只设了 `min-h` 没 max-h**，DashScopeCardShell 用 `flex-1` 撑父容器 → 整卡高度 = max(420, 内容自然高度) ≈ 600-800px，外层 `overflow-y-auto` 在父容器没上限时不触发。
2. **媒体槽 aspect-video 撑死**：`DashScopeCards.tsx` 的 i2v/morph/startend 媒体槽用 `aspect-video` 占满卡宽 (~280px → 158px 高)，比 Seedance 同位置的 `w-20 h-14` 缩略图大 ~100px。
3. **`<details open>` 破坏「参数全显示」承诺**：Vidu/HappyHorse 用 `<details open>` 包高级参数，虽然默认展开但用户能折叠后参数消失，与用户明确诉求冲突。
4. **多镜头列表无上限**：Kling 多镜头自定义列表无 `max-h`，每段 prompt rows={2}，6 段 = 300+px 直接撑高整张卡。
5. **没有手工 +1 空卡入口**：之前 `TaskGroup` 只能从 `handleFiles`（拖入/粘贴）或 storyboard 导入产生，没有"用户手工 +1 占位卡 → 之后上传"的 UI 入口。但 `UploadedImage.isPlaceholder` 字段早已存在（`videoService.ts:125`），只是 UI 没有触发它的按钮。

**修复**
1. `videoCardLayout.ts` 新增 `DASHSCOPE_CARD_HEIGHT_CLASS = 'min-h-[420px] max-h-[640px] h-full flex flex-col overflow-hidden'`，`getCardHeightClass` 增加 DashScope 分支；`getPreviewImageHeightClass` 给 DashScope 同等 Seedance 的紧凑高度（h-40/h-28）。
2. `DashScopeCards.tsx` 新增 `CompactImageSlot`（w-20 h-14），KlingCard i2v/morph 和 ViduCard startend 都改用紧凑槽。
3. Kling 多镜头自定义列表加 `max-h-[160px] overflow-y-auto pr-1`，内部独立滚动。
4. Vidu/HappyHorse 的 `<details open>` 改为 `<section>`（始终可见，无折叠权）。
5. 新建 `new_html/utils/videoTaskInsert.ts::buildEmptyTaskGroup(model)` 纯函数 + 单测；VideoPage 加 `insertEmptyTaskGroup(idx)` useCallback + 在每对卡之间、列表顶部渲染 `InsertEmptyCardButton`。
6. VideoPage 空分镜占位 `<div>` 改为 `<label>` 包裹 hidden `<input type="file" accept="image/*">`，复用 `videoService.uploadImage` 走与 `handleFiles` 同一路径；成功后 `isPlaceholder=false`、填 `url`/`storageUrl`/`filename`，失败时 `uploadFailed=true` + toast。

**修复文件**（hotfix/api-config-hot-reload 同日 7 commits + 1 sync commit）
- `new_html/utils/videoCardLayout.ts`（commit `a76f7f5` + `3f1d32d` + `99b4070`）— 新增 DashScope 高度 class + 紧凑预览
- `new_html/utils/videoTaskInsert.ts`（new，commit `71fb933`）— `buildEmptyTaskGroup` 工厂
- `new_html/components/video/DashScopeCards.tsx`（commits `0150b26` + `b6a68ec` + `e8b7a83` + `2f278d8`）— CompactImageSlot + 多镜头滚动 + details→section + Vidu startend 紧凑化
- `new_html/components/VideoPage.tsx`（commits `39eebd1` + `6b1408d`）— InsertEmptyCardButton + handlePlaceholderUpload
- 全部 `deploy/new_html/` 镜像随 `sync_to_deploy.py` 自动同步（pre-commit hook 强制）

**双源镜像约束**（重要陷阱，§R 子陷阱 8）
- 项目用 `new_html/` 与 `deploy/new_html/` 双源，pre-commit hook 跑 `scripts/sync_to_deploy.py --check`，**漂移即拒绝 commit**。
- 任何对 `new_html/` 的改动必须**先**跑 `python scripts/sync_to_deploy.py --apply` 把镜像同步到 `deploy/new_html/`，**再** `git add` 主侧 + 镜像侧 + commit。漏掉 `--apply` 会触发 hook 拒绝；如已 commit 漂移则需要 `git reset --soft HEAD~1` → `--apply` → `git add` → `git commit -c ORIG_HEAD`。
- 千万**不要**用 `--no-verify` 绕过——hook 存在就是为了防止"main 改了但 deploy 没更新"导致生产偏移。

**预测的下一颗雷**（pre-claim-done §Z 第 10 条）
- `max-h-[640px]` 是经验值；若将来 Kling 模型再加新参数（如 reference camera motion / camera_movement / multi-aspect 等），可能溢出，需要重新评估 max-h 或把更多 section 改为内部 max-h 滚动。
- 多镜头自定义列表 `max-h-[160px]` 写死。若将来每段 prompt 由 `<textarea rows={2}>` 改为 `rows={3}` 或加更多控件（duration/prompt 改 grid），需要重新评估。
- 手工空卡的 group **没有 `storyboardItemId`**，下游若加"必须关联 storyboard_item 才能生成"的后端校验，本功能会失效——需要同时给手工空卡也生成 storyboard_item（或在后端放行 `storyboardItemId=undefined` 的 group）。已 grep 验证当前所有 `getStoryboardItemId(group.uuid)` 调用都用 `?` 链 handle undefined（VideoPage.tsx:2443），暂时安全。
- 空卡 placeholder image 的 `url=''` 在某些"必须有 url 才能 render"的下游分支可能崩。已 grep 验证渲染主路径用 `img1.isPlaceholder || !img1.url` 早返回到空卡 UI，绕过 `<img src=>` 节点。

**Lesson**
- **"只有 `min-h` 没有 `max-h`"在 `flex-col flex-1` 子树里 = 子内容能任意撑高**。父容器的 `overflow-y-auto` 在父没上限时是死的。这是个 chain regression：Seedance 卡片定 720px 没遇到这问题纯属"内容刚好够装"的偶然，DashScope 内容更多就翻车。**写新卡片高度时永远成对地写 `min-h` + `max-h`（或 `min-h` + 父容器有显式高度上限）。**
- **"参数都显示全" ≠ "用 details 默认展开"**。用户的"全显示"承诺是绝对的，details 给了用户折叠的权利就破坏了承诺。**用户用绝对量词（"全部" / "所有" / "都"）时，UI 不能给反向操作（折叠/隐藏）。**
- **字段语义优先复用**：`isPlaceholder` 早就存在但只在窄路径上有 UI（storyboard 同步生成的空 item）。新功能时**优先复用已有字段语义**而不是再造一个 `manuallyInserted` / `userCreated` 字段——保持字段单一语义。
- **大组件不写组件级单测，靠 helper 抽离 + TS build + 手动验证**：VideoPage.tsx 3000+ 行，testing-library 渲染成本极高。把可独立测试的逻辑抽成 `videoTaskInsert.ts::buildEmptyTaskGroup` 纯函数，组件层只做接线 → 通过 `npm run build` + 浏览器手动验证保证质量。这是合理的工程取舍。

**Hotfix（2026-05-25 当天用户验收时立即报告，commit `4d797c5`）**

主交付落地后第一次浏览器验收，立刻发现两个回归：
1. **空卡内部太高**：空卡走的是默认 `getCardHeightClass(group.model)` = `min-h-[420px]`（DashScope 模型甚至 `max-h-[640px]`），prompt `<textarea flex-1>` 撑满 + 占位预览 `h-40` + 复杂模型面板 → 单张空卡轻松 500-640px。**根因**：忘了"图都没传时 Seedance/DashScope 复杂参数面板没有意义"——空卡是新状态，但 cardHeight / 渲染分支都没为它分流。
2. **左右高度不一致**：左侧每对卡之间和列表顶部加了 `InsertEmptyCardButton`（`my-1 py-1.5` ≈ 28px），右侧没有同高度占位 → 第一行起就左右错位，累积放大。**根因**：忘了项目里**左右对齐是用对称 spacer 实现的硬约束**（link button 已有 `h-[18px] -mt-3 mb-2` 双侧 spacer 的先例），新增按钮时漏对称。

**Hotfix 做法**：
1. `renderStoryboardCard` / `renderResultCard` 双侧都加 `isPlaceholderCard = !!img1.isPlaceholder`，空卡时 cardHeight 切到 `min-h-[200px] max-h-[200px]`、`previewHeight='h-20'`、prompt 强制走简单 textarea 分支（不渲染 SeedancePanelWithCandidates / DashScopeVideoCard）。
2. 把 `InsertEmptyCardButton` 共享尺寸 token 提到 `INSERT_EMPTY_BTN_BASE_CLASSES`，新增结构 100% 一致的 `InsertEmptyCardSpacer`（`<button type="button" tabIndex={-1} aria-hidden pointer-events-none>` + 透明色）。右侧顶部 + 每对卡之间渲染 spacer，与左侧像素级对齐。

**Lesson（追加）**：
- **左右对齐用对称 spacer 是项目硬约束**：每次给左侧加新元素（间距、按钮、装饰），右侧必须同步加同结构的 spacer。link button 18px 已经是范例；新增 InsertEmptyCardButton 时没遵循，立刻翻车。**Future agents：grep `mb-2 relative pointer-events-none` 或 `spacer` 找现有范例，不要重新发明轮子。**
- **新增交互态时要枚举渲染分支的覆盖**：`isPlaceholderCard` 是新引入的状态，但 cardHeight / previewHeight / 模型分支的渲染逻辑都还用旧的"完整卡"假设。新增状态时必须沿 grep 走一遍：cardHeight ✓、previewHeight ✓、prompt 区分支 ✓、metaInfo ✓、result card 同步 ✓——挨个 audit。
- **用户验收第一时间报回归 = 这是低成本反馈，必须立刻 fix 且追加 faq lesson**。不要"等下一轮迭代再说"——同类回归在下一次新功能上必然再翻车。

**Hotfix #2（2026-05-25 用户反馈「带图卡还是太高」，commit `185e18f`）**

只修了 `isPlaceholderCard` 分支，**带图的正常卡**仍走旧逻辑：
- Seedance `min-h-[640px]` + prompt 区 `flex-1` → 面板内容很少时下方大片空白（截图：固定提示词 + 橙色警告后空 300px+）
- 普通 I2V `min-h-[420px]` + textarea `flex-1 min-h-[60px]` → 提示词框撑满剩余高度
- 预览图 h-52 (208px) / 结果卡 min-h-[460px] 进一步拉高

**Fix #2**：
1. 全部模型 cardHeight 改 `max-h + h-auto`（去掉 min-h 强撑）：普通 420 / Seedance+DashScope 480
2. 导出 `PROMPT_PANEL_MAX_HEIGHT_CLASS = max-h-[200px]`，Seedance/DashScope/普通 prompt 区统一封顶内部滚
3. 普通 textarea 改 `SIMPLE_PROMPT_TEXTAREA_CLASS`（h-20，去掉 flex-1）
4. 预览图统一 h-36，结果卡 idle/loading 改 h-36（去掉 min-h-[460px]）

**Lesson**：修 UI 高度 bug 时，**按状态枚举 audit 所有渲染分支**——placeholder ✓ 但 with-image ✗ 是典型 §A 误归因（以为修了 DashScope max-h 就全覆盖，实际 Seedance/普通 I2V 仍用 min-h + flex-1）。

**Hotfix #3（2026-05-25 用户反馈「左右不对齐、参数裁切、空镜排版乱」，commit `4d4b490`）**

Hotfix #2 用 `h-auto max-h` 仍不够——左右 DOM 结构不同（左有 Seedance 面板 / 右有 visual+只读 prompt），`h-auto` 各行高度仍不一致；右侧 prompt 用 `line-clamp-3 overflow-hidden` 裁切长文；空镜 200px 太矮导致 duration+upload+prompt 挤乱。

**Fix #3 — 固定高度 + 统一 flex 骨架**：
1. `getCardHeightClass(model, isPlaceholder)` 返回 **固定 `h-[Npx]`**（空镜 280 / 普通 380 / Seedance+DashScope 480），左/右必须调同一函数
2. 统一骨架：`header(shrink-0)` + `media(h-28 shrink-0)` + `body(flex-1 min-h-0 overflow-y-auto)`
3. textarea / Seedance / DashScope 参数全在 body 内滚，不溢出框外
4. 右侧只读 prompt 去掉 line-clamp，改 `overflow-y-auto whitespace-pre-wrap`
5. 空镜右侧 idle 显示「等待上传」占位，与左侧 dashed upload 区同高 h-28

**Lesson**：视频页双栏对齐的硬约束是 **同一 group 左右必须用同一 `getCardHeightClass()` + 相同 media 高度 + 相同 mb-4/spacer**；`h-auto` 永远不可靠。

---

## 2026-05-25 · MiniMax TTS 试听一直 loading / 任务卡 50 分钟

**症状**
- 配音页点试听 → 前端轮询 `/api/task/<id>` 200 OK 反复，最终 8min 超时
- 后端日志只有 `📤 MiniMax TTS 已入队`，**完全没有** `🎤 MiniMax TTS 任务启动`
- Redis `comfyui:task_queue` 堆积、`comfyui:processing` 空
- 修了「配置层」后又来一波 `FileNotFoundError: TTS 输出文件不存在: /storage/audio/tts_xxx.mp3`

**根因（按时间排序）**
1. **配置层**：`AGENT_ONLY_MODE=true` 默认让 `cluster_main.py` 跳过 Worker 启动，
   外部 API 任务（`minimax_tts` / `seedance_*` / `kling_*` / `vidu_*` / `dashscope_*`
   全家）全部死在 Redis 队列。临时修复：`export AGENT_ONLY_MODE=false` 后重启
   `cluster_main.py`。架构修复见 Follow-up A。
2. **代码层（§F 命名空间错乱 + §R 子陷阱 3）**：`tts_sync` 返回的 `audio_url`
   是 web URL（`/storage/audio/...`），但 `worker._process_minimax_tts_task` 把它
   当磁盘路径 `Path(...).exists()` → 永远 `FileNotFoundError` → retry 3 次全失败。
   修复：`tts_sync` 改成返回 `audio_url / local_path / audio_bytes` 三字段；
   worker 用 `audio_bytes` 直接入库，不再 `Path(url).exists()`。
3. **架构层（§R 子陷阱 4）**：试听场景走「handler 入队 → worker 拉队列 →
   MiniMax sync → 入库 → complete → 前端 fetch」5 个环节，任何一环卡都是
   几十秒到分钟级 loading。新增 `POST /api/minimax/tts/sync` fast-path 给 ≤1000
   字符的试听用，handler 内 1-3s 直接拿结果。

**修复文件（2026-05-25 同一天 commit）**
- `minimax_audio.py::tts_sync` — 返回值字段重命名，加显式 ClientTimeout + 1 次重试
- `worker.py::_process_minimax_tts_task` — 优先消费 `audio_bytes`，避开 web URL 误用
- `audio_provider.py::MinimaxAudioProvider.generate_speech` — 也切到 `tts_sync`
  （前序漏改的调用点，§R 子陷阱 2）
- `api_routes.py::minimax_tts_sync` — 新增 fast-path handler（commit `6b1800a`）
- `new_html/services/apiService.ts::minimaxTTSSync` — 前端 fast-path 客户端（commit `62163aa`）
- `new_html/components/audio/VoiceSidebar.tsx::handlePreview` — 切到 fast-path（commit `473492b`）
- `new_html/pages/AudioStagePage.tsx::runGenerate` — 注释保留 worker 路径理由（commit `533c3dc`）

**双轨架构**（试听 vs 批量）
| 场景 | endpoint | 路径 | 理由 |
|------|----------|------|------|
| VoiceSidebar 试听 | `POST /api/minimax/tts/sync` | handler 同步 | 1-3s 直接返回 |
| 单条对白手动生成 | `POST /api/minimax/tts/sync` 或 worker | 看体验偏好 | 短文本 sync 更直接 |
| 批量生成一集对白 | `POST /api/minimax/tts` | worker 异步 | 200 条 × 5s = 17min，必须异步 |
| 长文本（>1000 字） | `POST /api/minimax/tts` | worker 异步 | sync 接口会撞 autodl 反代 5min |

**预测的下一颗雷**（pre-claim-done §Z 第 10 条）
- `AGENT_ONLY_MODE` 默认值是个埋雷的部署开关，下次重新部署 / 换环境又会复发。
  Follow-up A：让 cluster_main 在 `AGENT_ONLY_MODE=true` 时也启动「精简 worker」
  只消费外部 API 任务，ComfyUI 任务仍交给 agent。
- 项目里其它 client（`dashscope_*` / `seedance_*` / `kling_*` / `vidu_*` /
  `happyhorse_*` 都用 aiohttp）同样**没显式 ClientTimeout**——批量调用偶发
  5min 卡死，等业务方踩到再修。Follow-up C：主动扫一轮加 timeout + 重试模板。
- `task_queue.fail_task(retry=True)` 对 `FileNotFoundError / KeyError / TypeError`
  这种代码 bug 也重试 3 次，30s 内连跑 3 次同样错放大调试噪音。Follow-up B：
  按异常类型分类，代码 bug 不重试。

**Lesson**
- 「同样症状的 sync 切换 bug」第二次出现就该按 recurring-pitfalls.md §A + §B
  回到 Phase 1 重新枚举所有调用点 —— 这次差点又在「sync vs async」之间反复
  误归因。三层根因（配置 + 代码 + 架构）必须**逐层验证**才能 claim done，
  修一层只能消一种症状。
- 「fast-path 解决一切」反模式：plan 一度想把 AudioStagePage 也切 sync，幸亏
  算了一下 200 条对白 × 5s = 17min 远超反代 idle 边界，及时收回。**按 payload
  长度选 sync/async**，不要因为「sync 写起来简单」就一刀切。

---

## 2026-05-25 · GPT Image 生产报 500「未配置 SORA2_GPT_IMAGE_API_KEY」但 admin 连通测试通过

**症状**：
- admin 后台 → API 配置 → "laozhang Sora2 分组 (天劫二阶 GPT Image 官方)" 卡片填了 key，
  点「测试」连接成功 (HTTP 200)；
- 但分镜页用 GPT Image 官方 (天劫二阶) 出图时，前端报错：
  `Error: GPT Image 生成失败：图像生成服务未配置 SORA2_GPT_IMAGE_API_KEY (laozhang Sora2Official 分组)，请管理员在后台填入 API Key`
- 后端日志：`POST /api/gpt-image/generate HTTP/1.1" 500 Internal Server Error`

**根因**：admin 卡片状态 = **禁用**（`enabled=False`），但 admin 没暴露 toggle 按钮让用户切到启用。

完整链路：
1. `cluster_main.py::seed_default_api_providers()` 创建 `laozhang-gpt-image` / `laozhang-sora2` 两个占位时**强制 `enabled=False`**（line 208）—— 让 admin 看到"需要填入 Key"的提示卡。
2. 用户填了 key 后保存（PUT /api/admin/api-configs/:id），DB 里 `api_key_encrypted` 写入了，**但 `enabled` 列没动**，仍然是 False。
3. 后端 `load_api_configs_to_env()` 启动时 + 每次 admin save 后跑，但内部用 `await ApiConfigDAO.list_enabled()` —— **只加载 `enabled=True` 的记录**，跳过这条。
4. `os.environ['SORA2_GPT_IMAGE_API_KEY']` 永远没设 → module-level `SORA2_GPT_IMAGE_API_KEY = os.environ.get(...)` 是 `None`。
5. `gpt_image_generate` endpoint line 1485 `if not api_key:` → raise 500。

**为什么连通测试 OK 是错觉**：
- admin 测试路径 `admin_test_api_config` (`admin_routes.py:668`) 直接 `await ApiConfigDAO.get_decrypted_key(config_id)` + `GET endpoint/models`，**不经过 `enabled` 过滤**，也不读 module var。
- 生产 endpoint 走 `os.environ` → module var → 必须 `enabled=True` 才会被加载。
- 这是 `recurring-pitfalls.md §U`「测试路径 ≠ 生产路径」的典型陷阱。

**修复**（commit `<待补>`）：
1. `admin/app.js` API 配置卡片 actions 区加「启用/禁用」toggle 按钮（之前只有 测试/编辑/删除 三个按钮，用户根本没法切 enabled）。
2. 加 `toggleApiConfig(id, nextEnabled)` 函数：调 `PUT /api/admin/api-configs/{id}` 传 `{ enabled: nextEnabled }`。
3. 后端 PUT endpoint 已经 `await _reload_api_env()` (line 571) → `load_api_configs_to_env()` 重跑 → `list_enabled()` 现在能看到这条 → `os.environ[SORA2_GPT_IMAGE_API_KEY]` 设上 → module var 立即更新 → endpoint 可用。
4. **改完不用重启服务**。

**手动 quick fix（如果还没拿到本次修复）**：
- 直接登 DB：`UPDATE api_configurations SET enabled = TRUE WHERE provider IN ('laozhang-gpt-image', 'laozhang-sora2');`
- 然后调 `POST /api/admin/api-configs/{any-config-id}` 任意 PUT 一下触发 `_reload_api_env()`，或重启服务。

**Files**: `admin/app.js`, `cluster_main.py:188-208` (seed 函数注释加强), `docs/faq.md`, `recurring-pitfalls.md §U`.

**Date**: 2026-05-25.

---

## 2026-05-24 · admin "API 配置" 页面把视频模型分到「文本/推理」分类

**症状**：admin 页面 → API 配置 → "飞升 (Seedance 2.0)" / "渡劫 (Seedance 2.0 Fast)"
等明明是视频生成模型，却被显示在「文本/推理」分类下。

**根因**：5 层数据流断链。
1. `admin_routes.py` PRESET_API_MODELS 字典写了 `"category": "video"` ✓
2. 但 `ApiConfigDAO.create()` 形参不接受 category ✗
3. `api_configurations` 表 schema 没有 category 列 ✗
4. 前端 admin/app.js `guessApiCategory(config)` 只读 `config.provider` 关键词推断 ✗
5. 用户那行 provider 字段是空 → 不匹配任何关键词 → 兜底 `return 'text'` →
   被渲染到 CATEGORY_META.text label = "文本 / 推理"

**修复**：
- `db_migration_api_config_category.sql` — 加 category 列 + 按 provider/model_name 反推回填存量
- `dao_api_config.py::create / update_by_id` — 透传 category
- `admin_routes.py::ApiConfigCreateBody/UpdateBody` — 接 category 字段
- `admin_routes.py::admin_import_preset_configs` — 把 preset['category'] 传给 create
- `admin/app.js::guessApiCategory` — 优先读 `config.category`；兜底兼容 kling/vidu/happyhorse + model_name 关键词
- `admin/index.html` + 表单 — 编辑/创建 API 配置加 category 下拉

**经验**：见 `recurring-pitfalls.md §S` ——「字典字段没写进 DB schema = 没存」。

---

## 2026-05-24 · MiniMax TTS 切回 sync /v1/t2a_v2（async 化没修对症的根因）

**症状**：worker 化 + 立即返回 task_id 后，前端仍报 `TTS 任务超时: <task_id>`。
后端日志显示 `tts_wait_and_download` 在 worker 内轮询满 600s 仍拿不到 Success。

**根因**：MiniMax 自家 `/v1/t2a_async_v2` 是把请求放进**他们的服务端队列**。
高峰期 / 限流期，单次 TTS 在他们队列里可以排队 30s ~ 5min+。我们之前的
worker 化只解决了"我方反代 idle timeout"，没解决"对方 queue 慢"。

**解法**：worker 内部从 3 步异步链路（`t2a_async_v2` + `query/t2a_async_query_v2`
轮询 + 下载）切回 1 步同步 `POST /v1/t2a_v2`：单次 HTTP，对方服务端立即处理，
HTTP 连接保持，5-15s 直接返回 hex 编码音频。文本上限 10000 字符，试听 / 配音
都远低于该上限。

**文件**：
- `minimax_audio.py` — 新增 `tts_sync()` 方法
- `worker.py:2244` — `_process_minimax_tts_task` 改 1 步
- 旧 `tts_async/tts_query/tts_wait_and_download` **保留**作 >3000 字长文本未来 fallback

**经验**：见 `recurring-pitfalls.md §R`——外部 API 选 async/sync 看**对方 queue
特性**，不是字面"async 听起来更现代"。我方 worker 异步化（吸收对方接口耗时）
本身没错，但底下用对方 sync 接口才不会被对方 queue 拖累。

---

## 2026-05-24 · MiniMax TTS 试听/配音一直 loading / `TTS 任务超时`

**Symptom**: 角色声音栏点试听、配音页点生成，按钮长时间 loading 后失败；后台 log:

```
api_routes - INFO - MiniMax TTS 任务已签发: task_id=401653470724288 ...
api_routes - ERROR - MiniMax TTS 超时: task_id=401652318130377 ...
```

签发和超时的 task_id 不同 — 因为多条任务 enqueue 在 handler 内排队等。

**Root Cause**: `POST /api/minimax/tts` handler 内 `await client.tts_wait_and_download(max_wait=300)`，
撞 autodl 反代 idle ~5min 边界 → 反代杀连接 → 前端 fetch hang。详见 recurring-pitfalls §Q。

**Fix (3-4 天工作量)**：
1. `worker.py`：新增 `_process_minimax_tts_task` + dispatch `elif task.task_type == 'minimax_tts'`
2. `api_routes.py`：`POST /api/minimax/tts` 改 `task_service.submit('minimax_tts', ...)`，立刻返回 task_id
3. `dao_character_voice.py`：新增 `update_sample_audio_url(voice_id, url)`，供 worker 回写
4. `new_html/services/apiService.ts`：`minimaxTTS` 返回 `{task_id}`；`handleResponse` 504 detail 平铺
5. `new_html/services/ttsTaskPoller.ts`（新）：薄轮询器
6. `new_html/components/audio/VoiceSidebar.tsx`：handlePreview 改 enqueue+poll，AbortController
7. `new_html/pages/AudioStagePage.tsx`：runGenerate 改 enqueue+poll，per-clip AbortController

**Files**: `worker.py`, `api_routes.py`, `dao_character_voice.py`, `new_html/services/apiService.ts`,
`new_html/services/ttsTaskPoller.ts`, `new_html/components/audio/VoiceSidebar.tsx`,
`new_html/pages/AudioStagePage.tsx`

**Lesson**:
- 长任务（>60s）一律 worker 卸载，handler 内只入队
- 504 detail 是 dict 时务必平铺到 Error 对象，否则前端拿不到 task_id 续轮询
- voicePreviewCache + character_voices.sample_audio_url 双层持久化策略验证 OK（无需变更）
- 上一轮 fix（status case + max_wait 120→300）只解决了"假超时"，没解决"真超时 + 反代撞墙"——
  pitfalls §A 警告的 mis-attribution

---

### Kling / Vidu / HappyHorse 三家视频模型接入 — DashScope 共享 API（Phase 1：后端）

**新增背景（2026-05-24）**：
用户要求在视频页新增三家阿里云百炼旗下视频模型作为新入口。读完 3 份官方 API 文档后发现：
**三家完全共享同一 endpoint + 同一 Key + 同一异步轮询机制**——这就是用户口中的"阿里共享 API"：

| 模型 | DashScope model_name | 首帧 | 首尾帧 | 多参考图 | 文生视频 | 备注 |
|---|---|---|---|---|---|---|
| Kling | `kling/kling-v3-video-generation`、`kling/kling-v3-omni-video-generation` | ✓ | ✓ | ✓ (omni, 1-7) | ✓ | std=720P / pro=1080P |
| Vidu | `vidu/viduq3-*_reference2video`、`vidu/viduq3-*_start-end2video` | — | ✓ | ✓ (1-7) | — | q3 时长 1-16s |
| HappyHorse | `happyhorse-1.0-r2v` | — | ✗ | ✓ (1-9, `[Image N]` 引用) | — | ratio 多达 9 档 |

**架构选择**（与 Wan2.6 工程师讨论 → 决定不破坏现有任务管道）：

不为每家新建 `/api/video/<provider>/submit` 路由，而是**复用现有 `POST /api/generate` 入口 + 扩 `task_type` 枚举**，因为：
1. `/api/generate` 已是统一提交入口（Pydantic `GenerateRequest` 覆盖了 image_path/media_inputs/duration/...），新增字段几乎不必要。
2. Worker 按 `task_type` 前缀路由（已有 wan26/seedance/sora2/veo 范式可抄）。
3. 任务状态查询、视频入库、entity binding、SQL 同步都走现有 `_save_external_video`，零分叉。
4. 前端轮询路径 `/api/task/{task_id}` 一份代码全 cover。

**新 task_type 命名（worker.py + cluster_main.py 同步注册）**：

| task_type | 模式 | 必填字段 |
|---|---|---|
| `kling_t2v` | Kling 文生视频 | prompt + aspect_ratio |
| `kling_i2v` | Kling 首帧生视频 | prompt + image_path |
| `kling_morph` | Kling 首尾帧 | prompt + image_path + image_path_end |
| `kling_refer` | Kling omni 多参考图 | prompt + media_inputs[image,...] |
| `vidu_r2v` | Vidu 参考生视频 | prompt + media_inputs[image,...] |
| `vidu_morph` | Vidu 首尾帧 | prompt + image_path + image_path_end |
| `happyhorse_r2v` | HappyHorse 多图（1-9） | prompt + media_inputs[image,...] |

**Phase 1 完成的文件**（h:/MY2 + deploy/ 同步镜像）：

1. **`dashscope_video_api.py`（新建）** — DashScope 视频生成共享异步客户端
   - aiohttp 异步（匹配 minimax_audio.py 范式），不阻塞 FastAPI event loop
   - `create_task / query_task / wait_for_completion` 通用
   - `kling_submit` / `vidu_reference_submit` / `vidu_startend_submit` / `happyhorse_submit` 各家 schema 适配
   - 状态码大小写不敏感（DashScope 用 PascalCase `SUCCEEDED/FAILED`，统一 `_normalize_status` 转 lower）
   - `extract_video_url(prefer_watermark=False)` 抽取（Kling 同时返回 `video_url` 和 `watermark_video_url`）
   - `get_dashscope_video_client()` 模块级单例，按需读最新 env（admin 改 Key 免重启）

2. **`worker.py`** — VIDEO_TASK_TYPES 扩 7 项 + 新 elif 分支 + `_process_dashscope_video_task` 统一处理函数
   - 派发逻辑：`task_type.startswith('kling_' | 'vidu_' | 'happyhorse_')` → 统一入口
   - `_file_id_to_dashscope_url()` helper：file_id → Base64 data URI（沿用 wan26 思路，绕过公网 URL 上传步骤）
   - 轮询 10s 间隔 / 600s 上限 / 实时进度更新 → Redis 任务队列
   - 完成后走 `_save_external_video(source='kling'|'vidu'|'happyhorse')`，自动入 entity binding + SQL 同步

3. **`cluster_main.py`** — `GenerateRequest.task_type` 描述扩展 + 任务统计 video_types 列表 + log type 映射表均补全 7 个新 task_type + `wan26_i2v` 历史漏项 + `seedance_*` 历史漏项（顺手修）

4. **`admin_routes.py` PRESET_API_MODELS** — 新增 3 条修真境界命名的 preset 入口：
   - `阿里云百炼共享 API · 合体 (Kling)` → `kling/kling-v3-video-generation`
   - `阿里云百炼共享 API · 大乘 (Vidu)` → `vidu/viduq3-turbo_reference2video`
   - `阿里云百炼共享 API · 炼虚 (HappyHorse)` → `happyhorse-1.0-r2v`
   - 全部 `provider='dashscope'` → 共享同一 `DASHSCOPE_API_KEY`（与 wan2.6 同 env）

5. **`admin/app.js`** — `guessApiCategory` 把 `seedance` 也归入 `video`；`usageHints` 改写 `dashscope` 提示文案为"阿里云百炼共享 API · 一份 Key 驱动 Wan2.6 + Kling + Vidu + HappyHorse"，新增 `seedance` 提示。

**用户填一份 `DASHSCOPE_API_KEY` 即可驱动 4 家视频模型** —— 这是本次接入的核心 UX 收益。

**修真境界命名规范（避免再次冲突）**：
> 既有 6 阶占用：练气(Wan2) / 筑基(Veo) / 金丹(MINI) / 化神(Sora2) / 飞升(Seedance2) / 渡劫(Seedance2Fast)。
> 本次新接入按"能力复合度"分配：**合体(Kling, omni 多 mode) / 大乘(Vidu, q3+q2 多版本) / 炼虚(HappyHorse, 多图参考)**。
> Phase 1 初版误把 Kling 也命名"化神"与 Sora2 冲突，Phase 2 已修正——任何后续新模型上线前必须先核对此表。

---

### Kling / Vidu / HappyHorse 三家视频模型接入 — DashScope 共享 API（Phase 2：前端）

**完成时间**：2026-05-24

**Phase 2 完成的文件**（h:/MY2 + deploy/ 已同步镜像；npm run build 已通过）：

1. **`new_html/services/videoService.ts`**
   - `VideoModel` union 新增 `'Kling' | 'Vidu' | 'HappyHorse'`
   - `DashScopeVideoModel` 类型 + `isDashScopeVideoModel()` 类型守卫
   - `getModelDisplayName` / `ALL_MODELS` / `EXTERNAL_API_MODELS` 同步扩展
   - `submitTask()` 新增三家"简化分支"（0/1/2 张图场景）
   - **新增 `submitDashScopeVideoTask()`** —— 专用多参考图入口（参考 `submitSeedanceTask` 范式）
   - `DashScopeVideoParams` / `KlingMode` / `KlingSubModel` / `ViduSubModel` 类型 + `inferDashScopeTaskType()`

2. **`new_html/types.ts`** — `TaskKind` 新增 `'vidu' | 'happyhorse'`（`'kling'` 已有）

3. **`new_html/components/video/DashScopeCards.tsx`（新建，1 文件 = 3 卡片 + 共享件）**
   - 共享外壳 `DashScopeCardShell`（按 theme 渲染色彩主题、徽章、头尾）
   - 公共子件 `ImageSlot`（单图槽）/ `MultiRefRow`（1-N 图横滑）
   - **`KlingCard`（蓝调 sky-blue）** —— 4 模式 toggle：T2V/I2V/Morph/Omni；mode (std/pro)、duration、aspect_ratio、audio、watermark、sub_model
   - **`ViduCard`（紫调 purple）** —— 2 模式 toggle：参考生 ↔ 首尾帧；sub_model (q3/q2 多版本，按模式分组)、resolution、duration、audio (仅 q3)、watermark
   - **`HappyHorseCard`（橙调 orange）** —— 1-9 张多图横滑；resolution、ratio (9 档)、duration、watermark；`[Image N]` 引用提示
   - 派发器 `DashScopeVideoCard`（按 params.model 派发到具体卡片）
   - 默认值工厂 `makeDefaultDashScopeParams()`

4. **`new_html/components/VideoPage.tsx`**
   - 新 state `dashScopeParamsByUuid`（与 `seedanceParamsByUuid` 平行）
   - helpers `getDashScopeParams` / `setDashScopeParams`（按 group 自动注入 linkedImages 作 reference_image，prompt 注入 imagePrompts）
   - `runTask()` 加 DashScope 早期分支：校验图数（Vidu/HappyHorse 至少 1 张）→ submitDashScopeVideoTask → startPolling
   - `startPolling()` kind 映射加 `kling` / `vidu` / `happyhorse`
   - **list view** 简版：sub_model 徽章 + 图数 + 单行 prompt（双向绑定到 `params.prompt`）
   - **card view** 完整：渲染 `<DashScopeVideoCard>`
   - **图片选择器 modal**（新增）：从 `uploadedImages` 选图，写 `file_id` → worker `_file_id_to_dashscope_url` 自动 Base64
   - `saveSession` / `loadSession` 持久化 `dashscope_params` 字段

5. **`new_html/components/NotificationPanel.tsx`** — `KIND_ICON` / `KIND_LABEL` 新增 vidu / happyhorse；label 显示"合体 · Kling / 大乘 · Vidu / 炼虚 · HappyHorse"

6. **`new_html/services/notificationMapping.ts`** — `inferKindFromCategoryAndTitle()` 加 vidu / happyhorse 正则推断（含 `happy[ -_]?horse` 多写法兼容）

7. **`new_html/utils/modelNames.ts`** — `videoModelNames` 加 kling/vidu/happyhorse 境界名

8. **`new_html/__tests__/services/notificationMapping.test.ts`** — 新增 4 个 kind 推断测试（kling/vidu/happyhorse + spaced 变体），全部 PASS

**核心 UX 决策**：

- **首尾帧 UI 复用**：Kling Morph + Vidu 首尾帧用统一布局（左右两个 ImageSlot），跟 Seedance `mode='first_last'` 同款；用户认知零迁移成本。
- **图片选择器**：modal 列已上传图缩略，点选即写 `file_id`（不是 url）—— 服务端 `_file_id_to_dashscope_url()` 转 Base64。这套设计避开了"为支持多图参考必须先把每张图上传到公网 OSS"的额外步骤。
- **list view 简化**：DashScope 三家在 list 模式只显示 sub_model 徽章 + 图数 + 单行 prompt，详情入口是切到 card view —— 跟 Seedance 在 list 用 `ListSeedanceRow` 一脉相承，避免把"丰富参数面板"硬塞进 80px 高的 list 行。
- **参数面板差异化**：Vidu q2 不支持 audio 已 UI 灰显；Vidu 首尾帧仅支持 turbo/pro sub_model（select 选项按模式分组）；HappyHorse 不提供首尾帧入口（API 不支持）。这些差异都在 card 内联校验，不会让用户填了错参数才被后端拒。

**经验教训（已写入 recurring-pitfalls.md §P 补充）**：
> 多 provider 共享 API 不仅是后端共享 client，**前端也应共享视觉外壳 + 媒体处理逻辑**，
> 让"主题色 + 标题 + 当前模式"这种边缘信息成为 theme prop，差异化只发生在"参数表单"。
> 否则 3 个独立 .tsx 文件会迅速 copy-drift，参数变更要改 3 处。
> 我们的做法：1 个 DashScopeCards.tsx 文件 = 3 个 Card 命名导出 + 共享 shell/子件。

---

### 配音页试听音频关 drawer 就丢——cache 放 useRef 仍然没躲开 §H 陷阱

**症状（2026-05-24 用户报告，复发）**：
- 生成系统音色测试语音 → 关侧边栏 → 重开同一角色 → 试听音频又消失。
- 用户原话："生成一次就永久保存，下次再点击对应的音色的时候，就直接使用别一直丢失了"。

**根因（recurring-pitfalls §H state-coupled-to-lifecycle）**：

上一版 fix 把试听 cache 放在 `const trialCacheRef = useRef<TrialCache | null>(...)`。
**ref 跟 component 同生命周期**——drawer 一关 component unmount，ref 内存就回收。
sample_audio_url 只在用户**显式点了"保存配置"**时才写 DB；如果用户只是想"听一下"，
关 drawer 时 cache 还没落地任何持久层 → 试听产物彻底丢失 → 下次重开必须再次付费生成。

这是 §H 的教科书案例：「Anything that needs to survive the page must live in
a module-level singleton OR sessionStorage/localStorage」。useRef **不算**。

**修复**：

1. 新建 `new_html/utils/voicePreviewCache.ts`（+ deploy 镜像，hash 一致）：
   - 模块级单例 `memory: Record<key, {voiceId, audioUrl, ts}>`，启动时从 localStorage 装载。
   - API：`getVoicePreview(key)` / `setVoicePreview(key, entry)` / `clearVoicePreview(key?)`。
   - Cache key 工厂：`makeSystemKey` / `makeDesignKey` / `makeCloneKey`，design 用 stableStringify(setting) 防 JSONB 键顺翻车。
   - LRU 上限 100 条（≈25KB），blob: URL 不入 cache（内存对象不能跨刷新）。

2. `VoiceSidebar.tsx`（+ deploy 镜像）：
   - 删除 `trialCacheRef` + `TrialCache` 类型，所有读写改用 `getVoicePreview` / `setVoicePreview`。
   - 新增 `useEffect([currentInputKey])`：用户切系统音色 / 改设计参数 / 切音源时，**自动查 cache**：
     - 命中 → `setPreviewUrl(entry.audioUrl)` + `setPreviewIsPersisted(true)`（立即还原）；
     - 未命中 → 清空 audio，提示用户重新试听。
   - mount 时把已有的 `role.voice.sampleAudioUrl` **反向写入** cache，模块成为真正的 single source of truth。
   - 试听完产物**立刻入 cache**——不需要等"保存配置"。"保存配置"只负责把 voice config 绑到角色，audio 复用与它正交。
   - UI 徽标从三态简化为二态：`已永久缓存` / `新生成`。

**用户视角**：
- 试听一次 → 此后任何时候、任何角色再选同一个系统音色、刷新页面、关浏览器再打开，都**立刻播放上次的音频，零 API 调用**。
- 设计音色：参数 + 文本完全一致就复用（stableStringify 保证 JSONB 键顺无关）。
- 克隆音色：同一 file_id 的克隆产物复用。

**Files**:
- `new_html/utils/voicePreviewCache.ts` (新增，deploy 镜像)
- `new_html/components/audio/VoiceSidebar.tsx` (deploy 镜像)
- `dist/` (deploy 镜像)

**Lessons (强化 §H)**：
- **"长寿命数据放 useRef" = §H 陷阱**：useRef 只是"跨 render 不变"，不是"跨 mount 不变"。drawer / modal / 抽屉式 UI 卸载频繁，所有需要跨开关存活的数据必须用 **module-level state + localStorage**，不能用 useRef。
- **持久化层不要绑死到"保存按钮"语义**：用户的心智模型里"试听产生的 audio 应该永久存"，跟"我有没有提交表单"无关。把缓存层和持久化层从业务"保存"动作里**解耦**——产生即存。
- **mount 时同步把外部 source of truth 反写进 cache 模块**：避免 cache miss 的初次 render 覆盖 useState 初始值。模块化 cache 成为唯一查询入口，组件不再关心数据来自 DB 还是 LS。

**Date**: 2026-05-24（同日二次修复）

---

### 配音页 drawer 试听音频被挤成"小白点" + 已保存试听仍重复付费生成

**症状（2026-05-24 用户报告）**：
- 截图：drawer 底部把「试听 / audio 控件 / 保存配置 / 删除」四元素挤在一行，audio controls 被压缩成一个看不见的"白点"，点不到。
- 用户反馈：「生成过的试听语音，并不能一直保存下来，下次还是要重新生成」。

**根因**：

1. **UI 拥挤（§VIII state-coupled-to-lifecycle 的近亲：layout-coupled-to-flexgrow）**：
   `flex-wrap items-center gap-3` 一行塞 4 个元素，audio 给的是 `flex-1 max-w-[200px]`。drawer 宽 384px，扣掉按钮/边距后 audio 实际空间 < 60px，浏览器默认 controls 在窄宽下退化成只剩一个圆点，用户根本看不出来是个 audio。

2. **真持久化 bug — JSONB 键顺不保留（§E multiple-sources-of-truth 的变种）**：
   PostgreSQL `JSONB` 文档明确："does not preserve the order of object keys"。
   - 写入：前端发 `{voice_type, emotion, speed, pitch}` → JSONB normalize 顺序。
   - 读取：返回的 dict 顺序可能变成 `{emotion, pitch, speed, voice_type}`。
   - 后果：`JSON.stringify(setting)` 在试听/重开两个时刻产生**不同字符串**，`trialCacheRef.key` 不命中 → 即便参数完全相同也触发新一次 `minimax_voice_design` 付费调用。
   - 用户的"保存不下来"实际是「后端文件已保存，前端比较时认为变了，重新生成」的**用户视角误判**——但浪费 API 费用是真的。

**修复（FE-only，BE 已经在上次 commit 持久化好了）**：

1. `new_html/components/audio/VoiceSidebar.tsx`（+ deploy 镜像，hash 一致）：
   - 新增 `stableStringify(obj)`：递归排序对象 key 输出，**所有内容指纹 key 必须用它**（不用 `JSON.stringify`）。
   - `trialCacheRef` 初始 key + `designKey()` 都改用 `stableStringify(setting)`。
   - footer 改两行布局：
     - 第一行：audio 卡片**全宽独立**（`w-full`），上方徽标三态：
       - 蓝紫渐变 + 「已保存 · 不重新生成」（previewIsPersisted）
       - indigo + 「新生成 · 保存后将永久缓存」（刚 API 生成）
       - amber + 「参数已变 · 请重新试听」（用户改了 setting 但 audio 还是旧的）
     - 第二行：`试听 / 保存配置(flex-1) / 删除` 三按钮，宽度自然分配。
   - audio 无 URL 时显示 dashed-border 提示卡片，引导用户操作。

2. 试听按钮文案动态：已加载持久化音频时变成「重新生成」，提示用户继续点会再次扣费。

**影响范围**：
- 持久化的试听音频从此**真的零重复生成**——只要 setting+text 不变（即便经过 drawer 关闭→重开→DB 往返）。
- UI 在 384px 宽度下也能完整显示 audio controls，可拖动进度条、调音量。

**Files**:
- `new_html/components/audio/VoiceSidebar.tsx` (deploy 镜像)
- `dist/` (deploy 镜像)

**Lessons (写入 §recurring-pitfalls)**：
- §E 新案例：**PostgreSQL JSONB 不保 key 顺**，凡用 `JSON.stringify` 给 JSONB 内容算指纹的全是隐性 bug。规则：**所有 JSONB 字段的内容指纹一律用 stableStringify**。
- §I 新案例：drawer / 抽屉 / 弹窗等**固定窄宽容器**里，禁止把 `<audio controls>` 和 ≥2 个按钮放同一 flex 行——浏览器原生控件在 < 120px 时会**静默退化为图标**，没有报错但完全不可用。规则：audio/video 控件**独占一行**或给最小宽度 ≥ 240px。

**Date**: 2026-05-24

---

### 配音页"设计音色"保存后绑的不是试听的那个 + drawer 重开试听音频/参数全丢

**症状（2026-05-24 用户报告）**：
- 在 VoiceSidebar 选「声音设计」→ 调参 → 点试听（听到音色 A）→ 点保存配置 → 生成对白发现是音色 B，"并没有绑到角色"。
- 关掉 drawer 再打开同一个角色 → 试听音频不见、设计参数和文本被重置为默认、克隆模式看不到上次的文件。

**根因（命中 §VIII state-coupled-to-lifecycle + §VII silent-failure + §IV implicit-contracts）**：

1. **试听 ≠ 保存的音色**：`handleSave` design 分支**第二次**调 `minimaxVoiceDesign(...)`。官方 `voice_design` 每次都返回新的 `voice_id`（除非客户端显式传 `voice_id`），所以：
   - 第 1 次 (handlePreview) → `voice_id_A` + trial_audio_A → 用户听到 A
   - 第 2 次 (handleSave) → `voice_id_B` ≠ A → DB 存的是 B
   - 用户**无法感知**这是两个不同的音色（silent failure）

2. **drawer 局部 state 没有从已保存数据还原**：`previewUrl` / `designSetting` / `designText` 都是 `useState` 默认值，drawer 一关 component 卸载就丢。`role.voice.sampleAudioUrl` 已经存了 URL，但 drawer open 时没用它初始化。clone 的 `file_id` 完全没存进 `voice_params`，UI 看不出"已配置过"。

3. **trial_audio 是 hex 不是 URL**：voice_design 返回 hex，前端转 blob URL 后只在内存里，保存到 `sample_audio_url` 的也是 blob URL，刷新页面就 404。voice_clone 的 `demo_audio` 是 MiniMax 临时 URL，会过期。

**修复（vertical slice，FE + BE 一起改）**：

1. **后端 `minimax_audio.py`**（+ deploy 镜像）：
   - `voice_design()` 在拿到 trial_audio hex 后自动写到 `AUDIO_UPLOAD_DIR/voice_design_xxx.mp3`，返回 `audio_url`（持久化）；
   - `voice_clone()` 在拿到 demo_audio URL 后自动下载到 `AUDIO_UPLOAD_DIR/voice_clone_xxx.mp3`，返回 `audio_url`；
   - 这样前端三种音源拿到的都是 `/storage/audio/xxx.mp3`，可以直接写 `sample_audio_url`，刷新不丢。

2. **前端 `VoiceSidebar.tsx`**（+ deploy 镜像）：
   - `trialCacheRef`: 缓存 `{ key, voiceId, audioUrl }`。试听产生的 voice_id 直接复用到 handleSave，**杜绝二次生成**。key 含输入哈希（design = setting+text；system = voice_id；clone = file_id），输入未变则**复用缓存不重新付费生成**。
   - drawer 打开时 `inferSource()` / `inferSystemVoiceId()` / `designSetting` / `designText` 全部从 `role?.voice` + `voice_params` 还原；`previewUrl` 用 `role.voice.sampleAudioUrl` 初始化。
   - clone 模式新增"已配置克隆音色：xxx.mp3 / 复用已克隆"绿色提示；用户不选新文件直接点保存就**复用已有 voice_id**（不再重复克隆）。
   - 统一 `voice_params` 结构：`{ source, voice_id|file_id|designed_voice_id, setting?, preview_text?, original_filename? }`。

3. **前端 `AudioStagePage.tsx`**（+ deploy 镜像）：
   - `runGenerate` 读 `voice.voiceParams.setting.emotion/speed/pitch`（design 的嵌套结构），兼容老数据 fallback 到 root。
   - `resolveMinimaxVoiceId` 已经能透传 `ttv-voice-xxx` / clone 自定义 id，无需改动。

**Files**：
- `minimax_audio.py` (`voice_design` / `voice_clone` 持久化分支)
- `new_html/components/audio/VoiceSidebar.tsx` (`VoiceDrawer` 全部 state 还原 + cache)
- `new_html/pages/AudioStagePage.tsx` (voiceParams.setting 嵌套兼容)
- + `deploy/` 三处镜像

**Lessons（高层）**：
- **第三方生成式 API：每一次调用都是新结果**。试听和保存必须共享同一次调用产物，否则注定不一致。
- **drawer / modal state 应该从持久化层"读一次"还原**，不能让 useState 默认值替代真实数据。React component lifecycle 不是持久化层。
- **数据库存的是 URL，不是 hex / blob URL**。后端最佳实践：拿到外链/二进制 → 落本地 → 给前端持久 URL。
- **三种音源 drawer 必须统一可重入**（system / clone / design），UI 否则会让用户怀疑"是不是没存上"。

---

### MiniMax 配音 API 契约与官方文档不一致（status 大小写导致假超时 + voice-design/clone 全错）

**症状（2026-05-24 对照官方 OpenAPI 审计）**：
- TTS 能拿到 `task_id` 但 120s/300s 后仍报 `TTS 任务超时` —— MiniMax 端可能早已 `success`。
- 音色设计 / 克隆分支从未按官方 schema 发请求（旧 payload 含 `model+text+voice_setting` / `voice_name+demo_text`）。
- `get_voice` / `delete_voice` 用了错误的 HTTP 方法与参数。

**根因（命中 §IV implicit-contracts + §F naming mismatch + §VII silent failure）**：

| 模块 | 我们原来 | 官方 `t2a_async_v2` / 其它 |
|------|---------|---------------------------|
| TTS 轮询 | `status == "Success"` | enum 为 `success/processing/failed/expired`（大小写不一致）→ **永远等不到 Success → 假超时** |
| TTS audio_setting | `sample_rate` | `audio_sample_rate` |
| TTS emotion | 传 `neutral` | 官方无 neutral，应省略或 `calm` |
| voice_design | `{model,text,voice_setting}` | `{prompt, preview_text}` → 返回 `trial_audio` hex |
| voice_clone | `{voice_name,demo_text}` 且 voice_id 可选 | `{file_id, voice_id}` 必填；试听字段名 `text` |
| get_voice | GET + voice_id query | POST `/v1/get_voice` + `{voice_type:"all"}` |
| delete_voice | DELETE | POST `/v1/delete_voice` + `{voice_type, voice_id}` |

**密钥**：admin 里 `provider=minimax`（MiniMax Hailuo）→ `MINIMAX_API_KEY`，**同时**驱动 Hailuo 视频 + 配音 TTS/voice-design/voice-clone，无需单独音频 key。endpoint 默认 `https://api.minimaxi.com/v1`。

**修复**：
1. `minimax_audio.py` — 大小写无关 status 判断；`audio_sample_rate`；emotion 映射；voice_design/clone/get/delete 全面对齐官方。
2. `api_routes.py` — Pydantic 改为 `{prompt, preview_text}` / `{file_id, voice_id?, demo_text?}`；新增 `GET /api/minimax/voices?voice_type=`。
3. `VoiceSidebar.tsx` + `apiService.ts` — 设计音色用 prompt 合成；解析 `trial_audio`；克隆传 `voice_id_prefix`。
4. 保留上轮 max_wait=300 + 504 结构化超时（长文本仍可能需要）。

**文件**：`minimax_audio.py`, `api_routes.py`, `new_html/services/apiService.ts`, `new_html/components/audio/VoiceSidebar.tsx` (+ deploy 镜像)

---

### MiniMax TTS 返回 500 "TTS 任务超时: <task_id>"（长任务塞短连接 + 默认 120s 不够）

**症状（2026-05-24 用户报告，task_id=401610178785806）**：
- 配音页生成单条/批量 TTS，浏览器看到 `Failed to load resource: 500 (Internal Server Error)` + 控制台 `minimaxTTS 返回错误 (500): TTS 任务超时: 401610178785806`。
- 后端日志：`MiniMax TTS 失败: TTS 任务超时: 401610178785806`。

**根因（命中 §VII silent-failure + §M async-context errors + §IV implicit-contracts）**：
- **主因（2026-05-24 二次审计）**：`tts_wait_and_download` 用 `status=="Success"` 判断完成，官方返回 `success`（小写）→ 任务其实已完成却被当成 processing 一直轮询直到超时。
- 次因：链路 `POST /api/minimax/tts` → `tts_async()` 拿到 task_id → `tts_wait_and_download` 在 HTTP 长连接内同步等；原 max_wait=120s 对长旁白偏紧。
- 后端把整个长任务塞进**一次 HTTP 长连接**同步等：超时即把 task_id "扔了"，但 MiniMax 端任务还在跑、5 分钟内仍可查询，**钱花了，结果丢了**。
- autodl 反代 idle timeout ~5 分钟，超过即便 max_wait 调更大也会被反代截断。

**修复（最小、向后兼容）**：
1. `minimax_audio.py` (+ `deploy/` 镜像) — `tts_wait_and_download` 默认 `max_wait=120→300, poll_interval=2.0→3.0`：覆盖 95% 长文本 case，3s 轮询减轻 MiniMax query API 压力。
2. `api_routes.py /api/minimax/tts` (+ `deploy/` 镜像) — 拆分 except：
   - `TimeoutError` 单独返回 **HTTP 504** + 结构化 detail `{error: "tts_timeout", task_id, message, hint}`，让前端能解析 task_id 做后续手段（手动 query / 续轮询 / 重试）；
   - 其它异常保持 500，日志附带 `task_id` 便于 MiniMax 端核对。
3. 任务签发时新增 INFO 日志 `MiniMax TTS 任务已签发: task_id=... voice_id=... text_len=...`，方便丢任务时定位。

**文件**：
- `minimax_audio.py:188-216` (+ `deploy/minimax_audio.py` 镜像)
- `api_routes.py:2165-2210` (+ `deploy/api_routes.py` 镜像)

**未做但记录在案**：
- 真正治本是**前端 fire-and-forget**：endpoint 直接返回 task_id，前端用 `globalTaskManager` + `/api/minimax/tts/{task_id}` 轮询，超时不再受 HTTP 长连接限制；并新增 `POST /api/minimax/tts/resume` 接已知 task_id 完成下载 + 入库，让 5 分钟内的任务能"捡回来"。
- 现状是 max_wait=300 + autodl 5 分钟反代 idle 之内的情况都能正常拿到结果；如果再次超时（任务真挂或 >5 分钟），按 §VII 把它当 silent-failure 看，task_id 在 detail 里仍可手动查询补救。

**lessons（高层）**：
- **长任务不能塞短连接**：默认值再大也只是延期问题。任何外部异步任务（MiniMax / Sora2 / ComfyUI / Veo）都该返回 task_id 让前端订阅，而不是 server 同步等。
- **超时一定要保留 task_id**：超时本身不可怕，task_id 丢了才让任务无法接续。`str(e)` 把 id 埋进文本是反模式，应该结构化透出。
- **TimeoutError 是 504 不是 500**：HTTP 状态码语义化让前端能区分"我得重试"和"我得改代码"。

---

### 分镜页点回旧 shot 时 prompt 卡在上一个 shot 的值（filledShotIdsRef 错误优化）

**症状（2026-05-24 用户报告）**：进入分镜页，点 shot1 → prompt 显示 shot1 正确；点 shot2 → 显示 shot2 正确；**再点回 shot1 → prompt 仍然显示 shot2 的值**（"都变成同一个第一个镜头的提示词了"，其实是"留在上一次切换时的值"）。刷新页面后 prompt 又对了；再切几次又错。后端 / 持久化数据完全正确，错的只是组件内 state。

**根因（命中 §VIII state-coupled-to-lifecycle + §IV implicit-contracts）**：`GenerationPage.tsx` line 102 的 `filledShotIdsRef = useRef<Set<string>>(new Set())` 是一个 "防止重复填充" 的过度优化：

```tsx
useEffect(() => {
  if (!selectedShotId || !selectedFile?.storyboard) return;
  if (filledShotIdsRef.current.has(selectedShotId)) {
    return;  // ← bug：第二次回到 shot1 时直接 return，不再 setPrompt(shot1.imagePrompt)
  }
  // ...
  filledShotIdsRef.current.add(selectedShotId);
  setPrompt(shot.imagePrompt || '');
  // ...
}, [selectedShotId]);
```

- `prompt` 是组件级 `useState`，不是按 shot 隔离的。
- 第一次点 shot1：Set 不含 shot1 → `setPrompt(shot1.imagePrompt)` + 标记。
- 切到 shot2：Set 不含 shot2 → `setPrompt(shot2.imagePrompt)` + 标记。
- **回到 shot1：Set 已经有 shot1 → effect 直接 return → prompt state 保持 shot2 的值。**

刷新后 Set 重置成空，"第一次切都对"——和用户描述完全吻合。

设计错误在于：作者想用这个 ref **同时**实现两件事——① 防止重复触发 fetch / 副作用，② 保护用户在 textarea 里未保存的编辑不被外部覆盖。结果是两件事都做坏：每次切 shot 都应该从 shot.imagePrompt 重新加载，而未保存编辑的保护已经由 onBlur → `onUpdateStoryboardItem(shotId, { imagePrompt })` 做了。

**修复**：删掉 `filledShotIdsRef` 整个 ref + 那一行 guard。effect 每次 `selectedShotId` 变化都从 `shot.imagePrompt / shot.configuredReferences` 重新加载。`userEditedPromptRef` 仍然保留，控制 onBlur 是否写回（用户没编辑过的不必触发写）。

**Files**: `new_html/components/GenerationPage.tsx`（line 99-122 区域）+ `deploy/new_html/components/GenerationPage.tsx`（sync_to_deploy 镜像）。

**Lesson**：
- 用 useRef + Set 做 "只跑一次" 的 guard，在切换型 state 上几乎总是错的——React 的 `useEffect` 依赖数组就是处理"只在依赖变化时跑"的标准方式，加额外 ref guard = 把"切换"语义偷偷阉割成"单次初始化"。
- "防止用户编辑被覆盖" 应该用**事件驱动**（onChange 写回 storage、切走时 onBlur flush），而不是**阻止 effect 同步外部状态**。两者职责混在一起就是这次的 bug 源头。
- 调试时优先记忆：**症状里有"刷新后第一次对、之后又错"几乎一定是组件级 state 跟外部数据脱节，要么 effect 缺依赖，要么 ref guard 把同步给挡了。**

---

### 配音页 TTS 静默走 Gemini 而不是 MiniMax（未绑定 voice 时 fallback 错路）

**症状（2026-05-24 用户报告）**：配音页点 "生成"，后台日志里看到调的是 Gemini TTS（`/api/audio/generate-speech`），但用户期望全部走 MiniMax（`/api/minimax/tts`）。

**根因（命中 §VII silent-failure-fallback + §IV implicit-contracts）**：`AudioStagePage.runGenerate` 是这样分发的：

```ts
if (voice?.voiceProvider === 'minimax' && voice.voiceModelId) {
  result = await minimaxTTS({...});
} else {
  result = await generateSpeech({...});  // ← Gemini 兜底
}
```

只有 `characterVoices` 行的 `voiceProvider == 'minimax'` **且** `voiceModelId` 非空，才走 MiniMax。任何一个不满足——比如：
- 角色没在 VoiceSidebar 显式选音色（缺 `voiceModelId`）
- 历史数据残留 Gemini 时代的 `voiceProvider='gemini-tts'`
- 残留 legacy persona 字符串（`'narrator' / 'male_young'` 等，不是 MiniMax 官方音色 id）

——就**静默 fallback** 到 Gemini TTS，用户毫无感知。本意是"双引擎兼容"，实际效果是用户被悄悄路由到错的引擎。

**修复**：删 Gemini fallback 分支，**全部走 MiniMax**。VoiceSidebar 已经在 `SYSTEM_VOICES` / `SYSTEM_VOICE_DEFAULT='presenter_male'` / `LEGACY_VOICE_ALIAS` 里给出过完整的音色映射，AudioStagePage 把同一份转译规则照搬：

```ts
const MINIMAX_DEFAULT_VOICE = 'presenter_male';
const LEGACY_VOICE_ALIAS: Record<string, string> = {
  narrator: 'presenter_male', male_young: 'male-qn-qingse',
  female_young: 'female-shaonv', elder: 'audiobook_male_2', child: 'cute_boy',
};
function resolveMinimaxVoiceId(modelId?: string | null): string {
  const raw = (modelId || '').trim();
  if (!raw) return MINIMAX_DEFAULT_VOICE;
  return LEGACY_VOICE_ALIAS[raw] || raw;
}
// ...
const minimaxVoiceId = resolveMinimaxVoiceId(voice?.voiceModelId);
const result = await minimaxTTS({ text, voice_id: minimaxVoiceId, ... });
```

taskRegistry kind 也从 `'gemini-tts' / 'minimax-tts'` 双值写死成 `'minimax-tts'`。

**Files**: `new_html/pages/AudioStagePage.tsx`（imports + `MINIMAX_DEFAULT_VOICE` / `LEGACY_VOICE_ALIAS` / `resolveMinimaxVoiceId` + `runGenerate` 内分支删除）+ `deploy/new_html/pages/AudioStagePage.tsx`。

**Lesson**：
- "双引擎条件 fallback" 模式高危：一旦 fallback 路径触发条件没显式告诉用户，用户就在不知道的情况下用了非预期引擎（生成质量、计费、密钥都不同）。要么强约束（缺 voice 直接报错让用户配置），要么强默认（按本次修复，全走主引擎 + 默认音色 + alias 转译）。
- 当一个组件（VoiceSidebar）已经维护了一份**完整**音色映射表，下游消费者（AudioStagePage）**不应该**用另一份贫瘠的逻辑分发——这是 §V multi-source-of-truth。共享映射应该提为 utils / 同目录 helper，两边 import 同一份。本次修复先把表复制了一份，下次应该把它提为公共 helper（TODO，登记 conventions.md）。

---

### admin 后台看不到新 provider 占位 + "Gemini 3 Pro (图像)" 仍显示旧名（项目无自动 SQL migration 机制）

**症状（2026-05-21 用户报告）**：把 GPT Image 2 系列的占位 SQL `db_migration_gpt_image_providers.sql` 写完、镜像到 `deploy/sql/` 后，重启后台进入 admin → 图像生成分组，**没有任何新卡片**；并且原有的 "Gemini 3 Pro (图像)" 卡片名字 / model_name 还是旧值（用户期望它跟着 nano3→nano2 升级一起改名）。

**根因（recurring-pitfalls §V "多重事实源" + §O "重启依赖"）**：
1. 项目的 `init_db_manager()` 只是 `await db.connect()`，**完全没有读 `db_migration_*.sql` 文件的机制**。我之前在 root + `deploy/sql/` + `deploy/` 三处写了同一份 SQL —— 只是"文档化哪条 INSERT 应该被执行过"，但没有任何启动钩子真的执行它们。这是项目长期遗留的隐式约定（DBA 手工跑），上次会话的我误以为"写了 SQL 就生效"。
2. "Gemini 3 Pro (图像)" 这张卡片是用户自己在 admin 后台创建的真实数据库行，`provider='gemini-image'`、`model_name='gemini-3-pro-image-preview'`、`name='Gemini 3 Pro (图像)'`。光改前端 nano3→nano2 路由 + admin `usageHints` 文案，并不会动用户的卡片字段；用户视觉上看到的还是旧名字 + 旧模型，会误以为整个升级没生效。

**修复**：把"占位入库 + 现存卡片就地升级"逻辑从 SQL 搬到 **cluster_main.py 的 lifespan Python seed**（`seed_default_api_providers()`），紧跟在 `init_db_manager()` 之后、`load_api_configs_to_env()` 之前自动跑：

1. **缺失 provider 占位 → 自动 create**：扫 `ApiConfigDAO.list_all()`，凡是 `provider in {'laozhang-gpt-image','laozhang-sora2'}` 不存在 → `ApiConfigDAO.create(api_key='', enabled=False)` 出一条 "需要填入 Key" 的占位卡片。
2. **化神 nano3→nano2 in-place 升级**：扫所有 `provider='gemini-image'` 的卡片，凡是 `model_name in {'gemini-3-pro-image-preview','gemini-3.0-pro-image','nanobanana'}` → `update(model_name='gemini-3.1-flash-image-preview')`，并把 `name` 里 `Gemini 3 Pro` / `Gemini 3.0 Pro` 字样替换成 `Gemini 3.1 Flash 化神2阶`。
3. **幂等保证**：每次启动都跑，但 `provider` 集合判等（不存在才 create）+ `model_name` 字面量判等（仍是旧值才 update）保证不重复操作。

SQL 文件 `db_migration_gpt_image_providers.sql` 不删，加 banner 说明它已退化为"容灾手工备份 / 脱机 bootstrap / 文档化记录"用途。

**Files**:
- `cluster_main.py`：新增 `_SEED_PROVIDERS` / `_GEMINI_IMAGE_LEGACY_MODELS` 常量 + `seed_default_api_providers()` + lifespan 调用
- `deploy/cluster_main.py`：sync_to_deploy 镜像
- `db_migration_gpt_image_providers.sql` + `deploy/sql/` + `deploy/`：banner 说明已退化为备份手段

**Lesson（项目级警示）**：
- 项目**没有任何**自动跑 `*.sql` migration 的钩子。任何"启动后必须存在的数据"必须走 lifespan 里的 Python seed，不能依赖 SQL 文件。
- 写完 admin / API key 相关迁移后，**必须看一眼 admin UI 是否真的多出了卡片**，否则就是 §G 静默失败。
- 用户已有数据的"就地升级"（rename / model_name update）必须显式做 `WHERE old_value` 守卫，不能盲目覆盖 — 否则会动到用户不想动的行（比如用户自己创建的多张同 provider 卡片）。

---

### 分镜页 GPT Image 2 系列接入（天劫一阶 / 天劫二阶）+ 化神 nano3→nano2 in-place 升级

**背景（2026-05-21 用户需求）**：分镜页(GenerationPage)接入两个 OpenAI 兼容图像模型：
- **天劫一阶** = `gpt-image-2-vip`（laozhang 默认分组 token）
- **天劫二阶** = `gpt-image-2`（laozhang Sora2Official 分组 token）

同时把"化神"模型从 nano3 (`gemini-3-pro-image-preview`) 升级到 nano2 (`gemini-3.1-flash-image-preview`)，保留前端 key `nanobanana`，**不破坏现有调用站**（in-place 替换）。

**契约要点（避免后续做错）**：
1. **令牌分组按 tier 路由**：laozhang 同一基址 `https://api.laozhang.ai/v1`，但 token 决定走哪条线；前端只暴露 `tier='vip'|'official'`，后端用 `GPT_IMAGE_API_KEY` / `SORA2_GPT_IMAGE_API_KEY` 分别调用，**不要混用**（混用会 403 / 模型不可用）。
2. **size 推荐表是单一事实源**：30 项 (10 ratio × 3 K) → 像素串映射写在 `new_html/utils/gptImageSizeMap.ts`，UI 只显示「比例 + 1K/2K/4K + auto」，service 内部用 `recommendGptImageSize()` 映射成 `"1024x1024"` 这类透传给后端。**绝对不要在 UI 直接选像素值** — 同一份映射只能存在一处。
3. **references 为空 → 文生图**(`/v1/images/generations` JSON)；非空 → **图改图**(`/v1/images/edits` multipart)。后端按 `request.references` 长度自动分发，前端不需要切两个入口。
4. **nano3 → nano2 in-place**：前端 `'nanobanana'` key 不变；`generateFinalIllustration` 内部已改用 `MODEL_IMAGE_NANO2`；后端 `/api/gemini/image` 加了模型别名表 `_model_alias`，旧 task 历史里残留的 `gemini-3-pro-image-preview` 仍能被路由到新模型（向后兼容）。
5. **化神也要参数 UI**：用户明确要求化神(nano2)前端**也暴露**比例 + 1K/2K/4K，不是只有天劫系列才有面板。两套面板共享 `<select>` 但走不同的 service（`generateFinalIllustration` vs `generateGptImage`）。
6. **天劫一阶不暴露 quality**（VIP 会自适应），**天劫二阶才暴露** quality(`auto/low/medium/high`)。前端用 `globalModel === 'gpt_image_official'` 条件渲染第三列。
7. **provider 占位由 SQL 迁移幂等插入**：`db_migration_gpt_image_providers.sql` 用 `WHERE NOT EXISTS` 按 provider 判重，重复执行不会插重复行；admin 后台直接看到两张 "需要填入 Key" 的空卡片，填好 key + enable 即可。

**Files**:
- 后端：`cluster_main.py`（PROVIDER_ENV_MAP / `/api/gpt-image/generate` / 三处 nano3→nano2）
- 前端 service：`new_html/services/gptImageService.ts`（新）+ `new_html/services/geminiService.ts`（化神升级 + 参数透传）
- 前端 utils：`new_html/utils/gptImageSizeMap.ts`（新，30+auto 项映射）+ `new_html/utils/modelNames.ts`（gpt_image_vip/official 别名）
- 前端页面：`new_html/components/GenerationPage.tsx`（按钮+2 + 化神/天劫一阶/天劫二阶参数面板 + 持久化 settings）
- 后台：`admin/app.js` + `admin/index.html`（usageHints + provider 选项）+ `db_migration_gpt_image_providers.sql`
- 测试：`new_html/__tests__/utils/gptImageSizeMap.test.ts`（13 项）+ `new_html/__tests__/services/gptImageService.test.ts`（10 项）— 全 23 项绿
- 镜像：上述每个文件均同步到 `deploy/` 镜像

**复盘（recurring-pitfalls 命中）**：
- §V 多重事实源：尺寸映射只在 `gptImageSizeMap.ts` 一处。✓
- §VI 命名样式：前端 key snake_case `gpt_image_vip`，后端模型 hyphen `gpt-image-2-vip`，由 `tier` 字段桥接。✓
- §IV 隐式契约：`generateGptImage` 用强类型 `tier: 'vip'|'official'` + 测试守住非法值抛错。✓
- §IX 顺序/TDZ：`imageRatio/imageK/imageQuality` state 声明在 `generateForShot` 之前。✓

---

### VideoPage 左卡 ✨ AI 改写按钮点不动（textarea zIndex:1 拦截 button click — 上一 bug 修复后浮现）

**症状（2026-05-21 用户报告）**：左卡右上角紫色 ✨ AI 改写按钮**视觉可见**但点击无反应；其它按钮（"+ 插入素材" / token chip 删除）正常。Console 无错误。

**根因（隐藏的旧 bug，被上一处 mask overlay 修复"曝光"）**：
`SeedanceMentionPromptEditor` 三层 stacking：
1. overlay div：`absolute inset-0` + `z-index: 0` + `pointer-events: none`
2. textarea：`relative` + **`zIndex: 1`** + `w-full`（`pr-8` 只影响内边距、不缩 click target box）
3. ✨ button：`absolute top-1.5 right-1.5` + **无 z-index**（默认 z-auto = 0）

stacking 顺序：overlay (z 0) < button (z-auto, doc order 后于 overlay 仍是 0 级) < **textarea (z 1) — 最高**。textarea bg-transparent + text-transparent → **视觉上**看穿到 button → 用户看到 ✨ 想点；但 **pointer-events 上** textarea 在 button 之上，吃掉所有点击。

为什么之前没暴露：在上一个 mask overlay 修复（overlay 由 `text-transparent` 改成 `text-slate-100`）之前，overlay 也是透明的 → 用户根本看不见 textarea 里的字 → 不会注意到 ✨ 在哪 → 不会去点。这次文字显示了，bug 才浮上来。**这是"修一个 bug 浮出另一个 bug"的典型链式回归**，要么测试覆盖薄、要么 stacking context 设计混乱。

**修复**：给 ✨ button 加 `z-10`（高于 textarea 的 zIndex:1）：
```tsx
className="absolute top-1.5 right-1.5 z-10 p-1 ..."
```
原则：在用 mask overlay 模式时，textarea 通常需要 zIndex:1 压在 overlay 之上；任何**绝对定位的辅助 UI**（按钮、徽章、icon）都必须**显式声明 z-index**，且大于 textarea 的 zIndex —— 不能依赖 z-auto + document order，因为只要 textarea 设了 zIndex:1 就会无差别拦截整宽的点击。

**Files**: `new_html/components/SeedanceMentionPromptEditor.tsx:303-313`、`deploy/new_html/components/SeedanceMentionPromptEditor.tsx`、`dist/`、`deploy/dist/`（rebuild → `index-BT1HJ42q.js`）。

---

### VideoPage 左卡视频提示词文字不可见（mask overlay 父级误设 text-transparent）

**症状（2026-05-21 用户报告）**：左侧编辑卡的「提示词」textarea 区域看不到任何中文字（光标位置可见，token 胶囊「图片N/视频N」有颜色照样可见），用户原话："字体颜色和背景一样了"。

**根因**：`new_html/components/SeedanceMentionPromptEditor.tsx` mask overlay 模式下，父 `<div>` 错误地继承了 `text-transparent`：
```tsx
<div className={... + 'bg-slate-800 border border-transparent text-transparent select-none' + ...}>
  {segments.map(seg => seg.type === 'token'
    ? <span className={TOKEN_KIND_CLASS[seg.kind]}>{seg.text}</span>  // ★ 自带 text-blue-200/purple-200/emerald-200，可见
    : <span>{seg.text}</span>                                           // ★ 无 text-color，继承父级 transparent → 不可见
  )}
</div>
```

mask overlay 模式的本意：textarea 自己 `text-transparent`、overlay div 渲染**可见**字 + 加 token 高亮。但开发时把 textarea 的"透明"语义错粘到了 overlay 上，导致 plain text 段全消失，只有 token 段（自带颜色覆盖）可见。

**修复**：overlay 的 `text-color` 必须与 textarea 互斥（任一时刻只一层显字），且方向跟 textarea 当前模式相反：
```tsx
className={
  `${SHARED_TEXT_CLS} absolute inset-0 m-0 rounded ` +
  'bg-slate-800 border border-transparent select-none ' +
  `${composing ? 'text-transparent' : 'text-slate-100'} ` +  // ★ 与 textarea 反向
  'overflow-hidden pointer-events-none'
}
```
- 非 composing：textarea 透明 → overlay 显字（用户看到的字其实是 overlay 渲染的，token 段被 TOKEN_KIND_CLASS 覆盖）
- composing 中（中文 IME 候选）：textarea 切 `text-slate-100` → overlay 切 `text-transparent`，避免叠出重影

**Files**: `new_html/components/SeedanceMentionPromptEditor.tsx:257-282`、`deploy/new_html/components/SeedanceMentionPromptEditor.tsx`、`dist/`、`deploy/dist/`（rebuild → `index-xwkucQ3e.js`）。
conventions.md 同步补强 mask overlay 反模式条目。

---

### VideoPage 视频页打不开：`Cannot access 'Ms' before initialization`（TDZ — useEffect deps 引用未声明的 useCallback）

**症状（2026-05-21）**：
```
index-0s4bNdiY.js:4399 Uncaught ReferenceError: Cannot access 'Ms' before initialization
    at Ij (...:4399:42639)  ← VideoPage 组件函数体
    at L0 (...:33:48846)    ← React renderWithHooks
    at sx ... JN ... TE ... Q5 ... bE ... zE ... MessagePort.P  ← React scheduler
```
访问 `workflow/video` 即触发，组件根本没机会挂到 DOM 上。

**根因（纯前端代码缺陷，跟 SSE/Redis 无关）**：
- `new_html/components/VideoPage.tsx` 在第 293 行写了：
  ```tsx
  useEffect(() => {
      for (const uuid of getKnownVideoTaskIds()) {
          attachVideoPollCallbacks(uuid, buildPollCallbacks(uuid)); // ★
      }
  }, [buildPollCallbacks]);  // ★★ deps 数组里引用 buildPollCallbacks
  ```
- 而 `buildPollCallbacks = useCallback(...)` 在第 1225 行才声明。
- JS `const` 是 **TDZ（Temporal Dead Zone）**：声明前禁止访问。
- 函数组件每次 render = 函数体从上到下执行。React 走到第 293 行时，传入的 deps 数组 `[buildPollCallbacks]` 立即被求值（数组字面量本身就是顺序求值表达式），此时 `const buildPollCallbacks` 尚未到达声明行 → `ReferenceError`。
- minified 后 `buildPollCallbacks` 被 mangled 成 `Ms`，所以错误显示 `Cannot access 'Ms' before initialization`。

这是 M2 改造（VideoPage 切页不断）引入的回归 —— 当时把 mount 时重新 attach 回调的 useEffect 直接加在文件上方"其它 mount useEffect 旁边"，没意识到后面的 `buildPollCallbacks` 是 const 而不是 function declaration（function 才会 hoist）。

**修复（2026-05-21）**：
把那个 `useEffect` 块整体下移到 `buildPollCallbacks = useCallback(...)` **之后**。原位置留一段注释指向新位置：
```typescript
// 原 line 293（只剩注释）：
// 注意：此 useEffect 必须放在 `buildPollCallbacks`（useCallback 声明在下方
// 1200+ 行）之后，否则 deps 数组 `[buildPollCallbacks]` 求值时该 const 还在
// TDZ，会抛 `Cannot access 'buildPollCallbacks' before initialization`。

// buildPollCallbacks 声明（line ~1225）后紧接：
useEffect(() => {
    for (const uuid of getKnownVideoTaskIds()) {
        const ok = attachVideoPollCallbacks(uuid, buildPollCallbacks(uuid));
        if (ok) { ... }
    }
}, [buildPollCallbacks]);
```

**反模式（写进 conventions.md 的"前端"节）**：
> ❌ **useEffect 的 deps 数组里引用一个尚未声明的 useCallback / useMemo / const 变量。**
> 函数体从上到下执行；deps 数组在 useEffect 调用瞬间就被求值，不是 React 记忆下来"以后"才求值。该 const 还在 TDZ 时立刻 `ReferenceError`。
> ✅ 解决：要么把 useCallback 提前到 useEffect 之前，要么把 useEffect 移到 useCallback 之后。

**关键决策**：
- 选"移 useEffect 而非提 useCallback"：useCallback 自身 deps 包含 `onAddNotification`，跟周边 `taskGroups / imagePrompts / sessionScope` 紧耦合，提前会让一长串 hooks 都得跟着改顺序。移 useEffect 是最小侵入。
- 同步问题：之前误把 `Ms` 报错当成 SSE 中断的次生症状去修后端。后端的 SSE/Redis pool 修复（独立 `pubsub_redis_client`）本身仍然成立 —— 那是另一个真实存在的问题（多 tab 打 redis pool 满），但**不是本错误的根因**。详见下一节。

**Files**: `new_html/components/VideoPage.tsx`、`deploy/new_html/components/VideoPage.tsx`、`dist/`、`deploy/dist/`（rebuild → `index-BG7vlit-.js`）。
**测试**：vitest 226/233 pass（7 个 pre-existing routing/EpisodeContext failure 与本修复无关）；最终验证靠用户访问 `workflow/video` 不再 ReferenceError。

---

### SSE：`/api/tasks/stream` 触发 Redis "Too many connections"（独立的后端问题，与上面的 `Ms` TDZ 无关）

**症状（2026-05-21 用户后端日志）**：
```
File "cluster_main.py", line 1930, in event_generator
  await pubsub.psubscribe("task_progress:*")
redis.exceptions.ConnectionError: Too many connections
```
浏览器侧表现：`GET /api/tasks/stream net::ERR_INCOMPLETE_CHUNKED_ENCODING 200 (OK)` 后铃铛收不到 SSE 推送，前端降级到轮询。

> **重要订正**：本次修复 **不能** 解决浏览器端的 `Cannot access 'Ms' before initialization`，那是 VideoPage 自身的 TDZ bug（见上一节）。SSE 修复只让通知系统在多 tab/重连场景下更健壮。

**根因（后端架构问题）**：
1. `task_event_stream` 中 `pubsub = redis_client.pubsub()` 用的是与全部业务接口共享的 `redis_client`，池上限 `RedisConfig.MAX_CONNECTIONS=50`。
2. **每个 SSE 客户端独占 1 个 pubsub 长连接**（pubsub 协议本身要求独占一条 connection，不归还）。多 tab 打开 + EventSource onerror 自动重连 + M1 上线后 WorkflowLayout 默认就建立 SSE → 池被 pubsub 长连接挤占完。
3. `pubsub()` 工厂调用是 lazy 的，真正抢连接发生在 `psubscribe()`。该调用在 `try:` **之前**，一旦抛 `ConnectionError`，`finally` 不会执行 → cleanup 永远不跑。
4. starlette `StreamingResponse` 在 generator 抛异常后会立即切流 → 浏览器层 `net::ERR_INCOMPLETE_CHUNKED_ENCODING`。

**修复（2026-05-21，cluster_main.py + deploy/cluster_main.py）**：
- **独立 pubsub Redis 客户端**：lifespan 启动时另建 `pubsub_redis_client = redis.Redis(..., max_connections=200, decode_responses=True)`，shutdown 时配套 close。
  - 隔离效果：① pubsub 池被打满只影响通知推送，业务 API 不受波及；② 池容量 200 vs 50，足以撑多 tab × 多用户的常态。
- **`event_generator` 重写**：把 `pubsub_redis_client.pubsub() / psubscribe / subscribe` 全部移入 `try`，加上：
  - `except redis.ConnectionError` 分支：日志 + `yield "event: error\ndata: {\"reason\":\"pubsub_unavailable\"}\n\n"` 让前端显式收到错误事件而不是看似无故断流；
  - `except (redis.ConnectionError, asyncio.CancelledError)` 包住内层 `pubsub.get_message()`；
  - `finally` 无条件 `punsubscribe / unsubscribe / close`，每步独立 try 防 cleanup 链上某一步抛异常拖累后续；
  - `pubsub = None` 哨兵确保未分配时 finally 不调用 None。
- **`yield "event: ready\ndata: {}\n\n"` 握手**：连接刚建立就推一帧，让前端 `onopen` 之外多一个早期信号。

**关键决策**：
- **未提高 `RedisConfig.MAX_CONNECTIONS`**：业务侧没必要因为 pubsub 长连接的特殊性而跟着膨胀；隔离比扩容更对症。
- **未改前端 SSE 重连 backoff**：现有 10s 重连已合理。

**Files**: `cluster_main.py:151-209,323-340,1928-2010`、`deploy/cluster_main.py`（同步）。

---

### 跨页：后台任务 + 通知系统改造（任务运行不再绑定页面 lifecycle）

**症状（2026-05-20 用户原话）**：
> "所有的页面，我运行生成的时候，是否可以切换页面等待生成后的通知，也就是可以同时执行任务，切任务不消失都在后台运行，执行完毕后，显示到页面，有通知，任务都可以放到后台。然后 ComfyUI 的任务比较独特，只要没有空的服务器，则需要排队。"
> "哪个页面正在执行任务，是不是需要有状态显示？另外，多个发送的任务，需要有个列表吧？"

**根因（架构问题，不是单点 bug）**：
1. **轮询绑组件**：VideoPage 的 polling interval 句柄保存在 `useRef`，组件 unmount（用户切到其它页面）时 cleanup 一律 `clearInterval` —— 切走后前端"看不见"任务，铃铛/Toast 不更新，必须回到该页才能重新拉。
2. **双通知系统平行**：`WorkspaceApp.taskNotifications`（内部 state）+ `TaskContext.notifications`（SSE）各跑各的，UI 各种地方接哪个都不一致；旧 `Header.tsx` 80 行重复写了一遍下拉面板。
3. **per-page 任务可见性为零**：用户想知道"哪个 nav 项有任务跑着"，但 `GlobalTask` 的 `sourcePage` 字段没被任何 UI 利用过。
4. **任务种类粗粒度**：`GlobalTask.category` 只有 `'comfyui' | 'gemini' | ...` 几种，铃铛展示时无法区分"图片融合"和"角度调整"。
5. **GenerationPage / DesignPage / AudioStagePage 完全没接入**：除了 VideoPage 自己写的轮询，其它页面的 ComfyUI 等待和 TTS 生成根本没注册到任务系统，铃铛永远只看到 SSE 推来的（只有部分任务有 SSE）。

**修复（2026-05-20，"后台任务 + 通知系统改造 L4 全档" plan，分 M0–M6 全部完成）**：

**M0 基础设施 — `services/taskRegistry.ts`（新文件 + 33 测试）**：模块级单例。提供 `register / update / complete / fail / cancel / remove`；`subscribe / onComplete / onFail` 监听器；`countActiveByPage / summaryByPage` per-page 汇总；`persist / rehydrate` 用 sessionStorage 缓存（刷新页面保留 transient 状态）。**唯一键 = backend taskId**；业务侧实体（如 `group.uuid`）通过 `targetEntityId` 关联。`RegisteredTask` 字段（types.ts）：`taskId/kind/title/status/progress 0-1/createdAt/startedAt/completedAt/targetPage/targetEntityType/targetEntityId/targetItemId/targetProjectId/episodeId/fileRole/error/resultUrls`。

**M1 统一通知中心**：
- `contexts/TaskContext.tsx`：以 `taskRegistry` 为单一信任源；SSE 推送（`globalTaskManager`）也归并到 registry；新增 `summaryByPage / activeCountByPage` 给 per-page 徽章；保留旧 API（`activeTasks / notifications`）兼容。
- `components/TaskBadge.tsx`（新）：导航项右上角小徽章 —— 蓝色脉冲（running） / 琥珀色（queued） + 数字。
- `components/NotificationPanel.tsx`（新）：顶栏铃铛下拉面板。三段：执行中 / 已完成 / 失败；点击跳转回执行页面（用 `targetPage + targetProjectId + episodeId` 拼 URL）；含相对时间和动画。
- `layouts/WorkflowLayout.tsx` + `components/Header.tsx`：旧/新两个布局都接入铃铛 + per-page 徽章；旧 Header 80 行重复通知 UI 替换成统一组件。

**M2 VideoPage 切页不断 — `services/videoTaskPoller.ts`（新文件 + 14 测试）**：模块级 polling map，独立于组件 lifecycle。API：`startVideoPoll(uuid, options) / detachVideoPollCallbacks(uuid) / attachVideoPollCallbacks(uuid, cb) / stopVideoPoll(uuid) / getKnownVideoTaskIds() / getVideoPollTaskId(uuid)`。VideoPage 改造：`startPolling` 完全切到 `startVideoPoll`；组件 unmount **不再 clearInterval**，只 detach 回调（任务继续后台跑）；重新 mount 时 `attachVideoPollCallbacks` 把 setState 回调重新挂回正在运行的 polling。后端 0-100 progress 自动 normalize 到 RegisteredTask 约定的 0-1 区间。

**M3 GenerationPage / DesignPage / AudioStagePage 接入**（+ 4 测试）：
- `services/geminiService.ts`：`waitForComfyUITask` / `waitForComfyUITaskAllImages` 加可选 `registryMeta: ComfyUITaskRegistryMeta` 参数（含 `title/kind/targetPage/targetEntityType/targetEntityId/targetItemId/targetProjectId/episodeId/fileRole`）；内部自动 register/update/complete/fail。9 个 `generateXxxQueued`（`Workflow / HumanMultiAngle / AroundAngle / AdjustImageAngle / Matting / ImageFusion / Panorama360 / PanoramaFusion / AutoStoryboard`）全部加 `registryMeta` 透传。修了 pre-existing setTimeout 不清理导致的 unhandled rejection。
- `GenerationPage.tsx`：组件内 `buildRegistryMeta(shot, kind, titlePrefix)` helper（11 处调用复用）；`kind` 分别用 `qwen-image / qwen-lora / kontext / angle-adjust / human-multi-angle / around-angle / matting / image-fusion / panorama-360 / panorama-fusion / auto-storyboard`。
- `DesignPage.tsx`：`adjustImageAngle` + `processMaterialImage` 两处 `waitForComfyUITask` 调用补 meta，`targetPage='design'`。
- `AudioStagePage.runGenerate`：在 try 入口 `taskRegistry.register({ taskId: 'tts:<itemId>:<type>', kind: 'minimax-tts'|'gemini-tts', ... })`；try 末尾 `complete()`；catch 内 `fail()`。

**M4 EnhancePage 假进度替换 + Canvas/PostProcess 复盘**：
- `pages/EnhancePage.tsx`：`applyEnhancement` 完全重写。`upscale` 路径调用 `videoService.submitUpscaleTaskQueued(filename, entityOptions)` 拿到 `task_id`，再走 `videoTaskPoller.startVideoPoll(uuid, { taskId, title, kind: 'video-upscale', targetPage: 'enhance', ... })` 接 taskRegistry 实时进度（顶栏铃铛 + Enhance nav 徽章自动可见）；mount 时扫 `getKnownVideoTaskIds()` 中以 `enhance-upscale:` 开头的，自动 `attachVideoPollCallbacks` —— 用户切走再回来仍能看到正在跑的进度并接到完成事件。`interpolate / lipSync / dub` 后端 worker 暂未启用，明确弹 alert 告知用户而非用假进度（去除"骗用户"的 UX 反模式）。
- `PostProcessPage / CanvasPage` 经 `Grep` 全文核查（无 `submitTask / generate*Queued / wait* / fetch /api/`），都不直接发起后台任务，只读已有数据；M1 的顶栏铃铛 + 徽章已经覆盖它们的"看到全局任务"需求，本轮无代码改动。

**M5 持久化任务列表 — 后端 dao_notification 打通前端**（+ 23 测试）：
- 后端原本就完备：`notifications` 表 + `dao_notification.NotificationDAO`（5 个 query）+ 5 个 REST API（`GET /api/notifications`、`unread-count`、`POST /:id/read`、`POST /read-all`、`DELETE /:id`）；`task_queue.complete_task` / `fail_task` 已自动写库。问题只是**前端没读历史**：刷新浏览器后铃铛永远空。
- `services/apiService.ts`：补上 `dismissNotification(id)` wrapper（DELETE 端点）。原本只有 `markNotificationRead / markAllNotificationsRead / getUnreadCount / getNotifications`。
- `services/notificationMapping.ts`（新文件，16 测试）：把后端 `ServerNotificationRow`（snake_case）反向映射到前端 `RegisteredTask`：`title` 剥掉 "已完成 / 失败" 后缀，`status` 由后缀推断（completed / failed），`kind` 由 `category + title` 关键词反推（`video → seedance/wan2/upscale...`，`text → auto-storyboard/prompt-rewrite`，`material → matting`，`image → qwen-image/kontext/...`），`target_page` 走 SourcePage 白名单（无效退到 `'global'`），`created_at` 用 `Date.parse` 转 ms（失败回 `Date.now()` 防 NaN 污染排序），`status='dismissed'` 整条丢弃。
- `services/taskRegistry.ts`：新增 `mergeFromServer(serverTasks)` 方法（+ 7 测试）。**关键合并规则：永不覆盖运行中的内存态**——内存里 isActive 直接 skip（SSE/轮询数据更鲜），内存没有 → set 为新条目，内存终态 + 后端终态 → 合并时间戳兜底但保留 existing 字段（避免反向覆盖）。返回 `{ added, skipped, updated }` 便于调试。仅在 `added > 0 || updated > 0` 时 emit `rehydrate` 事件 + persist。
- `contexts/TaskContext.tsx`：mount effect 在 `taskRegistry.rehydrate()`（sessionStorage）之后，立刻 `getNotifications(undefined, 50, 0)` 拉服务端最近 50 条，`mapNotificationsToTasks` 后调 `mergeFromServer`，再 `setRegisteredTasks(taskRegistry.list())` 强制 React re-render（registry 自己的 listener 已订阅，但首次合并的 batch 通过显式 setState 更稳）。`removeTask(taskId)` 现在会在 task 是终态时调 `apiDismissNotification(taskId)` 联动后端（task_id 与后端 notification.task_id 同键时直接命中；否则 catch 失败 — 不影响本地 UI，只是下次 mount 又拉回来）。
- 整条链路：用户提交任务 → 跑完 → task_queue.py 写库 → 浏览器关闭 → 重新打开 → mount → 自动拉历史 → 铃铛展示「最近完成」。失败的任务带 error 一并展示。dismiss 单条 / mark-all-read 都同步到后端。

**M6 ComfyUI 排队可视化 — 「排队中（前面 N 个）」**（+ 7 测试）：
- 业务真相：ComfyUI 排队是**纯前端**逻辑（`comfyuiTaskQueue` singleton，`maxConcurrent=4`），不是后端。所以"前面 N 个"实际就是 `queue` 数组里这条任务的索引。但旧实现里业务侧 register 到 taskRegistry 的时机是 wait 函数（已 dequeue + ComfyUI server 阶段），整个排队期 UI 完全看不到任务在等。
- 设计选择：避免分裂为两条 task（排队期一条 + 执行期另一条），改用 **frontendKey 作为单一 RegisteredTask.taskId**（comfyuiTaskQueue 内部的 `comfyui_<counter>_<ts>`）。排队期 register 成 'queued'，dequeue 时 update 为 'running'，wait 函数注入同一 frontendKey 后 register 走 update 路径（taskRegistry.register 已经"taskId 已存在视为 update"，幂等）。**单条 task 从「排队中（前面 2 个）」无闪烁过渡到「执行中 30%」**。
- `services/comfyuiTaskQueue.ts`：
  - `enqueue` 签名变为 `(taskFn: (frontendKey: string) => Promise<T>, taskName?, registryMeta?)`；taskFn 拿到的 frontendKey 就是 queue 内部 task.id。
  - 入队即 `taskRegistry.register({ taskId: frontendKey, status: 'queued', queuePosition: queue.length - 1 })`（仅当传入 registryMeta）。
  - 新增 `syncQueuePositions()`：扫描 queue 中带 registryMeta 的任务批量 update queuePosition，在 task_added / task_started 后调用 — 让铃铛上的"前面 N 个"实时刷新（A 跑完 → B 从 1 → 0、C 从 2 → 1）。
  - `_runTask` dequeue 入口：`update({ status: 'running', queuePosition: undefined, progress: 0 })`。
  - `_runTask` 完成路径加**条件 complete 兜底**（仅当 registry 里仍是 running/queued 才标 completed —— 避免覆盖 wait 函数已设的 resultUrls；videoService 里仅 submit 不 wait 的路径走这条）。
  - `_runTask` 失败路径加 `taskRegistry.fail` 兜底（submit 阶段抛错时 wait 没机会跑）。
  - `clearQueue` / 新增测试用 `_resetForTesting`：cancel 所有排队中的 task。
  - 新 export `ComfyQueueRegistryMeta` 接口（与 `ComfyUITaskRegistryMeta` 同形态但 targetPage 必需，便于队列侧使用）。
- `services/geminiService.ts`：
  - `ComfyUITaskRegistryMeta` 加 `frontendKey?: string` 字段。
  - 2 个 wait 函数（`waitForComfyUITask` / `waitForComfyUITaskAllImages`）：register 时**优先用 `registryMeta.frontendKey || taskId`** 作 RegisteredTask.taskId，且初始 register 时显式 `queuePosition: undefined` 清空排队期标记。后端轮询 API 仍用 backend taskId（不变）。
  - 新增 `toQueueMeta(m)` helper：把 ComfyUITaskRegistryMeta 转 ComfyQueueRegistryMeta（差异：targetPage fallback 'generation'）。
  - 9 个 `generateXxxQueued`（`Workflow / HumanMultiAngle / AroundAngle / AdjustImageAngle / Matting / ImageFusion / Panorama360 / PanoramaFusion / AutoStoryboard`）：enqueue 调用方式从 `enqueueComfyUITask(async () => ..., name)` 改为 `enqueueComfyUITask(async (frontendKey) => ..., name, toQueueMeta(registryMeta))`，并把 frontendKey 注入 wait 函数。
- `services/videoService.ts`：3 处 `enqueueComfyUITask(async () => submitXxx)` 仅做提交不 wait（等待由 VideoPage 的 `videoTaskPoller` 单独负责），不连 taskRegistry —— 仅把 callback 签名对齐为 `async (_frontendKey)`。
- UI 已经支持显示：`NotificationPanel.statusLabel` 早就写好 `'排队中 · 前面 N 个'` 文案；`TaskBadge` 通过 `summaryByPage[page].queued` 计数显示 amber 圆点 + 数字。M6 一行 UI 都没改，只让数据真的流动起来。

**Files**：
- `new_html/services/taskRegistry.ts`（新，M0）
- `new_html/services/videoTaskPoller.ts`（新，M2b）
- `new_html/services/geminiService.ts`（M3：`ComfyUITaskRegistryMeta` 接口 + 2 个 wait 函数 + 9 个 queued 函数透传 + setTimeout 清理）
- `new_html/contexts/TaskContext.tsx`（M1：以 registry 为单一信任源）
- `new_html/components/TaskBadge.tsx`（新，M1）
- `new_html/components/NotificationPanel.tsx`（新，M1）
- `new_html/components/Header.tsx`（M1：80 行重复通知 UI 删除，复用 NotificationPanel）
- `new_html/layouts/WorkflowLayout.tsx`（M1：顶栏铃铛 + 每个 nav 项 TaskBadge）
- `new_html/components/VideoPage.tsx`（M2：startPolling → startVideoPoll；unmount detach 不清；mount attach 回调）
- `new_html/components/GenerationPage.tsx`（M3：`buildRegistryMeta` + 11 处调用补 meta）
- `new_html/pages/DesignPage.tsx`（M3：2 处 wait 补 meta）
- `new_html/pages/AudioStagePage.tsx`（M3：runGenerate 注入 register/complete/fail）
- `new_html/types.ts`（M0：`SourcePage`/`TaskKind`/`RegisteredTask` 扩展）
- `new_html/__tests__/services/taskRegistry.test.ts`（33 测试）
- `new_html/__tests__/services/videoTaskPoller.test.ts`（14 测试）
- `new_html/__tests__/services/waitForComfyUITaskRegistry.test.ts`（4 测试）
- `new_html/pages/EnhancePage.tsx`（M4：`applyEnhancement` 真后端 + mount 自动重接 + 非 upscale 弹 alert）
- `new_html/services/notificationMapping.ts`（新，M5：dao_notification → RegisteredTask 映射）
- `new_html/services/taskRegistry.ts`（M5：`mergeFromServer` 不覆盖运行中任务）
- `new_html/services/apiService.ts`（M5：`dismissNotification` wrapper）
- `new_html/contexts/TaskContext.tsx`（M5：mount 时 `getNotifications` + `mergeFromServer`；`removeTask` 联动后端 dismiss）
- `new_html/__tests__/services/notificationMapping.test.ts`（16 测试）
- `new_html/__tests__/services/taskRegistry.test.ts`（mergeFromServer 7 新测试）
- `new_html/services/comfyuiTaskQueue.ts`（M6：enqueue 加 registryMeta + frontendKey 注入；queuePosition 实时同步；complete/fail 兜底；_resetForTesting）
- `new_html/services/geminiService.ts`（M6：ComfyUITaskRegistryMeta 加 frontendKey；2 个 wait 函数用 frontendKey 优先；9 个 queued 函数透传 toQueueMeta）
- `new_html/services/videoService.ts`（M6：3 处 enqueue 签名对齐）
- `new_html/__tests__/services/comfyuiTaskQueueRegistry.test.ts`（7 新测试，含 _resetForTesting 隔离 singleton）

**所有里程碑完成**：M0–M6 + M7（cleanup）+ Phase 8（SSE 元数据合并到 `RegisteredTask.metadata`）。

**Phase 8 SSE → metadata 富展示**（+ 10 测试）：
- 缺口：`globalTaskManager.handleSSEMessage` 收到的 SSE payload 含 `message`（阶段名）、未来可扩展 `step / total_steps / eta_seconds / worker_node_id / model_name` 等富字段，但旧代码只取 `progress` 一个字段，铃铛上看不到「正在生成第 30/50 帧」「@gpu-1 节点」等运行时上下文。
- `types.ts`：`RegisteredTask` 加 `metadata?: Record<string, unknown>` 字段（不强约束 schema —— 后端日后加新字段前端不需改类型）。
- `services/taskRegistry.ts`：`update` 检测 `updates.metadata !== undefined` → **浅合并**而非覆盖（`{ ...existing.metadata, ...updates.metadata }`），避免 progress 推送时把之前累积的 stage/eta 等 key 冲掉。新增便捷方法 `updateMetadata(taskId, partial)`。深合并不必要（嵌套对象用例几乎没有），传 `metadata: undefined` 视为不改、传 `metadata: {}` 也保留 existing。
- `services/globalTaskManager.ts`：`TaskEventCallback` 的 `data` 加 `raw?: Record<string, unknown>` —— `'progress'` 事件 emit 时把整个原始 SSE payload 作为 `raw` 透传，让 TaskContext 按需 cherry-pick 字段（耦合零增加，schema 变动只动一处）。
- `contexts/TaskContext.tsx`：`'progress'` handler 从 `data.message` + `data.raw.{stage,step,total_steps,eta_seconds,worker_node_id,model_name}` 提取写入 `metadata`。snake_case → camelCase 在此层做（UI 只读 camelCase）。
- `services/notificationMapping.ts`：后端 `dao_notification.metadata`（jsonb）直接透传到 `RegisteredTask.metadata` —— 类型校验：仅当为 plain object（不是 null / array）才接受。
- `components/NotificationPanel.tsx`：在 `TaskItem` 内 progress bar 下方加 metadata 富展示行：「`<stage>` · `<step>/<totalSteps>` 步 · 剩 `<eta>s` · @`<workerNodeId>`」，所有字段都是 optional（缺则不渲染对应片段）。
- 整体设计原则：metadata 是 **UI-only 富信息载体**，不进入业务逻辑判定（kind / status / progress 仍是单独字段）。`taskRegistry.persist()` 序列化时一并存入 sessionStorage，刷新后保留。
- Files: `new_html/types.ts`、`new_html/services/taskRegistry.ts`、`new_html/services/globalTaskManager.ts`、`new_html/contexts/TaskContext.tsx`、`new_html/services/notificationMapping.ts`、`new_html/components/NotificationPanel.tsx`、`new_html/__tests__/services/taskRegistry.test.ts`（+6 浅合并测试，含 rehydrate 持久化）、`new_html/__tests__/services/notificationMapping.test.ts`（+4 透传/边界测试）。

**Anti-Pattern 提醒**：见 `docs/conventions.md` 新增条目"polling 不能绑组件 lifecycle"+"全局任务必须有单一 registry"。

---

### 跨页：3 个新问题（@ token 视觉标识 / 取消分镜导出图片限制 / 页面状态持久化）

**症状**：
1. textarea 里 `@` 形成的 `图片1` / `视频1` / `音频1` token 是普通白字，与正文混在一起，用户无法一眼区分（截图里几乎认不出 token）。
2. 分镜画面页（GenerationPage）导出到视频生成时，弹 alert "没有可导出的分镜图片。请确保：1. 至少生成了一张图片 2. 已选择需要使用的图片"——用户希望即使没图片也能把空分镜（剧本/对白/时长）带进视频页继续编辑。
3. 切换到其它页面再回来 / 刷新页面后，前端临时状态（用户选中的镜头、modeling 偏好、视图模式、对白草稿覆盖等）会丢失；用户希望这些"未入库 transient state"也能持久化。

**根因**：
1. textarea 是 plain-text 输入框，DOM 不能在内部渲染 colored span。需要 mask overlay 模式：textarea 文字透明 + 同位置覆盖一个 div，div 用同字体、同 line-height、同 padding 渲染高亮版本，pointer-events:none 让事件穿透到 textarea。
2. `GenerationPage.handleExportNext` 老逻辑两层硬性过滤：第一层 `filter(item => item.generatedImages?.length > 0)`，第二层 `filter(item => !!item.finalImage)`。视频页 `handleImportAll` 早就支持空分镜（占位卡 + isPlaceholder 标记），所以分镜导出端的硬过滤是多余的。
3. 各页面的 transient state 都用普通 `useState`：刷新即丢；切页（unmount）即丢。已入库部分（DB 持久化的 `imagePrompt`/`audioUrl`/`taskGroups` 等）通过 EpisodeContext / WorkspaceSession 重拉无影响，但**未入库**部分（用户选中的镜头、对白覆盖草稿、视图模式、模型选择）无任何持久化机制。

**修复（2026-05-20）**：
1. **mask overlay**：新增 `utils/promptHighlight.ts.splitPromptSegments()`（把 prompt 切成 `text` + `token{kind, n}` 段，joining segments 必须复原原串）。`SeedanceMentionPromptEditor.tsx` 顶部容器加 overlay div：textarea 设 `text-transparent caret-slate-100`（IME composing 时短暂改回 `text-slate-100` 以保留候选词显示），overlay 渲染高亮 token（蓝/紫/绿胶囊背景对应 image/video/audio）；`onScroll` 同步 overlay scrollTop/scrollLeft；末尾 `\n` 时加 ZWSP 占位行避免最后一行不可见。textarea 与 overlay 共享 `SHARED_TEXT_CLS`（同 px-2 py-1.5 pr-8 + text-xs leading-5 + whitespace-pre-wrap break-words）确保字符位置完全一致。
2. **取消图片限制**：`GenerationPage.handleExportNext` 删掉两层硬过滤，未勾选时 `[...selectedFile.storyboard.items]` 全量导出（含无图占位项），`finalImage` 允许 null；alert 文案改为"还没有分镜数据"（仅在 storyboard.items 为空时触发）。
3. **页面状态持久化**：新增 `hooks/usePersistedPageState.ts` —— 类似 `useState` 但按 episodeId scope 持久化到 sessionStorage（key `h-my2:page-state:v1:<page>:<episodeId|global>`）。`version` bump 时旧 key 自然失效；切换 episodeId 时自动从新 key 加载。接入：
   - `AudioStagePage`：`localOverrides`（用户的对白/speaker/情绪覆盖草稿）。
   - `GenerationPage`：`selectedShotId`（当前关注的镜头）、`globalModel`（全局模型）、`shotModels`（每镜头模型）、`sidebarWidth`（侧栏宽度，全局非剧集 scope）。
   - `VideoPage`：`viewMode`（card/list）、`globalModel`（视频模型）。
   - `DesignPage`：`tab`（人物/场景/道具分类）。
   - 不持久化的：modal 开关、loading flags、batchProgress、playingKey、generating Set、lightbox URL（运行时态，刷新清空合理）。

**Files**：
- `new_html/utils/promptHighlight.ts`（新模块 + 10 测试）
- `new_html/components/SeedanceMentionPromptEditor.tsx`（mask overlay + IME composing 切换）
- `new_html/components/GenerationPage.tsx`（导出过滤简化 + globalModel/shotModels/sidebarWidth/selectedShotId 持久化）
- `new_html/hooks/usePersistedPageState.ts`（新模块 + 12 测试）
- `new_html/pages/AudioStagePage.tsx`（localOverrides 持久化）
- `new_html/pages/DesignPage.tsx`（tab 持久化）
- `new_html/components/VideoPage.tsx`（viewMode/globalModel 持久化）

**Anti-Pattern 提醒**：见 `docs/conventions.md` 新增条目"Mask overlay for rich textarea"+"Transient state must be persisted scoped"。

---

### 视频页 + 配音页：4 个新问题（caret @ / AI 改写 / 时长链路 / 音频持久化）

**症状**：
1. `@` 仍然把 token 拼到 prompt 末尾，光标位置无效。
2. 视频提示词没有 AI 一键改写功能，无法快速调风格。
3. 视频页时长仍是 5s——剧本页 2s、配音页 3s 都同步不过来；用户希望旧业务数据能从分镜脚本「重新导入到新格式」。
4. 配音页生成的语音刷新页面就丢失，DB 里 dialogue_audio_url 实际为 NULL。

**根因**：
1. `insertMention(value, candidate)` 老签名只支持 append，不接受 caret 位置。
2. 没有 AI 改写组件，且 3 个文字模型 service（geminiProxyTextService / geminiService / deepseekService）签名各异，未做统一适配层。
3. `WorkspaceApp.tsx` 老 `parseDurationToMs` 解析失败时返回 `null`，DB 里 `planned_duration_ms` 列就是 NULL。`VideoPage.getSeedanceParams` fallback 看不到 `meta.plannedDurationMs`，最终用 `5` 兜底。已写入 DB 的旧分镜数据没有迁移路径。
4. `AudioStagePage.runGenerate` 的 `try { await apiUpdateStoryboardItem(...) } catch { /* persist best-effort */ }`——catch 块完全静默，DB 写失败时用户仍看到生成成功（`localAudio` state），刷新后丢失。

**修复（2026-05-20）**：
1. `insertMention` 新增 `opts?: { atPos, caretPos }` 参数：未传时保持 legacy append（modal「+ 插入素材」用），popover 选 candidate 时 Editor 记录的 `atPos`+ 当前光标 `caretPos` 替换 `[atPos, caretPos)` 为 token，并按需补尾随空格；`handleInput` 同时实时更新 `search` 跟 `atPos` 之间的输入文本，光标移到 token 之后。
2. 新增 `services/promptRewriter.ts`（统一签名 `rewritePrompt({originalPrompt, instruction, backend})`，3 个 backend 选 1）+ `components/AIRewritePromptModal.tsx`（5 个改写预设 + 自定义；后端下拉），SeedanceMentionPromptEditor 右上角加 ✨ 按钮触发。
3. 新增 `utils/durationMapping.ts.estimateDurationMs({ durationStr, dialogueText })`：先 parseDurationString，失败按 4 字/秒估算（区间 2-8s），永远返回 ≥2000ms。`WorkspaceApp.tsx` 导出剧本时用它替代 parseDurationToMs；`VideoGenPage.handleImportAll` 检测旧分镜 `planned_duration_ms` 为 NULL 时前端估算后**主动 PUT 回 storyboard_items**（旧数据迁移），下次刷新永久同步。`VideoPage` fallback 由 5s 改为 3s。
4. `AudioStagePage.runGenerate` catch 不再静默——`console.error` + `errors[key] = '已生成但保存失败：…（请点击重新生成）'`；成功后 `await loadSlices('storyboardItems')` 强制从 DB 重拉，保证 EpisodeContext 与 DB 一致。

**Files**：
- `new_html/utils/seedanceMedia.ts`（caret-mode insertMention + 5 测试）
- `new_html/components/SeedanceMentionPromptEditor.tsx`（atPos state + 实时 search + 光标位移）
- `new_html/components/AIRewritePromptModal.tsx`（新组件）
- `new_html/services/promptRewriter.ts`（新模块，统一 3 个文字模型）
- `new_html/utils/durationMapping.ts`（estimateDurationMs + 17 测试）
- `new_html/WorkspaceApp.tsx`（export 改用 estimateDurationMs）
- `new_html/pages/VideoGenPage.tsx`（旧数据迁移 + apiUpdateStoryboardItem 回填）
- `new_html/components/VideoPage.tsx`（fallback 5→3）
- `new_html/pages/AudioStagePage.tsx`（catch 不静默 + reload storyboardItems）

---

### 视频页：列表/卡片 5 大可用性问题（一次性修复）

**症状**：
1. 列表视图左右两列卡片高度/列宽不齐，越往后错位越严重。
2. 卡片视图左侧卡片缺少分镜编号（无法对应剧本/分镜页的 #1、#2）。
3. 「插入素材」找不到剧本/配音页生成的分镜音频；候选 audio 分组里也没有项目级 BGM/角色配音。
4. @ 插入的 `图片1`/`视频1`/`音频1` 是裸文字，不能点击预览也不能 hover 看大图。
5. 卡片不能拖拽换顺序（之前修「分镜顺序倒了」时强制按 sort_order 排，把拖拽吃掉了）。

**根因**：
1. 右侧 `renderListResultCard` 用 `p-3` 没设 `h-16`，列宽 `w-20`；左侧用 `px-3 h-16` + `w-24`。
2. `renderStoryboardCard` Header 里只有拖拽图标 + I2V 徽章 + 模型选择，没有 SB-N 编号。
3. `useSeedanceCandidates` 只把 `materialLibrary.audio` 喂给 builder，从来没接入 `EpisodeContext.characterVoices` / `EpisodeContext.audioTracks`；同时 `VideoGenPage` 只 loadSlices `storyboardItems`，audio_tracks/character_voices 没加载到 context。
4. `SeedanceMentionPromptEditor` 用纯 `<textarea>` 渲染，token 是普通字符序列，无法挂 React 事件。
5. `VideoPage.sortedTaskGroups` 二次按 `linkedImg.sortOrder` 排序，覆盖了 `setTaskGroups` 改的数组顺序。

**修复（2026-05-20）**：
1. 右侧行 → `px-3 h-16` + `w-24`，与左侧严格对齐。
2. 卡片头新增 `SB-{sortOrder+1}` 徽章（无 sortOrder 时退化为 `#{index+1}`）。
3. 扩展 `CandidateBuildContext` 增 `characterVoices` + `audioTracks` 字段；`useSeedanceCandidates` 从 `EpisodeContext` 透传；`buildCandidates` 新增 § 4b（角色配音 `cv_${voiceId}`）+ § 4c（项目音轨 `track_${trackId}`）；`VideoGenPage.loadSlices('storyboardItems', 'audioTracks', 'characterVoices', 'assets')`。同时 `handleImportAll` / `getSeedanceParams` 自动按 `mixed > dialogue > narration > sfx` 优先级注入第一个非空的 `reference_audio`。
4. 新组件 `SeedanceMentionTokensRow`：textarea 不动，下方渲染胶囊行（缩略图 + 标签 + X），hover 弹大图、点击触发外层 `onPreviewMedia(url, kind)`，VideoPage 把它桥接到 `setLightboxUrl`/`setLightboxType`（audio 改为 `window.open` 新标签）。
5. `sortedTaskGroups` 删去二次排序，仅保留数组顺序；`handleDragDrop` 末尾 `setTimeout(() => saveSession(), 100)` 让拖拽落盘到 `WorkspaceSession.task_groups`。

**Files**：
- `new_html/components/VideoPage.tsx`（行对齐 + SB-N + 拖拽 + onPreviewMedia 桥接 + 自动 audio 注入）
- `new_html/components/SeedanceMentionTokensRow.tsx`（新组件 + 5 个测试）
- `new_html/components/SeedanceMentionPromptEditor.tsx`（接入 tokens row）
- `new_html/components/SeedanceMultimodalPanel.tsx`（透传 onPreviewMedia）
- `new_html/components/video/VideoCard.tsx`、`new_html/components/video/SeedanceDetailModal.tsx`（透传 onPreviewMedia）
- `new_html/hooks/useSeedanceCandidates.ts`（接入 characterVoices + audioTracks）
- `new_html/utils/seedanceCandidateBuilder.ts`（§ 4b/4c 新分支 + 4 个测试）
- `new_html/pages/VideoGenPage.tsx`（loadSlices 扩展 + audio 自动注入）

---

### 视频页面卡片显示固定 5s，不跟随剧本/音频时长

**症状**：第一个分镜剧本页面显示 2s，配音页 3s（因为音频 3s），但视频生成页面卡片显示 5s。期望：有音频用音频时长；没有用 `planned_duration_ms`；都没有才用默认 5s。

**根因**：`VideoPage.getSeedanceParams` 的 fallback 路径硬编码 `duration: 5`。当 SeedanceParams 还没被存进 `seedanceParamsByUuid`（首次切换 Seedance2 / 占位卡）时，fallback 返回的 SP.duration 永远是 5，覆盖了 `useReactiveDuration` 已经写回 `taskGroup.duration` 的正确值。

**修复（2026-05-20）**：`getSeedanceParams` fallback 取 `group.duration ?? computeReactiveDurationFromMeta(meta) ?? 5`，与 `DurationFieldForGroup` 共用同一份响应式时长。

**Files**：`new_html/components/VideoPage.tsx` (line ~120-160)

### 视频页面 @ 不能用 / 插入素材没音频

**症状 A**：在已含中文 / 标点的 prompt 末尾输入 `@`，popover 不打开。
**症状 B**：「插入素材」弹窗里"音频"分组永远是空的（即使该分镜有 `dialogue_audio_url`、`mixed_audio_url`）。

**根因 A**：`SeedanceMentionPromptEditor.handleInput` 触发条件 `prev === '' || /\s/.test(prev)` 只接受**空白字符**。导入的 video_prompt 是中文，前一字符是 `巷`、`，`、`：` 等，全部不算空白，popover 静默吞掉 @。

**根因 B**：`buildCandidates` 用 snake_case 字段名（`dialogue_audio_url`、`mixed_audio_url`、`generated_image_url`...）读 `storyboardItems`，但 `EpisodeContext.normalizeStoryboardItem` 已经把所有字段统一改名为 camelCase（`dialogueAudioUrl` 等）。生产环境 `sb.dialogue_audio_url` 永远 `undefined` → 一条音频候选都没有。Task A 引入 `currentStoryboardItemId` 过滤后，连 `materialLibrary.audio` 也被排除（line 168），结果 audio 候选清零。

**修复（2026-05-20）**：
1. `SeedanceMentionPromptEditor`：触发条件放宽为 `prev === '' || !/[A-Za-z0-9_]/.test(prev)`——任何非英数字下划线都算合法触发（中文、标点、换行均可）。英文邮箱中间的 @ 仍不触发。
2. `buildCandidates`：新增 `sb(item)` 适配器，统一把 `item_id ?? itemId`、`dialogue_audio_url ?? dialogueAudioUrl` 等 12 个字段同时读两种命名风格。所有读取改走适配器。

**Files**：
- `new_html/components/SeedanceMentionPromptEditor.tsx`
- `new_html/utils/seedanceCandidateBuilder.ts`

**测试**：
- `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx` 新增 2 个 case：中文/标点后 @ 应打开 popover。
- `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts` 新增 2 个 case：camelCase storyboardItems 也应产出 storyboard_data + audio 候选。

---

### 视频页面卡片高度对不齐

**症状**：卡片视图模式下，左右两列卡片行不对齐，第 3 行开始错位 100px+。

**原因**：`SEEDANCE_CARD_HEIGHT_CLASS` 用 `min-h-[620px] max-h-[760px]` 这种弹性范围，左右卡片各自决定自己的高度。

**修复（2026-05-17）**：改为 `h-[720px] overflow-y-auto` 固定高度。`COMPACT_CARD_HEIGHT_CLASS` 同时改为 `h-[400px] overflow-y-auto`。详见 `new_html/utils/videoCardLayout.ts`。

### 视频页面分镜顺序倒了

**症状**：分镜页是镜头 1→N，导入到视频页后变成 N→1（最新在最上）。

**原因**：`VideoPage.sortedTaskGroups` 默认 `sortOrder = 'newest'` 时反转数组。

**修复（2026-05-17）**：删除 `sortOrder` state 和工具栏 `最新/最早` 按钮；强制按 `uploadedImages[i].sortOrder`（来自 `storyboard_items.sort_order`）升序，与分镜页一致。

### 飞升 / 渡劫默认应是「全能参考」模式而非「首尾帧」

**症状**：分镜导入到视频页时，默认把图片设成 `first_frame`，触发首尾帧语义。

**原因**：`VideoGenPage.handleImportAll` 和 `storyboardSync.buildArtifacts` 写死了 `role: 'first_frame'`。

**修复（2026-05-17）**：默认 `role: 'reference_image'`（全能参考）。用户需要首尾帧时，在 `SeedanceMultimodalPanel` 顶部 `[全能参考] [首尾帧]` toggle 切换。切换会自动 rewriteimage roles。

### 首尾帧模式应该只发图片，不发视频/音频

**症状**：首尾帧模式下视频/音频 box 还在收输入，submit 时被后端拒绝。

**修复（2026-05-17）**：
- UI：首尾帧模式下视频/音频 section 整体 `opacity-30 pointer-events-none`，并显示 `(跳过)` 角标。
- 提交：`VideoPage.runTask` 在 submit 前 `media_inputs.filter(m => m.kind === 'image')`。

### Seedance 卡片切到 Seedance2 后媒体输入是空的

**症状**：用户在 Wan2 模式下上传了图片，切到 Seedance2 后，媒体输入显示 0/9，但卡片视觉上还有图。

**原因**：`getSeedanceParams` 返回 `media_inputs: []`，没有自动从 `uploadedImages` 取关联图。

**修复（2026-05-17）**：`getSeedanceParams` 现在按 `linkedGroupUuids` / `group.ids` 找出当前 group 关联的所有 image，作为 `reference_image` 自动填进 `media_inputs`。

### Prompt 里的 `图片1` token 删除时一字一字消失

**症状**：用户 Backspace 想删除整个 `@图片1`，但只删了 `1`，留下 `图片` 孤儿字符串。

**原因**：`SeedanceMentionPromptEditor` 的 textarea 走默认 Backspace 行为。

**修复（2026-05-17）**：`handleKeyDown` 加 Backspace 拦截：检测光标前是否匹配 `(图片|视频|音频)\d+$`，如果匹配则整块删除 + 调 `removeMediaInput` 移除对应 `media_inputs[i]` + 重号剩余 token。IME 输入和范围选择不受影响。

### 视频页面列表模式参数太多 / 左右行宽度不匹配

**症状**：列表模式下，左侧 Seedance 卡渲染了完整的多模态面板（620px+ 高），右侧结果卡只有 64px 高，无法对齐，一屏只能显示 2 行。

**修复（2026-05-17）**：列表模式重设计为 "mission bus" 行：每行 64px，包含 thumbnail · model · 一行 textarea · `[图N][视N][音N]` 媒体徽章 · 状态 · `[▶ 🗑 ⚙]`。点 ⚙ 打开 `SeedanceDetailModal`（包装 `SeedanceMultimodalPanel`，实时保存，X/Esc/点空白关闭）。

---

### Q: 视频页"导入全部分镜"会跳过空分镜 / 仅有音频的分镜（视频页空白）

**Symptom**: episode 有 N 个分镜，其中 K 个还没生图（仅文字 + 音频）。点"导入全部分镜到视频工作区"后，视频页只看到已生图那几个；空分镜或仅含台词/旁白音频的分镜完全没卡片，看不出"还有这些片段需要处理"。

**Root Cause**: `VideoGenPage.handleImportAll` 旧实现先用 `generated_image_url` 过滤再 import：

```ts
const itemsWithImages = useMemo(
  () => storyboardItems.filter(s => s.generated_image_url),  // ← 这里
  [storyboardItems],
);
```

空分镜被一刀切掉。音频信息（`dialogue_audio_url / narration_audio_url / sfx_audio_url`）也没有任何路径流向 `WorkspaceSession`。

**Fix（2026-05-17，commit `5b902a5`）**：

1. 重写 `handleImportAll` 走 `allStoryboardItems`（不过滤 url），空分镜 → `UploadedImage.isPlaceholder=true` + `prompt='@'`，引导用 `@` 选首帧。
2. 新增 `WorkspaceSession.storyboard_meta`（Task 1 类型），按 `itemId` 缓存 `audioUrls / plannedDurationMs / audioDurationMs / mixedAudioUrl / mixedAudioHash / sceneHeading / dialogue / lastSyncedAt`。
3. 新增 `POST /api/storyboard/mix-audio`（`audio_mix_service.py`）后台 ffmpeg amix 三轨；导入时按 concurrency=3 异步触发，结果 patch 进 `seedance_params.media_inputs` 作为 `reference_audio`。
4. `VideoPage` 卡片增加 placeholder 占位渲染 + 音频徽章（对白/旁白/音效/已混音/混音中）。
5. 同步模态 `StoryboardSyncModal`（三模式：仅添加新分镜 / 覆盖未编辑 / 全量重置）；实现：`new_html/utils/storyboardSync.ts:applySyncStrategy`。

**Files**: `new_html/pages/VideoGenPage.tsx`, `new_html/components/VideoPage.tsx`, `new_html/components/video/{VideoCard,StoryboardSyncModal,CardDurationField}.tsx`, `new_html/utils/storyboardSync.ts`, `new_html/services/videoService.ts` (`computeReactiveDurationFromMeta`/`runWithConcurrency`/`patchWorkspaceSession`/`mixStoryboardAudio`), `audio_mix_service.py`, `api_routes.py`, `db_migration_storyboard_audio_mix.sql`. **2026-05-17**

---

### Q: Seedance 2.0（飞升 / 渡劫）的 prompt 输入框打 `@` 没反应，无法选媒体列表 / 素材库

**Symptom**: 在视频页对一张 Seedance 2.0 卡片的"提示词"区域键入 `@`，期望弹候选 popover（媒体库 / 素材库 / 分镜 / 历史片段...），但什么都不发生，只是把字面 `@` 字符插进文本里。

**Root Cause**: `SeedanceMultimodalPanel` 的提示词区曾是一个普通 `<textarea value={value.prompt} onChange={e => patch({ prompt: e.target.value })}>`。**完全没有 `@-mention` 实现** —— 既没有触发逻辑（监听 `@` + 检测前一字符是否换行/空白）也没有候选构造（`buildCandidates`）和插入逻辑（`insertMention` + token 自动维护）。spec 与 plan 的旧版假设它已经实现，实际没。

**Fix（2026-05-17，commits `e6c4ca0`/`556ffdb`/`27345d3`/`8732afb`）**：

1. 新增 `new_html/components/SeedanceMentionPromptEditor.tsx` —— 受控编辑器：`@` 出现在行首/空白后时自动开 popover（IME compositionstart 期间抑制），ArrowUp/Down + Enter 选择，Esc 关闭，autoOpen on mount when `prompt==='@'`（占位卡引导）。
2. 新增 `new_html/components/SeedanceAssetPickerModal.tsx` —— `+ 插入素材` 按钮触发的多选 modal，复用同样的 candidate 数据。
3. 候选构造：`new_html/utils/seedanceCandidateBuilder.ts:buildCandidates(ctx)`，输出 7 组 `SeedanceAssetCandidate[]`（`current_card / storyboard_data / assets / audio / video_segments / user_files / ark_asset_id`）；ark 兜底永远存在。
4. Token 自动维护：`new_html/utils/seedanceMedia.ts:{insertMention, removeMediaInput, canonicalizePrompt}` —— 插入图片 / 视频 / 音频时自动追加 `图片N / 视频N / 音频N`，删除时同 kind 全体重编号（`R1` 策略）。
5. `useSeedanceCandidates` hook 把 `EpisodeContext.{assets, audioTracks, videoSegments, storyboardItems}` + `useEntityFilesQuery('episode', episodeId)` + 当前 `seedance_params` 喂给 builder，记忆化输出。
6. `SeedancePanelWithCandidates`（`components/video/VideoCard.tsx`）作为 `SeedanceMultimodalPanel` 的注入式 wrapper，让所有 panel 调用点（视频页两处 + 未来扩展）共用同一份候选源。

`web_search` 透传：当 `media_inputs` 全空且 `prompt` 非空 + sub_model ∈ {standard, fast} 时，`shouldEnableWebSearch` 返回 true，`worker.py` 调 ark 时附 `tools: [{ "type": "web_search" }]`。

**Files**: `new_html/components/SeedanceMentionPromptEditor.tsx`, `new_html/components/SeedanceAssetPickerModal.tsx`, `new_html/components/SeedanceMultimodalPanel.tsx`（重构），`new_html/components/video/VideoCard.tsx`, `new_html/hooks/useSeedanceCandidates.ts`, `new_html/utils/{seedanceMedia,seedanceCandidateBuilder}.ts`, `worker.py`, `seedance_api.py`. **2026-05-17**

---

### Q: 视频页"导入全部分镜到视频工作区"显示"全部被跳过：N 条 data: URL"

**Symptom**: 视频页右上 banner：
```
没有可导入的分镜画面（共 1 个，全部被跳过：1 条 data: URL（base64 内联图，应改为持久化 URL））
```
console 还会另外出现一条：
```
GET https://<host>/data:image/webp;base64,UklGRtSwDg... 414 (Request-URI Too Large)
```

**Root Cause**: `storyboard_items.generated_image_url` 字段里残留了
`data:image/webp;base64,...` 这种**内联 URL**。诊断链：

1. 视频页 `handleImportAll` 已经会 reject `data:`/`blob:` URL（2026-05-17 加的
   白名单），所以才能 banner 报"被跳过"。如果没这层守卫，下游会无声失败
   工作区显示空白。
2. 写入端漏点：`StoryboardGenPage.handleUpdateStoryboardItem` 旧代码
   `dbUpdates.generated_image_url = selected.url`，**没校验 url 是否持久化**。
   只要任何上游 callback 把 base64 / blob URL 传给它就直接进 DB。
3. 实际上游写脏 URL 的多个嫌疑路径都在 `GenerationPage.tsx`：例如
   `handleAngleAdjustment` 1186 行原来写 `generatedImage: dataUrl`，
   `dataUrl` 在该作用域**未声明**（编译器宽容/`noImplicitAny:false`），
   运行时取到 closure 里某个 dataUrl，把临时 base64 当作持久化 URL 写下去。
4. 浏览器拿到 `data:image/webp;base64,XXXX...` 当 `<img src>` 时，
   被某层封装拼成 `${origin}/${url}` → 触发 414 Request-URI Too Large
   （URL 长度是 base64 全身）。

**Fix**:

1. **写入端白名单**（`new_html/pages/StoryboardGenPage.tsx`）：
   ```typescript
   const isPersistentUrl = (u?: string | null) =>
       !!u && !u.startsWith('data:') && !u.startsWith('blob:')
       && (u.startsWith('http') || u.startsWith('/'));
   if (pickedUrl !== undefined && isPersistentUrl(pickedUrl)) {
       dbUpdates.generated_image_url = pickedUrl;
   } else {
       console.warn('[StoryboardGenPage] 拒绝把非持久化 URL 写入 generated_image_url', ...);
   }
   ```
2. **修编译炸弹**（`new_html/components/GenerationPage.tsx:1186`）：
   `generatedImage: dataUrl` → `generatedImage: resultUrl`（与上面 newImage.url 同源）。
3. **数据仓清理**：跑 `db_migration_clean_storyboard_data_urls.sql`，把已存的
   `LIKE 'data:%'` / `LIKE 'blob:%'` 行的 `generated_image_url` 置 NULL。
   置 NULL 后前端会自动回退到 `entity_files` 表的 generated_image，UI 不丢图。

**为什么这个 bug 会反复**：
分镜→视频是项目最长的 vertical slice（DB → Episode Context → 4 个 page），
任意一层放过 `data:` URL 都会成为下游故障。固化的纪律：**任何往
`*_url` 字段写入的代码都必须用 `isPersistentUrl` 守卫**。已写进
`docs/conventions.md` § Data URL Prohibition，AI 改这类代码前必读。

**Files**: `new_html/pages/StoryboardGenPage.tsx`,
`new_html/components/GenerationPage.tsx`,
`db_migration_clean_storyboard_data_urls.sql`
**Date**: 2026-05-17

---

### Q: 分镜页"上传图片"（不是 ComfyUI 生成）后，视频页导入还是空

**Symptom**: 用户在分镜页通过**拖拽**上传一张图片到生成结果区，分镜页显示
正常（缩略图能看到），但切到视频页点"导入全部分镜到视频工作区"，banner
报"全部被跳过：N 条 data: URL"，工作区空。

**Root Cause**: 分镜页同时存在 **两条上传路径**，但只有一条做了持久化：

| 入口 | 旧实现 | 是否持久化 |
|------|--------|------------|
| `<input id="upload-result-image">` 文件选择器（`GenerationPage.tsx:2217`） | `uploadEntityFile()` → `/api/entity-files/upload` | ✅ 持久化 |
| **拖拽**上传到生成结果区（`handleResultDrop`，`GenerationPage.tsx:636`） | `FileReader.readAsDataURL()` → `url: data:image/...` | ❌ 只读为 base64，未上传 |

拖拽路径的 base64 通过 `onUpdateStoryboardItem` →
`storyboardItemToDbUpdate({ generatedImage: dataUrl })` →
`generated_image_url` 字段，最终被视频页拒收。

更深层问题是 `storyboardItemToDbUpdate`（`new_html/utils/episodeAdapters.ts`）
**没做 URL 校验**，把任何字符串都信任为持久化 URL。任何 caller 传错都会
直达 DB。

**Fix**:

1. **拖拽路径走持久化**（`GenerationPage.tsx:handleResultDrop`）：
   ```typescript
   const saved = await uploadEntityFile(
       file, 'storyboard_item', selectedShot.id, 'generated_image', episodeId
   );
   const newImage = { id: saved.fileId, url: saved.fileUrl, ... };
   onUpdateStoryboardItem(selectedShot.id, (cur) => ({
       generatedImages: [...(cur.generatedImages || []), newImage],
       selectedImageId: newImage.id,
       generatedImage: saved.fileUrl,
   }));
   ```
   失败时 alert 用户，不再 fallback 到 base64。

2. **总瓶颈守卫**（`new_html/utils/episodeAdapters.ts:storyboardItemToDbUpdate`）：
   ```typescript
   function isPersistentImageUrl(u: unknown): u is string {
       if (typeof u !== 'string' || !u) return false;
       if (u.startsWith('data:') || u.startsWith('blob:')) return false;
       return u.startsWith('http') || u.startsWith('/');
   }
   if (updates.generatedImage !== undefined) {
       if (updates.generatedImage === null || isPersistentImageUrl(updates.generatedImage)) {
           result.generated_image_url = updates.generatedImage;
       } else {
           console.warn('[episodeAdapters] 拒绝非持久化 URL', ...);
       }
   }
   ```
   下沉到 adapter 层后，所有 caller 自动受保护，无论新增功能在哪条路径
   都不会再写脏数据。

3. **数据仓清理**：跑 `deploy/sql/db_migration_clean_storyboard_data_urls.sql`
   清旧 base64 残留（与上一个 FAQ 同一个脚本）。

**为什么这个 bug 危险**：写入端散落在 ≥ 3 个 page / 5+ handler，靠每处
review 守卫不现实。把守卫下沉到 `storyboardItemToDbUpdate` 这种 single
choke-point 是项目惯例 —— 见 `docs/conventions.md` § Data URL Prohibition。

**Files**: `new_html/components/GenerationPage.tsx`,
`new_html/utils/episodeAdapters.ts`
**Date**: 2026-05-17

---

### Q: 双仓漂移：`deploy/` 镜像与根仓不一致，prod 跑旧代码 / 缺新文件

**Symptom**: 修了根目录 `*.py` / `*.tsx` 后，发现：
- 上传 `deploy/` 到生产后行为没变（旧代码还在）
- 控制台日志里某个新加的诊断 prefix 不出现
- `deploy/sql/` 里缺 migration → 生产 DB schema 没升级
- `deploy/docs/` 比 `docs/` 旧

实测一次盘点：根仓 vs `deploy/` 实际漂移 **129 个文件**（93 added + 33 modified +
3 orphans），其中 14 个 SQL migration 没同步、8 个根 .py 工具脚本 / 大量
`docs/superpowers/plans/`、新前端 hooks 全部缺失。

**Root Cause**: 历史上靠手工 `xcopy /Y /S new_html\*.tsx deploy\new_html\` +
`copy /Y *.py deploy/`（见 `docs/superpowers/plans/2026-03-21-video-pipeline-redesign.md:1175`）维护镜像，没人能记得每次都双写，几个月下来积累成大漂移。
`project-memory` 的 `sync_check.py` 检查 docs↔code 漂移，但**不检查
`deploy/X.py` ↔ `X.py` 漂移**，所以一直没暴露。

**Fix**:

- 写 `scripts/sync_to_deploy.py`：一键检查 + 同步，单向 root → deploy/，规则见
  `docs/conventions.md` § Dual-Repo Mirror。
- `--check` 退出码 1 当 pre-commit / pre-push gate；CRLF/LF 行尾差异默认忽略。
- 工作流：
  ```bash
  python scripts/sync_to_deploy.py --check       # CI/pre-commit 用
  python scripts/sync_to_deploy.py --apply       # 一键同步
  python scripts/sync_to_deploy.py --apply --paths new_html/pages/X.tsx
                                                 # 白名单同步
  ```
- 凡是「视频页/分镜页 bug 反复出现，但根仓代码看着正常」，先跑 `--check` 看
  `deploy/` 是不是落后了。

**Files**: `scripts/sync_to_deploy.py`, `docs/conventions.md`
**Date**: 2026-05-17

---

### Q: 视频页一直 500 报 `can't subtract offset-naive and offset-aware datetimes`

**Symptom**: 控制台不断刷
```
GET /api/tasks/notifications?since=1778996457... 500 (Internal Server Error)
getTaskNotifications 返回错误 (500): invalid input for query argument $2:
  datetime.datetime(2026, 5, 17, 5, 39, 36, ...) (can't subtract offset-naive
  and offset-aware datetimes)
```
SSE 通道也跟着 `ERR_CONNECTION_RESET` ↔ `已连接` 抖动，但页面其它功能仍可使用。

**Root Cause**: `tasks.completed_at` 列在 `database_schema.sql` 是 `TIMESTAMP`（不带 tz，
存的是 UTC naive 时间），但 `api_routes.py:get_task_notifications` 把
`?since=<ms>` 转成 **tz-aware** datetime：
```python
since_dt = _dt.fromtimestamp(since / 1000, tz=_tz.utc)  # ❌ aware
```
asyncpg 在把 aware 参数绑定到 naive 列做 `>` 比较时会抛
`can't subtract offset-naive and offset-aware datetimes`，整个 handler 500。
GlobalTaskManager 的 SSE 失败时降级到这个 HTTP 轮询，所以一直循环报 500。

**Fix**:
- `api_routes.py` + `deploy/api_routes.py` 把 since 解析改为 naive UTC，与列对齐：
  ```python
  since_dt = _dt.fromtimestamp(since / 1000, tz=_tz.utc).replace(tzinfo=None)
  ```
- 写入 `tasks.completed_at` 的代码全部用 naive UTC（PG `CURRENT_TIMESTAMP`
  在 `TIMESTAMP` 列里也是 naive），保持读写语义一致。如果以后要迁
  `TIMESTAMPTZ`，必须同步：迁移 SQL + 把这里去掉 `replace(tzinfo=None)`。

**Files**: `api_routes.py`, `deploy/api_routes.py`, `database_schema.sql` (列定义)
**Date**: 2026-05-17

---

### Q: 分镜页 → 视频页点"导入全部分镜到视频工作区"，整个工作区是空的

**Symptom**: 在 `VideoGenPage` 顶部的导入面板点 `导入全部分镜到视频工作区`，
按钮 spinner 转一下就消失，但下方嵌入的 `VideoPage` 工作区里一张图都没有，
看起来像页面空了。控制台没有明显报错（旧版只 `console.error('导入失败:', err)`，
toast 都没弹）。

**Root Cause**（多种可能复合）:
1. `handleImportAll` 把 `storyboardItem.generated_image_url` 原样塞进
   `uploaded_images[].url`。如果 storyboard 的 url 是带 `?token=...` 的临时
   形式或不是以 `/`/`http` 起头的相对路径（如 `storage/image/xxx.png`），后续
   `VideoPage.loadSession` 的过滤
   `img.url.startsWith('http') || img.url.startsWith('/')` 会**全部丢弃**，
   `taskGroups` 也跟着被清空，最终渲染空状态。
2. `videoService.saveWorkspaceSession` 失败时只返回 `{success:false}`，旧
   `handleImportAll` 不检查返回值就 `setImportDone(true)`，看起来"导入完成"
   但工作区其实没数据。
3. 失败路径用户没有任何反馈（无 toast、无 banner），所以"页面为空"是唯一的可观察症状。

**Fix**:
- `new_html/pages/VideoGenPage.tsx`：
  - URL 规范化：`split('?')[0]`（剥 token）+ 自动给相对路径加前导 `/`。
  - 跳过没有 `itemId` 或 `url` 的脏分镜，并在 console 报告。
  - 检查 `saveWorkspaceSession` 返回值，失败时显示红色 banner：
    `保存工作区会话失败，请稍后重试或刷新页面`。
  - 成功时显示绿色 banner `已导入 N 个分镜`，方便用户确认数量。
  - 加 `[VideoGenPage]` 前缀的诊断日志（scope/images/groups/sampleUrl）。
- `new_html/components/VideoPage.tsx`：`loadSession` 加 URL 兜底——把
  `storage/...` 自动改成 `/storage/...`，并在丢弃图片时打 `console.warn`，
  全部被过滤时打 `console.error`，避免静默清空。

**Files**: `new_html/pages/VideoGenPage.tsx`, `new_html/components/VideoPage.tsx`
**Date**: 2026-05-17

---

### Q: 视频页选了"飞升 / 渡劫"模型却看不到 SD2.0 多模态参数面板

**Symptom**: 用户在 VideoPage 选了 `飞升 (Seedance2)` 或 `渡劫 (Seedance2Fast)`，prompt 输入框依然是普通 textarea，没有出现媒体上传 / 高级参数 / 真人脸提示等 SD2.0 专属界面。

**Root Cause**: VideoPage 有 **card / list 两种视图模式**（`viewMode` state，line 39，**默认 `'card'`**），但 SeedanceMultimodalPanel 的条件渲染最初只加在了 **list 视图**的列表项里（line 1744 附近）。**默认进来的卡片视图（renderTaskCard, line 1827-1969）的 textarea 没有切换**，所以多数用户看不到面板。

**Fix**:
- `new_html/components/VideoPage.tsx`：在卡片视图的 `renderTaskCard` 里也加同样的条件渲染（line 1958-1976）：
  ```tsx
  {(group.model === 'Seedance2' || group.model === 'Seedance2Fast') ? (
      <div className="flex-1 overflow-y-auto">
          <SeedanceMultimodalPanel
              value={getSeedanceParams(group.uuid, group.model)}
              onChange={(next) => setSeedanceParams(group.uuid, next)}
          />
      </div>
  ) : (
      <textarea ... />  // 旧逻辑
  )}
  ```
- 重新 `npm run build`，把 `dist/` 上传到生产 web 根目录覆盖。




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

**Files**: `new_html/components/VideoPage.tsx`（list + card 双视图都已条件渲染）

**Date**: 2026-05-13

**Lesson**: 实施新功能时，**优先 grep 一下页面有几种视图模式**（关键字：`viewMode` `view_mode` `isCard` `isList` `视图`），任何视图相关的 UI 改动必须在所有视图模式下覆盖；只改一处就提交 = 默认视图用户看不到。

---

### Q: Seedance 2.0 (飞升 / 渡劫) 集成已知约束

**Symptom / 适用场景**：在 VideoPage 选 `飞升 (Seedance2)` 或 `渡劫 (Seedance2Fast)` 模型时，遇到提交失败 / ark 报错 / UI 限制。

**约束清单**（FE + BE 双层校验，遇到先核对）：

1. **fast (渡劫) 不支持 1080p**
   - FE: `SeedanceMultimodalPanel` 自动禁用 1080p 选项；`videoService.submitSeedanceTask` 二次降 720p
   - BE: `worker._process_seedance_task` 三次兜底降级
2. **camera_fixed 仅 1.5pro 支持** — 2.0 系列在 UI 灰显，传给 ark 也会被忽略
3. **多模态参考生视频数量上限**（ark 硬限，FE `validation` 提前拦截）：
   - 图片 ≤ 9 张（**不再是 3 张**，早期版本误把"参考图角色"和"图片总数"混淆）
   - 参考视频 ≤ 3 个
   - 参考音频 ≤ 3 个
4. **不可单独输入音频** — 必须至少包含 1 张图或 1 段视频，仅 `prompt + audio` 组合会被 ark 拒绝
5. **真人脸来源限制（重要）** — Seedance 2.0 系列**不支持直接上传含真人人脸的图/视频**。如需使用人物，必须满足以下来源之一：
   - 本平台/方舟其他模型生成的人脸产物
   - 预置虚拟人像
   - 已授权真人素材（按官方教程申请）
6. **首尾帧 与 reference_image 不能共存** — 角色互斥：选了 first_frame/last_frame 就不能再放 reference_image
7. **首帧 / 尾帧 必须成对出现** — 只放 first_frame 或只放 last_frame 都会被前端拒绝
8. **单次请求 contents 总大小 ≤ 64 MB** — ark 硬限，超出请压缩或分次提交
9. **`draft_task_id`（样片复用）仅 1.5pro 支持** — 2.0 系列 UI 灰显并提示禁用，强行传会被 ark 拒绝
10. **API key 兜底顺序**：`SEEDANCE_API_KEY` → `ARK_API_KEY`（兜底 ark 系列共享凭证）

**端到端 trace**：见 `docs/vertical-slices.md` 中 "VideoGenPage" 章节的 5 场景表。

**架构约定**：见 `docs/conventions.md` 中 "External Video API Integration Pattern"。

**修复同携带的额外好处**：本次集成把 `worker._save_external_video` 改成 entity-aware，间接修补了 sora2 / veo / minimax / wan26 四家旧 API 的 `video_segments.video_url` 不自动写入的历史漏洞。

---

### Q: 分镜图像生成（练气一阶/筑基一阶 1 张参考图）失败：`LoadImage 78: Custom validation failed for node: image - Invalid image file: {image}`

**Symptom**:
```
Failed to validate prompt for output 60:
* LoadImage 78:
  - Custom validation failed for node: image - Invalid image file: {image}
Output will be ignored
invalid prompt: {'type': 'prompt_outputs_failed_validation', 'message': 'Prompt outputs failed validation', ...}
```

只发生在"练气一阶（qwen）"或"筑基一阶（qwen_lora）"且**只用 1 张参考图**的场景；2~6 张参考图工作正常。错误日志里 `{image}` 字面值明显未被占位符替换。

**Root Cause**:
垂直切片"前端模型选择 → 后端路由约定 → 工作流模板占位符"三层命名口径不一致：

1. 后端 `cluster_main.py:4144-4198 generate_comfyui_workflow`：对 qwen / qwen_lora / qwenN / qwenN_lora 系列**统一**只写 `task_data['image_path_X']`（1≤X≤6），从不写 `task_data['image_path']`：
   ```python
   if request.workflow_type in ['qwen','qwen_lora','qwenN','qwenN_lora']:
       for i, filename in enumerate(request.image_filenames[:6], 1):
           task_data[f"image_path_{i}"] = filename
   ```
2. `task_service._prepare_for_agent:89` 的 `image_path → uploaded_image` 转换，找的是 `image_path` 这个 key，对上面只写 `image_path_X` 的场景 **不会触发**（`uploaded_image` 永远不被赋值）。
3. `workflow_handler.build_workflow_for_task:239` 设 `params['image'] = task_data.get('uploaded_image', task_data.get('image', ''))` → 空字符串。
4. `replace_placeholders:121` 跳过空值 → 模板里的 `{image}` 字面值留下不替换。
5. 工作流模板 `workflows/qwen_1.json` 与 `workflows/qwen_lora_1.json` 的 LoadImage 节点 78 是 `"image": "{image}"`（旧风格），与 `qwen_2~6.json` / `qwen_lora_2~6.json` 的 `"image": "{image_1}"`（新风格）**不一致**。新工作流加上后旧的 1 张图模板未同步迁移。

简言之：**`{image_X}` 是后端约定，但 `qwen_1.json` / `qwen_lora_1.json` 还停留在 `{image}` 命名，导致永远拿不到值**。

**Fix**:
1. **代码层（已修）**:
   - `workflows/qwen_1.json` 与 `workflows/qwen_lora_1.json` 节点 78 占位符 `{image}` → `{image_1}`，与 X≥2 的同系列文件保持一致（同步 root + `deploy/workflows/`，共 4 份）。
   - `workflow_handler.py` 的 `build_workflow_for_task` 加单图兜底：填完 `image_1..image_6` 后，若 `params['image']` 为空且 `params['image_1']` 有值，自动 `params['image'] = params['image_1']`。这样无论模板写 `{image}` 还是 `{image_1}` 都能正确替换（同步 `deploy/workflow_handler.py`）。

2. **生产环境部署**:
   - 替换 4 份文件：`workflow_handler.py`、`workflows/qwen_1.json`、`workflows/qwen_lora_1.json`、`workflows/qwen_lora_1.json` 的对应 deploy 副本。
   - 重启后端 (`pkill -f cluster_main.py && python3 cluster_main.py`)：让 `WorkflowHandler` 重新加载磁盘工作流；同时清掉 worker 进程内缓存。
   - 若用过工作流热重载把 `qwen_1` / `qwen_lora_1` 写入了 `workflow_templates` 表，需要在管理页"工作流管理 → 一键导入到数据库"重新导入一次（DB 里的 workflow_json 也会被覆盖到新版）；或者直接在 admin "手动添加" 修改后重新保存（`_sync_workflow_to_disk` 会同步写盘）。

**怎么验证修好了**:
```bash
# 1) 服务端日志：成功生成时应看到
#    🔧 设置 image_1 = qwen_xxx.png
#    （若旧模板未替换为 {image_1}，还会看到）🔧 单图兜底: image = image_1 = qwen_xxx.png
#    ✅ 替换占位符完成: prompt=True, seed=..., images={'image': 'qwen_xxx.png', ...}

# 2) 用 1 张参考图选择"练气一阶"或"筑基一阶"，点开始生成 → 不再 500，能看到生成结果
```

**Files**: `workflow_handler.py` · `deploy/workflow_handler.py` · `workflows/qwen_1.json` · `workflows/qwen_lora_1.json` · `deploy/workflows/qwen_1.json` · `deploy/workflows/qwen_lora_1.json` · `cluster_main.py`(背景) · `task_service.py`(背景) · `new_html/components/GenerationPage.tsx`(背景)

**Lesson**:
- 工作流模板必须遵循后端发参约定。**约定**：cluster_main 对 qwen / qwen_lora / qwenN / qwenN_lora 统一写 `image_path_X`（1≤X≤6），所以**模板里的 LoadImage 占位符必须是 `{image_X}`，不能是 `{image}`**（`{image}` 仅供 i2v / i2i_fj / i2i_human / i2i_around / kontext / panorama_360 / matting_* / upscale_hd / remove_watermark 这类"单图非 qwen"系列使用，它们走 `image_path` → `uploaded_image` → `params['image']` 的单图通道）。
- 系列工作流分裂成 `_1` / `_2` / ... 多份模板时，要把命名约定写进 `docs/conventions.md` 并在 review 时核对每一份占位符是否一致。

**Date**: 2026-05-10

---

### Q: 工作流管理页 → 一键导入 500：`asyncpg.exceptions.UndefinedColumnError: column "workflow_key" of relation "workflow_templates" does not exist`

**Symptom**:
```
File "/.../admin_routes.py", line 362, in admin_import_workflows
    row = await WorkflowTemplateDAO.create(...)
File "/.../dao_workflow_template.py", line 45, in create
    return await db.fetchrow(...)
asyncpg.exceptions.UndefinedColumnError:
    column "workflow_key" of relation "workflow_templates" does not exist
```

前端工作流管理页点"一键导入到数据库"，状态码 500，导入数恒为 0。

**Root Cause**:
- 2026-03-29 工作流热重载（`docs/superpowers/plans/2026-03-29-workflow-hot-reload.md`）给 `workflow_templates` 加了 `workflow_key` 列：DAO INSERT、Pydantic Body、admin 路由全改对了。
- **但只在 root `db_migration_admin.sql` 末尾追加了 `ALTER TABLE … ADD COLUMN IF NOT EXISTS workflow_key`，文件主体的 `CREATE TABLE workflow_templates` 没同步加列，并且 `deploy/sql/db_migration_admin.sql` 这一份完全漏掉了 ALTER 块**。
- `deploy/DEPLOY_GUIDE.md:157` 指引用户跑的恰好是 `sql/db_migration_admin.sql`。所以即使用户老老实实按文档跑迁移，列也不会被加上。
- `CREATE TABLE IF NOT EXISTS` 对老库是 no-op，不会修改现有 schema；只有 ALTER 才会补列。两份 SQL 主体都没列、`deploy/sql/` 那份连 ALTER 也没有 → DAO INSERT 直接 `UndefinedColumn` → 500。

**Fix**:
1. **代码层（已修）**:
   - 三份 `db_migration_admin.sql`（root + `deploy/` + `deploy/sql/`）的 `CREATE TABLE workflow_templates` 主体都加上 `workflow_key VARCHAR(100)` 一列（防御新建库）。
   - `deploy/sql/db_migration_admin.sql` 文件末尾补齐 ALTER 兜底块（与 root 对齐），覆盖所有老库重跑迁移的场景：
     ```sql
     ALTER TABLE workflow_templates
       ADD COLUMN IF NOT EXISTS workflow_key VARCHAR(100);
     CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_templates_key
       ON workflow_templates(workflow_key) WHERE workflow_key IS NOT NULL;
     ```
   - `docs/database.md` + `deploy/docs/database.md` 的 `workflow_templates` 表加 `workflow_key` 行。

2. **生产数据库现场修复**（如果服务器已经 500，立即执行这段即可，不必重跑整个迁移）:
   ```sql
   -- 用 my2_user（或同等权限账户）登录 my2_db
   ALTER TABLE workflow_templates
     ADD COLUMN IF NOT EXISTS workflow_key VARCHAR(100);

   CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_templates_key
     ON workflow_templates(workflow_key) WHERE workflow_key IS NOT NULL;
   ```

3. **必须重启后端**（`pkill -f cluster_main.py && python3 cluster_main.py`）：asyncpg 缓存了 prepared statement 计划，列加完后旧连接还会报同样的错，重启才能让新计划生效。

4. **执行后再点"一键导入"**：DAO 会把 `WORKFLOW_CONFIGS` 字典 key（如 `wan2_i2v`）写入 `workflow_key` 字段，热重载读盘逻辑（`admin_routes._sync_workflow_to_disk`）后续才能正确按 `workflow_key + ".json"` 写回 `workflows/` 目录。

**怎么验证修好了**:
```sql
-- 1) 列存在
\d workflow_templates
-- 应看到 workflow_key | character varying(100) | 可空

-- 2) 唯一索引存在
\di workflow_templates
-- 应看到 idx_workflow_templates_key

-- 3) 导入后非空率
SELECT COUNT(*) AS total,
       COUNT(workflow_key) AS with_key
FROM workflow_templates;
-- with_key 应等于 total（导入端点会给每条都填 category_key）
```

**Files**: `db_migration_admin.sql` · `deploy/db_migration_admin.sql` · `deploy/sql/db_migration_admin.sql` · `docs/database.md` · `deploy/docs/database.md` · `dao_workflow_template.py` · `admin_routes.py`

**Lesson**: 一旦项目里同一份 SQL 存在 root / `deploy/` / `deploy/sql/` 三份镜像，**任何 ALTER 类增量必须三份同步**。后续 schema 变更前先 `rg "CREATE TABLE.*<your_table>" -g "*.sql"` 确认所有副本，并在每份主体里直接落列（CREATE TABLE 内联）+ 文件末尾 `ALTER … IF NOT EXISTS` 兜底，缺一不可。

**Date**: 2026-05-10

---

### Q: 配音页保存音色 500：`asyncpg.exceptions.InsufficientPrivilegeError: permission denied for table character_voices`

**Symptom**:
```
File "/.../api_routes.py", line 2391, in create_character_voice
  voice = await CharacterVoiceDAO.create(...)
File "/.../dao_character_voice.py", line 37, in create
  return await db.fetchrow(query, vid, project_id, ...)
asyncpg.exceptions.InsufficientPrivilegeError: permission denied for table character_voices
```

通常出现在"刚刚把列类型从 UUID 改回 VARCHAR(50)"之后（见上一条 UUID FAQ 修复路径）。表结构是对的，但服务进程 `my2_user` 一 INSERT/SELECT 就 permission denied。

**Root Cause**:
- 项目里其它 `db_migration_*.sql`（如 `db_migration_project_hub.sql:108-109`）末尾都带了 `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO my2_user`，靠这条兜底权限。
- 早期版本的 `db_migration_character_voices.sql` **末尾没有 GRANT 块**，靠的是隐式契约："只要你按 `deploy/DEPLOY_GUIDE.md` 用 `psql -U my2_user -f ...` 跑迁移，新表的 owner 自然就是 my2_user，不需要 GRANT。"
- 但只要有人为了走捷径（比如手动 ALTER 列类型、或者表锁住 / 报错时切到超级用户排查、或者初次部署时用 postgres 跑），表的 owner 就会变成 postgres / 其他超级用户，my2_user 一条权限都没留。
- 列类型问题在 asyncpg encode 阶段就抛了，掩盖了 PG 真正抛出的 permission 错误。**列类型修好之后，权限错误才浮上来**。

**Fix**:
1. **代码层（已修）**: `db_migration_character_voices.sql`（root + `deploy/` + `deploy/sql/` 三份）末尾追加 GRANT 块：
   ```sql
   DO $$
   BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'my2_user') THEN
           EXECUTE 'ALTER TABLE character_voices OWNER TO my2_user';
           EXECUTE 'ALTER SEQUENCE character_voices_id_seq OWNER TO my2_user';
       END IF;
   END $$;
   GRANT ALL PRIVILEGES ON TABLE character_voices TO my2_user;
   GRANT ALL PRIVILEGES ON SEQUENCE character_voices_id_seq TO my2_user;
   ```
   这样无论谁去跑迁移，跑完 owner 一定回到 my2_user。
2. **生产数据库现场修复**（如果当前服务器已经裂了，先用超级用户登一次执行）:
   ```sql
   -- 用 postgres / 数据库超级用户登录
   ALTER TABLE character_voices OWNER TO my2_user;
   ALTER SEQUENCE character_voices_id_seq OWNER TO my2_user;
   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO my2_user;
   GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO my2_user;
   GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO my2_user;
   ```
3. **必须重启后端** (`pkill -f cluster_main.py && python3 cluster_main.py`)：asyncpg 的 prepared statement 缓存 + 连接池可能挂着上次失败的语句计划，不重启即使权限修对了，旧连接还是会继续报。

**怎么验证修好了**:
```sql
SELECT tableowner FROM pg_tables WHERE tablename = 'character_voices';
-- 必须返回 my2_user

-- 顺便扫一眼库里还有没有 owner 错位的表
SELECT schemaname, tablename, tableowner
FROM pg_tables
WHERE schemaname='public' AND tableowner <> 'my2_user';
-- 期望：空集
```

如果第二条还有结果，建议一把梭（用超级用户跑）：
```sql
REASSIGN OWNED BY postgres TO my2_user;
```

**Files**:
- `db_migration_character_voices.sql` (root + `deploy/` + `deploy/sql/`) — 追加 GRANT 块

**Date**: 2026-05-05

**教训**:
- 任何 `db_migration_*.sql` 的末尾都应该有 GRANT 兜底，不要靠"调用方一定用对的用户"的隐式契约。隐式契约会被任何一次"先用 postgres 看一下"的临时操作打破，而且打破之后症状滞后到上层 bug 修复之后才暴露。
- asyncpg 的 prepared statement 缓存会让"明明 SQL/权限都对"的上下文继续报错；schema/权限相关的修复完都要重启进程。
- 这一类 bug 是经典的"上一层 bug 掩盖下一层 bug"。修完 UUID 又跳出 permission，下次保不齐还有 statement_timeout / FK 失效之类的雷。修完每一层后立刻拿真实请求验一遍，别等用户再发堆栈。

---

### Q: 配音页保存音色 500：`asyncpg.exceptions.DataError: invalid input for query argument $2: 'proj_xxxx' (invalid UUID 'proj_xxxx': length must be between 32..36 characters, got 17)`

**Symptom**:
```
File "/.../api_routes.py", line 2391, in create_character_voice
  voice = await CharacterVoiceDAO.create(...)
File "/.../dao_character_voice.py", line 37, in create
  return await db.fetchrow(query, vid, project_id, ...)
asyncpg.exceptions.DataError: invalid input for query argument $2:
  'proj_f5922947b1e8' (invalid UUID 'proj_f5922947b1e8': length must be between 32..36 characters, got 17)
```

**Root Cause**:
- `db_migration_character_voices.sql` 把 `project_id` 和 `asset_id` 错误地声明成了 `UUID`：
  ```sql
  project_id UUID NOT NULL,
  asset_id UUID,
  ```
- 但项目里**所有其他表**的 `project_id` 都是 `VARCHAR(50)`（值形如 `proj_f5922947b1e8`，`asset_id` 同理是 `asset_xxxx`）。这俩 ID 不是 UUID 格式。
- 所以 `INSERT INTO character_voices (..., project_id, ...) VALUES ($2::uuid, ...)` 时，asyncpg 试图把 `proj_xxxx` 编码成 UUID，长度不够 32 直接抛 DataError。
- 外键约束当时没拦住是因为 PG 创建 FK 时只检查"列存在 + 引用列被 PRIMARY KEY/UNIQUE"，不强校验类型；UUID 列对 VARCHAR 列建 FK 在建空表时**不会立即报错**，要到 INSERT 一条数据时才暴露类型错。

**Fix**:
1. 改 `db_migration_character_voices.sql`：`project_id UUID → VARCHAR(50)`、`asset_id UUID → VARCHAR(50)`，并在文件末尾加一段 `DO $$ ... $$` 块自动检测旧表并 ALTER 列类型，无损迁移已有数据。
2. 改 `dao_character_voice.py`：去掉 INSERT/SELECT 里 `project_id` 的 `::uuid` cast（保留 `voice_id::uuid`，它确实是 UUID 列，由 `gen_random_uuid()` 生成）。
3. 已经按错误 schema 建过表的用户，重跑一次新的 `db_migration_character_voices.sql` 即可——文件里的 DO 块会自动检测到 `data_type='uuid'` 并修正为 VARCHAR(50)。表里有数据也不会丢（`USING project_id::text`）。

**怎么验证修好了**:
```sql
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'character_voices' AND column_name IN ('project_id','asset_id','voice_id');
```
正确结果：
```
 column_name |    data_type      | character_maximum_length
-------------+-------------------+--------------------------
 project_id  | character varying |                       50
 asset_id    | character varying |                       50
 voice_id    | uuid              |                     NULL
```

**Files**:
- `db_migration_character_voices.sql` (root + `deploy/` + `deploy/sql/`)
- `dao_character_voice.py` + `deploy/dao_character_voice.py`

**Date**: 2026-05-04

**2026-05-05 再现备注**: 一台 autodl 部署服务器在 5/4 代码合入之后**没有在线上库重跑迁移**，所以 `character_voices.project_id` 列还是 UUID，再次出现一模一样的报错。提醒：
- 本仓**没有 migration loader**，`db_manager.py` 只管连接池，`cluster_main.py` 不会自动应用 `db_migration_*.sql`。
- 任何 schema 修复合入后，都必须在每台部署机器上 `psql -U my2_user -f db_migration_character_voices.sql` 一次。
- 跑完**必须重启后端**（`pkill -f cluster_main.py && python3 cluster_main.py`），否则 asyncpg 的 prepared statement 缓存仍按旧列类型推断 `$N`，bug 看着没修。
- 如果你为了排查临时切到超级用户跑了 SQL，会再触发下一条 FAQ 的 `permission denied`，记得用回 my2_user 或者收尾时 `ALTER TABLE ... OWNER TO my2_user`。

---

### Q: 配音页点试听后出现一个空音频条，没法播放（src 拉不到文件）

**Symptom**:
- 试听按钮点完，下方 `<audio controls>` 出现，但完全没法播放（点 ▶ 无反应）。
- 浏览器 DevTools Network 看到 `GET /uploads/audio/tts_xxxxxxxx.mp3 → 404`。
- 后端 `persistent_storage/audio/tts_xxxxxxxx.mp3` **文件其实生成成功了**，只是 URL 路由不对。

**Root Cause**:
- 三个地方在写完 mp3 后返回了**错误的 URL 前缀**：
  - `minimax_audio.py:233` (`tts_wait_and_download` 返回值) → `/uploads/audio/{filename}`
  - `minimax_audio.py:294` (`music_generate`) → `/uploads/audio/{filename}`
  - `audio_provider.py:77` (`GeminiAudioProvider._call_gemini`) → `/uploads/audio/{filename}`
- 但 `AUDIO_UPLOAD_DIR = "persistent_storage/audio"`，文件实际落在 `persistent_storage/audio/` 下。
- `cluster_main.py` 挂载关系：
  - `/uploads` → `temp/uploads/`（不是文件实际位置！）
  - `/storage` → `persistent_storage/`（才是文件实际位置）
- 浏览器请求 `/uploads/audio/...` 走的是 temp/uploads 路径 → 永远 404。
- 又因为 `<audio>` 元素 404 时不会主动报错（只是无法播放），UI 上只看到一个空的播放器条，看起来像"功能坏掉"但没有错误日志。

**Fix**:
1. 把 3 处 `f"/uploads/audio/{filename}"` 全部改成 `f"/storage/audio/{filename}"`，URL 前缀对齐磁盘挂载点。
2. `cluster_main.py` 让 `persistent_storage/` 和 `persistent_storage/audio/` 启动时自动创建——之前用 `if os.path.exists(): mount` 的写法，首次部署目录不存在会**静默跳过 mount**，后续写入的所有音频/图片都 404。改成 `os.makedirs(..., exist_ok=True)` 后再 mount，保证 mount 永远生效。
3. 同步更新 `tests/test_audio_provider.py` 的 mock 返回值，保持契约一致。

**为什么之前 AudioStagePage 批量配音的旧音频也能听？** 因为 AudioStagePage 用 `save_generated_file_to_db()` 返回的 `file_url`（`/storage/audio/<user>/<ym>/...`），而 VoiceSidebar 用的是 `audio_url`（错的那条）。两条路径并存导致问题被掩盖。这次修复后两条路径都指向 `/storage/`。

**Files**:
- `minimax_audio.py` + `deploy/minimax_audio.py`
- `audio_provider.py` + `deploy/audio_provider.py`
- `cluster_main.py` + `deploy/cluster_main.py`：`/storage` mount 改为 auto-create
- `tests/test_audio_provider.py` + deploy 镜像

**Date**: 2026-05-04

---

### Q: 配音页报 `relation "character_voices" does not exist` + MiniMax `2061 your current token plan not support model, speech-02-hd`

**Symptom**:
```
asyncpg.exceptions.UndefinedTableError: relation "character_voices" does not exist
  File ".../dao_character_voice.py", line 49, in get_by_project
  File ".../api_routes.py", line 2380, in get_character_voices

api_routes - ERROR - MiniMax TTS 失败: tts_async 失败:
  {'base_resp': {'status_code': 2061,
   'status_msg': 'your current token plan not support model, speech-02-hd'}}
```

**Root Cause**:
1. `character_voices` 表的迁移 SQL (`db_migration_character_voices.sql`) 没在生产 Postgres 上执行过——`/api/projects/{pid}/character-voices` 一进入项目就 500。
2. MiniMax 默认模型 `speech-02-hd` 用户 token plan 不开放（HD 模型走付费包），需切到 plan 支持的型号。用户指定 `speech-2.8-hd`。

**Fix**:
1. **建表**（在后端服务器上执行一次即可）：
   ```bash
   psql -U <user> -d <db> -f db_migration_character_voices.sql
   ```
   或者复制 `db_migration_character_voices.sql` 内容直接在数据库里跑。建完用 `\dt character_voices` 确认表存在；DAO (`dao_character_voice.py`) 的字段全部对得上。
2. **改默认模型** `speech-02-hd → speech-2.8-hd`，统一改 6 处（每处 root + deploy 镜像 = 12 行）：
   - `minimax_audio.py` 的 `voice_design / voice_clone / tts_async` 三个函数默认值
   - `api_routes.py` 的 `MinimaxVoiceDesignRequest.model` / `MinimaxTTSRequest.model` Pydantic 默认值
   - `new_html/services/apiService.ts` 的 `minimaxVoiceDesign(model='...')` 形参默认
3. 重启后端，前端硬刷新。

**为什么前端有 `model` 参数也得改后端默认**: `VoiceSidebar.handlePreview` 调 `minimaxTTS({voice_id, ...})` 时**没传** `model`，所以 Pydantic 用默认值。AudioStagePage 的批量生成也一样不传 model。改前端默认是为了前端如果显式想覆盖也能传一个新值（不传时还是后端默认接管）。

**Files**:
- `db_migration_character_voices.sql` (root + `deploy/` + `deploy/sql/`)
- `minimax_audio.py` + `deploy/minimax_audio.py`
- `api_routes.py` + `deploy/api_routes.py`
- `new_html/services/apiService.ts` + `deploy/new_html/services/apiService.ts`

**Date**: 2026-05-04

---

### Q: 配音页角色"系统预设"试听调成 Google TTS 了，海螺（MiniMax）反而不用？

**Symptom**:
- 用户期望：第四页"配音"点试听 → 海螺/MiniMax 出声。
- 实际：日志一直是 `audio_provider - ERROR - Gemini audio generation failed: Missing key inputs argument!`，500 Internal Server Error。
- 用户原话："怎么使用的 Google TTS 呢，不应该是海螺么？"

**Root Cause**:
- `VoiceSidebar.tsx` 的"系统预设"用了一组**自造的假 voice id**：`narrator/male_young/female_young/elder/child`。
- "试听"对 system 源调的是 `generateSpeech(persona=systemVoiceId)` → `/api/audio/generate-speech` → **Gemini TTS**。
- MiniMax 只在"声音克隆/声音设计"分支才被调用。所以即使用户配了 `MINIMAX_API_KEY`，"系统预设"试听仍走 Gemini，没 key 就报 `Missing key inputs argument!`。
- 同时 `handleSave` 给 system 源写的是 `voice_provider='gemini'`，导致后续在 `AudioStagePage.handleGenerate` 也按 Gemini 走（同样报错），即便你之后想换成 MiniMax 批量生成也走错路。

**Fix**:
1. `VoiceSidebar.tsx` 的 `SYSTEM_VOICES` 全部换成 **MiniMax T2A 官方预置音色 ID**（`male-qn-qingse / female-shaonv / presenter_male / audiobook_male_1 / cute_boy ...` 共 17 个，按 男声/女声/主持/童声 分组渲染）。
2. `handlePreview` 在 `voiceSource === 'system'` 时改调 `minimaxTTS({ voice_id: systemVoiceId })` → `/api/minimax/tts` → MiniMax 海螺。
3. `handleSave` system 分支写 `voice_provider='minimax'`、`voice_model_id=systemVoiceId`，这样 `AudioStagePage.handleGenerate` 的 `voice.voiceProvider==='minimax'` 分支就会走 MiniMax 批量生成。
4. 兼容历史：旧角色若还存着 `narrator/male_young/...` 这种 legacy id，drawer 打开时通过 `LEGACY_VOICE_ALIAS` 自动映射到对应的 MiniMax 音色（`narrator → presenter_male`、`male_young → male-qn-qingse` ...）。
5. 默认音色从 `narrator` 改为 `presenter_male`。
6. 副作用：`generateSpeech` 在 `VoiceSidebar` 里不再使用（保留全局导出，因为 `AudioStagePage` 在 voice 没配 minimax 时仍用作兜底）。

**结果**: 配音页的"系统预设/克隆/设计"全部统一走 MiniMax 海螺，不再依赖 `GEMINI_API_KEY`。只要 admin 后台配了 `provider=minimax` 的密钥并重启后端，整个配音页都能用。

**Files**:
- `new_html/components/audio/VoiceSidebar.tsx` + `deploy/new_html/components/audio/VoiceSidebar.tsx`：替换 SYSTEM_VOICES、`handlePreview` / `handleSave` 改走 MiniMax、新增 `LEGACY_VOICE_ALIAS`、按组渲染选择面板。

**Date**: 2026-05-04

---

### Q: 后台 API 配置页里看不到"声音 / 配音"专门的分类，配音页 voice-design 该填哪条 key？

**Symptom**: 用户在 admin → API 配置页看到分类是 `文本生成 / 图像生成 / 视频生成 / 音频/TTS / 增强超分 / 工具`，"音频/TTS"分组下只有一条 `Gemini TTS (语音)`，找不到 MiniMax 配音相关条目。

**Root Cause**:
- 配音页"试听"分两条链路：
  - 系统音色 → `GEMINI_API_KEY`，对应 admin 里 `provider=gemini-tts` 的条目（"音频/TTS"分组）。
  - 音色设计 / 克隆 → `MINIMAX_API_KEY`，对应 admin 里 `provider=minimax` 的条目——**但这条按 provider 名分类逻辑被归到了"视频生成"分组**（条目名叫 "MiniMax Hailuo"）。
- 实际上"MiniMax Hailuo"的 key **同时**驱动 Hailuo 视频生成和配音页 voice-design/voice-clone（同一个 `MINIMAX_API_KEY`），只是 admin 里没显式说明，导致用户以为音频要单独再配一条。
- admin/app.js 的 `guessApiCategory` 把任何含 `minimax` 的 provider 都归 `video`，没有"video+audio"双分类的概念。

**Fix**:
- 不改分组逻辑（避免重复条目）。改成在每张卡片下方显示一行 hint 文字，明确写出该 key 在系统里被哪些功能使用。
- MiniMax 的 hint 显式写明"同时驱动视频 + 配音"，引导用户。
- 用户配置后**必须重启后端** —— `load_api_configs_to_env()` 只在 lifespan startup 时运行一次。重启日志里应能看到 `📦 从数据库加载了 N 个 API 配置到环境变量`。

**Files**:
- `admin/app.js` + `deploy/admin/app.js`：`renderApiCard` 增加 `usageHints` 字典，每个 provider 显示一行说明。

**Date**: 2026-05-03

---

### Q: 配音页（第四页）声音配置点击"试听"，前端无反应，后台日志报 `Missing key inputs argument!` 或 MiniMax `1004 login fail`

**Symptom**: 后端日志：
```
audio_provider - ERROR - Gemini audio generation failed: Missing key inputs argument! To use the Google AI API, provide (`api_key`) arguments.
INFO:  POST /api/audio/generate-speech HTTP/1.1 500 Internal Server Error
api_routes - ERROR - MiniMax voice_design 失败: ... login fail: Please carry the API secret key in the 'Authorization' field of the request header
INFO:  POST /api/minimax/voice-design HTTP/1.1 500 Internal Server Error
```
前端只 `console.error`，用户看不到任何提示。

**Root Cause**:
- "试听"按钮根据 `voiceSource` 调两个不同接口：
  - `system` → `/api/audio/generate-speech` → `GeminiAudioProvider`，需要 `GEMINI_API_KEY`。
  - `design`/`clone` → `/api/minimax/...`，需要 `MINIMAX_API_KEY`。
- 这两个 key **没在数据库 `api_configurations` 表里配置**（provider 名分别是 `gemini-tts` 和 `minimax`），也没在后端 `.env`，`os.getenv()` 拿到空串就传给 SDK，SDK 抛"Missing key inputs argument"。
- 后端把这个 raw error 直接 500 回来，前端 `handlePreview` 只 `console.error`，UI 完全没反馈。

**Fix**:
1. 后端预检（fail-fast）：
   - `GeminiAudioProvider._call_gemini` 在调 SDK 前检查 `self.api_key`，缺则抛带说明的 `RuntimeError`。
   - `_require_minimax_client` 也加 `client.api_key` 检查，缺则 503。
   - `gen_speech` endpoint 把这两类错误转成 503 + 中文 `detail`，方便前端展示。
2. 前端 `VoiceSidebar.handlePreview` `catch` 后 `alert(e.message)`，并对"未配置/API_KEY"关键字做特殊提示，让用户知道去 admin → API 配置加 key。
3. 真正解决：在管理员后台 → API 配置 中添加 `provider=gemini-tts` 和/或 `provider=minimax` 的密钥（数据库走 `ApiConfigDAO._encrypt_key` 加密存储），后端启动时 `load_api_configs_to_env()` 会注入 `GEMINI_API_KEY`/`MINIMAX_API_KEY` 环境变量。**改完密钥需重启后端**，因为 env 注入只在 startup 时跑一次。

**Files**:
- `audio_provider.py` + `deploy/audio_provider.py`：`GeminiAudioProvider._call_gemini` 加 api_key 预检。
- `api_routes.py` + `deploy/api_routes.py`：`gen_speech` 改写错误处理；`_require_minimax_client` 加 api_key 预检。
- `new_html/components/audio/VoiceSidebar.tsx` + `deploy` 镜像：`handlePreview` 错误用 `alert` 给用户提示。

**Date**: 2026-05-03

---

### Q: 设计页 AI 生图的"筑基"（豆包）引擎，参考图功能（单图生图/多图生图/单图生组图/多图生组图）全部不可用；组图张数也不受控

**Symptom**:
- 用户在设计页 → AI 生图 → 选"筑基境界"（doubao）→ 勾选 1+ 张参考图 → 点开始生成 → 接口报错或生成结果与参考图无关。
- 勾选"关联组图"，张数选 3，但实际只回 1 张或者随机张数。

**Root Cause**:
后端 `cluster_main.py:generate_doubao_images` 的 payload 是用旧版火山 CV 图像处理 API 的格式拼的，端点却换成了新版 Ark `https://ark.cn-beijing.volces.com/api/v3/images/generations`。新接口规范见 [Ark Seedream 文档](https://www.volcengine.com/docs/82379/1666945)。逐项对照：

| 字段 | 新版 Ark 规范 | 当前代码 | 行为 |
|---|---|---|---|
| 参考图字段名 | `image` | `images` | 整个字段被服务端忽略，**所有 image-to-image 完全失效** |
| 参考图值结构 | string 或 string[]，`data:image/<fmt>;base64,<b64>` 或 URL | `[{name,type:"image_base64",content:<裸b64>}]` | 即使字段名对，结构也不对 |
| 组图张数控制 | `sequential_image_generation_options.max_images` (1-15) | `n: count`（OpenAI 风格，不在规范里） | 服务端忽略 `n`，张数走默认值 |
| 水印开关 | `watermark: false` | `logo_info: {add_logo: false}` | 服务端忽略，**所有图都带"AI生成"水印** |
| 单图最多参考图 | 14 | 前端硬编码 10 | 用户没法用满 |
| 张数上限 | 15 | Pydantic `le=5` + 前端 `max=5` | 用户没法用满 |

**Fix**:
- 新增 `to_doubao_image_input(ref)` 助手：把 data URL / `/storage/...` 路径 / http(s) URL 统一转成 Ark 接受的 `data:image/<fmt>;base64,<b64>` 字符串。
- 重写 payload：
  - `image` 替代 `images`，单图传 string，多图传 string[]，最多 14 张。
  - `sequential_image_generation` 为 `auto` 时，发 `sequential_image_generation_options.max_images = min(count, 15 - len(refs))`，强制满足 "参考图+生成 ≤ 15"。
  - `watermark: False` 替代 `logo_info`。
  - 移除 `n`（不在规范里）。
- Pydantic `count: int = Field(1, ge=1, le=15)`（原来 `le=5`）。
- 前端 `UnifiedAIModal`：豆包 `maxRefs` 10 → 14；张数 `max=5` → `max=15`，旁边加提示"参考图+生成≤15"。

**Files**:
- `cluster_main.py` + `deploy/cluster_main.py`（新增 `to_doubao_image_input`，重写 `generate_doubao_images` payload，放宽 `DoubaoImageRequest.count`）。
- `new_html/pages/DesignPage.tsx` + `deploy/new_html/pages/DesignPage.tsx`（`UnifiedAIModal` 限制放宽）。

**部署提醒**: 后端必须重启才生效（payload 是 Python 端拼的）。

**Date**: 2026-05-03

---

### Q: 设计页"AI 润色"生成的提示词，关闭窗口后就没了，下次打开还得重新润色

**Symptom**: 用户在设计页 → "AI 生图" → "AI 润色" 把提示词润色得很好 → 关掉/取消窗口 → 下次再打开同一个素材的 AI 生图弹窗 → 提示词回到了 `description || name`，润色结果丢失。

**Root Cause**:
- `UnifiedAIModal` 的 `prompt` 只是组件内的 `useState`，初始值固定为 `asset.description || asset.name`。
- AI 润色成功后只调 `setPrompt(result.trim())` 更新本地 state，**没有任何持久化路径**。
- 关窗 → React 卸载组件 → state 销毁 → 下次重建组件，又从 `description || name` 起步。

**Fix**:
- 用素材自带的 `style_params` JSONB 字段（assets 表已有，不需要迁移）存 `ai_prompt`：
  - 后端 `AssetUpdate` Pydantic 增加 `style_params: Optional[dict]`、`tags: Optional[list]`（DAO 层 `update` 早就支持，是 Pydantic 没暴露）。
  - 前端 `UnifiedAIModal` 改为：
    1. 初始值 `asset.styleParams?.ai_prompt || asset.description || asset.name`。
    2. AI 润色成功后立即调用 `updateAsset(id, { style_params: { ...existing, ai_prompt: refined } })`。
    3. 关闭/取消/点开始生成时也兜底保存一次（仅当文本变化）。
    4. 保存完调 `forceReloadSlices('assets')` 让 `EpisodeContext.assets` 拿到新值，下次开窗就能预填。

**Files**:
- `api_routes.py` + `deploy/api_routes.py`：`AssetUpdate` 增加 `style_params`、`tags` 字段。
- `new_html/pages/DesignPage.tsx` + `deploy/new_html/pages/DesignPage.tsx`：`UnifiedAIModal` 持久化 `ai_prompt`。

**Date**: 2026-05-03

---

### Q: 在设计页删除人物/场景卡片后，回到剧本页重新点击"导出"，被删的人物没有按剧本数据恢复

**Symptom**:
1. 用户先在剧本页导出 → 设计页出现人物 "张三"。
2. 用户在设计页删除 "张三"（卡片消失）。
3. 用户回到剧本页（分镜上仍显示 "张三" 标签），重新点击 "导出到设计页"。
4. 跳转到设计页后，"张三" 仍然不存在，看起来像"已经删除的内容就没了，恢复不了"。

**Root Cause**:
- 删除资产只是 `DELETE FROM assets`，并未清掉 `storyboard_items.bound_assets`，所以分镜上仍然有 `char:张三` 标签 → 后端 `export_script` 接收到 `characters=["张三"]`，且 `existing_assets` 中没有它，确实重新 INSERT 了张三 ✓。
- **真正的问题在前端缓存**：`EpisodeContext` 的 `loadSlices` 是幂等的——`assets` 这个 slice 一旦加载过，再调用 `loadSlices('assets')` 会被 `loadedSlicesRef` 短路掉：
  ```typescript
  const loadSlices = useCallback(async (...slices) => {
    const newSlices = slices.filter(s => !loadedSlicesRef.current.has(s));
    if (newSlices.length === 0) return;   // ← 已加载就直接 return
    await fetchSlices(...newSlices);
  }, [fetchSlices]);
  ```
- 用户在设计页 → 加载 assets（含张三）→ 删除张三 → reload 把 assets 改成空 → 跳到剧本页（DesignPage 卸载，但 EpisodeContext 在路由层之上，`loadedSlicesRef` 仍然记着 'assets' 已加载）→ 剧本页导出 API 成功（DB 里张三已重新插入）→ 路由跳回设计页 → DesignPage useEffect 调 `loadSlices('assets', 'script')` → 被短路，**用的还是删除后的空 assets 缓存**。
- 表象就是：DB 里张三回来了，但前端不去 fetch，UI 一直显示空。

**Fix**:
- 在 `WorkspaceApp` 的 `handleExportStoryboards` 成功之后、`routerNavigate` 之前，先回调 `onAfterExport()` 触发 `EpisodeContext.forceReloadSlices('assets', 'script', 'storyboardItems')` 强制刷新（绕过 loadedSlicesRef 短路）。
- `ScriptPage` 注入这个回调；`forceReloadSlices` 已经存在，本质就是 `fetchSlices`。

**Files**:
- `new_html/pages/ScriptPage.tsx`（+ `deploy/new_html/pages/ScriptPage.tsx`）：注入 `onAfterExport`。
- `new_html/WorkspaceApp.tsx`（+ `deploy` 镜像）：新增 `onAfterExport` prop，导出成功后 `await onAfterExport?.()`。

**Date**: 2026-05-03

---

## 部署 / 数据库初始化

### Q: 部署后所有 API 返回 500，日志显示 `relation "api_configurations" does not exist`

**Symptom**: 新环境部署后，后端启动日志出现 `WARNING - ⚠️ 从数据库加载API配置失败: relation "api_configurations" does not exist`。前端所有页面 500：`/api/projects`、`/api/tasks/active`、`/api/tasks/notifications`、`/api/notifications/unread-count` 全部 Internal Server Error。

**Root Cause**: 部署时只执行了 `database_schema.sql`（基础 10 张表：users, projects, versions, files, text_contents, tasks, task_files, activity_logs, system_configs, file_shares），但没有执行后续 13 个迁移脚本。核心缺失：
- `project_members` 表（`db_migration_project_hub.sql`）→ `/api/projects` 500（`get_user_accessible_projects` JOIN `project_members`）
- `notifications` 表（`db_migration_notifications.sql`）→ `/api/notifications/unread-count` 500
- `api_configurations` 表（`db_migration_admin.sql`）→ 启动时 `load_api_configs_to_env()` 失败
- `tasks` 表缺少 `source_page/category` 列（`db_migration_project_hub.sql`）→ `/api/tasks/active` 500
- `episodes`, `assets`, `storyboard_items`, `video_segments` 等表全部缺失

**Fix**: 按顺序执行全部迁移脚本（所有脚本均幂等，`IF NOT EXISTS` / `IF NOT EXISTS` 可安全重复执行）：
```bash
PGPASSWORD='密码' DB_USER=my2_user DB_NAME=my2_db DB_HOST=localhost
for f in \
    deploy/sql/db_migration_project_hub.sql \
    deploy/sql/db_migration_add_permissions.sql \
    deploy/sql/db_migration_notifications.sql \
    deploy/sql/db_migration_episodes.sql \
    deploy/sql/db_migration_assets.sql \
    deploy/sql/db_migration_episode_scripts.sql \
    deploy/sql/db_migration_storyboard_items.sql \
    deploy/sql/db_migration_video_segments.sql \
    deploy/sql/db_migration_timeline_tracks.sql \
    deploy/sql/db_migration_audio_tracks.sql \
    deploy/sql/db_migration_admin.sql \
    deploy/sql/db_migration_multi_scripts.sql \
    deploy/sql/db_migration_script_id.sql; do
    psql -U "$DB_USER" -d "$DB_NAME" -h "$DB_HOST" -f "$f" 2>/dev/null || true
done
```
执行后重启后端 `pkill -f cluster_main.py && python3 cluster_main.py`。

**Files**: `deploy/sql/database_schema.sql`, `deploy/sql/db_migration_*.sql`（共 13 个）
**Date**: 2026-05-03

**教训**：`database_schema.sql` 只是基础表，系统正常运行依赖全部迁移脚本。部署文档 `docs/deployment.md` §4.2 已包含完整执行顺序。后续新增迁移脚本时也要同步更新 `deploy/auto_deploy.sh` 中的 `SQL_FILES` 数组。

### Q: 部分迁移执行后仍报 `column "sort_order" does not exist`

**Symptom**: 执行了部分迁移脚本后（如 `db_migration_episode_scripts.sql` 创建了 `episode_scripts` 表），访问剧本页面报 `UndefinedColumnError: column "sort_order" does not exist`。调用链：`api_routes.py:2233 list_scripts` → `EpisodeScriptDAO.list_by_episode` → `ORDER BY sort_order`。

**Root Cause**: `episode_scripts` 表由 `db_migration_episode_scripts.sql` 创建，但 `sort_order` 和 `file_name` 列由后续的 `db_migration_multi_scripts.sql` 添加。漏执行了这个脚本。迁移脚本之间存在依赖顺序，部分执行会导致表存在但缺列。

**Fix**: 执行漏掉的迁移脚本：`psql -U my2_user -d my2_db -f deploy/sql/db_migration_multi_scripts.sql`。为保险起见，建议按 `docs/deployment.md` §4.2 的完整顺序重跑全部 13 个迁移脚本（均幂等）。执行后重启后端使 asyncpg prepared statement 缓存刷新。

**Files**: `deploy/sql/db_migration_multi_scripts.sql`, `dao_episode_script.py`
**Date**: 2026-05-03

---

## AI 服务集成

### Q: DeepSeek 流式响应完成后报 "There is no current event loop in thread 'AnyIO worker thread'"

**Symptom**: 调用 `/api/deepseek/chat`，前端 SSE 正常拿到全部文本，HTTP 200。但服务端日志最后一行：
```
ERROR - ⚠️ 保存文本结果失败: There is no current event loop in thread 'AnyIO worker thread'.
```
数据库里 `tasks` 表对应 `deepseek_text_*` 行的 `status` 永远停留在 `processing`，`result_data` 为空。

**Root Cause**: `call_deepseek_stream` 是 **sync generator**（用 `yield`）。Starlette 把它包成 `StreamingResponse` 后，通过 `iterate_in_threadpool` → `anyio.to_thread.run_sync` 在 anyio **worker thread** 里迭代。流结束后的"持久化全文"代码块写的是：
```python
loop = asyncio.get_event_loop()
if loop.is_running():
    asyncio.create_task(_save_text_result(...))
else:
    loop.run_until_complete(_save_text_result(...))
```
两个分支在 worker thread 里都是错的：
1. `asyncio.get_event_loop()` 在没有 running loop 的非主线程，Python 3.10+ DeprecationWarning，新版本直接 `RuntimeError`（用户看到的就是这个）。
2. 即便侥幸拿到一个新 loop，`run_until_complete` 会在 worker thread 创建一个**新事件循环**。但 asyncpg 连接池绑定在创建它的**主**事件循环上，跨 loop 使用会再爆一个 `Future attached to a different loop`。
3. `create_task` 也得有 running loop in current thread —— worker thread 一样没有。

**Fix**: 在启动时显式持有主事件循环引用，worker thread 中通过 `run_coroutine_threadsafe(coro, MAIN_EVENT_LOOP)` 把协程调度回主 loop（asyncpg 池所在的那个 loop）：
1. `cluster_main.py` 模块级新增 `MAIN_EVENT_LOOP: Optional[asyncio.AbstractEventLoop] = None`
2. `lifespan(app)` 启动时 `MAIN_EVENT_LOOP = asyncio.get_running_loop()`
3. `call_deepseek_stream` 末尾保存块改为：
   ```python
   if MAIN_EVENT_LOOP is not None and not MAIN_EVENT_LOOP.is_closed():
       asyncio.run_coroutine_threadsafe(
           _save_text_result(task_id, complete_text),
           MAIN_EVENT_LOOP,
       )
   ```
   `run_coroutine_threadsafe` 是线程安全的、立即返回 `concurrent.futures.Future`、不阻塞 worker thread，且协程在 asyncpg 池所在的主 loop 里执行 → 全部解锁。

**Files**: `cluster_main.py`, `deploy/cluster_main.py`
**Date**: 2026-05-02

**教训**: 任何 sync generator + StreamingResponse 组合下的 fire-and-forget 协程都不能用 `asyncio.get_event_loop()`，必须显式持有主 loop 并用 `run_coroutine_threadsafe`。如果以后还有别的 sync streaming 端点（豆包文生、自定义 SSE 等）有类似 "流结束后落库" 需求，复用 `MAIN_EVENT_LOOP` 这个变量即可。

---

### Q: 文字脚本→分镜脚本只生成 10 个镜头，后半部分丢失

**Symptom**: 用户在剧本页面点击"AI 改写"将文字脚本转为分镜脚本。AI 实际处理完了全部输入（`scriptContent` 可见全部段落的原始流式文本，或者前端流式过程中能看到 `<<<CONTINUE_FROM 镜头11>>>`），但右侧分镜卡片只有 10 个，后半部分镜头缺失。

**Root Causes (两个独立 bug 叠加)**:

**Bug 1：跨段镜头编号冲突触发自毁式去重过滤器**
1. `handleRewrite` 把输入按 10 个镜头切成多段独立调用 `aiGenerateStoryboardScript`。系统提示词 (`scriptPrompts.ts` 中 `GENERATE_STORYBOARD_SCRIPT`) 要求"镜头ID行：镜头01 / 镜头02 / ..."且"本次最多输出10个镜头块"。每段是独立 prompt，AI 每段都从 `镜头01` 开始编号。
2. `convertToStoryboardItem` 把 `shotNumber` 设为 AI 输出的 `镜头01`...`镜头10`。
3. 旧合并阶段的去重逻辑 `parsedItems = parsedItems.filter(item => !existingShotNumbers.has(item.shotNumber))` 会把第 2/3/... 段的 `镜头01-镜头10` 全部过滤掉，因为这些编号在第 1 段已存在。
4. 净结果：只保留第 1 段的 10 个镜头；`scriptContent`（显示文本）没有这层过滤，所以用户看到完整的文本但只有 10 张卡片。

**Bug 2：单段命中 AI 10 镜头硬上限，前端忽略 `<<<CONTINUE_FROM>>>`**
- `segmentInputContent` 只有当输入里检测到 **>10 个 `镜头N` 标记** 才会切段。否则只产出 1 段（叙事文本无标记 + 段落 ≤10 时走 `segmentByParagraphs` 也是单段；标记 ≤10 时直接 `[content]` 单段）。
- 系统提示词第 5 条要求 AI 单次最多输出 10 个镜头块；超出则末尾输出 `<<<CONTINUE_FROM 镜头XX>>>`。
- 旧代码注释 `🔧 不再使用续写逻辑（分段处理已解决问题）` 错误地相信了"分段一定能切开"，于是删除了对 `<<<CONTINUE_FROM>>>` 的响应，导致单段超出 10 个镜头时第二半内容永久丢失。

**Fix**: 双层修复：

修复 Bug 1（全局重编号 + 移除假去重）：
1. 新增局部 `renumberItem(item, seqNum)` 助手：把 `shotNumber` 改为基于 `allParsedItems.length + 段内偏移 + 1` 的全局序号，并同步重写 `originalText` 首行的 `镜头XX`
2. 在 `handleStreamChunk` 和 `finalizeCurrentBuffer` 内 `convertToStoryboardItem` 后立即用 `renumberItem` 编号 —— 流式 UI 显示的镜头编号也是连续的
3. 段结束后空镜头过滤可能留下编号空洞 → 再用 `renumberItem` 整体重排
4. 删除 `existingShotNumbers` 跨段去重块（保留注释警示后人）。`item.id` 仍是 `uuidv4()`，React key 不冲突

修复 Bug 2（重启段内续写循环）：
1. 在 `finalizeCurrentBuffer()` 之后扫描 `fullAccumulatedScript` 中的 `<<<CONTINUE_FROM\s+(镜头\d+)>>>`
2. 检测到则调用 `aiContinueStoryboardScript(aiModel, nextShotId, segment, handleStreamChunk)`，把同一段重投给 AI 并要求从 `nextShotId` 接着写
3. 每次续写前重置 `streamBuffer / fullAccumulatedScript`；新解析出的 shot 由全局重编号统一接管编号
4. 安全上限 `MAX_CONTINUATIONS_PER_SEGMENT = 8`（≈ 单段 90 个镜头封顶）防止 AI 误判死循环
5. 即使 AI 续写时偶尔重复某些已生成的镜头，因为全局重编号没有去重，最坏只是产生少量重复卡片（用户可手删），永远不会再出现"丢失后半"

**Files**: `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-02 (Bug 1 + Bug 2 同日修复)

---

### Q: 文字脚本→分镜脚本（Bug 1+2 修复后）依然只生成 10 个镜头

**Symptom**: 应用 2026-05-02 的 Bug 1（全局重编号）+ Bug 2（重启续写循环）修复后，输入"远超 10 个镜头"的长叙事文本时，仍然只看到 10 个分镜卡片。控制台没有任何 `🔄 第 N 段第 N 次续写` 日志，或者有续写日志但续写产出的镜头全部被空过滤掉。

**Root Cause (Bug 3)**: `aiContinueStoryboardScript(aiModel, nextShotId, segment, ...)` 的第 3 个参数 `remainingText` 实际收到的是 **当前段的完整原文**，不是真正的"剩余文本"。`CONTINUE_STORYBOARD_SCRIPT` 的 system prompt 又禁止"重复已输出的镜头"。AI 续写时面对：
- 输入：和上一轮一字不差的同一段原文
- 指令：从 `镜头XX` 开始编号继续，但不能重复已输出的内容
- 上下文：**没有任何信息告诉 AI 上一轮已经覆盖到原文的哪一段**

AI 唯一合理的反应是判定"已全部转换完成"不输出 `<<<CONTINUE_FROM>>>` → 续写循环退出 → 用户看到的就只剩第一次的 10 个镜头。少数情况 AI 会硬着头皮再生成一遍镜头01-10 的内容（被全局重编号成镜头11-20），表现为"卡片数翻倍但内容重复"。

特别隐蔽的是这个 bug 在场景 C（输入有 >10 个 `镜头N` 标记）下不暴露 —— 因为 `segmentInputContent` 已经把输入切成了多段独立调用，根本不走续写路径。只在场景 A（无 `镜头N` 标记的纯叙事文本）和场景 B（有 ≤10 个 `镜头N` 标记但 AI 实际想拆出更多镜头）下触发。

**Fix**: 给续写 AI 提供"已生成镜头摘要"作为定位上下文：
1. `aiContinueStoryboardScript` 签名插入第 4 个参数 `previousShotsContext: string = ''`（默认空，向后兼容）
2. `CONTINUE_STORYBOARD_SCRIPT` prompt 重写：
   - 新增 `{previousShotsContext}` 占位符放在原文之前作为"已覆盖区域索引"
   - system 改为"严禁重复或重新转换已生成镜头摘要中的内容"
   - user 任务描述改为"基于已生成镜头摘要判断已覆盖到原文哪一段，然后从 `{nextShotId}` 开始紧接其后继续转换"
3. `WorkspaceApp.handleRewrite` 内新增 `buildPreviousShotsSummary(items)` helper：取 `[...allParsedItems, ...parsedItems]` 最近 10 条，每条格式为 `镜头XX：scriptSegment 前 80 字`，token 占用可控
4. 续写循环中：`buildPreviousShotsSummary([...allParsedItems, ...parsedItems])` 后传入 `aiContinueStoryboardScript`

修复后 AI 能精确判定"原文这部分已经被覆盖了，我从这段后面继续"，续写实际生效，长文本一直生成到末尾。

**Files**: `new_html/prompts/scriptPrompts.ts`, `deploy/new_html/prompts/scriptPrompts.ts`, `new_html/services/aiModelService.ts`, `deploy/new_html/services/aiModelService.ts`, `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-02

**教训**：续写类 prompt 的"剩余文本"参数命名极其危险 —— 调用方很容易误把全文塞进去（看上去也"逻辑通顺"），但 AI 缺少"已覆盖到哪里"的锚点就完全无法定位接续点。设计这类 prompt 时必须显式区分 "原文" + "已覆盖区域索引"两个独立输入，并在 system prompt 里强制 AI 用后者定位。后续若再出现类似多轮生成场景（比如长视频脚本续写、长台词续写），都要套这个模式。

---

### Q: 文字脚本→分镜脚本续写出来的镜头卡片"生图 Prompt / 视频 Prompt"是空的（只有人物台词有内容）

**Symptom**: Bug 1+2+3 修复后续写循环正确触发并生成了大量镜头（比如镜头11-30），但右侧分镜列表里这些续写镜头卡片的"生图 Prompt"和"视频 Prompt"输入框完全空白，只有"人物台词"有内容。第一段（镜头01-10）正常。

**Root Cause (Bug 4)**: 用户输入的文字脚本采用了**合并字段名 + 列表标记**格式（典型形态）：

```
镜头25：
- 取景/角度/机位：近景，小乙揉着头
- 站位与构图：小乙低头揉头，女生叉腰
- 动作与神态：小乙委屈，女生生气
- 氛围与特效：无
- 人声：小乙："好好好..."
```

AI 看到原文这种格式后**忠实模仿**输出（这是 LLM 的常见行为，即使 system prompt 要求独立字段也会被原文风格带偏，尤其是续写时上下文压力大）。但 `parseBlockFields` 的字段匹配逻辑有两个硬限制：

1. `line.startsWith(fieldName + '：')`：行首不能有任何前缀字符。`- 取景：xxx` 因为开头是 `-` 而不是 `取景` → 匹配失败 → 整行被忽略
2. `knownFields` 列表里只有独立字段名（`取景`、`角度`、`机位` 等），没有 `取景/角度/机位` 这种合并形式 → `取景/角度/机位：xxx` 行也被完全忽略

结果：AI 输出的"取景/角度/机位"行（关键的 3 个视觉字段一锅端）整个进解析黑洞，`fields.取景/角度/机位` 全是 undefined → `convertToStoryboardItem` 拼 imagePrompt 时这 3 个位置全空 → 只剩"站位与构图 + 氛围与特效"贡献，但如果 AI 同时把这两个也用了列表前缀（`- 站位与构图：xxx`），它们也一起被忽略 → 最终 `imagePromptParts = []` → `imagePrompt = ''`。同理 `videoPrompt`。

只有"人声：xxx"行偶尔被识别（取决于 AI 是否给它加了前缀），所以用户看到台词有内容但 prompt 全空。

特别隐蔽：第一段（镜头01-10）通常正常，因为第一段 AI 受 system prompt 约束更强，输出格式比较规范；续写时 AI 上下文里有【完整原文】作为前文，原文格式带歪率显著上升。

**Fix**: 三层修复（任意一层失效另外两层兜底）：

1. **Parser 去前缀**（`storyboardParser.ts:parseBlockFields`）：行首 `\s\-\*•·◦→●○` 全部 strip，让 `- 取景：xxx` 和 `* 站位与构图：xxx` 都能进字段匹配
2. **Parser 识别合并字段名**（`storyboardParser.ts:parseBlockFields`）：在主字段循环之前增加一段，匹配 `^([^：:]+)[：:](.*)$`，若字段名部分含 `/`、`／`、`、` 分隔符且每个分量都在 `knownFields` 里且数量 ≥2，就把整个值赋给**第一个**已知字段（避免 imagePromptParts 重复）。这样 `取景/角度/机位：近景，小乙揉着头` → `fields.取景 = "近景，小乙揉着头"`，imagePrompt 至少有这部分内容
3. **Prompt 硬约束**（`scriptPrompts.ts`）：`GENERATE_STORYBOARD_SCRIPT` 增加第 6 条、`CONTINUE_STORYBOARD_SCRIPT` system 增加字段格式硬约束，强制独立字段名 + 禁列表标记 + 强制中文冒号。降低触发 parser 兜底的概率

**Files**: `new_html/utils/storyboardParser.ts`, `deploy/new_html/utils/storyboardParser.ts`, `new_html/prompts/scriptPrompts.ts`, `deploy/new_html/prompts/scriptPrompts.ts`
**Date**: 2026-05-02

**教训**：基于"行首字段名"的解析器对 LLM 输出极不鲁棒 —— LLM 会严格模仿输入风格，任何"列表标记 / 合并字段名 / 异常分隔符 / 全角字符"都会让纯字符串前缀匹配失效。这类 parser 必须默认假设上游产生格式漂移，主动 strip 前缀字符 + 支持复合字段名 + 兜底 fallback（`视觉化描述` 等）。后续若新增类似"AI 输出 → 字段提取"的解析器（角色卡、场景卡、配音卡），都要套这套预处理。

---

### Q: 点击"导出 Excel" 报 `Uncaught TypeError: ye.replace is not a function`

**Symptom**: 在剧本页面右下角点击"导出 Excel"按钮（生成分镜 CSV），控制台抛 `Uncaught TypeError: ye.replace is not a function`，调用栈底部是 `Array.map` → `onClick`。CSV 文件没下载下来。

**Root Cause (Bug 5)**: `new_html/types.ts` 把 `StoryboardItem.shotNumber` 声明成 `string | number`（联合类型）。`ScriptColumn.tsx:exportStoryboardToExcel` 用了：

```ts
item.shotNumber?.replace(/镜头0?/, '') || `${index + 1}`.padStart(3, '0')
```

可选链 `?.` 只在 `shotNumber === null/undefined` 时短路 —— 当 `shotNumber` 是 number（比如 `11`）时不短路，直接 `(11).replace(...)` → TypeError。

`shotNumber = number` 不是边缘情况：
- `WorkspaceApp.tsx:199` `loadEpisodeData` 从后端读分镜后赋值 `shotNumber: idx + 1`（number）
- `WorkspaceApp.tsx:1678` `aiExtractShotsFromScript` 提取分镜路径赋值 `index + 1`（number）
- `WorkspaceApp.tsx:1950` 类似路径

也就是说，所有"非 handleRewrite 路径"产生的分镜都带 number `shotNumber`，导出按它们就 100% 炸。`ScriptColumn.tsx:200/220` 的 `shotNumber?.match(/\d+/)?.[0]` 同样的坑（用于"在选中文本里定位镜头"功能），`WorkspaceApp.tsx:864/884` 也是。

**Fix**: 加 `getShotNumberStr(sn) → string` helper（`null/undefined → ''`，`number → String(number)`，`string → 原值`），把 6 处 `shotNumber?.replace/.match/||` 全部改成 `getShotNumberStr(item.shotNumber).xxx`。修复了导出 Excel + 选中文本镜头匹配两条调用链。

**Files**: `new_html/components/ScriptColumn.tsx`, `deploy/new_html/components/ScriptColumn.tsx`, `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-02

**教训**：TypeScript 联合类型 `string | number` 配可选链 `?.` 是经典陷阱 —— `?.` 不收窄类型，只防 nullish。任何对联合类型直接调字符串方法的地方都需要先 `String(...)` 或 typeof 收窄。如果觉得调用站满天飞，应该在 schema 层（types.ts / 后端序列化层）就统一类型而不是放任联合类型流到调用站。

---

### Q: 文字脚本 92 个镜头，AI 改写后却生成了 450 个分镜（4-5 倍重复）

**Symptom**: 用户输入 92 个 `镜头N` 标记的文字脚本，点击 AI 改写后右侧分镜列表显示 450 个分镜（4.9x）。生成内容前几段反复出现，后半段原文压根没被覆盖。日志里能看到大量 `🔄 第 N 段第 N 次续写` 信息，每段都触发了 8 次续写循环。

**Root Cause (Bug 6)**: `handleRewrite` 的续写循环完全依赖 AI 输出 `<<<CONTINUE_FROM>>>` 标记决定何时停。但 AI（特别是上下文压力下的续写场景）会**习惯性输出 CONTINUE_FROM，无视 prompt 里的"已全部转换完成不要输出"约束**。

数学：92 镜头 → `segmentInputContent(content, 10, 0)` 切成 10 段 → 每段实际只需 ~10 个镜头但触发 8 次续写 → 每段 ~50 镜头 × 9-10 段 ≈ 450 个。最后 `slice(0, totalShots=92)` 只截前 92 → 但前 92 全是头几段的重复内容，原文后半永远丢失。

更糟糕：续写产出大量重复内容（同样的镜头编号被改成不同序号），用户根本不知道哪些是重复的。

**Fix**: 三层硬约束（不依赖 AI 自觉判断）：

1. **段内已知镜头数硬上限**：每段处理前 `expectedShotsInSegment = countShots(segment)`（场景 B/C 输入有标记时 > 0）。续写循环前检查：若 `parsedItems.length >= expectedShotsInSegment` 直接 break，不再调 AI。这是"输入即真理"，AI 怎么说都不算
2. **续写零产出 break**：续写前记录 `beforeContinue = parsedItems.length`，续写返回后若 `parsedItems.length - beforeContinue === 0` → AI 没东西可写或在重复 → 立即停。原始有效续写至少会产出 1 个有效镜头，0 产出说明陷入死循环
3. **MAX_CONTINUATIONS_PER_SEGMENT 从 8 → 3**：纯叙事文本场景兜底（场景 A 无 `镜头N` 标记，无法用约束 1）。8 轮 × 10 镜头 = 80 镜头/段太疯，3 轮 × 10 = 30 镜头/段更合理
4. **末尾叙事文本兜底**：原代码 `if (totalShots > 0 && allParsedItems.length > totalShots)` 截断只在有标记时生效。新增 `else if (totalShots === 0)` 分支，按 `Math.max(50, segments.length * 40)` 兜底截断

修复后 92 镜头脚本最多生成 92 个（截到输入数）；叙事文本最多 `段数 × 40` 个（防爆炸）。**绝不会再出现 4-5x 重复**。

**Files**: `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-02

**教训**：LLM 自报 done 信号（`<<<CONTINUE_FROM>>>`、`<<<DONE>>>`、`[FINISH]` 等）极不可靠 —— 续写场景下 AI 会因模仿前文格式、上下文压力、token 预测惯性等等持续输出"继续"信号，哪怕实际已无东西可写。任何"AI 自报何时停"的循环必须配置数据驱动的硬约束（已知数量上限、零产出检测、循环次数硬上限），不能让 LLM 单独决定循环结束。下次写续写/迭代生成的循环时，先列出"硬约束清单"再决定 prompt。

---

### Q: 续写镜头（镜头11+）的字段格式与前 10 个不一致，描述也明显变简

**Symptom**: Bug 1-6 全部修复后，AI 改写能正确生成 92 个镜头不爆炸。但用户发现镜头11 起（即续写部分）每个镜头：
- 字段更少（缺时间、机位、转场、音效等）
- 描述大幅缩水（`站位与构图：人物站立` vs 第一轮的 `站位与构图：女主角站在窗前左侧三分之一处，背对镜头侧身约 30 度，右侧男主角后景虚化入画`）
- 字段名时不时简化（`角度` 而非 `摄像机角度`）

第一轮镜头01-10 完全没有这个问题。

**Root Cause (Bug 7)**: `CONTINUE_STORYBOARD_SCRIPT` 的 system prompt 此前仅 4 行，核心句子是"格式与上一轮完全一致"。但**每次 LLM API 调用都是无状态的**，OpenAI/DeepSeek 等 chat 接口的"上一轮"概念只存在于显式传入的 `messages` history 里。我们的实现每段每轮都是独立 `callAI` 调用，根本没把第一轮的 system+user+assistant 塞进 history。

所以 AI 在续写时看到的输入只是：
- system: "格式与上一轮一致" + 字段拆分约束
- user: 已生成镜头摘要 + 完整原文 + "继续转换"

**没有任何信息告诉 AI 第一轮的字段清单是什么、每个字段的描述详细度要求是什么**。AI 只能根据已生成镜头摘要里的简短文本（`镜头XX：xxx 简短描述`）推测 → 推测出一个简化版本 → 输出短描述、缺字段。

**Fix**: 提取 `STORYBOARD_FIELD_SPEC` 常量包含完整的：
1. 分镜创作要素（10 个要素的具体描述要求，含正反例）
2. 输出格式（每字段独立一行 + 每个字段的最小字数要求 + ---CUT--- 结束）
3. 字段格式硬约束（合并字段禁、列表标记禁、中文冒号、字段名严格、"续写不允许变简"）

`GENERATE_STORYBOARD_SCRIPT` 和 `CONTINUE_STORYBOARD_SCRIPT` 的 system prompt 都通过模板字符串嵌入这个常量。续写 user prompt 里也补一句"每个镜头必须按 system prompt 中的【输出格式】完整填充所有字段，描述详细度与第一轮镜头01-10一致"。

修复后续写 AI 拿到的字段 spec 与第一轮完全一致，输出格式自然对齐。

**Files**: `new_html/prompts/scriptPrompts.ts`, `deploy/new_html/prompts/scriptPrompts.ts`
**Date**: 2026-05-02

**教训**：LLM API 是无状态的 —— "格式与上一轮一致"这种 prompt 短语在多轮独立调用场景下零作用，AI 没有"上一轮"的概念。涉及多轮独立调用的场景（续写、批量分段处理、迭代精修），所有规格细节必须**每轮完整重发**，不能假设 AI"还记得"。如果担心 prompt 重复占 token，提取共享常量 + DRY；不要为了省 token 写"格式与之前一致"这种省略式 prompt。

---

### Q: 续写镜头格式与镜头10 仍不一致（Bug 7 迭代 2 — 抽象规则没用，需要 few-shot 完整样例）

**Symptom**: Bug 7 迭代 1 已经把 `STORYBOARD_FIELD_SPEC` 嵌入 GENERATE 与 CONTINUE 的 system prompt，并加了"每字段最少字数"约束。重测后用户反馈：

镜头10（GENERATE 输出）：
```
镜头10
镜头语言：
    取景：中近景
    摄像机角度：平视
    镜头运动：固定
    机位：女主角正前方
画面描述：
    站位与构图：女主角抬起头，表情有些疲惫和无奈。
    动作与神态：女生叹了口气，语气中带着上班族的辛酸。
    氛围与特效：背景中，窗外是傍晚的景色，暗示下班后的疲惫感。
转场：硬切
人声：女生:"上班太累了..."
时间：2秒
音效：女生叹气声。
人物名称：女生
场景名称：女生卧室
```

镜头11（CONTINUE 输出）：
```
镜头11：中近景，平视。女主角站在画面中央...   ← 镜头ID 行多了总述
取景：中近景                                    ← 没分组标题、没缩进
摄像机角度：平视
镜头运动：固定
机位：正面
站位与构图：女主角居中，画面简洁                ← 10 字（要求 15 字）
动作与神态：女生歪着头，嘴角带着调侃的笑意      ← 15 字（要求 20 字）
氛围与特效：轻松调侃                            ← 4 字（要求 12 字）
人声：女生:"你男朋友还..."
音效：无                                        ← 字段顺序乱（音效跑到转场前）
转场：无
场景名称：女生房间                              ← 时间字段被吞了
人物名称：女生
```

差异：镜头ID 行追加多余总述、缺 `镜头语言：`/`画面描述：` 分组标题、缺 4 空格缩进、字段顺序乱（人声→音效→转场→场景→人物 vs 标准的 转场→人声→时间→音效→人物→场景）、**时间字段被吞**、描述字数不达标。

**Root Cause (Bug 7 迭代 2)**: 上一版 spec 用的是**抽象规则**（"取景至少 3 字"、"独立一行"、"按字段名+冒号"），但 LLM 对抽象规则的执行很弱 —— 它会把规则解释为"大致对就行"。同时 spec 里只列了"输出格式"骨架（字段名 + 字段后括号说明），没有给一个**完整可复制的样例**。AI 续写时手里只有"已生成镜头摘要"（镜头ID + 简短文字），它会把这个简短摘要当成"上一轮的格式样板"去模仿 → 自然输出简短版本。

**Fix**: 把 `STORYBOARD_FIELD_SPEC` 重写为 **few-shot 完整样例驱动**：

1. 在 spec 顶部贴一份完整的 `镜头10` 样例（含分组标题、4 空格缩进、所有字段、---CUT---），以 `==================== 标准镜头块样例 ====================` 包围
2. 9 条格式硬规则**全部以"对照样例"形式表述**（"必须输出'镜头语言：'独占一行无缩进"、"必须以 4 个空格开头"、"字段顺序严格按样例"），并用 ✗ 错误示例显式提醒高频陷阱（特别是镜头ID 行后追加描述文字）
3. 字段最小字数表保留但和具体样例锚定（"取景：至少 2 字（如'中景'、'近景'、'中近景'）"，给真实可复制的字串）
4. CONTINUE 的 system prompt 把"格式与上一轮一致"改成 **"必须与下方【标准镜头块样例】中的镜头10 100% 一致"** —— 让 AI 锚定到 spec 内可见的样例，而不是它看不到的"上一轮"
5. CONTINUE 的 user prompt 在末尾再列一份 6 条精简检查清单（镜头ID 行格式、必出分组标题、4 空格缩进、字段顺序、时间不可省、字数下限），强化关键约束

**Files**: `new_html/prompts/scriptPrompts.ts`, `deploy/new_html/prompts/scriptPrompts.ts`
**Date**: 2026-05-02

**教训**：
- 给 LLM **抽象规则**（"必须独立一行"、"至少 3 字"）的服从率显著低于给 **具体可复制样例**（一份完整 example block）。规则用来兜底，样例用来锚定。
- LLM 续写时如果只看得到"已生成的简短摘要"，会把摘要当成格式模板照搬。让续写对齐的有效手段不是"参考上一轮"（它看不到），而是把**完整样例直接塞进续写 prompt 自身**。
- Prompt 里的 ✗ 错误示例对高频犯规（如"镜头11：中近景，平视..."这种镜头ID 行追加描述）特别有用 —— 直接告诉 AI 你最容易犯哪个错。

---

### Q: DeepSeek 流式接口报巨大 anyio TaskGroup 异常链 + "AI服务未配置"

**Symptom**: 调用 `/api/deepseek/chat` 时后端日志出现层层嵌套的 `ExceptionGroup → TaskGroup → ExceptionGroup → TaskGroup` 异常链，最内层是 `cluster_main.py:626 raise HTTPException(status_code=500, detail="AI服务未配置，请联系管理员")`。前端 SSE 连接直接断开，看不到有意义的错误信息。

**Root Cause**: 两个独立 bug 叠加：
1. **client 未初始化**: `deepseek_client` 仅在模块加载时根据 `DEEPSEEK_API_KEY` 环境变量初始化，启动时再由 `load_api_configs_to_env()` 从 DB enabled 配置中重建一次。如果两处都没有 deepseek key（比如管理员在服务启动后才在管理后台添加 key 但未重启进程），`deepseek_client` 一直为 `None`。
2. **生成器内 raise 引发异常链**: `call_deepseek_stream` 是 generator（用了 `yield`）。`StreamingResponse(call_deepseek_stream(...))` 调用时函数体不执行，仅返回 generator 对象。Starlette 开始流式响应（已发出 `200 text/event-stream` 响应头）后，第一次 `next()` 进入函数体并 `raise HTTPException` —— 此时 HTTP 头已发，无法转换为干净错误响应，触发 anyio TaskGroup 嵌套异常。

**Fix**: 三层修复：
1. **新增 `ensure_deepseek_client()` 异步懒加载助手**：检测到 client 为 None 时，依次从 `os.environ` / DB 中读 deepseek 配置并重建 `OpenAI` 客户端，无需重启进程
2. **路由 `deepseek_chat` 预检**：在返回 `StreamingResponse` 之前 `await ensure_deepseek_client()`，失败则 `raise HTTPException(503, ...)` 返回干净 JSON
3. **生成器内防御**：`call_deepseek_stream` 不再 `raise HTTPException`，改为 `yield` SSE `error` 事件 + `[DONE]`，并把 OpenAI SDK 调用 / 流式读取也用 try/except 包起来 yield error 事件 —— 即使 client 中途失效也不会再产生 TaskGroup 嵌套异常
4. 状态码从 500 → 503（更准确：服务未配置 = 服务暂不可用）

**Files**: `cluster_main.py`, `deploy/cluster_main.py`
**Date**: 2026-05-02

---

## 架构 / 数据隔离

### Q: 分集剧本页面文件列表显示了所有项目而非当前分集数据

**Symptom**: 新建项目 → 进入分集管理 → 点击剧本页面，文件列表中显示的是所有项目（WorkspaceApp 的 legacy 行为），而非当前分集的剧本/分镜数据。项目和分集的数据未隔离。

**Root Cause**: `ScriptPage` 只渲染了 `<WorkspaceApp hideHeader />`，没有传递 `episodeId`。`WorkspaceApp` 内部默认执行 `loadProjectsFromBackend()`，从 `/api/projects` 加载所有项目作为文件列表——这是 legacy 平面项目模型的行为。在新的项目 → 分集层级结构下，WorkspaceApp 应该只加载当前分集的数据。

**Fix**: 两步修改实现分集隔离：
1. **`ScriptPage`**: 从 URL params 提取 `episodeId`，传递给 `WorkspaceApp` 作为必传 prop
2. **`WorkspaceApp`**: `episodeId` 改为必传。删除全部 legacy 项目模式代码（`loadProjectsFromBackend`、`loadProjectById`、`createWelcomeProject`、`saveProject` 调用、`isEpisodeMode` 分支判断），只保留分集数据加载/保存路径（`loadEpisodeData` → `saveEpisodeToBackend`）

**Files**: `new_html/pages/ScriptPage.tsx`, `new_html/WorkspaceApp.tsx`
**Date**: 2026-04-15

---

## 数据持久化

### Q: 设计页面生成的图片在素材页面不显示（跨页面数据不联通）

**症状**: 在设计页面点击 AI 生图后，图片在设计页面正常显示，但进入素材绑定页面后，新生成的图片一张都没有。

**根因**: Entity-File 迁移后，DesignPage 的 `handleAIGeneration` 和 `handleBatchGenerate` 移除了写入 `assets.reference_images` 旧字段的代码（`getAssets→updateAsset→reload` 链），改为只写入 `files` 表并通过 `useEntityFilesQuery` 展示。但 MaterialPage 的 `assetsToMaterialLibrary()` 仍然只读取 `asset.referenceImages` 旧字段，导致看不到新图片。同时，后端 `_sync_legacy_url` 不处理 `asset` + `reference_image` 组合，`save_generated_file_to_db` 也没有自动同步旧字段。

**修复**: 三层修复确保数据联通：
1. **`file_service.py`**: 新增 `_sync_legacy_on_file_create()`，在 `save_generated_file_to_db` 创建文件后自动同步旧字段（`asset.reference_images`、`storyboard_items.*_url`、`video_segments.*_url`）
2. **`worker.py`**: ComfyUI worker 创建文件后也调用 `_sync_legacy_on_file_create()`
3. **`api_routes.py`**: `_sync_legacy_url` 新增 `reference_image` for `asset` 处理分支

**文件**: `file_service.py`, `worker.py`, `api_routes.py`
**日期**: 2026-04-03

---

### Q: 设计页面 AI 生图后旧图片消失（被替换）

**症状**: 在设计页面点击 AI 生图，生成一张新图后，之前生成的图片全部消失，只剩最新一张。

**根因**: `DesignPage.handleAIGeneration` 在生图后调用 `getAssets()` 获取最新资产数据，但返回的是原始 API 响应（snake_case 字段名：`asset_id`、`reference_images`）。前端用 camelCase（`assetId`、`referenceImages`）访问这些字段，导致 `find()` 匹配不到资产（`freshAsset = undefined`），`existing = []`（空数组），最终 `updateAsset` 用 `[...[], ...newUrls]` 覆盖了所有历史图片。同样的问题存在于 `handleUpload`、`handleCameraGenerate`、`handleProcess`、批量生成等 5 处。

**修复 (v1)**: 所有 `getAssets` 后的字段访问改为兼容 snake_case 和 camelCase：`(a.asset_id ?? a.assetId)`、`freshAsset?.reference_images ?? freshAsset?.referenceImages`。

**修复 (v2 — Entity-File 迁移)**: 彻底移除 `getAssets→updateAsset→reload` 链路。改为向生成 API 传递 `entityType/entityId/fileRole/episodeId` 参数，后端自动写入 `files` 表。前端通过 `useEntityFilesQuery` 读取并通过 `invalidateQueries` 自动刷新。同一迁移覆盖了 GenerationPage、MaterialPage、AudioStagePage、VideoPage 所有生成路径。

**文件**: `new_html/pages/DesignPage.tsx`, `new_html/components/GenerationPage.tsx`, `new_html/components/MaterialPage.tsx`, `new_html/pages/AudioStagePage.tsx`, `new_html/components/VideoPage.tsx`, `new_html/services/geminiService.ts`, `new_html/services/apiService.ts`, `new_html/services/videoService.ts`, `new_html/hooks/useGenerateToEntity.ts`

---

### Q: 素材页面绑定/解绑时页面闪烁消失再出现

**症状**: 在素材绑定页面锁定或解除锁定素材时，整个页面会短暂消失（显示加载动画），然后重新出现。

**根因**: `handleBindMaterial` 和 `handleUnbindMaterial` 在级联操作后调用 `reload()`。`reload()` → `loadSlices()` → `setIsLoading(true)` → MaterialsPage L270 渲染骨架屏。但 `saveStoryboardItem()` 已经逐项更新了本地状态，`reload()` 完全多余。

**修复**: 移除两个函数中的 `reload()` 调用和依赖数组中的 `reload` 引用。

**文件**: `new_html/pages/MaterialsPage.tsx`

---

### Q: 生成的图片在前端不显示，或刷新后丢失
**Symptom**: ComfyUI/Gemini 生成完成，后端日志显示成功，但前端 loading 结束后无图片；刷新页面后图片消失。
**Root Cause (v1)**: `GeneratedImage.id` 使用 `uuidv4()` 而非 `r.fileId`，导致 ID 不匹配。
**Root Cause (v2)**: `handleUpdateStoryboardItem` 没有任何本地状态被立即更新。`enhancedFile` 完全依赖 `entityImages`（来自 React Query async 查询），如果 DB 中没有 entity files（agent 路径 `_persist_to_db` 失败或服务器未重启），图片永远不显示。
**Fix (v2)**: StoryboardGenPage 增加 `localImagesRef` 本地缓存。当 `handleUpdateStoryboardItem` 收到 `generatedImages` 时立即存入本地缓存。`enhancedFile` 合并时优先用 DB entityImages，其次用本地缓存。当 DB 数据到达后自动清除本地缓存。
**Files**: `new_html/pages/StoryboardGenPage.tsx`
**Date**: 2026-04-03

### Q: 切换页面后分镜图片丢失
**Symptom**: 生成多张分镜图，选择其中一张后切换页面，回来只剩选中的那张。
**Root Cause**: `onUpdateStoryboardItem` 使用函数式更新 `(prev => ...)` 操作 stale 的 `pseudoFile` 闭包数据，导致更新时覆盖了最新的 entityFiles 查询结果。
**Fix**: 改为直接对象更新 `onUpdateStoryboardItem(id, { generatedImages: [...], selectedImageId: ... })`，依赖 React Query 自动失效获取最新数据。
**Files**: `new_html/components/GenerationPage.tsx`
**Date**: 2026-04-02

### Q: DesignPage 设计了多张参考图，导入素材绑定时只显示一张
**Symptom**: DesignPage 为角色添加了 2 张图片，但 MaterialPage 只显示 1 张。
**Root Cause (v1)**: `handleAIGeneration` 等回调中 `assets` 状态被闭包捕获为旧值，后续生成结果覆盖了之前的 `reference_images` 而非追加。
**Fix (v1)**: 在每次更新前调用 `getAssets(projectId!, episodeId)` 获取最新数据，基于最新的 `referenceImages` 追加。
**Root Cause (v2)**: `assetsToMaterialLibrary()` 只读 `asset.referenceImages`，不含 `asset.thumbnailUrl`。但 DesignPage 渲染时合并了 `thumbnailUrl + referenceImages`。当 `thumbnailUrl` 不在 `referenceImages` 中时（如早期生成的图），两端显示数量不一致。
**Fix (v2)**: `assetsToMaterialLibrary()` 改为合并 `referenceImages + thumbnailUrl`（去重），与 DesignPage 显示逻辑一致。
**Files**: `new_html/utils/episodeAdapters.ts`, `new_html/pages/DesignPage.tsx`
**Date**: 2026-04-03 (updated)

### Q: 历史生成的图片不显示，只显示最新的几张
**Symptom**: 之前生成了很多张图片，但分镜页面只显示最近一批（如 4 张），历史批次全部丢失。
**Root Cause**: 
1. `storyboard_items.generated_image_url` 只存最后选定的 1 张 URL，其余不记录
2. 旧版本生成图片时 `entity_type/entity_id/file_role` 未传入 task data，导致 `files` 表中的记录没有 entity 关联
3. `enhancedFile` 之前只合并 DB entity files + 本地缓存，不读 `generated_image_url` 兜底
**Fix**: 
1. `enhancedFile` 增加第三数据源：`item.generatedImage`（来自 `generated_image_url`）作为兜底，三源去重合并
2. 新增 `migrate_existing_files.py::recover_orphan_files()` 迁移函数：通过 `metadata->task_id` 找同批次已关联文件，复制 entity 信息给孤儿文件
3. 新增 `POST /api/entity-files/migrate` 端点，可一键触发迁移
**Files**: `new_html/pages/StoryboardGenPage.tsx`, `migrate_existing_files.py`, `api_routes.py`
**Date**: 2026-04-03

### Q: 追加生成图片后先显示又消失
**Symptom**: 点击"追加生成"后，前端先显示 8 张图（原 4 + 新 4），然后突然全部消失。
**Root Cause**: 
1. `GenerationPage.generateForShot()` 调用 `onUpdateStoryboardItem` 时只传新图片（replace），触发 StoryboardGenPage 的删除逻辑把旧图删了
2. `enhancedFile` 中 `localImagesRef` 在 DB 有任何数据时就被清除，但此时 DB 数据可能已被删除逻辑清空
**Fix**: 
1. `GenerationPage` 改为 merge 模式：`[...existingImages, ...newImages]`
2. `StoryboardGenPage` 移除自动删除逻辑，改为手动删除
3. `localImagesRef` 仅在 DB 数据量 >= 本地缓存时才清除
**Files**: `new_html/components/GenerationPage.tsx`, `new_html/pages/StoryboardGenPage.tsx`
**Date**: 2026-04-03

### Q: 删除图片只删前端不删数据库
**Symptom**: 点击图片卡片上的删除按钮，图片从界面消失但刷新后又出现。
**Root Cause**: `handleDeleteResult` 只更新前端状态（从 `generatedImages` 数组移除），未调用后端删除 API。
**Fix**: 增加 `deleteEntityFile(fileId)` 调用，对有 `fileId` 的图片执行 DB 软删除。
**Files**: `new_html/components/GenerationPage.tsx`
**Date**: 2026-04-03

---

## 前端交互

### Q: 配音页面角色头像图片裂开
**Symptom**: 声音与配音页面左侧角色列表和 DubbingCard 中的角色头像显示为裂图。
**Root Cause**: `thumbnailUrl` 指向的资源不存在（旧路径或未保存到 persistent_storage），`<img>` 加载失败但没有 fallback。
**Fix**: `<img>` 添加 `onError` 处理器，加载失败时隐藏 img 显示占位图标（User icon 或首字母圆形）。
**Files**: `new_html/components/audio/VoiceSidebar.tsx`, `new_html/components/audio/DubbingCard.tsx`
**Date**: 2026-04-03

### Q: 视频页面"导入全部分镜"按钮无反应 / 导入后仍空白
**Symptom**: 点击"导入全部分镜到视频工作区"后，下方 VideoPage 仍显示空白（0 任务）。
**Root Cause**: 三层叠加 bug:
1. `handleImportAll` 创建 `TaskGroup` 时用了 `imageId` 而非 `ids: [img.id]`（不符合 `TaskGroup` 接口）
2. `VideoPage.loadSession()` 过滤 task groups 时用 `group.imageId`（只出现 1 处），而 VideoPage 其余 32 处全用 `group.ids` → 数据存为 `ids` 后 `loadSession` 用 `imageId` 匹配 → `undefined` → 全部 groups 被过滤掉
3. `handleImportAll` 保存 session 后 `VideoPage` 已 mount 不会重新加载
**Fix**: 
1. `handleImportAll`: 改为 `ids: [img.id]`
2. `VideoPage.loadSession`: 过滤逻辑改为 `group.ids.some(id => validImageIds.has(id))`，兼容旧 `imageId`
3. `VideoPage` 加 `key` prop 在导入完成后强制重新 mount；新增自动导入逻辑
**Files**: `new_html/pages/VideoGenPage.tsx`, `new_html/components/VideoPage.tsx`
**Date**: 2026-04-03

### Q: 添加台词按钮点击后不能输入文字
**Symptom**: AudioStagePage 点击"添加台词"后，对应的 DubbingCard 不渲染输入框。
**Root Cause**: `onTextPersist` 保存了空字符串 `''`，clips 构建器跳过空对话 → DubbingCard 不渲染 → 无输入框 → 死循环。
**Fix**: 保存占位文本 `（请输入台词）` 而非空字符串。
**Files**: `new_html/components/audio/DubbingPanel.tsx`
**Date**: 2026-04-02

### Q: 上传图片使用 base64 而非服务器存储
**Symptom**: GenerationPage 的"上传图片"按钮使用 `FileReader.readAsDataURL()`，图片以 data URL 形式存在内存中，不持久化，刷新后丢失。
**Root Cause**: 上传处理器直接读取文件为 data URL 并存入 `GeneratedImage.url`，未调用 `uploadEntityFile()` 上传到服务器。
**Fix**: 改用 `uploadEntityFile(file, 'storyboard_item', shotId, 'generated_image', episodeId)` 上传到服务器，获得 `/storage/...` URL 后再创建 `GeneratedImage`。
**Files**: `new_html/components/GenerationPage.tsx`
**Date**: 2026-04-03

### Q: 历史页面缩略图显示 414 错误
**Symptom**: HistoryPage 中部分任务缩略图加载失败，控制台显示 414 Request-URI Too Large。
**Root Cause**: `createThumbnailUrl()` 将 base64 data URL 作为 GET 参数传入 `/api/thumbnail?url=...`，URL 长度超限。
**Fix**: 检测 data URL 直接返回，不经过 thumbnail 代理。
**Files**: `new_html/components/HistoryPage.tsx`
**Date**: 2026-04-02

### Q: 管理面板"队列"数字异常大
**Symptom**: Cluster Admin 仪表盘显示"队列 / 处理中"为 30/3，但实际大多数任务已完成。
**Root Cause**: `TaskDAO.get_stats()` 统计 `status IN ('pending', 'queued')` 的所有任务，包含了大量超时未清理的僵尸任务（任务完成但 status 未更新为 completed/failed）。
**Fix**: 
1. 新增 `TaskDAO.cleanup_stale(hours)` 方法，将超时任务标记为 failed
2. 新增 `POST /api/admin/tasks/cleanup` 接口
3. Admin 仪表盘添加"清理僵尸任务"按钮，新增"累计完成/失败"统计卡片
**Files**: `dao_task.py`, `admin_routes.py`, `admin/app.js`, `admin/index.html`
**Date**: 2026-04-03

---

## 后端

### Q: 两个 FileDAO 用哪个？
**Symptom**: 生成的文件没有 entity_type/entity_id 关联，entity-files API 查询不到。
**Root Cause**: 使用了 `dao_file.py` 中的 `FileDAO.create()`，该方法不支持 entity 字段。
**Fix**: 始终使用 `dao_content.py` 中的 `FileDAO.create_file()`，它支持 `entity_type`, `entity_id`, `file_role`, `is_selected`。
**Files**: `dao_file.py`, `dao_content.py`, `file_service.py`
**Date**: 2026-04-02

### Q: SSE 断连后前端数据不刷新
**Symptom**: 长时间不操作后，新生成的内容不自动出现在前端。
**Root Cause**: SSE 连接断开后，轮询降级路径不携带 entity 字段，无法触发精确的 cache invalidation。
**Fix**: 后端 `/api/tasks/notifications` 现在从 `task_data` 提取 `entity_type/entity_id/file_role/episode_id` 返回；前端 `globalTaskManager.ts` 轮询路径构建 notification 时包含这四个字段。
**Files**: `api_routes.py`, `new_html/services/globalTaskManager.ts`
**Date**: 2026-04-02 (updated 2026-04-03)

### Q: ComfyUI Agent 完成任务后图片不显示、刷新后丢失
**Symptom**: 远程 ComfyUI Agent 处理任务后，后端日志显示 output_files 有数据，但前端不显示图片。刷新后图片彻底消失。
**Root Cause**: `agent_routes.py::agent_complete()` 中 `save_output_file()` 只保存到磁盘（"Zero DB dependency"），不调用 `FileDAO.create_file()` — 文件不关联到 entity → `fetchEntityFiles()` 查不到。同时 SSE publish 不包含 entity 字段 → 前端缓存不失效。
**Fix**: 新增 `_persist_to_db()` 函数，在 `agent_complete()` 中保存文件后调用 `FileDAO.create_file()` 关联 entity。SSE publish 补充 `entity_type/entity_id/file_role/episode_id` 字段。
**Files**: `agent_routes.py`
**Date**: 2026-04-03

---

## 架构决策

### Q: 为什么选 React Query 而不是 Redux/Zustand？
**Decision**: React Query 专注于服务端状态（server state），与本项目"生成 → 保存 → 查询 → 展示"的数据流天然匹配。不需要手动管理缓存同步，SSE 事件直接触发 `invalidateQueries` 即可自动刷新。
**Date**: 2026-04-02

### Q: 为什么弃用 JSONB 字段存储图片列表？
**Decision**: `storyboard_items.generated_images` JSONB 字段在多任务并发时会互相覆盖（后写覆盖先写），且不支持单图选择/删除。改为 `files` 表 + `entity_type/entity_id` 关联，每张图独立行，天然支持并发。
**Date**: 2026-03-29

## 素材绑定级联不生效
- 症状：在镜头2绑定角色后，后续镜头没有自动跟随
- 原因：后续镜头已有该角色的绑定（不覆盖已有绑定）
- 解决：手动解绑后续镜头的旧绑定，再重新绑定当前镜头

### Q: HistoryPage 不显示历史生成图片

**Symptom**: 在设计页面生成了新图，但历史记录页面为空，"暂无历史记录"。之前是有图片的。

**Root Cause**: 三层叠加问题：
1. **数据源切换**：HistoryPage 从 `/api/tasks`（旧 tasks 表）重写为 `/api/user-files`（新 files 表）。旧版本显示的是 task 结果中的图片，新版本查 files 表。切换后历史 task 数据不可见。
2. **metadata 不完整**：`save_generated_file_to_db` 保存的 metadata 只有 `{source, episode_id}`，缺少 `prompt` 和 `model`，导致 HistoryPage 信息面板全部显示 "—" 和 "无提示词"。
3. **错误静默吞掉**：`loadHistory` 的 catch 只 `console.error`，用户无法看到 API 失败原因（如 401、500）。

**Fix**:
1. HistoryPage 增加 tasks API fallback：files 表无数据时自动尝试 `/api/tasks` 读取旧 task 结果
2. HistoryPage 增加 `loadError` 状态和 UI 错误提示
3. `save_generated_file_to_db` 新增 `extra_metadata` 参数
4. Gemini/Doubao/多宫格端点传入 `prompt` 和 `model` 到 metadata

**Files**: `new_html/components/HistoryPage.tsx`, `file_service.py`, `cluster_main.py`
**Date**: 2026-04-04

### Q: 设计页面 AI 生图后，素材页面看不到新图片

**Symptom**: 在设计页面用 AI 生成了图片，点击"导出到素材绑定"后，素材页面的角色/场景素材仍显示旧数据。

**Root Cause**: 双数据源问题。设计页面从 `files` 表（entity files）展示图片，素材页面从 `assets.reference_images`（legacy JSON 字段）展示图片。两者的同步函数 `_sync_legacy_on_file_create`（`file_service.py`）存在 import 路径错误（`from database_config import get_db_manager`，`database_config` 模块无此函数），导致同步每次静默失败。

**Fix**: 
1. 修复 import 路径：`from db_manager import get_db_manager`
2. 统一数据源：Assets API 内嵌 entity files，所有页面通过 `EpisodeContext.assets`（含 `entityFiles[]`）统一消费

**Files**: `file_service.py`, `api_routes.py`, `dao_entity_file.py`, `new_html/utils/episodeAdapters.ts`, `new_html/pages/DesignPage.tsx`, `new_html/contexts/EpisodeContext.tsx`, `new_html/types.ts`

**Date**: 2026-04-04

### Q: /api/user-files 返回 500 Internal Server Error

**Symptom**: HistoryPage 打开后反复报 500 错误，控制台显示 `fetchUserFiles failed: 500`。

**Root Cause**: `api_routes.py` 的 `get_user_files` 端点中，`db.fetchrow()` 返回的是 Python **dict**（`{'count': N}`），而非 `asyncpg.Record`。代码用 `total_row[0]`（整数索引）访问字典 → `KeyError: 0` → 500。

```python
# 出错代码
total_row = await db.fetchrow(count_query, *args)
total = total_row[0]  # KeyError: 0，dict 不支持整数索引
```

这个 bug 一直存在但此前未暴露，因为 HistoryPage 之前用 `/api/tasks` 端点，最近重写切到 `/api/user-files` 才触发。

**Fix**: 将 `fetchrow` + `[0]` 替换为 `fetchval`，直接返回标量值：
```python
total = await db.fetchval(count_query, *args) or 0
```

**教训**: `db_manager.py` 的 `fetchrow()` 返回 `dict`（不同于原生 `asyncpg.Record`），**全项目所有 `fetchrow` 调用都不能用 `[0]` 索引**，必须用 key 名或改用 `fetchval`。

**Files**: `api_routes.py`
**Date**: 2026-04-04

### Q: HistoryPage 删除按钮只做软删除，磁盘文件未释放

**Symptom**: 在历史页面删除图片后，数据库标记 `is_deleted=TRUE`，但磁盘文件仍占空间。

**Root Cause**: `deleteEntityFile` → `EntityFileDAO.soft_delete` 只更新 `is_deleted` 标志，不删除物理文件。

**Fix**: 
1. `EntityFileDAO` 新增 `hard_delete(file_id)` 和 `hard_delete_batch(file_ids)` — 先 `os.remove()` 删磁盘文件再 `DELETE FROM files` 删数据库记录
2. `api_routes.py` 新增 `DELETE /api/entity-files/{file_id}/hard` 和 `POST /api/entity-files/hard-delete-batch` 端点
3. `entityFileService.ts` 新增 `hardDeleteEntityFile` 和 `hardDeleteEntityFiles` 前端函数
4. `HistoryPage` 用自定义 DeleteConfirmModal 替代 `window.confirm()`，提供"同时删除磁盘文件"选项

**Files**: `dao_entity_file.py`, `api_routes.py`, `new_html/services/entityFileService.ts`, `new_html/components/HistoryPage.tsx`
**Date**: 2026-04-04

### Q: 点击"新建空白文档"清空已有数据而非创建新文件

**Symptom**: 在分集剧本页面点击"新建空白文档"，没有新文件出现，反而清空了当前文件内容。

**Root Cause**: `episode_scripts` 表有 `UNIQUE(episode_id)` 约束，每个分集只能有一条记录。`handleCreateBlankFile` 实际是清空唯一文件的内容。

**Fix**: 
1. 数据库：去掉 `episode_id` UNIQUE 约束，新增 `file_name`、`sort_order` 列（`db_migration_multi_scripts.sql`）
2. DAO：`dao_episode_script.py` 新增 `list_by_episode`、`create`、`delete_by_id`、`get_next_sort_order` 方法
3. 后端 API：新增 `GET/POST /api/episodes/{id}/scripts`、`PUT/DELETE /api/episodes/{id}/scripts/{script_id}`
4. 前端 Service：新增 `listEpisodeScripts`、`createEpisodeScript`、`updateEpisodeScriptById`、`deleteEpisodeScript`
5. WorkspaceApp：`loadEpisodeData` 加载多文件列表；`handleCreateBlankFile` 创建新后端记录；`handleDeleteFile` 真正删除

**Files**: `db_migration_multi_scripts.sql`, `dao_episode_script.py`, `api_routes.py`, `new_html/services/apiService.ts`, `new_html/WorkspaceApp.tsx`
**Date**: 2026-04-15

### Q: 切换页面后回到剧本页，文件选择重置为第一个

**Symptom**: 选择了文件列表中的02号文件，切换到设计页面再切回剧本页面，自动选中了01号文件。

**Root Cause**: `WorkspaceApp` 在每次挂载时执行 `loadEpisodeData()`，其中 `setSelectedFileId(projectFiles[0]?.id)` 始终选中第一个文件。由于 React Router 页面切换会导致组件卸载/重新挂载，选中状态丢失。

**Fix**: 
1. `WorkspaceApp` 新增 `initialScriptId` prop，初始化时优先选中该 ID 对应的文件
2. `ScriptPage` 从 `EpisodeContext` 获取 `selectedScriptId` 并作为 `initialScriptId` 传给 `WorkspaceApp`
3. `EpisodeContext` 中的 `selectedScriptId` 状态在页面切换时保持不变（Context 不会卸载）

**Files**: `new_html/WorkspaceApp.tsx`, `new_html/pages/ScriptPage.tsx`
**Date**: 2026-04-15

### Q: 视频页面不跟随文件切换，始终显示同一视频

**Symptom**: 不管在剧本页面选择哪个文件，视频页面（GenerationPage）总是显示相同的视频片段。

**Root Cause**: `EpisodeContext` 的 `videoSegments` loader 调用 `getVideoSegments(episodeId)` 没有按 `script_id` 过滤。`video_segments` 表通过 `storyboard_item_id` 关联分镜，但加载时没有利用这层关系做过滤。

**Fix**: 
1. `EpisodeContext` 新增 `filteredVideoSegments` useMemo，根据已过滤的 `storyboardItems`（按 `script_id` 过滤）的 `itemId` 集合来筛选 `videoSegments`
2. Provider 向下游传递 `filteredVideoSegments` 而非原始 `videoSegments`
3. 当 `selectedScriptId` 变化时，`storyboardItems` 自动重载，`useMemo` 重新计算，视频片段同步更新

**Files**: `new_html/contexts/EpisodeContext.tsx`
**Date**: 2026-04-15

### Q: 视频工作区（VideoPage）切换文件后仍显示旧数据，删除后切换页面又恢复

**Symptom**: 选择一个没有分镜的文件后，视频页面仍然显示之前文件的视频数据。删除数据后切换到其他页面再回来，数据又恢复了。

**Root Cause**: 两层问题叠加：
1. `filteredVideoSegments` 的 useMemo 在 `storyboardItems.length === 0` 时错误返回全部 `videoSegments`（应返回空数组）
2. `VideoPage` 组件使用 `videoService.loadWorkspaceSession()` 加载用户级工作区会话（`workspace_session_{user_id}`），该会话不区分分集和文件，导致旧数据泄露到新上下文；删除仅影响前端内存状态，切换页面后从数据库重新加载旧数据

**Fix**: 
1. `EpisodeContext.filteredVideoSegments`：`selectedScriptId` 存在但 `storyboardItems` 为空时返回 `[]`；只保留 `storyboard_item_id` 在过滤后分镜集合中的视频片段
2. 工作区会话按 `episodeId:scriptId` 隔离（根本修复）：
   - `WorkspaceSessionDAO._config_key` 接受 `scope` 参数，存储键变为 `workspace_session_{user_id}_{scope}`
   - `save-session` / `load-session` API 新增 `scope` 参数
   - `videoService.ts` 的 `saveWorkspaceSession` / `loadWorkspaceSession` 透传 `scope`
   - `VideoPage` 新增 `sessionScope` prop，所有 session 操作使用该 scope
   - `VideoGenPage` 构建 `${episodeId}:${selectedScriptId}` 作为 scope 传入
   - `WorkspaceApp` 中的旧架构 `VideoPage` 引用也传入 scope

**Files**: `dao_content.py`, `cluster_main.py`, `new_html/services/videoService.ts`, `new_html/components/VideoPage.tsx`, `new_html/pages/VideoGenPage.tsx`, `new_html/WorkspaceApp.tsx`, `new_html/contexts/EpisodeContext.tsx`
**Date**: 2026-04-15

---

### Q: 每次切换工作流页面都重新请求 API，导致加载慢

**Symptom**: 在工作流页面之间切换（如剧本→设计→素材→分镜），每次切换都会重新从 API 加载数据，即使数据已经在内存中。页面切换体感很慢。

**Root Cause**: `EpisodeContext.loadSlices()` 不检查数据是否已加载，每次调用都直接发 API 请求。React Router 的 `<Outlet />` 在路由切换时卸载旧组件并挂载新组件，每个页面的 `useEffect(() => { loadSlices(...) }, [loadSlices])` 在每次挂载时都会触发，导致重复请求。同时还有三个叠加瓶颈：
1. `WorkspaceApp.loadEpisodeData()` 中 `listEpisodeScripts` 和 `getStoryboardItems` 串行 await
2. 首次设置 `selectedScriptId` 触发 context 无效重载
3. 自动保存在初始加载后 2 秒触发无谓写入

**Fix**:
1. `loadSlices` 拆分为 `fetchSlices`（始终请求）和 `loadSlices`（skip-if-loaded）：
   - `loadSlices` 过滤 `loadedSlicesRef` 中已有的 slice，只请求未加载的数据
   - `fetchSlices` 始终发 API 请求（供 `reload()`、`selectedScriptId` 变化、写操作后使用）
   - Context 暴露 `forceReloadSlices`（= `fetchSlices`）供页面按需强制刷新
2. `WorkspaceApp.loadEpisodeData()` 改用 `Promise.all` 并行请求
3. `selectedScriptId` 首次设置时跳过 context 重载（用 `prevScriptIdRef` 守卫）
4. 自动保存加 `hasUserEditedRef` 守卫，跳过初始加载后的无谓保存

**Files**: `new_html/contexts/EpisodeContext.tsx`, `new_html/WorkspaceApp.tsx`
**Date**: 2026-04-15

---

### Q: 输入简短内容（如"123"）无法生成分镜脚本，AI 拒绝生成

**Symptom**: 在脚本输入栏输入简短文字（如"123"），点击改写后，分镜脚本栏显示"抱歉，我无法根据您提供的'123'生成分镜脚本，因为输入内容不包含任何可用的场景描述、对话或动作信息"。之前相同输入可以正常生成。

**Root Cause**: Bug 7 修复中将 `GENERATE_STORYBOARD_SCRIPT` 的 system prompt 替换为包含 55 行详细格式约束（`STORYBOARD_FIELD_SPEC`）的严格版本。大量"必须"、"禁止"、"最少字数"等限制性指令导致 AI 面对简短输入时主动拒绝，而非像旧版简单 prompt 那样尝试生成。

**Fix**: 在 `GENERATE_STORYBOARD_SCRIPT` 的 system prompt 最前面添加【最重要原则 — 必须生成】指令，明确要求 AI 无论输入多短都必须生成至少 1 个镜头块，禁止回复拒绝信息。

**Files**: `new_html/prompts/scriptPrompts.ts`, `deploy/new_html/prompts/scriptPrompts.ts`
**Date**: 2026-05-03

---

### Q: 分镜脚本栏出现多余的"AI 分镜脚本改写"按钮

**Symptom**: 在分镜脚本栏（第三列）出现一个"AI 分镜脚本改写"按钮，之前不存在。

**Root Cause**: `ScriptColumn.tsx` 中有条件渲染 `{!hasScript && onRewrite && (<button>...AI 分镜脚本改写</button>)}`，当无脚本内容且 `onRewrite` 被传入时显示。`WorkspaceApp.tsx` 同时向 ViewerColumn（第二列）和 ScriptColumn（第三列）传递了 `onRewrite={handleRewrite}`。第二列已有独立的"改写"按钮，第三列的按钮属于冗余。

**Fix**: 从 `WorkspaceApp.tsx` 中移除传给 ScriptColumn 的 `onRewrite` prop。这样第三列在无脚本时只显示"等待剧本生成..."，用户从第二列触发改写即可。

**Files**: `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-03

---

### Q: 导出分镜到设计页后数据没有出现（原子导出显示成功但实际失败）

**Symptom**: 点击"导出"后前端控制台显示"✅ 原子导出完成: N 个分镜"，页面跳转到设计页，但设计页上没有任何角色/场景数据。同时可能有 `/api/tasks/active` 和 `/api/tasks/notifications` 返回 500 错误。

**Root Cause**: `apiService.ts` 的 `handleResponse()` 函数只检查了 401 状态码和非 JSON 响应，**没有检查其他 HTTP 错误状态码（如 500）**。当服务端返回 500 且响应体是 JSON（FastAPI 默认返回 `{"detail": "Internal Server Error"}`）时，`handleResponse` 会正常解析 JSON 并返回，不抛异常。调用方 `handleExportStoryboards` 因此认为导出成功，打印"✅"并跳转到设计页。但实际上服务端事务已回滚，数据未写入数据库。

**Fix**: 在 `handleResponse()` 中解析 JSON 后增加 `response.ok` 检查，对非 2xx 状态码抛出包含 detail 信息的 Error。这样所有 API 调用（包括导出）在服务端返回错误时都会正确抛出异常，前端能捕获并显示错误提示。

**Files**: `new_html/services/apiService.ts`, `deploy/new_html/services/apiService.ts`
**Date**: 2026-05-03

---

### Q: 在镜头设计栏手动添加角色/场景后，导出到设计页没有这些数据

**Symptom**: 用户在第4列（镜头设计/StoryboardColumn）通过标签功能手动添加角色或场景到分镜项目中，点击导出后跳转到设计页，但设计页上看不到这些手动添加的角色/场景。

**Root Cause**: 导出函数 `handleExportStoryboards` 收集角色/场景的逻辑有缺陷。用户手动添加的标签更新了 `storyboard.items[n].characters` 和 `.scene`，但没有同步到 `selectedFile.extractedCharacters` / `extractedScenes`。导出函数先检查 `extractedCharacters`，只在其为空时才去读 storyboard items 作为 fallback。如果 `extractedCharacters` 已有值（初始加载时从 items 预填），用户后来手动添加的角色会被完全忽略。

**Fix**: 将导出函数改为始终合并两个数据来源——使用 `Set` 将 `extractedCharacters`/`extractedScenes` 和 `storyboard.items` 中的角色/场景去重合并，确保手动添加的标签一定包含在导出数据中。

**Files**: `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-03

---

### Q: 点击剧本页面镜头报错 TypeError: z.trim is not a function，页面白屏

**Symptom**: 在剧本页面点击选中某个镜头后，浏览器控制台报 `Uncaught TypeError: z.trim is not a function`，整个脚本列无法渲染，什么都不显示。

**Root Cause**: `ScriptColumn.tsx` 中高亮选中镜头的逻辑调用了 `.map(item => item.shotNumber).filter(sn => sn && sn.trim())`。`shotNumber` 的类型是 `string | number`——从数据库加载时它是 `number`（`idx + 1`），此时调用 `.trim()` 会抛 TypeError。

**Fix**: 使用已有的 `getShotNumberStr()` helper 将 `shotNumber` 转为字符串后再调用 `.trim()`：`.map(item => getShotNumberStr(item.shotNumber)).filter(sn => sn && sn.trim())`。

**Files**: `new_html/components/ScriptColumn.tsx`, `deploy/new_html/components/ScriptColumn.tsx`
**Date**: 2026-05-03

---

### Q: /api/tasks/active 和 /api/tasks/notifications 返回 500: column "category" does not exist

**Symptom**: 前端轮询任务接口时控制台报 `getActiveTasks 返回错误 (500): column "category" does not exist`。

**Root Cause**: `api_routes.py` 中的任务查询 SQL 引用了 `category` 字段，但数据库 `tasks` 表尚未添加该列。需要执行 `deploy/sql/db_migration_project_hub.sql` 中的迁移。

**Fix**: 在 PostgreSQL 中执行以下 SQL（或重新运行完整的 `db_migration_project_hub.sql`）：

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_page VARCHAR(50);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_item_id VARCHAR(100);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
```

之后重启后端即可。

**Files**: `deploy/sql/db_migration_project_hub.sql`, `api_routes.py`
**Date**: 2026-05-03

---

### Q: 剧本页面镜头卡片上添加角色/场景标签后，刷新页面数据丢失

**Symptom**: 在分镜设计列（StoryboardColumn）的镜头卡片中手动添加角色或场景标签后，看起来添加成功了，但一刷新页面数据就不见了。

**Root Cause（前端部分）**: `handleUpdateStoryboardItem` 只更新了前端 React 状态（通过 `updateFileWithHistory`），没有调用后端 API 将变更持久化到数据库。

**Root Cause（后端部分 — 真正的根因）**: 即使前端调用了 `PUT /api/storyboard-items/{item_id}` 持久化，刷新后也看不到标签。原因是 **asyncpg 默认将 jsonb 列返回为字符串而不是 Python list/dict**（需要显式注册 codec 才会自动解码）。`get_storyboard_items` 端点直接 `dict(row)` 返回，`bound_assets` 字段是字符串（例如 `'["char:张三","scene:客厅"]'`）。前端 `loadEpisodeData` 的 `Array.isArray(r.bound_assets)` 检查因此返回 false，`characters` 和 `scene` 都被解析为空。所有通过 bound_assets 存储的角色/场景在刷新后全部丢失（不仅仅是手动添加的，也包括导出时写入的）。

**Fix**:
1. 前端：在 `updateStoryboardItemRef.current` 中，当 `characters` 或 `scene` 被更新时自动调用 `updateStoryboardItem(itemId, { bound_assets })` API 持久化到数据库。
2. 后端：修改 `get_storyboard_items` 端点，对每个返回项检查 `bound_assets` 字段，若为字符串则 `json.loads` 解析为数组再返回给前端。

**Files**: `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`, `api_routes.py`, `deploy/api_routes.py`
**Date**: 2026-05-03

---

### Q: 剧本页添加角色/场景标签后，导出到设计页角色/场景没出现

**Symptom**: 在剧本页镜头卡片上添加角色/场景标识，点击导出，跳转到设计页后，刚刚添加的角色/场景没有显示在设计页上。

**Root Cause**: `export_script` 端点在向 `assets` 表插入新角色/场景时，**没有写入 `script_id` 字段**（INSERT SQL 中漏了该列）。同时 `batch_create_transactional` 调用也没传 `script_id`。但是设计页加载 assets 时通过 `EpisodeContext` 调用 `getAssets(projectId, episodeId, undefined, selectedScriptId)`，后端 SQL 会用 `WHERE script_id = $X` 过滤。新插入的 assets `script_id = NULL`，被过滤掉，所以设计页看不到。

数据流：
- `WorkspaceApp.handleExportStoryboards` → `POST /api/episodes/{id}/export-script`（**未发送 script_id**）
- 后端 INSERT INTO assets（**未写入 script_id 列**）→ NULL
- 设计页 `EpisodeContext.assets` slice → `getAssets(..., script_id=selectedScriptId)`
- 后端 SQL `WHERE script_id = $X` → NULL 不匹配 → 返回空

**Fix**:
1. 给 `ExportScriptRequest` 增加 `script_id: Optional[str]` 字段。
2. 前端 `handleExportStoryboards` 在调用 `exportScript` 时传入 `script_id: selectedFile.id`。
3. 后端 export 逻辑：
   - 调用 `batch_create_transactional(..., script_id=req.script_id)` 让 storyboard_items 也带上 script_id。
   - INSERT assets 时增加 `script_id` 列：`INSERT INTO assets (..., script_id, ...) VALUES (..., $4, ...)`。
   - DELETE storyboard_items / 查重 existing_assets 时也按 script_id 过滤，避免删除/影响其他剧本的数据。

**Files**: `api_routes.py`, `deploy/api_routes.py`, `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`, `new_html/services/apiService.ts`, `deploy/new_html/services/apiService.ts`
**Date**: 2026-05-03

---

### Q: 后台日志报 `name 'DB_AVAILABLE' is not defined`

**Symptom**: 后端启动后定期看到错误日志：`文件健康检查异常: name 'DB_AVAILABLE' is not defined`，TaskDAO 查询路径也会触发同样的 `NameError`。

**Root Cause**: `cluster_main.py` 中两处使用了 `if DB_AVAILABLE:`（第 274 行 file_health_checker、第 1536 行任务降级查询），但模块顶部从未定义该变量。`DB_AVAILABLE` 只在 `worker.py` 中通过 `try/except ImportError` 定义。原因是 `cluster_main.py` 早期可能也用 try/except 包裹 db 导入，后来导入改为无条件 import，但残留的 `DB_AVAILABLE` 引用未清理。

**Fix**: 在数据库模块 import 块之后添加 `DB_AVAILABLE = True`。因为这些 import 是无条件的，只要模块能加载到 `cluster_main` 这一步，DB 模块必然可用。

**Files**: `cluster_main.py`, `deploy/cluster_main.py`
**Date**: 2026-05-03

---

### Q: 导出设计页后回到剧本页，多出一个复制的镜头卡片

**Symptom**: 剧本页本来只有 1 个镜头卡片，点击导出到设计页，再回到剧本页时多出一个新卡片（内容是第一个的复制）。

**Root Cause**: 这是 script_id 修复后遗留的旧数据问题。
- 早期 `export_script` 端点 INSERT storyboard_items 时不写 `script_id`，旧数据 `script_id = NULL`。
- 修复后再次导出会 `DELETE WHERE script_id = $X`（不删 NULL）+ INSERT 新数据带 script_id。
- DB 同时有 1 条 NULL 旧数据 + 1 条带 script_id 的新数据。
- `loadEpisodeData` 调用 `getStoryboardItems(episodeId)` 不带 script_id 过滤，返回全部 2 条。
- 旧代码 `storyboard: idx === 0 && uiItems.length > 0 ? { items: uiItems } : null` 把全部 items 都塞给第一个 script。

**Fix**: 修改 `loadEpisodeData` 按 `script_id` 分组分配 items：
- 用 `Map<script_id, rows>` 把 dbItems 分组。
- 每个 script 取自己 `script_id` 匹配的 rows。
- `script_id = NULL` 的孤儿数据（legacy）回退给第一个 script。

**Files**: `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-03

---

### Q: 删除镜头卡片后，刷新又出现了

**Symptom**: 在镜头设计列删除一个镜头卡片，看起来删除成功，但一刷新页面卡片又回来了。

**Root Cause**: `handleDeleteStoryboardItem` 只更新前端 React 状态，没有调用后端 `deleteStoryboardItem` API。数据库里的记录还在，刷新时 `loadEpisodeData` 再次加载就把它读回来了。这是和 "添加角色/场景刷新丢失" 同类型的持久化遗漏 bug。

**Fix**: 在 `handleDeleteStoryboardItem` 中，对持久化过的分镜（id 以 `sb_` 开头）调用 `deleteStoryboardItem(id)` 真正从数据库删除。本地新生成（uuid）的 item 因为还没存到 DB，跳过 API 调用避免 404。

**Files**: `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-03

---

### Q: 删除镜头后刷新又复制出新卡片（自动保存重复 INSERT）

**Symptom**: 上一个修复加了 `deleteStoryboardItem` API 后，删除当下确实从 DB 删除了。但 2 秒后自动保存把当前 UI 里所有 items 都通过 `batchCreateStoryboardItems` 重新 INSERT，造成 DB 里出现复制行；刷新后 UI 又把这些复制行加载出来，看起来"删了又复制了一份"。

**Root Cause**: `saveEpisodeToBackend` 在每次 `files` 变化后 2s 触发，里面无条件调用 `batchCreateStoryboardItems`（INSERT，不删除原有行，也不带 script_id）。每次自动保存都会在 DB 新增一组复制 items：
- 老的 sb_xxx 记录还在（granular delete 只删了被点删除的那一条）
- 自动保存把当前 UI 残留 items 全部再 INSERT 一份新的 sb_yyy
- 加上"删除最后一个时保留 placeholder"的逻辑，placeholder item 也被当真实数据再次 INSERT
- 刷新时 loadEpisodeData 加载 DB 里所有记录 → 看到"复制增加"

**Fix**: 改写 `saveEpisodeToBackend` 的分镜分支：
1. 跳过 `isPlaceholder` 的 item，避免占位项被 INSERT。
2. 只在检测到"有未持久化的 item"（id 不是 `sb_` 开头）时才走 replace 逻辑，否则跳过——granular update/delete 已经把改动写进去了。
3. Replace 时先 `deleteAllStoryboardItems(episodeId, file.id)` 清掉本 script 旧数据，再 `batchCreateStoryboardItems(..., script_id=file.id)` 写新的。
4. INSERT 后用 server 返回的 `item_id` 回填本地 state，让后续 granular update 操作能命中真正存在的行。
5. 按所有 `files` 循环（不再只保存 primaryFile），多脚本场景也能正确各自保存。

**Files**: `new_html/WorkspaceApp.tsx`, `deploy/new_html/WorkspaceApp.tsx`
**Date**: 2026-05-03

---

### @ 候选列表显示了其它分镜的素材

**Symptom**: 在 Seedance 卡片提示词里输入 `@`，弹出的候选列表里出现了其它分镜的台词、音频、画面。

**Root Cause**: `buildCandidates` 早期未按 `currentStoryboardItemId` 过滤；`storyboardItems` 数组是 episode 全集，所有分镜的 heading / dialogue / audio_url 都被拉进来。

**Fix（2026-05-19）**:
1. `useSeedanceCandidates` 接收 `currentStoryboardItemId?: string`。
2. `buildCandidates` 据此严格过滤：`storyboard_data` 和 `audio` 候选只取当前 item；scoped 时连 `materialLibrary.audio` 都不进。
3. `assets / user_files / video_segments / current_card / ark_asset_id` 仍是 episode 范围（跨分镜复用资源）。
4. `VideoPage.getStoryboardItemId(uuid)` 通过 `uploadedImage.id === item_id`（`handleImportAll` 约定）反查并向 hook 透传。
5. 同时新增 `image_prompt / video_prompt / lines` 作为 text 候选，让"剧本提示词"能在 popover 里被引用。

**Files**: `new_html/utils/seedanceCandidateBuilder.ts`, `new_html/hooks/useSeedanceCandidates.ts`, `new_html/components/video/VideoCard.tsx`, `new_html/components/VideoPage.tsx` (+ deploy mirror)
**Date**: 2026-05-19

---

### Seedance 卡片切换模型后视频提示词不见了

**Symptom**: 分镜导入时 video_prompt 已正确填到 Seedance 提示词框；但用户切到 Wan2 再切回 Seedance2 后，提示词变空。

**Root Cause**: T1（commit `5730dfd`）把 `video_prompt` 写入了 `imagePrompts[item_id]` 和 `seedanceParams[uuid].prompt`。但 `getSeedanceParams` 的 fallback 分支（无现有 SP 时）创建新 SP 时 `prompt: ''`，没读 `imagePrompts[group.ids[0]]` —— 切模型 / 旧 session 时就丢 prompt。

**Fix（2026-05-19）**: fallback 改读 `imagePrompts[group?.ids?.[0]] || ''`；`useCallback` 依赖加 `imagePrompts`。

**Files**: `new_html/components/VideoPage.tsx` (+ deploy mirror)
**Date**: 2026-05-19

---

### Seedance 任务创建 404 Not Found（ark.cn-beijing.volces.com/.../tasks）

**Symptom**: `worker._process_seedance_task` 报 `404 Client Error: Not Found for url: https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`，任务进入重试。

**Root Cause**: 端点 URL 与 `MODEL_MAP` 里的两个模型 ID（`doubao-seedance-2-0-260128` / `doubao-seedance-2-0-fast-260128`）经官方文档核对**均正确**——所以不是拼写/端点问题。Ark（OpenAI 兼容）在「模型未开通 / API Key 无该模型权限 / 模型名在该账号不存在」时返回 **404 NotFound**（而非 400/401）。即根因在账号侧：`SEEDANCE_API_KEY`/`ARK_API_KEY` 对应账号未开通 Seedance 2.0 模型，或用错了 Key。`raise_for_status()` 只携带 URL，把 Ark 的 JSON 错误体丢掉了，导致日志看不到真正原因。

**Fix（2026-05-30）**: `seedance_api.py` 的 `create_video_task` / `query_task` 在 `resp.ok` 为假时，先 `logger.error` 打出 `HTTP {status_code} model={...} body={resp.text}` 再 `raise_for_status()`。下次失败日志会直接显示 Ark 的 `{"error":{"code":"...","message":"..."}}`，可据此确认是「模型未开通/无权限」并去火山方舟控制台开通该模型或更换有权限的 Key。**未改端点与模型 ID（已核对正确，改动属猜测性修复，禁止）。**

**Files**: `seedance_api.py` (+ deploy mirror)
**Date**: 2026-05-30

---

### admin 后台配了 Seedance Key，运行时却走 ARK_API_KEY（"另外的 key"）

**Symptom**: 用户在 `/admin-legacy/` → API 配置里给「飞升 (Seedance 2.0)」/「渡劫」填了火山 Key，但 worker 实际用的还是 `start_cluster.sh`/豆包那条的 `ARK_API_KEY`。编辑该卡片时 Provider 下拉显示**「自定义」**，而不是 seedance。

**Root Cause**（垂直切片 FE→BE→ENV 三层口径不一致）：
1. 预置导入（`admin_routes.py:PRESET_API_MODELS`）写入的「飞升/渡劫」`provider='seedance'`，后端 `cluster_main.PROVIDER_ENV_MAP['seedance']='SEEDANCE_API_KEY'` 也对。
2. **但 `admin/index.html` 的 Provider 下拉 `#api-provider` 从来没有 `seedance` 选项**（只有 doubao/dashscope/sora2/veo…）。
3. `admin/app.js:openApiConfigModal` 执行 `select.value='seedance'` 时无匹配 option → 浏览器静默把 select 置为 `selectedIndex=-1`，UI 回退显示第一项「自定义」(value="")。
4. 用户一旦点**保存**，`saveApiConfig` 读到的 `provider=""` → `PUT` 写回 DB → `load_api_configs_to_env` 里 `PROVIDER_ENV_MAP.get("")=None` → **整条被跳过**，`SEEDANCE_API_KEY` 永不注入。
5. `seedance_api.SeedanceClient` 取值顺序 `SEEDANCE_API_KEY → ARK_API_KEY`，前者空 → 回落 `ARK_API_KEY`。表象即"走了另外的 key"。

**Fix（2026-06-02）**:
1. `admin/index.html` Provider 下拉新增 `<option value="seedance">飞升 / 渡劫 (Seedance 2.0 视频, SEEDANCE_API_KEY)</option>`，并给 doubao 补注 `(SeedDream 生图, ARK_API_KEY)` 以区分两条火山系 Key。
2. `admin/app.js:openApiConfigModal` 加防御：存量 `provider` 不在下拉选项里时，动态 append 一个 `value=provider` 的 option 再赋值，避免"编辑一下就被抹成自定义"。对任意未来漏配的 provider 都生效。

**用户侧补救**：若之前已误存成空 provider，需重新编辑该卡片把 Provider 选回「飞升/渡劫 Seedance 2.0」→ 保存 → **重启后端**（`get_seedance_client()` 单例缓存，仅靠热 reload 不重建）。

**Files**: `admin/index.html`, `admin/app.js`（+ deploy mirror）
**Date**: 2026-06-02

---

### Seedance 任务 400 InvalidParameter `content[N].image_url`（Key 已对、模型已开通）

**Symptom**: `seedance_api` 报 `HTTP 400 ... body={"error":{"code":"InvalidParameter","message":"The parameter content[1].image_url ... is not valid",...}}`。注意已不是 404 ModelNotOpen —— 说明 Key/模型都对，是图片 URL 本身被 Ark 拒绝。

**Root Cause**（与 DashScope 那条同源，但 Seedance 路径从未修过）：
1. `VideoPage.getSeedanceParams` 构造 `media_inputs` 时只写 `url: img.url`，且 `img.url` 是注入了 `?token=` 的**内网 /storage 预览 URL**（VideoPage 给每张图 append `token=`）。
2. `videoService.submitSeedanceTask` 把 `media_inputs` **原样透传**给后端。
3. `worker._process_seedance_task` 旧实现把 `m.url` **原样**塞进 `image_url.url` 发火山。
4. 火山 Ark 服务端会**主动 fetch** 这个 URL：内网主机不可达 / token 对 Ark 无效 → 返回 **400 InvalidParameter image_url**。
   - 对比 DashScope 路径用 `worker._file_id_to_dashscope_url` 把本地图转 Base64，Seedance 完全绕过了该转换。

**Fix（2026-06-02）**: `worker._process_seedance_task` 的 media 循环改为复用 `_file_id_to_dashscope_url`（上次为 DashScope 修复并测试过的解析器）：`src = m.file_id or m.url` → data:URI 透传 / 本地 URL+token → `get_file_by_url` → Base64 / `sb_` 分镜图 → `StoryboardDAO` → Base64 / 公网 URL 透传。image/video/audio 三类 kind 都走同一解析。复用既有 12 个回归测试，全绿。

**Files**: `worker.py`（+ deploy mirror）
**Date**: 2026-06-02

---

### Redis 队列里残留 ComfyUI 任务（qwen_3 等）无法从前端任务列表清掉

**Symptom**: 无 ComfyUI agent 时，某个 `qwen_3`/`comfyui_*` 任务在队列里每 ~3s 被 lite worker 「丢回队列」循环刷日志；想从右上角铃铛任务列表删掉但删不掉。

**Root Cause**:
1. 铃铛面板 `NotificationPanel` 的删除按钮 `onRemove={cancelTask}` 调的是 `TaskContext.cancelTask → taskRegistry.cancel(taskId)`，**纯前端本地注册表**，不发后端、不动 Redis；上一次会话遗留的任务根本不会出现在面板里。
2. 后端确有 `DELETE /api/task/{id}`（cancel → `zrem`）与 `DELETE /api/task/{id}/delete`，但 lite worker 循环里 `dequeue()` 会把状态覆写成 PROCESSING、再 `enqueue()` 重写状态并 `zadd` 回队列，整个过程不检查取消标记 —— 后端运行时一次性 cancel/delete 会在 ~3s 内被循环「复活」，不可靠。

**Fix / 处理方式（2026-05-30）**: 可靠清除需在 **后端停止时**（循环不再运行）直接清 Redis：
```
redis-cli ZREM comfyui:task_queue <task_id>
redis-cli ZREM comfyui:processing <task_id>
redis-cli DEL  comfyui:task:<task_id>
```
或 `redis-cli DEL comfyui:task_queue` 清空所有排队项，然后重启后端。另一个根治办法是启动 ComfyUI agent 让它把任务正常消费掉。（如需后端运行时也能即时取消，需给 lite worker 重入队前加「取消集合」守卫——属增量改动，未做。）

**Files**: 诊断结论，无代码改动（铃铛 = 前端注册表；后端清除走 Redis/`DELETE /api/task/{id}`）
**Date**: 2026-05-30

---

### 视频页卡片视图越往下左右越对不齐

**Symptom**: 分镜数 ≥ 4 时，左右两列卡片每多一行就再偏 ~22 px，第 5、6 行已经完全错开。

**Root Cause**: 卡片视图在每两个相邻卡片之间渲染了对齐元素：
- 左侧链接按钮容器：`flex justify-center -my-5 mb-2` → 净 flow 高度 ≈ −8 px
- 右侧占位符：`h-[18px] -mt-3 mb-2` → 净 flow 高度 ≈ +14 px

每行差 22 px 累积。

**Fix（2026-05-19）**: 左侧容器改成与右侧完全相同的 `h-[18px] -mt-3 mb-2 relative`；按钮 `absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2` 居中，不抢 flow 空间。per-row delta = 0 px。

**Files**: `new_html/components/VideoPage.tsx` (+ deploy mirror)
**Date**: 2026-05-19

---

### DashScope（Kling/Vidu/HappyHorse）报「数据库未找到 ref_image_0 file_id=sb_xxx」
**Symptom**: `_process_dashscope_video_task` 抛 `FileNotFoundError: 数据库未找到 ref_image_0 file_id=sb_0e2e9f58c3a6`，任务最终失败。
**Root Cause**: `sb_xxx` 是分镜项 ID（`storyboard_items.item_id`），不是 `files` 表 file_id。链路：`VideoPage.getDashScopeParams` 写 `file_id: img.id`（分镜图 id=sb_）→ `videoService.submitDashScopeVideoTask` 的 `resolveUrl = m.file_id || m.url` 优先取 file_id → worker `FileDAO.get_file('sb_...')` 查不到。且分镜图真实 URL 带 `?token=`，DashScope 服务端 fetch 会 401，故必须 worker 还原本地文件转 Base64。
**Fix（2026-06-01）**:
1. 前端 `VideoPage.getDashScopeParams` 仅在 id 非 `sb_` 时写 `file_id`，分镜图改用 url 下发。
2. 后端 `worker._file_id_to_dashscope_url` 健壮化：data:URI 透传；URL→`FileDAO.get_file_by_url`→Base64（公网 http 查不到本地则透传）；`sb_` 走 `StoryboardDAO.get_by_id`→`generated_image_url`→`get_file_by_url`→Base64；其余按 file_id→`get_file`→Base64。抽出 `_record_to_base64` 助手。
3. 新增 `FileDAO.get_file_by_url(url)`（urlparse 取 path、SQL `split_part(file_url,'?',1)` 去 token 后精确匹配）。
**Files**: `new_html/components/VideoPage.tsx`, `worker.py`, `dao_content.py`（+ deploy 镜像）, `tests/test_dashscope_fileid_resolution.py`
**Date**: 2026-06-01
