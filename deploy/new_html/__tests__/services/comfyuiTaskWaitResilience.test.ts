import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const apiJson = vi.fn();

vi.mock('../../services/httpClient', () => ({
  apiJson: (...args: any[]) => apiJson(...args),
}));
vi.mock('../../services/comfyuiTaskQueue', () => ({
  getComfyUIQueueStatus: vi.fn(),
}));
vi.mock('../../services/taskRegistry', () => ({
  taskRegistry: {
    register: vi.fn(),
    update: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  },
}));

import { normalizeComfyUITaskError, waitForComfyUITask } from '../../services/comfyuiTaskWaitService';

describe('waitForComfyUITask 轮询韧性', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiJson.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('容忍少量连续瞬时错误后仍能正常完成', async () => {
    // 前 3 次轮询抛瞬时错误（网络抖动），第 4 次返回 completed。
    apiJson
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockResolvedValueOnce({ status: 'completed', progress: 1, result: { images: [{ url: '/storage/x.png' }] } });

    const promise = waitForComfyUITask('task-resilient');
    const assertion = expect(promise).resolves.toBe('/storage/x.png');
    await vi.advanceTimersByTimeAsync(8000 + 50);
    await assertion;
    expect(apiJson).toHaveBeenCalledTimes(4);
  });

  it('连续错误达到上限才判定失败', async () => {
    apiJson.mockRejectedValue(new Error('persistent 502'));

    const promise = waitForComfyUITask('task-down');
    const assertion = expect(promise).rejects.toThrow(/persistent 502/);
    // 5 次连续错误 × 2s = 10s 才放弃。
    await vi.advanceTimersByTimeAsync(10000 + 50);
    await assertion;
    expect(apiJson).toHaveBeenCalledTimes(5);
  });
});

describe('normalizeComfyUITaskError', () => {
  it('hides local ComfyUI prompt URLs from user-facing errors', () => {
    const message = normalizeComfyUITaskError(
      '400 Client Error: Bad Request for url: http://127.0.0.1:8188/prompt',
    );

    expect(message).toContain('本地 ComfyUI');
    expect(message).toContain('HTTP 400');
    expect(message).not.toContain('127.0.0.1:8188');
  });

  it('uses task context for ComfyUI prompt validation errors', () => {
    const message = normalizeComfyUITaskError(
      'task_type=upscale_hd workflow=upscale_hd ComfyUI /prompt failed: HTTP 400 missing SeedVR2',
      { title: '高清放大 · abc123', kind: 'video-upscale' },
    );

    expect(message).toContain('高清放大工作流');
    expect(message).toContain('SeedVR2');
    expect(message).not.toContain('角度调整工作流');
  });
});
