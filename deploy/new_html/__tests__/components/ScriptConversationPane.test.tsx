import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../components/ScriptConversationPane.tsx'), 'utf-8');
const workspace = readFileSync(resolve(__dirname, '../../WorkspaceApp.tsx'), 'utf-8');
const storyboardColumn = readFileSync(resolve(__dirname, '../../components/StoryboardColumn.tsx'), 'utf-8');
const videoReversePage = readFileSync(resolve(__dirname, '../../pages/VideoReversePage.tsx'), 'utf-8');
const workflowLayout = readFileSync(resolve(__dirname, '../../layouts/WorkflowLayout.tsx'), 'utf-8');
const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf-8');

describe('ScriptConversationPane workflow', () => {
  it('uses a persistent conversation composer with runtime model labels', () => {
    expect(source).toContain("label: '化神', runtime: 'Gemini 2.5 Flash'");
    expect(source).toContain("label: '筑基', runtime: 'DeepSeek Reasoner'");
    expect(source).toContain("label: '金丹', runtime: 'DeepSeek Chat'");
    expect(source).toContain('继续输入修改意见');
  });

  it('keeps the single model selector beside the send action', () => {
    expect(source).not.toContain('完整上下文');
    expect(source).not.toContain('{modelOption.runtime}');
    expect(source).toContain('className="relative ml-auto min-w-0"');
    expect(source).toContain('aria-label="发送"');
  });

  it('uses the master generation mode without the shot-duration selector', () => {
    expect(source).not.toContain('选择镜头时长模式');
    expect(source).not.toContain('直接完善');
    expect(source).not.toContain('细碎 + 合并');
    expect(source).not.toContain('shotDurationMode');
    expect(source).toContain('await onSend(content)');
    expect(workspace).toContain("aiModel,\n          content,\n          '',");
    expect(workspace).not.toContain('buildShotDurationInstruction');
    expect(workspace).not.toContain('shotDurationMode');
  });

  it('shows a dynamic credit estimate before each script generation', () => {
    expect(source).toContain("estimateCredits('script_model_call', creditEstimateParams)");
    expect(source).toContain('input_tokens: estimateTextTokens(billingInput)');
    expect(source).toContain('output_tokens: forecastOutputTokens');
    expect(source).toContain('每次生成都会扣除一定数量的积分');
    expect(source).toContain("预计消耗积分：{isEstimatingCredits ? '计算中…' : (estimatedCreditCost ?? '--')}");
  });

  it('uploads a text file into the current draft without creating or sending a task', () => {
    expect(source).toContain('aria-label="上传文本到输入框"');
    expect(source).toContain('accept=".txt,.md,.json"');
    expect(source).toContain('reader.readAsText(file)');
    expect(source).toContain("if (typeof text === 'string') setDraft(text)");
    expect(source).toContain('composerFileInputRef.current?.click()');
  });

  it('integrates video reverse as a script composer tool and refreshes the imported candidate', () => {
    expect(source).toContain('aria-label="打开视频反推"');
    expect(source).toContain('视频反推：上传视频并生成候选剧本');
    expect(workspace).toContain('data-testid="video-reverse-tool-dialog"');
    expect(workspace).toContain('onOpenVideoReverse={() => setVideoReverseOpen(true)}');
    expect(workspace).toContain('await loadEpisodeData(scriptId)');
    expect(videoReversePage).toContain('onCandidateCreated?: (scriptId: string) => Promise<void> | void');
    expect(videoReversePage).toContain('await onCandidateCreated(scriptId)');
    expect(workflowLayout).not.toContain("path: 'video-reverse'");
    expect(app).toContain('<Navigate to="../script" replace />');
  });

  it('keeps immutable reply actions together', () => {
    expect(source).toContain('生成镜头设计');
    expect(source).toContain('编辑分镜脚本');
    expect(source).toContain('导出 Excel');
    expect(source).toContain('保存后创建新版本，历史回复不会被覆盖');
  });

  it('labels the initial script separately and attaches adoption to a specific version', () => {
    expect(source).toContain("message.id === firstUserMessageId ? '输入文字剧本' : '修改要求'");
    expect(source).toContain('version && isWorkflowScript && conversation?.currentVersionId === version.id');
    expect(source).toContain("{isWorkflowScript ? '当前采用版本' : '当前版本'}");
  });

  it('renders storyboard design as a closed drawer by default', () => {
    expect(workspace).toContain('const [storyboardDrawerOpen, setStoryboardDrawerOpen] = useState(false)');
    expect(workspace).toContain("storyboardDrawerOpen ? 'translate-x-0' : 'translate-x-full'");
    expect(workspace).toContain('onClose={() => setStoryboardDrawerOpen(false)}');
    expect(source).toContain('展开镜头设计');
    expect(workspace).toContain('onOpenStoryboard={handleOpenStoryboardDrawer}');
  });

  it('expands storyboard design across the workspace beside the file list with linked script and design columns', () => {
    expect(workspace).toContain('data-testid="storyboard-workspace-drawer"');
    expect(workspace).toContain('absolute inset-0 z-40 w-full');
    expect(workspace).toContain('grid-cols-[minmax(360px,1.2fr)_minmax(420px,1fr)]');
    expect(workspace).toContain('<StoryboardScriptColumn');
    expect(workspace).toContain('onSelectItemIds={handleStoryboardSelectionChange}');
    expect(workspace).toContain('onHighlightScript={handleStoryboardSelectionChange}');
  });

  it('keeps long replies foldable from both ends and opens the editor nearly full screen', () => {
    expect(source).toContain("isCollapsed ? '展开内容' : '折叠内容'");
    expect(source).toContain("isCollapsed ? '展开完整内容' : '收起内容'");
    expect(source).toContain('setCollapsedEntry(current, key, shouldCollapse)');
    expect(source).toContain('aria-expanded={!isCollapsed}');
    expect(source).not.toContain('toggleCollapsed');
    expect(source).toContain('fixed inset-0 z-[100]');
    expect(source).toContain('max-w-[1600px]');
  });

  it('edits storyboard scripts beside a collapsible initial-script reference', () => {
    expect(source).toContain("message.role === 'user' && message.content.trim()");
    expect(source).toContain("firstUserMessage?.content || selectedFile?.originalContent || ''");
    expect(source).toContain('分镜脚本（可编辑）');
    expect(source).toContain('文字剧本（对照）');
    expect(source).toContain('最初输入 · 只读');
    expect(source).toContain("isReferenceScriptCollapsed ? '展开文字剧本' : '收起文字剧本'");
    expect(source).toContain("isReferenceScriptCollapsed ? 'grid-cols-1 grid-rows-1' : 'grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1'");
    expect(source).toContain('const [isReferenceScriptOnLeft, setIsReferenceScriptOnLeft] = useState(true)');
    expect(source).toContain('setIsReferenceScriptOnLeft(true)');
    expect(source).toContain('aria-label="交换文字剧本与分镜脚本的左右位置"');
    expect(source).toContain("isReferenceScriptCollapsed || !isReferenceScriptOnLeft ? 'order-1' : 'order-2'");
    expect(source).toContain("isReferenceScriptOnLeft ? 'order-1' : 'order-2'");
  });

  it('moves the composer resize handle to the upper right and follows the latest reply', () => {
    expect(source).toContain('data-testid="composer-resize-handle"');
    expect(source).toContain('absolute right-3 top-2');
    expect(source).toContain('latestMessage?.content');
    expect(source).toContain('node.scrollTop = node.scrollHeight');
  });

  it('floats the composer while reserving enough viewport space for the latest reply', () => {
    expect(source).toContain('h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden');
    expect(source).toContain('data-testid="floating-conversation-composer"');
    expect(source).toContain('pointer-events-none absolute inset-x-0 bottom-4');
    expect(source).toContain('data-testid="conversation-composer-spacer"');
    expect(source).toContain('style={{ height: composerHeight + 36 }}');
    expect(source).not.toContain('style={{ paddingBottom: composerHeight + 36 }}');
    expect(source).toContain('keepLatestVisibleOnResizeRef');
    expect(source).toContain('scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 48');
    expect(source).toContain('useLayoutEffect(() =>');
    expect(source).toContain('}, [composerHeight, updateScrollControls]);');
  });

  it('aligns the floating composer with the center conversation column', () => {
    expect(source).toContain('data-testid="conversation-composer-grid"');
    expect(source).toContain('lg:grid-cols-[124px_minmax(0,1fr)_172px]');
    expect(source).toContain('xl:grid-cols-[140px_minmax(0,1fr)_196px]');
    expect(source).toContain('min-w-0 lg:col-start-2');
    expect(source).toContain('pointer-events-auto relative flex w-full flex-col');
    expect(source).not.toContain('w-[calc(100%-24px)] max-w-6xl');
  });

  it('provides turn navigation and a floating jump-to-latest action', () => {
    expect(source).toContain('data-testid="conversation-turn-rail"');
    expect(source).toContain('aria-label="对话轮次快速导航"');
    expect(source).toContain('onClick={() => scrollToTurn(turn)}');
    expect(source).toContain('data-testid="conversation-jump-to-latest"');
    expect(source).toContain('scrollControls.canScrollDown');
    expect(source).toContain('style={{ bottom: composerHeight + 28 }}');
    expect(source).toContain('aria-label="回到对话顶部"');
    expect(source).toContain('aria-label="前往最新对话"');
    expect(source).toContain("scrollConversationTo('top')");
    expect(source).toContain("scrollConversationTo('bottom')");
    expect(source).toContain("behavior: 'smooth'");
  });

  it('keeps card-level top and bottom controls on the text right edge and fades them near each boundary', () => {
    expect(source).toContain("const scrollMessageBoundary = (messageId: string, boundary: 'top' | 'bottom')");
    expect(source).toContain('data-testid={`script-card-scroll-controls-${message.id}`}');
    expect(source).toContain("onClick={() => scrollMessageBoundary(message.id, 'top')}");
    expect(source).toContain("onClick={() => scrollMessageBoundary(message.id, 'bottom')}");
    expect(source).toContain('flex w-9 flex-shrink-0 self-stretch flex-col items-center');
    expect(source).toContain('sticky top-1/2');
    expect(source).toContain("messageControls.canJumpTop || messageControls.canJumpBottom ? 'opacity-100' : 'pointer-events-none opacity-0'");
    expect(source).toContain("messageControls.canJumpTop ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'");
    expect(source).toContain("messageControls.canJumpBottom ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'");
    expect(source).toContain('const visibleBottom = nodeRect.bottom - composerHeightRef.current - 44');
    expect(source).toContain('composerHeight + 48');
  });

  it('summarizes conversation and storyboard progress in the right rail', () => {
    expect(source).toContain('data-testid="conversation-summary-rail"');
    expect(source).toContain('对话数量');
    expect(source).toContain('分镜版本');
    expect(source).toContain('镜头设计历史');
    expect(source).toContain("storyboardItemCount > 0 ? `已生成 · ${storyboardItemCount} 个镜头` : '尚未生成'");
    expect(source).toContain('selectedFile?.versions?.length || 0');
    expect(workspace).toContain('storyboardTotalsByFileId[selectedFileId] ?? 0');
  });

  it('shows both information rails on common Mac desktop viewport widths', () => {
    expect(source).toContain('hidden min-w-0 lg:block');
    expect(source).not.toContain('hidden min-w-0 2xl:block');
  });

  it('uses separated rounded cards for long conversation messages', () => {
    expect(source).toContain('rounded-lg border border-n40 px-4 py-5 shadow-sm');
    expect(source).toContain('<main className="min-w-0 space-y-3">');
  });

  it('does not block entry with the decorative loading overlay', () => {
    expect(workspace).not.toContain("import { LoadingOverlay }");
    expect(workspace).not.toContain('<LoadingOverlay />');
  });

  it('shows cached script content immediately while conversations sync in the background', () => {
    expect(workspace).toContain('function buildLocalScriptConversation(file: ProjectFile)');
    expect(workspace).toContain('loadedConversationKeysRef.current.has(cacheKey)');
    expect(workspace).toContain('conversationRequestsRef.current.get(cacheKey)');
    expect(source).toContain('isLoading && !conversation');
    expect(source).toContain('正在后台同步最新对话');
  });

  it('isolates undo and redo inside the active storyboard version', () => {
    expect(workspace).toContain('buildVersionHistoryScopeKey(selectedFileId, selectedConversationVersion?.id)');
    expect(workspace).toContain('fileHistory[selectedHistoryScopeKey]');
    expect(workspace).toContain('recordHistory: false');
    expect(workspace).toContain('resetHistory: true');
    expect(workspace).toContain('versionId: selectedVersion.id');
  });

  it('shows persisted storyboard versions in the drawer history and can restore them', () => {
    expect(workspace).toContain('scriptVersions={selectedConversation?.versions || []}');
    expect(workspace).toContain('onRestoreScriptVersion={(version) => handleConversationGenerateDesign(version, { autoSnapshot: false })}');
    expect(storyboardColumn).toContain('分镜脚本 V{version.versionNo}');
    expect(storyboardColumn).toContain('恢复此版本');
  });
});
