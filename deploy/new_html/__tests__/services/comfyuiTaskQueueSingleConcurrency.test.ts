import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comfyuiTaskQueue } from '../../services/comfyuiTaskQueue';


beforeEach(() => {
  comfyuiTaskQueue._resetForTesting();
});

describe('ComfyUI browser submission queue', () => {
  it('allows preprocessing and submission to run concurrently', async () => {
    let releaseTasks: (() => void) | undefined;
    const firstStarted = vi.fn();
    const secondStarted = vi.fn();
    const blocker = new Promise<void>((resolve) => { releaseTasks = resolve; });

    const first = comfyuiTaskQueue.enqueue(async () => {
      firstStarted();
      await blocker;
      return 'first';
    }, 'first');
    const second = comfyuiTaskQueue.enqueue(async () => {
      secondStarted();
      await blocker;
      return 'second';
    }, 'second');

    await Promise.resolve();
    expect(firstStarted).toHaveBeenCalledTimes(1);
    expect(secondStarted).toHaveBeenCalledTimes(1);
    expect(comfyuiTaskQueue.getStatus().queueLength).toBe(0);

    releaseTasks?.();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });
});
