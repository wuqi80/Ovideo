import { apiJson } from './httpClient';

export interface CreateAssetPayload {
  project_id: string;
  asset_type: string;
  name: string;
  episode_id?: string;
  script_id?: string;
  description?: string;
  reference_images?: string[];
}

export async function createAsset(data: CreateAssetPayload) {
  return apiJson<any>('/api/assets', {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createAsset');
}

export async function updateAsset(assetId: string, data: Record<string, any>) {
  return apiJson<any>(`/api/assets/${assetId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateAsset');
}

export async function deleteAsset(assetId: string) {
  return apiJson<any>(`/api/assets/${assetId}`, { method: 'DELETE' }, 'deleteAsset');
}

export async function shareAsset(assetId: string, targetEpisodeId: string, targetScriptId: string) {
  return apiJson<any>(`/api/assets/${assetId}/share`, {
    method: 'POST',
    body: JSON.stringify({ target_episode_id: targetEpisodeId, target_script_id: targetScriptId }),
  }, 'shareAsset');
}

export async function syncExistingAssetDesigns(projectId: string, data: {
  episode_id: string;
  script_id?: string;
  asset_types?: string[];
  overwrite?: boolean;
}) {
  return apiJson<any>(`/api/projects/${projectId}/assets/sync-existing-designs`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'syncExistingAssetDesigns');
}
