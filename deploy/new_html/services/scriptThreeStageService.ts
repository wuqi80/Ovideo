import { v4 as uuidv4 } from 'uuid';
import type {
  AiModel,
  ExtractedStoryboardPrompt,
  ScriptSegment,
  StoryboardItem,
  VideoScriptBlock,
} from '../types';
import {
  combineVideoScriptOutputs,
  ensureVideoScriptPromptLengths,
  formatHierarchicalShotNumber,
  parseVideoScriptGroups,
} from '../utils/scriptPipelineParsers';
import {
  countPromptCharacters,
  isIndependentSegmentPrompt,
  MIN_STABILITY_CONSTRAINT_CHARACTERS,
  MIN_VISUAL_STYLE_CHARACTERS,
} from '../utils/scriptPromptStandards';
import type { TextTaskContext } from './textTaskContext';

const loadAiModelService = () => import('./aiModelService');
const MAX_SPLIT_REPLAN_ATTEMPTS = 2;
const MAX_VIDEO_SCRIPT_REPLAN_ATTEMPTS = 2;
const MAX_STORYBOARD_EXTRACTION_REPLAN_ATTEMPTS = 2;
const SAFE_SPLIT_REPLAN_FAILURE_MESSAGE = '剧本拆分未完成，系统已自动重新规划，请稍后再试';
const SAFE_REPLAN_FAILURE_MESSAGE = '视频脚本生成未完成，系统已自动重新规划，请稍后再试';
const SAFE_EXTRACTION_REPLAN_FAILURE_MESSAGE = '镜头设计生成未完成，系统已自动重新提取，请稍后再试';

export interface PipelineUsage {
  inputTexts: string[];
  outputTexts: string[];
}

export interface EpisodeVideoScriptResult extends PipelineUsage {
  segments: ScriptSegment[];
  content: string;
}

export interface StoryboardDesignResult extends PipelineUsage {
  items: StoryboardItem[];
  sourceShotCount: number;
}

export interface PipelineProgress {
  stage: 'split' | 'videoScript' | 'storyboardDesign';
  completed: number;
  total: number;
  content?: string;
}

export class VideoScriptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoScriptValidationError';
  }
}

class SplitScriptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitScriptValidationError';
  }
}

function failVideoScriptValidation(message: string): never {
  throw new VideoScriptValidationError(message);
}

function failSplitScriptValidation(message: string): never {
  throw new SplitScriptValidationError(message);
}

function serializeSplitSegments(segments: ScriptSegment[]): string {
  return segments.map(segment => [
    segment.sourceText,
    segment.estimatedDurationSec === null ? '时长：缺失' : `时长：${segment.estimatedDurationSec}秒`,
  ].join('\n')).join('\n---\n');
}

function normalizeCoverageText(value: string): string {
  return String(value || '').replace(/\s/g, '');
}

function assertValidSplitSegments(segments: ScriptSegment[], originalContent: string): void {
  if (segments.length === 0) failSplitScriptValidation('第一步未解析出有效剧本分段');
  const durations = segments.map(segment => segment.estimatedDurationSec);
  if (durations.some(duration => duration === null || duration < 4 || duration > 15)) {
    failSplitScriptValidation('第一步分段时长必须全部为4-15秒的正整数');
  }
  const numericDurations = durations as number[];
  const denseSegmentRatio = numericDurations.filter(duration => duration >= 14).length / numericDurations.length;
  const averageDuration = numericDurations.reduce((total, duration) => total + duration, 0) / numericDurations.length;
  if (denseSegmentRatio < 0.3 || averageDuration < 10) {
    failSplitScriptValidation('第一步分段未满足14-15秒占比≥30%且平均时长≥10秒的硬性要求');
  }
  const reconstructed = segments.map(segment => segment.sourceText).join('');
  if (normalizeCoverageText(reconstructed) !== normalizeCoverageText(originalContent)) {
    failSplitScriptValidation('第一步分段未100%覆盖原文，存在遗漏、重复或改写');
  }
}

export function assertValidVideoScript(
  content: string,
  enforceDurationDensity = true,
  enforcePromptLength = true,
): void {
  const groups = parseVideoScriptGroups(content);
  if (groups.length === 0) failVideoScriptValidation('第二步未解析出有效分段和镜头');
  const groupDurations: number[] = [];
  groups.forEach((group) => {
    if (group.blocks.length > 5) {
      failVideoScriptValidation(`分段${group.groupNo}包含${group.blocks.length}个镜头，超过每组5个镜头上限`);
    }
    const durations = group.blocks.map(block => block.durationSec);
    if (durations.some(duration => duration === null || duration <= 0 || !Number.isInteger(duration))) {
      failVideoScriptValidation(`分段${group.groupNo}存在缺失或非正整数镜头时长`);
    }
    const totalDuration = (durations as number[]).reduce((total, duration) => total + duration, 0);
    if (totalDuration > 15) {
      failVideoScriptValidation(`分段${group.groupNo}累计${totalDuration}秒，超过15秒上限`);
    }
    groupDurations.push(totalDuration);
    if (!group.visualStyle || !group.stabilityConstraint) {
      failVideoScriptValidation(`分段${group.groupNo}缺少独立的视觉风格或正向稳定约束`);
    }
    if (!isIndependentSegmentPrompt(group.visualStyle)
      || !isIndependentSegmentPrompt(group.stabilityConstraint)) {
      failVideoScriptValidation(`分段${group.groupNo}的视觉风格和正向稳定约束必须独立完整，禁止使用“同上”`);
    }
    if (enforcePromptLength) {
      const visualStyleLength = countPromptCharacters(group.visualStyle);
      const stabilityConstraintLength = countPromptCharacters(group.stabilityConstraint);
      if (visualStyleLength < MIN_VISUAL_STYLE_CHARACTERS) {
        failVideoScriptValidation(
          `分段${group.groupNo}视觉风格仅${visualStyleLength}字，至少需要${MIN_VISUAL_STYLE_CHARACTERS}字`,
        );
      }
      if (stabilityConstraintLength < MIN_STABILITY_CONSTRAINT_CHARACTERS) {
        failVideoScriptValidation(
          `分段${group.groupNo}正向稳定约束仅${stabilityConstraintLength}字，至少需要${MIN_STABILITY_CONSTRAINT_CHARACTERS}字`,
        );
      }
    }
    group.blocks.forEach((block, index) => {
      const expected = formatHierarchicalShotNumber(group.groupNo, index + 1);
      if (block.shotNo !== expected) {
        failVideoScriptValidation(`分段${group.groupNo}镜头编号不连续：应为${expected}，实际为${block.shotNo}`);
      }
    });
  });
  const denseGroupRatio = groupDurations.filter(duration => duration >= 14).length / groupDurations.length;
  const averageGroupDuration = groupDurations.reduce((total, duration) => total + duration, 0) / groupDurations.length;
  if (enforceDurationDensity && (denseGroupRatio < 0.3 || averageGroupDuration < 10)) {
    failVideoScriptValidation('第二步分段未保持14-15秒占比≥30%且平均时长≥10秒的硬性要求');
  }
}

async function validateOrReplanVideoScript(
  model: AiModel,
  initialDraft: string,
  options: {
    originalScript: string;
    instruction: string;
    conversationContext: string;
    scopeRequirements: string;
    enforceDurationDensity: boolean;
    validateContent?: (content: string) => void;
    taskContext?: TextTaskContext;
  },
): Promise<string> {
  let draft = initialDraft;
  for (let attempt = 0; attempt <= MAX_VIDEO_SCRIPT_REPLAN_ATTEMPTS; attempt += 1) {
    const content = ensureVideoScriptPromptLengths(combineVideoScriptOutputs([draft]));
    try {
      assertValidVideoScript(content, options.enforceDurationDensity);
      options.validateContent?.(content);
      return content;
    } catch (error) {
      if (!(error instanceof VideoScriptValidationError)) throw error;
      if (attempt >= MAX_VIDEO_SCRIPT_REPLAN_ATTEMPTS) {
        throw new Error(SAFE_REPLAN_FAILURE_MESSAGE);
      }
      const { aiReplanInvalidVideoScript } = await loadAiModelService();
      draft = await aiReplanInvalidVideoScript(
        model,
        options.originalScript,
        content,
        error.message,
        options.scopeRequirements,
        options.instruction,
        options.conversationContext,
        options.taskContext,
      );
    }
  }
  throw new Error(SAFE_REPLAN_FAILURE_MESSAGE);
}

async function splitWithValidation(
  model: AiModel,
  originalContent: string,
  taskContext?: TextTaskContext,
): Promise<ScriptSegment[]> {
  const { aiSplitScriptIntoSegments } = await loadAiModelService();
  let segments = await aiSplitScriptIntoSegments(model, originalContent, undefined, taskContext);
  for (let attempt = 0; attempt <= MAX_SPLIT_REPLAN_ATTEMPTS; attempt += 1) {
    try {
      assertValidSplitSegments(segments, originalContent);
      return segments;
    } catch (error) {
      if (!(error instanceof SplitScriptValidationError)) throw error;
      if (attempt >= MAX_SPLIT_REPLAN_ATTEMPTS) {
        throw new Error(SAFE_SPLIT_REPLAN_FAILURE_MESSAGE);
      }
      const { aiReplanInvalidScriptSegments } = await loadAiModelService();
      segments = await aiReplanInvalidScriptSegments(
        model,
        originalContent,
        serializeSplitSegments(segments),
        error.message,
        taskContext,
      );
    }
  }
  throw new Error(SAFE_SPLIT_REPLAN_FAILURE_MESSAGE);
}

async function generateSegmentVideoScript(
  model: AiModel,
  segment: ScriptSegment,
  taskContext?: TextTaskContext,
): Promise<string> {
  const { aiGenerateVideoScriptFromSegment } = await loadAiModelService();
  const raw = await aiGenerateVideoScriptFromSegment(model, segment, undefined, taskContext);
  return await validateOrReplanVideoScript(model, raw, {
    originalScript: segment.sourceText,
    instruction: '保持本段原文剧情不变，重新规划镜头与时长',
    conversationContext: '这是首次生成中的单个原文分段',
    scopeRequirements: [
      '只重新规划当前这一个原文分段，不扩写为额外剧情分段。',
      `镜头累计时长以第一步估算的${segment.estimatedDurationSec ?? 15}秒为目标，且绝对不得超过15秒。`,
      '不单独要求这一段满足全剧14-15秒占比或全剧平均时长指标。',
    ].join('\n'),
    enforceDurationDensity: false,
    validateContent: (content) => {
      const groups = parseVideoScriptGroups(content);
      if (groups.length !== 1) {
        failVideoScriptValidation(`当前原文分段生成了${groups.length}个视频分段，应保持为1个分段`);
      }
      if (segment.estimatedDurationSec !== null) {
        const totalDuration = groups[0].blocks.reduce(
          (total, block) => total + Number(block.durationSec || 0),
          0,
        );
        if (totalDuration !== segment.estimatedDurationSec) {
          failVideoScriptValidation(
            `当前分段镜头累计${totalDuration}秒，应与第一步规划的${segment.estimatedDurationSec}秒一致`,
          );
        }
      }
    },
    taskContext,
  });
}

export async function generateEpisodeVideoScript(
  model: AiModel,
  originalContent: string,
  options: {
    taskContext?: TextTaskContext;
    onProgress?: (progress: PipelineProgress) => void;
  } = {},
): Promise<EpisodeVideoScriptResult> {
  const inputTexts: string[] = [];
  const outputTexts: string[] = [];
  inputTexts.push(originalContent);
  options.onProgress?.({ stage: 'split', completed: 0, total: 1 });
  const segments = await splitWithValidation(model, originalContent, options.taskContext);
  outputTexts.push(segments.map(segment => (
    `${segment.sourceText}\n时长：${segment.estimatedDurationSec}秒`
  )).join('\n---\n'));
  options.onProgress?.({ stage: 'split', completed: 1, total: 1 });

  const outputs: string[] = [];
  const orderedSegments = [...segments].sort((a, b) => a.order - b.order);
  for (let index = 0; index < orderedSegments.length; index += 1) {
    const segment = orderedSegments[index];
    inputTexts.push(segment.sourceText);
    const output = await generateSegmentVideoScript(model, segment, options.taskContext);
    outputs.push(output);
    outputTexts.push(output);
    const partialContent = combineVideoScriptOutputs(outputs);
    options.onProgress?.({
      stage: 'videoScript',
      completed: index + 1,
      total: orderedSegments.length,
      content: partialContent,
    });
  }

  const content = combineVideoScriptOutputs(outputs);
  try {
    assertValidVideoScript(content);
  } catch (error) {
    if (error instanceof VideoScriptValidationError) {
      throw new Error(SAFE_REPLAN_FAILURE_MESSAGE);
    }
    throw error;
  }
  const groups = parseVideoScriptGroups(content);
  const completedSegments = orderedSegments.map((segment, index) => ({
    ...segment,
    videoScript: outputs[index] || '',
    status: 'done' as const,
    errorMessage: '',
  }));
  if (groups.length === 0) throw new Error(SAFE_REPLAN_FAILURE_MESSAGE);
  return { segments: completedSegments, content, inputTexts, outputTexts };
}

export async function iterateEpisodeVideoScript(
  model: AiModel,
  originalScript: string,
  currentVideoScript: string,
  instruction: string,
  conversationContext: string,
  options: {
    taskContext?: TextTaskContext;
    onStream?: (chunk: string) => void;
  } = {},
): Promise<EpisodeVideoScriptResult> {
  const { aiIterateVideoScript } = await loadAiModelService();
  const raw = await aiIterateVideoScript(
    model,
    originalScript,
    currentVideoScript,
    instruction,
    conversationContext,
    undefined,
    options.taskContext,
  );
  const content = await validateOrReplanVideoScript(model, raw, {
    originalScript,
    instruction,
    conversationContext,
    scopeRequirements: [
      '重新规划完整剧本，可按故事情节与情绪闭环调整相邻分段。',
      '最终结果必须保持14-15秒分段占30%以上、所有分段平均时长不低于10秒。',
      '必须完整保留本轮用户修改意见。',
    ].join('\n'),
    enforceDurationDensity: true,
    taskContext: options.taskContext,
  });
  options.onStream?.(content);
  return {
    segments: [],
    content,
    inputTexts: [originalScript, currentVideoScript, instruction, conversationContext],
    outputTexts: [content],
  };
}

function buildStoryboardItem(
  extraction: ExtractedStoryboardPrompt,
  block: VideoScriptBlock,
  groupNo: number,
  localShotNo: number,
  sharedVideoPrompt: string,
): StoryboardItem {
  const shotNumber = formatHierarchicalShotNumber(groupNo, localShotNo);
  const durationSec = extraction.durationSec ?? block.durationSec;
  const originalText = [
    shotNumber,
    durationSec ? `时间：${durationSec}秒` : '',
    extraction.shotSize ? `景别：${extraction.shotSize}` : '',
    extraction.sceneDescription ? `画面描述：${extraction.sceneDescription}` : '',
    extraction.imagePrompt ? `分镜生成提示词：${extraction.imagePrompt}` : '',
    extraction.cameraAngle ? `拍摄角度：${extraction.cameraAngle}` : '',
    extraction.cameraMove ? `运镜方式：${extraction.cameraMove}` : '',
    extraction.dialogue ? `人声：${extraction.dialogue}` : '人声：无',
    extraction.characters.length ? `人物名称：${extraction.characters.join('、')}` : '人物名称：无',
    extraction.scene ? `场景名称：${extraction.scene}` : '场景名称：无',
    extraction.props.length ? `道具名称：${extraction.props.join('、')}` : '道具名称：无',
    `视频提示词：${sharedVideoPrompt}`,
  ].filter(Boolean).join('\n');
  return {
    id: uuidv4(),
    shotNumber,
    originalText,
    scriptSegment: extraction.sceneDescription,
    characters: extraction.characters,
    scene: extraction.scene,
    props: extraction.props,
    imagePrompt: extraction.imagePrompt,
    videoPrompt: sharedVideoPrompt,
    dialogue: extraction.dialogue,
    cameraMovement: [
      extraction.shotSize,
      extraction.cameraMove,
      extraction.cameraAngle,
    ].filter(Boolean).join('，'),
    plannedDurationMs: durationSec ? durationSec * 1000 : null,
    duration: durationSec ? `${durationSec}秒` : undefined,
    scriptSegmentId: `storyboard-segment-${groupNo}`,
    sourceVideoShotNo: shotNumber,
    videoScriptBlock: block.rawBlock,
    shotSize: extraction.shotSize,
    cameraAngle: extraction.cameraAngle,
    timestamp: Date.now(),
  };
}

function getStoryboardExtractionValidationError(
  extractions: ExtractedStoryboardPrompt[],
  canonicalShotNo: string,
): string | null {
  if (extractions.length === 0) {
    return `${canonicalShotNo}未提取出有效镜头设计`;
  }
  if (extractions.some(extraction => !extraction.sceneDescription || !extraction.imagePrompt)) {
    return `${canonicalShotNo}缺少画面描述或分镜生成提示词`;
  }
  return null;
}

async function validateOrReplanStoryboardExtractions(
  model: AiModel,
  videoShotBlock: string,
  canonicalShotNo: string,
  initialExtractions: ExtractedStoryboardPrompt[],
  taskContext?: TextTaskContext,
): Promise<ExtractedStoryboardPrompt[]> {
  let extractions = initialExtractions;
  for (let attempt = 0; attempt <= MAX_STORYBOARD_EXTRACTION_REPLAN_ATTEMPTS; attempt += 1) {
    const validationError = getStoryboardExtractionValidationError(extractions, canonicalShotNo);
    if (!validationError) return extractions;
    if (attempt >= MAX_STORYBOARD_EXTRACTION_REPLAN_ATTEMPTS) {
      throw new Error(SAFE_EXTRACTION_REPLAN_FAILURE_MESSAGE);
    }
    const { aiReplanInvalidStoryboardExtraction } = await loadAiModelService();
    extractions = await aiReplanInvalidStoryboardExtraction(
      model,
      videoShotBlock,
      canonicalShotNo,
      JSON.stringify(extractions),
      validationError,
      taskContext,
    );
  }
  throw new Error(SAFE_EXTRACTION_REPLAN_FAILURE_MESSAGE);
}

export async function generateStoryboardDesignForVersion(
  model: AiModel,
  videoScript: string,
  options: {
    taskContext?: TextTaskContext;
    onProgress?: (progress: PipelineProgress) => void;
  } = {},
): Promise<StoryboardDesignResult> {
  const groups = parseVideoScriptGroups(videoScript);
  // 历史版本正文保持不可变；新生成/新编辑版本已在写入前执行完整字数校验。
  assertValidVideoScript(videoScript, true, false);
  const sourceShotCount = groups.reduce((total, group) => total + group.blocks.length, 0);
  const inputTexts: string[] = [];
  const outputTexts: string[] = [];
  const items: StoryboardItem[] = [];
  let completed = 0;
  const { aiExtractStoryboardPromptFromVideoShot } = await loadAiModelService();

  for (const group of groups) {
    const groupItemStart = items.length;
    let nextLocalShotNo = 1;
    for (const block of group.blocks) {
      const canonicalShotNo = formatHierarchicalShotNumber(group.groupNo, nextLocalShotNo);
      inputTexts.push(block.rawBlock);
      const initialExtractions = await aiExtractStoryboardPromptFromVideoShot(
        model,
        block.rawBlock,
        canonicalShotNo,
        options.taskContext,
      );
      const extractions = await validateOrReplanStoryboardExtractions(
        model,
        block.rawBlock,
        canonicalShotNo,
        initialExtractions,
        options.taskContext,
      );
      outputTexts.push(JSON.stringify(extractions));
      extractions.forEach((extraction) => {
        items.push(buildStoryboardItem(
          extraction,
          block,
          group.groupNo,
          nextLocalShotNo,
          group.sharedVideoPrompt,
        ));
        nextLocalShotNo += 1;
      });
      completed += 1;
      options.onProgress?.({
        stage: 'storyboardDesign',
        completed,
        total: sourceShotCount,
      });
    }
    const firstShot = formatHierarchicalShotNumber(group.groupNo, 1);
    const lastShot = formatHierarchicalShotNumber(group.groupNo, Math.max(1, nextLocalShotNo - 1));
    const range = firstShot === lastShot ? firstShot : `${firstShot}至${lastShot}`;
    const finalSharedVideoPrompt = [
      range,
      group.visualStyle ? `【视觉风格】${group.visualStyle}` : '',
      group.stabilityConstraint ? `【正向稳定约束】${group.stabilityConstraint}` : '',
    ].filter(Boolean).join('，') + '。';
    for (let index = groupItemStart; index < items.length; index += 1) {
      items[index] = {
        ...items[index],
        videoPrompt: finalSharedVideoPrompt,
        originalText: items[index].originalText.replace(
          /^视频提示词：.*$/m,
          `视频提示词：${finalSharedVideoPrompt}`,
        ),
      };
    }
  }

  if (items.length === 0) throw new Error(SAFE_EXTRACTION_REPLAN_FAILURE_MESSAGE);
  return { items, sourceShotCount, inputTexts, outputTexts };
}
