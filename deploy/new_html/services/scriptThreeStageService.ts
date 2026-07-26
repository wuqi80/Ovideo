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
import { normalizePositiveIntegerSeconds } from '../utils/storyboardSegments';
import type { TextTaskContext } from './textTaskContext';

const loadAiModelService = () => import('./aiModelService');
const MAX_SPLIT_REPLAN_ATTEMPTS = 1;
const MAX_VIDEO_SCRIPT_REPLAN_ATTEMPTS = 1;
const MAX_STORYBOARD_EXTRACTION_REPLAN_ATTEMPTS = 1;
const VIDEO_SCRIPT_REPAIR_CONCURRENCY = 3;
const STORYBOARD_GROUP_GENERATION_CONCURRENCY = 4;
const STORYBOARD_LOCAL_REPAIR_CONCURRENCY = 4;
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

async function runWithConcurrencyInOrder<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
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

function serializeStageOneSegments(segments: ScriptSegment[]): string {
  return segments.map((segment, index) => [
    `分段${index + 1}`,
    segment.sourceText,
    segment.estimatedDurationSec === null ? '时长：缺失' : `时长：${segment.estimatedDurationSec}秒`,
  ].join('\n')).join('\n---\n');
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

function assertVideoScriptMatchesStageOneSegments(
  content: string,
  segments: ScriptSegment[],
): void {
  const groups = parseVideoScriptGroups(content);
  if (groups.length !== segments.length) {
    failVideoScriptValidation(
      `第二步生成了${groups.length}个分段，应与第一步的${segments.length}个分段一一对应`,
    );
  }
  groups.forEach((group, index) => {
    const plannedDuration = segments[index].estimatedDurationSec;
    if (plannedDuration === null) return;
    const totalDuration = group.blocks.reduce(
      (total, block) => total + Number(block.durationSec || 0),
      0,
    );
    if (totalDuration !== plannedDuration) {
      failVideoScriptValidation(
        `分段${index + 1}镜头累计${totalDuration}秒，应与第一步规划的${plannedDuration}秒一致`,
      );
    }
  });
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

async function validateOrRepairGeneratedSegment(
  model: AiModel,
  segment: ScriptSegment,
  initialDraft: string,
  taskContext?: TextTaskContext,
): Promise<string> {
  return await validateOrReplanVideoScript(model, initialDraft, {
    originalScript: segment.sourceText,
    instruction: '保持本段原文剧情不变，重新规划镜头与时长',
    conversationContext: '这是首次生成中的单个原文分段',
    scopeRequirements: [
      '只重新规划当前这一个原文分段，不扩写为额外剧情分段。',
      `镜头累计时长必须精确等于第一步规划的${segment.estimatedDurationSec ?? 15}秒，不是尽量接近，且绝对不得超过15秒。`,
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
  inputTexts.push(...orderedSegments.map(segment => segment.sourceText));

  const { aiGenerateVideoScriptFromSegments } = await loadAiModelService();
  const initialVideoScript = await aiGenerateVideoScriptFromSegments(
    model,
    orderedSegments,
    options.taskContext,
  );
  let normalizedVideoScript = ensureVideoScriptPromptLengths(
    combineVideoScriptOutputs([initialVideoScript]),
  );
  if (parseVideoScriptGroups(normalizedVideoScript).length !== orderedSegments.length) {
    normalizedVideoScript = await validateOrReplanVideoScript(model, normalizedVideoScript, {
      originalScript: serializeStageOneSegments(orderedSegments),
      instruction: '保持第一步全部原文分段及其顺序不变，重新输出一一对应的完整视频脚本',
      conversationContext: '这是首次生成的完整第二步结果',
      scopeRequirements: [
        `必须输出且仅输出${orderedSegments.length}个分段，与第一步输入一一对应。`,
        '不得合并、拆开、遗漏或调换第一步分段。',
        '每个分段的镜头累计时长必须与第一步标注时长完全一致。',
      ].join('\n'),
      enforceDurationDensity: true,
      validateContent: content => assertVideoScriptMatchesStageOneSegments(content, orderedSegments),
      taskContext: options.taskContext,
    });
  }

  const generatedGroups = parseVideoScriptGroups(normalizedVideoScript);
  let completed = 0;
  const repairedOutputs = await runWithConcurrencyInOrder(
    orderedSegments,
    VIDEO_SCRIPT_REPAIR_CONCURRENCY,
    async (segment, index) => {
      const group = generatedGroups[index];
      const standaloneDraft = group
        ? combineVideoScriptOutputs([group.rawGroup])
        : '';
      const output = await validateOrRepairGeneratedSegment(
        model,
        segment,
        standaloneDraft,
        options.taskContext,
      );
      completed += 1;
      options.onProgress?.({
        stage: 'videoScript',
        completed,
        total: orderedSegments.length,
      });
      return output;
    },
  );
  outputs.push(...repairedOutputs);
  outputTexts.push(...repairedOutputs);

  const content = combineVideoScriptOutputs(outputs);
  try {
    assertValidVideoScript(content);
    assertVideoScriptMatchesStageOneSegments(content, orderedSegments);
  } catch (error) {
    if (error instanceof VideoScriptValidationError) {
      throw new Error(SAFE_REPLAN_FAILURE_MESSAGE);
    }
    throw error;
  }
  const groups = parseVideoScriptGroups(content);
  options.onProgress?.({
    stage: 'videoScript',
    completed: orderedSegments.length,
    total: orderedSegments.length,
    content,
  });
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

function allocateExtractedStoryboardDurations(
  extractions: ExtractedStoryboardPrompt[],
  sourceDurationSec: number | null,
): number[] {
  if (extractions.length === 0) return [];
  const target = normalizePositiveIntegerSeconds(sourceDurationSec);
  const durations = extractions.map(extraction => normalizePositiveIntegerSeconds(extraction.durationSec));
  if (!target) return durations.map(duration => duration || 1);
  if (extractions.length === 1) return [target];

  const allocated = durations.map(duration => duration || 0);
  const missingIndexes = allocated
    .map((duration, index) => (duration > 0 ? -1 : index))
    .filter(index => index >= 0);
  if (missingIndexes.length > 0) {
    const knownTotal = allocated.reduce((total, duration) => total + Math.max(0, duration), 0);
    let remaining = Math.max(target - knownTotal, missingIndexes.length);
    missingIndexes.forEach((index, order) => {
      const slotsLeft = missingIndexes.length - order;
      const nextDuration = Math.max(1, Math.floor(remaining / slotsLeft));
      allocated[index] = nextDuration;
      remaining -= nextDuration;
    });
  }

  let total = allocated.reduce((sum, duration) => sum + duration, 0);
  let delta = target - total;
  if (delta > 0) {
    allocated[allocated.length - 1] += delta;
  } else if (delta < 0) {
    for (let index = allocated.length - 1; index >= 0 && delta < 0; index -= 1) {
      const reducible = Math.max(0, allocated[index] - 1);
      const reduction = Math.min(reducible, -delta);
      allocated[index] -= reduction;
      delta += reduction;
    }
  }

  total = allocated.reduce((sum, duration) => sum + duration, 0);
  if (total <= 0) return extractions.map(() => 1);
  return allocated.map(duration => Math.max(1, Math.round(duration)));
}

function buildStoryboardItem(
  extraction: ExtractedStoryboardPrompt,
  block: VideoScriptBlock,
  groupNo: number,
  localShotNo: number,
  sharedVideoPrompt: string,
  resolvedDurationSec?: number | null,
): StoryboardItem {
  const shotNumber = formatHierarchicalShotNumber(groupNo, localShotNo);
  const durationSec = normalizePositiveIntegerSeconds(resolvedDurationSec)
    || normalizePositiveIntegerSeconds(extraction.durationSec)
    || normalizePositiveIntegerSeconds(block.durationSec);
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
    sourceVideoShotNo: block.shotNo || shotNumber,
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
  const invalidIndex = extractions.findIndex(extraction => (
    !extraction.sceneDescription
    || !extraction.imagePrompt
    || (extraction.durationSec !== null && !normalizePositiveIntegerSeconds(extraction.durationSec))
  ));
  if (invalidIndex >= 0) {
    return `${canonicalShotNo}第${invalidIndex + 1}个镜头设计缺少画面描述、分镜生成提示词或有效时长`;
  }
  return null;
}

function alignStoryboardExtractions(
  expectedShotNumbers: string[],
  extractions: ExtractedStoryboardPrompt[],
): Array<ExtractedStoryboardPrompt | undefined> {
  const candidates = new Map<string, ExtractedStoryboardPrompt[]>();
  extractions.forEach((extraction) => {
    if (!expectedShotNumbers.includes(extraction.shotNo)) return;
    candidates.set(extraction.shotNo, [
      ...(candidates.get(extraction.shotNo) || []),
      extraction,
    ]);
  });
  return expectedShotNumbers.map((shotNo) => {
    const matches = candidates.get(shotNo) || [];
    return getStoryboardExtractionValidationError(matches, shotNo) ? undefined : matches[0];
  });
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
  let completed = 0;
  const sourceShots = groups.flatMap(group => (
    group.blocks.map((block, localIndex) => ({
      block,
      group,
      localShotNo: localIndex + 1,
      canonicalShotNo: formatHierarchicalShotNumber(group.groupNo, localIndex + 1),
    }))
  ));
  const { aiExtractStoryboardPromptFromVideoShot } = await loadAiModelService();

  // 回到 master 逻辑：单个视频分镜独立提取，可拆成多个镜头设计；并发只影响请求速度，最终仍按源顺序组装。
  const extractionResults = await runWithConcurrencyInOrder(
    sourceShots,
    STORYBOARD_LOCAL_REPAIR_CONCURRENCY,
    async (shot) => {
      const extractionTaskContext = {
        ...options.taskContext,
        suppressNotification: true,
      };
      const initialExtractions = await aiExtractStoryboardPromptFromVideoShot(
        model,
        shot.block.rawBlock,
        shot.canonicalShotNo,
        extractionTaskContext,
      );
      const extractions = await validateOrReplanStoryboardExtractions(
        model,
        shot.block.rawBlock,
        shot.canonicalShotNo,
        initialExtractions,
        extractionTaskContext,
      );
      completed += 1;
      options.onProgress?.({
        stage: 'storyboardDesign',
        completed,
        total: sourceShotCount,
      });
      return {
        shot,
        extractions,
        inputTexts: extractions === initialExtractions
          ? [shot.block.rawBlock]
          : [shot.block.rawBlock, shot.block.rawBlock],
        outputTexts: extractions === initialExtractions
          ? [JSON.stringify(initialExtractions)]
          : [JSON.stringify(initialExtractions), JSON.stringify(extractions)],
      };
    },
  );
  extractionResults.forEach((result) => {
    inputTexts.push(...result.inputTexts);
    outputTexts.push(...result.outputTexts);
  });

  const localShotCountByGroup = new Map<number, number>();
  const items = extractionResults.flatMap((result) => {
    const { shot, extractions } = result;
    const firstShot = formatHierarchicalShotNumber(shot.group.groupNo, 1);
    const lastShot = formatHierarchicalShotNumber(
      shot.group.groupNo,
      Math.max(1, shot.group.blocks.length),
    );
    const range = firstShot === lastShot ? firstShot : `${firstShot}至${lastShot}`;
    const finalSharedVideoPrompt = [
      range,
      shot.group.visualStyle ? `【视觉风格】${shot.group.visualStyle}` : '',
      shot.group.stabilityConstraint ? `【正向稳定约束】${shot.group.stabilityConstraint}` : '',
    ].filter(Boolean).join('，') + '。';
    const durations = allocateExtractedStoryboardDurations(extractions, shot.block.durationSec);
    return extractions.map((extraction, extractionIndex) => {
      const localShotNo = (localShotCountByGroup.get(shot.group.groupNo) || 0) + 1;
      localShotCountByGroup.set(shot.group.groupNo, localShotNo);
      return buildStoryboardItem(
        extraction,
        shot.block,
        shot.group.groupNo,
        localShotNo,
        finalSharedVideoPrompt,
        durations[extractionIndex],
      );
    });
  });

  if (items.length === 0) throw new Error(SAFE_EXTRACTION_REPLAN_FAILURE_MESSAGE);
  return { items, sourceShotCount, inputTexts, outputTexts };
}
