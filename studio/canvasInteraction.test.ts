import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');
const nodeSource = readFileSync(resolve(__dirname, 'components/Node.tsx'), 'utf-8');
const videoModulesSource = readFileSync(resolve(__dirname, 'components/VideoNodeModules.tsx'), 'utf-8');
const stylesSource = readFileSync(resolve(__dirname, 'styles.css'), 'utf-8');

describe('Studio canvas interaction contracts', () => {
  it('uses held Space as an actual canvas-pan gesture, including over child nodes', () => {
    expect(appSource).toContain('isSpacePressedRef.current = true');
    expect(appSource).toContain('if (e.button !== 0 || !isSpacePressedRef.current) return');
    expect(appSource).toContain('onMouseDownCapture={handleCanvasMouseDownCapture}');
    expect(appSource).toContain("window.addEventListener('blur', handleWindowBlur)");
    expect(appSource).toContain('setIsDraggingCanvas(false)');
  });

  it('keeps compact node controls and action labels on one line', () => {
    expect(nodeSource).toContain('max-w-[92px] truncate whitespace-nowrap');
    expect(nodeSource).toContain('flex shrink-0 items-center justify-center gap-2 whitespace-nowrap');
    expect(nodeSource).toContain('<span className="whitespace-nowrap">');
    expect(videoModulesSource).toContain('flex shrink-0 items-center gap-1.5 whitespace-nowrap');
    expect(nodeSource).toContain('studio-node-mode-strip w-full overflow-x-auto');
  });

  it('renders readable canvas text without scaling the whole DOM as a bitmap-like layer', () => {
    expect(appSource).toContain('const MIN_CANVAS_SCALE = 0.2');
    expect(appSource).toContain("style={{ zoom: scale, width: '100%', height: '100%' }}");
    expect(appSource).not.toContain('scale(${scale})');
    expect(stylesSource).toContain('-webkit-font-smoothing: auto');
  });

  it('uses a clean opaque dark canvas without the noise texture', () => {
    expect(stylesSource).toContain('--studio-canvas-background: #111216');
    expect(stylesSource).toContain('--studio-node-surface: #1B1C22');
    expect(stylesSource).toContain('.noise-bg {\n  background: transparent;');
  });
});
