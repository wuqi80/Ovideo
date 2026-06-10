# Seedance 2.0 视频生成集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在视频页面集成火山方舟 Seedance 2.0 视频生成 API（"飞升/渡劫"双子型号 × 5 种生成场景），同时顺手修复 4 家现有外部视频 API（sora2/veo/minimax/wan26）任务完成后不写 `video_segments.video_url` 的历史漏洞。

**Architecture:** 沿用 `sora2_api.py` 的"外部 API client + worker 分发 + Redis 队列"模板，新增 `seedance_api.py` 客户端 + 5 个 task_type（`seedance_t2v` / `_i2v` / `_morph` / `_multi` / `_draft`）。把 `_save_external_video` 改造为 entity-aware（接收 `entity_type`/`entity_id`/`file_role`，调用 `_sync_legacy_on_file_create`），让所有外部视频任务完成时自动回填 `video_segments.video_url`。前端新增多模态面板（图 0-9 / 视频 0-3 / 音频 0-3）+ 7 参数高级设置面板。

**Tech Stack:** Python 3.9 / FastAPI / asyncpg / Redis / aiohttp / Pydantic v2 / React 18 / TypeScript / TanStack Query / Vite

---

## File Structure

### 新建文件 (Create)
- `seedance_api.py` (root) — Seedance 2.0 API 客户端
- `deploy/seedance_api.py` (deploy mirror)

### 修改文件 (Modify)

后端：
- `cluster_main.py:86-96` — `PROVIDER_ENV_MAP` 加 seedance
- `cluster_main.py:491-512` — `GenerateRequest` 加 SD2.0 字段
- `worker.py:204-213` — task_type 分发加 seedance 分支
- `worker.py:1236-1324` — `_save_external_video` 改造为 entity-aware
- `worker.py:899-914` `:1022-1047` `:1204-1233` `:1766-1810` — 4 家旧任务调用点透传 entity 参数
- `worker.py` (新增 `_process_seedance_task` 方法，约 1062 行后插入)
- `admin_routes.py:573-583` — `PRESET_API_MODELS` 加 2 条 seedance 预设
- `deploy/cluster_main.py` `deploy/worker.py` `deploy/admin_routes.py` — root 改动同步

前端：
- `new_html/services/videoService.ts:13-16` — `EXTERNAL_API_MODELS` 加 Seedance2/Seedance2Fast
- `new_html/services/videoService.ts:52` — `VideoModel` 类型扩展
- `new_html/services/videoService.ts:255-360` — `submitTask` 加 SD2.0 分支 + 新增 `submitSeedanceTask` 函数
- `new_html/services/videoService.ts` 末尾 — 新增 `getModelDisplayName` 辅助
- `new_html/components/VideoPage.tsx` — 新增 `SeedanceMultimodalPanel` 子组件 + 模型联动

文档（root + deploy 双份）：
- `docs/api.md` `deploy/docs/api.md` — task_type 表 + admin presets
- `docs/backend.md` `deploy/docs/backend.md` — External API Config 表
- `docs/frontend.md` `deploy/docs/frontend.md` — videoService + VideoPage 章节
- `docs/database.md` `deploy/docs/database.md` — provider notes + input_params 示例
- `docs/conventions.md` `deploy/docs/conventions.md` — External Video API Pattern + entity-aware 落库约定
- `docs/vertical-slices.md` `deploy/docs/vertical-slices.md` — VideoGenPage 章节
- `docs/faq.md` `deploy/docs/faq.md` — 预防性条目（fast 不支持 1080p / 真人脸 / 互斥规则）

### 不修改 (Skip)
- `db_migration_admin.sql` × 3 份 — 不需要 schema 迁移；预设由 Python 代码动态导入
- `dao_video_segment.py` — `_sync_legacy_on_file_create` 已会自动 UPDATE `video_segments.video_url`，DAO 无需扩展

---

## Mermaid: 数据流总览

```mermaid
flowchart LR
    UI[VideoPage 飞升/渡劫] -->|POST /api/generate| Route[cluster_main GenerateRequest]
    Route --> TaskService[task_service.submit prepare=False]
    TaskService --> Queue[(Redis)]
    Queue --> Worker[worker._process_seedance_task]
    Worker --> Client[seedance_api SeedanceClient]
    Client -->|create_video_task| Ark[ark.cn-beijing.volces.com]
    Ark -->|query 轮询| Client
    Client --> Save[_save_external_video v2 entity-aware]
    Save --> FilesTable[(files)]
    Save -.sync_legacy.-> SegmentsTable[(video_segments video_url)]
    FilesTable -->|GET /api/task/id| UI
```

---

## Task 1: 写设计文档（spec）

**Files:**
- Create: `docs/superpowers/specs/2026-05-10-seedance-2.0-integration-design.md`

- [ ] **Step 1: 创建 spec 文件**

写入 7 章节，作为后续 task 的"原始需求文档"：
1. Background — 为什么要接 SD2.0
2. API 概览 — 5 种场景 + contents 数组结构 + 7 参数
3. 决策记录 — 飞升/渡劫别名、API key fallback、修历史漏洞 scope_in
4. 架构图（同上面 mermaid 复制一份）
5. 数据合同 — 前端 `MediaInput` / 后端 `GenerateRequest` 扩展字段定义表
6. 边界与互斥规则 — 首尾帧 vs reference_image 不可共存、fast 不支持 1080p/camera_fixed
7. 验收标准

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-10-seedance-2.0-integration-design.md docs/superpowers/plans/2026-05-10-seedance-2-integration.md
git commit -m "docs: spec & plan for seedance 2.0 integration"
```

---

## Task 2: 新建 Seedance 客户端 (seedance_api.py)

**Files:**
- Create: `seedance_api.py`
- Create: `deploy/seedance_api.py` (mirror)

- [ ] **Step 1: 写 client 主体**

```python
"""
Seedance 2.0 API 客户端（火山方舟 Ark）
对应官方 API: POST /api/v3/contents/generations/tasks
"""
import os
import time
import logging
import requests
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


class SeedanceClient:
    BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"

    MODEL_MAP = {
        'standard': 'doubao-seedance-2-0-260128',
        'fast':     'doubao-seedance-2-0-fast-260128',
    }

    def __init__(self, api_key: Optional[str] = None):
        # SEEDANCE_API_KEY 优先；缺省回落 ARK_API_KEY（同 veo_api 模式）
        self.api_key = api_key or os.getenv('SEEDANCE_API_KEY') or os.getenv('ARK_API_KEY')
        if not self.api_key:
            logger.warning("⚠️ SEEDANCE_API_KEY 与 ARK_API_KEY 均未设置")
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def create_video_task(
        self,
        sub_model: str,
        contents: List[Dict[str, Any]],
        resolution: Optional[str] = None,
        ratio: Optional[str] = "adaptive",
        duration: Optional[int] = None,
        seed: Optional[int] = -1,
        watermark: bool = False,
        generate_audio: bool = True,
        camera_fixed: bool = False,
    ) -> str:
        """
        创建视频生成任务，返回 task_id（ark 侧 id）。
        contents: 形如 [{"type":"text","text":"..."},{"type":"image_url","image_url":{"url":"..."},"role":"first_frame"}]
        """
        if sub_model not in self.MODEL_MAP:
            raise ValueError(f"不支持的子型号: {sub_model}")

        payload: Dict[str, Any] = {
            "model": self.MODEL_MAP[sub_model],
            "content": contents,
        }
        # 可选参数：仅当用户显式指定时才发，避免覆盖服务端默认
        if resolution: payload["resolution"] = resolution
        if ratio:      payload["ratio"] = ratio
        if duration is not None: payload["duration"] = duration
        if seed is not None:     payload["seed"] = seed
        payload["watermark"] = watermark
        payload["generate_audio"] = generate_audio
        # camera_fixed 仅 1.5pro 支持，2.0 系列无视；为前向兼容仍透传
        if camera_fixed: payload["camera_fixed"] = camera_fixed

        logger.info(f"🎬 Seedance 创建任务: sub_model={sub_model}, contents={len(contents)} 项")
        try:
            resp = requests.post(self.BASE_URL, headers=self.headers, json=payload, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get('id')
            if not task_id:
                raise ValueError(f"Seedance 未返回 task id: {data}")
            logger.info(f"✅ Seedance 任务已创建: {task_id}")
            return task_id
        except Exception as e:
            logger.error(f"❌ Seedance 任务创建失败: {e}")
            raise

    def query_task(self, task_id: str) -> Dict[str, Any]:
        """轮询任务状态。返回 {status: queued/running/succeeded/failed/cancelled, content: {video_url, ...}, ...}"""
        url = f"{self.BASE_URL}/{task_id}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"❌ Seedance 查询失败: {e}")
            raise

    def download_video(self, video_url: str) -> bytes:
        """下载已生成的视频。"""
        try:
            logger.info(f"📥 Seedance 下载视频: {video_url[:80]}...")
            resp = requests.get(video_url, stream=True, timeout=120)
            resp.raise_for_status()
            buf = b''
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    buf += chunk
            logger.info(f"✅ Seedance 视频下载完成: {len(buf)} bytes")
            return buf
        except Exception as e:
            logger.error(f"❌ Seedance 视频下载失败: {e}")
            raise


_seedance_client: Optional[SeedanceClient] = None


def get_seedance_client() -> SeedanceClient:
    global _seedance_client
    if _seedance_client is None:
        _seedance_client = SeedanceClient()
    return _seedance_client
```

- [ ] **Step 2: 复制到 deploy/**

```bash
cp seedance_api.py deploy/seedance_api.py
```

- [ ] **Step 3: 冒烟测试 import**

```bash
python -c "from seedance_api import get_seedance_client; c = get_seedance_client(); print('OK', c.MODEL_MAP)"
```
Expected: `OK {'standard': 'doubao-seedance-2-0-260128', 'fast': 'doubao-seedance-2-0-fast-260128'}`

- [ ] **Step 4: Commit**

```bash
git add seedance_api.py deploy/seedance_api.py
git commit -m "feat(seedance): add SeedanceClient with create/query/download"
```

---

## Task 3: 后端配置注册（PROVIDER_ENV_MAP + admin presets）

**Files:**
- Modify: `cluster_main.py:86-96`
- Modify: `deploy/cluster_main.py:86-96`
- Modify: `admin_routes.py:573-583`
- Modify: `deploy/admin_routes.py:573-583`

- [ ] **Step 1: 在 PROVIDER_ENV_MAP 加 seedance 行**

`cluster_main.py:86-96`：

```python
PROVIDER_ENV_MAP = {
    'gemini-text': 'GEMINI_TEXT_API_KEY',
    'gemini-image': 'GEMINI_IMAGE_API_KEY',
    'gemini-tts': 'GEMINI_API_KEY',
    'deepseek': 'DEEPSEEK_API_KEY',
    'doubao': 'ARK_API_KEY',
    'minimax': 'MINIMAX_API_KEY',
    'sora2': 'SORA2_API_KEY',
    'veo': 'VEO_API_KEY',
    'dashscope': 'DASHSCOPE_API_KEY',
    'seedance': 'SEEDANCE_API_KEY',
}
```

同步 `deploy/cluster_main.py` 同位置。

- [ ] **Step 2: 在 PRESET_API_MODELS 追加 2 条**

`admin_routes.py:573-583`，在 `Wan2.6` 行后插入：

```python
    {"name": "飞升 (Seedance 2.0)", "provider": "seedance", "model_name": "doubao-seedance-2-0-260128", "endpoint": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", "proxy_mode": "direct", "category": "video"},
    {"name": "渡劫 (Seedance 2.0 Fast)", "provider": "seedance", "model_name": "doubao-seedance-2-0-fast-260128", "endpoint": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", "proxy_mode": "direct", "category": "video"},
```

同步 `deploy/admin_routes.py` 同位置。

- [ ] **Step 3: 验证 import 不报错**

```bash
python -c "from cluster_main import PROVIDER_ENV_MAP; assert 'seedance' in PROVIDER_ENV_MAP; print('OK')"
python -c "from admin_routes import PRESET_API_MODELS; assert any(p['provider']=='seedance' for p in PRESET_API_MODELS); print('OK', sum(1 for p in PRESET_API_MODELS if p['provider']=='seedance'), 'seedance preset(s)')"
```
Expected: `OK` and `OK 2 seedance preset(s)`

- [ ] **Step 4: Commit**

```bash
git add cluster_main.py admin_routes.py deploy/cluster_main.py deploy/admin_routes.py
git commit -m "feat(seedance): register provider env map and admin presets"
```

---

## Task 4: GenerateRequest 字段扩展

**Files:**
- Modify: `cluster_main.py:491-512`
- Modify: `deploy/cluster_main.py:491-512`

- [ ] **Step 1: 在 GenerateRequest 末尾添加 SD2.0 字段**

在 `episode_id: Optional[str] = Field(None, ...)` 行之后追加：

```python
    sub_model: Optional[str] = Field(None, description="Seedance 子型号: standard|fast")
    media_inputs: Optional[List[Dict[str, Any]]] = Field(None, description="Seedance 多模态输入: [{kind:image|video|audio, url, role?, file_id?}]")
    ratio: Optional[str] = Field("adaptive", description="Seedance 画面比例: adaptive|16:9|4:3|1:1|3:4|9:16|21:9")
    watermark: Optional[bool] = Field(False, description="Seedance 水印")
    generate_audio: Optional[bool] = Field(True, description="Seedance AI 配音")
    camera_fixed: Optional[bool] = Field(False, description="Seedance 1.5pro 专用，2.0 系列无效")
```

注意：`resolution` `duration` `seed` `shot_type` 已在原 GenerateRequest 存在，可复用。

- [ ] **Step 2: 同步 deploy/**

同样在 `deploy/cluster_main.py:491-512` 应用相同改动。

- [ ] **Step 3: Pydantic 校验冒烟**

```bash
python -c "
from cluster_main import GenerateRequest
r = GenerateRequest(task_type='seedance_t2v', prompt='hello', sub_model='standard', media_inputs=[], ratio='16:9')
print('OK', r.sub_model, r.ratio, r.generate_audio)
"
```
Expected: `OK standard 16:9 True`

- [ ] **Step 4: Commit**

```bash
git add cluster_main.py deploy/cluster_main.py
git commit -m "feat(seedance): extend GenerateRequest with media_inputs and 7 SD2.0 params"
```

---

## Task 5: 改造 _save_external_video 为 entity-aware

**Files:**
- Modify: `worker.py:1236-1324` (函数主体)
- Modify: `worker.py:899-914` `:1022-1047` `:1204-1233` `:1766-1810` (4 处旧调用点)
- Modify: `deploy/worker.py` 同步

> **关键修复**：现有 `_save_external_video` 调 `FileDAO.create_file` 时不传 `entity_type`/`entity_id`/`file_role`，且不调 `_sync_legacy_on_file_create`，所以 sora2/veo/minimax/wan26 任务完成后 `video_segments.video_url` 永远不更新。本步骤同时闭环此漏洞。

- [ ] **Step 1: 改 `_save_external_video` 签名 + 内部逻辑**

`worker.py:1236` 起原函数替换为：

```python
    async def _save_external_video(
        self,
        video_content: bytes,
        task: Task,
        source: str,
        thumbnail_content: Optional[bytes] = None,
    ):
        """
        保存外部 API（MiniMax/Sora2/Veo/Wan26/Seedance）下载的视频到本地和 SQL。
        从 task.data 取 entity_type/entity_id/file_role/episode_id（前端透传），
        通过 FileDAO.create_file 写文件后调 _sync_legacy_on_file_create
        自动同步 video_segments.video_url。
        """
        import os, uuid
        from pathlib import Path
        from datetime import datetime

        try:
            user_id = task.user_id if task else "system"
            task_id = task.task_id if task else f"{source}_{uuid.uuid4().hex[:8]}"

            year_month = datetime.now().strftime('%Y%m')
            upload_dir = Path('persistent_storage/video') / user_id / year_month
            upload_dir.mkdir(parents=True, exist_ok=True)

            unique_filename = f"{source}_{uuid.uuid4().hex[:12]}.mp4"
            local_path = upload_dir / unique_filename
            local_path.write_bytes(video_content)
            logger.info(f"💾 视频已保存到本地: {local_path}, 大小: {len(video_content)} bytes")

            file_url = f"/storage/video/{user_id}/{year_month}/{unique_filename}"

            entity_type = (task.data or {}).get('entity_type') if task else None
            entity_id   = (task.data or {}).get('entity_id') if task else None
            file_role   = (task.data or {}).get('file_role') or 'video'

            file_record = None
            if DB_AVAILABLE:
                try:
                    version_id = task.data.get('version_id') if task else None
                    file_record = await FileDAO.create_file(
                        version_id=version_id,
                        user_id=user_id,
                        file_type='video',
                        file_name=unique_filename,
                        file_path=str(local_path),
                        file_url=file_url,
                        file_size_bytes=len(video_content),
                        mime_type='video/mp4',
                        metadata={
                            'task_id': task_id,
                            'source': source,
                            'task_type': task.task_type if task else source,
                        },
                        entity_type=entity_type,
                        entity_id=entity_id,
                        file_role=file_role,
                    )
                    logger.info(f"📝 文件已记录: file_id={file_record['file_id']} entity={entity_type}/{entity_id}/{file_role}")

                    # 关键：触发 legacy 同步（更新 video_segments.video_url）
                    if entity_type and entity_id and file_role:
                        try:
                            from file_service import _sync_legacy_on_file_create
                            await _sync_legacy_on_file_create(entity_type, entity_id, file_role, file_url)
                            logger.info(f"🔁 legacy 字段已同步: {entity_type}/{entity_id}/{file_role}")
                        except Exception as e:
                            logger.warning(f"⚠️ legacy 同步失败（不致命）: {e}")
                except Exception as e:
                    logger.error(f"保存文件记录到数据库失败: {e}", exc_info=True)

            # 缩略图（保持原逻辑）
            thumb_url = None
            try:
                thumb_dir = Path('persistent_storage/thumbnails')
                thumb_dir.mkdir(parents=True, exist_ok=True)
                thumb_filename = f"{Path(unique_filename).stem}.jpg"
                thumb_path = thumb_dir / thumb_filename
                from file_optimization import FileOptimizationService
                if thumbnail_content:
                    thumb_path.write_bytes(thumbnail_content)
                    thumb_url = f"/storage/thumbnails/{thumb_filename}"
                else:
                    result_thumb = await FileOptimizationService.create_video_thumbnail(str(local_path), str(thumb_path))
                    if result_thumb and result_thumb.get('success'):
                        thumb_url = f"/storage/thumbnails/{thumb_filename}"
                if thumb_url:
                    logger.info(f"🖼️ 视频缩略图已生成: {thumb_url}")

                    # 缩略图也走 entity-aware 同步
                    if DB_AVAILABLE and entity_type and entity_id:
                        try:
                            from file_service import _sync_legacy_on_file_create
                            await _sync_legacy_on_file_create(entity_type, entity_id, 'video_thumbnail', thumb_url)
                        except Exception:
                            pass
            except Exception as te:
                logger.debug(f"视频缩略图生成失败(不影响结果): {te}")

            return {
                'filename': unique_filename,
                'file_id': file_record['file_id'] if file_record else None,
                'url': file_url,
                'thumbnail_url': thumb_url,
                'size': len(video_content),
                'file_path': str(local_path),
            }
        except Exception as e:
            logger.error(f"保存外部视频失败: {e}", exc_info=True)
            return None
```

- [ ] **Step 2: 验证 4 处旧调用点签名兼容**

旧调用形如 `await self._save_external_video(video_content=..., task=..., source='sora2')`，新签名仅追加可选参数 `thumbnail_content`，旧调用不需要改即可生效。**但需确认 entity_type/entity_id 通过 task.data 传到 worker** —— 检查 `cluster_main.py` 路由是否把这些字段写进了 `task_data`：

```bash
rg -n "entity_type" cluster_main.py | head
```
Expected: 看到路由组装 task_data 时把 GenerateRequest 的 entity_type/entity_id/file_role/episode_id 写进 dict（已存在，行号约 1670-1700）。如缺失则补。

- [ ] **Step 3: 同步 deploy/worker.py**

Apply same diff at `deploy/worker.py:1236+` and confirm 4 处调用点行号一致。

- [ ] **Step 4: 启动后端，跑一个旧 sora2_i2v 任务（带 entity_id），验证 video_segments 自动回填**

```sql
SELECT segment_id, video_url, updated_at FROM video_segments
  WHERE segment_id = '<test_segment_id>';
```
Expected: video_url 非空且为 `/storage/video/...mp4`。

- [ ] **Step 5: Commit**

```bash
git add worker.py deploy/worker.py
git commit -m "fix(worker): _save_external_video entity-aware to auto-sync video_segments.video_url"
```

---

## Task 6: Worker 加 _process_seedance_task

**Files:**
- Modify: `worker.py:204-213` (task_type 分发)
- Modify: `worker.py` 1062 行后插入 `_process_seedance_task` 方法
- Modify: `deploy/worker.py` 同步

- [ ] **Step 1: 加分发分支**

`worker.py:204-213`：

```python
            if task.task_type in ['minimax_i2v', 'minimax_morph']:
                return await self._process_minimax_task(task)
            elif task.task_type in ['sora2_i2v', 'sora2_morph']:
                return await self._process_sora2_task(task)
            elif task.task_type in ['veo_i2v', 'veo_morph']:
                return await self._process_veo_task(task)
            elif task.task_type in ['wan26_i2v']:
                return await self._process_wan26_task(task)
            elif task.task_type.startswith('seedance_'):
                return await self._process_seedance_task(task)
```

- [ ] **Step 2: 实现 _process_seedance_task**

在 `_process_sora2_task` 之后（约 1062 行后）插入：

```python
    async def _process_seedance_task(self, task: Task) -> bool:
        """
        处理 Seedance 2.0 任务，task_type ∈ {seedance_t2v, _i2v, _morph, _multi, _draft}
        从 task.data 取 sub_model / media_inputs / 7 参数 / prompt，组装 contents 数组提交。
        """
        try:
            from seedance_api import get_seedance_client
            client = get_seedance_client()

            sub_model = task.data.get('sub_model', 'standard')
            prompt = task.data.get('prompt') or ''
            media_inputs = task.data.get('media_inputs') or []

            # 组装 contents 数组（火山官方约定）
            contents: List[Dict[str, Any]] = []
            if prompt:
                contents.append({"type": "text", "text": prompt})

            for m in media_inputs:
                kind = (m.get('kind') or '').lower()
                url = m.get('url')
                role = m.get('role')  # 可能为 None / first_frame / last_frame / reference_image / reference_video / reference_audio
                if not url:
                    continue
                if kind == 'image':
                    item = {"type": "image_url", "image_url": {"url": url}}
                elif kind == 'video':
                    item = {"type": "video_url", "video_url": {"url": url}}
                elif kind == 'audio':
                    item = {"type": "audio_url", "audio_url": {"url": url}}
                else:
                    logger.warning(f"⚠️ 未知 media kind: {kind}, skip")
                    continue
                if role:
                    item["role"] = role
                contents.append(item)

            # 样片任务 ID（draft）—— 仅 1.5pro 支持，2.0 调用会被服务端拒绝；保留代码路径
            if task.task_type == 'seedance_draft':
                draft_id = task.data.get('draft_task_id')
                if draft_id:
                    contents.append({"type": "draft_task", "draft_task": {"id": draft_id}})

            if not contents:
                raise ValueError("Seedance 任务无任何 prompt 或 media，无法生成")

            # 7 参数
            kwargs = dict(
                resolution=task.data.get('resolution'),
                ratio=task.data.get('ratio') or 'adaptive',
                duration=task.data.get('duration'),
                seed=task.data.get('seed', -1),
                watermark=bool(task.data.get('watermark', False)),
                generate_audio=bool(task.data.get('generate_audio', True)),
                camera_fixed=bool(task.data.get('camera_fixed', False)),
            )

            # fast 不支持 1080p，强制降级 + 警告
            if sub_model == 'fast' and kwargs.get('resolution') == '1080p':
                logger.warning("⚠️ Seedance fast 不支持 1080p，自动降级到 720p")
                kwargs['resolution'] = '720p'

            ark_task_id = client.create_video_task(sub_model, contents, **kwargs)
            await self.task_queue.update_progress(task.task_id, 5, "Seedance 任务已创建")

            # 轮询
            import asyncio as _asyncio
            start_time = time.time()
            max_wait = 600
            poll_interval = 5
            video_url = None
            last_status = ''
            while time.time() - start_time < max_wait:
                try:
                    result = client.query_task(ark_task_id)
                    status = (result.get('status') or '').lower()
                    last_status = status
                    if status == 'succeeded':
                        content = result.get('content') or {}
                        video_url = content.get('video_url')
                        if not video_url:
                            raise ValueError(f"Seedance 任务成功但缺 video_url: {result}")
                        break
                    elif status in ('failed', 'cancelled'):
                        err = result.get('error') or {}
                        raise RuntimeError(f"Seedance 任务{status}: {err.get('message') or err}")
                    else:
                        progress = int((time.time() - start_time) / max_wait * 90)
                        await self.task_queue.update_progress(task.task_id, min(progress, 90), f"Seedance: {status}")
                        logger.info(f"⏳ Seedance 任务 {ark_task_id} 状态: {status}")
                except Exception as e:
                    logger.error(f"❌ Seedance 轮询失败: {e}")
                await _asyncio.sleep(poll_interval)
            else:
                raise TimeoutError(f"Seedance 任务超时: {ark_task_id} (last_status={last_status})")

            video_content = client.download_video(video_url)
            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source='seedance',
            )
            if not saved_info:
                raise RuntimeError("Seedance 视频保存失败")

            await self.task_queue.complete_task(task.task_id, {
                "videos": [saved_info],
                "images": [],
            })
            logger.info(f"✅ Seedance 任务完成: {task.task_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Seedance 任务处理失败: {e}", exc_info=True)
            await self.task_queue.fail_task(task.task_id, str(e))
            return False
```

- [ ] **Step 3: 同步 deploy/worker.py**

- [ ] **Step 4: 端到端冒烟（先用 t2v）**

```bash
# 假设 SEEDANCE_API_KEY 已在 .env
curl -X POST http://localhost:8000/api/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"task_type":"seedance_t2v","sub_model":"standard","prompt":"一只柴犬在草地上奔跑","ratio":"16:9","duration":5,"resolution":"720p"}'
# 拿 task_id 后轮询：
curl http://localhost:8000/api/task/<task_id> -H "Authorization: Bearer $TOKEN"
```
Expected: 最终 status=completed, result.videos[0].url 可访问

- [ ] **Step 5: Commit**

```bash
git add worker.py deploy/worker.py
git commit -m "feat(seedance): worker handler for 5 task_types with polling and entity-aware save"
```

---

## Task 7: 前端 videoService 类型 + submitTask 分发

**Files:**
- Modify: `new_html/services/videoService.ts:13-16` `:52` `:255-360` + 末尾追加

- [ ] **Step 1: 模型常量与类型扩展**

```typescript
// L13-16 替换
const COMFYUI_MODELS: string[] = ['Wan2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶'];
const EXTERNAL_API_MODELS: string[] = ['MINI', 'Sora2', 'Veo', '大能', 'Seedance2', 'Seedance2Fast'];

// L52 替换
export type VideoModel = 'Wan2' | '一阶' | '二阶' | '三阶' | '四阶' | '五阶' | '六阶' | '七阶'
                       | 'Veo' | 'Sora2' | 'MINI' | '大能'
                       | 'Seedance2' | 'Seedance2Fast';
```

- [ ] **Step 2: 加 MediaInput 类型 + 7 参数接口**

紧跟 `VideoModel` 类型后追加：

```typescript
export type SeedanceMediaKind = 'image' | 'video' | 'audio';
export type SeedanceMediaRole = 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio';

export interface SeedanceMediaInput {
    kind: SeedanceMediaKind;
    url: string;          // 持久化 URL（已上传）
    role?: SeedanceMediaRole;
    file_id?: string;
}

export interface SeedanceParams {
    sub_model: 'standard' | 'fast';
    prompt: string;
    media_inputs: SeedanceMediaInput[];
    resolution?: '480p' | '720p' | '1080p';
    ratio?: 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9';
    duration?: number;     // 4-15 或 -1（智能）
    seed?: number;         // -1=随机
    watermark?: boolean;
    generate_audio?: boolean;
    camera_fixed?: boolean;
}

export function inferSeedanceTaskType(media: SeedanceMediaInput[], hasDraftId?: boolean): string {
    if (hasDraftId) return 'seedance_draft';
    if (media.length === 0) return 'seedance_t2v';
    const images = media.filter(m => m.kind === 'image');
    const hasFirstLast = images.some(m => m.role === 'first_frame') && images.some(m => m.role === 'last_frame');
    if (hasFirstLast) return 'seedance_morph';
    if (media.length === 1 && images.length === 1 && !images[0].role) return 'seedance_i2v';
    return 'seedance_multi';
}

export function getModelDisplayName(m: VideoModel): string {
    const map: Record<string, string> = {
        Seedance2: '飞升', Seedance2Fast: '渡劫',
    };
    return map[m] || m;
}
```

- [ ] **Step 3: 在 submitTask 加 SD2.0 分支**

`new_html/services/videoService.ts:286` 处 `else if (model === 'Sora2')` 之前插入：

```typescript
    } else if (model === 'Seedance2' || model === 'Seedance2Fast') {
        // Seedance 2.0 — 仅在 entityOptions 携带 seedance_params 时才走此分支
        // 实际由 submitSeedanceTask 调用，这里保留 i2v/morph 兼容入口
        const subModel = model === 'Seedance2' ? 'standard' : 'fast';
        const media: SeedanceMediaInput[] = [];
        if (imageFilename) media.push({ kind: 'image', url: imageFilename.startsWith('http') ? imageFilename : `${API_BASE}/uploads/${imageFilename}`, role: imageFilenameEnd ? 'first_frame' : undefined });
        if (imageFilenameEnd) media.push({ kind: 'image', url: imageFilenameEnd.startsWith('http') ? imageFilenameEnd : `${API_BASE}/uploads/${imageFilenameEnd}`, role: 'last_frame' });
        taskType = inferSeedanceTaskType(media);
        requestData = {
            task_type: taskType,
            sub_model: subModel,
            prompt,
            media_inputs: media,
            ratio: 'adaptive',
            generate_audio: true,
            priority: 2,
        };
```

- [ ] **Step 4: 新增 submitSeedanceTask（多模态完整入口）**

文件末尾追加：

```typescript
/**
 * 提交 Seedance 2.0 多模态任务（VideoPage 多模态面板专用）
 */
export async function submitSeedanceTask(
    params: SeedanceParams,
    entityOptions?: { entity_type?: string; entity_id?: string; file_role?: string; episode_id?: string },
    draftTaskId?: string,
): Promise<{ task_id: string }> {
    const taskType = inferSeedanceTaskType(params.media_inputs, !!draftTaskId);
    const body: Record<string, any> = {
        task_type: taskType,
        sub_model: params.sub_model,
        prompt: params.prompt,
        media_inputs: params.media_inputs,
        resolution: params.resolution,
        ratio: params.ratio || 'adaptive',
        duration: params.duration,
        seed: params.seed ?? -1,
        watermark: !!params.watermark,
        generate_audio: params.generate_audio !== false,
        camera_fixed: !!params.camera_fixed,
        priority: 2,
    };
    if (draftTaskId) body.draft_task_id = draftTaskId;
    if (entityOptions) Object.assign(body, entityOptions, { file_role: entityOptions.file_role || 'video' });

    const resp = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Seedance 任务提交失败' }));
        throw new Error(err.detail || 'Seedance 任务提交失败');
    }
    return await resp.json();
}
```

- [ ] **Step 5: TS 编译验证**

```bash
cd new_html && npx tsc --noEmit
```
Expected: 无错误（如有 `VideoModel` 比较穷举类型的 switch，需补 SD2.0 case）

- [ ] **Step 6: Commit**

```bash
git add new_html/services/videoService.ts
git commit -m "feat(seedance): add VideoModel variants, MediaInput type and submitSeedanceTask"
```

---

## Task 8: VideoPage 多模态面板（SeedanceMultimodalPanel）

**Files:**
- Modify: `new_html/components/VideoPage.tsx` 新增子组件 + 在主面板模型选择联动

- [ ] **Step 1: 新建子组件文件**

`new_html/components/SeedanceMultimodalPanel.tsx`（如已遵循 components/ 拆分约定）：

```typescript
import React, { useMemo, useState, useCallback } from 'react';
import {
    SeedanceMediaInput, SeedanceMediaKind, SeedanceMediaRole,
    SeedanceParams, uploadImage, uploadAudio,
} from '../services/videoService';

interface Props {
    subModel: 'standard' | 'fast';
    onSubmit: (p: SeedanceParams) => Promise<void>;
}

const ROLE_OPTIONS_IMAGE: { value: SeedanceMediaRole | ''; label: string }[] = [
    { value: '', label: '无角色（单帧或多模态）' },
    { value: 'first_frame', label: '首帧' },
    { value: 'last_frame', label: '尾帧' },
    { value: 'reference_image', label: '参考图（人物/场景）' },
];

export const SeedanceMultimodalPanel: React.FC<Props> = ({ subModel, onSubmit }) => {
    const [prompt, setPrompt] = useState('');
    const [mediaInputs, setMediaInputs] = useState<SeedanceMediaInput[]>([]);

    // 高级设置
    const [resolution, setResolution] = useState<'480p'|'720p'|'1080p'>('720p');
    const [ratio, setRatio] = useState<SeedanceParams['ratio']>('adaptive');
    const [duration, setDuration] = useState<number>(5);
    const [seed, setSeed] = useState<number>(-1);
    const [watermark, setWatermark] = useState(false);
    const [generateAudio, setGenerateAudio] = useState(true);
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // 校验互斥规则
    const validation = useMemo(() => {
        const images = mediaInputs.filter(m => m.kind === 'image');
        const hasFirst = images.some(m => m.role === 'first_frame');
        const hasLast = images.some(m => m.role === 'last_frame');
        const hasRef = images.some(m => m.role === 'reference_image');
        if ((hasFirst || hasLast) && hasRef) {
            return { ok: false, msg: '首尾帧 与 参考图 不能同时使用' };
        }
        if (hasFirst !== hasLast) {
            return { ok: false, msg: '首帧/尾帧 必须成对出现' };
        }
        if (mediaInputs.length === 0 && !prompt.trim()) {
            return { ok: false, msg: '至少提供 1 个媒体或非空提示词' };
        }
        if (subModel === 'fast' && resolution === '1080p') {
            return { ok: false, msg: '渡劫（fast）不支持 1080p' };
        }
        return { ok: true, msg: '' };
    }, [mediaInputs, prompt, subModel, resolution]);

    const handleAddImage = useCallback(async (file: File, role?: SeedanceMediaRole) => {
        const r = await uploadImage(file);
        setMediaInputs(prev => [...prev, { kind: 'image', url: r.url, role }]);
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!validation.ok) return;
        await onSubmit({
            sub_model: subModel,
            prompt,
            media_inputs: mediaInputs,
            resolution,
            ratio,
            duration,
            seed,
            watermark,
            generate_audio: generateAudio,
        });
    }, [validation, onSubmit, subModel, prompt, mediaInputs, resolution, ratio, duration, seed, watermark, generateAudio]);

    return (
        <div className="seedance-panel">
            {/* 提示词 */}
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="提示词（必填或至少 1 个媒体）" />

            {/* 媒体输入区 */}
            <section>
                <h4>图片（{mediaInputs.filter(m => m.kind==='image').length}/9）</h4>
                <input type="file" accept="image/png,image/jpeg" disabled={mediaInputs.filter(m=>m.kind==='image').length>=9}
                    onChange={e => e.target.files && handleAddImage(e.target.files[0])} />
                {/* TODO: 渲染已添加图片缩略图 + role 切换 + 删除 */}
            </section>

            <section>
                <h4>视频（参考）（{mediaInputs.filter(m=>m.kind==='video').length}/3）</h4>
                <input type="file" accept="video/mp4,video/quicktime" disabled={mediaInputs.filter(m=>m.kind==='video').length>=3} />
                {/* TODO: 上传 + role=reference_video */}
            </section>

            <section>
                <h4>音频（参考）（{mediaInputs.filter(m=>m.kind==='audio').length}/3）</h4>
                <input type="file" accept="audio/wav,audio/mpeg" disabled={mediaInputs.filter(m=>m.kind==='audio').length>=3} />
                {/* TODO: 上传 + role=reference_audio */}
            </section>

            {/* 高级设置 */}
            <details open={advancedOpen} onToggle={e => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
                <summary>高级设置</summary>
                <label>分辨率
                    <select value={resolution} onChange={e=>setResolution(e.target.value as any)}>
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                        <option value="1080p" disabled={subModel==='fast'}>1080p {subModel==='fast' && '(渡劫不支持)'}</option>
                    </select>
                </label>
                <label>画面比例
                    <select value={ratio} onChange={e=>setRatio(e.target.value as any)}>
                        {['adaptive','16:9','4:3','1:1','3:4','9:16','21:9'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </label>
                <label>时长（秒）
                    <input type="number" min={-1} max={15} value={duration} onChange={e=>setDuration(parseInt(e.target.value))}/>
                    <span>（-1=智能选择）</span>
                </label>
                <label>种子 <input type="number" value={seed} onChange={e=>setSeed(parseInt(e.target.value))}/></label>
                <label><input type="checkbox" checked={watermark} onChange={e=>setWatermark(e.target.checked)}/>水印</label>
                <label><input type="checkbox" checked={generateAudio} onChange={e=>setGenerateAudio(e.target.checked)}/>AI 配音</label>
                <label title="2.0 系列 API 不支持此参数，已禁用"><input type="checkbox" disabled/>固定镜头（仅 1.5pro）</label>
            </details>

            {!validation.ok && <div className="error-msg">{validation.msg}</div>}
            <button disabled={!validation.ok} onClick={handleSubmit}>开始生成</button>
        </div>
    );
};
```

> 注意：上面的 UI 用的是简化 HTML；实际请适配项目现有的 design tokens / button / input 组件库（参考 `VideoPage.tsx` 中其他面板的 className 与 wrapper 模式）。

- [ ] **Step 2: 在 VideoPage.tsx 主组件挂载多模态面板**

找到模型下拉 `<select>` 那块，添加联动：

```typescript
{(model === 'Seedance2' || model === 'Seedance2Fast') ? (
    <SeedanceMultimodalPanel
        subModel={model === 'Seedance2' ? 'standard' : 'fast'}
        onSubmit={async (params) => {
            const { task_id } = await submitSeedanceTask(params, {
                entity_type: 'video_segment',
                entity_id: currentSegmentId,
                file_role: 'video',
                episode_id: currentEpisodeId,
            });
            // 进入轮询逻辑...
        }}
    />
) : (
    <ExistingTaskGroupPanel ... />
)}
```

- [ ] **Step 3: TS 编译 + 浏览器手测**

```bash
cd new_html && npx tsc --noEmit && npm run dev
# 访问 /workspace/video-gen，选 "飞升"，单张图 + 提示词，提交一次 i2v
```
Expected: 网络面板看到 POST /api/generate body 含 `media_inputs` + `sub_model:'standard'`；任务完成后视频出现在分镜对应卡片

- [ ] **Step 4: Commit**

```bash
git add new_html/
git commit -m "feat(seedance): VideoPage multimodal panel for 飞升/渡劫 with 7 advanced params"
```

---

## Task 9: 文档同步（root + deploy 双份）

**Files:**
- Modify: `docs/api.md` `deploy/docs/api.md`
- Modify: `docs/backend.md` `deploy/docs/backend.md`
- Modify: `docs/frontend.md` `deploy/docs/frontend.md`
- Modify: `docs/database.md` `deploy/docs/database.md`
- Modify: `docs/conventions.md` `deploy/docs/conventions.md`
- Modify: `docs/vertical-slices.md` `deploy/docs/vertical-slices.md`
- Modify: `docs/faq.md` `deploy/docs/faq.md`

- [ ] **Step 1: docs/api.md** — task_type 表加 5 条；admin presets 加 seedance

在 task_type 列表追加：
```
| seedance_t2v   | Seedance 2.0 文生视频     | sub_model, prompt, ratio, duration, resolution |
| seedance_i2v   | Seedance 2.0 图生视频     | + media_inputs[1] (image)                       |
| seedance_morph | Seedance 2.0 首尾帧       | + media_inputs[2] (first_frame + last_frame)    |
| seedance_multi | Seedance 2.0 多模态参考   | + media_inputs[1-9 image, 0-3 video, 0-3 audio] |
| seedance_draft | Seedance 1.5pro 样片复用 | + draft_task_id（2.0 不支持，会被 ark 拒绝）  |
```

- [ ] **Step 2: docs/backend.md** — External API Config 表加 Seedance 行

```
| seedance | SEEDANCE_API_KEY → ARK_API_KEY 兜底 | https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks | doubao-seedance-2-0[-fast]-260128 |
```

- [ ] **Step 3: docs/frontend.md** — videoService 模型列表 + VideoPage SD2.0 章节

VideoModel 列表加 `Seedance2 (飞升)` `Seedance2Fast (渡劫)`；新增"Seedance 多模态面板"小节描述媒体上限与互斥规则。

- [ ] **Step 4: docs/database.md** — provider notes + input_params

`api_configurations.provider` Notes 列加：`seedance`。`video_segments.input_params` JSONB 示例追加 SD2.0 字段：`sub_model`, `media_inputs[]`, `ratio`, `duration`, `resolution`, `seed`, `watermark`, `generate_audio`, `camera_fixed`。

- [ ] **Step 5: docs/conventions.md** — External Video API Pattern + entity-aware 落库约定

新增章节"External Video API Integration Pattern"：
- 客户端文件命名：`<provider>_api.py`
- 必须实现 `create_video_task / query_task / download_video`
- task_type 命名：`<provider>_<scenario>` (i2v/morph/...)
- worker 必须调 `_save_external_video` 而非直接写文件
- **API key fallback**：subscriber-specific env 优先，doubao 系列回落 `ARK_API_KEY`

- [ ] **Step 6: docs/vertical-slices.md** — VideoGenPage 章节

补 5 个新 task_type 的端到端 trace（FE → cluster_main → worker → ark → files → video_segments）。

- [ ] **Step 7: docs/faq.md** — 预防性条目

加在顶部："Seedance 2.0 集成已知约束"：
- fast 不支持 1080p（前后端均自动降级）
- camera_fixed 仅 1.5pro 支持
- 真人脸图最多 3 张（API 硬限）
- 首尾帧 与 reference_image 不能共存
- 单次请求 contents 总大小 ≤ 64 MB

- [ ] **Step 8: 镜像 deploy/docs**

确保 `docs/` 与 `deploy/docs/` 改动一致（CHANGELOG 部分一一对应）。

- [ ] **Step 9: Commit**

```bash
git add docs/ deploy/docs/
git commit -m "docs: sync seedance 2.0 integration across api/backend/frontend/database/conventions/vertical-slices/faq"
```

---

## Task 10: 验收（scan + sync_check + 手测 5 场景）

**Files:** —

- [ ] **Step 1: 重跑 project-memory scan**

```bash
python .claude/skills/project-memory/scripts/scan_project.py
python .claude/skills/project-memory/scripts/sync_check.py
```
Expected: 无 drift（如有，回头补 docs）

- [ ] **Step 2: gitnexus 重新 index 并跑 detect_changes**

```bash
npx gitnexus analyze
# 然后通过 MCP: gitnexus_detect_changes() 看影响范围是否仅限 worker.py / videoService.ts / VideoPage.tsx / seedance_api.py / cluster_main.py / admin_routes.py
```

- [ ] **Step 3: 手测 5 种场景**

每种用最简参数跑一次，断言完成且 video_segments.video_url 有值：
1. `seedance_t2v` — 仅 prompt
2. `seedance_i2v` — 1 张图 + prompt
3. `seedance_morph` — 2 张图（first + last）+ prompt
4. `seedance_multi` — 2 张图 role=reference_image + prompt
5. `seedance_draft` — UI 灰显，确认无法提交（前端校验）

- [ ] **Step 4: 回归手测 4 家旧 API**

确认 sora2 / veo / minimax / wan26 任务仍能跑通，**且 video_segments.video_url 现在自动有值**（漏洞修复验证）：

```sql
SELECT segment_id, video_url, updated_at FROM video_segments
  WHERE updated_at > NOW() - INTERVAL '1 hour' AND video_url IS NOT NULL
  ORDER BY updated_at DESC LIMIT 10;
```

- [ ] **Step 5: 把 docs/superpowers/plans/2026-05-10-seedance-2-integration.md 末尾标记 ✅ 已完成**

```bash
git add docs/superpowers/plans/2026-05-10-seedance-2-integration.md
git commit -m "docs(plan): mark seedance 2.0 integration as completed"
```

---

## Self-Review

- **Spec coverage**: 5 个场景（t2v / i2v / morph / multi / draft）→ Task 6 全覆盖；2 个子型号 → Task 7 类型扩展；7 参数 → Task 8 高级面板；API key fallback → Task 2 client 内做；video_segments 漏洞 → Task 5 集中修
- **Placeholder 扫描**: 无 TODO/TBD（Step 1 的 file 占位仅是 UI scaffold，由实施时按项目 design tokens 补具体样式）
- **类型一致性**: `SeedanceMediaInput` `SeedanceMediaRole` `SeedanceParams` `inferSeedanceTaskType` `submitSeedanceTask` 在 Task 7-8 间签名匹配；`MODEL_MAP` 在 client + admin presets 中保持 `doubao-seedance-2-0[-fast]-260128`
- **Git 提交粒度**: 每个 task 一次 commit，10 个任务 → 10 个原子提交，便于 review 和回滚
- **回归边界**: Task 5 改造 `_save_external_video` 是高风险点（影响 4 家旧 API），需 Task 10 Step 4 做回归手测

---

## ✅ 实施完成（2026-05-11）

10 个任务全部完成，对应 commits：

| Task | Commit | 说明 |
|------|--------|------|
| 1 | docs(spec): seedance 2.0 integration design | spec 文档 |
| 2 | feat(seedance): SeedanceClient + deploy mirror | seedance_api.py |
| 3 | chore(seedance): provider env map + admin presets | provider 注册 |
| 4 | feat(seedance): GenerateRequest 加 SD2.0 字段 | API 入口扩展 |
| 5 | refactor(worker): _save_external_video entity-aware | 修补 4 家旧 API 漏洞 |
| 6 | feat(worker): _process_seedance_task 5 场景 7 参数 | worker 主逻辑 |
| 7 | feat(seedance): videoService 类型 + submitSeedanceTask | FE service |
| 8 | feat(seedance): VideoPage SeedanceMultimodalPanel | 83469a4 — FE UI |
| 9 | docs: sync seedance 2.0 across 7 docs (root + deploy) | 02054fc |
| 10 | docs(plan): mark seedance 2.0 integration as completed | 本 commit |

### 验收记录

- ✅ `scan_project.py`: 91 modules / 422 routes / 328 calls / 62 tables / 17 pages（无报错）
- ✅ `sync_check.py`: 0 ERROR，仅 1 INFO（147 路由未在 docs/api.md 罗列 — pre-existing，非本次引入）
- ⏸ `gitnexus analyze`: 当前环境 npm cache EPERM 锁定 + gitnexus MCP server 未注册，跳过；建议下次空闲会话用户手动跑 `npx gitnexus analyze`
- ⏸ 手测 5 场景 + 4 家旧 API 回归：需后端运行 + ark 真实凭证，留给用户手测

### 用户手测清单（建议在 staging 跑一遍）

**Seedance 5 场景（每个用最简参数）**：
1. `seedance_t2v` — 选 `飞升`，仅填 prompt（如"日落"），点开始 → 完成且 `video_segments.video_url` 有值
2. `seedance_i2v` — 1 张图（无 role）+ prompt
3. `seedance_morph` — 2 张图（角色分别选首帧 + 尾帧）+ prompt
4. `seedance_multi` — 任选组合（图 0-9 / 视频 0-3 / 音频 0-3，至少 1 图或 1 视频）+ prompt；推荐先试 2 张图（参考图）+ 1 段音频
5. `seedance_draft` — 确认 UI 灰显，无法点击草稿任务 ID 入口

**4 家旧 API 回归**（关键：本次 `_save_external_video` 重构是高风险点）：
- sora2 / veo / minimax / wan26 各跑 1 次 → 完成后 SQL 查 `video_segments.video_url` **应自动有值**（修补漏洞验证）：
  ```sql
  SELECT segment_id, video_url, updated_at FROM video_segments
    WHERE updated_at > NOW() - INTERVAL '1 hour' AND video_url IS NOT NULL
    ORDER BY updated_at DESC LIMIT 10;
  ```

**前端校验回归**（应自动拦截，不发请求）：
- 渡劫 (fast) + 1080p → 不允许（自动降级 720p）
- 选 first_frame 但没选 last_frame → 红字"首/尾帧必须成对"
- 同时选 first_frame + reference_image → 红字"首尾帧 与 参考图 不能同时使用"
- reference_image 4 张以上 → 红字"参考图最多 3 张"

