import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    confirmProcessingQueue,
    QueueMaintenanceError,
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

    it('blocks local GPU submission with the maintenance reason before submit', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
            queue_mode: 'maintenance',
            runtime_profile: 'wan',
            tasks_ahead: 0,
            estimated_wait_seconds: 0,
            requires_confirmation: false,
            can_cancel_before_submit: true,
            accepting_submissions: false,
            maintenance_message: 'DFS 主网恢复中，本地 GPU 暂停接单。',
            estimated_resume_at: '2026-08-17',
        }), { status: 200, headers: { 'content-type': 'application/json' } }));

        await expect(confirmProcessingQueue({ task_type: 'upscale_hd' })).rejects.toMatchObject({
            name: 'QueueMaintenanceError',
            message: expect.stringContaining('DFS 主网恢复中'),
            estimatedResumeAt: '2026-08-17',
        } satisfies Partial<QueueMaintenanceError>);
    });
});
