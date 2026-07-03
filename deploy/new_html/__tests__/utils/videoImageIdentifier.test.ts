import { describe, expect, it } from 'vitest';
import { resolveVideoImageIdentifier, extractFileId } from '../../utils/videoImageIdentifier';
import type { UploadedImage } from '../../services/videoTaskTypes';

const image = (over: Partial<UploadedImage>): UploadedImage => ({
    id: 'img_1',
    url: '',
    filename: '',
    uploadTime: 1,
    ...over,
});

describe('extractFileId', () => {
    it('extracts file_id from download urls', () => {
        expect(extractFileId('/api/files/file_abc123/download')).toBe('file_abc123');
        expect(extractFileId('https://mecha.one/api/files/file_abc123/download')).toBe('file_abc123');
    });
});

describe('resolveVideoImageIdentifier', () => {
    it('uses persistent url for ComfyUI instead of storyboard display filename', () => {
        const img = image({
            filename: 'storyboard_1.png',
            url: '/api/files/file_real123/download',
            storageUrl: '/api/files/file_real123/download',
        });

        expect(resolveVideoImageIdentifier(img, false)).toBe('/api/files/file_real123/download');
    });

    it('keeps explicit ComfyUI filename first', () => {
        const img = image({
            filename: 'storyboard_1.png',
            url: '/api/files/file_real123/download',
            comfyuiFilename: 'already_uploaded.png',
        });

        expect(resolveVideoImageIdentifier(img, false)).toBe('already_uploaded.png');
    });

    it('uses file_id for external API models', () => {
        const img = image({
            filename: 'storyboard_1.png',
            storageUrl: '/api/files/file_real123/download',
        });

        expect(resolveVideoImageIdentifier(img, true)).toBe('file_real123');
    });
});
