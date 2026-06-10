/**
 * TTS Task Poller — 把 `POST /api/minimax/tts` 返回的 task_id 轮询到完成。
 *
 * 2026-05-24 引入：MiniMax TTS 改为 worker 异步任务后，前端用这个薄轮询器统一接管。
 * 不引入到 globalTaskManager / videoTaskPoller — 这俩绑定了视频卡片 UI，TTS 不需要。
 *
 * 设计：
 *   - intervalMs 默认 2000，timeoutMs 默认 480000（8 分钟兜底，超过就放弃）
 *   - 支持 AbortSignal —— Drawer 关闭 / 用户取消时立刻终止
 *   - status === 'completed' 时取 result 字段（audio_url, file_id, duration_ms）
 *   - status === 'failed' 抛 result.error 文本
 *   - 默认 getStatus 是 videoService.getTaskStatus；测试时可注入
 */
import { getTaskStatus as defaultGetStatus } from './videoService';

export interface TtsResult {
  audio_url: string;
  file_id?: string;
  duration_ms?: number;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  getStatus?: (taskId: string) => Promise<{
    status: string;
    progress?: number;
    result?: any;
  }>;
}

export class TtsTimeoutError extends Error {
  constructor(public taskId: string, public elapsedMs: number) {
    super(`TTS 轮询超时: task_id=${taskId} elapsed=${Math.round(elapsedMs / 1000)}s`);
    this.name = 'TtsTimeoutError';
  }
}

export async function pollTtsTaskUntilDone(
  taskId: string,
  opts: PollOptions = {},
): Promise<TtsResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 8 * 60 * 1000;
  const signal = opts.signal;
  const getStatus = opts.getStatus ?? (defaultGetStatus as any);
  const start = Date.now();

  while (true) {
    if (signal?.aborted) throw new DOMException('TTS poll aborted', 'AbortError');
    if (Date.now() - start > timeoutMs) throw new TtsTimeoutError(taskId, Date.now() - start);

    let s: any;
    try {
      s = await getStatus(taskId);
    } catch (e: any) {
      // 404 / 网络瞬断：等一拍再试，不立刻 fail（最多 timeoutMs 内）
      if (signal?.aborted) throw new DOMException('TTS poll aborted', 'AbortError');
      await sleep(intervalMs, signal);
      continue;
    }

    const status = s?.status;
    if (status === 'completed') {
      const result = s.result || {};
      return {
        audio_url: result.audio_url || result.file_url || '',
        file_id: result.file_id,
        duration_ms: result.duration_ms,
      };
    }
    if (status === 'failed') {
      throw new Error(s?.result?.error || 'TTS 任务失败');
    }
    await sleep(intervalMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('TTS poll aborted', 'AbortError'));
      }, { once: true });
    }
  });
}
