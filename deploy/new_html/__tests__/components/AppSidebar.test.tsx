import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppSidebar from '../../components/AppSidebar';
import { apiJson } from '../../services/httpClient';
import { getCreditBalance } from '../../services/creditService';

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

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};

describe('AppSidebar public tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCreditBalance as any).mockResolvedValue({ available_credits: 100 });
    (apiJson as any).mockResolvedValue({ success: true, projects: [] });
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
    expect(screen.getByRole('button', { name: '版本记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图片高清放大' })).toBeInTheDocument();
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
});
