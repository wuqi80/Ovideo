import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryPage } from '../../components/HistoryPage';
import { fetchDeletedUserFiles, fetchUserFiles } from '../../services/entityFileService';

vi.mock('../../services/entityFileService', () => ({
  fetchDeletedUserFiles: vi.fn(),
  fetchUserFiles: vi.fn(),
  deleteEntityFile: vi.fn(),
  restoreEntityFile: vi.fn(),
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
});
