import { describe, expect, it } from 'vitest';
import type { AssetItem, StoryboardItemDB } from '../../types';
import {
  getFollowingMaterialTargets,
  isMaterialSyncedToCurrentAndFollowing,
} from '../../utils/materialBindingState';

const asset: AssetItem = {
  assetId: 'asset_character',
  projectId: 'project_1',
  episodeId: 'episode_1',
  assetType: 'character',
  name: '小悟',
  description: '',
  thumbnailUrl: 'https://example.com/front.png',
  referenceImages: [
    'https://example.com/front.png',
    'https://example.com/side.png',
  ],
  styleParams: {},
  tags: [],
  createdBy: 'tester',
  createdAt: '2026-07-24T00:00:00Z',
};

function storyboardItem(
  itemId: string,
  sortOrder: number,
  boundAssets: string[],
): StoryboardItemDB {
  return {
    itemId,
    episodeId: 'episode_1',
    sortOrder,
    sceneHeading: '',
    actionText: '',
    dialogue: '',
    cameraMovement: '',
    imagePrompt: '',
    videoPrompt: '',
    generatedImageUrl: null,
    boundAssets,
    configuredReferences: [],
    status: '',
    dialogueAudioUrl: null,
    narrationAudioUrl: null,
    sfxAudioUrl: null,
    audioDurationMs: null,
    plannedDurationMs: null,
  };
}

describe('material binding state', () => {
  it('treats the first design image as the default binding on every matching shot', () => {
    const items = [
      storyboardItem('shot_1', 1, ['char:小悟']),
      storyboardItem('shot_2', 2, ['char:小悟']),
      storyboardItem('shot_3', 3, ['scene:办公室']),
    ];

    expect(getFollowingMaterialTargets(items, 'shot_1', '小悟')).toEqual([items[1]]);
    expect(isMaterialSyncedToCurrentAndFollowing(
      items,
      [asset],
      'shot_1',
      '小悟',
      'asset_character_0',
    )).toBe(true);
  });

  it('requires an explicitly selected alternate image on every following matching shot', () => {
    const items = [
      storyboardItem('shot_1', 1, ['char:小悟', 'sel:小悟:asset_character_1']),
      storyboardItem('shot_2', 2, ['char:小悟']),
    ];

    expect(isMaterialSyncedToCurrentAndFollowing(
      items,
      [asset],
      'shot_1',
      '小悟',
      'asset_character_1',
    )).toBe(false);

    items[1] = storyboardItem('shot_2', 2, [
      'char:小悟',
      'sel:小悟:asset_character_1',
    ]);
    expect(isMaterialSyncedToCurrentAndFollowing(
      items,
      [asset],
      'shot_1',
      '小悟',
      'asset_character_1',
    )).toBe(true);
  });

  it('does not report an explicitly unbound matching shot as synchronized', () => {
    const items = [
      storyboardItem('shot_1', 1, ['char:小悟']),
      storyboardItem('shot_2', 2, ['char:小悟', 'nosel:小悟']),
    ];

    expect(isMaterialSyncedToCurrentAndFollowing(
      items,
      [asset],
      'shot_1',
      '小悟',
      'asset_character_0',
    )).toBe(false);
  });
});
