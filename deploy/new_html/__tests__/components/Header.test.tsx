import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AppView, AiModel } from '../../types';

vi.mock('../../services/creditService', () => ({
  getCreditBalance: vi.fn(),
}));
vi.mock('../../services/httpClient', () => ({
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../components/NotificationPanel', () => ({
  NotificationPanel: () => <div data-testid="notification-panel" />,
}));
vi.mock('../../components/WorkspaceSwitcher', () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

import { getCreditBalance } from '../../services/creditService';
import { Header } from '../../components/Header';

const baseProps = {
  visibleColumns: [true, true, true],
  onToggleColumn: vi.fn(),
  onGlobalBatchProcess: vi.fn(),
  isProcessing: false,
  fileCount: 0,
  currentView: AppView.Editor,
  onChangeView: vi.fn(),
  onChangeModel: vi.fn(),
};

describe('Header model display and credit balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('username', 'tester');
    (getCreditBalance as any).mockResolvedValue({ available_credits: 1280 });
  });

  it('shows business name with the actual runtime model name', () => {
    render(<Header {...baseProps} aiModel={AiModel.Gemini} />);
    expect(screen.getByText('化神 · gemini-2.5-flash')).toBeTruthy();

    render(<Header {...baseProps} aiModel={AiModel.DeepseekChat} />);
    expect(screen.getByText('金丹 · deepseek-v4-flash')).toBeTruthy();

    render(<Header {...baseProps} aiModel={AiModel.Deepseek} />);
    expect(screen.getByText('筑基 · deepseek-v4-pro')).toBeTruthy();
  });

  it('uses backend-resolved model metadata when supplied', () => {
    render(
      <Header
        {...baseProps}
        aiModel={AiModel.DeepseekChat}
        modelOptions={[{
          value: AiModel.DeepseekChat,
          label: '金丹',
          operation: 'deepseek-chat',
          requestedProvider: 'deepseek',
          provider: 'deepseek',
          runtime: 'deepseek-v4-flash-admin',
          failoverActive: false,
        }]}
      />,
    );
    expect(screen.getByText('金丹 · deepseek-v4-flash-admin')).toBeTruthy();
  });

  it('loads and renders the available credit balance', async () => {
    render(<Header {...baseProps} aiModel={AiModel.Gemini} />);

    await waitFor(() => {
      expect(screen.getByTestId('header-credit-balance').textContent).toContain('1,280');
    });
    expect(getCreditBalance).toHaveBeenCalled();
  });

  it('refreshes the balance on credits:updated events', async () => {
    (getCreditBalance as any).mockResolvedValue({ available_credits: 500 });
    render(<Header {...baseProps} aiModel={AiModel.Gemini} />);
    await waitFor(() => {
      expect(screen.getByTestId('header-credit-balance').textContent).toContain('500');
    });

    window.dispatchEvent(new CustomEvent('credits:updated', { detail: { balance: 480 } }));
    await waitFor(() => {
      expect(screen.getByTestId('header-credit-balance').textContent).toContain('480');
    });
  });

  it('shows a placeholder when the balance request fails', async () => {
    (getCreditBalance as any).mockRejectedValue(new Error('offline'));
    render(<Header {...baseProps} aiModel={AiModel.Gemini} />);

    await waitFor(() => {
      expect(screen.getByTestId('header-credit-balance').textContent).toContain('--');
    });
  });
});
