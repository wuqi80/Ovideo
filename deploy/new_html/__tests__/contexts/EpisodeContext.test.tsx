import { act, renderHook, waitFor } from '@testing-library/react';
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

  it('starts idle before a page requests slices', () => {
    const { result } = renderHook(() => useEpisode(), { wrapper });
    expect(result.current.isLoading).toBe(false);
  });

  it('provides episode data after requested slices load', async () => {
    const { result } = renderHook(() => useEpisode(), { wrapper });
    await act(async () => {
      await result.current.loadSlices('script', 'storyboardItems');
    });
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
    await act(async () => {
      await result.current.loadSlices('script', 'storyboardItems', 'assets', 'audioTracks', 'videoSegments');
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.storyboardItems).toHaveLength(0);
    expect(result.current.script).toBeNull();
  });

  it('updateStoryboardDuration updates local state', async () => {
    const { result } = renderHook(() => useEpisode(), { wrapper });
    await act(async () => {
      await result.current.loadSlices('storyboardItems');
    });
    await act(async () => {
      await result.current.updateStoryboardDuration('sb1', 3500);
    });
    expect(result.current.storyboardItems[0].audioDurationMs).toBe(3500);
  });

  it('clears stale script selection when storyboard falls back to episode scope', async () => {
    const apiService = await import('../../services/apiService');
    vi.mocked(apiService.getStoryboardItems).mockResolvedValueOnce({
      success: true,
      items: [{ item_id: 'sb_episode', sort_order: 0, dialogue: 'episode scope' }],
      total: 23,
      fallbackScriptId: 'stale_script',
      fallbackReason: 'stale_script_storyboard',
    } as any);

    const { result } = renderHook(() => useEpisode(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSelectedScriptId('stale_script');
    });
    await waitFor(() => expect(result.current.selectedScriptId).toBe('stale_script'));

    await act(async () => {
      await result.current.loadStoryboardItemsPage({ limit: 10, includeTotal: true });
    });

    expect(apiService.getStoryboardItems).toHaveBeenLastCalledWith(
      'ep1',
      'stale_script',
      { limit: 10, offset: 0, includeTotal: true },
    );
    await waitFor(() => expect(result.current.selectedScriptId).toBeNull());
    expect(result.current.storyboardItems).toHaveLength(1);
    expect(result.current.storyboardTotalCount).toBe(23);
  });

  it('reloads script scoped slices on first script selection', async () => {
    const apiService = await import('../../services/apiService');
    const { result } = renderHook(() => useEpisode(), { wrapper });

    await act(async () => {
      await result.current.loadSlices('storyboardItems', 'assets');
    });

    vi.clearAllMocks();
    act(() => {
      result.current.setSelectedScriptId('script_2');
    });

    await waitFor(() => {
      expect(apiService.getStoryboardItems).toHaveBeenCalledWith(
        'ep1',
        'script_2',
        { limit: 10, includeTotal: true },
      );
    });
    expect(apiService.getAssets).toHaveBeenCalledWith('p1', 'ep1', undefined, 'script_2');
  });

  it('reloads loaded script scoped slices after stale storyboard fallback clears selection', async () => {
    const apiService = await import('../../services/apiService');
    vi.mocked(apiService.getStoryboardItems)
      .mockResolvedValueOnce({
        success: true,
        items: [{ item_id: 'sb_episode', sort_order: 0, dialogue: 'episode scope' }],
        total: 23,
        fallbackScriptId: 'stale_script',
        fallbackReason: 'stale_script_storyboard',
      } as any)
      .mockResolvedValue({
        success: true,
        items: [{ item_id: 'sb_episode', sort_order: 0, dialogue: 'episode scope' }],
        total: 23,
      } as any);

    const { result } = renderHook(() => useEpisode(), { wrapper });
    act(() => {
      result.current.setSelectedScriptId('stale_script');
    });
    await waitFor(() => expect(result.current.selectedScriptId).toBe('stale_script'));

    await act(async () => {
      await result.current.loadSlices('storyboardItems', 'assets');
    });

    await waitFor(() => expect(result.current.selectedScriptId).toBeNull());
    await waitFor(() => {
      expect(apiService.getAssets).toHaveBeenCalledWith('p1', 'ep1', undefined, undefined);
    });
    expect(apiService.getAssets).toHaveBeenCalledWith('p1', 'ep1', undefined, 'stale_script');
  });
});
