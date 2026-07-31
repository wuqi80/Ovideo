import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/MaterialPage.tsx'), 'utf-8');

describe('MaterialPage AI generation modal', () => {
  it('uses the same unified generation controls as the design workspace', () => {
    expect(source).toContain('生成图 / 参考图 (最多 {maxRefs})');
    expect(source).toContain('AI 润色');
    expect(source).toContain('MATERIAL_IMAGE_STYLE_PRESETS.map');
    expect(source).toContain('DESIGN_IMAGE_MODEL_OPTIONS.map');
    expect(source).toContain("generationModel.resolutions.map");
    expect(source).toContain('图生图');
    expect(source).toContain('InlineCreditEstimate');
    expect(source).toContain('generationModel.hint');
    expect(source).toContain('<option key={option.id} value={option.id}>{option.label}</option>');
    expect(source).not.toContain('{option.label} · {option.runtime}');
  });

  it('keeps the design modal sizing and removes the legacy engine sidebar', () => {
    expect(source).toContain('w-full max-w-5xl flex-col');
    expect(source).toContain('max-h-[calc(100vh-1.5rem)]');
    expect(source).not.toContain('>引擎选择</span>');
    expect(source).not.toContain('grid grid-cols-1 md:grid-cols-3 gap-4');
  });

  it('keeps generation payloads on the existing material workflow', () => {
    expect(source).toContain('handleMaterialAIGeneration');
    expect(source).toContain("generateGeminiImageVariant({");
    expect(source).toContain("generateDoubaoImages({");
    expect(source).toContain("references: imageToImageEnabled ? references : []");
    expect(source).toContain('assertEnoughCredits(DESIGN_CREDIT_FEATURES.imageGeneration');
    expect(source).toContain("taskId: newDesignCreditUsageId('material-image')");
    expect(source).toContain('model: generationModel.billingModel');
    expect(source).toContain("if (!results.length) throw new Error('未返回图片，本次不扣积分')");
  });
});
