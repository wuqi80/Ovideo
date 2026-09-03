import { describe, expect, it } from 'vitest';
import {
  enrichImageUpscaleHistory,
  getHistoryPromptText,
  getHistoryThumbnailFallbackSource,
  getHistoryThumbnailSource,
  isImageUpscaleResultFile,
} from '../../utils/historyPrompt';

describe('getHistoryPromptText', () => {
  it('labels promptless upscale results as image upscales', () => {
    expect(getHistoryPromptText({ fileRole: 'upscaled_image', metadata: {} }))
      .toBe('图片高清放大');
  });

  it('keeps the generic empty state for other promptless files', () => {
    expect(getHistoryPromptText({ fileRole: 'generated_image', metadata: {} }))
      .toBe('');
  });

  it('preserves a user prompt even for an upscale result', () => {
    expect(getHistoryPromptText({
      fileRole: 'upscaled_image',
      metadata: { prompt: '保留这段用户提示词' },
    })).toBe('保留这段用户提示词');
  });

  it('treats a whitespace-only prompt as missing', () => {
    expect(getHistoryPromptText({
      fileRole: 'upscaled_image',
      metadata: { prompt: '   ' },
    })).toBe('图片高清放大');
  });

  it('recognizes legacy upscale result roles', () => {
    const file = { fileRole: 'urgent_image_upscale', metadata: {} };
    expect(getHistoryPromptText(file)).toBe('图片高清放大');
    expect(isImageUpscaleResultFile(file)).toBe(true);
  });

  it('builds a thumbnail URL from persisted source file metadata', () => {
    expect(getHistoryThumbnailSource({
      fileRole: 'upscaled_image',
      metadata: { source_file_id: 'file_source' },
    })).toBe('/api/files/file_source/download');
  });

  it('builds an owned recycle-thumbnail fallback for a deleted upscale source', () => {
    expect(getHistoryThumbnailFallbackSource({
      fileRole: 'upscaled_image',
      metadata: { source_file_id: 'file_source' },
    })).toBe('/api/entity-files/file_source/recycle-thumbnail');
  });

  it('links an existing large result to its pre-upscale image', () => {
    const files = [
      {
        fileId: 'file_result',
        fileUrl: '/api/node-outputs/task-upscale/output-large/download',
        fileType: 'image',
        fileRole: 'urgent_image_upscale',
        isSelected: false,
        createdAt: '2026-09-03T03:29:30Z',
        metadata: { task_id: 'task-upscale' },
      },
      {
        fileId: 'file_source',
        fileUrl: '/api/files/file_source/download',
        fileType: 'image',
        fileRole: '',
        isSelected: false,
        createdAt: '2026-09-03T03:24:20Z',
        metadata: { source: 'upload_api' },
      },
    ];
    const [result, source] = enrichImageUpscaleHistory(files, [{
      task_id: 'task-upscale',
      task_type: 'image_upscale',
      data: {
        requested_workflow_type: 'image_upscale',
        agent_files: [{
          param: 'image_path',
          url: '/api/files/file_source/download',
        }],
      },
    }]);

    expect(getHistoryPromptText(result)).toBe('图片高清放大');
    expect(getHistoryThumbnailSource(result)).toBe('/api/files/file_source/download');
    expect(isImageUpscaleResultFile(result)).toBe(true);
    expect(getHistoryPromptText(source)).toBe('图片高清放大');
    expect(isImageUpscaleResultFile(source)).toBe(false);
  });
});
