import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import ProjectHub from '../../components/ProjectHub';
import { apiJson } from '../../services/httpClient';

vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn(),
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../contexts/WorkspaceContext', () => ({
  useCurrentOrgId: () => null,
  useWorkspace: () => ({ isOrgWorkspace: false, currentName: '个人空间' }),
}));

vi.mock('../../services/shareService', () => ({
  createShare: vi.fn(),
}));

vi.mock('../../admin/crmUI', () => ({
  crmMessage: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  crmConfirm: vi.fn(),
}));

vi.mock('../../components/ShareResourceDialog', () => ({
  default: () => <div data-testid="share-resource-dialog" />,
}));

const projectRows = [
  {
    project_id: 'active-1',
    project_name: '树洞里的星辰',
    description: '未归档项目',
    cover_url: null,
    tags: '[]',
    user_id: 'u1',
    owner_name: 'admin',
    member_count: 1,
    is_archived: false,
    created_at: '2026-07-01T08:00:00Z',
    updated_at: '2026-07-21T08:00:00Z',
    last_accessed_at: null,
    episode_count: 1,
  },
  {
    project_id: 'active-2',
    project_name: '默认项目',
    description: '第二个未归档项目',
    cover_url: null,
    tags: [],
    user_id: 'u1',
    owner_name: 'admin',
    member_count: 1,
    is_archived: false,
    created_at: '2026-07-02T08:00:00Z',
    updated_at: '2026-07-20T08:00:00Z',
    last_accessed_at: null,
    episode_count: 0,
  },
  {
    project_id: 'archived-1',
    project_name: '旧项目归档',
    description: '只应出现在已归档 tab',
    cover_url: null,
    tags: [],
    user_id: 'u1',
    owner_name: 'admin',
    member_count: 1,
    is_archived: true,
    created_at: '2026-06-01T08:00:00Z',
    updated_at: '2026-06-20T08:00:00Z',
    last_accessed_at: null,
    episode_count: 2,
  },
];

describe('ProjectHub navigation and filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('username', '159****7184');
    (apiJson as any).mockImplementation(async (url: string) => {
      if (url.startsWith('/api/projects?')) {
        return { success: true, projects: projectRows };
      }
      return { success: true };
    });
  });

  it('keeps stable tab counts while switching between active and archived projects', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiJson).toHaveBeenCalledWith(
        expect.stringContaining('include_archived=true'),
        {},
        '项目列表',
      );
    });

    expect(await screen.findByText('树洞里的星辰')).toBeInTheDocument();
    expect(screen.getByText('默认项目')).toBeInTheDocument();
    expect(screen.queryByText('旧项目归档')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部项目\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已归档\s*1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /已归档\s*1/ }));

    expect(screen.getByText('旧项目归档')).toBeInTheDocument();
    expect(screen.queryByText('树洞里的星辰')).not.toBeInTheDocument();
    expect(screen.queryByText('默认项目')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部项目\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已归档\s*1/ })).toBeInTheDocument();
  });

  it('opens the account dropdown with a personal center entry', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByRole('button', { name: /159\*\*\*\*7184/ }));

    expect(screen.getByRole('menuitem', { name: /个人中心/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /退出登录/ })).toBeInTheDocument();
  });
});
