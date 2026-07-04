import { describe, expect, it } from 'vitest';

import { assetsToMaterialLibrary } from '../../utils/episodeAdapters';

describe('assetsToMaterialLibrary', () => {
  it('includes generated material_image files alongside reference images', () => {
    const library = assetsToMaterialLibrary([
      {
        assetId: 'asset_1',
        name: '小悟',
        referenceImages: ['/storage/legacy/original.webp', '/storage/generated/angle.webp'],
        thumbnailUrl: null,
        entityFiles: [
          {
            fileId: 'file_ref',
            fileUrl: '/storage/legacy/original.webp',
            fileType: 'image',
            fileRole: 'reference_image',
            createdAt: '2026-07-04T01:00:00',
          },
          {
            fileId: 'file_angle',
            fileUrl: '/storage/generated/angle.webp',
            fileType: 'image',
            fileRole: 'material_image',
            createdAt: '2026-07-04T02:00:00',
          },
        ],
      } as any,
    ]);

    expect(library['小悟']).toEqual([
      expect.objectContaining({
        id: 'asset_1_0',
        url: '/storage/legacy/original.webp',
        source: 'asset',
      }),
      expect.objectContaining({
        id: 'asset_1_1',
        url: '/storage/generated/angle.webp',
        source: 'asset',
      }),
    ]);
  });

  it('keeps legacy references before generated entity files for stable selection ids', () => {
    const library = assetsToMaterialLibrary([
      {
        assetId: 'asset_2',
        name: '角色A',
        referenceImages: ['/storage/legacy/original.webp'],
        thumbnailUrl: null,
        entityFiles: [
          {
            fileId: 'file_angle',
            fileUrl: '/storage/generated/angle.webp',
            fileType: 'image',
            fileRole: 'material_image',
            createdAt: '2026-07-04T02:00:00',
          },
        ],
      } as any,
    ]);

    expect(library['角色A']).toEqual([
      expect.objectContaining({
        id: 'asset_2_0',
        url: '/storage/legacy/original.webp',
      }),
      expect.objectContaining({
        id: 'asset_2_1',
        url: '/storage/generated/angle.webp',
        source: 'entity_file:material_image',
      }),
    ]);
  });
});
