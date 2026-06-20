
import { StoryboardData, RestructureResponse, StoryboardItem, SourcePage, TaskKind } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { generateGeminiImageViaProxy, GeminiImageOptions, GeneratedFileResult } from './geminiImageService';
import { callGeminiProxyWithRetry } from './geminiProxyService';
import { enqueueComfyUITask, getComfyUIQueueStatus } from './comfyuiTaskQueue';
// 2026-05-20 (Task System Overhaul M3)：所有 ComfyUI 等待函数都把任务同步到全局
// taskRegistry，让铃铛 / TaskBadge / 跨页通知都能感知。
import { taskRegistry } from './taskRegistry';
import { apiJson } from './httpClient';

/**
 * 2026-05-20 (M3)：传给 wait*ComfyUITask 系列的 registry meta。
 * 调用方按需提供，缺省也能跑（向后兼容旧调用）。
 */
export interface ComfyUITaskRegistryMeta {
    /** 用户可读标题，例如 "画面分镜 · 镜头3" */
    title: string;
    /** 任务种类（图标 + 显示名） */
    kind: TaskKind;
    /** 完成后跳转目的页（默认 'generation'） */
    targetPage?: SourcePage;
    /** 业务实体 id（通常 = storyboardItemId / assetId） */
    targetEntityId?: string;
    /** 业务实体类型 */
    targetEntityType?: string;
    /** 项目 id（铃铛点击跳转时拼 URL 用） */
    targetProjectId?: string;
    /** 剧集 id */
    episodeId?: string;
    /** 文件角色（'generated_image' | 'narration_audio' | ...） */
    fileRole?: string;
    /** targetItemId（默认与 targetEntityId 相同） */
    targetItemId?: string;
    /**
     * 2026-05-20 (M6)：可选 — comfyuiTaskQueue 注入的前端排队 key。
     * 传入则 wait 函数把它作为 RegisteredTask.taskId（而非 backend taskId），
     * 这样排队期与执行期共享同一条 RegisteredTask（无闪烁，前面 N 个 → 进行中 X% 是流畅的同一条）。
     * 没传则回退用 backend taskId（兼容老 API）。
     */
    frontendKey?: string;
}

/**
 * 2026-05-20 (M6)：把 ComfyUITaskRegistryMeta 转成 ComfyQueueRegistryMeta（队列侧用）。
 * 主要差异：targetPage 在 queue 侧必需，registryMeta 侧可选 → fallback 到 'generation'。
 */
function toQueueMeta(m: ComfyUITaskRegistryMeta): import('./comfyuiTaskQueue').ComfyQueueRegistryMeta {
    return {
        title: m.title,
        kind: m.kind,
        targetPage: m.targetPage ?? 'generation',
        targetEntityType: m.targetEntityType,
        targetEntityId: m.targetEntityId,
        targetItemId: m.targetItemId ?? m.targetEntityId,
        targetProjectId: m.targetProjectId,
        episodeId: m.episodeId,
        fileRole: m.fileRole,
    };
}

// 重新导出队列状态查询函数（保持向后兼容）
export { getComfyUIQueueStatus };

// 🔧 文本生成模型（用于剧本、分镜等）
const MODEL_TEXT = 'gemini-2.5-flash';
const MODEL_LOGIC = 'gemini-2.5-flash'; 

// 🎨 图像生成模型（Gemini图像模型）
const MODEL_IMAGE_FLASH = 'gemini-2.5-flash-image';            // Nano Banana Standard - 仅 1K
// 2026-05-21: nano3 → nano2 in-place 替换
// 旧：gemini-3-pro-image-preview（nano3，慢，贵）
// 新：gemini-3.1-flash-image-preview（nano2 Flash，快，支持 1K/2K/4K + 全部比例）
// 前端继续用 'nanobanana' / MODEL_IMAGE_NANO2 这两个名字，后端别名映射仍兜底旧值。
const MODEL_IMAGE_NANO2 = 'gemini-3.1-flash-image-preview';    // 化神 - 主力生图模型
const MODEL_IMAGE_PRO = MODEL_IMAGE_NANO2;                     // @deprecated 旧名兼容，现指向 nano2
const MODEL_IMAGE = MODEL_IMAGE_NANO2;                         // 默认使用 nano2

const stripJsonFences = (value: string): string => {
    return (value || '')
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();
};

const parseJsonFromGemini = <T>(value: string): T => {
    const clean = stripJsonFences(value);
    const objectMatch = clean.match(/\{[\s\S]*\}/);
    const arrayMatch = clean.match(/\[[\s\S]*\]/);
    const json = objectMatch?.[0] || arrayMatch?.[0] || clean;
    return JSON.parse(json) as T;
};

type GenerationTaskResponse = { task_id: string };

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

export const callGeminiText = async (
    prompt: string,
    systemPrompt?: string,
    model: string = MODEL_TEXT,
): Promise<string> => {
    return callGeminiProxyWithRetry(prompt, systemPrompt, 3, model);
};

const callGeminiJson = async <T>(
    prompt: string,
    systemPrompt?: string,
    model: string = MODEL_LOGIC,
): Promise<T> => {
    const response = await callGeminiText(prompt, systemPrompt, model);
    return parseJsonFromGemini<T>(response);
};

/**
 * 图像生成（使用中转站API）
 * 注意：GeminiImageOptions类型已在geminiImageService.ts中定义
 */
export const generateGeminiImageVariant = async (options: GeminiImageOptions): Promise<GeneratedFileResult[]> => {
    return generateGeminiImageViaProxy(options);
};

// Helper for retrying 503 errors
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

export const rewriteNovelToScript = async (text: string): Promise<string> => {
  return callWithRetry(async () => {
      try {
        const prompt = `
          你是一位专业的动画编剧。
          请将以下小说/文本内容改写成符合行业标准的动画剧本格式。

          要求：
          1. 准确识别场景（Scene）、角色（Character）、对话（Dialogue）和动作（Action）。
          2. 使用标准的剧本格式（场景标题加粗，角色名居中，对话清晰，包含必要的括弧指导）。
          3. 增加适合动画制作的视觉描述（画面感）。
          4. 保持原著的语气和情节，但要适应视听语言。
          5. **必须使用中文输出剧本内容**。
          
          输入文本:
          ${text}
        `;

        return await callGeminiText(prompt, "你是一个专业的中文动画编剧助手。", MODEL_TEXT);
      } catch (error) {
        console.error("Rewrite Error:", error);
        throw new Error("Failed to rewrite script.");
      }
  });
};

export const extractScriptMetadata = async (scriptText: string): Promise<{ characters: string[], scenes: string[] }> => {
  return callWithRetry(async () => {
    try {
        const prompt = `
          Analyze the following script and extract:
          1. A list of all unique **Characters** (names).
          2. A list of all unique **Scene Locations** (headings).
          
          Script Content:
          ${scriptText}
        `;

        return await callGeminiJson<{ characters: string[], scenes: string[] }>(prompt, undefined, MODEL_LOGIC);

    } catch (error) {
        console.error("Extraction Error:", error);
        return { characters: [], scenes: [] };
    }
  });
};

export const generateStoryboards = async (scriptText: string): Promise<StoryboardData> => {
  return callWithRetry(async () => {
    try {
        const prompt = `
          请分析以下中文动画剧本，将其拆解为一系列关键镜头（Shot）。
          
          对于每一个镜头，请生成：
          1. **originalText**: 对应的原文段落（从剧本中直接复制，用于高亮匹配，**必须完全匹配原文**）。
          2. **scriptSegment**: AI提炼的场景描述（简洁的场景和动作描述，用于图像生成）。
          3. **imagePrompt**: 用于AI生图（如Midjourney）的**中文**提示词。详细描述构图、光影、风格、角色和背景。
          4. **videoPrompt**: 用于AI视频生成（如Runway）的**中文**提示词。详细描述运镜和动作。
          5. **dialogue**: 该镜头中的人物台词（如果没有台词则留空）。
          6. **characters**: 该镜头中出现的角色名字列表。
          7. **scene**: 该镜头所在的场景地点。

          重要：originalText 必须是剧本中的原始文本段落，scriptSegment 是你提炼的场景描述。

          Script Content:
          ${scriptText}
        `;

        const data = await callGeminiJson<any>(prompt, undefined, MODEL_LOGIC);
        const items = (data.items || []).map((item: any) => ({
          ...item,
          id: uuidv4()
        }));
        return { items };

    } catch (error) {
        console.error("Storyboard Error:", error);
        throw new Error("Failed to generate storyboards.");
    }
  });
};

export const regenerateSingleShot = async (scriptSegment: string, instruction?: string): Promise<Omit<StoryboardItem, 'id'>> => {
    return callWithRetry(async () => {
        try {
            const prompt = `
              请根据以下剧本片段，重新生成分镜描述信息。
              ${instruction ? `\n用户的具体修改要求: "${instruction}"\n请根据该要求调整提示词。\n` : ''}

              剧本片段: "${scriptSegment}"

              请返回 JSON 包含 imagePrompt, videoPrompt, dialogue, characters, scene。
            `;

            const data = await callGeminiJson<any>(prompt, undefined, MODEL_LOGIC);
            return {
                scriptSegment: scriptSegment,
                ...data
            };

        } catch (error) {
            console.error("Regenerate Shot Error:", error);
            throw new Error("Failed to regenerate single shot.");
        }
    });
};

export const refineScriptSegment = async (originalSegment: string, instruction: string, fullContext: string): Promise<string> => {
  return callWithRetry(async () => {
    try {
        const prompt = `
          你是一个专业的剧本润色助手。
          请根据用户的要求，修改或重写以下选中的剧本片段。
          
          用户要求: ${instruction}
          
          选中片段:
          "${originalSegment}"
          
          (上下文):
          ${fullContext.slice(0, 500)}...
          
          **只输出修改后的文本内容，不要包含任何解释或Markdown标记。**
        `;

        return await callGeminiText(prompt, undefined, MODEL_TEXT) || originalSegment;
    } catch (error) {
        console.error("Refine Error:", error);
        throw new Error("Failed to refine script.");
    }
  });
};

export const restructureShot = async (
    selection: string, 
    instruction: string, 
    operation: 'split' | 'merge'
): Promise<RestructureResponse> => {
    return callWithRetry(async () => {
        try {
            const isSplit = operation === 'split';
            const prompt = `
                用户希望对一段中文动画剧本进行"${isSplit ? '拆分 (Split)' : '合并 (Merge)'}"操作。
                这是一个精确的编剧任务。

                **输入信息**:
                选中剧本片段: "${selection}"
                用户指令: "${instruction}"

                **规则**:
                1. **${isSplit ? '拆分 (Split)' : '合并 (Merge)'}**:
                   ${isSplit 
                      ? '用户希望把这段剧情拆解成多个镜头。**非常重要：不要修改或重写剧本原文文字**。newScriptSegment 必须与输入的选中片段完全一致。你需要做的是将这段文字在逻辑上拆分成多个画面描述。' 
                      : '用户希望把多段剧情合并为一个镜头。你需要将剧本文字进行必要的融合或精简，使其成为一段连贯的描述。'
                   }

                2. **生成分镜 (Storyboards)**:
                   - ${isSplit ? '必须生成 **多个 (>1)** 分镜项。' : '必须生成 **1个** 分镜项。'}
                   - 每个分镜项的 "scriptSegment" 字段：
                     ${isSplit 
                        ? '如果是拆分：请直接引用原文中的子句或整句。如果一个镜头涵盖整句，就用整句。确保所有分镜的scriptSegment组合起来能覆盖原文意思。' 
                        : '如果是合并：引用重写后的 newScriptSegment。'
                     }

                **返回格式 (JSON)**:
                {
                    "newScriptSegment": "${isSplit ? '必须返回原封不动的选中片段' : '重写后的剧本段落'}",
                    "newStoryboardItems": [
                        {
                            "scriptSegment": "引用文本",
                            "imagePrompt": "中文画面提示词",
                            "videoPrompt": "中文视频提示词",
                            "dialogue": "台词",
                            "characters": ["角色名"],
                            "scene": "场景名"
                        }
                    ]
                }
            `;

            return await callGeminiJson<RestructureResponse>(prompt, undefined, MODEL_LOGIC);

        } catch (error) {
            console.error("Restructure Error:", error);
            throw new Error("Failed to restructure shot.");
        }
    });
}

// Generate an image for a material (Character/Scene)
export const generateMaterialImage = async (name: string, type: 'character' | 'scene', context: string): Promise<string> => {
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

/**
 * 化神(nano2)生成最终插图。
 * 
 * 2026-05-21：从写死 model/aspectRatio/imageSize 改为接受可选参数，
 * 这样 GenerationPage 的"化神参数面板"可以把用户选择的比例 + 1K/2K/4K 透传下来。
 * 缺省仍保留历史默认（16:9 + 2K + nano2），向后兼容旧调用站。
 */
export const generateFinalIllustration = async (
    prompt: string,
    referenceImages: string[],
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
    imageOptions?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K' }
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
        const { uploadImageToComfyUI } = await import('./apiService');
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
        const { uploadImageToComfyUI } = await import('./apiService');
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
        const { uploadImageToComfyUI } = await import('./apiService');
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
    workflowType: 'qwen' | 'qwen_lora' | 'kontext' | 'qwenN',
    prompt: string,
    mainImage: string,
    refImages: string[] = [],
    seed: number = -1,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{ taskId: string; status: string }> => {
    try {
        const { uploadImageToComfyUI } = await import('./apiService');
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
            episode_id: entityOptions?.episodeId,
        }, `${workflowType}工作流生成`);
    } catch (error) {
        console.error(`${workflowType} Generation Error:`, error);
        throw error;
    }
};

/**
 * 查询ComfyUI任务状态
 * @param taskId 任务ID
 * @returns 任务状态和结果
 */
export const checkComfyUITaskStatus = async (taskId: string): Promise<{
    status: string;
    progress: number;
    result?: any;
    error?: string;
}> => {
    try {
        const data = await apiJson<any>(
            `/api/task/${taskId}`,
            { method: 'GET' },
            '查询任务状态',
            { authErrorMessage: '未登录' }
        );
        // 🔧 调试：打印完整的任务状态数据
        if (data.status === 'completed') {
            console.log(`📊 任务 ${taskId} 完成，完整结果:`, JSON.stringify(data.result, null, 2));
        }
        return {
            status: data.status,
            progress: data.progress || 0,
            result: data.result,
            error: data.error
        };
    } catch (error) {
        console.error('Check Task Status Error:', error);
        throw error;
    }
};

/**
 * 轮询等待ComfyUI任务完成
 * @param taskId 任务ID
 * @param onProgress 进度回调
 * @param registryMeta 2026-05-20 (M3)：可选 — 传入后会自动接入 taskRegistry，
 *                    UI 铃铛/徽章/跨页通知能看到这个任务
 * @returns 最终生成的图像URL
 */
export const waitForComfyUITask = async (
    taskId: string,
    onProgress?: (progress: number) => void,
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<string> => {
    // 2026-05-20 (M6)：优先用 frontendKey 作 RegisteredTask.taskId（与排队期共用同一条 task），
    // 没传则回退到 backend taskId（兼容老调用方）。后端轮询 API 始终用 backend taskId。
    const registryKey = registryMeta?.frontendKey || taskId;
    if (registryMeta) {
        try {
            taskRegistry.register({
                taskId: registryKey,
                kind: registryMeta.kind,
                title: registryMeta.title,
                targetPage: registryMeta.targetPage ?? 'generation',
                initialStatus: 'running',
                progress: 0,
                queuePosition: undefined,
                targetEntityType: registryMeta.targetEntityType,
                targetEntityId: registryMeta.targetEntityId,
                targetItemId: registryMeta.targetItemId ?? registryMeta.targetEntityId,
                targetProjectId: registryMeta.targetProjectId,
                episodeId: registryMeta.episodeId,
                fileRole: registryMeta.fileRole,
            });
        } catch { /* registry 失败不阻断业务 */ }
    }
    return new Promise((resolve, reject) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const finish = (cb: () => void) => {
            clearInterval(pollInterval);
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            cb();
        };
        const pollInterval = setInterval(async () => {
            try {
                const status = await checkComfyUITaskStatus(taskId);
                
                if (onProgress && status.progress) {
                    onProgress(status.progress);
                }
                if (registryMeta && status.progress != null) {
                    const normalized = status.progress > 1 ? status.progress / 100 : status.progress;
                    try { taskRegistry.update(registryKey, { status: 'running', progress: normalized }); } catch { /* noop */ }
                }

                if (status.status === 'completed') {
                    const url = status.result?.videos?.[0]?.url || status.result?.images?.[0]?.url;
                    if (!url) {
                        if (registryMeta) { try { taskRegistry.fail(registryKey, '未找到生成结果'); } catch { /* noop */ } }
                        finish(() => reject(new Error('未找到生成结果')));
                        return;
                    }
                    if (registryMeta) {
                        try { taskRegistry.complete(registryKey, { resultUrls: [url], progress: 1 }); } catch { /* noop */ }
                    }
                    finish(() => resolve(url));
                } else if (status.status === 'failed') {
                    if (registryMeta) { try { taskRegistry.fail(registryKey, status.error || '生成失败'); } catch { /* noop */ } }
                    finish(() => reject(new Error(status.error || '生成失败')));
                }
            } catch (error: any) {
                if (registryMeta) { try { taskRegistry.fail(registryKey, error?.message || '生成失败'); } catch { /* noop */ } }
                finish(() => reject(error));
            }
        }, 2000); // 每2秒查询一次

        // 超时处理（5分钟）
        timeoutHandle = setTimeout(() => {
            clearInterval(pollInterval);
            if (registryMeta) { try { taskRegistry.fail(registryKey, '任务超时'); } catch { /* noop */ } }
            reject(new Error('任务超时'));
        }, 300000);
    });
};

export interface GeneratedImageResult {
  url: string;
  fileId: string | null;
}

/**
 * 轮询等待ComfyUI任务完成（返回所有生成的图片）
 * @param taskId 任务ID
 * @param onProgress 进度回调
 * @param registryMeta 2026-05-20 (M3)：可选 — 接入 taskRegistry
 * @returns 所有生成的图像URL数组
 */
export const waitForComfyUITaskAllImages = async (
    taskId: string,
    onProgress?: (progress: number) => void,
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<GeneratedImageResult[]> => {
    // 2026-05-20 (M6)：与 waitForComfyUITask 同思路 — frontendKey 优先
    const registryKey = registryMeta?.frontendKey || taskId;
    if (registryMeta) {
        try {
            taskRegistry.register({
                taskId: registryKey,
                kind: registryMeta.kind,
                title: registryMeta.title,
                targetPage: registryMeta.targetPage ?? 'generation',
                initialStatus: 'running',
                progress: 0,
                queuePosition: undefined,
                targetEntityType: registryMeta.targetEntityType,
                targetEntityId: registryMeta.targetEntityId,
                targetItemId: registryMeta.targetItemId ?? registryMeta.targetEntityId,
                targetProjectId: registryMeta.targetProjectId,
                episodeId: registryMeta.episodeId,
                fileRole: registryMeta.fileRole,
            });
        } catch { /* noop */ }
    }
    return new Promise((resolve, reject) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const finish = (cb: () => void) => {
            clearInterval(pollInterval);
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            cb();
        };
        const pollInterval = setInterval(async () => {
            try {
                const status = await checkComfyUITaskStatus(taskId);
                
                if (onProgress && status.progress) {
                    onProgress(status.progress);
                }
                if (registryMeta && status.progress != null) {
                    const normalized = status.progress > 1 ? status.progress / 100 : status.progress;
                    try { taskRegistry.update(registryKey, { status: 'running', progress: normalized }); } catch { /* noop */ }
                }

                if (status.status === 'completed') {
                    // 提取所有图片 URL 与 fileId
                    const images = status.result?.images || [];
                    console.log(`📦 获取到 ${images.length} 张图片:`, images);
                    const results: GeneratedImageResult[] = images
                      .filter((img: any) => img.url)
                      .map((img: any) => ({
                        url: img.url,
                        fileId: img.file_id || null,
                      }));
                    console.log(`🔗 提取的结果 (${results.length}张):`, results);
                    
                    if (results.length === 0) {
                        if (registryMeta) { try { taskRegistry.fail(registryKey, '未找到生成结果'); } catch { /* noop */ } }
                        finish(() => reject(new Error('未找到生成结果')));
                        return;
                    }
                    
                    if (registryMeta) {
                        try { taskRegistry.complete(registryKey, { resultUrls: results.map(r => r.url), progress: 1 }); } catch { /* noop */ }
                    }
                    finish(() => resolve(results));
                } else if (status.status === 'failed') {
                    if (registryMeta) { try { taskRegistry.fail(registryKey, status.error || '生成失败'); } catch { /* noop */ } }
                    finish(() => reject(new Error(status.error || '生成失败')));
                }
            } catch (error: any) {
                if (registryMeta) { try { taskRegistry.fail(registryKey, error?.message || '生成失败'); } catch { /* noop */ } }
                finish(() => reject(error));
            }
        }, 2000); // 每2秒查询一次

        // 超时处理（5分钟）
        timeoutHandle = setTimeout(() => {
            clearInterval(pollInterval);
            if (registryMeta) { try { taskRegistry.fail(registryKey, '任务超时'); } catch { /* noop */ } }
            reject(new Error('任务超时'));
        }, 300000);
    });
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
        const { uploadImageToComfyUI, processMaterial } = await import('./apiService');
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
    workflowType: 'qwen' | 'qwen_lora' | 'kontext' | 'qwenN',
    prompt: string,
    mainImage: string,
    refImages: string[] = [],
    seed: number = -1,
    onTaskId?: (taskId: string) => void,
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string },
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
        const { uploadImageToComfyUI } = await import('./apiService');
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
        const { uploadImageToComfyUI } = await import('./apiService');
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
        const { uploadImageToComfyUI } = await import('./apiService');
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
        const { uploadImageToComfyUI } = await import('./apiService');
        
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
        const { uploadImageToComfyUI } = await import('./apiService');
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
