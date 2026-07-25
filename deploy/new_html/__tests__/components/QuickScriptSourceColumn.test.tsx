// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickScriptSourceColumn } from '../../components/QuickScriptSourceColumn';
import { AiModel, FileStatus, type ProjectFile } from '../../types';
import { DEFAULT_SCRIPT_MODEL_OPTIONS } from '../../services/scriptModelCatalogService';

afterEach(cleanup);

const file = {
  id: 'script-1',
  name: '分集剧本',
  originalContent: '第一集文字剧本',
  scriptContent: null,
  storyboard: null,
  extractedCharacters: [],
  extractedScenes: [],
  extractedProps: [],
  status: FileStatus.Idle,
  lastUpdated: Date.now(),
  versions: [],
} as ProjectFile;

const baseProps = {
  selectedFile: file,
  aiModel: AiModel.DeepseekChat,
  modelOptions: DEFAULT_SCRIPT_MODEL_OPTIONS,
  isLoading: false,
  isSending: false,
  error: null,
  onDismissError: vi.fn(),
  onChangeModel: vi.fn(),
  onUpdateSource: vi.fn(),
};

describe('QuickScriptSourceColumn', () => {
  it('uses the unified send callback for the initial source and later modification instructions', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <QuickScriptSourceColumn
        {...baseProps}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '生成分镜脚本' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('第一集文字剧本'));

    rerender(
      <QuickScriptSourceColumn
        {...baseProps}
        currentVersionNo={1}
        onSend={onSend}
      />,
    );
    fireEvent.change(screen.getByLabelText('分镜脚本修改要求'), {
      target: { value: '加强第一段冲突' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成新版' }));

    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('加强第一段冲突'));
  });

  it('shows the runtime model beside the configured display name', () => {
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const modelSelect = screen.getByLabelText('选择剧本模型');
    expect(modelSelect).toHaveTextContent('deepseek');
  });
});
