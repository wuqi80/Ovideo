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
    expect(workspace).toContain('onRestoreScriptVersion={handleConversationGenerateDesign}');
    expect(storyboardColumn).toContain('分镜脚本 V{version.versionNo}');
    expect(storyboardColumn).toContain('恢复此版本');
  });
});
