import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  batchSaveScriptSegments,
  createEpisodeScript,
  createScriptMessage,
  createScriptVersion,
  createTimelineTrack,
  deleteEpisodeScript,
  deleteScriptSegments,
  getWorkflowScript,
  getScriptConversation,
  getTimelineTracks,
  listEpisodeScriptSegments,
  listEpisodeScripts,
  selectWorkflowScript,
  selectScriptVersion,
  updateScriptMessage,
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

  it('sends source identity for idempotent generated candidates', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      success: true,
      created: false,
      script: { script_id: 'script_existing' },
    }));

    await createEpisodeScript('ep_1', {
      file_name: 'reverse candidate',
      adapted_script: 'body',
      source_type: 'video_reverse',
      source_id: 'reverse_1',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual(expect.objectContaining({
      source_type: 'video_reverse',
      source_id: 'reverse_1',
    }));
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

  it('persists conversation messages and immutable versions', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        success: true,
        script: { script_id: 'script_1', current_version_id: 'ver_1' },
        messages: [{ message_id: 'msg_1', role: 'user', content: '原稿', status: 'completed' }],
        versions: [{ version_id: 'ver_1', script_id: 'script_1', version_no: 1, storyboard_items: [] }],
      }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, message: { message_id: 'msg_2', role: 'assistant', status: 'streaming' } }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, message: { message_id: 'msg_2', role: 'assistant', status: 'completed', content: '镜头01' } }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, version: { version_id: 'ver_2', script_id: 'script_1', version_no: 2, storyboard_items: [{ id: 'shot_1' }] } }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, version: { version_id: 'ver_2', script_id: 'script_1', version_no: 2, storyboard_items: [] } }));

    const conversation = await getScriptConversation('ep_1', 'script_1');
    await createScriptMessage('ep_1', 'script_1', { role: 'assistant', content: '', status: 'streaming' });
    await updateScriptMessage('ep_1', 'script_1', 'msg_2', { content: '镜头01', status: 'completed' });
    await createScriptVersion('ep_1', 'script_1', { content: '镜头01', storyboardItems: [{ id: 'shot_1', originalText: '', scriptSegment: '' }] });
    await selectScriptVersion('ep_1', 'script_1', 'ver_2');

    expect(conversation.currentVersionId).toBe('ver_1');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/episodes/ep_1/scripts/script_1/messages');
    expect(mockFetch.mock.calls[2][0]).toBe('/api/episodes/ep_1/scripts/script_1/messages/msg_2');
    expect(mockFetch.mock.calls[2][1].method).toBe('PATCH');
    expect(mockFetch.mock.calls[3][0]).toBe('/api/episodes/ep_1/scripts/script_1/versions');
    expect(JSON.parse(mockFetch.mock.calls[3][1].body).storyboard_items[0].id).toBe('shot_1');
    expect(mockFetch.mock.calls[4][0]).toBe('/api/episodes/ep_1/scripts/script_1/versions/ver_2/select');
  });

  it('decodes jsonb strings returned by asyncpg for storyboard versions', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      success: true,
      script: { script_id: 'script_1', current_version_id: 'ver_1' },
      messages: [{
        message_id: 'msg_1',
        role: 'assistant',
        content: '镜头01',
        metadata: '{"requestId":"req_1"}',
      }],
      versions: [{
        version_id: 'ver_1',
        script_id: 'script_1',
        version_no: 1,
        storyboard_items: '[{"id":"shot_1","originalText":"第一镜"}]',
        metadata: '{"source":"legacy"}',
      }],
    }));

    const conversation = await getScriptConversation('ep_1', 'script_1');

    expect(conversation.messages[0].metadata).toEqual({ requestId: 'req_1' });
    expect(conversation.versions[0].storyboardItems).toEqual([
      expect.objectContaining({ id: 'shot_1', originalText: '第一镜' }),
    ]);
    expect(conversation.versions[0].metadata).toEqual({ source: 'legacy' });
  });
});
