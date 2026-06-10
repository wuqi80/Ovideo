# MiniMax TTS 异步化 冒烟测试剧本

> 配套 plan：`2026-05-24-minimax-tts-async.md`
> 用途：在 Task 10 镜像 + build 完成后，按本剧本三个场景人工跑一遍，确认治本修复达到效果。

---

## 场景 1: 角色声音栏 — 系统音色试听

1. 打开任一角色的"角色声音"侧栏
2. 选"系统音色"，点选某个 voice
3. 点"试听" → 按钮变 loading
4. 等 5-30s（不应超过 8min）→ 听到合成语音
5. 关闭侧栏，再打开 → 应立刻显示同一段音频（来自 voicePreviewCache）
6. 点"保存配置" → 在数据库里查 `character_voices.sample_audio_url` 应已被设
7. 刷新浏览器（清 sessionStorage 但保留 localStorage）→ 再打开侧栏，音频仍在（cache）
8. 清 localStorage → 再打开侧栏，音频仍在（从 DB `sample_audio_url` 恢复）

**预期验证点**

- 没有 `[object Object]` 的报错文案
- 网络面板里看到 `POST /api/minimax/tts` 立即返回 200 + `task_id`，**不是** 阻塞 300s 才返回
- 跟着看到一串 `GET /api/task/{task_id}` 轮询（2s 一次）直到 `status=completed`

## 场景 2: 配音页 — 旁白/对白生成

1. 进入某个 episode 的配音页
2. 点单条 clip 的"生成" → loading
3. 5-30s 后听到合成语音；铃铛通知"对白 · XX 完成"
4. 刷新页面 → 音频应仍存在（从 `storyboard_items.dialogue_audio_url`）
5. 在生成中途切换到另一个 episode → 旧任务的 AbortController 触发，新 episode 不受干扰
6. 点"全部生成"批量 → 串行执行，每条 clip 完成即铃铛通知，无并发风暴

**预期验证点**

- 每条 clip 独立 task_id；铃铛 (`taskRegistry`) 显示 running → completed
- 失败时显示 task_id 文案：`已生成但保存失败：xxx（task_id: ...）`
- 不再出现"签发 task_id 与超时 task_id 不一致"的 log 怪现象

## 场景 3: 错误处理

1. 后台 stop minimax worker → 点试听 → 8 分钟后看到友好 toast「TTS 轮询超时 task_id=...」
2. 后台 unset `MINIMAX_API_KEY` 重启 → 点试听 → 立刻看到 503 错误（早 fail），文案提示去 admin 配置
3. 测 Drawer 关闭中断：点试听后立刻关 drawer → 控制台不应有未捕获的 AbortError，新打开同角色 cache 命中（不会重新付费生成）

**预期验证点**

- 504 detail 平铺成功：`e.task_id` / `e.error` / `e.hint` 都能访问
- `recurring-pitfalls.md §Q` 描述的 5min 反代撞墙不再出现

---

## 通过标准

- 三个场景全部按预期运行
- 浏览器 console 无未捕获 `AbortError` / `TypeError`
- 后端日志只看到正常的 `📤 MiniMax TTS 已入队` + `🎤 MiniMax TTS 任务启动` + `🎉 MiniMax TTS 任务完成`，**没有**任何 `MiniMax TTS 超时` 误报
- `character_voices.sample_audio_url` 在三种音源（system/design/clone）配置保存后都被正确写入
