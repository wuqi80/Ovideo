import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  batchSaveScriptSegments,
  createEpisodeScript,
  createTimelineTrack,
  deleteEpisodeScript,
  deleteScriptSegments,
  getWorkflowScript,
  getTimelineTracks,
  listEpisodeScriptSegments,
  listEpisodeScripts,
  selectWorkflowScript,
  updateEpisodeScriptById,
  updateTimelineTrack,
} from '../../services/scriptTimelineService';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: any) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('script timeline service', () => {
  it('lists episode scripts', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, scripts: [] }));

    await listEpisodeScripts('ep_1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/scripts');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test-token');
  });

  it('creates episode scripts', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, script_id: 'script_1' }));

    await createEpisodeScript('ep_1', { file_name: 'draft', adapted_script: 'body' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/scripts');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).adapted_script).toBe('body');
  });

  it('updates and deletes episode scripts by id', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await updateEpisodeScriptById('ep_1', 'script_1', { file_name: 'new name' });
    await deleteEpisodeScript('ep_1', 'script_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/episodes/ep_1/scripts/script_1');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).file_name).toBe('new name');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/episodes/ep_1/scripts/script_1');
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });

  it('reads and updates the episode workflow script', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, script_id: 'script_1' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, script_id: 'script_2' }));

    await getWorkflowScript('ep_1');
    await selectWorkflowScript('ep_1', 'script_2');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/episodes/ep_1/workflow-script');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/episodes/ep_1/workflow-script');
    expect(mockFetch.mock.calls[1][1].method).toBe('PUT');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).script_id).toBe('script_2');
  });

  it('lists script segments with optional script scope', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, segments: [] }));

    await listEpisodeScriptSegments('ep_1', 'script_1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/script-segments?script_id=script_1');
    expect(opts.method).toBe('GET');
  });

  it('batch saves and deletes script segments', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await batchSaveScriptSegments('ep_1', 'script_1', [{ content: 'line', sort_order: 1 }]);
    await deleteScriptSegments('ep_1', 'script_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/episodes/ep_1/script-segments/batch');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).script_id).toBe('script_1');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/episodes/ep_1/script-segments?script_id=script_1');
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });

  it('reads and mutates timeline tracks', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, tracks: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, track_id: 'track_1' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await getTimelineTracks('ep_1');
    await createTimelineTrack('ep_1', { track_type: 'audio' });
    await updateTimelineTrack('track_1', { name: 'mix' });

    expect(mockFetch.mock.calls[0][0]).toBe('/api/episodes/ep_1/timeline-tracks');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/episodes/ep_1/timeline-tracks');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).track_type).toBe('audio');
    expect(mockFetch.mock.calls[2][0]).toBe('/api/timeline-tracks/track_1');
    expect(mockFetch.mock.calls[2][1].method).toBe('PUT');
  });
});
