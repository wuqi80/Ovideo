import { apiJson } from './httpClient';

export interface CreateEpisodeScriptPayload {
  file_name?: string;
  original_content?: string;
  adapted_script?: string;
  sort_order?: number;
  metadata?: any;
}

export interface UpdateEpisodeScriptPayload {
  file_name?: string;
  original_content?: string;
  adapted_script?: string;
  metadata?: any;
}

export async function listEpisodeScripts(episodeId: string) {
  return apiJson<any>(`/api/episodes/${episodeId}/scripts`, { method: 'GET' }, 'listEpisodeScripts');
}

export async function createEpisodeScript(episodeId: string, data: CreateEpisodeScriptPayload) {
  return apiJson<any>(`/api/episodes/${episodeId}/scripts`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createEpisodeScript');
}

export async function updateEpisodeScriptById(
  episodeId: string,
  scriptId: string,
  data: UpdateEpisodeScriptPayload,
) {
  return apiJson<any>(`/api/episodes/${episodeId}/scripts/${scriptId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateEpisodeScriptById');
}

export async function deleteEpisodeScript(episodeId: string, scriptId: string) {
  return apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}`,
    { method: 'DELETE' },
    'deleteEpisodeScript',
  );
}

export async function getWorkflowScript(episodeId: string) {
  return apiJson<any>(
    `/api/episodes/${episodeId}/workflow-script`,
    { method: 'GET' },
    'getWorkflowScript',
  );
}

export async function selectWorkflowScript(episodeId: string, scriptId: string) {
  return apiJson<any>(`/api/episodes/${episodeId}/workflow-script`, {
    method: 'PUT',
    body: JSON.stringify({ script_id: scriptId }),
  }, 'selectWorkflowScript');
}

export async function listEpisodeScriptSegments(episodeId: string, scriptId?: string) {
  const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
  return apiJson<any>(
    `/api/episodes/${episodeId}/script-segments${qs}`,
    { method: 'GET' },
    'listEpisodeScriptSegments',
  );
}

export async function batchSaveScriptSegments(
  episodeId: string,
  scriptId: string | null,
  segments: any[],
) {
  return apiJson<any>(`/api/episodes/${episodeId}/script-segments/batch`, {
    method: 'PUT',
    body: JSON.stringify({ script_id: scriptId, segments }),
  }, 'batchSaveScriptSegments');
}

export async function deleteScriptSegments(episodeId: string, scriptId?: string) {
  const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
  return apiJson<any>(
    `/api/episodes/${episodeId}/script-segments${qs}`,
    { method: 'DELETE' },
    'deleteScriptSegments',
  );
}

export async function getTimelineTracks(episodeId: string) {
  return apiJson<any>(`/api/episodes/${episodeId}/timeline-tracks`, { method: 'GET' }, 'getTimelineTracks');
}

export async function createTimelineTrack(episodeId: string, data: any) {
  return apiJson<any>(`/api/episodes/${episodeId}/timeline-tracks`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createTimelineTrack');
}

export async function updateTimelineTrack(trackId: string, data: any) {
  return apiJson<any>(`/api/timeline-tracks/${trackId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateTimelineTrack');
}
