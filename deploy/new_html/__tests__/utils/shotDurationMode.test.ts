import { describe, expect, it } from 'vitest';
import {
  buildShotDurationInstruction,
  DEFAULT_SHOT_DURATION_MODE,
} from '../../utils/shotDurationMode';

describe('shotDurationMode', () => {
  it('defaults to the directly completed 10-15 second mode', () => {
    expect(DEFAULT_SHOT_DURATION_MODE).toBe('complete');
    expect(buildShotDurationInstruction(DEFAULT_SHOT_DURATION_MODE)).toContain('10-15 秒');
  });

  it('describes short shots and subsequent merging in fragmented mode', () => {
    const instruction = buildShotDurationInstruction('fragmented');

    expect(instruction).toContain('3-5 秒');
    expect(instruction).toContain('不超过 15 秒');
    expect(instruction).toContain('不得为了满足 3-5 秒而截断台词');
  });

  it('keeps dialogue timing as a hard constraint in both modes', () => {
    expect(buildShotDurationInstruction('complete')).toContain('不得短于对白朗读时间');
    expect(buildShotDurationInstruction('fragmented')).toContain('不得短于对白朗读时间');
  });
});
