// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickScriptVersionColumn } from '../../components/QuickScriptVersionColumn';
import { FileStatus, type ProjectFile, type ScriptStoryboardVersion } from '../../types';

afterEach(cleanup);

const item = {
  id: 'shot-1',
  shotNumber: '镜头1-1',
  originalText: '镜头1-1\n主角推门进入。',
  scriptSegment: '主角推门进入。',
  videoPrompt: '',
  imagePrompt: '',
  dialogue: '',
  characters: [],
};

const file = {
  id: 'script-1',
  name: '分集剧本',
  originalContent: '文字剧本',
  scriptContent: '镜头1-1\n主角推门进入。',
  storyboard: null,
  extractedCharacters: [],
  extractedScenes: [],
  extractedProps: [],
  status: FileStatus.Completed,
  lastUpdated: Date.now(),
  versions: [],
} as ProjectFile;

const version = {
  id: 'version-1',
  scriptId: 'script-1',
  versionNo: 1,
  content: '镜头1-1\n主角推门进入。',
  storyboardItems: [item],
  source: 'ai',
  status: 'ready',
  modelAlias: 'DK金丹',
  modelName: 'deepseek-v4-flash',
  createdAt: Date.now(),
  updatedAt: Date.now(),
} as ScriptStoryboardVersion;

describe('QuickScriptVersionColumn', () => {
  it('uses version-safe edit, export and design callbacks', async () => {
    const onEditVersion = vi.fn().mockResolvedValue(undefined);
    const onGenerateDesign = vi.fn().mockResolvedValue(undefined);
    const onExportVersion = vi.fn();

    render(
      <QuickScriptVersionColumn
        selectedFile={file}
        version={version}
        isSending={false}
        error={null}
        highlightedItemIds={new Set()}
        onDismissError={vi.fn()}
        onSelectItemIds={vi.fn()}
        onEditVersion={onEditVersion}
        onGenerateDesign={onGenerateDesign}
        onExportVersion={onExportVersion}
      />,
    );

    expect(screen.getByText('deepseek-v4-flash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /镜头1-1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成镜头设计' }));
    expect(onGenerateDesign).toHaveBeenCalledWith(version);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(onExportVersion).toHaveBeenCalledWith(version);

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('编辑分镜脚本'), {
      target: { value: '镜头1-1\n主角缓慢推门进入。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版' }));

    await waitFor(() => expect(onEditVersion).toHaveBeenCalledWith(
      version,
      '镜头1-1\n主角缓慢推门进入。',
    ));
  });
});
