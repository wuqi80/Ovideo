import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalTaskManager } from '../../services/globalTaskManager';
import { getActiveTasks, getTaskNotifications } from '../../services/taskNotificationService';

vi.mock('../../services/taskNotificationService', () => ({
  getActiveTasks: vi.fn(),
  getTaskNotifications: vi.fn(),
}));

const mockGetActiveTasks = vi.mocked(getActiveTasks);
const mockGetTaskNotifications = vi.mocked(getTaskNotifications);

function terminalTask(taskId: string, status: 'completed' | 'failed' = 'failed') {
  return {
    task_id: taskId,
    task_type: 'seedance_i2v',
    status,
    project_id: 'proj_1',
    category: 'video',
    source_page: 'generation',
    source_item_id: 'shot_1',
    display_name: 'Seedance shot generation',
    completed_at: new Date().toISOString(),
    entity_type: '',
    entity_id: '',
    file_role: '',
    episode_id: 'ep_1',
  };
}

describe('GlobalTaskManager notification polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveTasks.mockResolvedValue({ success: true, tasks: [] });
  });

  it('uses a notification baseline on first poll and does not toast historical failures', async () => {
    mockGetTaskNotifications.mockResolvedValueOnce({
      success: true,
      notifications: [terminalTask('old_failed_task', 'failed')],
    });

    const manager = new GlobalTaskManager();
    const events: string[] = [];
    manager.addEventListener((type) => events.push(type));

    await (manager as any).poll();

    expect(mockGetTaskNotifications).toHaveBeenCalledWith(expect.any(Number));
    expect(events).not.toContain('notification');
  });

  it('emits only new notification ids after the baseline poll', async () => {
    mockGetTaskNotifications
      .mockResolvedValueOnce({ success: true, notifications: [terminalTask('baseline_failed', 'failed')] })
      .mockResolvedValueOnce({ success: true, notifications: [terminalTask('new_failed', 'failed')] })
      .mockResolvedValueOnce({ success: true, notifications: [terminalTask('new_failed', 'failed')] });

    const manager = new GlobalTaskManager();
    const notifications: string[] = [];
    manager.addEventListener((type, data) => {
      if (type === 'notification' && data.notification?.id) {
        notifications.push(data.notification.id);
      }
    });

    await (manager as any).poll();
    await (manager as any).poll();
    await (manager as any).poll();

    expect(notifications).toEqual(['new_failed']);
  });

  it('preserves unknown progress and normalizes backend percentages', async () => {
    mockGetActiveTasks.mockResolvedValueOnce({
      success: true,
      tasks: [
        {
          task_id: 'known_progress',
          task_type: 'seedance_i2v',
          status: 'processing',
          progress: 42,
          created_at: new Date().toISOString(),
        },
        {
          task_id: 'unknown_progress',
          task_type: 'seedance_i2v',
          status: 'processing',
          progress: null,
          created_at: new Date().toISOString(),
        },
      ],
    });
    mockGetTaskNotifications.mockResolvedValueOnce({ success: true, notifications: [] });

    const manager = new GlobalTaskManager();
    const snapshots: any[][] = [];
    manager.addEventListener((type, data) => {
      if (type === 'tasks_updated' && data.tasks) snapshots.push(data.tasks);
    });

    await (manager as any).poll();

    expect(snapshots[0][0].progress).toBe(0.42);
    expect(snapshots[0][1].progress).toBeUndefined();
  });
});
