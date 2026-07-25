import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiModel } from '../../types';

const aiMocks = vi.hoisted(() => ({
  aiSplitScriptIntoSegments: vi.fn(),
  aiGenerateVideoScriptFromSegment: vi.fn(),
  aiIterateVideoScript: vi.fn(),
  aiExtractStoryboardPromptFromVideoShot: vi.fn(),
}));

vi.mock('../../services/aiModelService', () => aiMocks);

import {
  assertValidVideoScript,
  generateEpisodeVideoScript,
  generateStoryboardDesignForVersion,
} from '../../services/scriptThreeStageService';

const validGroup = [
  '分段1',
  '镜头1-1',
  '时长（秒）：8',
  '画面描述：主角推门进入办公室。',
  '镜头1-2',
  '时长（秒）：7',
  '画面描述：主角停在办公桌前。',
  '【视觉风格】现代都市写实，日光统一。',
  '【正向稳定约束】角色和场景固定，无字幕、无水印。',
].join('\n');

describe('three-stage video script contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a valid hierarchical group', () => {
    expect(() => assertValidVideoScript(validGroup)).not.toThrow();
  });

  it('rejects groups over the 15-second limit', () => {
    expect(() => assertValidVideoScript(validGroup.replace('时长（秒）：7', '时长（秒）：8')))
      .toThrow('超过15秒上限');
  });

  it('rejects missing stability requirements', () => {
    expect(() => assertValidVideoScript(validGroup.replace(/【正向稳定约束】.*$/, '')))
      .toThrow('缺少独立的视觉风格或正向稳定约束');
  });

  it('rejects duplicate or discontinuous hierarchical numbers', () => {
    expect(() => assertValidVideoScript(validGroup.replace('镜头1-2', '镜头1-1')))
      .toThrow('镜头编号不连续');
  });

  it('runs stage one before stage two and canonicalizes all returned groups', async () => {
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue([
      { id: 's1', order: 0, sourceText: '第一段', estimatedDurationSec: 15, status: 'done' },
      { id: 's2', order: 1, sourceText: '第二段', estimatedDurationSec: 10, status: 'done' },
      { id: 's3', order: 2, sourceText: '第三段', estimatedDurationSec: 14, status: 'done' },
    ]);
    aiMocks.aiGenerateVideoScriptFromSegment.mockImplementation(async (_model, segment) => [
      '分段1',
      '镜头1',
      `时长（秒）：${segment.estimatedDurationSec}`,
      `画面描述：${segment.sourceText}`,
      '【视觉风格】都市写实。',
      '【正向稳定约束】人物与场景稳定。',
    ].join('\n'));

    const progress: string[] = [];
    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '原始剧本', {
      onProgress: event => {
        if (event.content) progress.push(event.content);
      },
    });

    expect(aiMocks.aiSplitScriptIntoSegments).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledTimes(3);
    expect(result.content).toContain('分段1\n镜头1-1');
    expect(result.content).toContain('分段2\n镜头2-1');
    expect(result.content).toContain('分段3\n镜头3-1');
    expect(progress.at(-1)).toBe(result.content);
  });

  it('runs stage three for a selected version and builds fresh hierarchical cards', async () => {
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
      '【视觉风格】都市写实。',
      '【正向稳定约束】人物与场景稳定。',
    ].join('\n'));

    expect(aiMocks.aiExtractStoryboardPromptFromVideoShot).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.stringContaining('镜头1-1'),
      '镜头1-1',
      undefined,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].shotNumber).toBe('镜头1-1');
    expect(result.items[0].imagePrompt).toContain('主角推门');
  });
});
