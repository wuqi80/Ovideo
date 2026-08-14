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

describe('VideoPage source media layout', () => {
  it('uses the same stable four-column media row as generated video results', () => {
    expect(source).toContain('data-testid="video-source-grid"');
    expect(source).toContain('grid w-full grid-cols-4 gap-2 overflow-y-auto');
    expect(source).toContain('data-testid="video-source-placeholder"');
    expect(source).toContain('const sourcePlaceholderCount = getVideoResultPlaceholderCount(sourceImages.length);');
    expect(source).toContain('Array.from({ length: sourcePlaceholderCount }');
  });
});

describe('VideoPage upscale processing node routing', () => {
  it('shows the shared processing-node selector and forwards the selected route', () => {
    expect(source).toContain("import { GpuNodeSelector, type GpuNodeSelection } from './GpuNodeSelector';");
    expect(source).toContain('setUpscaleNodeSelection(null);');
    expect(source).toContain('onSelectionChange={setUpscaleNodeSelection}');
    expect(source).toContain('preferred_agent_id: upscaleNodeSelection?.preferredAgentId');
    expect(source).toContain('preferred_node_id: upscaleNodeSelection?.preferredNodeId');
    expect(source).toContain('disabled={isSubmitting || !upscaleNodeSelection?.usable}');
  });
});
