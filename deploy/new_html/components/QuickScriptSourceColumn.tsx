import React, { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, Film, LoaderCircle, Wand2, X } from 'lucide-react';
import type { AiModel, ProjectFile, ScriptStoryboardVersion } from '../types';
import {
  formatScriptModelSelectLabel,
  getScriptModelOption,
  type ScriptModelOption,
} from '../services/scriptModelCatalogService';

interface QuickScriptSourceColumnProps {
  selectedFile: ProjectFile | undefined;
  aiModel: AiModel;
  modelOptions: readonly ScriptModelOption[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  onDismissError: () => void;
  onChangeModel: (model: AiModel) => void;
  onUpdateSource: (fileId: string, content: string) => void;
  onSplitScript: (fileId: string) => Promise<boolean | void>;
  onGenerateVideoScript: (fileId: string) => Promise<boolean | ScriptStoryboardVersion | void>;
  onExtractStoryboardPrompts: (fileId: string) => Promise<boolean | void>;
  onRunThreeStage: (fileId: string) => Promise<void>;
  onOpenVideoReverse?: () => void;
}

export const QuickScriptSourceColumn: React.FC<QuickScriptSourceColumnProps> = ({
  selectedFile,
  aiModel,
  modelOptions,
  isLoading,
  isSending,
  error,
  onDismissError,
  onChangeModel,
  onUpdateSource,
  onSplitScript,
  onGenerateVideoScript,
  onExtractStoryboardPrompts,
  onRunThreeStage,
  onOpenVideoReverse,
}) => {
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    setRequestError('');
  }, [selectedFile?.id]);

  const runAction = async (
    action: (fileId: string) => Promise<unknown>,
    fallbackMessage: string,
  ) => {
    if (!selectedFile || isSending) return;
    setRequestError('');
    try {
      await action(selectedFile.id);
    } catch (submitError) {
      setRequestError(submitError instanceof Error ? submitError.message : fallbackMessage);
    }
  };

  const visibleError = requestError || error || '';
  const stages = selectedFile?.generationStages;
  const segmentCount = selectedFile?.scriptSegments?.length || 0;
  const generatedSegmentCount = selectedFile?.scriptSegments?.filter(segment => segment.videoScript).length || 0;
  const promptCount = selectedFile?.storyboard?.items?.filter(item => item.imagePrompt).length || 0;
  const isStageRunning = Object.values(stages || {}).some(stage => stage?.status === 'running');
  const isBusy = isLoading || isSending || isStageRunning;
  const selectedModelOption = getScriptModelOption(aiModel, modelOptions);
  const selectedModelHint = selectedModelOption.hint.trim();

  const statusText = (stage: NonNullable<ProjectFile['generationStages']>[keyof NonNullable<ProjectFile['generationStages']>]) => {
    if (stage?.status === 'running') return `进行中 ${stage.completed ?? 0}/${stage.total ?? '?'}`;
    if (stage?.status === 'done') return '完成';
    if (stage?.status === 'error') return '失败，可重试';
    return '未开始';
  };

  const statusClass = (stage: NonNullable<ProjectFile['generationStages']>[keyof NonNullable<ProjectFile['generationStages']>]) => {
    if (stage?.status === 'done') return 'text-success';
    if (stage?.status === 'error') return 'text-danger';
    if (stage?.status === 'running') return 'text-warning';
    return 'text-n200';
  };

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-n40 bg-n0"
      data-testid="quick-script-source-column"
    >
      <header className="flex h-[52px] flex-shrink-0 items-center gap-2 border-b border-n40 px-4">
        <BookOpen className="h-4 w-4 flex-shrink-0 text-primary" />
        <h2 className="whitespace-nowrap text-sm font-semibold text-n700">2. 文字脚本</h2>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {selectedModelHint && (
            <span
              className="flex-shrink-0 whitespace-nowrap text-[11px] font-medium text-n300"
              data-testid="quick-script-model-hint"
            >
              {selectedModelHint}
            </span>
          )}
          <label className="relative min-w-0">
            <span className="sr-only">选择剧本模型</span>
            <select
              value={aiModel}
              onChange={event => onChangeModel(event.target.value as AiModel)}
              disabled={isSending}
              className="h-8 max-w-[180px] appearance-none rounded border border-n40 bg-n0 pl-2 pr-7 text-[11px] text-n700 outline-none hover:border-primary focus:border-primary disabled:opacity-50"
            >
              {modelOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {formatScriptModelSelectLabel(option)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-n300" />
          </label>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 bg-n20">
        {selectedFile ? (
          <textarea
            key={selectedFile.id}
            readOnly={isBusy}
            value={selectedFile.originalContent}
            onChange={event => onUpdateSource(selectedFile.id, event.target.value)}
            placeholder="在此输入文字剧本…"
            aria-label="文字剧本"
            className="h-full w-full resize-none bg-transparent p-5 font-serif text-sm leading-7 text-n700 outline-none custom-scrollbar focus:bg-n0 read-only:cursor-default"
            spellCheck={false}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-n100">
            <BookOpen className="h-10 w-10 opacity-25" />
            <p className="text-xs">请先从文件列表选择分集剧本</p>
          </div>
        )}
      </div>

      {selectedFile && (
        <div className="flex-shrink-0 border-t border-n40 bg-n0 p-3" data-testid="quick-three-stage-panel">
          {visibleError && (
            <div className="mb-2 flex items-start gap-2 rounded border border-danger/30 bg-r50 px-2.5 py-2 text-[11px] leading-5 text-danger">
              <span className="min-w-0 flex-1">{visibleError}</span>
              <button
                type="button"
                onClick={() => {
                  setRequestError('');
                  onDismissError();
                }}
                title="关闭错误提示"
                aria-label="关闭错误提示"
                className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-danger/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-n700">三步生成</span>
            {onOpenVideoReverse && (
              <button
                type="button"
                onClick={onOpenVideoReverse}
                disabled={isBusy}
                className="ml-auto mr-2 inline-flex h-8 items-center gap-1.5 rounded border border-primary/30 bg-primary-light px-3 text-xs font-semibold text-primary hover:border-primary hover:bg-n0 disabled:cursor-not-allowed disabled:border-n40 disabled:bg-n20 disabled:text-n100"
              >
                <Film className="h-3.5 w-3.5" />
                视频反推
              </button>
            )}
            <button
              type="button"
              onClick={() => void runAction(onRunThreeStage, '按三步生成失败，请稍后重试')}
              disabled={!selectedFile.originalContent.trim() || isBusy}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n100"
            >
              {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {isBusy ? '执行中…' : '按三步生成'}
            </button>
          </div>
          {([
            {
              key: 'split',
              label: '拆分剧本',
              metric: `分段数：${segmentCount}`,
              action: onSplitScript,
              disabled: !selectedFile.originalContent.trim(),
            },
            {
              key: 'videoScript',
              label: '生成视频脚本',
              metric: `已生成：${generatedSegmentCount}/${segmentCount}`,
              action: onGenerateVideoScript,
              disabled: segmentCount === 0,
            },
            {
              key: 'storyboardPrompt',
              label: '生成镜头设计',
              metric: `镜头设计：${promptCount}`,
              action: onExtractStoryboardPrompts,
              disabled: generatedSegmentCount === 0,
            },
          ] as const).map(row => {
            const stage = stages?.[row.key];
            return (
              <div key={row.key} className="flex min-w-0 items-center gap-2 border-t border-n40 py-1.5">
                <button
                  type="button"
                  onClick={() => void runAction(row.action, `${row.label}失败，请稍后重试`)}
                  disabled={row.disabled || isBusy}
                  className="h-7 flex-shrink-0 rounded border border-n40 bg-n0 px-2 text-[11px] font-medium text-n700 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:border-n40 disabled:text-n100"
                >
                  {row.label}
                </button>
                <span className="min-w-0 flex-1 truncate text-[10px] text-n300">{row.metric}</span>
                <span className={`flex-shrink-0 text-[10px] ${statusClass(stage)}`}>{statusText(stage)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
