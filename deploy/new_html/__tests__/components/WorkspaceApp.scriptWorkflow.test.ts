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
});
