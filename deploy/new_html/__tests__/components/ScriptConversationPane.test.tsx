import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../components/ScriptConversationPane.tsx'), 'utf-8');
const workspace = readFileSync(resolve(__dirname, '../../WorkspaceApp.tsx'), 'utf-8');
const storyboardColumn = readFileSync(resolve(__dirname, '../../components/StoryboardColumn.tsx'), 'utf-8');

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

  it('uploads a text file into the current draft without creating or sending a task', () => {
    expect(source).toContain('aria-label="上传文本到输入框"');
    expect(source).toContain('accept=".txt,.md,.json"');
    expect(source).toContain('reader.readAsText(file)');
    expect(source).toContain("if (typeof text === 'string') setDraft(text)");
    expect(source).toContain('composerFileInputRef.current?.click()');
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

  it('keeps long replies foldable from both ends and opens the editor nearly full screen', () => {
    expect(source).toContain("isCollapsed ? '展开内容' : '折叠内容'");
    expect(source).toContain("isCollapsed ? '展开完整内容' : '收起内容'");
    expect(source).toContain('fixed inset-0 z-[100]');
    expect(source).toContain('max-w-[1600px]');
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
    expect(source).toContain('style={{ paddingBottom: composerHeight + 36 }}');
    expect(source).toContain('keepLatestVisibleOnResizeRef');
    expect(source).toContain('scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 48');
    expect(source).toContain('useLayoutEffect(() =>');
    expect(source).toContain('}, [composerHeight, updateScrollControls]);');
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

  it('summarizes conversation and storyboard progress in the right rail', () => {
    expect(source).toContain('data-testid="conversation-summary-rail"');
    expect(source).toContain('对话数量');
    expect(source).toContain('分镜版本');
    expect(source).toContain('镜头设计历史');
    expect(source).toContain("storyboardItemCount > 0 ? `已生成 · ${storyboardItemCount} 个镜头` : '尚未生成'");
    expect(source).toContain('selectedFile?.versions?.length || 0');
    expect(workspace).toContain('storyboardTotalsByFileId[selectedFileId] ?? 0');
  });

  it('uses separated rounded cards for long conversation messages', () => {
    expect(source).toContain('rounded-lg border border-n40 px-4 py-5 shadow-sm');
    expect(source).toContain('<main className="min-w-0 space-y-3">');
  });

  it('does not block entry with the decorative loading overlay', () => {
    expect(workspace).not.toContain("import { LoadingOverlay }");
    expect(workspace).not.toContain('<LoadingOverlay />');
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
