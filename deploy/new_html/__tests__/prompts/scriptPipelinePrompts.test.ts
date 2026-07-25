import { describe, expect, it } from 'vitest';
import {
  EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT,
  GENERATE_VIDEO_SCRIPT_FROM_SEGMENT,
  GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS,
  ITERATE_VIDEO_SCRIPT,
  REPLAN_INVALID_SCRIPT_SEGMENTS,
  REPLAN_INVALID_STORYBOARD_EXTRACTION,
  REPLAN_INVALID_VIDEO_SCRIPT,
  SPLIT_SCRIPT_INTO_SEGMENTS,
} from '../../prompts/scriptPipelinePrompts';
import {
  MIN_STABILITY_CONSTRAINT_CHARACTERS,
  MIN_VISUAL_STYLE_CHARACTERS,
  STABILITY_CONSTRAINT_REFERENCE,
  VISUAL_STYLE_REFERENCE,
} from '../../utils/scriptPromptStandards';

describe('latest three-step script prompts', () => {
  it('locks the user-provided prompt-length benchmarks', () => {
    expect(MIN_VISUAL_STYLE_CHARACTERS).toBe(25);
    expect(MIN_STABILITY_CONSTRAINT_CHARACTERS).toBe(200);
  });

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
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain(`约${MIN_VISUAL_STYLE_CHARACTERS}字为完整度基准`);
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain(`约${MIN_STABILITY_CONSTRAINT_CHARACTERS}字为完整度基准`);
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain('不足时继续增加约束细节');
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain(VISUAL_STYLE_REFERENCE);
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENT.user).toContain(STABILITY_CONSTRAINT_REFERENCE);
  });

  it('generates all stage-one segments in one stage-two request', () => {
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS.user).toContain('{segmentsText}');
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS.user).toContain('输入有多少个分段，输出必须有且仅有多少个分段');
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS.user).toContain('镜头累计时长必须与该输入分段标注的时长完全一致');
    expect(GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS.user).toContain('发现局部不合格时只修正该段');
  });

  it('merges revisions with both stage-one and full stage-two constraints', () => {
    expect(ITERATE_VIDEO_SCRIPT.user).toContain('14-15秒的段落必须占30%以上');
    expect(ITERATE_VIDEO_SCRIPT.user).toContain('每组中镜头数严禁大于5个');
    expect(ITERATE_VIDEO_SCRIPT.user).toContain('镜头1-1、镜头1-2、镜头2-1');
    expect(ITERATE_VIDEO_SCRIPT.user).toContain(
      `分别以约${MIN_VISUAL_STYLE_CHARACTERS}字、约${MIN_STABILITY_CONSTRAINT_CHARACTERS}字为完整度基准`,
    );
    expect(ITERATE_VIDEO_SCRIPT.user).toContain('不足时继续增加细节');
  });

  it('keeps validation failures internal while replanning the whole draft', () => {
    expect(REPLAN_INVALID_VIDEO_SCRIPT.system).toContain('不得输出质检过程');
    expect(REPLAN_INVALID_VIDEO_SCRIPT.user).toContain('{validationError}');
    expect(REPLAN_INVALID_VIDEO_SCRIPT.user).toContain('{invalidVideoScript}');
    expect(REPLAN_INVALID_VIDEO_SCRIPT.user).toContain('累计时长不得超过15秒');
    expect(REPLAN_INVALID_VIDEO_SCRIPT.user).toContain('只输出最终完整脚本');
  });

  it('keeps repairable stage-one and stage-three errors inside their quality loops', () => {
    expect(REPLAN_INVALID_SCRIPT_SEGMENTS.system).toContain('不得输出质检反馈');
    expect(REPLAN_INVALID_SCRIPT_SEGMENTS.user).toContain('所有段落拼接后与原文一致');
    expect(REPLAN_INVALID_SCRIPT_SEGMENTS.user).toContain('{validationError}');
    expect(REPLAN_INVALID_STORYBOARD_EXTRACTION.system).toContain('只输出最终镜头设计');
    expect(REPLAN_INVALID_STORYBOARD_EXTRACTION.user).toContain('分镜生成提示词不得为空');
    expect(REPLAN_INVALID_STORYBOARD_EXTRACTION.user).toContain('{invalidExtraction}');
  });

  it('restores the latest stage-three image prompt field', () => {
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('分镜生成提示词：用于AI生成分镜图片的提示词');
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('景别（只需要景别不要运镜）、角度、主体、动作、环境、光影');
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('{canonicalShotNo}');
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('{expectedShotNumbers}');
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('逐个一一对应');
    expect(EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT.user).toContain('不得合并、拆分、遗漏、重复或调换顺序');
  });
});
