import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryPage } from '../../components/HistoryPage';
import { fetchDeletedUserFiles, fetchUserFiles, hardDeleteEntityFile } from '../../services/entityFileService';
import { apiJson } from '../../services/httpClient';

vi.mock('../../services/entityFileService', () => ({
  fetchDeletedUserFiles: vi.fn(),
  fetchUserFiles: vi.fn(),
  deleteEntityFile: vi.fn(),
  restoreEntityFile: vi.fn(),
  hardDeleteEntityFile: vi.fn(),
  hardDeleteEntityFiles: vi.fn(),
}));

vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn().mockResolvedValue({ tasks: [] }),
  secureApiUrl: vi.fn((url: string) => url),
}));

describe('HistoryPage fixed views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchUserFiles as any).mockResolvedValue({ items: [], total: 0 });
    (fetchDeletedUserFiles as any).mockResolvedValue({ items: [], total: 0 });
    (apiJson as any).mockResolvedValue({ tasks: [] });
  });

  afterEach(() => cleanup());

  it('shows generation history without an in-page recycle switch', async () => {
    render(<HistoryPage />);

    await waitFor(() => expect(fetchUserFiles).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: '生成历史' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回收站' })).not.toBeInTheDocument();
  });

  it('loads deleted files in the standalone recycle view', async () => {
    render(<HistoryPage view="recycle" />);

    await waitFor(() => expect(fetchDeletedUserFiles).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: '回收站' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成历史' })).not.toBeInTheDocument();
  });

  it('shows an owned recycle thumbnail and only offers confirmed permanent deletion', async () => {
    (fetchDeletedUserFiles as any).mockResolvedValue({
      items: [{
        fileId: 'file_deleted',
        fileUrl: '/api/files/file_deleted/download',
        fileType: 'image',
        fileRole: 'generated_image',
        isSelected: false,
        isDeleted: true,
        createdAt: '2026-09-03T03:24:00Z',
        metadata: {},
      }],
      total: 1,
    });
    (hardDeleteEntityFile as any).mockResolvedValue({ freed_bytes: 1024 });

    render(<HistoryPage view="recycle" />);

    const thumbnail = await screen.findByRole('img', { name: '回收站图片缩略图' });
    expect(thumbnail).toHaveAttribute(
      'src',
      '/api/entity-files/file_deleted/recycle-thumbnail',
    );
    expect(screen.queryByRole('button', { name: /恢复/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    expect(screen.getByRole('heading', { name: '确认永久删除' })).toBeInTheDocument();
    expect(screen.getByText('删除后将从服务器上删除内容，且不可再次恢复')).toBeInTheDocument();
    expect(screen.getByText(/操作不可撤销/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认永久删除' }));
    await waitFor(() => expect(hardDeleteEntityFile).toHaveBeenCalledWith('file_deleted'));
  });

  it('uses the pre-upscale image as the large result thumbnail', async () => {
    (fetchUserFiles as any).mockResolvedValue({
      items: [
        {
          fileId: 'file_result',
          fileUrl: '/api/node-outputs/task-upscale/output-large/download',
          fileType: 'image',
          fileRole: 'urgent_image_upscale',
          isSelected: false,
          createdAt: '2026-09-03T03:29:30Z',
          metadata: { task_id: 'task-upscale' },
        },
        {
          fileId: 'file_source',
          fileUrl: '/api/files/file_source/download',
          fileType: 'image',
          fileRole: '',
          isSelected: false,
          createdAt: '2026-09-03T03:24:20Z',
          metadata: { source: 'upload_api' },
        },
      ],
      total: 2,
    });
    (apiJson as any).mockImplementation((url: string) => Promise.resolve(
      url === '/api/tasks?limit=100'
        ? {
            tasks: [{
              task_id: 'task-upscale',
              task_type: 'image_upscale',
              status: 'completed',
              data: {
                requested_workflow_type: 'image_upscale',
                agent_files: [{ url: '/api/files/file_source/download' }],
              },
            }],
          }
        : { tasks: [] },
    ));

    const { container } = render(<HistoryPage />);

    await waitFor(() => expect(screen.getAllByText('图片高清放大')).toHaveLength(2));
    expect(screen.getByText('大尺寸图')).toBeInTheDocument();
    const largeResultCard = screen.getByText('大尺寸图').closest('.group');
    const resultImage = largeResultCard?.querySelector('img[src="/api/files/file_source/download"]');
    expect(resultImage).toBeInTheDocument();
    expect(container.querySelector('img[src="/api/node-outputs/task-upscale/output-large/download"]'))
      .not.toBeInTheDocument();

    fireEvent.error(resultImage!);
    expect(largeResultCard?.querySelector('img')).toHaveAttribute(
      'src',
      '/api/entity-files/file_source/recycle-thumbnail',
    );
  });
});
