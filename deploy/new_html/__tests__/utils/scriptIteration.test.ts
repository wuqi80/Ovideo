import { describe, expect, it } from 'vitest';
import {
  buildScriptIterationContext,
  ensureStoryboardCutSeparators,
  normalizeScriptIterationResult,
  validateStoryboardIterationCount,
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

  it('rejects catastrophic shot collapse for a vague reduction request', () => {
    expect(validateStoryboardIterationCount(49, 1, '剧本镜头太多，减少几个镜头')).toMatchObject({
      valid: false,
    });
    expect(validateStoryboardIterationCount(49, 40, '剧本镜头太多，减少几个镜头')).toEqual({ valid: true });
  });

  it('preserves shot count unless the user explicitly changes it', () => {
    expect(validateStoryboardIterationCount(12, 11, '让人物语气更自然')).toMatchObject({ valid: false });
    expect(validateStoryboardIterationCount(12, 12, '让人物语气更自然')).toEqual({ valid: true });
    expect(validateStoryboardIterationCount(12, 8, '压缩到 8 个镜头')).toEqual({ valid: true });
  });

  it('requires dialogue-aware timing in initial, continued, and revised storyboards', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT, ITERATE_FULL_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toContain('中文');
      expect(text).toContain('4 字/秒');
      expect(text).toContain('8 字符/秒');
    });
  });
});
