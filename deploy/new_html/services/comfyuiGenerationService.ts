import { enqueueComfyUITask } from './comfyuiTaskQueue';
import { apiJson } from './httpClient';
import {
    toQueueMeta,
    waitForComfyUITask,
    waitForComfyUITaskAllImages,
} from './comfyuiTaskWaitService';
import type { ComfyUITaskRegistryMeta, GeneratedImageResult } from './comfyuiTaskWaitService';

type GenerationTaskResponse = { task_id: string };

type ComfyUIEntityOptions = {
    entityType?: string;
    entityId?: string;
    fileRole?: string;
    projectId?: string;
    episodeId?: string;
    preferredAgentId?: string;
    preferredNodeId?: string;
};

const comfyuiRoutingPayload = (entityOptions?: ComfyUIEntityOptions) => ({
    preferred_agent_id: entityOptions?.preferredAgentId || entityOptions?.preferredNodeId,
    preferred_node_id: entityOptions?.preferredNodeId || entityOptions?.preferredAgentId,
});

const toQueuedTask = (data: GenerationTaskResponse): { taskId: string; status: string } => ({
    taskId: data.task_id,
    status: 'queued',
});

const postGenerationTask = async (
    url: string,
    payload: Record<string, any>,
    apiName: string,
): Promise<{ taskId: string; status: string }> => {
    const data = await apiJson<GenerationTaskResponse>(
        url,
        {
            method: 'POST',
            body: JSON.stringify(payload),
        },
        apiName,
    );
    return toQueuedTask(data);
};

// ==================== ComfyUI 引擎支持 ====================

/**
 * 使用ComfyUI I2I_FJ工作流调整图像角度
 * @param imageDataUrl Base64格式的图片
 * @param prompt 角度调整提示词（由滑杆自动生成）
 * @param seed 随机种子
 * @returns 任务ID和状态
 */
export const adjustImageAngle = async (
    imageDataUrl: string,
    prompt: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        // 1. 先上传图片到ComfyUI
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');
        const uploadResult = await uploadImageToComfyUI(imageDataUrl);

        // 2. 使用上传后的文件名调用角度调整接口
        return await postGenerationTask('/api/generate/angle-adjust', {
            image_filename: uploadResult.filename,
            prompt: prompt,
            seed: seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '角度调整');
    } catch (error) {
        console.error('Angle Adjustment Error:', error);
        throw error;
    }
};

/**
 * 使用ComfyUI I2I_HUMAN工作流进行多角度人物生成
 * @param imageDataUrl Base64格式的图片
 * @param seed 随机种子
 * @returns 任务ID和状态
 */
export const generateHumanMultiAngle = async (
    imageDataUrl: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        // 1. 先上传图片到ComfyUI
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');
        const uploadResult = await uploadImageToComfyUI(imageDataUrl);

        // 2. 使用上传后的文件名调用多角度生成接口
        return await postGenerationTask('/api/generate/human-multi-angle', {
            image_filename: uploadResult.filename,
            seed: seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '多角度人物生成');
    } catch (error) {
        console.error('Human Multi-Angle Generation Error:', error);
        throw error;
    }
};

/**
 * 全景角度生成（使用 I2I_Around 工作流）
 * @param imageDataUrl Base64 格式的图片
 * @param prompt 角度描述提示词
 * @returns 任务ID和状态
 */
export const generateAroundAngle = async (
    imageDataUrl: string,
    prompt: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        // 1. 先上传图片到ComfyUI
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');
        const uploadResult = await uploadImageToComfyUI(imageDataUrl);

        // 2. 使用上传后的文件名调用全景生成接口
        return await postGenerationTask('/api/generate/around-angle', {
            image_filename: uploadResult.filename,
            prompt: prompt,
            seed: seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '全景角度生成');
    } catch (error) {
        console.error('Around Angle Generation Error:', error);
        throw error;
    }
};

/**
 * 使用ComfyUI引擎生成图像（调用后端I2I_FJ工作流）
 * @deprecated 请使用 adjustImageAngle 进行角度调整，或使用 generateWithComfyUIWorkflow 进行多图生成
 * @param prompt 图像提示词
 * @param referenceImages 参考图列表（base64格式，最多6张）
 * @param strength 控制强度 0-1
 * @returns 生成的图像URL或base64
 */
export const generateWithComfyUI = async (
    prompt: string,
    referenceImages: string[],
    strength: number = 0.75,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        // 调用后端图像生成接口
        return await postGenerationTask('/api/generate/image', {
            engine: 'comfyui',
            prompt: prompt,
            negative_prompt: 'bad quality, worst quality, blurry, distorted',
            ref_images: referenceImages.slice(0, 6),
            strength: strength,
            seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '图像生成');
    } catch (error) {
        console.error('ComfyUI Generation Error:', error);
        throw error;
    }
};

/**
 * 使用指定ComfyUI工作流生成图像
 * @param workflowType 工作流类型 (qwen/qwen_lora/kontext)
 * @param prompt 图像提示词
 * @param mainImage 主参考图（Base64）
 * @param refImages 额外参考图（Base64列表）
 * @param seed 随机种子
 */
export const generateWithComfyUIWorkflow = async (
    workflowType: 'qwen' | 'qwen_lora' | 'kontext' | 'qwenN' | 'qwenN_lora',
    prompt: string,
    mainImage: string,
    refImages: string[] = [],
    seed: number = -1,
    entityOptions?: ComfyUIEntityOptions
): Promise<{ taskId: string; status: string }> => {
    try {
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');
        const allImages = [mainImage, ...refImages].slice(0, 6);

        console.log(`🔄 开始上传${allImages.length}张图片到ComfyUI...`);

        const filenames: string[] = [];
        for (let i = 0; i < allImages.length; i++) {
            try {
                console.log(`  上传图片 ${i + 1}/${allImages.length}: ${allImages[i].substring(0, 50)}...`);
                const result = await uploadImageToComfyUI(allImages[i]);
                filenames.push(result.filename);
                console.log(`  ✅ 图片 ${i + 1} 上传成功: ${result.filename}`);
            } catch (error) {
                console.error(`  ❌ 图片 ${i + 1} 上传失败:`, error);
            }
        }

        if (filenames.length === 0) {
            throw new Error('所有图片上传失败，无法生成');
        }

        console.log(`✅ 成功上传${filenames.length}/${allImages.length}张图片到ComfyUI:`, filenames);

        return await postGenerationTask('/api/generate/comfyui-workflow', {
            workflow_type: workflowType,
            prompt: prompt,
            negative_prompt: 'bad quality, worst quality, blurry, distorted',
            image_filenames: filenames,
            seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            project_id: entityOptions?.projectId,
            episode_id: entityOptions?.episodeId,
            ...comfyuiRoutingPayload(entityOptions),
        }, `${workflowType}工作流生成`);
    } catch (error) {
        console.error(`${workflowType} Generation Error:`, error);
        throw error;
    }
};

/**
 * 素材处理（高清放大、去水印、三视图）
 * @param imageDataUrl Base64格式的图片
 * @param workflowType 工作流类型
 * @returns 任务ID和状态
 */
export const processMaterialImage = async (
    imageDataUrl: string,
    workflowType: 'upscale_hd' | 'remove_watermark' | 'three_view',
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        const { uploadImageToComfyUI, processMaterial } = await import('./comfyuiBridgeService');
        const uploadResult = await uploadImageToComfyUI(imageDataUrl);

        const result = await processMaterial(uploadResult.filename, workflowType, entityOptions);

        return {
            taskId: result.task_id,
            status: 'queued'
        };
    } catch (error) {
        console.error('Material Processing Error:', error);
        throw error;
    }
};

// ========== ComfyUI 任务队列执行函数 ==========

/**
 * 队列执行：使用ComfyUI工作流生成图像（带排队）
 * 确保同一时间只有一个ComfyUI任务在执行
 */
export const generateWithComfyUIWorkflowQueued = async (
    workflowType: 'qwen' | 'qwen_lora' | 'kontext' | 'qwenN' | 'qwenN_lora',
    prompt: string,
    mainImage: string,
    refImages: string[] = [],
    seed: number = -1,
    onTaskId?: (taskId: string) => void,
    entityOptions?: ComfyUIEntityOptions,
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<GeneratedImageResult[]> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await generateWithComfyUIWorkflow(workflowType, prompt, mainImage, refImages, seed, entityOptions);
        onTaskId?.(taskId);
        const urls = await waitForComfyUITaskAllImages(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        return urls;
    }, `画面分镜-${workflowType}`, registryMeta ? toQueueMeta(registryMeta) : undefined);
};

/**
 * 队列执行：多角度人物生成（带排队）
 */
export const generateHumanMultiAngleQueued = async (
    imageDataUrl: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<GeneratedImageResult[]> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await generateHumanMultiAngle(imageDataUrl, seed, entityOptions);
        const urls = await waitForComfyUITaskAllImages(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        return urls;
    }, '多角度人物生成', registryMeta ? toQueueMeta(registryMeta) : undefined);
};

/**
 * 队列执行：全景角度生成（带排队）
 */
export const generateAroundAngleQueued = async (
    imageDataUrl: string,
    prompt: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<GeneratedImageResult[]> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await generateAroundAngle(imageDataUrl, prompt, seed, entityOptions);
        const urls = await waitForComfyUITaskAllImages(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        return urls;
    }, '全景角度生成', registryMeta ? toQueueMeta(registryMeta) : undefined);
};

/**
 * 队列执行：角度调整（带排队）
 */
export const adjustImageAngleQueued = async (
    imageDataUrl: string,
    prompt: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<string> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await adjustImageAngle(imageDataUrl, prompt, seed, entityOptions);
        const url = await waitForComfyUITask(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        return url;
    }, '角度调整', registryMeta ? toQueueMeta(registryMeta) : undefined);
};

// ==================== 抠图 API ====================

/**
 * 抠图接口（主体脱离/主体背景分离）
 * @param imageDataUrl 图片DataURL
 * @param mattingType 抠图类型: subject(主体脱离) / split(主体背景分离)
 * @param seed 随机种子
 */
export const generateMatting = async (
    imageDataUrl: string,
    mattingType: 'subject' | 'split',
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        // 先上传图片到ComfyUI
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');
        const uploadResult = await uploadImageToComfyUI(imageDataUrl);

        return await postGenerationTask('/api/generate/matting', {
            image_filename: uploadResult.filename,
            matting_type: mattingType,
            seed: seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '抠图');
    } catch (error) {
        console.error('Matting Error:', error);
        throw error;
    }
};

/**
 * 队列执行：抠图（带排队）
 * 🆕 修改为返回所有生成的图片（matting_split 会生成3张图）
 */
export const generateMattingQueued = async (
    imageDataUrl: string,
    mattingType: 'subject' | 'split',
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<GeneratedImageResult[]> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await generateMatting(imageDataUrl, mattingType, seed, entityOptions);
        const urls = await waitForComfyUITaskAllImages(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        console.log(`✅ 抠图完成，返回 ${urls.length} 张图片`);
        return urls;
    }, `抠图(${mattingType})`, registryMeta ? toQueueMeta(registryMeta) : undefined);
};

// ==================== 融合 API ====================

/**
 * 图像融合接口
 * @param imageBkUrl 底图/背景图DataURL
 * @param imageHuUrl 人物图DataURL
 * @param imageMbUrl 蒙版图DataURL（仅迁移学习需要）
 * @param fusionType 融合类型: fusion/transfer/imitation
 * @param seed 随机种子
 */
export const generateImageFusion = async (
    imageBkUrl: string,
    imageHuUrl: string,
    fusionType: 'fusion' | 'transfer' | 'imitation',
    imageMbUrl?: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        // 上传所有图片到ComfyUI
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');
        const [bkResult, huResult] = await Promise.all([
            uploadImageToComfyUI(imageBkUrl),
            uploadImageToComfyUI(imageHuUrl)
        ]);

        let mbFilename: string | undefined;
        if (fusionType === 'transfer' && imageMbUrl) {
            const mbResult = await uploadImageToComfyUI(imageMbUrl);
            mbFilename = mbResult.filename;
        }

        return await postGenerationTask('/api/generate/image-fusion', {
            fusion_type: fusionType,
            image_bk: bkResult.filename,
            image_hu: huResult.filename,
            image_mb: mbFilename,
            seed: seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '融合');
    } catch (error) {
        console.error('Image Fusion Error:', error);
        throw error;
    }
};

/**
 * 队列执行：图像融合（带排队）
 */
export const generateImageFusionQueued = async (
    imageBkUrl: string,
    imageHuUrl: string,
    fusionType: 'fusion' | 'transfer' | 'imitation',
    imageMbUrl?: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<string> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await generateImageFusion(imageBkUrl, imageHuUrl, fusionType, imageMbUrl, seed, entityOptions);
        const url = await waitForComfyUITask(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        return url;
    }, `融合(${fusionType})`, registryMeta ? toQueueMeta(registryMeta) : undefined);
};

// ==================== 分镜弹窗 API ====================

/**
 * 360度全景生成
 */
export const generatePanorama360 = async (
    imageDataUrl: string,
    prompt: string = '',
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');
        const uploadResult = await uploadImageToComfyUI(imageDataUrl);

        return await postGenerationTask('/api/generate/panorama-360', {
            image_filename: uploadResult.filename,
            prompt: prompt,
            seed: seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '360度全景生成');
    } catch (error) {
        console.error('Panorama 360 Error:', error);
        throw error;
    }
};

/**
 * 队列执行：360度全景生成（带排队）
 */
export const generatePanorama360Queued = async (
    imageDataUrl: string,
    prompt: string = '',
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<string> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await generatePanorama360(imageDataUrl, prompt, seed, entityOptions);
        const url = await waitForComfyUITask(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        return url;
    }, '360度全景生成', registryMeta ? toQueueMeta(registryMeta) : undefined);
};

/**
 * 全景场景融合
 */
export const generatePanoramaFusion = async (
    image1Url: string,
    image3Url: string,
    prompt: string = '',
    image2Url?: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');

        // 上传图片
        const uploadPromises = [
            uploadImageToComfyUI(image1Url),
            uploadImageToComfyUI(image3Url)
        ];
        if (image2Url) {
            uploadPromises.push(uploadImageToComfyUI(image2Url));
        }

        const results = await Promise.all(uploadPromises);

        return await postGenerationTask('/api/generate/panorama-fusion', {
            image_1: results[0].filename,
            image_3: results[1].filename,
            image_2: image2Url ? results[2].filename : undefined,
            prompt: prompt,
            seed: seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '全景融合');
    } catch (error) {
        console.error('Panorama Fusion Error:', error);
        throw error;
    }
};

/**
 * 队列执行：全景场景融合（带排队）
 */
export const generatePanoramaFusionQueued = async (
    image1Url: string,
    image3Url: string,
    prompt: string = '',
    image2Url?: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<string> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await generatePanoramaFusion(image1Url, image3Url, prompt, image2Url, seed, entityOptions);
        const url = await waitForComfyUITask(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        return url;
    }, '全景融合', registryMeta ? toQueueMeta(registryMeta) : undefined);
};

/**
 * 自动分镜生成
 */
export const generateAutoStoryboard = async (
    imageDataUrl: string,
    prompt: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        const { uploadImageToComfyUI } = await import('./comfyuiBridgeService');
        const uploadResult = await uploadImageToComfyUI(imageDataUrl);

        return await postGenerationTask('/api/generate/auto-storyboard', {
            image_filename: uploadResult.filename,
            prompt: prompt,
            seed: seed,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        }, '自动分镜');
    } catch (error) {
        console.error('Auto Storyboard Error:', error);
        throw error;
    }
};

/**
 * 队列执行：自动分镜（带排队）
 */
export const generateAutoStoryboardQueued = async (
    imageDataUrl: string,
    prompt: string,
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<string> => {
    return enqueueComfyUITask(async (frontendKey) => {
        const { taskId } = await generateAutoStoryboard(imageDataUrl, prompt, seed, entityOptions);
        const url = await waitForComfyUITask(taskId, undefined,
            registryMeta ? { ...registryMeta, frontendKey } : undefined);
        return url;
    }, '自动分镜', registryMeta ? toQueueMeta(registryMeta) : undefined);
};

/**
 * 多宫格分镜生成（调用化神/Gemini图像生成API）
 * 需要传入：提示词 + 一张参考图像
 * @param mode 模式: multi_shot(多镜头分镜) / story(故事分镜)
 * @param userPrompt 用户输入的提示词
 * @param referenceImage 参考图像（Base64格式，必须传入一张）
 */
export const generateMultiGridStoryboard = async (
    mode: 'multi_shot' | 'story',
    userPrompt: string,
    referenceImage: string,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ success: boolean; images?: string[]; prompt?: string; message?: string }> => {
    try {
        if (!referenceImage) {
            throw new Error('必须传入一张参考图像');
        }

        return await apiJson<{ success: boolean; images?: string[]; prompt?: string; message?: string }>('/api/generate/multi-grid-storyboard', {
            method: 'POST',
            body: JSON.stringify({
                mode: mode,
                user_prompt: userPrompt,
                reference_image: referenceImage,
                entity_type: entityOptions?.entityType,
                entity_id: entityOptions?.entityId,
                file_role: entityOptions?.fileRole,
                episode_id: entityOptions?.episodeId,
            })
        }, '多宫格分镜');
    } catch (error) {
        console.error('Multi Grid Storyboard Error:', error);
        throw error;
    }
};
