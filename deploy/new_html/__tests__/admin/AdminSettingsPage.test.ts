import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../admin/AdminSettingsPage.tsx'), 'utf-8');

describe('AdminSettingsPage category-specific model checks', () => {
  it('uses the visible category binding instead of the provider card primary model', () => {
    expect(source).toContain('const categoryModelName = modelBindings[0]?.model_name');
    expect(source).toContain('onCheck(provider, categoryModelName)');
    expect(source).toContain('const modelNameHint = categoryBinding?.model_name || config.model_name || null');
    expect(source).toContain('const categoryRuntime = runtimeForProviderModel(provider, modelNameHint) || runtime');
  });

  it('keeps API config cards compact with a details modal and adaptive actions', () => {
    expect(source).toContain('setDetailsOpen(true)');
    expect(source).toContain('aria-label={`${cardTitle} 详情`}');
    expect(source).toContain("const effectiveActionLabel = config.enabled === false ? '启用' : !isRuntimeActive ? '设为生效' : '禁用'");
    expect(source).toContain('onClick={handleEffectiveAction}');
    expect(source.indexOf('onClick={handleEffectiveAction}')).toBeLessThan(source.indexOf('onClick={() => setDetailsOpen(true)}'));
    expect(source).toContain("min-w-[4.5rem]");
    expect(source).not.toContain('w-36 shrink-0');
  });
});
