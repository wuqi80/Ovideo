import { describe, expect, it } from 'vitest';
import {
  convertToStoryboardItem,
  estimateDialogueDurationSeconds,
  parseStreamingBlocks,
} from '../../utils/storyboardParser';

describe('storyboard dialogue duration', () => {
  it('estimates Chinese and English dialogue with their configured speaking rates', () => {
    expect(estimateDialogueDurationSeconds('女生：“一二三四五六七八。”')).toBe(2);
    expect(estimateDialogueDurationSeconds('Narrator: "abcdefgh12345678"')).toBe(2);
    expect(estimateDialogueDurationSeconds('角色：“一二三四abcdefgh”')).toBe(2);
  });

  it('raises a shot duration when it cannot contain the complete dialogue', () => {
    const item = convertToStoryboardItem({
      shotId: '镜头01',
      时间: '1秒',
      人声: '女生：“一二三四五六七八。”',
    });

    expect(item.duration).toBe('2秒');
    expect(item.originalText).toContain('时间：2秒');
  });

  it('keeps a longer authored duration intact', () => {
    const item = convertToStoryboardItem({
      shotId: '镜头01',
      时间: '4秒',
      人声: '女生：“一二三四五六七八。”',
    });

    expect(item.duration).toBe('4秒');
  });

  it('carries standalone segment headings across shot blocks', () => {
    const parsed = parseStreamingBlocks([
      '分段01',
      '镜头01',
      '时间：4秒',
      '---CUT---',
      '镜头02',
      '时间：5秒',
      '---CUT---',
      '分段02',
      '镜头03',
      '时间：4秒',
      '---CUT---',
    ].join('\n'));

    expect(parsed.completedBlocks.map(block => block.segmentNo)).toEqual([1, 1, 2]);
  });
});
