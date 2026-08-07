import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/VideoPage.tsx'), 'utf-8');

describe('VideoPage queued task state', () => {
  it('keeps queued backend tasks visibly separate from GPU processing', () => {
    expect(source).toContain("state: status === 'queued' ? 'pending' : 'processing'");
    expect(source).toContain("if (status.state === 'pending')");
    expect(source).toContain('排队中...');
  });
});
