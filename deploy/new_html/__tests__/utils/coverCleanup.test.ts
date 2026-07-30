import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteEntityFile, hardDeleteEntityFile } from '../../services/entityFileService';
import {
  cleanupReplacedCoverFile,
  extractEntityFileIdFromDownloadUrl,
} from '../../utils/coverCleanup';

vi.mock('../../services/entityFileService', () => ({
  deleteEntityFile: vi.fn(),
  hardDeleteEntityFile: vi.fn(),
}));

describe('coverCleanup utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (hardDeleteEntityFile as any).mockResolvedValue({ freed_bytes: 1024 });
    (deleteEntityFile as any).mockResolvedValue(undefined);
  });

  it('extracts file ids from relative and absolute download urls', () => {
    expect(extractEntityFileIdFromDownloadUrl('/api/files/file_old/download')).toBe('file_old');
    expect(extractEntityFileIdFromDownloadUrl('https://spti.ai/api/files/file%20old/download?token=abc')).toBe('file old');
  });

  it('skips cleanup for non-platform urls and unchanged file ids', async () => {
    await expect(cleanupReplacedCoverFile('https://cdn.example.com/cover.jpg', 'file_new')).resolves.toBe('skipped');
    await expect(cleanupReplacedCoverFile('/api/files/file_same/download', 'file_same')).resolves.toBe('skipped');

    expect(hardDeleteEntityFile).not.toHaveBeenCalled();
    expect(deleteEntityFile).not.toHaveBeenCalled();
  });

  it('hard-deletes the replaced cover file when possible', async () => {
    await expect(cleanupReplacedCoverFile('/api/files/file_old/download', 'file_new')).resolves.toBe('hard_deleted');

    expect(hardDeleteEntityFile).toHaveBeenCalledWith('file_old');
    expect(deleteEntityFile).not.toHaveBeenCalled();
  });

  it('falls back to soft delete when physical cleanup is blocked', async () => {
    (hardDeleteEntityFile as any).mockRejectedValueOnce(new Error('blocked'));

    await expect(cleanupReplacedCoverFile('/api/files/file_old/download', 'file_new')).resolves.toBe('soft_deleted');

    expect(hardDeleteEntityFile).toHaveBeenCalledWith('file_old');
    expect(deleteEntityFile).toHaveBeenCalledWith('file_old');
  });
});
