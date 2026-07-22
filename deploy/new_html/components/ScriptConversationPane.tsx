import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  Copy,
  Coins,
  Download,
  FileText,
  GripHorizontal,
  History,
  Layers3,
  LoaderCircle,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Send,
  Upload,
  User,
  Wand2,
  X,
} from 'lucide-react';
import {
  AiModel,
  ProjectFile,
  ScriptConversation,
  ScriptConversationMessage,
  ScriptStoryboardVersion,
} from '../types';
import { estimateCredits, estimateTextTokens } from '../services/creditService';
import { buildStoryboardSegmentGroups } from '../utils/storyboardSegments';
import {
  buildShotDurationInstruction,
  DEFAULT_SHOT_DURATION_MODE,
  SHOT_DURATION_MODE_STORAGE_KEY,
  type ShotDurationMode,
} from '../utils/shotDurationMode';

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
  onDismissError?: () => void;
  onChangeModel: (model: AiModel) => void;
  onSend: (content: string, shotDurationMode: ShotDurationMode) => Promise<void>;
  onGenerateDesign: (version: ScriptStoryboardVersion) => Promise<void> | void;
  onEditVersion: (version: ScriptStoryboardVersion, content: string) => Promise<void>;
  onExportVersion: (version: ScriptStoryboardVersion) => void;
  onOpenStoryboard: () => void;
  onOpenVideoReverse?: () => void;
  storyboardItemCount: number;
}

const formatTime = (value: number) => new Date(value).toLocaleString('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

interface ConversationTurn {
  id: string;
  anchorMessageId: string;
  number: number;
  preview: string;
  versionNo?: number;
}

const StoryboardVersionBody: React.FC<{ version: ScriptStoryboardVersion }> = ({ version }) => {
  const groups = buildStoryboardSegmentGroups(version.storyboardItems || []);
  if (groups.length === 0) return <>{version.content}</>;

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <section key={group.key} className="overflow-hidden rounded-md border border-n40 bg-n0">
          <header className="flex items-center gap-2 border-b border-n40 bg-n20 px-3 py-2">
            <span className="text-xs font-semibold text-n500">分段</span>
            <span className="font-mono text-sm font-bold text-warning">{String(group.segmentNo).padStart(2, '0')}</span>
            <span className="text-[10px] text-n100">{group.entries.length} 个镜头 · 约 {Number(group.estimatedDurationSec.toFixed(1))} 秒</span>
          </header>
          <div className="divide-y divide-n40">
            {group.entries.map(entry => (
              <div key={entry.item.id} className="px-3 py-3">
                <div className="mb-1 text-xs font-semibold text-primary">{entry.localShotLabel}</div>
                <div className="whitespace-pre-wrap break-words font-mono text-sm leading-7 text-n700">
                  {entry.item.originalText || entry.item.videoScriptBlock || entry.item.scriptSegment}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export const ScriptConversationPane: React.FC<ScriptConversationPaneProps> = ({
  selectedFile,
  conversation,
  aiModel,
  isWorkflowScript,
  isLoading,
  isSending,
  error,
  onDismissError,
  onChangeModel,
  onSend,
  onGenerateDesign,
  onEditVersion,
  onExportVersion,
  onOpenStoryboard,
  onOpenVideoReverse,
  storyboardItemCount,
}) => {
  const [draft, setDraft] = useState('');
  const [shotDurationMode, setShotDurationMode] = useState<ShotDurationMode>(() => {
    try {
      return window.localStorage.getItem(SHOT_DURATION_MODE_STORAGE_KEY) === 'fragmented'
        ? 'fragmented'
        : DEFAULT_SHOT_DURATION_MODE;
    } catch {
      return DEFAULT_SHOT_DURATION_MODE;
    }
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingVersion, setEditingVersion] = useState<ScriptStoryboardVersion | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isReferenceScriptCollapsed, setIsReferenceScriptCollapsed] = useState(false);
  const [composerHeight, setComposerHeight] = useState(132);
  const [isResizingComposer, setIsResizingComposer] = useState(false);
  const [scrollControls, setScrollControls] = useState({ canScrollUp: false, canScrollDown: false });
  const [messageScrollControls, setMessageScrollControls] = useState<Record<string, {
    canJumpTop: boolean;
    canJumpBottom: boolean;
  }>>({});
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [estimatedCreditCost, setEstimatedCreditCost] = useState<number | null>(null);
  const [isEstimatingCredits, setIsEstimatingCredits] = useState(false);
  const [dismissedFailureIds, setDismissedFailureIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const composerFileInputRef = useRef<HTMLInputElement>(null);
  const composerResizeOriginRef = useRef({ y: 0, height: 132 });
  const composerHeightRef = useRef(composerHeight);
  const keepLatestVisibleOnResizeRef = useRef(true);
  const initializedScriptRef = useRef<string | null>(null);
  composerHeightRef.current = composerHeight;

  const versionByMessageId = useMemo(() => new Map(
    (conversation?.versions || [])
      .filter(version => version.messageId)
      .map(version => [version.messageId as string, version]),
  ), [conversation?.versions]);
  const firstUserMessageId = useMemo(
    () => conversation?.messages.find(message => message.role === 'user')?.id,
    [conversation?.messages],
  );
  const initialScriptContent = useMemo(() => {
    const firstUserMessage = conversation?.messages.find(message => (
      message.role === 'user' && message.content.trim()
    ));
    return firstUserMessage?.content || selectedFile?.originalContent || '';
  }, [conversation?.messages, selectedFile?.originalContent]);
  const conversationTurns = useMemo(() => {
    const turns: ConversationTurn[] = [];
    for (const message of conversation?.messages || []) {
      if (message.role === 'user') {
        const number = turns.length + 1;
        turns.push({
          id: `turn-${message.id}`,
          anchorMessageId: message.id,
          number,
          preview: message.content.replace(/\s+/g, ' ').trim().slice(0, 42) || '未命名对话',
        });
        continue;
      }
      if (message.role !== 'assistant') continue;
      let turn = turns[turns.length - 1];
      if (!turn) {
        turn = {
          id: `turn-${message.id}`,
          anchorMessageId: message.id,
          number: 1,
          preview: '分镜脚本',
        };
        turns.push(turn);
      }
      const version = versionByMessageId.get(message.id);
      if (version) turn.versionNo = version.versionNo;
    }
    return turns;
  }, [conversation?.messages, versionByMessageId]);
  const creditEstimateParams = useMemo(() => {
    if (!selectedFile) return null;
    const versions = conversation?.versions || [];
    const isFirstTurn = versions.length === 0;
    const currentVersion = versions.find(version => version.id === conversation?.currentVersionId)
      || versions[versions.length - 1];
    const conversationContext = (conversation?.messages || []).slice(-10)
      .map(message => `${message.role}:${message.content.replace(/\s+/g, ' ').slice(0, 500)}`)
      .join('\n');
    const durationInstruction = buildShotDurationInstruction(shotDurationMode);
    const billingInput = isFirstTurn
      ? [draft, durationInstruction].join('\n')
      : [currentVersion?.content || selectedFile.scriptContent || selectedFile.originalContent, draft, durationInstruction, conversationContext].join('\n');
    const forecastOutputTokens = Math.max(
      1000,
      estimateTextTokens(currentVersion?.content || selectedFile.scriptContent || draft) * (isFirstTurn ? 2 : 1),
    );
    const model = SCRIPT_MODEL_OPTIONS.find(option => option.value === aiModel)?.runtime || String(aiModel);
    return {
      input_tokens: estimateTextTokens(billingInput),
      output_tokens: forecastOutputTokens,
      model,
    };
  }, [aiModel, conversation?.currentVersionId, conversation?.messages, conversation?.versions, draft, selectedFile, shotDurationMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHOT_DURATION_MODE_STORAGE_KEY, shotDurationMode);
    } catch {
      // Storage can be unavailable in private browsing; the in-memory selection still works.
    }
  }, [shotDurationMode]);

  useEffect(() => {
    let cancelled = false;
    if (!creditEstimateParams || isSending) {
      setEstimatedCreditCost(null);
      setIsEstimatingCredits(false);
      return undefined;
    }
    setIsEstimatingCredits(true);
    const timer = window.setTimeout(() => {
      void estimateCredits('script_model_call', creditEstimateParams)
        .then(result => {
          if (!cancelled) setEstimatedCreditCost(result.enabled ? result.estimated_cost : 0);
        })
        .catch(() => {
          if (!cancelled) setEstimatedCreditCost(null);
        })
        .finally(() => {
          if (!cancelled) setIsEstimatingCredits(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [creditEstimateParams, isSending]);

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

  const updateScrollControls = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    const nodeRect = node.getBoundingClientRect();
    const threshold = nodeRect.top + Math.min(180, node.clientHeight * 0.35);
    let visibleTurnId = conversationTurns[0]?.id || null;
    for (const turn of conversationTurns) {
      const element = messageRefs.current.get(turn.anchorMessageId);
      if (!element || element.getBoundingClientRect().top > threshold) break;
      visibleTurnId = turn.id;
    }
    if (node.scrollTop >= maxScrollTop - 4 && conversationTurns.length > 0) {
      visibleTurnId = conversationTurns[conversationTurns.length - 1].id;
    }
    setActiveTurnId(current => current === visibleTurnId ? current : visibleTurnId);
    setScrollControls({
      canScrollUp: node.scrollTop > 4,
      canScrollDown: node.scrollTop < maxScrollTop - 4,
    });

    const visibleTop = nodeRect.top + 28;
    const visibleBottom = nodeRect.bottom - composerHeightRef.current - 44;
    const nextMessageControls: Record<string, { canJumpTop: boolean; canJumpBottom: boolean }> = {};
    messageRefs.current.forEach((element, messageId) => {
      const rect = element.getBoundingClientRect();
      nextMessageControls[messageId] = {
        canJumpTop: rect.top < visibleTop - 36,
        canJumpBottom: rect.bottom > visibleBottom + 36,
      };
    });
    setMessageScrollControls(current => {
      const currentIds = Object.keys(current);
      const nextIds = Object.keys(nextMessageControls);
      const unchanged = currentIds.length === nextIds.length && nextIds.every(messageId => (
        current[messageId]?.canJumpTop === nextMessageControls[messageId].canJumpTop
        && current[messageId]?.canJumpBottom === nextMessageControls[messageId].canJumpBottom
      ));
      return unchanged ? current : nextMessageControls;
    });
  }, [conversationTurns]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
      updateScrollControls();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedFile?.id, latestMessage?.id, latestMessage?.content, latestMessage?.status, isSending, updateScrollControls]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !keepLatestVisibleOnResizeRef.current) return;
    node.scrollTop = node.scrollHeight;
    updateScrollControls();
  }, [composerHeight, updateScrollControls]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollControls);
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, conversation?.messages?.length, selectedFile?.id, updateScrollControls]);

  const scrollConversationTo = (position: 'top' | 'bottom') => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({
      top: position === 'top' ? 0 : node.scrollHeight,
      behavior: 'smooth',
    });
  };

  const scrollToTurn = (turn: ConversationTurn) => {
    const node = scrollRef.current;
    const target = messageRefs.current.get(turn.anchorMessageId);
    if (!node || !target) return;
    const top = node.scrollTop + target.getBoundingClientRect().top - node.getBoundingClientRect().top - 12;
    setActiveTurnId(turn.id);
    node.scrollTo({ top, behavior: 'smooth' });
  };

  const scrollMessageBoundary = (messageId: string, boundary: 'top' | 'bottom') => {
    const node = scrollRef.current;
    const target = messageRefs.current.get(messageId);
    if (!node || !target) return;

    const nodeRect = node.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTop = node.scrollTop + targetRect.top - nodeRect.top;
    const composerReserve = composerHeight + 48;
    const top = boundary === 'top'
      ? targetTop - 12
      : targetTop + target.offsetHeight - node.clientHeight + composerReserve;

    node.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

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
      await onSend(content, shotDurationMode);
    } catch {
      setDraft(content);
    }
  };

  const handleComposerFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = loadEvent => {
      const text = loadEvent.target?.result;
      if (typeof text === 'string') setDraft(text);
    };
    reader.onerror = () => window.alert('读取文本文件失败，请确认文件格式后重试。');
    reader.readAsText(file);
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
    setIsReferenceScriptCollapsed(false);
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
    const creditCost = Number(message.metadata?.creditCost || 0);
    const failureMessage = String(message.metadata?.error || '生成未完成，请重新发送');
    const creditCharged = message.metadata?.creditCharged === true;
    const versionSegmentCount = version ? buildStoryboardSegmentGroups(version.storyboardItems || []).length : 0;
    const messageControls = messageScrollControls[message.id] || {
      canJumpTop: false,
      canJumpBottom: false,
    };
    return (
      <article
        key={message.id}
        ref={element => {
          if (element) messageRefs.current.set(message.id, element);
          else messageRefs.current.delete(message.id);
        }}
        className={`w-full scroll-mt-4 rounded-lg border border-n40 px-4 py-5 shadow-sm ${isAssistant ? 'bg-n0' : 'bg-n20'}`}
      >
        <div className="flex items-start gap-3">
          <div className="flex w-7 flex-shrink-0 self-stretch flex-col items-center">
            <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded ${isAssistant ? 'bg-primary text-white' : 'border border-n40 bg-n0 text-n500'}`}>
              {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </div>
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
                  V{version.versionNo} · {versionSegmentCount} 个分段 · {version.storyboardItems.length} 个镜头
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
              {version && message.status === 'completed'
                ? <StoryboardVersionBody version={version} />
                : message.content || (message.status === 'streaming' ? '正在生成分镜脚本…' : message.status === 'failed' ? failureMessage : '')}
            </div>
            {message.status === 'failed' && !dismissedFailureIds.has(message.id) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-danger/20 bg-danger-light px-3 py-2 text-xs text-danger">
                <span>{failureMessage}</span>
                <span className="ml-auto font-medium">
                  {creditCharged ? `已扣除 ${creditCost} 积分` : '本次未扣积分'}
                </span>
                <button
                  type="button"
                  onClick={() => setDismissedFailureIds(current => new Set(current).add(message.id))}
                  title="关闭错误提示"
                  aria-label="关闭错误提示"
                  className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-danger/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
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
                <span className="ml-auto inline-flex items-center gap-3">
                  {Number.isFinite(creditCost) && creditCost > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning" title="本轮模型调用实际扣除积分">
                      <Coins className="h-3.5 w-3.5" /> 本次消耗 {creditCost} 积分
                    </span>
                  )}
                  {conversation?.currentVersionId === version.id && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-success">
                      <Check className="h-3.5 w-3.5" /> {isWorkflowScript ? '当前采用版本' : '当前版本'}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
          {isAssistant && version && canCollapse && !isCollapsed && (
            <div
              className="flex w-9 flex-shrink-0 self-stretch flex-col items-center"
              data-testid={`script-card-scroll-controls-${message.id}`}
            >
              <div className={`sticky top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-full border border-n40 bg-n0 p-1 shadow-md transition-opacity duration-200 ${messageControls.canJumpTop || messageControls.canJumpBottom ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                <button
                  type="button"
                  onClick={() => scrollMessageBoundary(message.id, 'top')}
                  title="跳到本卡片顶部"
                  aria-label="跳到本卡片顶部"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-n400 transition-all duration-200 hover:bg-primary-light hover:text-primary ${messageControls.canJumpTop ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'}`}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollMessageBoundary(message.id, 'bottom')}
                  title="跳到本卡片底部"
                  aria-label="跳到本卡片底部"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-n400 transition-all duration-200 hover:bg-primary-light hover:text-primary ${messageControls.canJumpBottom ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'}`}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-n20" data-testid="script-conversation-pane">
      <header className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-n40 bg-n0 px-4">
        <FileText className="h-4 w-4 text-primary" />
        <div className="truncate text-sm font-semibold text-n800">{selectedFile?.name || '请选择剧本任务'}</div>
        {isLoading && conversation && (
          <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1 text-[10px] text-n300" title="正在后台同步最新对话">
            <LoaderCircle className="h-3 w-3 animate-spin text-primary" /> 后台同步
          </span>
        )}
        <button
          type="button"
          onClick={onOpenStoryboard}
          disabled={!selectedFile || storyboardItemCount === 0}
          className={`${isLoading && conversation ? '' : 'ml-auto'} inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded border border-primary bg-primary-light px-3 text-xs font-medium text-primary hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:border-n40 disabled:bg-n20 disabled:text-n100`}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          展开镜头设计{storyboardItemCount > 0 ? ` (${storyboardItemCount})` : ''}
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={updateScrollControls}
        className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
        style={{ paddingBottom: composerHeight + 36 }}
      >
        {!selectedFile ? (
          <div className="flex h-full items-center justify-center text-sm text-n100">请从左侧选择一个剧本任务</div>
        ) : isLoading && !conversation ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-n300">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> 正在加载对话
          </div>
        ) : (conversation?.messages || []).length > 0 ? (
          <div className="mx-auto grid w-full max-w-[1540px] grid-cols-1 gap-3 px-3 py-4 lg:grid-cols-[124px_minmax(0,1fr)_172px] xl:grid-cols-[140px_minmax(0,1fr)_196px]">
            <aside className="hidden min-w-0 lg:block" data-testid="conversation-turn-rail">
              <div className="sticky top-4 border-r border-n40 pr-3">
                <div className="mb-2 flex h-7 items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-semibold text-n700">对话轮次</span>
                  <span className="text-[10px] tabular-nums text-n100">{conversationTurns.length}</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => scrollConversationTo('top')}
                    disabled={!scrollControls.canScrollUp}
                    title="回到对话顶部"
                    aria-label="回到对话顶部"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-n300 hover:bg-n0 hover:text-primary disabled:cursor-default disabled:text-n50"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollConversationTo('bottom')}
                    disabled={!scrollControls.canScrollDown}
                    title="前往最新对话"
                    aria-label="前往最新对话"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-n300 hover:bg-n0 hover:text-primary disabled:cursor-default disabled:text-n50"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <nav className="max-h-[calc(100vh-250px)] space-y-1 overflow-y-auto pr-1 custom-scrollbar" aria-label="对话轮次快速导航">
                  {conversationTurns.map(turn => (
                    <button
                      key={turn.id}
                      type="button"
                      onClick={() => scrollToTurn(turn)}
                      title={turn.preview}
                      className={`w-full rounded px-2 py-2 text-left transition-colors ${activeTurnId === turn.id ? 'bg-n0 text-primary shadow-sm' : 'text-n300 hover:bg-n0 hover:text-n700'}`}
                    >
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold">
                        <span>{turn.number === 1 ? '初始剧本' : `第 ${turn.number} 轮`}</span>
                        {turn.versionNo && <span className="rounded bg-primary-light px-1 py-0.5 text-[9px] text-primary">V{turn.versionNo}</span>}
                      </span>
                      <span className="mt-1 block truncate text-[10px] leading-4 text-n100">{turn.preview}</span>
                    </button>
                  ))}
                </nav>
              </div>
            </aside>

            <main className="min-w-0 space-y-3">{conversation!.messages.map(renderMessage)}</main>

            <aside className="hidden min-w-0 lg:block" data-testid="conversation-summary-rail">
              <div className="sticky top-4 border-l border-n40 pl-3">
                <div className="mb-3 text-[11px] font-semibold text-n700">当前任务</div>
                <dl className="space-y-3">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="mt-0.5 h-3.5 w-3.5 text-n300" />
                    <div><dt className="text-[10px] text-n100">对话数量</dt><dd className="text-xs font-medium tabular-nums text-n700">{conversation!.messages.length} 条 · {conversationTurns.length} 轮</dd></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Layers3 className="mt-0.5 h-3.5 w-3.5 text-n300" />
                    <div><dt className="text-[10px] text-n100">分镜版本</dt><dd className="text-xs font-medium tabular-nums text-n700">{conversation!.versions.length} 个</dd></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Film className={`mt-0.5 h-3.5 w-3.5 ${storyboardItemCount > 0 ? 'text-success' : 'text-n100'}`} />
                    <div>
                      <dt className="text-[10px] text-n100">镜头设计</dt>
                      <dd className={`text-xs font-medium ${storyboardItemCount > 0 ? 'text-success' : 'text-n300'}`}>
                        {storyboardItemCount > 0 ? `已生成 · ${storyboardItemCount} 个镜头` : '尚未生成'}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <History className="mt-0.5 h-3.5 w-3.5 text-n300" />
                    <div><dt className="text-[10px] text-n100">镜头设计历史</dt><dd className="text-xs font-medium tabular-nums text-n700">{selectedFile?.versions?.length || 0} 个存档</dd></div>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        ) : (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-8 text-center">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded border border-n40 bg-n0 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-n800">开始生成分镜脚本</h3>
            <p className="mt-2 text-xs leading-6 text-n300">在下方输入剧本文本。生成后可继续发送修改意见，每次回复都会保留为独立版本。</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-warning">
              <Coins className="h-3.5 w-3.5" /> 每次生成都会扣除一定数量的积分
            </p>
          </div>
        )}
      </div>

      {scrollControls.canScrollDown && (
        <button
          type="button"
          data-testid="conversation-jump-to-latest"
          onClick={() => scrollConversationTo('bottom')}
          title="前往最新对话"
          aria-label="前往最新对话"
          className="absolute left-1/2 z-40 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-n40 bg-n0 text-n500 shadow-bottom hover:border-primary hover:text-primary"
          style={{ bottom: composerHeight + 28 }}
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30" data-testid="floating-conversation-composer">
        <div
          className="mx-auto grid w-full max-w-[1540px] grid-cols-1 gap-3 px-3 lg:grid-cols-[124px_minmax(0,1fr)_172px] xl:grid-cols-[140px_minmax(0,1fr)_196px]"
          data-testid="conversation-composer-grid"
        >
          <div className="min-w-0 lg:col-start-2">
            {error && (
              <div className="pointer-events-auto mb-2 flex w-full items-center gap-3 rounded border border-danger/30 bg-r50 px-3 py-2 text-xs text-danger shadow-sm">
                <span className="min-w-0 flex-1">{error}</span>
                <button
                  type="button"
                  onClick={onDismissError}
                  title="关闭错误提示"
                  aria-label="关闭错误提示"
                  className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-danger/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div
              className="pointer-events-auto relative flex w-full flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-[0_18px_55px_rgba(15,23,42,0.16)] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10"
              style={{ height: composerHeight }}
            >
          <button
            type="button"
            data-testid="composer-resize-handle"
            onPointerDown={event => {
              event.preventDefault();
              const scrollNode = scrollRef.current;
              keepLatestVisibleOnResizeRef.current = !scrollNode
                || scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 48;
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
            <input
              ref={composerFileInputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.json"
              onChange={handleComposerFileUpload}
            />
            <button
              type="button"
              onClick={() => composerFileInputRef.current?.click()}
              disabled={!selectedFile || isSending}
              title="上传文本到输入框"
              aria-label="上传文本到输入框"
              className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-n300 hover:bg-n20 hover:text-primary disabled:cursor-not-allowed disabled:text-n100"
            >
              <Upload className="h-4 w-4" />
            </button>
            {onOpenVideoReverse && (
              <button
                type="button"
                onClick={onOpenVideoReverse}
                disabled={!selectedFile || isSending}
                title="视频反推：上传视频并生成候选剧本"
                aria-label="打开视频反推"
                className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs text-n300 hover:bg-n20 hover:text-primary disabled:cursor-not-allowed disabled:text-n100"
              >
                <Wand2 className="h-4 w-4" />
                视频反推
              </button>
            )}
            <div
              className="inline-flex h-8 flex-shrink-0 overflow-hidden rounded border border-n40 bg-n10"
              role="group"
              aria-label="选择镜头时长模式"
            >
              <button
                type="button"
                onClick={() => setShotDurationMode('complete')}
                disabled={isSending}
                title="直接完善：优先生成 10-15 秒的完整镜头"
                className={`px-2 text-xs transition-colors ${shotDurationMode === 'complete' ? 'bg-primary text-white' : 'text-n400 hover:bg-n20 hover:text-primary'}`}
              >
                直接完善
              </button>
              <button
                type="button"
                onClick={() => setShotDurationMode('fragmented')}
                disabled={isSending}
                title="细碎 + 合并：先生成 3-5 秒基础镜头，再按不超过 15 秒组织分段"
                className={`border-l border-n40 px-2 text-xs transition-colors ${shotDurationMode === 'fragmented' ? 'bg-primary text-white' : 'text-n400 hover:bg-n20 hover:text-primary'}`}
              >
                细碎 + 合并
              </button>
            </div>
            <span
              className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-warning"
              title="根据当前输入、历史上下文、预计输出和所选模型动态计算"
            >
              <Coins className="h-3.5 w-3.5" />
              预计消耗积分：{isEstimatingCredits ? '计算中…' : (estimatedCreditCost ?? '--')}
            </span>
            <label className="relative ml-auto min-w-0">
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
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!selectedFile || !draft.trim() || isSending}
              title="发送"
              aria-label="发送"
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-n800 text-white hover:bg-n700 disabled:cursor-not-allowed disabled:bg-n100"
            >
              {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
            </div>
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
              <button
                type="button"
                onClick={() => setIsReferenceScriptCollapsed(current => !current)}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded border border-n40 bg-n0 px-3 text-xs text-n700 hover:border-primary hover:text-primary"
                aria-label={isReferenceScriptCollapsed ? '展开文字剧本对照' : '收起文字剧本对照'}
              >
                {isReferenceScriptCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
                {isReferenceScriptCollapsed ? '展开文字剧本' : '收起文字剧本'}
              </button>
              <button type="button" onClick={() => setEditingVersion(null)} className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded text-n300 hover:bg-n20 hover:text-n800" aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={`grid min-h-0 flex-1 overflow-hidden ${isReferenceScriptCollapsed ? 'grid-cols-1 grid-rows-1' : 'grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1'}`}>
              <section className="flex min-h-0 min-w-0 flex-col bg-n0">
                <div className="flex h-10 flex-shrink-0 items-center border-b border-n40 px-5 text-xs font-semibold text-n700">
                  分镜脚本（可编辑）
                </div>
                <textarea
                  value={editValue}
                  onChange={event => setEditValue(event.target.value)}
                  className="min-h-0 flex-1 resize-none bg-n0 p-5 font-mono text-sm leading-7 text-n800 outline-none"
                  aria-label="编辑分镜脚本内容"
                />
              </section>
              {!isReferenceScriptCollapsed && (
                <aside className="flex min-h-0 min-w-0 flex-col border-t border-n40 bg-n20 lg:border-l lg:border-t-0">
                  <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-n40 px-5">
                    <span className="text-xs font-semibold text-n700">文字剧本（对照）</span>
                    <span className="text-[10px] text-n100">最初输入 · 只读</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-5 text-sm leading-7 text-n700 custom-scrollbar">
                    {initialScriptContent || '暂无最初输入的文字剧本'}
                  </div>
                </aside>
              )}
            </div>
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
