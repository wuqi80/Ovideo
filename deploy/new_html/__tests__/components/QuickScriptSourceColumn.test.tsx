// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickScriptSourceColumn } from '../../components/QuickScriptSourceColumn';
import { AiModel, FileStatus, type ProjectFile } from '../../types';
import { DEFAULT_SCRIPT_MODEL_OPTIONS } from '../../services/scriptModelCatalogService';

vi.mock('../../services/creditService', async () => {
  const actual = await vi.importActual<typeof import('../../services/creditService')>('../../services/creditService');
  return {
    ...actual,
    estimateCredits: vi.fn().mockResolvedValue({
      enabled: true,
      estimated_cost: 8,
      enough: true,
      balance: 1000,
    }),
  };
});

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
  onSplitScript: vi.fn().mockResolvedValue(undefined),
  onGenerateVideoScript: vi.fn().mockResolvedValue(true),
  onExtractStoryboardPrompts: vi.fn().mockResolvedValue(true),
  onRunThreeStage: vi.fn().mockResolvedValue(undefined),
  onOpenVideoReverse: vi.fn(),
};

describe('QuickScriptSourceColumn', () => {
  it('restores the master three-stage controls without a revision composer', () => {
    render(<QuickScriptSourceColumn {...baseProps} />);

    expect(screen.getByTestId('quick-three-stage-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '按三步生成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '视频反推' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拆分剧本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成视频脚本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成镜头设计' })).toBeInTheDocument();
    expect(screen.queryByLabelText('分镜脚本修改要求')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成新版' })).not.toBeInTheDocument();
  });

  it('shows public model hints outside the dropdown', () => {
    render(<QuickScriptSourceColumn {...baseProps} />);

    expect(screen.getByTestId('quick-script-model-hint')).toHaveTextContent('速度优先');
    const modelSelect = screen.getByLabelText('选择剧本模型');
    expect(modelSelect).toHaveTextContent('二阶 · 快速写作模型');
    expect(modelSelect).not.toHaveTextContent('速度优先');
    expect(modelSelect).not.toHaveTextContent('deepseek');
  });

  it('runs the complete pipeline against the selected script id', async () => {
    const onRunThreeStage = vi.fn().mockResolvedValue(undefined);
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        onRunThreeStage={onRunThreeStage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '按三步生成' }));

    await waitFor(() => expect(onRunThreeStage).toHaveBeenCalledWith('script-1'));
  });

  it('shows quick pipeline failures inline instead of requiring a browser alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const onRunThreeStage = vi.fn().mockRejectedValue(new Error('剧本拆分未完成，系统已自动重新规划，请稍后再试'));
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        onRunThreeStage={onRunThreeStage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '按三步生成' }));

    expect(await screen.findByText('剧本拆分未完成，系统已自动重新规划，请稍后再试')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows the estimated credit cost in the quick three-stage panel', () => {
    render(<QuickScriptSourceColumn {...baseProps} />);

    expect(screen.getByText(/预计消耗积分：/)).toBeInTheDocument();
    expect(screen.getByText('· 成功后扣除')).toBeInTheDocument();
  });

  it('opens video reverse in quick mode before source text exists', () => {
    const onOpenVideoReverse = vi.fn();
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        selectedFile={{ ...file, originalContent: '' } as ProjectFile}
        onOpenVideoReverse={onOpenVideoReverse}
      />,
    );

    const reverseButton = screen.getByRole('button', { name: '视频反推' });
    expect(reverseButton).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '按三步生成' })).toBeDisabled();

    fireEvent.click(reverseButton);

    expect(onOpenVideoReverse).toHaveBeenCalledTimes(1);
  });

  it('runs each available master stage independently and shows its progress', async () => {
    const stagedFile = {
      ...file,
      scriptSegments: [{
        id: 'segment-1',
        order: 0,
        sourceText: '第一段',
        estimatedDurationSec: 12,
        videoScript: '镜头1-1',
        status: 'done',
      }],
      storyboard: {
        items: [{
          id: 'shot-1',
          shotNumber: '1-1',
          originalText: '第一段',
          scriptSegment: '第一段',
          imagePrompt: '画面',
          videoPrompt: '镜头',
          dialogue: '',
          characters: [],
          scene: '',
          timestamp: Date.now(),
        }],
      },
      generationStages: {
        split: { status: 'done', total: 1, completed: 1 },
        videoScript: { status: 'done', total: 1, completed: 1 },
        storyboardPrompt: { status: 'done', total: 1, completed: 1 },
      },
    } as ProjectFile;
    const onSplitScript = vi.fn().mockResolvedValue(undefined);
    const onGenerateVideoScript = vi.fn().mockResolvedValue(true);
    const onExtractStoryboardPrompts = vi.fn().mockResolvedValue(true);
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        selectedFile={stagedFile}
        onSplitScript={onSplitScript}
        onGenerateVideoScript={onGenerateVideoScript}
        onExtractStoryboardPrompts={onExtractStoryboardPrompts}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '拆分剧本' }));
    fireEvent.click(screen.getByRole('button', { name: '生成视频脚本' }));
    fireEvent.click(screen.getByRole('button', { name: '生成镜头设计' }));

    await waitFor(() => {
      expect(onSplitScript).toHaveBeenCalledWith('script-1');
      expect(onGenerateVideoScript).toHaveBeenCalledWith('script-1');
      expect(onExtractStoryboardPrompts).toHaveBeenCalledWith('script-1');
    });
    expect(screen.getAllByText('完成')).toHaveLength(3);
    expect(screen.getByText('分段数：1')).toBeInTheDocument();
    expect(screen.getByText('已生成：1/1')).toBeInTheDocument();
    expect(screen.getByText('镜头设计：1')).toBeInTheDocument();
  });
});
