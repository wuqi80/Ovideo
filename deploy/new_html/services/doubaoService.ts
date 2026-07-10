import { apiJson } from './httpClient';

export interface GeneratedFileResult {
    url: string;
    fileId?: string;
    fileUrl?: string;
}

export interface DoubaoGenerationOptions {
    prompt: string;
    references?: string[];
    size?: '1K' | '2K' | '4K';
    sequential?: 'disabled' | 'auto';
    count?: number;
    entityType?: string;
    entityId?: string;
    fileRole?: string;
    projectId?: string;
    episodeId?: string;
}

interface DoubaoResponse {
    files?: Array<{
        file_url?: string;
        data_url?: string;
        file_id?: string;
    }>;
    images?: string[];
}

export const generateDoubaoImages = async (options: DoubaoGenerationOptions): Promise<GeneratedFileResult[]> => {
    const data = await apiJson<DoubaoResponse>('/api/materials/doubao', {
        method: 'POST',
        body: JSON.stringify({
            prompt: options.prompt,
            references: options.references || [],
            size: options.size || '2K',
            sequential: options.sequential || 'disabled',
            count: options.count || 1,
            entity_type: options.entityType,
            entity_id: options.entityId,
            file_role: options.fileRole,
            project_id: options.projectId,
            episode_id: options.episodeId,
        })
    }, '豆包图像生成');

    if (data.files && data.files.length > 0) {
        return data.files.map((f: any) => ({
            url: f.file_url || f.data_url,
            fileId: f.file_id,
            fileUrl: f.file_url,
        }));
    }
    if (!data.images || data.images.length === 0) {
        throw new Error('图像生成失败，未返回任何图片');
    }
    return data.images.map((img: string) => ({ url: img }));
};
