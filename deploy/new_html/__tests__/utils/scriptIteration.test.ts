import { describe, expect, it } from 'vitest';
import {
  buildScriptIterationContext,
  ensureStoryboardCutSeparators,
  normalizeScriptIterationResult,
} from '../../utils/scriptIteration';
import {
  CONTINUE_STORYBOARD_SCRIPT,
  GENERATE_STORYBOARD_SCRIPT,
  ITERATE_FULL_SCRIPT,
} from '../../prompts/scriptPrompts';

describe('script iteration helpers', () => {
  it('keeps recent conversation instructions in a compact context', () => {
    const context = buildScriptIterationContext([
      { role: 'user', content: '让第一场冲突更强。' },
      { role: 'assistant', content: '已生成候选版本。' },
      { role: 'user', content: '保留原来的结尾。' },
    ]);

    expect(context).toContain('用户：让第一场冲突更强。');
    expect(context).toContain('系统：已生成候选版本。');
    expect(context).toContain('用户：保留原来的结尾。');
  });

  it('uses an explicit first-turn marker and strips markdown fences', () => {
    expect(buildScriptIterationContext([])).toBe('（首次修改，无历史意见）');
    expect(normalizeScriptIterationResult('```text\n第一场\n```')).toBe('第一场');
  });

  it('restores missing CUT delimiters between standalone shot headers', () => {
    const normalized = ensureStoryboardCutSeparators([
      '镜头01',
      '人声：甲：“你好。”',
      '时间：2秒',
      '镜头02',
      '人声：乙：“你好。”',
      '时间：2秒',
    ].join('\n'));

    expect(normalized).toContain('时间：2秒\n---CUT---\n镜头02');
  });

  it('places a missing CUT before a new segment heading', () => {
    const normalized = ensureStoryboardCutSeparators([
      '分段01',
      '镜头01',
      '时间：8秒',
      '分段02',
      '镜头02',
      '时间：5秒',
    ].join('\n'));

    expect(normalized).toContain('时间：8秒\n---CUT---\n分段02\n镜头02');
  });

  it('allows every revision turn to adjust shot count for the current creative request', () => {
    const text = `${ITERATE_FULL_SCRIPT.system || ''}\n${ITERATE_FULL_SCRIPT.user}`;
    expect(text).toContain('不得被上一版本的镜头总数限制');
    expect(text).toContain('允许依据本轮意见自由调整镜头数量');
    expect(text).not.toContain('镜头总数必须保持不变');
  });

  it('requires dialogue-aware timing in initial, continued, and revised storyboards', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT, ITERATE_FULL_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toContain('中文');
      expect(text).toContain('4 字/秒');
      expect(text).toContain('8 字符/秒');
    });
  });

  it('requires explicit storyboard segments capped near fifteen seconds', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT, ITERATE_FULL_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toMatch(/分段(?:XX|N)/);
      expect(text).toContain('15 秒');
    });
  });

  it('requires one complete production constraint footer for every segment', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toContain('【视觉风格】');
      expect(text).toContain('【正向稳定约束】');
      expect(text).toContain('每个分段');
      expect(text).toContain('约25字');
      expect(text).toContain('约200字');
    });
  });

  it('uses the new three-step storyboard fields instead of obsolete description groups', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toContain('剧本拆分');
      expect(text).toContain('分镜提取');
      expect(text).toContain('视频脚本');
      expect(text).toContain('分镜生成提示词');
      expect(text).toContain('拍摄角度');
      expect(text).toContain('运镜方式');
      expect(text).toContain('光影色调');
      expect(text).toContain('不得输出“站位与构图”');
      expect(text).not.toContain('站位与构图至少');
      expect(text).not.toContain('动作与神态至少');
    });
  });

  it('uses the complete reference constraints and hierarchical shot numbers without output markers', () => {
    const text = `${GENERATE_STORYBOARD_SCRIPT.system || ''}\n${GENERATE_STORYBOARD_SCRIPT.user}`;
    expect(text).toContain('镜头1-1');
    expect(text).toContain('古风写实，暖黄暗调，室内光影层次丰富，略带神秘氛围。');
    expect(text).toContain('同一场景内，所有镜头的摄影机机位、人物朝向');
    expect(text).not.toContain('---CUT---');
    expect(text).not.toContain('<<<CONTINUE_FROM');
  });
});
