import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const videoGenSource = readFileSync(resolve(__dirname, '../../pages/VideoGenPage.tsx'), 'utf-8');
const videoPageSource = readFileSync(resolve(__dirname, '../../components/VideoPage.tsx'), 'utf-8');

describe('video workspace storyboard prompt wiring', () => {
  it('builds newly imported prompts from full storyboard context', () => {
    expect(videoGenSource).toContain('const prompt = buildStoryboardVideoPrompt(item as any)');
    expect(videoGenSource).toContain('item?.id');
    expect(videoGenSource).toContain('actionText:');
    expect(videoGenSource).toContain('dialogue:');
  });

  it('loads and persists complete segmented shot identity for the video workspace', () => {
    expect(videoGenSource).toContain('buildVideoStoryboardShotLookup(storyboardItemsForImport)');
    expect(videoGenSource).toContain('storyboardShotLabel: shotInfo?.label');
    expect(videoGenSource).toContain('isStoryboardSegmentStart: shotInfo?.isFirstInSegment');
    expect(videoGenSource).toContain('loadStoryboardItemsPage({ limit: totalStoryboardCount, includeTotal: false })');
  });

  it('upgrades untouched persisted prompts without replacing user edits', () => {
    expect(videoPageSource).toContain('upgradeLegacyStoryboardVideoPrompt(');
    expect(videoPageSource).toContain('getStoryboardPromptSourcesForGroup(group)');
    expect(videoPageSource).toContain('getEffectiveGroupPrompt(group)');
    expect(videoPageSource).toContain('item?.id');
  });

  it('renders hierarchical shot ranges and modal-based reversible merges', () => {
    expect(videoPageSource).toContain('getGroupShotRange(group, index)');
    expect(videoPageSource).not.toContain('`SB-${sortOrder + 1}`');
    expect(videoPageSource).toContain('data-testid="video-merge-dialog"');
    expect(videoPageSource).toContain('data-testid="video-merge-cross-segment-warning"');
    expect(videoPageSource).toContain('data-testid="video-merge-duration-warning"');
    expect(videoPageSource).toContain('data-testid="video-merged-card-dialog"');
    expect(videoPageSource).toContain('removeShotFromMergedCard(group.uuid, childIndex)');
    expect(videoPageSource).toContain('group.ids.length === 2 && !group.mergedFrom?.length');
  });
});
