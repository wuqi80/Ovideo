import { apiFetch } from './httpClient';

async function throwTaskControlError(response: Response, fallback: string): Promise<never> {
    const error = await response.json().catch(() => ({ detail: fallback }));
    const detail = error?.detail ?? error?.message;
    throw new Error(typeof detail === 'string' && detail ? detail : fallback);
}

export async function cancelTask(taskId: string): Promise<void> {
    const response = await apiFetch(`/api/task/${taskId}`, {
        method: 'DELETE',
    }, { apiName: 'cancelTask' });

    if (!response.ok) {
        await throwTaskControlError(response, '取消失败');
    }
}

export async function deleteTask(taskId: string): Promise<void> {
    const response = await apiFetch(`/api/task/${taskId}/delete`, {
        method: 'DELETE',
    }, { apiName: 'deleteTask' });

    if (!response.ok) {
        await throwTaskControlError(response, '删除失败');
    }
}
