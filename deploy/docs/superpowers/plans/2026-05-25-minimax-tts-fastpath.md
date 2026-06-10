# MiniMax TTS Fast-Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为短文本 TTS 试听新增一条 handler-内同步 fast-path（`POST /api/minimax/tts/sync`），跳过 worker / Redis 队列 / 轮询四个环节，把试听延迟从「数十秒到分钟级」降到「1-3 秒」；批量生成场景继续走原有 worker 异步路径。

**Architecture:** 双轨并行。`POST /api/minimax/tts/sync` 在 handler 内直接 `await client.tts_sync(...)`（典型 1-15s，远低于 autodl 反代 5min idle 边界），同步入库并返回 `audio_url + file_id`。`POST /api/minimax/tts`（worker 路径）保留不动，给批量生成 / 长文本 / 需要 retry 的场景。前端 `VoiceSidebar.handlePreview`（试听）切到 fast-path；`AudioStagePage.runGenerate`（单条对白）保留 worker 路径（一集 200 条要享受并发控制 + retry）。

**Tech Stack:** Python 3.9 / FastAPI / asyncpg（后端），TypeScript / React / vitest（前端）。复用现有 `MinimaxTTSRequest` Pydantic model、`save_generated_file_to_db`、`CharacterVoiceDAO.update_sample_audio_url`、`minimax_audio.tts_sync`（已经在 2026-05-25 改成返回 `audio_url / local_path / audio_bytes` 三字段的新合约）。

**Recurring-pitfalls 相关章节：** §Q（handler 阻塞撞反代 idle）、§R（sync vs async 接口选择）、§R 子陷阱 3（字段双重语义）、§F（命名空间错乱）、§C（三镜像漂移）。

---

## File Structure

| 文件 | 操作 | 责任 |
|------|------|------|
| `api_routes.py` (+ `deploy/api_routes.py`) | Modify | 在 `minimax_tts` handler 后新增 `minimax_tts_sync` handler。复用 `MinimaxTTSRequest`，调 `client.tts_sync(...)` → `save_generated_file_to_db(...)` → 返回 `audio_url`。 |
| `tests/test_api_minimax_tts_sync.py` | Create | TestClient 跑通新 endpoint：成功路径、text 超长 413、空文本 400、MiniMax 失败 500、bind 回写 character_voice。 |
| `new_html/services/apiService.ts` | Modify | 在 `minimaxTTS` 函数后新增 `minimaxTTSSync()`，返回类型显式包含 `audio_url / file_id / duration_ms`。 |
| `new_html/__tests__/services/minimaxTTSSync.test.ts` | Create | vitest 单测：成功路径 + 413 → 提示用户用异步 endpoint。 |
| `new_html/components/audio/VoiceSidebar.tsx` | Modify | `handlePreview` 试听从「`minimaxTTS` + `pollTtsTaskUntilDone`」改为「`minimaxTTSSync` 一次拿结果」。错误处理保留 AbortController。 |
| `new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx` | Modify | 不再 mock `ttsTaskPoller`，改 mock `minimaxTTSSync`；Drawer 关闭时 AbortController 取消 fetch。 |
| `new_html/pages/AudioStagePage.tsx` | Modify (注释) | 不改逻辑，在 `runGenerate` 顶部补 1 段注释说明：批量场景必须走 worker（200 条对白 × 5s = 17min 远超 handler 5min 反代边界）。 |
| `docs/faq.md` | Modify | 加 2026-05-25 条目：fast-path 引入的来龙去脉 + 双轨何时用哪个。 |
| `docs/api.md` | Modify | 新增 `POST /api/minimax/tts/sync` 行（路径、入参、返回、上限、何时用）。 |
| `.claude/skills/project-memory/references/recurring-pitfalls.md` | Modify | §R 末尾追加「子陷阱 4：sync 与 async 双轨设计——按文本长度切换」。 |

每次编辑后都要把 root 改动同步到 `deploy/` 镜像（§C）。

---

## Task 1: 后端 Fast-Path Handler

**Files:**
- Modify: `api_routes.py:2253` 后插入新 handler
- Modify: `deploy/api_routes.py:2253` 同步
- Test: `tests/test_api_minimax_tts_sync.py` (Create)

- [ ] **Step 1: 写 failing 测试 — 成功路径**

Create `tests/test_api_minimax_tts_sync.py`:

```python
# -*- coding: utf-8 -*-
"""POST /api/minimax/tts/sync — handler 内同步 fast-path 测试。

2026-05-25：补 worker 异步路径以外的短文本试听快速通道。Plan 文件：
docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def app_with_auth():
    """Build a minimal FastAPI app mounting api_routes + override auth dependency."""
    from fastapi import FastAPI
    import api_routes
    app = FastAPI()
    app.include_router(api_routes.router)
    app.dependency_overrides[api_routes.get_current_user] = lambda: 'test-user'
    return app


def test_sync_tts_success_returns_audio_url(app_with_auth):
    fake_client = MagicMock()
    fake_client.tts_sync = AsyncMock(return_value={
        'audio_url': '/storage/audio/tts_abc.mp3',
        'local_path': '/tmp/persistent_storage/audio/tts_abc.mp3',
        'audio_bytes': b'\xff\xfb\x90\x00fake-mp3',
        'duration_ms': 1234,
        'trace_id': 'mx-trace-1',
        'mime': 'audio/mpeg',
    })
    with patch('api_routes._require_minimax_client', return_value=fake_client), \
         patch('api_routes.save_generated_file_to_db', new=AsyncMock(return_value={
             'file_id': 'fid-1', 'file_url': '/storage/audio/persisted.mp3',
         })):
        client = TestClient(app_with_auth)
        resp = client.post('/api/minimax/tts/sync', json={
            'text': '测试一下',
            'voice_id': 'female-shaonv',
        })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body['success'] is True
    assert body['audio_url'] == '/storage/audio/persisted.mp3'
    assert body['file_id'] == 'fid-1'
    assert body['duration_ms'] == 1234
    assert body['minimax_trace_id'] == 'mx-trace-1'
    fake_client.tts_sync.assert_awaited_once()
```

- [ ] **Step 2: 跑 test 确认 fail**

Run: `pytest tests/test_api_minimax_tts_sync.py::test_sync_tts_success_returns_audio_url -v`
Expected: FAIL with `404 Not Found` (新 endpoint 还没建)

- [ ] **Step 3: 实现 handler — 最小可过 test 版本**

在 `api_routes.py` 的 `minimax_tts` handler 后面（约 line 2253 之后、`minimax_tts_query` 之前）插入：

```python
@router.post("/api/minimax/tts/sync")
async def minimax_tts_sync(
    data: MinimaxTTSRequest,
    user_id: str = Depends(get_current_user),
):
    """同步 MiniMax TTS — 短文本试听 fast-path（绕开 worker / 队列 / 轮询）。

    2026-05-25 引入：原 POST /api/minimax/tts 走 worker 异步，对短文本试听
    场景过重——前端要走「入队 → 轮询 GET /api/task → worker 拉队列 → 调 sync
    → 入库 → 完成 → 前端再 fetch audio_url」5 个环节，任何一环卡死用户都是
    几十秒到分钟级 loading。

    本 endpoint 在 handler 内 await client.tts_sync(...)（典型 1-15s，远低于
    autodl 反代 5min idle timeout），同步入库并直接返回 audio_url + file_id。

    适用场景（必须满足）：
      - text ≤ 1000 字符（MiniMax sync 接口上限 10000，但我们留 buffer 给反代）
      - 单次调用即可，不需要 worker 级 retry / 并发限流

    不适用（去走 POST /api/minimax/tts 走 worker）：
      - 批量生成（一集 200 条对白）
      - text > 1000 字符
      - 需要 worker 的失败重试

    详见 recurring-pitfalls.md §R + §R 子陷阱 4「sync/async 双轨」。
    """
    if not data.text or not data.text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")
    if len(data.text) > 1000:
        raise HTTPException(
            status_code=413,
            detail=(
                f"text 过长 ({len(data.text)} > 1000)，"
                "请改用 POST /api/minimax/tts（走 worker 异步路径，支持长文本）"
            ),
        )

    client = _require_minimax_client()

    kwargs = {
        'text': data.text,
        'voice_id': data.voice_id,
        'model': data.model,
        'speed': data.speed,
        'pitch': data.pitch,
    }
    if data.emotion:
        kwargs['emotion'] = data.emotion

    try:
        result = await client.tts_sync(**kwargs) or {}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"MiniMax TTS sync handler 调用失败: text_len={len(data.text)} err={e}",
            exc_info=True,
        )
        raise HTTPException(status_code=502, detail=f"MiniMax TTS 调用失败: {e}")

    audio_bytes = result.get('audio_bytes')
    if not audio_bytes:
        raise HTTPException(
            status_code=502,
            detail=f"MiniMax 未返回音频字节, trace_id={result.get('trace_id')}",
        )

    saved = await save_generated_file_to_db(
        content=audio_bytes,
        file_type='audio',
        user_id=user_id,
        source='minimax',
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        file_role=data.file_role or 'dialogue_audio',
        original_ext='.mp3',
        episode_id=data.episode_id,
    )
    file_id = saved['file_id']
    file_url = saved['file_url']

    if data.bind_to_character_voice_id:
        try:
            await CharacterVoiceDAO.update_sample_audio_url(
                data.bind_to_character_voice_id, file_url,
            )
        except Exception as e:
            logger.warning(
                f"sync TTS 回写 sample_audio_url 失败（不致命）: "
                f"voice_id={data.bind_to_character_voice_id} err={e}"
            )

    logger.info(
        f"✅ MiniMax TTS sync 完成: voice_id={data.voice_id} "
        f"text_len={len(data.text)} duration_ms={result.get('duration_ms')} "
        f"trace_id={result.get('trace_id')} file_id={file_id}"
    )

    return {
        "success": True,
        "audio_url": file_url,
        "file_id": file_id,
        "file_url": file_url,
        "duration_ms": result.get('duration_ms'),
        "minimax_trace_id": result.get('trace_id'),
    }
```

- [ ] **Step 4: 跑 test 确认成功路径通过**

Run: `pytest tests/test_api_minimax_tts_sync.py::test_sync_tts_success_returns_audio_url -v`
Expected: PASS

- [ ] **Step 5: 加 failing 测试 — text 超长 413**

在 `tests/test_api_minimax_tts_sync.py` 末尾追加：

```python
def test_sync_tts_text_too_long_returns_413(app_with_auth):
    with patch('api_routes._require_minimax_client', return_value=MagicMock()):
        client = TestClient(app_with_auth)
        resp = client.post('/api/minimax/tts/sync', json={
            'text': '啊' * 1001,
            'voice_id': 'female-shaonv',
        })
    assert resp.status_code == 413
    assert '1000' in resp.json()['detail']
    assert '/api/minimax/tts' in resp.json()['detail']  # 提示用户改用异步路径
```

Run: `pytest tests/test_api_minimax_tts_sync.py::test_sync_tts_text_too_long_returns_413 -v`
Expected: PASS（handler 已经实现了 1000 上限）

- [ ] **Step 6: 加 failing 测试 — 空文本 400**

追加：

```python
def test_sync_tts_empty_text_returns_400(app_with_auth):
    with patch('api_routes._require_minimax_client', return_value=MagicMock()):
        client = TestClient(app_with_auth)
        resp = client.post('/api/minimax/tts/sync', json={
            'text': '   ',  # whitespace only
            'voice_id': 'female-shaonv',
        })
    assert resp.status_code == 400
    assert 'text' in resp.json()['detail'].lower()
```

Run: `pytest tests/test_api_minimax_tts_sync.py::test_sync_tts_empty_text_returns_400 -v`
Expected: PASS

- [ ] **Step 7: 加 failing 测试 — MiniMax 返回空音频 502**

追加：

```python
def test_sync_tts_minimax_empty_audio_returns_502(app_with_auth):
    fake_client = MagicMock()
    fake_client.tts_sync = AsyncMock(return_value={
        'audio_url': '/storage/audio/x.mp3',
        'local_path': '/tmp/x.mp3',
        'audio_bytes': b'',   # 空字节
        'trace_id': 'mx-trace-2',
    })
    with patch('api_routes._require_minimax_client', return_value=fake_client):
        client = TestClient(app_with_auth)
        resp = client.post('/api/minimax/tts/sync', json={
            'text': '短文本', 'voice_id': 'female-shaonv',
        })
    assert resp.status_code == 502
    assert 'mx-trace-2' in resp.json()['detail']
```

Run: `pytest tests/test_api_minimax_tts_sync.py::test_sync_tts_minimax_empty_audio_returns_502 -v`
Expected: PASS

- [ ] **Step 8: 加 failing 测试 — bind_to_character_voice_id 触发回写**

追加：

```python
def test_sync_tts_bind_voice_triggers_character_voice_update(app_with_auth):
    fake_client = MagicMock()
    fake_client.tts_sync = AsyncMock(return_value={
        'audio_url': '/storage/audio/x.mp3',
        'local_path': '/tmp/x.mp3',
        'audio_bytes': b'fake-mp3',
        'duration_ms': 800,
        'trace_id': 'mx-trace-3',
    })
    upd = AsyncMock()
    with patch('api_routes._require_minimax_client', return_value=fake_client), \
         patch('api_routes.save_generated_file_to_db', new=AsyncMock(return_value={
             'file_id': 'fid-3', 'file_url': '/storage/audio/persisted-3.mp3',
         })), \
         patch('api_routes.CharacterVoiceDAO.update_sample_audio_url', new=upd):
        client = TestClient(app_with_auth)
        resp = client.post('/api/minimax/tts/sync', json={
            'text': '回写测试', 'voice_id': 'female-shaonv',
            'bind_to_character_voice_id': 'cv-42',
        })
    assert resp.status_code == 200
    upd.assert_awaited_once_with('cv-42', '/storage/audio/persisted-3.mp3')
```

Run: `pytest tests/test_api_minimax_tts_sync.py -v`
Expected: 全部 PASS（4 个 case）

- [ ] **Step 9: 镜像同步到 deploy/api_routes.py**

完全复制 root 新增的 `minimax_tts_sync` handler 到 `deploy/api_routes.py:2253` 之后（位置相同）。Diff 应该完全一样。

Verify: `python -c "import filecmp; print(filecmp.cmp('api_routes.py', 'deploy/api_routes.py', shallow=False))"`
Expected: `True`（或至少新增的 handler 段一致）

- [ ] **Step 10: Commit**

```bash
git add api_routes.py deploy/api_routes.py tests/test_api_minimax_tts_sync.py
git commit -m "feat(tts): add /api/minimax/tts/sync fast-path for short-text preview"
```

---

## Task 2: 前端 apiService

**Files:**
- Modify: `new_html/services/apiService.ts:1010` 左右（紧跟 `minimaxTTS` 函数后）
- Modify: `deploy/new_html/services/apiService.ts` 同步
- Test: `new_html/__tests__/services/minimaxTTSSync.test.ts` (Create)

- [ ] **Step 1: 写 failing 测试 — 成功路径**

Create `new_html/__tests__/services/minimaxTTSSync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { minimaxTTSSync } from '../../services/apiService';

describe('minimaxTTSSync', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('test-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('成功调用，返回 audio_url 与 file_id', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        audio_url: '/storage/audio/x.mp3',
        file_id: 'fid-1',
        file_url: '/storage/audio/x.mp3',
        duration_ms: 1500,
        minimax_trace_id: 'mx-1',
      }),
    });
    const result = await minimaxTTSSync({
      text: '测试',
      voice_id: 'female-shaonv',
    });
    expect(result.success).toBe(true);
    expect(result.audio_url).toBe('/storage/audio/x.mp3');
    expect(result.file_id).toBe('fid-1');
    expect(result.duration_ms).toBe(1500);
    expect((global.fetch as any).mock.calls[0][0]).toMatch(/\/api\/minimax\/tts\/sync$/);
  });

  it('text 过长 413 抛带提示的错误', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ detail: 'text 过长 (1500 > 1000)，请改用 POST /api/minimax/tts' }),
      text: async () => '',
    });
    await expect(
      minimaxTTSSync({ text: 'x'.repeat(1500), voice_id: 'v' }),
    ).rejects.toThrow(/1500.*1000|过长|过大/);
  });

  it('AbortSignal 被触发时 fetch 收到 signal', async () => {
    const ctrl = new AbortController();
    const seenSignal = vi.fn();
    (global.fetch as any).mockImplementation((_url: string, opts: any) => {
      seenSignal(opts.signal);
      return new Promise(() => {}); // never resolve
    });
    minimaxTTSSync({ text: 't', voice_id: 'v' }, ctrl.signal).catch(() => {});
    expect(seenSignal).toHaveBeenCalled();
    expect(seenSignal.mock.calls[0][0]).toBe(ctrl.signal);
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

Run (在 `new_html` 目录):
```bash
cd new_html && npx vitest run __tests__/services/minimaxTTSSync.test.ts
```
Expected: FAIL with `minimaxTTSSync is not exported from apiService`

- [ ] **Step 3: 在 apiService.ts 紧跟 minimaxTTS 函数后新增 minimaxTTSSync**

打开 `new_html/services/apiService.ts`，定位到 `minimaxTTS` 函数末尾（约 line 1020+），紧接着插入：

```typescript
/**
 * Synchronous MiniMax TTS — fast-path for short-text preview (≤1000 chars).
 *
 * 2026-05-25 引入：原 minimaxTTS 走 worker 异步（入队 + 轮询），对试听场景太重。
 * 这个 fast-path 在后端 handler 内同步调 /v1/t2a_v2（典型 1-15s）拿到音频
 * → 入库 → 直接返回 audio_url。试听几乎无感等待。
 *
 * 何时用：
 *   - VoiceSidebar 试听（≤1000 字符的对白片段）
 *   - 单条对白「立即生成并播放」场景
 *
 * 何时不用：
 *   - 批量生成全集（去 minimaxTTS 走 worker 异步）
 *   - text > 1000 字符（后端返回 413，调用方应 fallback 到 minimaxTTS）
 *
 * 详见 docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md
 */
export async function minimaxTTSSync(params: {
    text: string;
    voice_id: string;
    model?: string;
    speed?: number;
    pitch?: number;
    emotion?: string;
    entity_type?: string;
    entity_id?: string;
    file_role?: string;
    episode_id?: string;
    bind_to_character_voice_id?: string;
}, signal?: AbortSignal): Promise<{
    success: true;
    audio_url: string;
    file_id: string;
    file_url: string;
    duration_ms?: number;
    minimax_trace_id?: string;
}> {
    const response = await fetch(`${API_BASE}/api/minimax/tts/sync`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(params),
        signal,
    });
    await handleResponse(response);
    return response.json();
}
```

- [ ] **Step 4: 跑 test 确认全部通过**

Run:
```bash
cd new_html && npx vitest run __tests__/services/minimaxTTSSync.test.ts
```
Expected: PASS（3 个 case）

- [ ] **Step 5: 镜像同步到 deploy/new_html/services/apiService.ts**

把整段 `export async function minimaxTTSSync(...)` 复制到 `deploy/new_html/services/apiService.ts` 中同样的位置（紧跟 `minimaxTTS` 函数后）。

- [ ] **Step 6: Commit**

```bash
git add new_html/services/apiService.ts deploy/new_html/services/apiService.ts new_html/__tests__/services/minimaxTTSSync.test.ts
git commit -m "feat(apiService): add minimaxTTSSync() for short-text preview fast-path"
```

---

## Task 3: VoiceSidebar 试听切到 Fast-Path

**Files:**
- Modify: `new_html/components/audio/VoiceSidebar.tsx`（约 line 340-360 `handlePreview`）
- Modify: `deploy/new_html/components/audio/VoiceSidebar.tsx` 同步
- Modify: `new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx`

- [ ] **Step 1: 改测试 — 不再 mock poller，改 mock minimaxTTSSync**

打开 `new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx`，把顶部的 mock 替换：

```typescript
// 旧：
// vi.mock('../../services/ttsTaskPoller', () => ({
//   pollTtsTaskUntilDone: vi.fn().mockResolvedValue({
//     audio_url: '/storage/audio/preview_x.mp3', file_id: 'fid-99',
//   }),
//   TtsTimeoutError: class extends Error {},
// }));

// 新：
vi.mock('../../services/apiService', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    minimaxTTSSync: vi.fn().mockResolvedValue({
      success: true,
      audio_url: '/storage/audio/preview_x.mp3',
      file_id: 'fid-99',
      file_url: '/storage/audio/preview_x.mp3',
      duration_ms: 1000,
    }),
  };
});
```

然后把 test case 改成 assert `minimaxTTSSync` 被调用，**不**再 assert `pollTtsTaskUntilDone`：

```typescript
it('点击试听后，调 minimaxTTSSync 直接拿 audio_url', async () => {
    const { minimaxTTSSync } = await import('../../services/apiService');
    render(<VoiceDrawer {...baseProps} open />);

    const previewBtn = await screen.findByRole('button', { name: /试听/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(minimaxTTSSync).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.any(String),
          voice_id: expect.any(String),
        }),
        expect.any(AbortSignal),
      );
    });
});

it('Drawer 关闭时 AbortController 必须取消 fetch', async () => {
    const { minimaxTTSSync } = await import('../../services/apiService');
    let abortSignal: AbortSignal | undefined;
    (minimaxTTSSync as any).mockImplementation((_p: any, signal: AbortSignal) => {
      abortSignal = signal;
      return new Promise(() => {}); // never resolve
    });
    const { rerender } = render(<VoiceDrawer {...baseProps} open />);
    const previewBtn = await screen.findByRole('button', { name: /试听/i });
    fireEvent.click(previewBtn);
    await waitFor(() => expect(abortSignal).toBeDefined());

    rerender(<VoiceDrawer {...baseProps} open={false} />);
    await waitFor(() => expect(abortSignal!.aborted).toBe(true));
});
```

- [ ] **Step 2: 跑改后的 test 确认 fail（VoiceSidebar 还在调旧 API）**

Run:
```bash
cd new_html && npx vitest run __tests__/components/VoiceSidebar.handlePreview.test.tsx
```
Expected: FAIL（minimaxTTSSync 没被调用 / pollTtsTaskUntilDone 仍被调用）

- [ ] **Step 3: 改 VoiceSidebar.tsx 的 handlePreview**

打开 `new_html/components/audio/VoiceSidebar.tsx`，找到第 8 行附近 `import { minimaxVoiceDesign, minimaxVoiceClone, minimaxFileUpload, minimaxTTS } from '../../services/apiService';`，**改成**：

```typescript
import {
  minimaxVoiceDesign, minimaxVoiceClone, minimaxFileUpload,
  minimaxTTS,       // 保留：批量场景仍用 worker 异步
  minimaxTTSSync,   // 2026-05-25：试听短文本走同步 fast-path
} from '../../services/apiService';
```

把第 10 行 `import { pollTtsTaskUntilDone, TtsTimeoutError } from '../../services/ttsTaskPoller';` 改为：

```typescript
// 2026-05-25：试听已切到 minimaxTTSSync (同步 fast-path)，本组件不再需要 poller。
// TtsTimeoutError 等其它消费方仍用 ttsTaskPoller（AudioStagePage 单条 / 批量）。
```

然后定位 `handlePreview` 中的核心调用段（约 line 340-360，调 `minimaxTTS` + `pollTtsTaskUntilDone` 的两步骤）：

```typescript
// 旧（两步）：
const submitted = await minimaxTTS({
  ... ,
  bind_to_character_voice_id: existingVoiceId,
}, controller.signal);
const result = await pollTtsTaskUntilDone(submitted.task_id, {
  signal: controller.signal,
  intervalMs: 2000,
});

// 新（一步同步）：
const result = await minimaxTTSSync({
  ... ,  // 完全保留原 minimaxTTS 的入参
  bind_to_character_voice_id: existingVoiceId,
}, controller.signal);
```

**完整替换块**（请按你实际看到的旧代码缩进对齐）：

```typescript
        const result = await minimaxTTSSync({
          text: previewText,
          voice_id: selectedVoiceId,
          model: 'speech-2.8-hd',
          speed: 1.0,
          pitch: 0,
          emotion: selectedEmotion,
          file_role: 'voice_sample',
          bind_to_character_voice_id: existingVoiceId,
        }, controller.signal);
        // result.audio_url 已经是持久化 web URL，可直接给 <audio>
```

错误处理段（catch 块里如果原来有 `TtsTimeoutError` 特判）改成判 `AbortError + fetch network error`：

```typescript
} catch (e: any) {
  if (e?.name === 'AbortError') {
    // 用户关闭 Drawer / 切换语音 / 重复点试听 — 静默
    return;
  }
  // 413 / 502 / 500 — 都从 handleResponse 抛出，包含后端 detail 文本
  message.error(`试听失败: ${e?.message || e}`);
}
```

- [ ] **Step 4: 跑 test 确认通过**

Run:
```bash
cd new_html && npx vitest run __tests__/components/VoiceSidebar.handlePreview.test.tsx
```
Expected: PASS

- [ ] **Step 5: 镜像同步**

把 `new_html/components/audio/VoiceSidebar.tsx` 完全复制到 `deploy/new_html/components/audio/VoiceSidebar.tsx`：

```bash
cp new_html/components/audio/VoiceSidebar.tsx deploy/new_html/components/audio/VoiceSidebar.tsx
```

- [ ] **Step 6: 跑全部前端测试，确认无回归**

Run:
```bash
cd new_html && npx vitest run
```
Expected: 所有 test 通过（其它 page 仍用 worker 异步路径不受影响）

- [ ] **Step 7: Commit**

```bash
git add new_html/components/audio/VoiceSidebar.tsx deploy/new_html/components/audio/VoiceSidebar.tsx new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx
git commit -m "refactor(VoiceSidebar): switch preview to minimaxTTSSync fast-path"
```

---

## Task 4: AudioStagePage 注释「为何不切 fast-path」

**Files:**
- Modify: `new_html/pages/AudioStagePage.tsx`（约 line 200-210，`runGenerate` 入口）
- Modify: `deploy/new_html/pages/AudioStagePage.tsx`

- [ ] **Step 1: 加注释**

在 `runGenerate` 函数最顶部（紧跟函数定义、第一个 `if/return` 之前）插入一段注释：

```typescript
  // 2026-05-25：本函数有意保留 minimaxTTS（worker 异步）路径，不切到 minimaxTTSSync fast-path。
  //
  // 为什么：
  //   - 批量生成（一集 200 条对白）× 每条 5-15s = 17-50 分钟总耗时，handler 同步会撞
  //     autodl 反代 5min idle timeout（即使单条 sync 接口几秒返回，FastAPI worker 线程
  //     池被长时间占住会导致整服务排队）
  //   - 用户切 episode 时旧任务必须能 abort，worker 路径有 task_queue 状态可追溯
  //   - retry 在 MiniMax 偶发 502/限流时很必要，worker 自动重试 3 次
  //   - 失败仍可在「我的任务」面板查到
  //
  // 试听场景见 VoiceSidebar.handlePreview，用 minimaxTTSSync 一次拿结果。
  // 详见 docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md。
```

- [ ] **Step 2: 镜像同步**

```bash
cp new_html/pages/AudioStagePage.tsx deploy/new_html/pages/AudioStagePage.tsx
```

- [ ] **Step 3: Commit**

```bash
git add new_html/pages/AudioStagePage.tsx deploy/new_html/pages/AudioStagePage.tsx
git commit -m "docs(AudioStagePage): explain why batch generation stays on worker path"
```

---

## Task 5: 文档更新（faq + api + recurring-pitfalls）

**Files:**
- Modify: `docs/faq.md`
- Modify: `docs/api.md`
- Modify: `.claude/skills/project-memory/references/recurring-pitfalls.md`
- 镜像：`deploy/docs/faq.md`、`deploy/docs/api.md`

- [ ] **Step 1: 给 docs/faq.md 头部插入新条目**

在 `docs/faq.md` 最顶（最新一条）插入：

```markdown
## 2026-05-25 — MiniMax TTS 试听一直 loading / 任务卡 50 分钟

**症状**
- 配音页点试听 → 前端轮询 `/api/task/<id>` 200 OK 反复，最终 8min 超时
- 后端日志只有 `📤 MiniMax TTS 已入队`，**完全没有** `🎤 MiniMax TTS 任务启动`
- Redis `comfyui:task_queue` 堆积、`comfyui:processing` 空

**根因（按时间排序）**
1. **配置层**：`AGENT_ONLY_MODE=true` 默认让 cluster_main 跳过 Worker 启动，外部 API
   任务（minimax_tts / seedance_* / dashscope 全家）全部死在队列。临时修复：
   `export AGENT_ONLY_MODE=false` 重启后端。架构修复见 follow-up plan。
2. **代码层**：`tts_sync` 返回的 `audio_url` 是 web URL（`/storage/audio/...`），
   但 `worker._process_minimax_tts_task` 把它当磁盘路径 `Path(...).exists()`
   → 永远 `FileNotFoundError` → retry 3 次全失败。修复：`tts_sync` 改成返回
   `audio_url / local_path / audio_bytes` 三字段；worker 用 `audio_bytes` 直接入库。
3. **架构层**：试听场景走「handler 入队 → worker 拉队列 → MiniMax sync → 入库 →
   complete → 前端 fetch」5 个环节，任何一环卡都是几十秒到分钟级 loading。新增
   `POST /api/minimax/tts/sync` fast-path 给 ≤1000 字符的试听用，handler 内
   1-3s 直接拿结果。

**修复文件**
- `minimax_audio.py::tts_sync` — 返回值字段重命名（§F 字段双语义）
- `worker.py::_process_minimax_tts_task` — 用新字段
- `audio_provider.py::MinimaxAudioProvider.generate_speech` — 也切到 tts_sync
- `api_routes.py::minimax_tts_sync` — 新增 fast-path handler
- `new_html/services/apiService.ts::minimaxTTSSync` — 前端 fast-path 客户端
- `new_html/components/audio/VoiceSidebar.tsx::handlePreview` — 切到 fast-path

**预测的下一颗雷**（pre-claim-done §Z 第 10 条）
- AGENT_ONLY_MODE 默认值是个埋雷的部署开关，下次重新部署 / 换环境又会复发。
  follow-up plan：让 cluster_main 在 AGENT_ONLY_MODE=true 时也启动「精简 worker」
  只消费外部 API 任务，ComfyUI 任务仍交给 agent。
- 项目里其它 client（dashscope / seedance / kling / vidu / happyhorse 都用 aiohttp）
  同样没显式 ClientTimeout——批量调用偶发 5min 卡死，等业务方踩到再修。建议主动扫一轮。

**Lesson**
- 「同样症状的 sync 切换 bug」第二次出现就该按 recurring-pitfalls.md §A + §B
  回到 Phase 1 重新枚举所有调用点 —— 这次差点又在「sync vs async」之间反复
  误归因，幸亏用户的邮件「请求ID：401653470724288」给了关键时间戳证据。
```

- [ ] **Step 2: 给 docs/api.md 加新 endpoint 条目**

在 `docs/api.md` 的 MiniMax 部分（搜 `/api/minimax/tts`）下面追加：

```markdown
### POST /api/minimax/tts/sync

**短文本 TTS fast-path** — handler 内同步调 MiniMax `/v1/t2a_v2`，1-3s 拿到音频
URL，绕开 worker / Redis 队列 / 前端轮询。仅适用 ≤1000 字符场景。

**Request**: 与 `POST /api/minimax/tts` 完全相同（`MinimaxTTSRequest`）

**Response** (200 OK):
```json
{
  "success": true,
  "audio_url": "/storage/audio/persisted.mp3",
  "file_id": "fid-...",
  "file_url": "/storage/audio/persisted.mp3",
  "duration_ms": 1234,
  "minimax_trace_id": "mx-..."
}
```

**Errors**:
- `400`: text 空或纯空白
- `413`: text > 1000 字符（提示改用 `POST /api/minimax/tts` 走 worker 异步）
- `500`: MiniMax 配置缺失
- `502`: MiniMax 调用失败 / 返回空音频

**Tables touched**: `files`, `character_voices`（当 `bind_to_character_voice_id` 提供时）

**何时用 sync vs worker**:
| 场景 | endpoint | 理由 |
|------|----------|------|
| VoiceSidebar 试听 | `/api/minimax/tts/sync` | 短文本、要快 |
| 单条对白手动生成 | `/api/minimax/tts/sync` 或 worker（看体验偏好） | <1000 字 sync 体验更直接 |
| 批量生成一集对白 | `/api/minimax/tts`（worker） | 200 条 × 5s = 17min，必须异步 |
| 长文本旁白 / 章节朗读 | `/api/minimax/tts`（worker） | >1000 字符 sync 接口会撞反代 |
```

镜像到 `deploy/docs/api.md`。

- [ ] **Step 3: recurring-pitfalls §R 末尾追加「子陷阱 4」**

打开 `.claude/skills/project-memory/references/recurring-pitfalls.md`，找到 §R 末尾「子陷阱 3」之后，追加：

```markdown
**子陷阱 4：sync / async 双轨设计——按文本长度切换（2026-05-25）**

§R 切到 sync 后，**所有调用都走单条 sync** 不一定是最佳。MiniMax 的 sync 与 async
各有适用场景，理想姿态是双轨：

| 调用形态 | 接口 | 路径 | 适用 |
|---------|------|------|------|
| 短文本试听（≤1000 字） | `/v1/t2a_v2` (sync) | handler 内直接 await | 1-3s 拿到结果，体验直接 |
| 中等单条（≤1000 字，但需 retry） | `/v1/t2a_v2` (sync) | worker 入队 | 享受 retry 容错 |
| 批量生成 / 长文本（>1000 字 / 一集 200 条） | `/v1/t2a_v2` (sync) × N 次，worker 串行 | worker 入队 | 反代 idle 不撞、可观测、可重试 |
| 极长（>10000 字 / 文本文件） | `/v1/t2a_async_v2` (MiniMax 异步) | worker 入队，调 `tts_async + tts_wait_and_download` | 项目里目前不挂载，留作 fallback |

**实现要点**：
- 给前端两个 endpoint：`/api/minimax/tts/sync` (fast-path) + `/api/minimax/tts` (worker)
- 前端按场景选：**试听 = fast-path**，**批量 = worker**
- fast-path handler 强制 text ≤ 1000 字符（避免最坏情况 sync 调用 30s+ 撞反代）
- 错误码：413 → 调用方应 fallback 到 worker endpoint

**预测的反指标自查**：
- 任何新增「外部 API 短调用」endpoint 时问自己：handler 同步够不够快？典型 ≤5s
  且对方限流稳定 → handler 同步胜过 worker（少 4 个失败点）
- handler 内 timeout 一定要显式设 `aiohttp.ClientTimeout(total=N)`，N 选 30-60s
  远低于反代 idle 边界
- 接入新 provider 前用 `curl` 实测一次 sync 接口典型延迟 + 文档 SLA，决定 sync 还是 worker

**反模式（容易再踩）**：
- ❌ 「既然 worker 路径已经写好，就一律走 worker」→ 试听场景延迟体验差且新增链路失败点
- ❌ 「sync 接口就在 handler 里同步等吧不限长度」→ 长文本撞反代
- ✅ 「按典型 payload 长度分流，保留 fallback」
```

- [ ] **Step 4: 跑 sync_check**

```bash
python .claude/skills/project-memory/scripts/scan_project.py .
python .claude/skills/project-memory/scripts/sync_check.py . --strict --levels ERROR
```
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add docs/faq.md docs/api.md deploy/docs/faq.md deploy/docs/api.md .claude/skills/project-memory/references/recurring-pitfalls.md context/
git commit -m "docs(tts): document fast-path + worker double-track design"
```

---

## Task 6: 端到端回归 + Plan 收尾

**Files:** N/A（验证步骤）

- [ ] **Step 1: 后端全量 pytest**

```bash
pytest tests/ -v -k "tts or minimax or audio" 2>&1 | tail -50
```
Expected: 全部 PASS，包括今天新增的 `test_api_minimax_tts_sync.py`、原有 `test_worker_minimax_tts.py`、`test_minimax_tts_sync.py`（如有）、`test_api_minimax_tts_enqueue.py`

- [ ] **Step 2: 前端全量 vitest**

```bash
cd new_html && npx vitest run 2>&1 | tail -30
```
Expected: 全部 PASS，特别确认：
- `__tests__/services/minimaxTTSSync.test.ts` ✅
- `__tests__/services/ttsTaskPoller.test.ts` ✅（无回归）
- `__tests__/components/VoiceSidebar.handlePreview.test.tsx` ✅

- [ ] **Step 3: 部署到 autodl 实测**

```bash
# 在 autodl 服务器：
cd /root/autodl-tmp/MY
git pull
pkill -9 -f "python.*cluster_main"
sleep 3
export AGENT_ONLY_MODE=false  # 仍然依赖配置层修复
nohup python cluster_main.py > /var/log/my2.log 2>&1 &

# 等 5 秒，然后在配音页点试听
sleep 5
tail -f /var/log/my2.log | grep -E "MiniMax TTS sync|tts/sync"
```

Expected: 看到 `✅ MiniMax TTS sync 完成: voice_id=... text_len=... duration_ms=... file_id=...` 出现在 **POST /api/minimax/tts/sync** 之后 1-3 秒内，前端 audio 标签立即可播。

- [ ] **Step 4: pre-claim-done 11 题清单**

跑 `.claude/skills/project-memory/references/recurring-pitfalls.md` §Z 的 11 题清单：
- ✅ impact_check 全部层都改了？sync_check 干净？
- ✅ root + deploy 镜像一致？
- ✅ Schema 改了吗？（没有）
- ✅ faq + recurring-pitfalls 写了 Symptom + Root Cause + Fix + Files + Date + Lesson + 预测下一颗雷？
- ✅ 重启要求写了？（写了：autodl 必须 export AGENT_ONLY_MODE=false 重启）
- ✅ dist 重建？（前端有改动，按惯例 `npm run build` 后 `sync_to_deploy.py --apply`）
- ✅ 没引入 silent catch（bind 回写有 warning + 注释）
- ✅ 多变量 / 多场景覆盖：VoiceSidebar 试听 ✓ + AudioStagePage 批量（保留 worker）✓
- ✅ 预测下一颗雷：AGENT_ONLY_MODE 配置 + 其它 aiohttp client 无 timeout
- ✅ conventions 更新了吗？（recurring-pitfalls §R 子陷阱 4 加了「按 payload 长度选 sync/async」规则）

- [ ] **Step 5: 前端 dist 重建 + 同步**

```bash
cd new_html && npm run build  # 或项目原本的 build 命令
python scripts/sync_to_deploy.py --apply
python scripts/sync_to_deploy.py --check  # 应当 exit 0
```

- [ ] **Step 6: 最终 commit + push**

```bash
git add dist/ deploy/dist/
git commit -m "build: rebuild dist for minimax tts fast-path"
git push origin <your-branch>
```

---

## Out of Scope（Follow-up Plans）

以下问题今天的对话识别出来但**不在本 plan**：

### Follow-up A: AGENT_ONLY_MODE 架构修复

> **2026-05-26 已完成（落地版本与原计划一致）。** 详见 `docs/faq.md` 最顶部条目
> "AGENT_ONLY_MODE 二选一陷阱根治（Follow-up A 落地）"。落地结果：
> - `worker.py`：抽 `EXTERNAL_API_TASK_TYPES_EXACT` + `EXTERNAL_API_TASK_TYPE_PREFIXES` +
>   `is_external_api_task()` helper；`Worker.__init__` 允许 `cluster_manager=None` 进入 lite 模式
>   （`self.is_lite=True`）；`_process_task` 顶部新增守卫：lite Worker 拿到非外部 API 任务时
>   `zrem(processing_queue) → task_queue.enqueue(task) → sleep(3)` 让 agent 取走
> - `cluster_main.py`：`AGENT_ONLY_MODE=true` 分支改为起 `SystemConfig.LITE_WORKERS_COUNT`
>   个 lite Worker（`cluster_manager=None`），不创建任何 ClusterManager；shutdown 不再依赖
>   `not AGENT_ONLY_MODE` 条件
> - `cluster_config.py`：`SystemConfig` 新增 `LITE_WORKERS_COUNT` 环境变量（默认 2）
> - 镜像同步到 `deploy/{worker,cluster_main,cluster_config}.py`（SHA256 三对全等）
> - 部署侧只需 `AGENT_ONLY_MODE=true`（默认）+ 可选 `LITE_WORKERS_COUNT=N` 重启即可，
>   外部 GPU 上的 `comfyui_agent.py` 无需任何改动
>
> **原始计划文本保留在下方供考古**。

**问题**：`AGENT_ONLY_MODE=true` 默认值让 cluster_main 跳过 Worker 启动，外部 API 任务（minimax_tts / seedance_* / kling_* / vidu_* / happyhorse_* / wan26_* / sora2_* / veo_*）全部死队列。临时靠 `export AGENT_ONLY_MODE=false` 兜，但下次重新部署或换环境又复发。

**计划**：改 `cluster_main.py` 在 AGENT_ONLY_MODE=true 时仍启动 N 个「精简 Worker」只消费外部 API 任务，ComfyUI 任务交给 agent。改 `worker._process_task` dispatch 入口加一个 AGENT_ONLY_MODE guard，让 ComfyUI 任务 fall through 给 agent。预计 30-50 行代码 + 2-3 个测试 + 1 个 recurring-pitfalls 新章节。

**优先级**：~~HIGH（重新部署即复发）~~ → **DONE 2026-05-26**

### Follow-up B: Retry 错误分类

**问题**：`FileNotFoundError` / `KeyError` / `TypeError` 这种**代码 bug**也被 `task_queue.fail_task(retry=True)` 重试 3 次。今天的字段双重语义 bug 让 worker 在 30s 内连跑 3 次同样错。

**计划**：在 `task_queue` 或 worker dispatch 加错误分类——`isinstance(e, (FileNotFoundError, KeyError, TypeError, AttributeError, ValueError))` 视为「代码 bug」不重试；只重试 `aiohttp.ClientError` / `asyncio.TimeoutError` / `RuntimeError` 这种暂态错误。预计 20-30 行 + 测试 + recurring-pitfalls 一条。

**优先级**：MEDIUM（不致命，但放大调试噪音）

### Follow-up C: 全项目 aiohttp client timeout 扫雷

**问题**：项目里所有 `aiohttp.ClientSession()` 调用都没显式 `ClientTimeout`（默认 total=5min），偶发外部 API 慢响应会让 worker 假死 5min。今天只修了 `minimax_audio.tts_sync` 一处。

**计划**：grep 出所有 `aiohttp.ClientSession()` 调用点 → 按「是否在 worker / handler 路径上」分类 → worker / handler 路径全加显式 timeout + 1 次重试模板。预计 50-80 行 + 测试。

**优先级**：MEDIUM（隐患在，但要等业务踩到才知道哪个 provider 最先翻车）

---

## Self-Review

**Spec coverage（本 plan 范围内）**：
- ✅ 后端 fast-path endpoint + Pydantic 复用 + 4 个测试 case → Task 1
- ✅ 前端 apiService.minimaxTTSSync + 3 个测试 case → Task 2
- ✅ VoiceSidebar 切换 + 测试 → Task 3
- ✅ AudioStagePage 注释保留 worker 路径 → Task 4
- ✅ faq + api docs + recurring-pitfalls + sync_check → Task 5
- ✅ 端到端回归 + pre-claim-done 11 题 → Task 6

**Placeholder scan**：
- 无 TBD / TODO / "fill in later"
- 每个 step 都给了具体代码 / 命令 / 期望输出
- 镜像同步在每个 Task 末尾都明确写了 `cp` 或 verify 命令

**Type consistency**：
- 后端 `MinimaxTTSRequest` 已存在（api_routes.py:2096），无需新建
- 前端 `minimaxTTSSync` 返回类型 `{ success: true; audio_url: string; file_id: string; file_url: string; duration_ms?: number; minimax_trace_id?: string }` 与后端 handler 返回字段完全一致
- `tts_sync` 新合约（`audio_url / local_path / audio_bytes`）已经在本会话前序步骤改完，本 plan 直接消费 `audio_bytes`
