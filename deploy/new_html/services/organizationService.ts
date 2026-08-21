/**
 * organizationService.ts
 * 2026-05-26 组织管理 MVP — Slice 2 (admin) + Slice 3 (user self-service)
 */

import { apiJson } from './httpClient';

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
  const url = `/api/admin/organizations${qs.toString() ? '?' + qs.toString() : ''}`;
  return apiJson(url, { method: 'GET' }, 'adminListOrganizations');
}

export async function adminCreateOrganization(body: {
  name: string;
  owner_user_id: string;
  description?: string;
  color?: string | null;
}): Promise<{ success: boolean; organization: Organization }> {
  return apiJson('/api/admin/organizations', {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'adminCreateOrganization');
}

export async function adminGetOrganization(
  orgId: string,
): Promise<{ success: boolean; organization: Organization; members: OrganizationMember[] }> {
  return apiJson(`/api/admin/organizations/${orgId}`, { method: 'GET' }, 'adminGetOrganization');
}

export async function adminUpdateOrganization(
  orgId: string,
  body: Partial<Pick<Organization, 'name' | 'description' | 'status' | 'color' | 'owner_user_id'>>,
): Promise<{ success: boolean; organization: Organization }> {
  return apiJson(`/api/admin/organizations/${orgId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }, 'adminUpdateOrganization');
}

export async function adminDeleteOrganization(orgId: string): Promise<{ success: boolean }> {
  return apiJson(`/api/admin/organizations/${orgId}`, { method: 'DELETE' }, 'adminDeleteOrganization');
}

export async function adminListMembers(
  orgId: string,
): Promise<{ success: boolean; members: OrganizationMember[] }> {
  return apiJson(`/api/admin/organizations/${orgId}/members`, { method: 'GET' }, 'adminListMembers');
}

export async function adminAddMember(
  orgId: string,
  body: { user_id: string; role?: 'owner' | 'admin' | 'member' },
): Promise<{ success: boolean; member: OrganizationMember }> {
  return apiJson(`/api/admin/organizations/${orgId}/members`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'adminAddMember');
}

export async function adminRemoveMember(
  orgId: string,
  userId: string,
): Promise<{ success: boolean }> {
  return apiJson(`/api/admin/organizations/${orgId}/members/${userId}`, { method: 'DELETE' }, 'adminRemoveMember');
}

export async function adminSetMemberRole(
  orgId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member',
): Promise<{ success: boolean; member: OrganizationMember }> {
  return apiJson(`/api/admin/organizations/${orgId}/members/${userId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  }, 'adminSetMemberRole');
}

// ── User self-service ─────────────────────────────────────────

export async function listMyOrganizations(): Promise<{
  success: boolean;
  organizations: Organization[];
}> {
  return apiJson('/api/me/organizations', { method: 'GET' }, 'listMyOrganizations');
}

export async function leaveOrganization(orgId: string): Promise<{ success: boolean }> {
  return apiJson(`/api/me/organizations/${orgId}/leave`, { method: 'POST' }, 'leaveOrganization');
}
