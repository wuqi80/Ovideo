import { describe, expect, it } from 'vitest';
import {
  EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT,
  GENERATE_VIDEO_SCRIPT_FROM_SEGMENT,
  ITERATE_VIDEO_SCRIPT,
  SPLIT_SCRIPT_INTO_SEGMENTS,
} from '../../prompts/scriptPipelinePrompts';

describe('latest three-step script prompts', () => {
  it('keeps the stage-one duration density requirements', () => {
    expect(SPLIT_SCRIPT_INTO_SEGMENTS.user).toContain('14-15秒的段落应占30%以上');
    expect(SPLIT_SCRIPT_INTO_SEGMENTS.user).toContain('平均时长应≥10秒');
    expect(SPLIT_SCRIPT_INTO_SEGMENTS.user).toContain('情绪闭环');
  });

  it('uses the latest stage-two rules and hierarchical numbering', () => {
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain('每组中镜头数严禁大于5个');
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain('1-2 日 内 浅浅家');
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain('镜头1-1');
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain('镜头2-1');
  });

  it('merges revisions with both stage-one and full stage-two constraints', () => {
    expect(ITERATE_VIDEO_SCRIPT.user).toContain('14-15秒的段落必须占30%以上');
    expect(ITERATE_VIDEO_SCRIPT.user).toContain('每组中镜头数严禁大于5个');
    expect(ITERATE_VIDEO_SCRIPT.user).toContain('镜头1-1、镜头1-2、镜头2-1');
  });

  it('restores the latest stage-three image prompt field', () => {
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('分镜生成提示词：用于AI生成分镜图片的提示词');
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('景别（只需要景别不要运镜）、角度、主体、动作、环境、光影');
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('{canonicalShotNo}');
  });
});
