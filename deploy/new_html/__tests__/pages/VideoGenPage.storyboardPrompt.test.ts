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

  it('upgrades untouched persisted prompts without replacing user edits', () => {
    expect(videoPageSource).toContain('upgradeLegacyStoryboardVideoPrompt(');
    expect(videoPageSource).toContain('getStoryboardPromptSourcesForGroup(group)');
    expect(videoPageSource).toContain('getEffectiveGroupPrompt(group)');
    expect(videoPageSource).toContain('item?.id');
  });
});
