import { describe, expect, it } from 'vitest';

import { filterAssetsForEpisodeScope, isSharedAsset } from '../../utils/assetScope';

describe('assetScope', () => {
  const assets = [
    { assetId: 'shared', episodeId: null, name: '共享角色' },
    { assetId: 'ep1', episodeId: 'ep_1', name: '本集角色' },
    { assetId: 'ep2', episodeId: 'ep_2', name: '其他集角色' },
  ] as any[];

  it('keeps current episode assets and shared assets in episode scope', () => {
    const scoped = filterAssetsForEpisodeScope(assets, 'ep_1', 'episode');
    expect(scoped.map(a => a.assetId)).toEqual(['shared', 'ep1']);
  });

  it('keeps all assets in project scope', () => {
    const scoped = filterAssetsForEpisodeScope(assets, 'ep_1', 'project');
    expect(scoped.map(a => a.assetId)).toEqual(['shared', 'ep1', 'ep2']);
  });

  it('recognizes snake_case shared assets', () => {
    expect(isSharedAsset({ asset_id: 'shared', episode_id: null })).toBe(true);
  });
});
