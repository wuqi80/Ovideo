import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDoubaoImages } from '../../services/doubaoService';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === 'auth_token' ? 'test-token' : null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  } as unknown as Storage);
});

describe('generateDoubaoImages', () => {
  it('passes an explicit ratio-preserving size to the backend', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ images: ['data:image/png;base64,AAAA'] }),
    });

    await generateDoubaoImages({
      prompt: 'turnaround',
      size: '2048x1152',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/materials/doubao');
    expect(JSON.parse(init.body).size).toBe('2048x1152');
  });
});
