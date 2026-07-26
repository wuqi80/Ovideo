/**
 * AI模型服务 - 业务层
 * 
 * 这个文件提供业务相关的AI功能封装
 * 使用新的提示词配置系统，不再硬编码提示词
 */

import { AiModel } from '../types';
import { callAI, callAIForJSON } from './aiService';
import * as PROMPTS from '../prompts';
import type { ScriptSegment, ExtractedStoryboardPrompt } from '../types';
import { parseScriptSegments, parseStoryboardPromptExtractions } from '../utils/scriptPipelineParsers';
import { normalizeScriptIterationResult } from '../utils/scriptIteration';
import type { TextTaskContext } from './textTaskContext';

/**
 * 改写小说为剧本
 */
export const aiRewriteNovelToScript = async (
  model: AiModel,
  novelText: string,
  userRequirements: string = '',
  onStream?: (chunk: string) => void
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.REWRITE_NOVEL_TO_SCRIPT,
    { 
      novelText,
      userRequirements: userRequirements ? `**用户要求：**\n${userRequirements}` : ''
    },
    onStream
  );
};

/**
 * 生成完整分镜（旧版，保留兼容性）
 */
export const aiGenerateStoryboards = async (
  model: AiModel,
  scriptContent: string
): Promise<any> => {
  return await callAIForJSON(
    model,
    PROMPTS.GENERATE_STORYBOARDS,
    { scriptContent }
  );
};

/**
 * 提取剧本元数据（角色、场景、道具）
 */
export const aiExtractScriptMetadata = async (
  model: AiModel,
  scriptContent: string
): Promise<{ characters: string[]; scenes: string[]; props: string[] }> => {
  return await callAIForJSON(
    model,
    PROMPTS.EXTRACT_SCRIPT_METADATA,
    { scriptContent }
  );
};

/**
 * 润色剧本片段
 */
export const aiRefineScriptSegment = async (
  model: AiModel,
  selection: string,
  instruction: string,
  context: string
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.REFINE_SCRIPT_SEGMENT,
    { selection, instruction, context }
  );
};

/**
 * 根据多轮意见生成完整剧本候选稿。调用方确认后再写回当前文件。
 */
export const aiIterateFullScript = async (
  model: AiModel,
  currentScript: string,
  instruction: string,
  conversationContext: string,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  const result = await callAI(
    model,
    PROMPTS.ITERATE_FULL_SCRIPT,
    { currentScript, instruction, conversationContext },
    onStream,
    {
      operation: 'script_rewrite',
      displayName: '剧本修改',
      ...taskContext,
    },
  );
  return normalizeScriptIterationResult(result);
};

/**
 * 重构分镜（拆分/合并）
 */
export const aiRestructureShot = async (
  model: AiModel,
  selection: string,
  instruction: string,
  type: 'split' | 'merge'
): Promise<any> => {
  const typeText = type === 'split' ? '拆分' : '合并';
  return await callAIForJSON(
    model,
    PROMPTS.RESTRUCTURE_SHOT,
    { selection, instruction, type: typeText }
  );
};

/**
 * 重新生成单个分镜
 */
export const aiRegenerateSingleShot = async (
  model: AiModel,
  selection: string,
  instruction?: string
): Promise<any> => {
  return await callAIForJSON(
    model,
    PROMPTS.REGENERATE_SINGLE_SHOT,
    { selection, instruction: instruction ? `用户指令：${instruction}` : '' }
  );
};

/**
 * 🆕 从剧本中提取分镜和场景描述（返回JSON）
 * 🔧 改用逐镜头处理，避免JSON截断
 */
export const aiExtractShotsFromScript = async (
  model: AiModel,
  scriptText: string
): Promise<{ items: Array<{ originalText: string; scriptSegment: string }> }> => {
  // 🆕 根据模型调用对应的extractShotsFromScript（逐镜头处理）
  if (model === AiModel.DeepseekChat || model === AiModel.Deepseek) {
    const { extractShotsFromScript } = await import('./deepseekService');
    return await extractShotsFromScript(scriptText);
  } else {
    const { extractShotsFromScript } = await import('./geminiProxyTextService');
    return await extractShotsFromScript(scriptText);
  }
};

// ===== 2026-05-29 三步生成链路 =====

/** Stage 1：拆分剧本为原文分段 */
export const aiSplitScriptIntoSegments = async (
  model: AiModel,
  originalContent: string,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<ScriptSegment[]> => {
  const raw = await callAI(
    model,
    PROMPTS.SPLIT_SCRIPT_INTO_SEGMENTS,
    { originalContent },
    onStream,
    {
      operation: 'storyboard_script_generate',
      displayName: '剧本拆分',
      ...taskContext,
    },
  );
  return parseScriptSegments(raw);
};

/** Stage 1 拆分未通过硬性校验时，根据内部反馈静默重新拆分。 */
export const aiReplanInvalidScriptSegments = async (
  model: AiModel,
  originalContent: string,
  invalidSegments: string,
  validationError: string,
  taskContext?: TextTaskContext,
): Promise<ScriptSegment[]> => {
  const raw = await callAI(
    model,
    PROMPTS.REPLAN_INVALID_SCRIPT_SEGMENTS,
    { originalContent, invalidSegments, validationError },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '剧本拆分自动重规划',
      ...taskContext,
      suppressNotification: true,
    },
  );
  return parseScriptSegments(raw);
};

/** Stage 2：把单个分段转成视频镜头脚本（返回原始文本，由调用方追加 + parseVideoScriptBlocks） */
export const aiGenerateVideoScriptFromSegment = async (
  model: AiModel,
  segment: ScriptSegment,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.GENERATE_VIDEO_SCRIPT_FROM_SEGMENT,
    {
      segmentText: [
        segment.sourceText,
        segment.estimatedDurationSec === null ? '' : `时长：${segment.estimatedDurationSec}秒`,
      ].filter(Boolean).join('\n'),
    },
    onStream,
    {
      operation: 'storyboard_script_generate',
      displayName: '视频脚本生成',
      ...taskContext,
    },
  );
};

/** Stage 2：一次把第一步的全部分段转换为完整视频脚本。 */
export const aiGenerateVideoScriptFromSegments = async (
  model: AiModel,
  segments: ScriptSegment[],
  taskContext?: TextTaskContext,
): Promise<string> => {
  const segmentsText = segments.map((segment, index) => [
    `分段${index + 1}`,
    segment.sourceText,
    segment.estimatedDurationSec === null ? '时长：缺失' : `时长：${segment.estimatedDurationSec}秒`,
  ].join('\n')).join('\n---\n');
  return await callAI(
    model,
    PROMPTS.GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS,
    { segmentsText },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '剧本转视频脚本',
      ...taskContext,
    },
  );
};

/** 根据连续意见修改完整的 Stage 2 分组视频脚本 */
export const aiIterateVideoScript = async (
  model: AiModel,
  originalScript: string,
  currentVideoScript: string,
  instruction: string,
  conversationContext: string,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.ITERATE_VIDEO_SCRIPT,
    {
      originalScript,
      currentVideoScript,
      instruction,
      conversationContext,
    },
    onStream,
    {
      operation: 'script_rewrite',
      displayName: '剧本修改',
      ...taskContext,
    },
  );
};

/** Stage 2 结果未通过硬性校验时，根据内部反馈静默重规划。 */
export const aiReplanInvalidVideoScript = async (
  model: AiModel,
  originalScript: string,
  invalidVideoScript: string,
  validationError: string,
  scopeRequirements: string,
  instruction: string,
  conversationContext: string,
  taskContext?: TextTaskContext,
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.REPLAN_INVALID_VIDEO_SCRIPT,
    {
      originalScript,
      invalidVideoScript,
      validationError,
      scopeRequirements,
      instruction: instruction || '保持原始剧情和当前脚本要求不变',
      conversationContext: conversationContext || '无',
    },
    undefined,
    {
      operation: 'script_rewrite',
      displayName: '视频脚本自动重规划',
      ...taskContext,
      suppressNotification: true,
    },
  );
};

/** Stage 3：批量提取同一分段的镜头设计。 */
export const aiExtractStoryboardPromptsFromVideoShots = async (
  model: AiModel,
  videoShotBlocks: string,
  expectedShotNumbers: string[],
  taskContext?: TextTaskContext,
): Promise<ExtractedStoryboardPrompt[]> => {
  const orderedShotNumbers = expectedShotNumbers.map(value => value.trim()).filter(Boolean);
  if (orderedShotNumbers.length === 0) return [];
  const raw = await callAI(
    model,
    PROMPTS.EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT,
    {
      videoShotBlock: videoShotBlocks,
      canonicalShotNo: orderedShotNumbers[0],
    },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '镜头设计批量生成',
      ...taskContext,
      suppressNotification: true,
    },
  );
  return parseStoryboardPromptExtractions(raw);
};

/** Stage 3：单个视频分镜可拆成一个或多个更细的镜头设计。 */
export const aiExtractStoryboardPromptFromVideoShot = async (
  model: AiModel,
  videoShotBlock: string,
  canonicalShotNo: string = '镜头1-1',
  taskContext?: TextTaskContext,
): Promise<ExtractedStoryboardPrompt[]> => {
  const raw = await callAI(
    model,
    PROMPTS.EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT,
    {
      videoShotBlock,
      canonicalShotNo,
    },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '镜头设计生成',
      ...taskContext,
    },
  );
  return parseStoryboardPromptExtractions(raw);
};

/** Stage 3 提取结果缺字段或为空时，根据内部反馈静默重新提取。 */
export const aiReplanInvalidStoryboardExtraction = async (
  model: AiModel,
  videoShotBlock: string,
  canonicalShotNo: string,
  invalidExtraction: string,
  validationError: string,
  taskContext?: TextTaskContext,
): Promise<ExtractedStoryboardPrompt[]> => {
  const raw = await callAI(
    model,
    PROMPTS.REPLAN_INVALID_STORYBOARD_EXTRACTION,
    {
      videoShotBlock,
      canonicalShotNo,
      invalidExtraction,
      validationError,
    },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '镜头设计自动重新提取',
      ...taskContext,
      suppressNotification: true,
    },
  );
  return parseStoryboardPromptExtractions(raw);
};

/**
 * 🆕 为单个分镜生成详细信息
 */
export const aiGenerateShotDetails = async (
  model: AiModel,
  originalText: string,
  scriptSegment: string,
  userRequirements?: string
): Promise<{
  imagePrompt: string;
  videoPrompt: string;
  dialogue: string;
  characters: string[];
  scene: string;
  props: string[];
}> => {
  const requirementsText = userRequirements 
    ? `**用户整体要求：**\n${userRequirements}\n` 
    : '';
    
  return await callAIForJSON(
    model,
    PROMPTS.GENERATE_SHOT_DETAILS,
    { originalText, scriptSegment, userRequirements: requirementsText }
  );
};

/**
 * 🆕 生成分镜脚本（从文字脚本生成可解析的镜头块格式）
 * 输出为纯文本，使用分段和层级镜头标题作为解析边界
 * 支持流式输出
 */
export const aiGenerateStoryboardScript = async (
  model: AiModel,
  novelText: string,
  userRequirements: string = '',
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.GENERATE_STORYBOARD_SCRIPT,
    { 
      novelText,
      userRequirements: userRequirements ? `\n**用户要求：**\n${userRequirements}` : ''
    },
    onStream,
    {
      operation: 'storyboard_script_generate',
      displayName: '分镜脚本生成',
      ...taskContext,
    },
  );
};

/**
 * 🆕 续写分镜脚本（从指定镜头继续生成）
 * 仅供历史入口显式续写使用；当前写作入口会在一次请求中完整生成
 */
export const aiContinueStoryboardScript = async (
  model: AiModel,
  nextShotId: string,
  remainingText: string,
  previousShotsContext: string = '',
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.CONTINUE_STORYBOARD_SCRIPT,
    {
      nextShotId,
      remainingText,
      previousShotsContext: previousShotsContext.trim() || '（无 — 这是首次续写）'
    },
    onStream,
    {
      operation: 'storyboard_script_continue',
      displayName: '分镜脚本续写',
      ...taskContext,
    },
  );
};

/**
 * 🆕 分段生成分镜脚本
 * 将长输入分成多个部分，每部分单独调用AI生成，然后合并结果
 * 
 * @param model AI模型选择
 * @param segments 分段后的输入内容数组
 * @param userRequirements 用户要求
 * @param onSegmentComplete 每段完成时的回调
 * @param onStream 流式输出回调
 * @returns 所有分段的生成结果数组
 */
export const aiGenerateStoryboardScriptBySegments = async (
  model: AiModel,
  segments: string[],
  userRequirements: string = '',
  onSegmentComplete?: (segmentIndex: number, result: string) => void,
  onStream?: (chunk: string, segmentIndex: number) => void
): Promise<string[]> => {
  const results: string[] = [];
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    console.log(`🎬 处理第 ${i + 1}/${segments.length} 段...`);
    
    let segmentResult = '';
    
    // 调用生成API
    const result = await callAI(
      model,
      PROMPTS.GENERATE_STORYBOARD_SCRIPT,
      { 
        novelText: segment,
        userRequirements: userRequirements ? `\n**用户要求：**\n${userRequirements}` : ''
      },
      (chunk) => {
        segmentResult += chunk;
        if (onStream) {
          onStream(chunk, i);
        }
      }
    );
    
    results.push(result);
    console.log(`✅ 第 ${i + 1} 段完成`);
    
    if (onSegmentComplete) {
      onSegmentComplete(i, result);
    }
  }
  
  return results;
};
