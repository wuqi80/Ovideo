import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../components/GenerationPage.tsx'),
  'utf-8',
).replace(/\r\n/g, '\n');

describe('generation page model selectors', () => {
  it('places the shared default selector in the header and the current-shot override in the config card', () => {
    expect(source).toContain('aria-label="默认生成模型"');
    expect(source).toContain('aria-label="当前镜头生成模型"');
    expect(source).toContain('<option value="">跟随默认 · {globalModelOption.shortLabel}</option>');
    expect(source).not.toContain('aria-label={`${shotLabel}生成模型`}');
    expect(source.match(/STORYBOARD_GENERATION_MODEL_OPTIONS\.map/g)).toHaveLength(2);
    expect(source).not.toContain('const models: GenerationModel[]');
    expect(source).not.toContain('点击切换模型');
  });

  it('derives the processing-cluster set from model capabilities', () => {
    expect(source).toContain('.filter(option => option.requiresCluster)');
    expect(source).toContain('selectedGenerationModelOption.hint');
    expect(source).toContain('COMFYUI_MODELS.has(selectedGenerationModel)');
    expect(source).toContain('顶部设置全局默认模型；当前镜头可以跟随默认，也可在此单独覆盖。');
  });

  it('applies config locking immediately and disables current-shot configuration controls', () => {
    expect(source).toContain('const [configLockDrafts, setConfigLockDrafts]');
    expect(source).toContain('const newState = !isStoryboardConfigLocked(selectedShot);');
    expect(source).toContain('aria-pressed={selectedConfigLocked}');
    expect(source).toContain('disabled={!selectedShot || selectedConfigLocked || isGenerating}');
    expect(source).toContain('disabled={selectedConfigLocked || isGenerating}');
    expect(source).toContain('disabled={selectedConfigLocked}');
  });
});
