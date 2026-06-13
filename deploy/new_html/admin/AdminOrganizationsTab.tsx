/**
 * AdminOrganizationsTab.tsx
 * 2026-05-26 组织管理 MVP — Slice 2: admin 组织管理 tab
 *
 * 列表 + 「+ 创建」+ 行展开成员管理。挂在 AdminFeatureTabs（项目分组旁边）。
 * 详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §6.1
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2, Plus, RefreshCw, Trash2, ChevronDown, ChevronRight, UserPlus, X,
} from 'lucide-react';

import {
  adminListOrganizations,
  adminCreateOrganization,
  adminDeleteOrganization,
  adminListMembers,
  adminAddMember,
  adminRemoveMember,
  adminSetMemberRole,
  Organization,
  OrganizationMember,
} from '../services/organizationService';
import { getHeaders } from '../services/apiService';


// ── 小型本地 hook：admin users 列表（与 AdminFeatureTabs 同源端点，独立缓存）

let _adminUsersCache: any[] | null = null;
async function fetchAdminUsersOnce(): Promise<any[]> {
  if (_adminUsersCache) return _adminUsersCache;
  const resp = await fetch('/api/admin/users?limit=500', { headers: getHeaders() });
  if (!resp.ok) return [];
  const j = await resp.json();
  _adminUsersCache = j?.users || [];
  return _adminUsersCache!;
}
function useAdminUsers() {
  const [users, setUsers] = useState<any[]>(_adminUsersCache || []);
  useEffect(() => {
    let alive = true;
    fetchAdminUsersOnce().then(us => { if (alive) setUsers(us); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return users;
}


async function readApiErr(err: any): Promise<string> {
  const raw = String(err?.message || err || '');
  const m = raw.match(/\{.*\}$/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.detail === 'string') return j.detail;
    } catch {}
  }
  return raw;
}


export const AdminOrganizationsTab: React.FC = () => {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'archived'>('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const users = useAdminUsers();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminListOrganizations({
        status: statusFilter || undefined,
        keyword: keyword || undefined,
        limit: 200,
      });
      setOrgs(r.organizations || []);
    } catch (e: any) {
      console.warn('adminListOrganizations 失败', e);
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, [keyword, statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  const handleCreate = async () => {
    if (!newName.trim()) { alert('请填写组织名称'); return; }
    if (!newOwner) { alert('请选择 owner'); return; }
    setSubmitting(true);
    try {
      await adminCreateOrganization({
        name: newName.trim(),
        owner_user_id: newOwner,
        description: newDesc,
      });
      setShowCreate(false);
      setNewName(''); setNewOwner(''); setNewDesc('');
      reload();
    } catch (e: any) {
      alert(`创建失败：${await readApiErr(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (org: Organization) => {
    if (!confirm(`删除组织 "${org.name}"？此操作会级联删除所有成员关系和资源共享，不可恢复。`)) return;
    try {
      await adminDeleteOrganization(org.org_id);
      reload();
    } catch (e: any) {
      alert(`删除失败：${await readApiErr(e)}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 p-3 bg-n0 border border-n40 rounded shadow-card">
        <Building2 size={14} className="text-primary" />
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') reload(); }}
          placeholder="搜索名称 / 描述… (Enter)"
          className="bg-n0 border border-n40 rounded px-2 py-1 text-xs w-64 placeholder:text-n100"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="bg-n0 border border-n40 rounded px-2 py-1 text-xs"
        >
          <option value="">全部状态</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
        <button onClick={reload} className="p-1.5 rounded bg-n0 hover:bg-n20">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setShowCreate(true)}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded bg-primary hover:bg-primary-hover text-white text-xs"
        ><Plus size={12} />创建组织</button>
        <span className="text-xs text-n100">{orgs.length} 个组织</span>
      </div>

      <div className="overflow-auto border border-n40 rounded scrollbar-atlas">
        <table className="w-full text-xs">
          <thead className="bg-n0 text-n100">
            <tr>
              <th className="w-6"></th>
              <th className="text-left p-2">组织</th>
              <th className="text-left p-2">Owner</th>
              <th className="text-left p-2">成员数</th>
              <th className="text-left p-2">状态</th>
              <th className="text-left p-2">创建时间</th>
              <th className="text-left p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(o => (
              <React.Fragment key={o.org_id}>
                <tr className="border-t border-n40 hover:bg-n20">
                  <td className="p-2">
                    <button
                      onClick={() => setExpanded(expanded === o.org_id ? null : o.org_id)}
                      className="text-n100 hover:text-n700"
                    >
                      {expanded === o.org_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td className="p-2">
                    <div className="text-n700 font-medium">{o.name}</div>
                    <div className="text-[10px] text-n100 font-mono">{o.org_id}</div>
                    {o.description && <div className="text-[10px] text-n100">{o.description}</div>}
                  </td>
                  <td className="p-2 text-n700">{o.owner_name || o.owner_user_id}</td>
                  <td className="p-2 text-n700">{o.member_count ?? '-'}</td>
                  <td className="p-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      o.status === 'active'
                        ? 'bg-success-light text-success'
                        : 'bg-n30 text-n300'
                    }`}>{o.status}</span>
                  </td>
                  <td className="p-2 text-n100 text-[10px]">
                    {o.created_at ? new Date(o.created_at).toLocaleString('zh-CN') : '-'}
                  </td>
                  <td className="p-2">
                    <button
                      onClick={() => handleDelete(o)}
                      className="px-2 py-0.5 text-[10px] rounded bg-r50 hover:bg-r75 text-danger"
                    >删除</button>
                  </td>
                </tr>
                {expanded === o.org_id && (
                  <tr className="bg-n20">
                    <td colSpan={7} className="p-3">
                      <MembersPanel orgId={o.org_id} ownerUserId={o.owner_user_id} users={users} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!orgs.length && (
              <tr><td colSpan={7} className="text-center py-6 text-n100">
                {loading ? '加载中…' : '暂无组织 — 点右上角「创建组织」'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center">
          <div className="bg-n0 border border-n40 rounded-lg p-4 w-96 space-y-3 shadow-bottom">
            <div className="flex justify-between items-center">
              <div className="text-sm font-medium">创建组织</div>
              <button onClick={() => setShowCreate(false)} className="text-n100"><X size={14} /></button>
            </div>
            <div>
              <label className="text-[10px] text-n100 uppercase tracking-wider">组织名称</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="例如：内容运营组"
                className="mt-1 w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-sm placeholder:text-n100"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] text-n100 uppercase tracking-wider">Owner（成员管理员）</label>
              <select
                value={newOwner}
                onChange={e => setNewOwner(e.target.value)}
                className="mt-1 w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-sm"
              >
                <option value="">— 选择 owner —</option>
                {users.map(u => (
                  <option key={u.id || u.user_id} value={u.id || u.user_id}>
                    {u.username || u.email || u.user_id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-n100 uppercase tracking-wider">描述（可选）</label>
              <textarea
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                className="mt-1 w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-sm h-20 placeholder:text-n100"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="w-full px-3 py-1.5 rounded bg-primary hover:bg-primary-hover text-white disabled:bg-n0 text-sm"
            >{submitting ? '创建中…' : '创建'}</button>
          </div>
        </div>
      )}
    </div>
  );
};


// ── 行展开后的成员面板 ─────────────────────────────────────────

const MembersPanel: React.FC<{
  orgId: string;
  ownerUserId: string;
  users: any[];
}> = ({ orgId, ownerUserId, users }) => {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminListMembers(orgId);
      setMembers(r.members || []);
    } catch (e: any) {
      console.warn(`adminListMembers ${orgId} failed`, e);
      setMembers([]);
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  const handleAdd = async () => {
    if (!newUserId) { alert('请选择用户'); return; }
    setSubmitting(true);
    try {
      await adminAddMember(orgId, { user_id: newUserId, role: newRole });
      setNewUserId('');
      reload();
    } catch (e: any) {
      alert(`添加成员失败：${await readApiErr(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (m: OrganizationMember) => {
    if (m.user_id === ownerUserId) {
      alert('不能删除 owner — 请先转让 owner 角色');
      return;
    }
    if (!confirm(`移除成员 ${m.username || m.user_id}？`)) return;
    try {
      await adminRemoveMember(orgId, m.user_id);
      reload();
    } catch (e: any) {
      alert(`删除失败：${await readApiErr(e)}`);
    }
  };

  const handleSetRole = async (m: OrganizationMember, role: 'owner' | 'admin' | 'member') => {
    if (role === m.role) return;
    try {
      await adminSetMemberRole(orgId, m.user_id, role);
      reload();
    } catch (e: any) {
      alert(`改 role 失败：${await readApiErr(e)}`);
    }
  };

  const memberUserIds = new Set(members.map(m => m.user_id));
  const candidateUsers = users.filter(u => !memberUserIds.has(u.id || u.user_id));

  return (
    <div className="bg-n0 border border-n40 rounded p-3 space-y-3 shadow-card">
      <div className="flex items-center gap-2 text-xs text-n300">
        <UserPlus size={12} />
        <span>添加成员：</span>
        <select
          value={newUserId}
          onChange={e => setNewUserId(e.target.value)}
          className="bg-n0 border border-n40 rounded px-2 py-1 text-xs w-56"
        >
          <option value="">— 选择用户 —</option>
          {candidateUsers.map(u => (
            <option key={u.id || u.user_id} value={u.id || u.user_id}>
              {u.username || u.email || u.user_id}
            </option>
          ))}
        </select>
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value as 'admin' | 'member')}
          className="bg-n0 border border-n40 rounded px-2 py-1 text-xs"
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button
          onClick={handleAdd}
          disabled={submitting}
          className="px-3 py-1 rounded bg-primary hover:bg-primary-hover text-white disabled:bg-n0 text-xs"
        >{submitting ? '添加中…' : '添加'}</button>
        <button
          onClick={reload}
          className="p-1 rounded bg-n0 hover:bg-n20"
          title="刷新"
        ><RefreshCw size={11} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <table className="w-full text-xs">
        <thead className="bg-n20 text-n100">
          <tr>
            <th className="text-left p-2">用户名</th>
            <th className="text-left p-2">邮箱</th>
            <th className="text-left p-2">角色</th>
            <th className="text-left p-2">加入时间</th>
            <th className="text-left p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.user_id} className="border-t border-n40">
              <td className="p-2">
                <div className="text-n700">{m.username || m.user_id}</div>
                <div className="text-[10px] text-n100 font-mono">{m.user_id}</div>
              </td>
              <td className="p-2 text-n300">{m.email || '-'}</td>
              <td className="p-2">
                <select
                  value={m.role}
                  onChange={e => handleSetRole(m, e.target.value as any)}
                  className="bg-n0 border border-n40 rounded px-1 py-0.5 text-xs"
                  disabled={m.user_id === ownerUserId && m.role === 'owner'}
                  title={m.user_id === ownerUserId ? 'owner 角色不能改（请先转让 owner）' : ''}
                >
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
              </td>
              <td className="p-2 text-n100 text-[10px]">
                {m.joined_at ? new Date(m.joined_at).toLocaleString('zh-CN') : '-'}
              </td>
              <td className="p-2">
                <button
                  onClick={() => handleRemove(m)}
                  disabled={m.user_id === ownerUserId}
                  title={m.user_id === ownerUserId ? '不能删除 owner' : ''}
                  className="px-2 py-0.5 text-[10px] rounded bg-r50 hover:bg-r75 text-danger disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1"
                ><Trash2 size={10} />移除</button>
              </td>
            </tr>
          ))}
          {!members.length && (
            <tr><td colSpan={5} className="text-center py-4 text-n100">
              {loading ? '加载成员…' : '暂无成员'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};


export default AdminOrganizationsTab;
