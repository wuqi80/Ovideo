import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearProjectVideoTasks,
  cropVideo,
  getProjectVideoTasks,
  reuploadVideo,
  secureMediaUrl,
} from '../../services/videoMediaService';
import { secureMediaUrl as compatSecureMediaUrl } from '../../services/videoService';

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

describe('video media service', () => {
  it('secures media URLs with the current auth token', () => {
    expect(secureMediaUrl('/uploads/a.mp4')).toBe('/uploads/a.mp4?token=test-token');
    // 旧的（可能隔天过期的）token 必须被当前 token 覆盖，否则媒体会在 JWT 过期后 401 消失。
    expect(secureMediaUrl('/uploads/a.mp4?token=existing')).toBe('/uploads/a.mp4?token=test-token');
    expect(compatSecureMediaUrl('/uploads/a.mp4')).toBe('/uploads/a.mp4?token=test-token');
  });

  it('loads and clears project video task imports', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        success: true,
        project: { video_tasks: [{ image_url: '/uploads/shot.png', scene: 'A' }] },
      }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await expect(getProjectVideoTasks('proj_1')).resolves.toEqual([
      { image_url: '/uploads/shot.png', scene: 'A' },
    ]);
    await clearProjectVideoTasks('proj_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/projects/proj_1/workspace');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/projects/proj_1/clear-video-tasks');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
  });

  it('normalizes missing project video task arrays to an empty list', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, project: { video_tasks: null } }));

    await expect(getProjectVideoTasks('proj_1')).resolves.toEqual([]);
  });

  it('crops videos through the video endpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ filename: 'crop.mp4', url: '/uploads/crop.mp4' }));

    await cropVideo('source.mp4', 1.5, 4.25);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/video/crop');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      video_filename: 'source.mp4',
      start_time: 1.5,
      end_time: 4.25,
    });
  });

  it('reuploads videos through the ComfyUI file bridge', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ filename: 'out.mp4', url: '/uploads/out.mp4' }));

    await reuploadVideo('video final.mp4', 'temp');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/comfyui/reupload/video?filename=video%20final.mp4&file_type=temp');
    expect(opts.method).toBe('POST');
  });
});
