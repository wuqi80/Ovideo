import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../WorkspaceApp.tsx'), 'utf-8');

describe('WorkspaceApp script workflow persistence', () => {
  it('persists only the script record whose content changed', () => {
    expect(source).toContain('savedScriptSignaturesRef.current[file.id] === signature');
    expect(source).toContain('updateEpisodeScriptById(propEpisodeId, file.id');
  });

  it('replaces the active storyboard design only after archiving the previous current design', () => {
    expect(source).toContain('const archiveActiveStoryboardIfPresent = useCallback');
    expect(source).toContain('const replaceActiveStoryboardDesign = useCallback');
    expect(source).toContain('await archiveActiveStoryboardIfPresent(fileId, { name: options.archiveName })');
    expect(source).toContain('batchCreateStoryboardItems(');
    expect(source).toContain("(file.storyboard?.items || []).filter(item => !item.isPlaceholder)");
  });

  it('exports only the adopted workflow script without replacing persisted storyboards', () => {
    expect(source).toContain('filesRef.current.find(file => file.id === activeScriptId)');
    expect(source).toContain('if (selectedFileId !== activeScriptId)');
    expect(source).toContain('preserve_existing_storyboards: true');
    expect(source).toContain('storyboard_items: []');
  });

  it('downloads a complete JSON workspace backup from the file column', () => {
    expect(source).toContain("format: 'mecha-project-backup'");
    expect(source).toContain('const BACKUP_STORYBOARD_PAGE_SIZE = 200');
    expect(source).toContain('offset: storyboardRows.length');
    expect(source).toContain('mapWorkspaceStoryboardRowsToItems(persistedRows)');
    expect(source).toContain('files: exportedFiles');
    expect(source).toContain('material_library: materialLibraryRef.current');
    expect(source).toContain('script_conversations: exportedConversations');
    expect(source).toContain('JSON.stringify(payload, null, 2)');
    expect(source).toContain('onExportProject={handleExportProject}');
    expect(source).toContain('window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)');
  });

  it('appends persistent storyboard snapshots after generation and manual saves', () => {
    expect(source).toContain('const persistStoryboardSnapshot = useCallback');
    expect(source).toContain('{ [STORYBOARD_SNAPSHOTS_METADATA_KEY]: snapshots }');
    expect(source).toContain("source: 'auto'");
    expect(source).toContain("source: 'manual'");
    expect(source).toContain('collectConversationStoryboardSnapshots(mergedConversation)');
    expect(source).toContain('handleConversationGenerateDesign(version, { autoSnapshot: false })');
  });

  it('offers persistent writing and the master four-column quick pipeline', () => {
    expect(source).toContain("readScriptWorkspaceMode(localStorage, scriptWorkspaceUsername)");
    expect(source).toContain("writeScriptWorkspaceMode(localStorage, scriptWorkspaceUsername, mode)");
    expect(source).toContain("scriptWorkspaceMode === 'writing'");
    expect(source).toContain('data-testid="quick-script-workspace"');
    expect(source).toContain('<QuickScriptSourceColumn');
    expect(source).toContain('<QuickScriptVersionColumn');
    expect(source).toContain('onSplitScript={handleSplitScript}');
    expect(source).toContain('onGenerateVideoScript={handleGenerateVideoScript}');
    expect(source).toContain('onExtractStoryboardPrompts={handleExtractStoryboardPrompts}');
    expect(source).toContain('onRunThreeStage={handleRunThreeStagePipeline}');
    expect(source).toContain('onEditVersion={handleConversationEditVersion}');
    expect(source).toContain('handleConversationGenerateDesign(version, { openDrawer: false })');
    expect(source).toContain('version={quickPipelineVersion}');
    expect(source).toContain('versions={quickAvailableVersions}');
    expect(source).toContain('onSelectVersion={handleQuickSelectVersion}');
    expect(source).toContain('selectedFile={selectedFile}');
    expect(source).not.toContain('onSend={handleRewrite}');
    expect(source).not.toContain('onSend={handleIterateScript}');
  });

  it('shares generated script content between writing and quick modes without overwriting history', () => {
    expect(source).toContain('function mergeScriptConversationWithLocalFile');
    expect(source).toContain('normalizeScriptContentForCompare(version.content) === localContent');
    expect(source).toContain("!matchingVersion.id.startsWith('legacy_')");
    expect(source).toContain('currentVersionId: localVersion.id');
    expect(source).toContain('const rawSelectedConversation = selectedFileId ? scriptConversations[selectedFileId] : undefined');
    expect(source).toContain('() => mergeScriptConversationWithLocalFile(selectedFile, rawSelectedConversation)');
    expect(source).toContain('const quickPipelineVersion = quickAvailableVersions.find');
    expect(source).toContain('buildLocalScriptVersionStoryboardItems(file)');
    expect(source).toContain('const syncScriptConversationFromFile = useCallback');
    expect(source).toContain('messages: [...current.messages.filter(item => item.id !== message.id), message]');
    expect(source).toContain('versions: [...current.versions.filter(item => item.id !== selectedVersion.id), selectedVersion]');
    expect(source).toContain('mergeScriptConversationWithLocalFile(file, scriptConversations[fileId])');
  });

  it('uses one direct streaming prompt for both initial generation and revisions', () => {
    expect(source).toContain('const { aiGenerateStoryboardScript } = await loadAiModelService()');
    expect(source).toContain('result = await aiGenerateStoryboardScript(');
    expect(source).toContain('appendStreamChunk');
    expect(source).toContain('const finalContent = normalizeGeneratedVideoScript(rawFinalContent)');
    expect(source).toContain('parseVideoScriptGroups(content).map(group => [group.groupNo, group.sharedVideoPrompt])');
    expect(source).toContain('const videoPrompt = groupPrompts.get(segmentNo) || item.videoPrompt');
    expect(source).toContain("stage: 'directStoryboardScript'");
    expect(source).toContain("const billingInput = isFirstTurn\n      ? content");
    expect(source).not.toContain('pipelineService.generateEpisodeVideoScript');
    expect(source).not.toContain('pipelineService.iterateEpisodeVideoScript');
    expect(source).not.toContain('assertValidVideoScript(normalizedContent)');
  });

  it('runs quick generation through the retained master three-stage handlers', () => {
    expect(source).toContain('const handleSplitScript = useCallback');
    expect(source).toContain('const handleGenerateVideoScript = useCallback');
    expect(source).toContain('const handleExtractStoryboardPrompts = useCallback');
    expect(source).toContain('const handleRunThreeStagePipeline = useCallback');
    expect(source).toContain('const splitOk = await handleSplitScript(file.id)');
    expect(source).toContain('const videoScriptVersion = await handleGenerateVideoScript(file.id)');
    expect(source).toContain('await handleExtractStoryboardPrompts(file.id, { sourceVersion: videoScriptVersion })');
    expect(source).toContain('if (!splitOk) return;');
    expect(source).toContain("throw new Error('模型未返回可用的剧本分段')");
    expect(source).toContain('splitScriptIntoValidatedSegments(aiModel, file.originalContent');
    expect(source).toContain('generateVideoScriptForSegments(');
    expect(source).toContain('createScriptVersion(propEpisodeId, file.id');
    expect(source).toContain('setCurrent: false');
    expect(source).toContain('clearActiveStoryboardDesign(file.id');
    expect(source).toContain('onRunThreeStage={handleRunThreeStagePipeline}');
    expect(source).not.toContain('handleQuickThreeStageGenerate');
  });

  it('keeps the file rail fixed when switching between writing and quick mode', () => {
    expect(source).toContain('data-testid="quick-script-workspace"');
    expect(source).toContain('className="relative h-full w-[280px] flex-shrink-0 overflow-hidden border-r border-n40"');
    expect(source).toContain('className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"');
  });
});
