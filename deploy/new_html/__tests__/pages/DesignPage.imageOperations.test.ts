import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../pages/DesignPage.tsx'), 'utf-8');

describe('DesignPage image operation modals', () => {
  it('uses discrete angle choices instead of fixed-step sliders', () => {
    expect(source).toContain('const DiscreteChoiceControl');
    expect(source).toContain("label=\"水平旋转\"");
    expect(source).toContain("label=\"推进距离\"");
    expect(source).toContain("label=\"垂直视角\"");
    expect(source).not.toContain('type="range"');
  });

  it('explains how the generation seed affects results', () => {
    expect(source).toContain('相同种子配合相同参数，更容易得到构图相近的结果');
    expect(source).toContain('随机种子用于探索新的构图');
  });

  it('shares the green-border material picker across all image operations', () => {
    expect(source.match(/<OperationMaterialPicker/g)).toHaveLength(2);
    expect(source).toContain("'border-success ring-2 ring-success/30'");
    expect(source).toContain('aria-pressed={active}');
  });

  it('keeps upscale and watermark processing in the same two-column modal layout', () => {
    expect(source).toContain('max-w-5xl');
    expect(source).toContain("workflow === 'upscale_hd'");
    expect(source).toContain('对左侧选中的素材进行高清重建和细节增强');
    expect(source).toContain('对左侧选中的素材执行水印清理');
  });

  it('does not read downstream material-stage images back into design', () => {
    expect(source).toContain('isDesignAssetImageFileRole');
    expect(source).toContain('isMaterialStageAssetImageFileRole');
    expect(source).toContain('.filter(f => isDesignAssetImageFileRole(f.fileRole)');
    expect(source).toContain('const materialStageUrls = new Set(');
  });

  it('keeps AI generation actions visible in short desktop viewports', () => {
    expect(source).toContain('max-h-[calc(100vh-1.5rem)]');
    expect(source).toContain('sm:max-h-[calc(100vh-2rem)]');
    expect(source).toContain('flex shrink-0 items-center justify-between px-6 pt-6 pb-4');
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto px-6 pb-5');
    expect(source).toContain('flex shrink-0 flex-wrap items-center justify-between');
  });

  it('keeps image-to-image controls on a stable second row', () => {
    expect(source).toContain('mt-3 grid min-h-[44px]');
    expect(source).toContain('invisible pointer-events-none');
    expect(source).toContain('生成张数');
    expect(source).toContain('参考图 + 生成图 ≤ 15');
  });

  it('only enables and submits selected references in image-to-image mode', () => {
    expect(source).toContain('disabled={!imageToImageEnabled}');
    expect(source).toContain('if (!imageToImageEnabled) return;');
    expect(source).toContain('references: imageToImageEnabled');
    expect(source).toContain("sequential: imageToImageEnabled ? 'auto' : 'disabled'");
  });

  it('defaults refinement to Jindan and lists it before Huashen', () => {
    expect(source).toContain("LS.get('design_ai_refine_model', AiModel.DeepseekChat)");
    expect(source).toContain('[AiModel.DeepseekChat, AiModel.Gemini].map');
    expect(source).toContain('formatScriptModelDisplay(option)');
  });
});
