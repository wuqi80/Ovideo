import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { EpisodeProvider, useEpisode } from '../../contexts/EpisodeContext';

vi.mock('../../services/apiService', () => ({
  getEpisodeScript: vi.fn().mockResolvedValue({
    success: true,
    script: { scriptId: 's1', episodeId: 'ep1', originalContent: '剧本内容', adaptedScript: '', metadata: {} }
  }),
  getStoryboardItems: vi.fn().mockResolvedValue({
    success: true,
    items: [{ itemId: 'sb1', sortOrder: 1, dialogue: '你好', audioDurationMs: null }]
  }),
  getAssets: vi.fn().mockResolvedValue({ success: true, assets: [] }),
  getAudioTracks: vi.fn().mockResolvedValue({ success: true, tracks: [] }),
  getVideoSegments: vi.fn().mockResolvedValue({ success: true, segments: [] }),
  updateStoryboardItem: vi.fn().mockResolvedValue({ success: true }),
  getHeaders: vi.fn().mockReturnValue({}),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <EpisodeProvider projectId="p1" episodeId="ep1">
        {children}
      </EpisodeProvider>
    </MemoryRouter>
  );
}

describe('EpisodeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    const { result } = renderHook(() => useEpisode(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('provides episode data after loading', async () => {
    const { result } = renderHook(() => useEpisode(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.script).not.toBeNull();
    expect(result.current.script?.originalContent).toBe('剧本内容');
    expect(result.current.storyboardItems).toHaveLength(1);
    expect(result.current.storyboardItems[0].dialogue).toBe('你好');
  });

  it('provides projectId and episodeId', async () => {
    const { result } = renderHook(() => useEpisode(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.projectId).toBe('p1');
    expect(result.current.episodeId).toBe('ep1');
  });

  it('exposes error when all APIs fail', async () => {
    const apiService = await import('../../services/apiService');
    vi.mocked(apiService.getEpisodeScript).mockRejectedValueOnce(new Error('fail'));
    vi.mocked(apiService.getStoryboardItems).mockRejectedValueOnce(new Error('fail'));
    vi.mocked(apiService.getAssets).mockRejectedValueOnce(new Error('fail'));
    vi.mocked(apiService.getAudioTracks).mockRejectedValueOnce(new Error('fail'));
    vi.mocked(apiService.getVideoSegments).mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() => useEpisode(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.storyboardItems).toHaveLength(0);
    expect(result.current.script).toBeNull();
  });

  it('updateStoryboardDuration updates local state', async () => {
    const { result } = renderHook(() => useEpisode(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(async () => {
      await result.current.updateStoryboardDuration('sb1', 3500);
      expect(result.current.storyboardItems[0].audioDurationMs).toBe(3500);
    });
  });
});
