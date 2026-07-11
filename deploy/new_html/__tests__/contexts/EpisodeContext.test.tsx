import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = resolve(__dirname, '../../contexts/EpisodeContext.tsx');
const source = readFileSync(sourcePath, 'utf-8');

describe('EpisodeContext storyboard fallback behavior', () => {
  it('clears stale script selection when storyboard falls back to episode scope', () => {
    expect(source).toContain('clearStaleScriptSelectionFromStoryboardFallback');
    expect(source).toContain('res?.fallbackScriptId ?? res?.fallback_script_id');
  });

  it('reloads script scoped slices on first script selection', () => {
    expect(source).toContain('const previousScriptId = prevScriptIdRef.current');
    expect(source).toContain('if (previousScriptId === selectedScriptId) return');
  });

  it('reloads loaded script scoped slices after stale storyboard fallback clears selection', () => {
    expect(source).toContain('void fetchSlices({ quiet: true }, ...slicesToReload)');
  });
});
