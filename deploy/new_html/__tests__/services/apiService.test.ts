import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAsset,
  deleteAsset,
  getTimelineTracks,
  uploadImageToComfyUI,
} from '../../services/apiService';

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
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('createAsset', () => {
  it('sends POST with correct body', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, asset: { asset_id: 'a1' } }));
    await createAsset({ project_id: 'p1', asset_type: 'character', name: 'hero' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).name).toBe('hero');
  });
});

describe('uploadImageToComfyUI', () => {
  it('downloads same-origin image through shared authenticated blob client', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBlobResponse())
      .mockResolvedValueOnce(mockJsonResponse({ success: true, filename: 'image.png', storage_url: '/uploads/image.png' }));

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
    await deleteAsset('asset_abc');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets/asset_abc');
    expect(opts.method).toBe('DELETE');
  });
});

describe('getTimelineTracks', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, tracks: [] }));
    await getTimelineTracks('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/timeline-tracks');
  });
});
