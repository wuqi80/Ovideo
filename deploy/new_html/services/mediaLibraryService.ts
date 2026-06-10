/**
 * mediaLibraryService.ts
 * 2026-05-26 Slice 1 — 通用素材库前端 API 客户端
 * 详见 docs/superpowers/plans/2026-05-26-feature-rollout/01-media-library.md
 */

import { handleResponse, getHeaders } from './apiService';

const API_BASE = '';

export type MediaItemType = 'image' | 'video' | 'audio' | 'text' | 'other';
export type PermissionScope = 'private' | 'project' | 'team' | 'public_link';

export interface MediaLibraryItem {
  library_item_id: string;
  file_id: string;
  user_id: string;
  project_id: string | null;
  episode_id: string | null;
  team_id: string | null;
  item_type: MediaItemType;
  source: string;
  title: string | null;
  description: string;
  tags: string[];
  permission_scope: PermissionScope;
  is_favorite: boolean;
  use_count: number;
  source_task_id: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  metadata: Record<string, any>;
  // 2026-05-26 组织管理 MVP — Slice 5
  visibility?: 'private' | 'org-default';
  // 2026-05-30 素材库文件夹
  folder_id?: string | null;
  created_at: string;
  updated_at: string;

  // 来自 JOIN files 的字段
  file_name?: string;
  file_url?: string;
  file_type?: string;
  mime_type?: string;
  file_size_bytes?: number;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  thumbnail_url?: string | null;
}

export interface ListItemsResponse {
  success: boolean;
  items: MediaLibraryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListItemsParams {
  project_id?: string;
  episode_id?: string;
  item_type?: MediaItemType;
  source?: string;
  permission_scope?: PermissionScope;
  is_favorite?: boolean;
  keyword?: string;
  tag?: string;
  /** 文件夹过滤；传 "__unfiled__" 只看未归类素材 */
  folder_id?: string;
  limit?: number;
  offset?: number;
  /** 2026-05-26 组织 workspace。不传 = 个人 workspace（旧行为） */
  org_id?: string;
}

export interface UpdateItemPayload {
  title?: string;
  description?: string;
  tags?: string[];
  permission_scope?: PermissionScope;
  is_favorite?: boolean;
  project_id?: string;
  episode_id?: string;
  /** 移动到文件夹；传 "" / null 表示移出文件夹（回到未归类） */
  folder_id?: string | null;
}

export interface UploadOptions {
  projectId?: string;
  episodeId?: string;
  permissionScope?: PermissionScope;
  title?: string;
  description?: string;
  tags?: string[];
  // 2026-05-26 组织管理 MVP — Slice 5
  visibility?: 'private' | 'org-default';
  orgId?: string;  // visibility='org-default' 时必填
  // 2026-05-30 素材库文件夹
  folderId?: string;
}

// ── 2026-05-30 素材库文件夹 ──
export interface MediaFolder {
  folder_id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  folder_order: number;
  created_at: string;
  updated_at: string;
}

export interface UseItemPayload {
  usage_context: string;
  task_id?: string;
  project_id?: string;
  target_entity_type?: string;
  target_entity_id?: string;
}

function buildQuery(params: Record<string, any>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function listMediaItems(params: ListItemsParams = {}): Promise<ListItemsResponse> {
  const qs = buildQuery(params);
  const resp = await fetch(`${API_BASE}/api/media-library/items${qs}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'listMediaItems');
}

export async function getMediaItem(libraryItemId: string): Promise<{ success: boolean; item: MediaLibraryItem }> {
  const resp = await fetch(`${API_BASE}/api/media-library/items/${libraryItemId}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'getMediaItem');
}

export async function uploadMediaItem(file: File, options: UploadOptions = {}): Promise<{
  success: boolean;
  library_item_id: string;
  file_id: string;
  file_url: string;
  item: MediaLibraryItem;
}> {
  const form = new FormData();
  form.append('file', file);
  if (options.projectId) form.append('project_id', options.projectId);
  if (options.episodeId) form.append('episode_id', options.episodeId);
  if (options.permissionScope) form.append('permission_scope', options.permissionScope);
  if (options.title) form.append('title', options.title);
  if (options.description) form.append('description', options.description);
  if (options.tags) form.append('tags', JSON.stringify(options.tags));
  if (options.visibility) form.append('visibility', options.visibility);
  if (options.orgId) form.append('org_id', options.orgId);
  if (options.folderId) form.append('folder_id', options.folderId);

  const headers: HeadersInit = {};
  const token = localStorage.getItem('auth_token');
  if (token) (headers as any).Authorization = `Bearer ${token}`;

  const resp = await fetch(`${API_BASE}/api/media-library/upload`, {
    method: 'POST',
    headers,
    body: form,
  });
  return handleResponse(resp, 'uploadMediaItem');
}

export async function updateMediaItem(
  libraryItemId: string,
  payload: UpdateItemPayload,
): Promise<{ success: boolean; item: MediaLibraryItem }> {
  const resp = await fetch(`${API_BASE}/api/media-library/items/${libraryItemId}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(resp, 'updateMediaItem');
}

export async function deleteMediaItem(libraryItemId: string, reason?: string): Promise<{ success: boolean }> {
  const qs = reason ? `?${new URLSearchParams({ reason }).toString()}` : '';
  const resp = await fetch(`${API_BASE}/api/media-library/items/${libraryItemId}${qs}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'deleteMediaItem');
}

export async function useMediaItem(libraryItemId: string, payload: UseItemPayload): Promise<{ success: boolean; usage: any }> {
  const resp = await fetch(`${API_BASE}/api/media-library/items/${libraryItemId}/use`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(resp, 'useMediaItem');
}

export async function batchDownloadMediaItems(libraryItemIds: string[]): Promise<Blob> {
  const resp = await fetch(`${API_BASE}/api/media-library/batch-download`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ library_item_ids: libraryItemIds }),
  });
  if (!resp.ok) {
    throw new Error(`batchDownloadMediaItems failed (${resp.status})`);
  }
  return await resp.blob();
}

// ============================================
// 文件夹 CRUD（人物 / 场景 / 道具 …，可嵌套）
// ============================================

export async function listMediaFolders(projectId: string): Promise<{ success: boolean; folders: MediaFolder[] }> {
  const qs = buildQuery({ project_id: projectId });
  const resp = await fetch(`${API_BASE}/api/media-library/folders${qs}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'listMediaFolders');
}

export async function createMediaFolder(payload: {
  project_id: string;
  name: string;
  parent_folder_id?: string | null;
  folder_order?: number;
}): Promise<{ success: boolean; folder: MediaFolder }> {
  const resp = await fetch(`${API_BASE}/api/media-library/folders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(resp, 'createMediaFolder');
}

export async function updateMediaFolder(
  folderId: string,
  payload: { name?: string; parent_folder_id?: string | null; folder_order?: number },
): Promise<{ success: boolean; folder: MediaFolder }> {
  const resp = await fetch(`${API_BASE}/api/media-library/folders/${folderId}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(resp, 'updateMediaFolder');
}

export async function deleteMediaFolder(folderId: string): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_BASE}/api/media-library/folders/${folderId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'deleteMediaFolder');
}
