import type { UploadedImage } from '../services/videoTaskTypes';

function cleanRef(ref?: string): string {
    return (ref || '').trim().split('?')[0];
}

export function extractFileId(ref?: string): string | null {
    const value = cleanRef(ref);
    const match = value.match(/\/api\/files\/(file_[A-Za-z0-9_-]+)/);
    if (match) return match[1];
    if (/^file_[A-Za-z0-9_-]+$/.test(value)) return value;
    return null;
}

function isUsableTransferRef(ref?: string): boolean {
    const value = cleanRef(ref);
    if (!value) return false;
    if (value.startsWith('blob:') || value.startsWith('data:')) return false;
    return value.startsWith('http') || value.startsWith('/') || Boolean(extractFileId(value));
}

export function resolveVideoImageIdentifier(img: UploadedImage, isExternalAPI: boolean): string {
    const storageRef = cleanRef(img.storageUrl);
    const urlRef = cleanRef(img.url);

    if (isExternalAPI) {
        const fileId = extractFileId(storageRef) || extractFileId(urlRef);
        if (fileId) return fileId;
        return img.filename || storageRef || urlRef || '';
    }

    if (img.comfyuiFilename) return img.comfyuiFilename;
    if (isUsableTransferRef(storageRef)) return storageRef;
    if (isUsableTransferRef(urlRef)) return urlRef;
    return img.filename || urlRef.split('/').pop() || '';
}
