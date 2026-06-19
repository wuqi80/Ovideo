import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { GlobalToast } from '../../components/GlobalToast';
import { AppView, type TaskNotification } from '../../types';

const mocks = vi.hoisted(() => ({
  notifications: [] as any[],
  dismissNotification: vi.fn(),
}));

vi.mock('../../contexts/TaskContext', () => ({
  useTaskManager: () => ({
    notifications: mocks.notifications,
    dismissNotification: mocks.dismissNotification,
  }),
}));

function failedNotification(id: string, message: string): TaskNotification {
  return {
    id,
    type: 'video',
    status: 'failed',
    message,
    targetView: AppView.Video,
    targetProjectId: 'proj_1',
    timestamp: Date.now(),
    taskId: id,
  };
}

describe('GlobalToast failure burst handling', () => {
  beforeEach(() => {
    mocks.notifications = [];
    mocks.dismissNotification.mockClear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  it('folds failed notification bursts after two individual toasts', async () => {
    mocks.notifications = [
      failedNotification('fail_1', 'shot 1 failed'),
      failedNotification('fail_2', 'shot 2 failed'),
      failedNotification('fail_3', 'shot 3 failed'),
      failedNotification('fail_4', 'shot 4 failed'),
    ];

    render(<GlobalToast />);

    expect(await screen.findByText('shot 1 failed')).toBeInTheDocument();
    expect(screen.getByText('shot 2 failed')).toBeInTheDocument();
    expect(screen.getByText('4 个生成任务失败，已折叠显示，请在通知面板查看详情')).toBeInTheDocument();
    expect(screen.queryByText('shot 3 failed')).not.toBeInTheDocument();
    expect(screen.queryByText('shot 4 failed')).not.toBeInTheDocument();
  });
});
