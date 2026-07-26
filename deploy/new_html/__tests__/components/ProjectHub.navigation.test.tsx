import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import ProjectHub from '../../components/ProjectHub';
import { apiJson } from '../../services/httpClient';
import { uploadEntityFile } from '../../services/entityFileService';
import {
  addProjectMember,
  getProjectMembers,
  updateProject,
} from '../../services/projectWorkflowService';

vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn(),
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
  secureApiUrl: vi.fn((url: string) => `${url}?token=token-cover`),
}));

vi.mock('../../contexts/WorkspaceContext', () => ({
  useCurrentOrgId: () => null,
  useWorkspace: () => ({ isOrgWorkspace: false, currentName: '个人空间' }),
}));

vi.mock('../../services/shareService', () => ({
  createShare: vi.fn(),
}));

vi.mock('../../services/entityFileService', () => ({
  uploadEntityFile: vi.fn(),
}));

vi.mock('../../services/projectWorkflowService', () => ({
  updateProject: vi.fn(),
  getProjectMembers: vi.fn(),
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  updateProjectMember: vi.fn(),
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
    localStorage.setItem('auth_token', 'token-cover');
    (apiJson as any).mockImplementation(async (url: string) => {
      if (url.startsWith('/api/projects?')) {
        return { success: true, projects: projectRows };
      }
      return { success: true };
    });
    (uploadEntityFile as any).mockResolvedValue({
      fileId: 'file_cover',
      fileUrl: '/api/files/file_cover/download',
    });
    (updateProject as any).mockResolvedValue({ success: true });
    (getProjectMembers as any).mockResolvedValue({
      success: true,
      members: [
        { user_id: 'owner', username: 'admin', role: 'owner', responsibility: 'all' },
        { user_id: 'user_2', username: 'alice', role: 'member', responsibility: 'art' },
      ],
    });
    (addProjectMember as any).mockResolvedValue({
      success: true,
      member: { user_id: 'user_3', username: 'bob', role: 'member', responsibility: 'all' },
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

  it('uploads a project cover from the card menu and renders it with crop styling', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByLabelText('树洞里的星辰 更多操作'));
    fireEvent.click(screen.getByText('上传封面'));

    const file = new File(['cover-bytes'], 'cover.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('选择项目封面图片'), { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadEntityFile).toHaveBeenCalledWith(file, 'project', 'active-1', 'cover');
      expect(updateProject).toHaveBeenCalledWith('active-1', {
        cover_url: '/api/files/file_cover/download',
      });
    });
    const cover = await screen.findByAltText('树洞里的星辰 封面');
    expect(cover).toHaveClass('object-cover');
    expect(cover.getAttribute('src')).toContain('/api/files/file_cover/download?token=token-cover');
  });

  it('edits project metadata and adds members from the card menu', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByLabelText('树洞里的星辰 更多操作'));
    fireEvent.click(screen.getByText('编辑项目'));

    await waitFor(() => expect(getProjectMembers).toHaveBeenCalledWith('active-1'));
    expect(screen.getAllByText('admin').some(node => node.tagName.toLowerCase() === 'div')).toBe(true);
    expect(screen.getAllByText('alice').some(node => node.tagName.toLowerCase() === 'div')).toBe(true);

    fireEvent.change(screen.getByDisplayValue('树洞里的星辰'), {
      target: { value: '树洞里的星辰 · 新封面版' },
    });
    fireEvent.change(screen.getByDisplayValue('未归档项目'), {
      target: { value: '更新后的项目描述' },
    });
    fireEvent.click(screen.getByText('保存信息'));

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith('active-1', {
        project_name: '树洞里的星辰 · 新封面版',
        description: '更新后的项目描述',
      });
    });

    fireEvent.change(screen.getByPlaceholderText('例如 admin 或 user_xxx'), {
      target: { value: 'bob' },
    });
    fireEvent.click(screen.getByText('添加'));

    await waitFor(() => {
      expect(addProjectMember).toHaveBeenCalledWith('active-1', 'bob', 'member', 'all');
    });
  });
});
