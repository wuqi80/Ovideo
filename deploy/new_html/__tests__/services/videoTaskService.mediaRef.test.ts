import {
    buildComfyUIVideoTaskPayload,
    normalizeVideoMediaRef,
    submitTask,
} from '../../services/videoTaskService';

describe('normalizeVideoMediaRef', () => {
    it('preserves persistent application URLs for MiniMax frames', () => {
        expect(normalizeVideoMediaRef('/storage/image/storyboard-real.png'))
            .toBe('/storage/image/storyboard-real.png');
        expect(normalizeVideoMediaRef('/api/files/file_real123/download'))
            .toBe('/api/files/file_real123/download');
    });

    it('preserves file ids and public URLs', () => {
        expect(normalizeVideoMediaRef('file_real123')).toBe('file_real123');
        expect(normalizeVideoMediaRef('https://cdn.example.test/frame.png'))
            .toBe('https://cdn.example.test/frame.png');
    });

    it('maps actual temporary upload filenames to the uploads mount', () => {
        expect(normalizeVideoMediaRef('uploaded-frame.png')).toBe('/uploads/uploaded-frame.png');
        expect(normalizeVideoMediaRef('uploads/uploaded-frame.png')).toBe('/uploads/uploaded-frame.png');
    });
});

describe('MiniMax submission validation', () => {
    it('rejects an unsupported resolution and duration pair before calling the API', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        await expect(submitTask(
            '/storage/frame.png',
            null,
            'move gently',
            'MINI',
            undefined,
            undefined,
            'single',
            undefined,
            {
                duration: 10,
                minimax_resolution: '1080P',
            },
        )).rejects.toThrow('1080P 仅支持 6 秒');

        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});

describe('ComfyUI video duration contract', () => {
    it('preserves the storyboard segment duration for GPU i2v and morph tasks', () => {
        expect(buildComfyUIVideoTaskPayload(
            'i2v',
            'first.png',
            null,
            'slow camera push',
            'Wan2',
            { duration: 14 },
        )).toMatchObject({
            task_type: 'i2v',
            image_path: 'first.png',
            duration: 14,
        });

        expect(buildComfyUIVideoTaskPayload(
            'morph',
            'first.png',
            'last.png',
            'continuous transition',
            'Wan2',
        )).toMatchObject({
            task_type: 'morph',
            image_path: 'first.png',
            image_path_end: 'last.png',
            duration: 5,
        });
    });
});
