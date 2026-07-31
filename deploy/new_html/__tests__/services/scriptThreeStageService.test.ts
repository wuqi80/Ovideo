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
  generateVideoScriptForSegments,
  iterateEpisodeVideoScript,
  prepareVideoScriptSegments,
} from '../../services/scriptThreeStageService';
import {
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

function oneShotGroup(text = '主角推门进入办公室。', duration = 15): string {
  return [
    '分段1',
    '镜头1-1',
    `时长（秒）：${duration}`,
    `画面描述：${text}`,
    `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
    `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
  ].join('\n');
}

describe('three-stage script pipeline prefers usable output over blocking validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only requires stage-two text to contain parseable groups', () => {
    expect(() => assertValidVideoScript(validGroup)).not.toThrow();
    expect(() => assertValidVideoScript(validGroup.replace('时长（秒）：7', '时长（秒）：99'))).not.toThrow();
    expect(() => assertValidVideoScript(validGroup.replace(/【正向稳定约束】.*$/, ''))).not.toThrow();
    expect(() => assertValidVideoScript(validGroup.replace('镜头1-2', '镜头1-1'))).not.toThrow();
    expect(() => assertValidVideoScript('只有普通文字，没有分段和分镜')).toThrow('第二步未解析出有效分段和分镜');
  });

  it('uses one local seed call for a short idea but returns the generated groups as formal segments', async () => {
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

    expect(aiMocks.aiSplitScriptIntoSegments).not.toHaveBeenCalled();
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
    expect(result.segments).toHaveLength(2);
    expect(result.segments.map(segment => segment.estimatedDurationSec)).toEqual([8, 7]);
    expect(result.segments[0].videoScript).toContain('分段1');
    expect(result.segments[1].videoScript).toContain('分段2');
    expect(parseVideoScriptGroups(result.content)).toHaveLength(2);
    expect(result.content).toContain('天兵在南天门前列阵');
    expect(progress).toEqual(expect.arrayContaining([
      { stage: 'split', completed: 1, total: 1 },
      { stage: 'videoScript', completed: 1, total: 1 },
      { stage: 'videoScript', completed: 2, total: 2 },
    ]));
  });

  it('collapses stale over-split short-idea segments before video-script generation', async () => {
    const staleSegments = Array.from({ length: 21 }, (_, index) => ({
      id: `s${index + 1}`,
      order: index,
      sourceText: `错误拆出的第${index + 1}段`,
      estimatedDurationSec: 8,
      status: 'done' as const,
    }));
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue(oneShotGroup('孙悟空冲向南天门。', 8));

    const prepared = prepareVideoScriptSegments('孙悟空大闹天宫（仿照黑悟空的游戏剧情）', staleSegments);
    const progress: Array<{ completed: number; total: number }> = [];
    const result = await generateVideoScriptForSegments(
      AiModel.DeepseekChat,
      '孙悟空大闹天宫（仿照黑悟空的游戏剧情）',
      staleSegments,
      {
        onProgress: event => {
          if (event.stage === 'videoScript') progress.push({ completed: event.completed, total: event.total });
        },
      },
    );

    expect(prepared).toHaveLength(1);
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledTimes(1);
    expect(progress[0]).toEqual({ completed: 0, total: 1 });
    expect(progress.at(-1)).toEqual({ completed: 1, total: 1 });
    expect(result.segments).toHaveLength(1);
    expect(result.content).toContain('孙悟空冲向南天门');
  });

  it('keeps long-form split generation but no longer replans bad durations or prompt details', async () => {
    const longSource = '这是一段超过八十字的正式剧本文本，用来模拟用户输入较长原文时仍然需要模型拆分，但拆分结果不再因为时长或密度校验被自动重跑。主角进入办公室后与客户爆发争执，客户拿出合同质疑交付延期，主角努力解释系统故障和补救方案，双方情绪逐渐升级。';
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 'bad-duration', order: 0, sourceText: '主角进入办公室。', estimatedDurationSec: 17, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue(oneShotGroup('主角进入办公室。', 17));

    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, longSource);

    expect(aiMocks.aiSplitScriptIntoSegments).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiReplanInvalidScriptSegments).not.toHaveBeenCalled();
    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(result.content).toContain('时长（秒）：17');
  });

  it('returns a revised storyboard script as-is instead of buffering and replanning it', async () => {
    const invalidButParseable = validGroup
      .replace('时长（秒）：7', '时长（秒）：99')
      .replace('主角停在办公桌前', '客户可见的待人工修改草稿');
    aiMocks.aiIterateVideoScript.mockResolvedValue(invalidButParseable);
    const onStream = vi.fn();

    const result = await iterateEpisodeVideoScript(
      AiModel.DeepseekChat,
      '原始剧本',
      validGroup,
      '让冲突更强',
      '此前意见',
      { onStream },
    );

    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(onStream).toHaveBeenCalledTimes(1);
    expect(onStream).toHaveBeenCalledWith(result.content);
    expect(result.content).toContain('客户可见的待人工修改草稿');
  });

  it('runs stage three per source storyboard and lets one source split into multiple design shots', async () => {
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
      '分镜1-1',
      '时长（秒）：15',
      '画面描述：主角推门进入办公室。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    expect(aiMocks.aiExtractStoryboardPromptFromVideoShot).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.stringContaining('分镜1-1'),
      '分镜1-1',
      expect.objectContaining({ suppressNotification: true }),
    );
    expect(aiMocks.aiReplanInvalidStoryboardExtraction).not.toHaveBeenCalled();
    expect(result.items.map(item => item.shotNumber)).toEqual(['镜头1-1', '镜头1-2']);
    expect(result.items.map(item => item.sourceVideoShotNo)).toEqual(['分镜1-1', '分镜1-1']);
    expect(result.items.map(item => item.plannedDurationMs)).toEqual([5000, 10000]);
  });

  it('keeps incomplete stage-three output visible instead of auto-reextracting it', async () => {
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([{
      shotNo: '镜头1-1',
      shotSize: '近景',
      sceneDescription: '不完整但可人工修改的镜头设计。',
      characters: ['主角'],
      scene: '办公室',
      props: [],
      imagePrompt: '',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: 15,
    }]);

    const result = await generateStoryboardDesignForVersion(AiModel.DeepseekChat, oneShotGroup('主角推门进入办公室。', 15));

    expect(aiMocks.aiReplanInvalidStoryboardExtraction).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].scriptSegment).toContain('不完整但可人工修改');
  });

  it('only fails stage three when no design item is returned at all', async () => {
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([]);

    await expect(generateStoryboardDesignForVersion(AiModel.DeepseekChat, oneShotGroup('主角推门进入办公室。', 15)))
      .rejects.toThrow('镜头设计生成未返回可用内容，请手动调整分镜脚本后重试');
    expect(aiMocks.aiReplanInvalidStoryboardExtraction).not.toHaveBeenCalled();
  });
});
