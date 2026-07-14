import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../components/FileColumn.tsx'), 'utf-8');

describe('FileColumn workflow script control', () => {
  it('keeps the primary script action visible and explicit', () => {
    expect(source).toContain('设为本集主剧本');
    expect(source).toContain('当前主剧本');
    expect(source).toContain('本集后续流程使用此剧本');
    expect(source).not.toContain('title="设为本集后续流程采用剧本"');
  });
});
