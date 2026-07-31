import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiModel } from '../../types';

const aiMocks = vi.hoisted(() => ({
  aiSplitScriptIntoSegments: vi.fn(),
  aiReplanInvalidScriptSegments: vi.fn(),
  aiGenerateVideoScriptFromSegment: vi.fn(),
  aiGenerateVideoScriptFromSegments: vi.fn(),
  aiIterateVideoScript: vi.fn(),
  aiReplanInvalidVideoScript: vi.fn(),
  aiExtractStoryboardPromptsFromVideoShots: vi.fn(),
  aiExtractStoryboardPromptFromVideoShot: vi.fn(),
  aiReplanInvalidStoryboardExtraction: vi.fn(),
}));

vi.mock('../../services/aiModelService', () => aiMocks);

import {
  assertValidVideoScript,
  generateEpisodeVideoScript,
  generateStoryboardDesignForVersion,
  iterateEpisodeVideoScript,
} from '../../services/scriptThreeStageService';
import {
  countPromptCharacters,
  MIN_STABILITY_CONSTRAINT_CHARACTERS,
  MIN_VISUAL_STYLE_CHARACTERS,
  STABILITY_CONSTRAINT_REFERENCE,
  VISUAL_STYLE_REFERENCE,
} from '../../utils/scriptPromptStandards';
import { parseVideoScriptGroups } from '../../utils/scriptPipelineParsers';

const validGroup = [
  '分段1',
  '镜头1-1',
  '时长（秒）：8',
  '画面描述：主角推门进入办公室。',
  '镜头1-2',
  '时长（秒）：7',
  '画面描述：主角停在办公桌前。',
  `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
  `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
].join('\n');

const shortSingleGroup = [
  '分段1',
  '镜头1-1',
  '时长（秒）：8',
  '画面描述：孙悟空立于云海之上，金箍棒横扫天门。',
  `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
  `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
].join('\n');

describe('three-stage video script contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a valid hierarchical group', () => {
    expect(() => assertValidVideoScript(validGroup)).not.toThrow();
  });

  it('accepts a valid single short group when the entire source is brief', () => {
    expect(() => assertValidVideoScript(shortSingleGroup)).not.toThrow();
  });

  it('rejects groups over the 15-second limit', () => {
    expect(() => assertValidVideoScript(validGroup.replace('时长（秒）：7', '时长（秒）：8')))
      .toThrow('超过15秒上限');
  });

  it('rejects missing stability requirements', () => {
    expect(() => assertValidVideoScript(validGroup.replace(/【正向稳定约束】.*$/, '')))
      .toThrow('缺少独立的视觉风格或正向稳定约束');
  });

  it('rejects short or inherited segment-level prompts', () => {
    expect(() => assertValidVideoScript(
      validGroup.replace(`【视觉风格】${VISUAL_STYLE_REFERENCE}`, '【视觉风格】古风写实'),
    )).toThrow('视觉风格仅');
    expect(() => assertValidVideoScript(
      validGroup.replace(`【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`, '【正向稳定约束】同上'),
    )).toThrow('必须独立完整');
    expect(() => assertValidVideoScript(
      validGroup.replace(`【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`, '【正向稳定约束】角色稳定，无字幕。'),
    )).toThrow('正向稳定约束仅');
  });

  it('rejects duplicate or discontinuous hierarchical numbers', () => {
    expect(() => assertValidVideoScript(validGroup.replace('镜头1-2', '镜头1-1')))
      .toThrow('分镜编号不连续');
  });

  it('runs stage one before stage two and canonicalizes all returned groups', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 's1', order: 0, sourceText: '第一段', estimatedDurationSec: 15, status: 'done' },
      { id: 's2', order: 1, sourceText: '第二段', estimatedDurationSec: 10, status: 'done' },
      { id: 's3', order: 2, sourceText: '第三段', estimatedDurationSec: 14, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockImplementation(async (_model, segment) => (
      [
        '分段1',
        '镜头1-1',
        `时长（秒）：${segment.estimatedDurationSec}`,
        `画面描述：${segment.sourceText}`,
        `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
        `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
      ].join('\n')
    ));

    const progress: string[] = [];
    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '第一段第二段第三段', {
      onProgress: event => {
        if (event.content) progress.push(event.content);
      },
    });

    expect(aiMocks.aiSplitScriptIntoSegments).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledTimes(3);
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.objectContaining({ sourceText: '第一段' }),
      undefined,
      { suppressNotification: true },
    );
    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(result.content).toContain('分段1\n分镜1-1');
    expect(result.content).toContain('分段2\n分镜2-1');
    expect(result.content).toContain('分段3\n分镜3-1');
    expect(progress.at(-1)).toBe(result.content);
    parseVideoScriptGroups(result.content).forEach((group) => {
      expect(countPromptCharacters(group.visualStyle)).toBeGreaterThanOrEqual(MIN_VISUAL_STYLE_CHARACTERS);
      expect(countPromptCharacters(group.stabilityConstraint))
        .toBeGreaterThanOrEqual(MIN_STABILITY_CONSTRAINT_CHARACTERS);
    });
  });

  it('lets a brief one-line source expand into multiple stage-two groups', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 'brief', order: 0, sourceText: '孙悟空大闹天宫', estimatedDurationSec: 8, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue([
      '分段1',
      '分镜1-1',
      '时长（秒）：8',
      '画面描述：孙悟空立于云海之上，金箍棒横扫天门。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
      '分段2',
      '分镜2-1',
      '时长（秒）：7',
      '画面描述：天兵在南天门前列阵，云层被金光撕开。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    const progress: Array<{ stage: string; completed: number; total: number }> = [];
    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '孙悟空大闹天宫', {
      onProgress: event => progress.push({
        stage: event.stage,
        completed: event.completed,
        total: event.total,
      }),
    });

    expect(aiMocks.aiReplanInvalidScriptSegments).not.toHaveBeenCalled();
    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.objectContaining({
        sourceText: '孙悟空大闹天宫',
        estimatedDurationSec: null,
      }),
      undefined,
      expect.objectContaining({ suppressNotification: true }),
    );
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual(expect.objectContaining({
      sourceText: '孙悟空大闹天宫',
      estimatedDurationSec: 8,
      videoScript: expect.stringContaining('天兵在南天门前列阵'),
    }));
    expect(parseVideoScriptGroups(result.content)).toHaveLength(2);
    expect(result.content).toContain('孙悟空立于云海之上');
    expect(progress).toEqual(expect.arrayContaining([
      { stage: 'split', completed: 1, total: 1 },
      { stage: 'videoScript', completed: 1, total: 1 },
    ]));
  });

  it('reports visible stage-two progress before and after each segment', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 's1', order: 0, sourceText: '第一段', estimatedDurationSec: 8, status: 'done' },
      { id: 's2', order: 1, sourceText: '第二段', estimatedDurationSec: 9, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockImplementation(async (_model, segment) => [
      '分段1',
      '镜头1-1',
      `时长（秒）：${segment.estimatedDurationSec}`,
      `画面描述：${segment.sourceText}`,
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    const progress: Array<{ completed: number; total: number }> = [];
    await generateEpisodeVideoScript(AiModel.DeepseekChat, '第一段第二段', {
      onProgress: event => {
        if (event.stage === 'videoScript') {
          progress.push({ completed: event.completed, total: event.total });
        }
      },
    });

    expect(progress[0]).toEqual({ completed: 0, total: 2 });
    expect(progress).toEqual(expect.arrayContaining([
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ]));
  });

  it('does not block a short creative seed just because generated segments are below density targets', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 's1', order: 0, sourceText: '孙悟空冲向南天门。', estimatedDurationSec: 8, status: 'done' },
      { id: 's2', order: 1, sourceText: '天兵列阵拦截。', estimatedDurationSec: 8, status: 'done' },
      { id: 's3', order: 2, sourceText: '金箍棒横扫云海。', estimatedDurationSec: 8, status: 'done' },
      { id: 's4', order: 3, sourceText: '凌霄殿光影震荡。', estimatedDurationSec: 8, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockImplementation(async (_model, segment) => [
      '分段1',
      '镜头1-1',
      `时长（秒）：${segment.estimatedDurationSec}`,
      `画面描述：${segment.sourceText}`,
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    const result = await generateEpisodeVideoScript(
      AiModel.DeepseekChat,
      '孙悟空大闹天宫（仿照黑悟空的游戏剧情）',
    );

    expect(aiMocks.aiReplanInvalidScriptSegments).not.toHaveBeenCalled();
    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(result.segments).toHaveLength(4);
    expect(result.content).toContain('分段4');
    expect(result.content).toContain('分镜4-1');
  });


  it('normalizes an under-duration brief split instead of blocking the full three-stage run', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 'brief-low', order: 0, sourceText: '孙悟空大闹天宫', estimatedDurationSec: 3, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockImplementation(async (_model, segment) => {
      expect(segment.estimatedDurationSec).toBeNull();
      return [
        '分段1',
        '分镜1-1',
        '时长（秒）：8',
        '画面描述：孙悟空站在云海之上，金箍棒横扫天门。',
        '分镜1-2',
        '时长（秒）：6',
        '画面描述：南天门牌匾震颤，天兵举盾后退。',
        `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
        `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
      ].join('\n');
    });

    const progress: Array<{ stage: string; completed: number; total: number }> = [];
    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '孙悟空大闹天宫', {
      onProgress: event => progress.push({
        stage: event.stage,
        completed: event.completed,
        total: event.total,
      }),
    });

    expect(aiMocks.aiReplanInvalidScriptSegments).not.toHaveBeenCalled();
    expect(result.segments[0]).toEqual(expect.objectContaining({
      id: 'brief-low',
      order: 0,
      sourceText: '孙悟空大闹天宫',
      estimatedDurationSec: 8,
      videoScript: expect.stringContaining('分镜1-2'),
    }));
    expect(progress).toEqual(expect.arrayContaining([
      { stage: 'split', completed: 1, total: 1 },
      { stage: 'videoScript', completed: 1, total: 1 },
    ]));
  });

  it('keeps valid groups and repairs only the invalid group once', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 's1', order: 0, sourceText: '第一段', estimatedDurationSec: 15, status: 'done' },
      { id: 's2', order: 1, sourceText: '第二段', estimatedDurationSec: 10, status: 'done' },
      { id: 's3', order: 2, sourceText: '第三段', estimatedDurationSec: 14, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockImplementation(async (_model, segment) => {
      if (segment.sourceText === '第二段') {
        return [
          '分段1',
          '镜头1-1',
          '时长（秒）：8',
          '画面描述：第二段待修内容前半。',
          '镜头1-2',
          '时长（秒）：9',
          '画面描述：第二段待修内容后半。',
          `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
          `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
        ].join('\n');
      }
      return [
        '分段1',
        '镜头1-1',
        `时长（秒）：${segment.estimatedDurationSec}`,
        `画面描述：${segment.sourceText}合格内容保持不变。`,
        `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
        `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
      ].join('\n');
    });
    aiMocks.aiReplanInvalidVideoScript.mockResolvedValue([
      '分段1',
      '镜头1-1',
      '时长（秒）：10',
      '画面描述：第二段局部修复完成。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    const result = await generateEpisodeVideoScript(
      AiModel.DeepseekChat,
      '第一段第二段第三段',
    );

    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledTimes(3);
    expect(aiMocks.aiReplanInvalidVideoScript).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiReplanInvalidVideoScript).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      '第二段',
      expect.stringContaining('第二段待修内容'),
      '分段1累计17秒，超过15秒上限',
      expect.stringContaining('绝对不得超过15秒'),
      expect.any(String),
      expect.any(String),
      undefined,
    );
    expect(result.content).toContain('第一段合格内容保持不变');
    expect(result.content).toContain('第二段局部修复完成');
    expect(result.content).toContain('第三段合格内容保持不变');
    expect(result.content).not.toContain('第二段待修内容');
  });

  it('silently replans invalid stage-one duration and coverage output once', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 'bad', order: 0, sourceText: '遗漏原文', estimatedDurationSec: 17, status: 'done' },
    ]);
    aiMocks.aiReplanInvalidScriptSegments.mockResolvedValue([
      { id: 'fixed', order: 0, sourceText: '完整原文', estimatedDurationSec: 15, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue([
      '分段1',
      '镜头1-1',
      '时长（秒）：15',
      '画面描述：完整原文。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '完整原文');

    expect(aiMocks.aiReplanInvalidScriptSegments).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      '完整原文',
      expect.stringContaining('遗漏原文'),
      expect.stringContaining('4-15秒'),
      undefined,
    );
    expect(aiMocks.aiReplanInvalidScriptSegments).toHaveBeenCalledTimes(1);
    expect(result.segments[0].sourceText).toBe('完整原文');
    expect(result.content).toContain('时长（秒）：15');
  });

  it('hides stage-one contract details if automatic splitting repair is exhausted', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 'bad', order: 0, sourceText: '完整原文', estimatedDurationSec: 17, status: 'done' },
    ]);
    aiMocks.aiReplanInvalidScriptSegments.mockResolvedValue([
      { id: 'still-bad', order: 0, sourceText: '完整原文', estimatedDurationSec: 17, status: 'done' },
    ]);

    await expect(generateEpisodeVideoScript(AiModel.DeepseekChat, '完整原文'))
      .rejects.toThrow('剧本拆分未完成，系统已自动重新规划，请稍后再试');
    expect(aiMocks.aiReplanInvalidScriptSegments).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiGenerateVideoScriptFromSegment).not.toHaveBeenCalled();
  });

  it('accepts generated expansion without enforcing exact source coverage', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 'expanded', order: 0, sourceText: '孙悟空挥动金箍棒攻入南天门。', estimatedDurationSec: 15, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue([
      '分段1',
      '镜头1-1',
      '时长（秒）：15',
      '画面描述：孙悟空挥动金箍棒攻入南天门。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '孙悟空大闹天宫');

    expect(result.segments[0].sourceText).toContain('攻入南天门');
    expect(aiMocks.aiReplanInvalidScriptSegments).not.toHaveBeenCalled();
    expect(result.content).toContain('攻入南天门');
  });

  it('silently replans an over-limit first-generation segment before publishing progress', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 's1', order: 0, sourceText: '单段原文', estimatedDurationSec: 15, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue([
      '分段1',
      '镜头1-1',
      '时长（秒）：8',
      '画面描述：超限草稿前半段。',
      '镜头1-2',
      '时长（秒）：9',
      '画面描述：超限草稿后半段。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));
    aiMocks.aiReplanInvalidVideoScript.mockResolvedValue([
      '分段1',
      '镜头1-1',
      '时长（秒）：8',
      '画面描述：合格稿前半段。',
      '镜头1-2',
      '时长（秒）：7',
      '画面描述：合格稿后半段。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));
    const progress: string[] = [];

    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '单段原文', {
      onProgress: event => {
        if (event.content) progress.push(event.content);
      },
    });

    expect(aiMocks.aiReplanInvalidVideoScript).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiReplanInvalidVideoScript).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      '单段原文',
      expect.stringContaining('超限草稿'),
      '分段1累计17秒，超过15秒上限',
      expect.stringContaining('绝对不得超过15秒'),
      expect.any(String),
      expect.any(String),
      undefined,
    );
    expect(result.content).toContain('合格稿');
    expect(result.content).not.toContain('超限草稿');
    expect(progress.join('\n')).not.toContain('超限草稿');
    expect(() => assertValidVideoScript(result.content)).not.toThrow();
  });

  it('accepts stage-two duration drift from the stage-one estimate', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 's1', order: 0, sourceText: '单段原文', estimatedDurationSec: 15, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue([
      '分段1',
      '镜头1-1',
      '时长（秒）：13',
      '画面描述：时长偏离草稿。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));
    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '单段原文');

    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(result.content).toContain('时长偏离草稿');
  });

  it('silently completes short prompts in a revised version before returning it', async () => {
    aiMocks.aiIterateVideoScript.mockResolvedValue([
      '分段1',
      '镜头1-1',
      '时长（秒）：15',
      '画面描述：主角推门进入办公室。',
      '【视觉风格】都市写实。',
      '【正向稳定约束】人物与场景稳定。',
    ].join('\n'));

    const result = await iterateEpisodeVideoScript(
      AiModel.DeepseekChat,
      '原始剧本',
      validGroup,
      '让冲突更强',
      '',
    );
    const [group] = parseVideoScriptGroups(result.content);

    expect(countPromptCharacters(group.visualStyle)).toBeGreaterThanOrEqual(MIN_VISUAL_STYLE_CHARACTERS);
    expect(countPromptCharacters(group.stabilityConstraint))
      .toBeGreaterThanOrEqual(MIN_STABILITY_CONSTRAINT_CHARACTERS);
    expect(result.outputTexts).toEqual([result.content]);
  });

  it('buffers an invalid revision and only streams the replanned valid result', async () => {
    aiMocks.aiIterateVideoScript.mockResolvedValue(
      validGroup
        .replace('时长（秒）：7', '时长（秒）：9')
        .replace('主角停在办公桌前', '客户不可见的超限草稿'),
    );
    aiMocks.aiReplanInvalidVideoScript.mockResolvedValue(
      validGroup.replace('主角停在办公桌前', '重新规划后的合格稿'),
    );
    const onStream = vi.fn();

    const result = await iterateEpisodeVideoScript(
      AiModel.DeepseekChat,
      '原始剧本',
      validGroup,
      '让冲突更强',
      '此前意见',
      { onStream },
    );

    expect(aiMocks.aiReplanInvalidVideoScript).toHaveBeenCalledTimes(1);
    expect(onStream).toHaveBeenCalledTimes(1);
    expect(onStream).toHaveBeenCalledWith(result.content);
    expect(onStream).not.toHaveBeenCalledWith(expect.stringContaining('客户不可见的超限草稿'));
    expect(result.content).toContain('重新规划后的合格稿');
    expect(result.outputTexts).toEqual([result.content]);
  });

  it('hides internal validation details if automatic replanning is exhausted', async () => {
    const invalidDraft = validGroup.replace('时长（秒）：7', '时长（秒）：9');
    aiMocks.aiIterateVideoScript.mockResolvedValue(invalidDraft);
    aiMocks.aiReplanInvalidVideoScript.mockResolvedValue(invalidDraft);
    const onStream = vi.fn();

    await expect(iterateEpisodeVideoScript(
      AiModel.DeepseekChat,
      '原始剧本',
      validGroup,
      '让冲突更强',
      '',
      { onStream },
    )).rejects.toThrow('视频脚本生成未完成，系统已自动重新规划，请稍后再试');
    expect(aiMocks.aiReplanInvalidVideoScript).toHaveBeenCalledTimes(1);
    expect(onStream).not.toHaveBeenCalled();
  });

  it('runs stage three per source storyboard and builds fresh hierarchical cards', async () => {
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([{
      shotNo: '镜头1-1',
      shotSize: '近景',
      sceneDescription: '主角推门进入办公室。',
      characters: ['主角'],
      scene: '办公室',
      props: ['门'],
      imagePrompt: '近景，平视，主角推门，办公室日光。',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: 15,
    }]);

    const result = await generateStoryboardDesignForVersion(AiModel.DeepseekChat, [
      '分段1',
      '镜头1-1',
      '时长（秒）：15',
      '画面描述：主角推门进入办公室。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    expect(aiMocks.aiExtractStoryboardPromptsFromVideoShots).not.toHaveBeenCalled();
    expect(aiMocks.aiExtractStoryboardPromptFromVideoShot).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.stringContaining('镜头1-1'),
      '分镜1-1',
      expect.objectContaining({ suppressNotification: true }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].shotNumber).toBe('镜头1-1');
    expect(result.items[0].sourceVideoShotNo).toBe('分镜1-1');
    expect(result.items[0].imagePrompt).toContain('主角推门');
  });

  it('allows one source storyboard to split into multiple design shots while preserving total duration', async () => {
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([{
      shotNo: '镜头1-1',
      shotSize: '近景',
      sceneDescription: '主角推开办公室门。',
      characters: ['主角'],
      scene: '办公室门口',
      props: ['门'],
      imagePrompt: '近景，平视，主角推门，门口日光。',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: 5,
    }, {
      shotNo: '镜头1-2',
      shotSize: '中景',
      sceneDescription: '主角走进办公室看向桌边。',
      characters: ['主角'],
      scene: '办公室',
      props: ['办公桌'],
      imagePrompt: '中景，平视，主角进屋，办公室柔和日光。',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: null,
    }]);

    const result = await generateStoryboardDesignForVersion(AiModel.DeepseekChat, [
      '分段1',
      '镜头1-1',
      '时长（秒）：15',
      '画面描述：主角推门进入办公室。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    expect(result.items.map(item => item.shotNumber)).toEqual(['镜头1-1', '镜头1-2']);
    expect(result.items.map(item => item.sourceVideoShotNo)).toEqual(['分镜1-1', '分镜1-1']);
    expect(result.items.map(item => item.plannedDurationMs)).toEqual([5000, 10000]);
  });

  it('generates source shots concurrently but renders design cards in source order', async () => {
    let active = 0;
    let maxActive = 0;
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockImplementation(async (
      _model: AiModel,
      _videoShotBlock: string,
      canonicalShotNo: string,
    ) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(
        resolve,
        canonicalShotNo === '分镜1-1' ? 20 : 1,
      ));
      active -= 1;
      return [{
        shotNo: canonicalShotNo,
        shotSize: '近景',
        sceneDescription: `${canonicalShotNo}的画面`,
        characters: [],
        scene: '',
        props: [],
        imagePrompt: `${canonicalShotNo}，近景，平视，人物动作，室内环境，稳定光影。`,
        cameraAngle: '平视',
        cameraMove: '固定',
        dialogue: '',
        durationSec: canonicalShotNo.endsWith('-1') ? 8 : 7,
      }];
    });
    const secondGroup = validGroup
      .replace('分段1', '分段2')
      .replaceAll('镜头1-', '镜头2-')
      .replaceAll('主角', '配角')
      .replaceAll('办公室', '走廊');

    const result = await generateStoryboardDesignForVersion(
      AiModel.DeepseekChat,
      `${validGroup}\n\n${secondGroup}`,
    );

    expect(maxActive).toBe(4);
    expect(aiMocks.aiExtractStoryboardPromptFromVideoShot).toHaveBeenCalledTimes(4);
    expect(result.items.map(item => item.shotNumber)).toEqual([
      '镜头1-1',
      '镜头1-2',
      '镜头2-1',
      '镜头2-2',
    ]);
  });

  it('silently re-extracts incomplete stage-three output before creating cards', async () => {
    aiMocks.aiExtractStoryboardPromptsFromVideoShots.mockResolvedValue([{
      shotNo: '镜头1-1',
      shotSize: '近景',
      sceneDescription: '不完整批量草稿。',
      characters: ['主角'],
      scene: '办公室',
      props: [],
      imagePrompt: '',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: 15,
    }]);
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([{
      shotNo: '镜头1-1',
      shotSize: '近景',
      sceneDescription: '不完整草稿。',
      characters: ['主角'],
      scene: '办公室',
      props: [],
      imagePrompt: '',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: 15,
    }]);
    aiMocks.aiReplanInvalidStoryboardExtraction.mockResolvedValue([{
      shotNo: '镜头1-1',
      shotSize: '近景',
      sceneDescription: '重新提取后的完整画面。',
      characters: ['主角'],
      scene: '办公室',
      props: ['门'],
      imagePrompt: '近景，平视，主角推门进入办公室，日光稳定。',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: 15,
    }]);

    const result = await generateStoryboardDesignForVersion(AiModel.DeepseekChat, [
      '分段1',
      '镜头1-1',
      '时长（秒）：15',
      '画面描述：主角推门进入办公室。',
      '【视觉风格】都市写实。',
      '【正向稳定约束】人物与场景稳定。',
    ].join('\n'));

    expect(aiMocks.aiReplanInvalidStoryboardExtraction).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.stringContaining('主角推门进入办公室'),
      '分镜1-1',
      expect.stringContaining('不完整草稿'),
      '分镜1-1第1个镜头设计缺少画面描述、分镜生成提示词或有效时长',
      expect.objectContaining({ suppressNotification: true }),
    );
    expect(result.items[0].imagePrompt).toContain('主角推门');
    expect(result.outputTexts.join('\n')).toContain('重新提取后的完整画面');
  });

  it('hides stage-three extraction details if automatic repair is exhausted', async () => {
    aiMocks.aiExtractStoryboardPromptsFromVideoShots.mockResolvedValue([]);
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([]);
    aiMocks.aiReplanInvalidStoryboardExtraction.mockResolvedValue([]);

    await expect(generateStoryboardDesignForVersion(AiModel.DeepseekChat, [
      '分段1',
      '镜头1-1',
      '时长（秒）：15',
      '画面描述：主角推门进入办公室。',
      '【视觉风格】都市写实。',
      '【正向稳定约束】人物与场景稳定。',
    ].join('\n'))).rejects.toThrow('镜头设计生成未完成，系统已自动重新提取，请稍后再试');
    expect(aiMocks.aiReplanInvalidStoryboardExtraction).toHaveBeenCalledTimes(1);
  });
});
