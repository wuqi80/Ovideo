import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../components/FileColumn.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');

describe('FileColumn workflow script control', () => {
  it('keeps the primary script action visible and explicit', () => {
    expect(source).toContain('设为本集主剧本');
    expect(source).toContain('当前主剧本');
    expect(source).toContain('本集后续流程使用此剧本');
    expect(source).not.toContain('title="设为本集后续流程采用剧本"');
  });

  it('keeps file actions in the compact title row', () => {
    expect(source).toContain('data-testid="file-column-title-row"');
    expect(source).toContain('data-testid="file-column-action-row"');
    expect(source).toContain('data-testid="file-card-control-row"');
    expect(source).toContain('data-testid="file-card-content"');
    expect(source).toContain('aria-label="新建空白文件"');
    expect(source).toContain('aria-label="上传文件"');
    expect(source).toContain('文件列表');
    expect(source).not.toContain('1. 文件列表');
  });

  it('uses compact light-border cards without horizontal section dividers', () => {
    expect(source).toContain('className="flex shrink-0 items-center justify-end gap-1"');
    expect(source).toContain('className="flex flex-col gap-[5px]"');
    expect(source).toContain("'border-primary bg-primary-light shadow-sm'");
    expect(source).toContain("'border-n40 hover:border-n100 hover:bg-n20'");
    expect(source).not.toContain('flex-shrink-0 border-b border-n40 bg-n0');
    expect(source).not.toContain('border-t border-n40 px-4');
    expect(source).not.toContain('p-3 border-t border-n40 bg-n0 sticky');
  });

  it('labels completed files as generated', () => {
    expect(source).toContain('data-testid="file-generated-status"');
    expect(source).toContain('已生成');
  });

  it('keeps every file action visible without hover', () => {
    expect(source).toContain('Actions stay visible');
    expect(source).toContain('data-testid="file-card-actions"');
    expect(source).toContain('className="absolute right-2 top-2.5 z-30 flex items-center gap-0.5"');
    expect(source).not.toContain('rounded-md border border-n40 bg-n0 px-1 py-0.5 opacity-100 shadow-bottom backdrop-blur-sm');
    expect(source).not.toContain('w-px h-4 bg-n40 mx-0.5');
    expect(source).not.toContain('group-focus-within:opacity-100 group-hover:opacity-100');
  });

  it('separates upload drops from live file reordering', () => {
    expect(source).toContain("includes('Files')");
    expect(source).toContain("setData('application/x-mecha-script-file', file.id)");
    expect(source).toContain('setDragImage(e.currentTarget, 18, 18)');
    expect(source).toContain('onDragEnter={(e) => {');
    expect(source).toContain('onReorderFiles(fromIndex, index)');
    expect(source).toContain('aria-label={`拖动 ${file.name} 调整顺序`}');
  });
});
