import { describe, expect, it } from 'vitest';

import { ASSET_IMAGE_FILE_ROLES, isAssetImageFileRole } from '../../utils/assetImageRoles';

describe('asset image file roles', () => {
  it('accepts every asset image role shared by design and materials', () => {
    expect(ASSET_IMAGE_FILE_ROLES).toEqual([
      'reference_image',
      'material_image',
      'generated_image',
    ]);

    expect(isAssetImageFileRole('reference_image')).toBe(true);
    expect(isAssetImageFileRole('material_image')).toBe(true);
    expect(isAssetImageFileRole('generated_image')).toBe(true);
  });

  it('rejects non-asset roles', () => {
    expect(isAssetImageFileRole('video')).toBe(false);
    expect(isAssetImageFileRole('character_ref')).toBe(false);
    expect(isAssetImageFileRole(undefined)).toBe(false);
  });
});
