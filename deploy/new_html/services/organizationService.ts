/**
 * organizationService.ts
 * 2026-05-26 组织管理 MVP — Slice 2 (admin) + Slice 3 (user self-service)
 * 详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5
 */

import { handleResponse, getHeaders } from './apiService';

const API_BASE = '';

// ── Types ─────────────────────────────────────────────────────

export interface Organization {
  org_id: string;
  name: string;
  description: string;
  owner_user_id: string;
  owner_name?: string;
  status: 'active' | 'archived';
  color?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  member_count?: number;
  my_role?: 'owner' | 'admin' | 'member';   // 仅 /api/me/organizations 返回
  my_joined_at?: string;
}

export interface OrganizationMember {
  org_id: string;
  user_id: string;
  username?: string;
  email?: string;
  role: 'owner' | 'admin' | 'member';
  joined_at?: string;
  added_by?: string | null;
}

// ── Admin endpoints (require admin token in sessionStorage) ─────

export async function adminListOrganizations(params?: {
  status?: 'active' | 'archived';
  keyword?: string;
  limit?: number;
  offset?: number;
}): Promise<{ success: boolean; organizations: Organization[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.keyword) qs.set('keyword', params.keyword);
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  const url = `${API_BASE}/api/admin/organizations${qs.toString() ? '?' + qs.toString() : ''}`;
  const resp = await fetch(url, { method: 'GET', headers: getHeaders() });
  return handleResponse(resp, 'adminListOrganizations');
}

export async function adminCreateOrganization(body: {
  name: string;
  owner_user_id: string;
  description?: string;
  color?: string | null;
}): Promise<{ success: boolean; organization: Organization }> {
  const resp = await fetch(`${API_BASE}/api/admin/organizations`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse(resp, 'adminCreateOrganization');
}

export async function adminGetOrganization(
  orgId: string,
): Promise<{ success: boolean; organization: Organization; members: OrganizationMember[] }> {
  const resp = await fetch(`${API_BASE}/api/admin/organizations/${orgId}`, {
    method: 'GET', headers: getHeaders(),
  });
  return handleResponse(resp, 'adminGetOrganization');
}

export async function adminUpdateOrganization(
  orgId: string,
  body: Partial<Pick<Organization, 'name' | 'description' | 'status' | 'color' | 'owner_user_id'>>,
): Promise<{ success: boolean; organization: Organization }> {
  const resp = await fetch(`${API_BASE}/api/admin/organizations/${orgId}`, {
    method: 'PUT', headers: getHeaders(), body: JSON.stringify(body),
  });
  return handleResponse(resp, 'adminUpdateOrganization');
}

export async function adminDeleteOrganization(orgId: string): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_BASE}/api/admin/organizations/${orgId}`, {
    method: 'DELETE', headers: getHeaders(),
  });
  return handleResponse(resp, 'adminDeleteOrganization');
}

export async function adminListMembers(
  orgId: string,
): Promise<{ success: boolean; members: OrganizationMember[] }> {
  const resp = await fetch(`${API_BASE}/api/admin/organizations/${orgId}/members`, {
    method: 'GET', headers: getHeaders(),
  });
  return handleResponse(resp, 'adminListMembers');
}

export async function adminAddMember(
  orgId: string,
  body: { user_id: string; role?: 'owner' | 'admin' | 'member' },
): Promise<{ success: boolean; member: OrganizationMember }> {
  const resp = await fetch(`${API_BASE}/api/admin/organizations/${orgId}/members`, {
    method: 'POST', headers: getHeaders(), body: JSON.stringify(body),
  });
  return handleResponse(resp, 'adminAddMember');
}

export async function adminRemoveMember(
  orgId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_BASE}/api/admin/organizations/${orgId}/members/${userId}`, {
    method: 'DELETE', headers: getHeaders(),
  });
  return handleResponse(resp, 'adminRemoveMember');
}

export async function adminSetMemberRole(
  orgId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member',
): Promise<{ success: boolean; member: OrganizationMember }> {
  const resp = await fetch(`${API_BASE}/api/admin/organizations/${orgId}/members/${userId}/role`, {
    method: 'PUT', headers: getHeaders(), body: JSON.stringify({ role }),
  });
  return handleResponse(resp, 'adminSetMemberRole');
}

// ── User self-service ─────────────────────────────────────────

export async function listMyOrganizations(): Promise<{
  success: boolean;
  organizations: Organization[];
}> {
  const resp = await fetch(`${API_BASE}/api/me/organizations`, {
    method: 'GET', headers: getHeaders(),
  });
  return handleResponse(resp, 'listMyOrganizations');
}

export async function leaveOrganization(orgId: string): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_BASE}/api/me/organizations/${orgId}/leave`, {
    method: 'POST', headers: getHeaders(),
  });
  return handleResponse(resp, 'leaveOrganization');
}
