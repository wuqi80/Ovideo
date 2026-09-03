import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/AdminPage.tsx'), 'utf-8');

describe('AdminPage model access catalog', () => {
  it('lets administrators explicitly grant image-generation models', () => {
    expect(source).toContain("import { DESIGN_IMAGE_MODEL_OPTIONS } from '../utils/designImageModels'");
    expect(source).toContain('DESIGN_IMAGE_MODEL_OPTIONS.map(option => ({ value: option.id, label: option.label }))');
  });

  it('keeps an explicit inherited policy even when legacy model names remain stored', () => {
    expect(source).toContain("const explicitAccessMode = rp.accessMode ?? rp.access_mode");
    expect(source).toContain("explicitAccessMode === 'inherit'");
  });
});
