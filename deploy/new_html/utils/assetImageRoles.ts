export const ASSET_IMAGE_FILE_ROLES = [
  'reference_image',
  'material_image',
  'generated_image',
] as const;

export type AssetImageFileRole = typeof ASSET_IMAGE_FILE_ROLES[number];

const ASSET_IMAGE_FILE_ROLE_SET: ReadonlySet<string> = new Set(ASSET_IMAGE_FILE_ROLES);

export function isAssetImageFileRole(role: string | null | undefined): role is AssetImageFileRole {
  return typeof role === 'string' && ASSET_IMAGE_FILE_ROLE_SET.has(role);
}
