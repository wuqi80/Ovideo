import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../components/GenerationPage.tsx'),
  'utf-8',
).replace(/\r\n/g, '\n');

describe('generation page model selectors', () => {
  it('uses the shared capability catalog for default and per-shot dropdowns', () => {
    expect(source).toContain('aria-label="默认生成模型"');
    expect(source).toContain('aria-label={`${shotLabel}生成模型`}');
    expect(source.match(/STORYBOARD_GENERATION_MODEL_OPTIONS\.map/g)).toHaveLength(2);
    expect(source).not.toContain('const models: GenerationModel[]');
    expect(source).not.toContain('点击切换模型');
  });

  it('derives the processing-cluster set from model capabilities', () => {
    expect(source).toContain('.filter(option => option.requiresCluster)');
    expect(source).toContain('globalModelOption.hint');
    expect(source).toContain('每个分镜可在左侧列表中使用下拉菜单单独覆盖默认模型。');
  });
});
