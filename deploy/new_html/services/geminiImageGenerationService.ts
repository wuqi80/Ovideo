import { generateGeminiImageViaProxy, GeminiImageOptions, GeneratedFileResult } from './geminiImageService';

const MODEL_IMAGE_NANO2 = 'gemini-3.1-flash-image-preview';

const callWithRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        if (retries > 0 && (error.message?.includes('503') || error.message?.includes('Model isn\'t available'))) {
            console.warn(`Model busy, retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callWithRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

export const generateGeminiImageVariant = async (options: GeminiImageOptions): Promise<GeneratedFileResult[]> => {
    return generateGeminiImageViaProxy(options);
};

export const generateMaterialImage = async (
    name: string,
    type: 'character' | 'scene',
    context: string,
): Promise<string> => {
    const prompt = `
        Generate a high quality concept art style image for a ${type} named "${name}".

        Context/Description from script:
        "${context}"

        Style: Anime/Manga style, high detail, character sheet or environment concept art.
    `;
    const results = await generateGeminiImageVariant({
        model: MODEL_IMAGE_NANO2,
        prompt,
        aspectRatio: '1:1',
        imageSize: '2K',
    });
    return results[0].url;
};

export const generateFinalIllustration = async (
    prompt: string,
    referenceImages: string[],
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    imageOptions?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K' },
): Promise<string> => {
    return callWithRetry(async () => {
        try {
            const results = await generateGeminiImageVariant({
                model: MODEL_IMAGE_NANO2,
                prompt: `${prompt}\n\nStyle: High quality Anime/Manga screenshot, detailed background, cinematic lighting.`,
                references: referenceImages,
                aspectRatio: imageOptions?.aspectRatio ?? '16:9',
                imageSize: imageOptions?.imageSize ?? '2K',
                entityType: entityOptions?.entityType,
                entityId: entityOptions?.entityId,
                fileRole: entityOptions?.fileRole,
                episodeId: entityOptions?.episodeId,
            });

            if (!results || results.length === 0) {
                throw new Error("No image generated");
            }

            return results[0].url;
        } catch (error) {
            console.error("Final Gen Error:", error);
            throw new Error("Failed to generate final illustration.");
        }
    });
};
