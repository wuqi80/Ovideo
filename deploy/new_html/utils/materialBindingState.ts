import type { AssetItem, StoryboardItemDB } from '../types';
import { dbItemToStoryboardItem } from './episodeAdapters';

function hasMaterialTag(item: StoryboardItemDB, tagName: string): boolean {
  const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
  return boundAssets.some(entry => (
    entry === `char:${tagName}`
    || entry === `scene:${tagName}`
    || entry === `prop:${tagName}`
  ));
}

export function getFollowingMaterialTargets(
  storyboardItems: StoryboardItemDB[],
  shotId: string,
  tagName: string,
): StoryboardItemDB[] {
  const currentIndex = storyboardItems.findIndex(item => item.itemId === shotId);
  if (currentIndex < 0) return [];

  return storyboardItems
    .slice(currentIndex + 1)
    .filter(item => hasMaterialTag(item, tagName));
}

export function isMaterialSyncedToCurrentAndFollowing(
  storyboardItems: StoryboardItemDB[],
  assets: AssetItem[],
  shotId: string,
  tagName: string,
  materialId: string,
): boolean {
  const currentItem = storyboardItems.find(item => item.itemId === shotId);
  if (!currentItem) return false;

  const targets = [
    currentItem,
    ...getFollowingMaterialTargets(storyboardItems, shotId, tagName),
  ];

  return targets.every(item => (
    dbItemToStoryboardItem(item, assets).materialSelections?.[tagName] === materialId
  ));
}
