import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function componentSlice(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('angle adjustment modal responsive layout', () => {
  it('keeps the generation-page GPU selector below the left preview', () => {
    const source = readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf-8');
    const modal = componentSlice(source, 'const CameraAngleModal', 'const HumanMultiAngleModal');

    expect(modal).toContain('max-h-[calc(100vh-2rem)]');
    expect(modal.indexOf('处理 GPU')).toBeGreaterThan(modal.indexOf('alt="预览"'));
    expect(modal.indexOf('处理 GPU')).toBeLessThan(modal.indexOf('<div className="space-y-5">'));
    expect(modal.indexOf('处理 GPU')).toBeLessThan(modal.lastIndexOf('生成新角度'));
  });

  it('keeps the design-page GPU selector with the left material preview', () => {
    const source = readFileSync(resolve(__dirname, '../../pages/DesignPage.tsx'), 'utf-8');
    const modal = componentSlice(source, 'const CameraModal', 'const ProcessModal');

    expect(modal).toContain(
      '<OperationMaterialPicker materials={materials} selectedId={cur?.id} onSelect={setSelId} />\n            <GpuNodeSelector onSelectionChange={setGpuSelection} />',
    );
    expect(modal.indexOf('<GpuNodeSelector')).toBeLessThan(modal.indexOf('水平旋转'));
  });

  it('keeps the material-page GPU selector below the left thumbnail rail', () => {
    const source = readFileSync(resolve(__dirname, '../../components/MaterialPage.tsx'), 'utf-8');
    const modal = componentSlice(source, 'const CameraModal', 'const ProcessModal');

    expect(modal).toContain('max-h-[calc(100vh-2rem)]');
    expect(modal.indexOf('<GpuNodeSelector')).toBeGreaterThan(modal.indexOf('grid grid-cols-5'));
    expect(modal.indexOf('<GpuNodeSelector')).toBeLessThan(modal.indexOf('<div className="space-y-5">'));
    expect(modal.indexOf('<GpuNodeSelector')).toBeLessThan(modal.indexOf('生成新角度'));
  });
});
