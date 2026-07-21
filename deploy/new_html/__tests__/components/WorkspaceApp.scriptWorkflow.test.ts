import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../WorkspaceApp.tsx'), 'utf-8');

describe('WorkspaceApp script workflow persistence', () => {
  it('persists only the script record whose content changed', () => {
    expect(source).toContain('savedScriptSignaturesRef.current[file.id] === signature');
    expect(source).toContain('updateEpisodeScriptById(propEpisodeId, file.id');
  });

  it('appends newly generated storyboard items without deleting existing items', () => {
    expect(source).toContain("const newItems = realItems.filter(i => !i.id || !i.id.startsWith('sb_'))");
    expect(source).toContain('batchCreateStoryboardItems(propEpisodeId, dbItems, file.id)');
    expect(source).not.toContain('deleteAllStoryboardItems(propEpisodeId, file.id)');
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
    expect(source).toContain('collectConversationStoryboardSnapshots(conversation)');
    expect(source).toContain('handleConversationGenerateDesign(version, { autoSnapshot: false })');
  });
});
