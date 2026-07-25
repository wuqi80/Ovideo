import React, { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, LoaderCircle, Send, Wand2, X } from 'lucide-react';
import type { AiModel, ProjectFile } from '../types';
import type { ScriptModelOption } from '../services/scriptModelCatalogService';

interface QuickScriptSourceColumnProps {
  selectedFile: ProjectFile | undefined;
  currentVersionNo?: number;
  aiModel: AiModel;
  modelOptions: readonly ScriptModelOption[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  onDismissError: () => void;
  onChangeModel: (model: AiModel) => void;
  onUpdateSource: (fileId: string, content: string) => void;
  onSend: (content: string) => Promise<void>;
}

export const QuickScriptSourceColumn: React.FC<QuickScriptSourceColumnProps> = ({
  selectedFile,
  currentVersionNo,
  aiModel,
  modelOptions,
  isLoading,
  isSending,
  error,
  onDismissError,
  onChangeModel,
  onUpdateSource,
  onSend,
}) => {
  const [instruction, setInstruction] = useState('');
  const [requestError, setRequestError] = useState('');
  const hasVersion = currentVersionNo !== undefined;

  useEffect(() => {
    setInstruction('');
    setRequestError('');
  }, [selectedFile?.id]);

  const submit = async () => {
    const content = (hasVersion ? instruction : selectedFile?.originalContent || '').trim();
    if (!content || isSending) return;
    setRequestError('');
    try {
      await onSend(content);
      if (hasVersion) setInstruction('');
    } catch (submitError) {
      setRequestError(submitError instanceof Error ? submitError.message : '生成失败，请稍后重试');
    }
  };

  const visibleError = requestError || error || '';

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-n40 bg-n0"
      data-testid="quick-script-source-column"
    >
      <header className="flex h-[52px] flex-shrink-0 items-center gap-2 border-b border-n40 px-4">
        <BookOpen className="h-4 w-4 flex-shrink-0 text-primary" />
        <h2 className="whitespace-nowrap text-sm font-semibold text-n700">2. 文字脚本</h2>
        <label className="relative ml-auto min-w-0">
          <span className="sr-only">选择剧本模型</span>
          <select
            value={aiModel}
            onChange={event => onChangeModel(event.target.value as AiModel)}
            disabled={isSending}
            className="h-8 max-w-[210px] appearance-none rounded border border-n40 bg-n0 pl-2 pr-7 text-[11px] text-n700 outline-none hover:border-primary focus:border-primary disabled:opacity-50"
          >
            {modelOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.runtime}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-n300" />
        </label>
      </header>

      <div className="flex h-[52px] flex-shrink-0 items-center border-b border-n40 px-3">
        {hasVersion ? (
          <div className="flex w-full items-center rounded border border-success/30 bg-g50 px-3 py-2 text-xs text-success">
            当前已生成分镜脚本 V{currentVersionNo}
            <span className="ml-auto text-[10px] text-n300">下方输入修改要求可生成新版</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!selectedFile?.originalContent.trim() || isSending || isLoading}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n100"
          >
            {isSending || isLoading
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <Wand2 className="h-4 w-4" />}
            {isSending ? '生成中…' : isLoading ? '加载中…' : '生成分镜脚本'}
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-n20">
        {selectedFile ? (
          <textarea
            key={`${selectedFile.id}-${hasVersion ? 'readonly' : 'editable'}`}
            readOnly={hasVersion || isSending}
            value={selectedFile.originalContent}
            onChange={event => onUpdateSource(selectedFile.id, event.target.value)}
            placeholder="在此输入文字剧本…"
            aria-label="文字剧本"
            className={`h-full w-full resize-none bg-transparent p-5 font-serif text-sm leading-7 text-n700 outline-none custom-scrollbar ${
              hasVersion ? 'cursor-default' : 'focus:bg-n0'
            }`}
            spellCheck={false}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-n100">
            <BookOpen className="h-10 w-10 opacity-25" />
            <p className="text-xs">请先从文件列表选择分集剧本</p>
          </div>
        )}
      </div>

      {hasVersion && selectedFile && (
        <div className="flex-shrink-0 border-t border-n40 bg-n0 p-3">
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
          <textarea
            value={instruction}
            onChange={event => setInstruction(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={isSending}
            placeholder="输入修改要求，例如：加强冲突，但保留原结局…"
            aria-label="分镜脚本修改要求"
            className="h-20 w-full resize-none rounded border border-n40 bg-n0 px-3 py-2 text-xs leading-5 text-n700 outline-none focus:border-primary disabled:opacity-60"
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-n200">Ctrl + Enter 发送</span>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!instruction.trim() || isSending}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n100"
            >
              {isSending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {isSending ? '生成中…' : '生成新版'}
            </button>
          </div>
        </div>
      )}

      {!hasVersion && visibleError && (
        <div className="flex flex-shrink-0 items-start gap-2 border-t border-danger/30 bg-r50 px-3 py-2 text-[11px] leading-5 text-danger">
          <span className="min-w-0 flex-1">{visibleError}</span>
          <button
            type="button"
            onClick={() => {
              setRequestError('');
              onDismissError();
            }}
            aria-label="关闭错误提示"
            className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-danger/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </section>
  );
};
