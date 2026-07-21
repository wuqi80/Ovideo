import { apiJson } from './httpClient';
import type {
  ScriptConversation,
  ScriptConversationMessage,
  ScriptConversationStatus,
  ScriptStoryboardVersion,
  StoryboardItem,
} from '../types';

const asEpoch = (value: unknown): number => {
  const parsed = value ? new Date(String(value)).getTime() : Date.now();
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const parseJsonValue = <T,>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const asRecord = (value: unknown): Record<string, any> => {
  const parsed = parseJsonValue<unknown>(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, any>
    : {};
};

const asArray = <T,>(value: unknown): T[] => {
  const parsed = parseJsonValue<unknown>(value, []);
  return Array.isArray(parsed) ? parsed as T[] : [];
};

const mapMessage = (row: any): ScriptConversationMessage => ({
  id: String(row?.message_id || row?.messageId || ''),
  role: row?.role || 'assistant',
  content: String(row?.content || ''),
  status: row?.status || 'completed',
  modelAlias: row?.model_alias || row?.modelAlias || undefined,
  provider: row?.provider || undefined,
  modelName: row?.model_name || row?.modelName || undefined,
  replyToMessageId: row?.reply_to_message_id || row?.replyToMessageId || undefined,
  requestId: row?.request_id || row?.requestId || undefined,
  metadata: asRecord(row?.metadata),
  createdAt: asEpoch(row?.created_at || row?.createdAt),
  updatedAt: asEpoch(row?.updated_at || row?.updatedAt),
});

const mapVersion = (row: any): ScriptStoryboardVersion => ({
  id: String(row?.version_id || row?.versionId || ''),
  scriptId: String(row?.script_id || row?.scriptId || ''),
  messageId: row?.message_id || row?.messageId || undefined,
  versionNo: Number(row?.version_no ?? row?.versionNo ?? 0),
  content: String(row?.content || ''),
  storyboardItems: asArray<StoryboardItem>(row?.storyboard_items ?? row?.storyboardItems),
  source: row?.source || 'ai',
  status: row?.status || 'ready',
  modelAlias: row?.model_alias || row?.modelAlias || undefined,
  provider: row?.provider || undefined,
  modelName: row?.model_name || row?.modelName || undefined,
  metadata: asRecord(row?.metadata),
  createdAt: asEpoch(row?.created_at || row?.createdAt),
  updatedAt: asEpoch(row?.updated_at || row?.updatedAt),
});

export interface CreateEpisodeScriptPayload {
  file_name?: string;
  original_content?: string;
  adapted_script?: string;
  sort_order?: number;
  metadata?: any;
  source_type?: string;
  source_id?: string;
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

export async function getScriptConversation(
  episodeId: string,
  scriptId: string,
): Promise<ScriptConversation> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/conversation`,
    { method: 'GET' },
    'getScriptConversation',
  );
  return {
    scriptId,
    currentVersionId: response?.current_version_id || response?.script?.current_version_id || undefined,
    defaultModel: response?.script?.default_model || undefined,
    messages: (response?.messages || []).map(mapMessage),
    versions: (response?.versions || []).map(mapVersion),
  };
}

export interface CreateScriptMessagePayload {
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: ScriptConversationStatus;
  modelAlias?: string;
  provider?: string;
  modelName?: string;
  replyToMessageId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

export async function createScriptMessage(
  episodeId: string,
  scriptId: string,
  payload: CreateScriptMessagePayload,
): Promise<ScriptConversationMessage> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        role: payload.role,
        content: payload.content,
        status: payload.status,
        model_alias: payload.modelAlias,
        provider: payload.provider,
        model_name: payload.modelName,
        reply_to_message_id: payload.replyToMessageId,
        request_id: payload.requestId,
        metadata: payload.metadata,
      }),
    },
    'createScriptMessage',
  );
  return mapMessage(response?.message);
}

export async function updateScriptMessage(
  episodeId: string,
  scriptId: string,
  messageId: string,
  payload: { content?: string; status?: ScriptConversationStatus; metadata?: Record<string, any> },
): Promise<ScriptConversationMessage> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/messages/${messageId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    'updateScriptMessage',
  );
  return mapMessage(response?.message);
}

export interface CreateScriptVersionPayload {
  messageId?: string;
  content: string;
  storyboardItems: StoryboardItem[];
  source?: 'ai' | 'manual' | 'legacy';
  status?: 'draft' | 'ready' | 'failed';
  modelAlias?: string;
  provider?: string;
  modelName?: string;
  metadata?: Record<string, any>;
  setCurrent?: boolean;
}

export async function createScriptVersion(
  episodeId: string,
  scriptId: string,
  payload: CreateScriptVersionPayload,
): Promise<ScriptStoryboardVersion> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/versions`,
    {
      method: 'POST',
      body: JSON.stringify({
        message_id: payload.messageId,
        content: payload.content,
        storyboard_items: payload.storyboardItems,
        source: payload.source || 'ai',
        status: payload.status || 'ready',
        model_alias: payload.modelAlias,
        provider: payload.provider,
        model_name: payload.modelName,
        metadata: payload.metadata,
        set_current: payload.setCurrent !== false,
      }),
    },
    'createScriptVersion',
  );
  return mapVersion(response?.version);
}

export async function selectScriptVersion(
  episodeId: string,
  scriptId: string,
  versionId: string,
): Promise<ScriptStoryboardVersion> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/versions/${versionId}/select`,
    { method: 'PUT' },
    'selectScriptVersion',
  );
  return mapVersion(response?.version);
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
