import { describe, expect, it } from 'vitest';
import {
  buildStoryboardValidationInstruction,
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

  it('allows any positive reduction explicitly requested by the user', () => {
    expect(validateStoryboardIterationCount(49, 1, '剧本镜头太多，减少几个镜头')).toEqual({ valid: true });
    expect(validateStoryboardIterationCount(49, 40, '剧本镜头太多，减少几个镜头')).toEqual({ valid: true });
  });

  it('preserves shot count unless the user explicitly changes it', () => {
    expect(validateStoryboardIterationCount(12, 11, '让人物语气更自然')).toMatchObject({ valid: false });
    expect(validateStoryboardIterationCount(12, 12, '让人物语气更自然')).toEqual({ valid: true });
    expect(validateStoryboardIterationCount(12, 8, '压缩到 8 个镜头')).toEqual({ valid: true });
  });

  it('inherits the latest reduction request for a referential retry', () => {
    const instruction = buildStoryboardValidationInstruction(
      '重新按照要求生成脚本，需要有分段。',
      [
        '剧本镜头太多，减少几个镜头。',
        '重新生成镜头。',
      ],
    );

    expect(validateStoryboardIterationCount(49, 45, instruction)).toEqual({ valid: true });
    expect(buildStoryboardValidationInstruction('调整人物语气', '减少几个镜头')).toBe('调整人物语气');
  });

  it('uses the latest successful version count on later unrelated turns', () => {
    expect(validateStoryboardIterationCount(45, 45, '调整人物语气')).toEqual({ valid: true });
    expect(validateStoryboardIterationCount(45, 44, '调整人物语气')).toMatchObject({ valid: false });
    expect(validateStoryboardIterationCount(45, 42, '继续按照之前减少镜头的要求生成')).toEqual({ valid: true });
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
      expect(text).toContain('分段XX');
      expect(text).toContain('15 秒');
    });
  });
});
