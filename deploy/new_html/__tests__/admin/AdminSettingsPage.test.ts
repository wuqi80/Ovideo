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
});
