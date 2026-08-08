import { apiJson } from './httpClient';

export type ProcessingQueuePreflight = {
    queue_mode: 'gpu2_serial' | 'external';
    runtime_profile?: 'wan' | 'h3' | null;
    public_comfyui_port?: number;
    tasks_ahead: number;
    estimated_wait_seconds: number;
    requires_confirmation: boolean;
    can_cancel_before_submit: boolean;
};

export class QueueSubmissionCancelledError extends Error {
    constructor() {
        super('Submission cancelled by user');
        this.name = 'QueueSubmissionCancelledError';
    }
}

export async function confirmProcessingQueue(payload: Record<string, any>): Promise<ProcessingQueuePreflight> {
    const preflight = await apiJson<ProcessingQueuePreflight>('/api/generate/preflight', {
        method: 'POST',
        body: JSON.stringify(payload),
    }, 'processingQueuePreflight');
    if (!preflight.requires_confirmation || typeof window === 'undefined') return preflight;

    const minutes = Math.max(1, Math.ceil(preflight.estimated_wait_seconds / 60));
    const accepted = window.confirm(
        `\u5f53\u524d\u524d\u9762\u8fd8\u6709 ${preflight.tasks_ahead} \u4e2a\u4efb\u52a1\uff0c\u9884\u8ba1\u7b49\u5f85\u7ea6 ${minutes} \u5206\u949f\u3002\n\n\u662f\u5426\u7ee7\u7eed\u63d0\u4ea4\uff1f`,
    );
    if (!accepted) throw new QueueSubmissionCancelledError();
    return preflight;
}
