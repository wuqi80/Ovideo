import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAsset, updateAsset, deleteAsset, shareAsset } from '../../services/assetMutationService';

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

describe('asset mutation service', () => {
  it('creates assets through the shared asset endpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, asset: { asset_id: 'a1' } }));

    await createAsset({ project_id: 'p1', asset_type: 'character', name: 'hero' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(opts.body).name).toBe('hero');
  });

  it('updates assets by asset id', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await updateAsset('asset_abc', { description: 'updated' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets/asset_abc');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body).description).toBe('updated');
  });

  it('deletes assets by asset id', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await deleteAsset('asset_abc');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets/asset_abc');
    expect(opts.method).toBe('DELETE');
  });

  it('shares assets to target episode and script', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await shareAsset('asset_abc', 'ep_2', 'script_3');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets/asset_abc/share');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      target_episode_id: 'ep_2',
      target_script_id: 'script_3',
    });
  });
});
