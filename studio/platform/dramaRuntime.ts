import {
  createCanvasBoard,
  createCanvasNode,
  getCanvasBoardDetail,
  getCanvasBoards,
  updateCanvasNode,
} from '@drama/services/canvasService';
import { assertEnoughCredits, consumeCredits, estimateTextTokens } from '@drama/services/creditService';
import { uploadEntityFile } from '@drama/services/entityFileService';
import { generateGeminiImageVariant } from '@drama/services/geminiImageGenerationService';
import { callGeminiProxyWithRetry } from '@drama/services/geminiProxyService';
import { minimaxTTSSync } from '@drama/services/audioGenerationService';
import { taskRegistry } from '@drama/services/taskRegistry';
import { startVideoPoll } from '@drama/services/videoTaskPoller';
import { submitSeedanceTask } from '@drama/services/videoTaskService';
import { fetchVideoCapabilities } from '@drama/services/videoWorkflowService';
import type { SeedanceMediaInput } from '@drama/services/videoModelService';
import type {
  StudioChatOptions,
  StudioImageOptions,
  StudioRuntime,
  StudioSnapshot,
  StudioVideoOptions,
} from '../services/runtime';
import {
  STUDIO_AUDIO_MODEL_SPEECH_HD,
  STUDIO_IMAGE_MODEL_CONFIGURED,
  STUDIO_TEXT_MODEL_CONFIGURED,
  STUDIO_VIDEO_MODEL_STANDARD,
  normalizeStudioAudioModel,
  normalizeStudioImageModel,
  normalizeStudioVideoModel,
  studioImageModelOverride,
  studioVideoCapabilityKey,
} from '../services/modelOptions';
import type { SmartSequenceItem, VideoGenerationMode } from '../types';

const BOARD_NAME = 'MECHA Studio 自由创作';
const STATE_NODE_TYPE = 'studio_state';
const STUDIO_SCHEMA_VERSION = 1;
const DEFAULT_VOICE_ID = 'male-qn-qingse';
const STUDIO_MODEL_SCOPE = 'studio';

type JsonRecord = Record<string, any>;

export async function chargeSuccessfulResult<T>(
  run: () => Promise<T>,
  charge: (result: T) => Promise<unknown>,
): Promise<T> {
  const result = await run();
  await charge(result);
  return result;
}

export function stripEmbeddedMedia<T>(value: T): T {
  if (typeof value === 'string') {
    return (value.startsWith('data:') ? '' : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => stripEmbeddedMedia(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, item]) => [key, stripEmbeddedMedia(item)]),
    ) as T;
  }
  return value;
}

export function parseStudioSnapshot(value: unknown): StudioSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StudioSnapshot>;
  if (
    candidate.schemaVersion !== STUDIO_SCHEMA_VERSION
    || !Array.isArray(candidate.assets)
    || !Array.isArray(candidate.workflows)
    || !Array.isArray(candidate.nodes)
    || !Array.isArray(candidate.connections)
    || !Array.isArray(candidate.groups)
  ) {
    return null;
  }
  return candidate as StudioSnapshot;
}

export function buildSeedanceMediaInputs(
  generationMode: VideoGenerationMode,
  inputImage?: string | null,
  referenceImages: string[] = [],
): SeedanceMediaInput[] {
  const unique = Array.from(new Set(
    [inputImage, ...referenceImages].filter((value): value is string => Boolean(value?.trim())),
  ));
  if (unique.length === 0) return [];

  if (generationMode === 'FIRST_LAST_FRAME') {
    return unique.map((url, index) => ({
      kind: 'image',
      url,
      role: index === 0 ? 'first_frame' : index === 1 ? 'last_frame' : 'reference_image',
    }));
  }
  if (generationMode === 'CHARACTER_REF') {
    return unique.map(url => ({ kind: 'image', url, role: 'reference_image' }));
  }
  return unique.map((url, index) => ({
    kind: 'image',
    url,
    role: index === 0 ? 'first_frame' : 'reference_image',
  }));
}

export function extractVideoResult(status: any): string {
  const result = status?.result;
  if (typeof result === 'string') return result;
  const firstVideo = Array.isArray(result?.videos) ? result.videos[0] : null;
  return firstVideo?.url || result?.video_url || result?.file_url || result?.url || '';
}

function makeTaskId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `studio-${prefix}:${suffix}`;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function parseJsonArray(text: string): string[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('模型未返回可解析的分镜列表');
  const parsed = JSON.parse(fenced.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('模型返回的分镜格式无效');
  return parsed
    .map(item => typeof item === 'string' ? item.trim() : String(item?.prompt || item?.description || '').trim())
    .filter(Boolean);
}

function studioTaskRegistration(
  taskId: string,
  kind: 'minimax-tts' | 'prompt-rewrite',
  title: string,
  projectId: string,
  episodeId: string,
) {
  taskRegistry.register({
    taskId,
    kind,
    title,
    targetPage: 'canvas',
    initialStatus: 'running',
    targetEntityType: 'episode',
    targetEntityId: episodeId,
    targetProjectId: projectId,
    episodeId,
  });
}

function getBoardId(board: JsonRecord): string {
  return board.board_id || board.boardId || '';
}

function getNodeId(node: JsonRecord): string {
  return node.node_id || node.nodeId || node.id || '';
}

function getNodeType(node: JsonRecord): string {
  return node.node_type || node.nodeType || node.type || '';
}

export function createDramaRuntime(input: {
  projectId: string;
  episodeId: string;
  returnTo: string;
}): StudioRuntime {
  const { projectId, episodeId, returnTo } = input;
  let boardId = '';
  let stateNodeId = '';
  let ensurePromise: Promise<void> | null = null;
  let saveTail: Promise<void> = Promise.resolve();

  const ensureStateNode = async (): Promise<void> => {
    if (boardId && stateNodeId) return;
    if (ensurePromise) return ensurePromise;
    ensurePromise = (async () => {
      const listed = await getCanvasBoards(projectId, episodeId);
      const boards = Array.isArray(listed?.boards) ? listed.boards : [];
      const board = boards.find((item: JsonRecord) => (
        (item.episode_id || item.episodeId) === episodeId
        && item.name === BOARD_NAME
      )) || boards.find((item: JsonRecord) => (item.episode_id || item.episodeId) === episodeId);

      if (board) {
        boardId = getBoardId(board);
      } else {
        const created = await createCanvasBoard(projectId, BOARD_NAME, '按分集隔离的自由创作工作区', episodeId);
        boardId = getBoardId(created?.board || {});
      }
      if (!boardId) throw new Error('自由创作画布创建失败');

      const detail = await getCanvasBoardDetail(boardId);
      const nodes = Array.isArray(detail?.nodes) ? detail.nodes : [];
      const stateNode = nodes.find((node: JsonRecord) => getNodeType(node) === STATE_NODE_TYPE);
      if (stateNode) {
        stateNodeId = getNodeId(stateNode);
      } else {
        const createdNode = await createCanvasNode(boardId, STATE_NODE_TYPE, 0, 0, {
          studio_schema_version: STUDIO_SCHEMA_VERSION,
          snapshot: null,
        });
        stateNodeId = getNodeId(createdNode?.node || {});
      }
      if (!stateNodeId) throw new Error('自由创作状态节点创建失败');
    })().finally(() => {
      ensurePromise = null;
    });
    return ensurePromise;
  };

  const loadSnapshot = async (): Promise<StudioSnapshot | null> => {
    await ensureStateNode();
    const detail = await getCanvasBoardDetail(boardId);
    const stateNode = (Array.isArray(detail?.nodes) ? detail.nodes : [])
      .find((node: JsonRecord) => getNodeId(node) === stateNodeId);
    let data = stateNode?.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }
    return parseStudioSnapshot(data?.snapshot);
  };

  const saveSnapshot = (snapshot: StudioSnapshot): Promise<void> => {
    const serializableSnapshot = stripEmbeddedMedia(snapshot);
    const nextSave = saveTail
      .catch(() => undefined)
      .then(async () => {
        await ensureStateNode();
        await updateCanvasNode(stateNodeId, {
          data: {
            studio_schema_version: STUDIO_SCHEMA_VERSION,
            snapshot: serializableSnapshot,
          },
        });
      });
    saveTail = nextSave;
    return nextSave;
  };

  const uploadAsset = async (file: File, _nodeId?: string): Promise<string> => {
    const role = file.type.startsWith('image/')
      ? 'studio_reference'
      : file.type.startsWith('video/')
        ? 'studio_video'
        : file.type.startsWith('audio/')
          ? 'studio_audio'
          : 'studio_reference';
    const uploaded = await uploadEntityFile(file, 'episode', episodeId, role, episodeId);
    if (!uploaded.fileUrl) throw new Error('文件上传成功，但未返回访问地址');
    return uploaded.fileUrl;
  };

  const uploadDataUrl = async (dataUrl: string, fileName: string, nodeId?: string): Promise<string> => {
    if (!dataUrl.startsWith('data:')) return dataUrl;
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return uploadAsset(new File([blob], fileName, { type: blob.type || 'application/octet-stream' }), nodeId);
  };

  const normalizeMediaUrl = async (url: string, index: number): Promise<string> => (
    url.startsWith('data:') ? uploadDataUrl(url, `studio-reference-${index}.png`) : url
  );

  const runText = async (
    prompt: string,
    systemPrompt: string,
    displayName: string,
  ): Promise<string> => {
    const taskId = makeTaskId('text');
    const creditParams = {
      input_tokens: estimateTextTokens(`${systemPrompt}\n${prompt}`),
      output_tokens: 1200,
      model: STUDIO_TEXT_MODEL_CONFIGURED,
    };
    await assertEnoughCredits('prompt_optimize', creditParams);
    studioTaskRegistration(taskId, 'prompt-rewrite', displayName, projectId, episodeId);
    try {
      const content = await chargeSuccessfulResult(
        async () => {
          const result = await callGeminiProxyWithRetry(prompt, systemPrompt, 3, undefined, {
            operation: 'studio_free_creation',
            displayName,
            projectId,
            episodeId,
            sourcePage: 'canvas',
            entityType: 'episode',
            entityId: episodeId,
            modelScope: STUDIO_MODEL_SCOPE,
            suppressNotification: true,
          });
          if (!result.trim()) throw new Error('模型未返回内容');
          return result;
        },
        () => consumeCredits({
          featureKey: 'prompt_optimize',
          taskId,
          params: creditParams,
          projectId,
          metadata: { episode_id: episodeId, source_page: 'canvas' },
        }),
      );
      taskRegistry.complete(taskId);
      return content;
    } catch (error) {
      taskRegistry.fail(taskId, normalizeError(error));
      throw error;
    }
  };

  const generateImage = async (
    prompt: string,
    model: string,
    references: string[] = [],
    options: StudioImageOptions = {},
  ): Promise<string[]> => {
    const count = Math.max(1, Math.min(4, Math.round(options.count || 1)));
    const normalizedModel = normalizeStudioImageModel(model);
    const modelOverride = studioImageModelOverride(normalizedModel);
    const taskId = makeTaskId('image');
    const creditParams = {
      image_count: count,
      model: modelOverride || STUDIO_IMAGE_MODEL_CONFIGURED,
      resolution: options.resolution || '2K',
      aspect_ratio: options.aspectRatio || '1:1',
    };
    await assertEnoughCredits('image_generation', creditParams);
    try {
      const urls = await chargeSuccessfulResult(
        async () => {
          const normalizedReferences = await Promise.all(
            references.map((url, index) => normalizeMediaUrl(url, index)),
          );
          const generatedUrls: string[] = [];
          for (let index = 0; index < count; index += 1) {
            const results = await generateGeminiImageVariant({
              ...(modelOverride ? { model: modelOverride } : {}),
              modelScope: STUDIO_MODEL_SCOPE,
              prompt,
              references: normalizedReferences,
              aspectRatio: options.aspectRatio || '1:1',
              imageSize: options.resolution === '4K' ? '4K' : options.resolution === '1K' ? '1K' : '2K',
              entityType: 'episode',
              entityId: episodeId,
              fileRole: 'studio_image',
              projectId,
              episodeId,
            });
            const url = results[0]?.fileUrl || results[0]?.url;
            if (url) generatedUrls.push(url);
          }
          if (generatedUrls.length === 0) throw new Error('图片生成接口未返回图片地址');
          return generatedUrls;
        },
        generatedUrls => consumeCredits({
          featureKey: 'image_generation',
          taskId,
          params: { ...creditParams, image_count: generatedUrls.length },
          projectId,
          metadata: { episode_id: episodeId, source_page: 'canvas' },
        }),
      );
      return urls;
    } catch (error) {
      throw error;
    }
  };

  const generateVideo = async (
    prompt: string,
    model: string,
    options: StudioVideoOptions = {},
  ) => {
    const capabilities = await fetchVideoCapabilities(STUDIO_MODEL_SCOPE);
    const normalizedModel = normalizeStudioVideoModel(model);
    const wantedModelKey = studioVideoCapabilityKey(normalizedModel);
    const wantedSubModel = normalizedModel === STUDIO_VIDEO_MODEL_STANDARD ? 'standard' : 'fast';
    const seedanceCapability = capabilities.models.find(item => item.key === wantedModelKey);
    if (capabilities.models.length > 0 && seedanceCapability?.available === false) {
      throw new Error('当前 Seedance 模型不可用，请联系管理员检查运行时模型配置');
    }

    const rawReferences = options.referenceImages || [];
    const rawMedia = buildSeedanceMediaInputs(
      options.generationMode || 'DEFAULT',
      options.inputImage,
      rawReferences,
    );
    const mediaInputs = await Promise.all(rawMedia.map(async (item, index) => ({
      ...item,
      url: await normalizeMediaUrl(item.url, index),
    })));
    if (!capabilities.seedance_omni && mediaInputs.some(item => item.role === 'reference_image')) {
      throw new Error('当前 Seedance 运行时模型不支持多参考图，请联系管理员启用 Seedance 2.0');
    }
    const duration = Math.max(2, Math.min(15, Math.round(options.duration || 5)));
    const count = Math.max(1, Math.min(4, Math.round(options.count || 1)));
    const creditParams = {
      video_count: count,
      model: wantedSubModel,
      duration,
      resolution: '720p',
    };
    await assertEnoughCredits('video_generation', creditParams);

    const urls: string[] = [];
    let lastTaskId = '';
    for (let index = 0; index < count; index += 1) {
      const submitted = await submitSeedanceTask({
        sub_model: wantedSubModel,
        model_scope: STUDIO_MODEL_SCOPE,
        prompt,
        media_inputs: mediaInputs,
        resolution: '720p',
        ratio: (options.aspectRatio || 'adaptive') as any,
        duration,
        generate_audio: true,
      }, {
        entity_type: 'episode',
        entity_id: episodeId,
        file_role: 'studio_video',
        project_id: projectId,
        episode_id: episodeId,
      });
      lastTaskId = submitted.task_id;
      if (!lastTaskId) throw new Error('视频生成接口未返回 task_id');

      const resultUrl = await chargeSuccessfulResult(
        () => new Promise<string>((resolve, reject) => {
          startVideoPoll(`studio-video:${lastTaskId}`, {
            taskId: lastTaskId,
            title: '自由创作视频生成',
            kind: wantedSubModel === 'fast' ? 'seedance-fast' : 'seedance',
            targetPage: 'canvas',
            targetEntityType: 'episode',
            targetEntityId: episodeId,
            episodeId,
            projectId,
            callbacks: {
              onComplete: ({ status }) => {
                const url = extractVideoResult(status);
                if (!url) {
                  reject(new Error('视频任务已完成，但后端未返回视频地址'));
                  return;
                }
                resolve(url);
              },
              onFail: error => reject(new Error(error)),
            },
          });
        }),
        () => consumeCredits({
          featureKey: 'video_generation',
          taskId: lastTaskId,
          params: { ...creditParams, video_count: 1 },
          projectId,
          metadata: { episode_id: episodeId, source_page: 'canvas' },
        }),
      );
      urls.push(resultUrl);
    }

    return { uri: urls[0], uris: urls, taskId: lastTaskId };
  };

  const generateAudio = async (
    text: string,
    options: { nodeId?: string; voiceId?: string; emotion?: string } = {},
  ): Promise<string> => {
    const taskId = makeTaskId('audio');
    const audioModel = normalizeStudioAudioModel(STUDIO_AUDIO_MODEL_SPEECH_HD);
    const creditParams = {
      character_count: text.length,
      model: audioModel,
    };
    await assertEnoughCredits('audio_generation_tts', creditParams);
    studioTaskRegistration(taskId, 'minimax-tts', '自由创作语音合成', projectId, episodeId);
    try {
      const url = await chargeSuccessfulResult(
        async () => {
          const result = await minimaxTTSSync({
            text,
            voice_id: options.voiceId || DEFAULT_VOICE_ID,
            model: audioModel,
            model_scope: STUDIO_MODEL_SCOPE,
            emotion: options.emotion,
            entity_type: 'episode',
            entity_id: episodeId,
            file_role: 'studio_audio',
            project_id: projectId,
            episode_id: episodeId,
          });
          const generatedUrl = result.file_url || result.audio_url;
          if (!generatedUrl) throw new Error('语音生成接口未返回音频地址');
          return generatedUrl;
        },
        () => consumeCredits({
          featureKey: 'audio_generation_tts',
          taskId,
          params: creditParams,
          projectId,
          metadata: { episode_id: episodeId, source_page: 'canvas' },
        }),
      );
      taskRegistry.complete(taskId, { resultUrls: [url] });
      return url;
    } catch (error) {
      taskRegistry.fail(taskId, normalizeError(error));
      throw error;
    }
  };

  const sendChatMessage = async (
    history: Array<{ role: string; parts: Array<{ text: string }> }>,
    message: string,
    options: StudioChatOptions = {},
  ): Promise<string> => {
    const conversation = history
      .slice(-12)
      .map(item => `${item.role === 'user' ? '用户' : '助手'}：${item.parts.map(part => part.text).join('')}`)
      .join('\n');
    const mode = options.isStoryboard
      ? '你是影视分镜顾问，给出清晰、可执行的镜头建议。'
      : options.isHelpMeWrite
        ? '你是影视创意写作助手，帮助扩写并保留用户意图。'
        : '你是 MECHA 自由创作助手，回答应简洁、专业并能直接用于内容制作。';
    return runText(`${conversation}\n用户：${message}`.trim(), mode, '自由创作 AI 助手');
  };

  const planStoryboard = async (prompt: string, context: string): Promise<string[]> => {
    const result = await runText(
      `创作需求：${prompt}\n补充上下文：${context}\n请只返回 JSON 字符串数组，每个元素是一条独立镜头提示词。`,
      '你是影视分镜规划师。将需求拆成 3-8 个连续镜头，确保人物、场景与动作一致。',
      '自由创作分镜规划',
    );
    return parseJsonArray(result);
  };

  const orchestrateVideoPrompt = async (images: string[], prompt: string): Promise<string> => (
    runText(
      `已有 ${images.length} 张按顺序排列的参考图。用户视频要求：${prompt}`,
      '你是视频提示词导演。输出一段连续、具体的中文视频生成提示词，描述镜头运动、主体动作和首尾衔接。',
      '自由创作视频提示词编排',
    )
  );

  const compileMultiFramePrompt = (frames: SmartSequenceItem[]): string => frames
    .map((frame, index) => (
      `镜头 ${index + 1}${index < frames.length - 1
        ? `，向下一镜头过渡 ${frame.transition.duration} 秒：${frame.transition.prompt || '自然连续过渡'}`
        : '，作为结尾画面'}`
    ))
    .join('；');

  return {
    projectId,
    episodeId,
    returnTo,
    loadSnapshot,
    saveSnapshot,
    uploadAsset,
    uploadDataUrl,
    sendChatMessage,
    generateImage,
    generateVideo,
    generateAudio,
    planStoryboard,
    orchestrateVideoPrompt,
    editImage: async (image, prompt, model, nodeId) => {
      const [url] = await generateImage(prompt, model, [image], { count: 1, nodeId });
      return url;
    },
    compileMultiFramePrompt,
  };
}
