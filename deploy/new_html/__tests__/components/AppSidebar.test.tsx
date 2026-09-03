import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppSidebar, { APP_SIDEBAR_COLLAPSED_STORAGE_KEY } from '../../components/AppSidebar';
import { apiJson } from '../../services/httpClient';
import { getCreditBalance } from '../../services/creditService';
import { getCurrentAdminSession } from '../../services/adminAccessService';
import { adminPath } from '../../admin/adminRoute';

vi.mock('../../services/httpClient', () => ({
  apiFetch: vi.fn(),
  apiJson: vi.fn(),
}));

vi.mock('../../services/creditService', () => ({
  getCreditBalance: vi.fn(),
}));

vi.mock('../../services/accountStorage', () => ({
  clearAccountIdentity: vi.fn(),
  getStoredUsername: vi.fn(() => '普通用户'),
}));

vi.mock('../../services/adminAccessService', () => ({
  getCurrentAdminSession: vi.fn(),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};

describe('AppSidebar public tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    (getCreditBalance as any).mockResolvedValue({ available_credits: 100 });
    (apiJson as any).mockResolvedValue({ success: true, projects: [] });
    (getCurrentAdminSession as any).mockResolvedValue(null);
  });

  it('shows the management entry only after the signed-in account passes the admin role check', async () => {
    (getCurrentAdminSession as any).mockResolvedValue({
      user_id: 'admin_1',
      username: 'admin',
      role: 'admin',
    });
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /普通用户/ }));
    const adminEntry = await screen.findByRole('menuitem', { name: '管理后台' });
    expect(adminEntry).toHaveAttribute('href', adminPath());
    expect(adminEntry).toHaveAttribute('target', '_blank');
    expect(adminEntry).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('管理员')).toBeInTheDocument();
  });

  it('shows every more-feature entry when a page does not provide scoped tools', async () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText('更多功能')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专业画布' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的素材' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成历史' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回收站' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图片高清放大' })).toBeInTheDocument();
    expect(
      screen.getByText('图片高清放大').compareDocumentPosition(screen.getByText('生成历史'))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText('生成历史').compareDocumentPosition(screen.getByText('回收站'))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/projects', {}, '最近项目'));
  });

  it('opens image upscale from the most recent project and episode', async () => {
    (apiJson as any)
      .mockResolvedValueOnce({ success: true, projects: [{ project_id: 'proj_1', project_name: '测试项目' }] })
      .mockResolvedValueOnce({ success: true, episodes: [{ episode_id: 'ep_1' }] });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppSidebar />
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByText('测试项目');
    fireEvent.click(screen.getByRole('button', { name: '图片高清放大' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/projects/proj_1/ep/ep_1/workflow/image-upscale');
    });
    expect(apiJson).toHaveBeenCalledWith('/api/projects/proj_1/episodes', {}, '最近分集');
  });

  it('opens my assets inside the episode workflow shell', async () => {
    (apiJson as any)
      .mockResolvedValueOnce({ success: true, projects: [{ project_id: 'proj_1', project_name: '测试项目' }] })
      .mockResolvedValueOnce({ success: true, episodes: [{ episode_id: 'ep_1' }] });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppSidebar />
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByText('测试项目');
    fireEvent.click(screen.getByRole('button', { name: '我的素材' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/projects/proj_1/ep/ep_1/workflow/media-library');
    });
  });

  it('collapses to an icon rail, stays navigable, and remembers the preference', async () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    const sidebar = screen.getByTestId('app-sidebar');
    const collapseButton = screen.getByRole('button', { name: '收起左侧导航' });
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    expect(sidebar).toHaveClass('z-50', 'overflow-visible');
    expect(collapseButton).toHaveClass('z-[60]');
    fireEvent.click(collapseButton);

    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: '展开左侧导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专业画布' })).toBeInTheDocument();
    expect(screen.queryByText('更多功能')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true');
    });
  });

  it('opens the standalone recycle bin from the most recent project and episode', async () => {
    (apiJson as any)
      .mockResolvedValueOnce({ success: true, projects: [{ project_id: 'proj_1', project_name: '测试项目' }] })
      .mockResolvedValueOnce({ success: true, episodes: [{ episode_id: 'ep_1' }] });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppSidebar />
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByText('测试项目');
    fireEvent.click(screen.getByRole('button', { name: '回收站' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/projects/proj_1/ep/ep_1/workflow/recycle-bin');
    });
  });
});
