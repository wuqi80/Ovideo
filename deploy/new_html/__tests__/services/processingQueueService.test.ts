import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    confirmProcessingQueue,
    QueueSubmissionCancelledError,
} from '../../services/processingQueueService';

describe('processing queue preflight', () => {
    beforeEach(() => {
        localStorage.setItem('auth_token', 'test-token');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('lets the user cancel before a queued GPU2 task is submitted', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
            queue_mode: 'gpu2_serial',
            runtime_profile: 'h3',
            public_comfyui_port: 8188,
            tasks_ahead: 2,
            estimated_wait_seconds: 1800,
            requires_confirmation: true,
            can_cancel_before_submit: true,
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

        await expect(confirmProcessingQueue({ task_type: 'i2v', model: 'MiniMaxH3' }))
            .rejects.toBeInstanceOf(QueueSubmissionCancelledError);

        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('2'));
        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('30'));
    });
});
