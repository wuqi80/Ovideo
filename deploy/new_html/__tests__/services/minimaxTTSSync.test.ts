// new_html/__tests__/services/minimaxTTSSync.test.ts
//
// 2026-05-25：MiniMax TTS 短文本试听 fast-path 客户端单测。
// 守住三件事：
//   1) 成功路径：POST /api/minimax/tts/sync，把后端返回的 audio_url / file_id 透传上层
//   2) text 过长 413：handleResponse 抛带 detail 的 Error，调用方应能 fallback 到 worker
//   3) AbortSignal：组件 unmount / 切换语音时能取消请求
//
// Plan: docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md (Task 2)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { minimaxTTSSync } from '../../services/apiService';

function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('minimaxTTSSync', () => {
  beforeEach(() => {
    // localStorage 必须先有 token，handleResponse 401 分支才不会 redirect
    const store: Record<string, string> = { auth_token: 'test-token' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    } as Storage);
    // 默认 fetch mock —— 每个 test 自己 .mockResolvedValue / .mockImplementation
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('成功调用，返回 audio_url 与 file_id', async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({
      success: true,
      audio_url: '/storage/audio/x.mp3',
      file_id: 'fid-1',
      file_url: '/storage/audio/x.mp3',
      duration_ms: 1500,
      minimax_trace_id: 'mx-1',
    }));
    const result = await minimaxTTSSync({
      text: '测试',
      voice_id: 'female-shaonv',
    });
    expect(result.success).toBe(true);
    expect(result.audio_url).toBe('/storage/audio/x.mp3');
    expect(result.file_id).toBe('fid-1');
    expect(result.duration_ms).toBe(1500);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toMatch(/\/api\/minimax\/tts\/sync$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.text).toBe('测试');
    expect(body.voice_id).toBe('female-shaonv');
  });

  it('text 过长 413 抛带提示的错误（让调用方 fallback 到 worker）', async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse(
      { detail: 'text 过长 (1500 > 1000)，请改用 POST /api/minimax/tts（走 worker 异步路径，支持长文本）' },
      413,
    ));
    await expect(
      minimaxTTSSync({ text: 'x'.repeat(1500), voice_id: 'v' }),
    ).rejects.toThrow(/1500.*1000|过长|过大|/);
  });

  it('AbortSignal 被透传给 fetch（让组件 unmount 时能取消）', async () => {
    const ctrl = new AbortController();
    const seenSignal = vi.fn();
    (globalThis.fetch as any).mockImplementation((_url: string, opts: any) => {
      seenSignal(opts?.signal);
      return new Promise(() => {}); // never resolve
    });
    // 故意不 await，触发 fetch 后立即断言（minimaxTTSSync 是 async，到第一个 await 之前
    // 是同步执行的，fetch 会立即被调用一次，所以 mockImplementation 同步跑完 seenSignal）
    minimaxTTSSync({ text: 't', voice_id: 'v' }, ctrl.signal).catch(() => {});
    expect(seenSignal).toHaveBeenCalled();
    expect(seenSignal.mock.calls[0][0]).toBe(ctrl.signal);
  });
});
