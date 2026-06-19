import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  vi.resetModules();
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('getAssets', () => {
  it('calls correct URL with project and episode filter', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, assets: [] }));
    const { getAssets } = await import('../../services/apiService');
    await getAssets('proj_1', 'ep_1');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/projects/proj_1/assets');
    expect(url).toContain('episode_id=ep_1');
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
  });

  it('works without optional params', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, assets: [] }));
    const { getAssets } = await import('../../services/apiService');
    await getAssets('proj_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/projects/proj_1/assets');
  });
});

describe('createAsset', () => {
  it('sends POST with correct body', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, asset: { asset_id: 'a1' } }));
    const { createAsset } = await import('../../services/apiService');
    await createAsset({ project_id: 'p1', asset_type: 'character', name: '角色' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).name).toBe('角色');
  });
});

describe('deleteAsset', () => {
  it('sends DELETE to correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
    const { deleteAsset } = await import('../../services/apiService');
    await deleteAsset('asset_abc');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets/asset_abc');
    expect(opts.method).toBe('DELETE');
  });
});

describe('getStoryboardItems', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    const { getStoryboardItems } = await import('../../services/apiService');
    await getStoryboardItems('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items');
  });

  it('supports script filter and pagination query', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [], total: 58 }));
    const { getStoryboardItems } = await import('../../services/apiService');
    await getStoryboardItems('ep_1', 'script_1', { limit: 10, offset: 20, includeTotal: true });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?script_id=script_1&limit=10&offset=20&include_total=true');
  });

  it('supports lightweight field sets', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    const { getStoryboardItems } = await import('../../services/apiService');
    await getStoryboardItems('ep_1', undefined, { fields: 'audio' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?fields=audio');
  });

  it('supports video-generation field sets', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    const { getStoryboardItems } = await import('../../services/apiService');
    await getStoryboardItems('ep_1', undefined, { fields: 'video' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?fields=video');
  });

  it('supports audio-stage field sets', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    const { getStoryboardItems } = await import('../../services/apiService');
    await getStoryboardItems('ep_1', undefined, { fields: 'audio_stage' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?fields=audio_stage');
  });
});

describe('updateStoryboardItem', () => {
  it('sends PUT with data', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
    const { updateStoryboardItem } = await import('../../services/apiService');
    await updateStoryboardItem('sb_1', { audio_duration_ms: 3200 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/storyboard-items/sb_1');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body).audio_duration_ms).toBe(3200);
  });
});

describe('getAudioTracks', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, tracks: [] }));
    const { getAudioTracks } = await import('../../services/apiService');
    await getAudioTracks('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/audio-tracks');
  });
});

describe('generateSpeech', () => {
  it('sends POST with text and options', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, audio_url: '/audio/test.wav', duration_ms: 3000 }));
    const { generateSpeech } = await import('../../services/apiService');
    await generateSpeech({ text: '你好', persona: 'narrator', emotion: 'neutral' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/audio/generate-speech');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.text).toBe('你好');
    expect(body.persona).toBe('narrator');
  });
});

describe('getEpisodeScript', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, script: {} }));
    const { getEpisodeScript } = await import('../../services/apiService');
    await getEpisodeScript('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/script');
  });
});

describe('getVideoSegments', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, segments: [] }));
    const { getVideoSegments } = await import('../../services/apiService');
    await getVideoSegments('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/video-segments');
  });
});

describe('getTimelineTracks', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, tracks: [] }));
    const { getTimelineTracks } = await import('../../services/apiService');
    await getTimelineTracks('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/timeline-tracks');
  });
});
