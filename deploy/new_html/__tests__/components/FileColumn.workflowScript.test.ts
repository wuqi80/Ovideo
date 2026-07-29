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

  it('uses contiguous rows with a blue selected rail and tinted background', () => {
    expect(source).toContain('className="flex shrink-0 items-center justify-end gap-1"');
    expect(source).toContain('className="flex flex-col border-t border-n40"');
    expect(source).toContain('border-b border-l-[3px] border-n40');
    expect(source).toContain("'border-l-primary bg-primary-light'");
    expect(source).toContain("'border-l-transparent bg-n0 hover:bg-n20'");
    expect(source).not.toContain('rounded-lg border bg-n0 px-2.5 py-2');
    expect(source).not.toContain('flex-shrink-0 border-b border-n40 bg-n0');
    expect(source).not.toContain('border-t border-n40 px-4');
    expect(source).not.toContain('p-3 border-t border-n40 bg-n0 sticky');
  });

  it('labels completed files as generated', () => {
    expect(source).toContain('data-testid="file-generated-status"');
    expect(source).toContain('已生成');
  });

  it('keeps only ordering and the overflow trigger outside the file menu', () => {
    expect(source).toContain('data-testid="file-card-actions"');
    expect(source).toContain('aria-label={`${file.name} 上移`}');
    expect(source).toContain('aria-label={`${file.name} 下移`}');
    expect(source).toContain('aria-label={`${file.name} 更多操作`}');
    expect(source).toContain('data-testid="file-card-menu"');
    expect(source).toContain("'设为本集主剧本'");
    expect(source).toContain("'本集后续流程使用此剧本'");
    expect(source).toContain('<Edit2 className="h-3.5 w-3.5" /> 重命名');
    expect(source).toContain('<FileDown className="h-3.5 w-3.5" /> 下载');
    expect(source).toContain('<Trash2 className="h-3.5 w-3.5" /> 删除');
  });

  it('renders the file settings panel through a portal to the right of the sidebar', () => {
    expect(source).toContain("import { createPortal } from 'react-dom'");
    expect(source).toContain('left: Math.min(rect.right + 8');
    expect(source).toContain('style={{ left: menuPosition.left, top: menuPosition.top }}');
    expect(source).toContain('className="fixed z-[130] w-[280px]');
    expect(source).toContain('文件设置');
    expect(source).toContain('aria-label="关闭文件设置"');
  });

  it('shows a larger two-line muted preview with horizontal breathing room', () => {
    expect(source).toContain('className="mt-2 w-full min-w-0 select-none px-1"');
    expect(source).toContain('className="line-clamp-2 text-xs leading-[18px] text-n100"');
    expect(source).toContain('file.originalContent.slice(0, 100)');
  });

  it('separates upload drops from live file reordering', () => {
    expect(source).toContain("includes('Files')");
    expect(source).toContain("setData('application/x-mecha-script-file', file.id)");
    expect(source).toContain('setDragImage(e.currentTarget, 18, 18)');
    expect(source).toContain('draggable={Boolean(onReorderFiles)}');
    expect(source).toContain("closest('button')");
    expect(source).toContain('onDragEnter={(e) => {');
    expect(source).toContain('onReorderFiles(fromIndex, index)');
  });
});
