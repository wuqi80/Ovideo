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

function mockBlobResponse(blob: Blob = new Blob(['image-bytes'], { type: 'image/png' })) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': blob.type }),
    blob: async () => blob,
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

describe('uploadImageToComfyUI', () => {
  it('downloads same-origin image through shared authenticated blob client', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBlobResponse())
      .mockResolvedValueOnce(mockJsonResponse({ success: true, filename: 'image.png', storage_url: '/uploads/image.png' }));

    const { uploadImageToComfyUI } = await import('../../services/apiService');
    const result = await uploadImageToComfyUI('/storage/source.png');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [downloadUrl, downloadOpts] = mockFetch.mock.calls[0];
    expect(downloadUrl).toBe(`${window.location.origin}/storage/source.png?token=test-token`);
    expect(downloadOpts.headers.Authorization).toBe('Bearer test-token');
    expect(downloadOpts.headers['Content-Type']).toBeUndefined();

    const [uploadUrl, uploadOpts] = mockFetch.mock.calls[1];
    expect(uploadUrl).toBe('/api/comfyui/upload');
    expect(uploadOpts.method).toBe('POST');
    expect(uploadOpts.body).toBeInstanceOf(FormData);
  });

  it('does not attach local auth token to external image downloads', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBlobResponse())
      .mockResolvedValueOnce(mockJsonResponse({ success: true, filename: 'image.png', storage_url: '/uploads/image.png' }));

    const { uploadImageToComfyUI } = await import('../../services/apiService');
    await uploadImageToComfyUI('https://cdn.example.test/source.png');

    const [downloadUrl, downloadOpts] = mockFetch.mock.calls[0];
    expect(downloadUrl).toBe('https://cdn.example.test/source.png');
    expect(downloadOpts.method).toBe('GET');
    expect(downloadOpts.headers.Authorization).toBeUndefined();
    expect(downloadOpts.headers['Content-Type']).toBeUndefined();
  });

  it('downloads blob URLs through public blob helper without auth headers', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBlobResponse())
      .mockResolvedValueOnce(mockJsonResponse({ success: true, filename: 'image.png', storage_url: '/uploads/image.png' }));

    const { uploadImageToComfyUI } = await import('../../services/apiService');
    await uploadImageToComfyUI('blob:http://localhost/source');

    const [downloadUrl, downloadOpts] = mockFetch.mock.calls[0];
    expect(downloadUrl).toBe('blob:http://localhost/source');
    expect(downloadOpts.method).toBe('GET');
    expect(downloadOpts.headers.Authorization).toBeUndefined();
    expect(downloadOpts.headers['Content-Type']).toBeUndefined();
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

  it('falls back to episode storyboard when selected script has no rows', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, items: [], total: 0 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, items: [{ item_id: 'sb_1' }], total: 1 }));
    const { getStoryboardItems } = await import('../../services/apiService');
    const result = await getStoryboardItems('ep_1', 'stale_script', { limit: 10, includeTotal: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/episodes/ep_1/storyboard-items?script_id=stale_script&limit=10&include_total=true');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/episodes/ep_1/storyboard-items?limit=10&include_total=true');
    expect(result.items).toHaveLength(1);
    expect(result.fallbackScriptId).toBe('stale_script');
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

  it('supports material-binding field sets', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    const { getStoryboardItems } = await import('../../services/apiService');
    await getStoryboardItems('ep_1', undefined, { fields: 'materials' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?fields=materials');
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
