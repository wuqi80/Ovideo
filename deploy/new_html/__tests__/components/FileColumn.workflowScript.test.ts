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

  it('keeps narrow-column controls in dedicated rows', () => {
    expect(source).toContain('data-testid="file-column-title-row"');
    expect(source).toContain('data-testid="file-column-action-row"');
    expect(source).toContain('data-testid="file-card-control-row"');
    expect(source).toContain('data-testid="file-card-content"');
    expect(source).toContain('aria-label="新建空白文件"');
    expect(source).toContain('aria-label="上传文件"');
    expect(source).toContain('>\n            文件列表\n');
    expect(source).not.toContain('1. 文件列表');
  });

  it('labels completed files as generated', () => {
    expect(source).toContain('data-testid="file-generated-status"');
    expect(source).toContain('已生成');
  });

  it('keeps every file action visible without hover', () => {
    expect(source).toContain('Actions stay visible');
    expect(source).toContain('opacity-100 shadow-bottom');
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
