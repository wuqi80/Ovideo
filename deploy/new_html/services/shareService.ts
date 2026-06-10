/**
 * shareService.ts
 * 2026-05-26 组织管理 MVP — Slice 4: 资源共享 client
 * 详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5.3
 */

import { handleResponse, getHeaders } from './apiService';

const API_BASE = '';

export type ShareResourceType = 'project' | 'media' | 'group';
export type ShareTargetType = 'org' | 'project';

export interface ResourceShare {
  share_id: string;
  resource_type: ShareResourceType;
  resource_id: string;
  share_target_type: ShareTargetType;
  share_target_id: string;
  share_target_name?: string;
  granted_by_user_id: string;
  granted_at: string;
}

export async function listShares(
  resource_type: ShareResourceType,
  resource_id: string,
): Promise<{ success: boolean; shares: ResourceShare[] }> {
  const qs = new URLSearchParams({ resource_type, resource_id });
  const resp = await fetch(`${API_BASE}/api/shares?${qs.toString()}`, {
    method: 'GET', headers: getHeaders(),
  });
  return handleResponse(resp, 'listShares');
}

export async function createShare(body: {
  resource_type: ShareResourceType;
  resource_id: string;
  share_target_type: ShareTargetType;
  share_target_id: string;
}): Promise<{ success: boolean; share: ResourceShare }> {
  const resp = await fetch(`${API_BASE}/api/shares`, {
    method: 'POST', headers: getHeaders(), body: JSON.stringify(body),
  });
  return handleResponse(resp, 'createShare');
}

export async function deleteShare(share_id: string): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_BASE}/api/shares/${share_id}`, {
    method: 'DELETE', headers: getHeaders(),
  });
  return handleResponse(resp, 'deleteShare');
}
