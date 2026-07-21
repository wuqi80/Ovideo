import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  GripHorizontal,
  LoaderCircle,
  PanelRightOpen,
  Pencil,
  Send,
  User,
  X,
} from 'lucide-react';
import {
  AiModel,
  ProjectFile,
  ScriptConversation,
  ScriptConversationMessage,
  ScriptStoryboardVersion,
} from '../types';

export const SCRIPT_MODEL_OPTIONS = [
  { value: AiModel.Gemini, label: '化神', runtime: 'Gemini 2.5 Flash', provider: 'google' },
  { value: AiModel.Deepseek, label: '筑基', runtime: 'DeepSeek Reasoner', provider: 'deepseek' },
  { value: AiModel.DeepseekChat, label: '金丹', runtime: 'DeepSeek Chat', provider: 'deepseek' },
] as const;

interface ScriptConversationPaneProps {
  selectedFile?: ProjectFile;
  conversation?: ScriptConversation;
  aiModel: AiModel;
  isWorkflowScript: boolean;
  isLoading: boolean;
  isSending: boolean;
  error?: string | null;
  onChangeModel: (model: AiModel) => void;
  onSend: (content: string) => Promise<void>;
  onGenerateDesign: (version: ScriptStoryboardVersion) => Promise<void> | void;
  onEditVersion: (version: ScriptStoryboardVersion, content: string) => Promise<void>;
  onExportVersion: (version: ScriptStoryboardVersion) => void;
  onOpenStoryboard: () => void;
  storyboardItemCount: number;
}

const formatTime = (value: number) => new Date(value).toLocaleString('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export const ScriptConversationPane: React.FC<ScriptConversationPaneProps> = ({
  selectedFile,
  conversation,
  aiModel,
  isWorkflowScript,
  isLoading,
  isSending,
  error,
  onChangeModel,
  onSend,
  onGenerateDesign,
  onEditVersion,
  onExportVersion,
  onOpenStoryboard,
  storyboardItemCount,
}) => {
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingVersion, setEditingVersion] = useState<ScriptStoryboardVersion | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [composerHeight, setComposerHeight] = useState(132);
  const [isResizingComposer, setIsResizingComposer] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerResizeOriginRef = useRef({ y: 0, height: 132 });
  const initializedScriptRef = useRef<string | null>(null);

  const modelOption = SCRIPT_MODEL_OPTIONS.find(option => option.value === aiModel) || SCRIPT_MODEL_OPTIONS[2];
  const versionByMessageId = useMemo(() => new Map(
    (conversation?.versions || [])
      .filter(version => version.messageId)
      .map(version => [version.messageId as string, version]),
  ), [conversation?.versions]);
  const firstUserMessageId = useMemo(
    () => conversation?.messages.find(message => message.role === 'user')?.id,
    [conversation?.messages],
  );

  useEffect(() => {
    if (!selectedFile) {
      setDraft('');
      initializedScriptRef.current = null;
      return;
    }
    const initialContent = selectedFile.originalContent || '';
    const hasHistory = (conversation?.messages?.length || 0) > 0;
    if (initializedScriptRef.current !== selectedFile.id) {
      initializedScriptRef.current = selectedFile.id;
      setDraft(hasHistory ? '' : initialContent);
      return;
    }
    if (hasHistory) {
      setDraft(current => current === initialContent ? '' : current);
    }
  }, [selectedFile?.id, selectedFile?.originalContent, conversation?.messages?.length]);

  const latestMessage = conversation?.messages?.[conversation.messages.length - 1];

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedFile?.id, latestMessage?.id, latestMessage?.content, latestMessage?.status, isSending]);

  useEffect(() => {
    if (!isResizingComposer) return;
    const handlePointerMove = (event: PointerEvent) => {
      const delta = composerResizeOriginRef.current.y - event.clientY;
      setComposerHeight(Math.min(360, Math.max(112, composerResizeOriginRef.current.height + delta)));
    };
    const handlePointerUp = () => setIsResizingComposer(false);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isResizingComposer]);

  const submit = async () => {
    const content = draft.trim();
    if (!content || isSending || !selectedFile) return;
    setDraft('');
    try {
      await onSend(content);
    } catch {
      setDraft(content);
    }
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openEditor = (version: ScriptStoryboardVersion) => {
    setEditingVersion(version);
    setEditValue(version.content);
  };

  const saveEdit = async () => {
    if (!editingVersion || !editValue.trim()) return;
    setIsSavingEdit(true);
    try {
      await onEditVersion(editingVersion, editValue.trim());
      setEditingVersion(null);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const renderMessage = (message: ScriptConversationMessage) => {
    const version = versionByMessageId.get(message.id);
    const isAssistant = message.role === 'assistant';
    const isCollapsed = collapsed.has(message.id);
    const canCollapse = message.content.length > 240;
    return (
      <article
        key={message.id}
        className={`mx-auto w-[calc(100%-24px)] max-w-6xl border-b border-n40 px-4 py-5 ${isAssistant ? 'bg-n0' : 'bg-n20'}`}
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded ${isAssistant ? 'bg-primary text-white' : 'border border-n40 bg-n0 text-n500'}`}>
            {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex min-h-6 flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-n800">
                {isAssistant ? '分镜脚本' : message.id === firstUserMessageId ? '输入文字剧本' : '修改要求'}
              </span>
              {isAssistant && message.modelAlias && (
                <span className="rounded border border-n40 bg-n20 px-1.5 py-0.5 text-[10px] text-n300">
                  {message.modelAlias}{message.modelName ? ` · ${message.modelName}` : ''}
                </span>
              )}
              {version && (
                <span className="rounded border border-primary/30 bg-primary-light px-1.5 py-0.5 text-[10px] text-primary">
                  V{version.versionNo} · {version.storyboardItems.length} 个镜头
                </span>
              )}
              {version && isWorkflowScript && conversation?.currentVersionId === version.id && (
                <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-success-light px-1.5 py-0.5 text-[10px] font-medium text-success">
                  <Check className="h-3 w-3" /> 本集采用
                </span>
              )}
              {message.status === 'streaming' && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />}
              {message.status === 'failed' && <span className="text-[10px] text-danger">生成失败</span>}
              <span className="ml-auto flex items-center gap-2">
                {canCollapse && (
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(message.id)}
                    className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-n300 hover:bg-n20 hover:text-primary"
                  >
                    {isCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                    {isCollapsed ? '展开内容' : '折叠内容'}
                  </button>
                )}
                <span className="text-[10px] text-n100">{formatTime(message.createdAt)}</span>
              </span>
            </div>
            <div className={`whitespace-pre-wrap break-words text-sm leading-7 text-n700 ${isCollapsed ? 'max-h-28 overflow-hidden' : ''}`}>
              {message.content || (message.status === 'streaming' ? '正在生成分镜脚本…' : '')}
            </div>
            {canCollapse && (
              <button
                type="button"
                onClick={() => toggleCollapsed(message.id)}
                className="mt-2 inline-flex h-7 items-center gap-1 text-xs text-primary hover:text-primary-hover"
              >
                {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                {isCollapsed ? '展开完整内容' : '收起内容'}
              </button>
            )}
            {isAssistant && version && message.status === 'completed' && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-n40 pt-3">
                <button
                  type="button"
                  onClick={() => onGenerateDesign(version)}
                  className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-medium text-white hover:bg-primary-hover"
                >
                  <PanelRightOpen className="h-3.5 w-3.5" />
                  生成镜头设计
                </button>
                <button
                  type="button"
                  onClick={() => openEditor(version)}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-n40 bg-n0 px-3 text-xs text-n700 hover:border-primary hover:text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  编辑分镜脚本
                </button>
                <button
                  type="button"
                  onClick={() => onExportVersion(version)}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-n40 bg-n0 px-3 text-xs text-n700 hover:border-primary hover:text-primary"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出 Excel
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(version.content)}
                  title="复制分镜脚本"
                  aria-label="复制分镜脚本"
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-n40 bg-n0 text-n300 hover:border-primary hover:text-primary"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {conversation?.currentVersionId === version.id && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-success">
                    <Check className="h-3.5 w-3.5" /> {isWorkflowScript ? '当前采用版本' : '当前版本'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </article>
    );
  };

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col bg-n20" data-testid="script-conversation-pane">
      <header className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-n40 bg-n0 px-4">
        <FileText className="h-4 w-4 text-primary" />
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="truncate text-sm font-semibold text-n800">{selectedFile?.name || '请选择剧本任务'}</div>
          {selectedFile && <div className="flex-shrink-0 text-[10px] text-n100">{(conversation?.messages || []).length} 条对话 · {(conversation?.versions || []).length} 个分镜版本</div>}
        </div>
        <button
          type="button"
          onClick={onOpenStoryboard}
          disabled={!selectedFile || storyboardItemCount === 0}
          className="ml-auto inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded border border-primary bg-primary-light px-3 text-xs font-medium text-primary hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:border-n40 disabled:bg-n20 disabled:text-n100"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          展开镜头设计{storyboardItemCount > 0 ? ` (${storyboardItemCount})` : ''}
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {!selectedFile ? (
          <div className="flex h-full items-center justify-center text-sm text-n100">请从左侧选择一个剧本任务</div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-n300">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> 正在加载对话
          </div>
        ) : (conversation?.messages || []).length > 0 ? (
          <div>{conversation!.messages.map(renderMessage)}</div>
        ) : (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-8 text-center">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded border border-n40 bg-n0 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-n800">开始生成分镜脚本</h3>
            <p className="mt-2 text-xs leading-6 text-n300">在下方输入剧本文本。生成后可继续发送修改意见，每次回复都会保留为独立版本。</p>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 bg-n20 px-3 pb-3 pt-2">
        {error && <div className="mx-auto mb-2 w-[calc(100%-24px)] max-w-6xl rounded border border-danger/30 bg-r50 px-3 py-2 text-xs text-danger">{error}</div>}
        <div
          className="relative mx-auto flex w-[calc(100%-24px)] max-w-6xl flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-bottom focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10"
          style={{ height: composerHeight }}
        >
          <button
            type="button"
            data-testid="composer-resize-handle"
            onPointerDown={event => {
              event.preventDefault();
              composerResizeOriginRef.current = { y: event.clientY, height: composerHeight };
              setIsResizingComposer(true);
            }}
            title="向上或向下拖动调整输入框高度"
            aria-label="调整输入框高度"
            className="absolute right-3 top-2 z-10 inline-flex h-6 w-8 cursor-ns-resize items-center justify-center rounded text-n100 hover:bg-n20 hover:text-primary"
          >
            <GripHorizontal className="h-4 w-4" />
          </button>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={!selectedFile || isSending}
            rows={2}
            placeholder={(conversation?.messages || []).length > 0 ? '继续输入修改意见…' : '输入文字剧本…'}
            className="min-h-0 flex-1 resize-none bg-transparent px-4 pb-2 pt-4 pr-12 text-sm leading-6 text-n800 outline-none placeholder:text-n100 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex min-h-11 items-center gap-2 px-3 py-2">
            <span className="inline-flex h-7 items-center rounded px-2 text-[10px] text-success">完整上下文</span>
            <label className="relative min-w-0">
              <span className="sr-only">选择剧本模型</span>
              <select
                value={aiModel}
                onChange={event => onChangeModel(event.target.value as AiModel)}
                disabled={isSending}
                className="h-8 max-w-[230px] appearance-none border-0 bg-transparent pl-2 pr-7 text-xs text-n700 outline-none hover:text-primary focus:text-primary disabled:opacity-50"
              >
                {SCRIPT_MODEL_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label} · {option.runtime}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-n300" />
            </label>
            <span className="hidden min-w-0 truncate text-[10px] text-n100 lg:block">{modelOption.runtime}</span>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!selectedFile || !draft.trim() || isSending}
              title="发送"
              aria-label="发送"
              className="ml-auto inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-n800 text-white hover:bg-n700 disabled:cursor-not-allowed disabled:bg-n100"
            >
              {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {editingVersion && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-n900/45 p-3 sm:p-5">
          <div className="flex h-full w-full max-w-[1600px] flex-col rounded-md border border-n40 bg-n0 shadow-bottom">
            <div className="flex h-12 flex-shrink-0 items-center border-b border-n40 px-4">
              <div>
                <div className="text-sm font-semibold text-n800">编辑分镜脚本</div>
                <div className="text-[10px] text-n100">保存后创建新版本，历史回复不会被覆盖</div>
              </div>
              <button type="button" onClick={() => setEditingVersion(null)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded text-n300 hover:bg-n20 hover:text-n800" aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea value={editValue} onChange={event => setEditValue(event.target.value)} className="min-h-0 flex-1 resize-none bg-n0 p-5 font-mono text-sm leading-7 text-n800 outline-none" />
            <div className="flex h-14 flex-shrink-0 items-center justify-end gap-2 border-t border-n40 px-4">
              <button type="button" onClick={() => setEditingVersion(null)} className="h-8 rounded border border-n40 px-4 text-xs text-n700 hover:bg-n20">取消</button>
              <button type="button" onClick={() => void saveEdit()} disabled={isSavingEdit || !editValue.trim()} className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-4 text-xs text-white hover:bg-primary-hover disabled:opacity-50">
                {isSavingEdit && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />} 保存为新版本
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
