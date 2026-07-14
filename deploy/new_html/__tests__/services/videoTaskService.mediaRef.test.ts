import { normalizeVideoMediaRef } from '../../services/videoTaskService';

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
