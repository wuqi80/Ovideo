/**
 * AdminFeatureTabs.tsx
 * 2026-05-26 Slices 2/4/5 — 后台新增能力的子标签集合：
 *  - 账号管理（Slice 4）
 *  - 项目分组（Slice 4）
 *  - 积分规则（Slice 2 admin）
 *  - 积分账户（Slice 5 占位 + adjust）
 *  - 积分流水（Slice 5）
 *  - 素材库（Slice 5）
 *  - 审计日志（Slice 5）
 *
 * 单一文件托管所有子标签，挂到 AdminPage 作为一个新顶级 tab。
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Users, FolderTree, Coins, ScrollText, Image as ImageIcon,
  ShieldCheck, RefreshCw, Plus, Trash2, ToggleLeft, ToggleRight, KeyRound,
  X, Check, Building2,
} from 'lucide-react';
import {
  adminListCreditRules, adminCreateCreditRule, adminUpdateCreditRule, adminDeleteCreditRule,
  CreditRule,
} from '../services/creditService';
import AdminOrganizationsTab from '../admin/AdminOrganizationsTab';

const API_BASE = '';

// 2026-05-26：admin 路由下优先用 sessionStorage.admin_session_token，与主站登录隔离
function getHeaders(): HeadersInit {
  let token: string | null = null;
  try {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      token = sessionStorage.getItem('admin_session_token');
    }
  } catch {}
  if (!token) token = localStorage.getItem('auth_token');
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) (h as any).Authorization = `Bearer ${token}`;
  return h;
}

async function apiGet<T>(url: string): Promise<T> {
  const r = await fetch(`${API_BASE}${url}`, { method: 'GET', headers: getHeaders() });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function apiPost<T>(url: string, body?: any): Promise<T> {
  const r = await fetch(`${API_BASE}${url}`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${await r.text()}`);
  return r.json();
}
async function apiPut<T>(url: string, body?: any): Promise<T> {
  const r = await fetch(`${API_BASE}${url}`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${await r.text()}`);
  return r.json();
}
async function apiDelete<T>(url: string): Promise<T> {
  const r = await fetch(`${API_BASE}${url}`, { method: 'DELETE', headers: getHeaders() });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// 2026-05-26：抽取错误 detail（FastAPI 标准 { detail } 形状）→ 让 alert 显示中文，不再只看 stack。
async function readApiError(err: any): Promise<string> {
  const raw = String(err?.message || err || '');
  // err.message 形如 '/api/admin/project-groups -> 400: {"detail":"归属用户不存在"}'
  const m = raw.match(/\{.*\}$/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.detail === 'string') return j.detail;
    } catch {}
  }
  return raw;
}

// 2026-05-26：共享用户列表 hook（admin 列表多个 tab 都需要），跨 tab 缓存避免每次切 tab 都重新拉。
let _adminUsersCache: any[] | null = null;
let _adminUsersPromise: Promise<any[]> | null = null;
async function fetchAdminUsersOnce(): Promise<any[]> {
  if (_adminUsersCache) return _adminUsersCache;
  if (_adminUsersPromise) return _adminUsersPromise;
  _adminUsersPromise = (async () => {
    const r = await apiGet<{ users: any[] }>('/api/admin/users?limit=500');
    _adminUsersCache = r.users || [];
    return _adminUsersCache;
  })();
  return _adminUsersPromise;
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

type SubTab = 'accounts' | 'groups' | 'organizations' | 'credit_rules' | 'credit_accounts' | 'credit_transactions' | 'media' | 'audit';

const SUB_TABS: { key: SubTab; label: string; icon: React.ReactNode }[] = [
  { key: 'accounts',            label: '账号管理',    icon: <Users size={14} /> },
  { key: 'groups',              label: '项目分组',    icon: <FolderTree size={14} /> },
  { key: 'organizations',       label: '组织管理',    icon: <Building2 size={14} /> },
  { key: 'credit_rules',        label: '积分规则',    icon: <Coins size={14} /> },
  { key: 'credit_accounts',     label: '积分账户',    icon: <Coins size={14} /> },
  { key: 'credit_transactions', label: '积分流水',    icon: <ScrollText size={14} /> },
  { key: 'media',               label: '素材库管理',  icon: <ImageIcon size={14} /> },
  { key: 'audit',               label: '审计日志',    icon: <ShieldCheck size={14} /> },
];

export const AdminFeatureTabs: React.FC = () => {
  const [tab, setTab] = useState<SubTab>('accounts');

  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b border-gray-800 bg-gray-900/30">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 ${
              tab === t.key
                ? 'border-indigo-500 text-indigo-300 bg-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'organizations' && <AdminOrganizationsTab />}
        {tab === 'credit_rules' && <CreditRulesTab />}
        {tab === 'credit_accounts' && <CreditAccountsTab />}
        {tab === 'credit_transactions' && <CreditTransactionsTab />}
        {tab === 'media' && <MediaLibraryAdminTab />}
        {tab === 'audit' && <AuditLogsTab />}
      </div>
    </div>
  );
};


// ============================================
// 1. 账号管理 (Slice 4)
// ============================================
const AccountsTab: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [pwUserId, setPwUserId] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (keyword) sp.set('keyword', keyword);
      if (statusFilter) sp.set('status_filter', statusFilter);
      sp.set('limit', '200');
      const r = await apiGet<{ users: any[] }>(`/api/admin/users?${sp.toString()}`);
      setUsers(r.users || []);
    } finally { setLoading(false); }
  }, [keyword, statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  const handleDisable = async (uid: string) => {
    const reason = prompt('禁用原因？');
    if (reason === null) return;
    await apiPost(`/api/admin/users/${uid}/disable`, { reason });
    reload();
  };
  const handleEnable = async (uid: string) => {
    await apiPost(`/api/admin/users/${uid}/enable`);
    reload();
  };
  const handleResetPassword = async (uid: string) => {
    if (!pwValue || pwValue.length < 4) { alert('密码至少 4 位'); return; }
    await apiPost(`/api/admin/users/${uid}/reset-password`, { new_password: pwValue });
    setPwUserId(null); setPwValue('');
    alert('密码已重置');
  };
  const handleSetRole = async (uid: string, role: string) => {
    await apiPut(`/api/admin/users/${uid}`, { role });
    reload();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="搜索用户名/邮箱..."
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-64"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs"
        >
          <option value="">全部状态</option>
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </select>
        <button onClick={reload} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <span className="ml-auto text-xs text-gray-500">{users.length} 个用户</span>
      </div>

      <div className="overflow-auto border border-gray-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500">
            <tr>
              <th className="text-left p-2">用户</th>
              <th className="text-left p-2">邮箱</th>
              <th className="text-left p-2">角色</th>
              <th className="text-left p-2">状态</th>
              <th className="text-left p-2">最近登录</th>
              <th className="text-left p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.user_id} className="border-t border-gray-800/60">
                <td className="p-2">
                  <div className="text-gray-200">{u.username}</div>
                  <div className="text-[10px] text-gray-500 font-mono">{u.user_id}</div>
                </td>
                <td className="p-2 text-gray-400">{u.email || '-'}</td>
                <td className="p-2">
                  <select
                    value={u.role || 'user'}
                    onChange={e => handleSetRole(u.user_id, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </td>
                <td className="p-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    (u.status || 'active') === 'active' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'
                  }`}>
                    {u.status || 'active'}
                  </span>
                  {u.disabled_reason && (
                    <div className="text-[10px] text-red-400 mt-0.5">{u.disabled_reason}</div>
                  )}
                </td>
                <td className="p-2 text-gray-500 text-[10px]">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString('zh-CN') : '-'}
                </td>
                <td className="p-2 space-x-1">
                  {(u.status || 'active') === 'active' ? (
                    <button onClick={() => handleDisable(u.user_id)} className="px-2 py-0.5 text-[10px] rounded bg-red-900/40 hover:bg-red-900/70 text-red-200">禁用</button>
                  ) : (
                    <button onClick={() => handleEnable(u.user_id)} className="px-2 py-0.5 text-[10px] rounded bg-emerald-900/40 hover:bg-emerald-900/70 text-emerald-200">启用</button>
                  )}
                  <button
                    onClick={() => setPwUserId(u.user_id)}
                    className="px-2 py-0.5 text-[10px] rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
                  >
                    重置密码
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr><td colSpan={6} className="text-center py-6 text-gray-500">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pwUserId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-80">
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-medium">重置密码 — {pwUserId}</div>
              <button onClick={() => { setPwUserId(null); setPwValue(''); }} className="text-gray-500">×</button>
            </div>
            <input
              type="text"
              value={pwValue}
              onChange={e => setPwValue(e.target.value)}
              placeholder="新密码（至少 4 位）"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm"
              autoFocus
            />
            <button
              onClick={() => handleResetPassword(pwUserId)}
              className="mt-3 w-full px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-sm"
            >
              确认重置
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


// ============================================
// 2. 项目分组 (Slice 4)
// ============================================
const GroupsTab: React.FC = () => {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUserId, setNewUserId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const users = useAdminUsers();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ groups: any[] }>('/api/admin/project-groups');
      setGroups(r.groups || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleCreate = async () => {
    if (!newUserId) { alert('请先在下拉中选择归属用户'); return; }
    if (!newName.trim()) { alert('请输入分组名称'); return; }
    setSubmitting(true);
    try {
      await apiPost('/api/admin/project-groups', { user_id: newUserId, group_name: newName.trim(), description: newDesc });
      setNewName(''); setNewDesc('');
      reload();
    } catch (e: any) {
      alert(`创建分组失败：${await readApiError(e)}`);
    } finally {
      setSubmitting(false);
    }
  };
  const handleDelete = async (gid: string) => {
    if (!confirm('删除后该分组内项目将变为"未分组"。继续？')) return;
    try {
      await apiDelete(`/api/admin/project-groups/${gid}`);
      reload();
    } catch (e: any) {
      alert(`删除失败：${await readApiError(e)}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-900 border border-gray-800 rounded">
        <select
          value={newUserId}
          onChange={e => setNewUserId(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-56"
        >
          <option value="">— 选择归属用户 —</option>
          {users.map(u => (
            <option key={u.id || u.user_id} value={u.id || u.user_id}>
              {u.username || u.email || u.user_id} · {(u.id || u.user_id || '').slice(0, 8)}…
            </option>
          ))}
        </select>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="分组名称" className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-44" />
        <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="描述（可选）" className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs flex-1" />
        <button
          onClick={handleCreate}
          disabled={submitting}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-xs"
        ><Plus size={12} />{submitting ? '创建中…' : '创建分组'}</button>
        <button onClick={reload} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="overflow-auto border border-gray-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500">
            <tr>
              <th className="text-left p-2">分组</th>
              <th className="text-left p-2">归属</th>
              <th className="text-left p-2">项目数</th>
              <th className="text-left p-2">创建</th>
              <th className="text-left p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.group_id} className="border-t border-gray-800/60">
                <td className="p-2">
                  <div className="text-gray-200">{g.group_name}</div>
                  <div className="text-[10px] text-gray-500 font-mono">{g.group_id}</div>
                  {g.description && <div className="text-[10px] text-gray-500">{g.description}</div>}
                </td>
                <td className="p-2 text-gray-400">
                  {g.owner_name || g.user_id || '-'}
                </td>
                <td className="p-2 text-gray-300">{g.project_count ?? 0}</td>
                <td className="p-2 text-gray-500">{g.created_at ? new Date(g.created_at).toLocaleString('zh-CN') : '-'}</td>
                <td className="p-2">
                  <button onClick={() => handleDelete(g.group_id)} className="px-2 py-0.5 text-[10px] rounded bg-red-900/40 hover:bg-red-900/70 text-red-200">删除</button>
                </td>
              </tr>
            ))}
            {!groups.length && <tr><td colSpan={5} className="text-center py-6 text-gray-500">暂无分组</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// ============================================
// 3. 积分规则 (Slice 2 admin)
// ============================================
const CreditRulesTab: React.FC = () => {
  const [rules, setRules] = useState<CreditRule[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { const r = await adminListCreditRules(); setRules(r.rules || []); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleToggleEnabled = async (rule: CreditRule) => {
    await adminUpdateCreditRule(rule.rule_id, { enabled: !rule.enabled });
    reload();
  };
  const handleSaveCost = async (rule: CreditRule, base_cost: number, min_cost: number, max_cost: number | null) => {
    await adminUpdateCreditRule(rule.rule_id, { base_cost, min_cost, max_cost });
    reload();
  };
  const handleDelete = async (rule: CreditRule) => {
    if (!confirm(`删除规则 ${rule.feature_key} ?`)) return;
    await adminDeleteCreditRule(rule.rule_id);
    reload();
  };
  const handleCreate = async () => {
    const fk = prompt('feature_key', 'image_generation');
    if (!fk) return;
    const fn = prompt('显示名称', fk) || fk;
    const base = Number(prompt('base_cost', '10') || 10);
    await adminCreateCreditRule({ feature_key: fk, feature_name: fn, base_cost: base });
    reload();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={handleCreate} className="flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs"><Plus size={12} />新建规则</button>
        <button onClick={reload} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      <div className="overflow-auto border border-gray-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500">
            <tr>
              <th className="text-left p-2">feature_key</th>
              <th className="text-left p-2">名称</th>
              <th className="text-left p-2">启用</th>
              <th className="text-right p-2">base</th>
              <th className="text-right p-2">min</th>
              <th className="text-right p-2">max</th>
              <th className="text-left p-2">version</th>
              <th className="text-left p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <CreditRuleRow key={r.rule_id} rule={r} onToggle={() => handleToggleEnabled(r)} onSave={handleSaveCost} onDelete={() => handleDelete(r)} />
            ))}
            {!rules.length && <tr><td colSpan={8} className="text-center py-6 text-gray-500">暂无规则</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CreditRuleRow: React.FC<{
  rule: CreditRule;
  onToggle: () => void;
  onSave: (rule: CreditRule, base: number, min_: number, max_: number | null) => void;
  onDelete: () => void;
}> = ({ rule, onToggle, onSave, onDelete }) => {
  const [base, setBase] = useState(rule.base_cost);
  const [min_, setMin] = useState(rule.min_cost);
  const [max_, setMax] = useState<number | null>(rule.max_cost);
  return (
    <tr className="border-t border-gray-800/60">
      <td className="p-2 font-mono text-[10px] text-gray-300">{rule.feature_key}</td>
      <td className="p-2 text-gray-300">{rule.feature_name}</td>
      <td className="p-2">
        <button onClick={onToggle}>
          {rule.enabled ? <ToggleRight size={20} className="text-emerald-400" /> : <ToggleLeft size={20} className="text-gray-500" />}
        </button>
      </td>
      <td className="p-2"><input type="number" value={base} onChange={e => setBase(Number(e.target.value))} className="w-16 bg-gray-800 border border-gray-700 rounded px-1 text-right text-xs" /></td>
      <td className="p-2"><input type="number" value={min_} onChange={e => setMin(Number(e.target.value))} className="w-14 bg-gray-800 border border-gray-700 rounded px-1 text-right text-xs" /></td>
      <td className="p-2"><input type="number" value={max_ ?? ''} placeholder="∞" onChange={e => setMax(e.target.value ? Number(e.target.value) : null)} className="w-14 bg-gray-800 border border-gray-700 rounded px-1 text-right text-xs" /></td>
      <td className="p-2 text-gray-500 text-[10px]">{rule.rule_version}</td>
      <td className="p-2 space-x-1">
        <button onClick={() => onSave(rule, base, min_, max_)} className="px-2 py-0.5 text-[10px] rounded bg-emerald-900/40 hover:bg-emerald-900/70 text-emerald-200">保存</button>
        <button onClick={onDelete} className="px-2 py-0.5 text-[10px] rounded bg-red-900/40 hover:bg-red-900/70 text-red-200">删除</button>
      </td>
    </tr>
  );
};


// ============================================
// 4. 积分账户 (Slice 5)
// ============================================
const CreditAccountsTab: React.FC = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState<{ owner_id: string; owner: string } | null>(null);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ accounts: any[] }>('/api/admin/credit-accounts');
      setAccounts(r.accounts || []);
    } catch (e: any) {
      console.warn('Slice 5 admin credit-accounts 接口或许尚未上线:', e?.message);
      setAccounts([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const submitAdjust = async () => {
    if (!adjustOpen || amount === 0 || !reason.trim()) { alert('需要金额（非 0）和理由'); return; }
    await apiPost(`/api/admin/credit-accounts/${adjustOpen.owner_id}/adjust`, { delta: amount, reason });
    setAdjustOpen(null); setAmount(0); setReason('');
    reload();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={reload} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
        <span className="text-xs text-gray-500">{accounts.length} 个账户</span>
      </div>
      <div className="overflow-auto border border-gray-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500">
            <tr>
              <th className="text-left p-2">账户</th>
              <th className="text-left p-2">归属</th>
              <th className="text-right p-2">可用</th>
              <th className="text-right p-2">冻结</th>
              <th className="text-right p-2">累计消耗</th>
              <th className="text-left p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.account_id} className="border-t border-gray-800/60">
                <td className="p-2 font-mono text-[10px]">{a.account_id}</td>
                <td className="p-2 text-gray-300">{a.owner_type}/{a.owner_id}</td>
                <td className="p-2 text-right font-mono text-emerald-300">{a.available_credits}</td>
                <td className="p-2 text-right font-mono text-amber-300">{a.frozen_credits}</td>
                <td className="p-2 text-right font-mono text-gray-400">{a.total_used_credits}</td>
                <td className="p-2">
                  <button
                    onClick={() => setAdjustOpen({ owner_id: a.owner_id, owner: `${a.owner_type}/${a.owner_id}` })}
                    disabled={a.owner_type !== 'user'}
                    title={a.owner_type !== 'user' ? '当前只支持调整 user 账户' : ''}
                    className="px-2 py-0.5 text-[10px] rounded bg-indigo-900/40 hover:bg-indigo-900/70 text-indigo-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    手动调整
                  </button>
                </td>
              </tr>
            ))}
            {!accounts.length && <tr><td colSpan={6} className="text-center py-6 text-gray-500">暂无账户</td></tr>}
          </tbody>
        </table>
      </div>

      {adjustOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-96 space-y-3">
            <div className="flex justify-between items-center">
              <div className="text-sm font-medium">手动调整 — {adjustOpen.owner}</div>
              <button onClick={() => setAdjustOpen(null)} className="text-gray-500"><X size={14} /></button>
            </div>
            <div className="text-xs text-gray-400">正数 = 充值/赠送，负数 = 扣减。需要管理员审计理由。</div>
            <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} placeholder="amount" className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm" />
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="调整理由（必填）" className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm h-20" />
            <button onClick={submitAdjust} className="w-full px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm">提交调整</button>
          </div>
        </div>
      )}
    </div>
  );
};


// ============================================
// 5. 积分流水 (Slice 5)
// ============================================
const CreditTransactionsTab: React.FC = () => {
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [userFilter, setUserFilter] = useState('');
  const [featureFilter, setFeatureFilter] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (userFilter) sp.set('user_id', userFilter);
      if (featureFilter) sp.set('feature_key', featureFilter);
      sp.set('limit', '300');
      const r = await apiGet<{ transactions: any[] }>(`/api/admin/credit-transactions?${sp.toString()}`);
      setTxns(r.transactions || []);
    } catch (e: any) {
      console.warn('Slice 5 admin credit-transactions 接口或许尚未上线:', e?.message);
      setTxns([]);
    } finally { setLoading(false); }
  }, [userFilter, featureFilter]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={userFilter} onChange={e => setUserFilter(e.target.value)} placeholder="user_id" className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-44" />
        <input value={featureFilter} onChange={e => setFeatureFilter(e.target.value)} placeholder="feature_key" className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-44" />
        <button onClick={reload} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
        <span className="ml-auto text-xs text-gray-500">{txns.length} 条</span>
      </div>
      <div className="overflow-auto border border-gray-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500">
            <tr>
              <th className="text-left p-2">时间</th>
              <th className="text-left p-2">类型</th>
              <th className="text-left p-2">用户</th>
              <th className="text-left p-2">功能</th>
              <th className="text-right p-2">金额</th>
              <th className="text-right p-2">余额前</th>
              <th className="text-right p-2">余额后</th>
            </tr>
          </thead>
          <tbody>
            {txns.map(t => (
              <tr key={t.transaction_id} className="border-t border-gray-800/60">
                <td className="p-2 text-gray-400 text-[10px]">{new Date(t.created_at).toLocaleString('zh-CN')}</td>
                <td className="p-2 text-gray-300">{t.change_type}</td>
                <td className="p-2 font-mono text-[10px] text-gray-400">{t.user_id || '-'}</td>
                <td className="p-2 text-gray-300">{t.feature_key || '-'}</td>
                <td className="p-2 text-right font-mono text-gray-300">{t.amount}</td>
                <td className="p-2 text-right font-mono text-gray-500">{t.balance_before}</td>
                <td className="p-2 text-right font-mono text-gray-300">{t.balance_after}</td>
              </tr>
            ))}
            {!txns.length && <tr><td colSpan={7} className="text-center py-6 text-gray-500">暂无流水</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// ============================================
// 6. 素材库管理 (Slice 5)
// ============================================
const MediaLibraryAdminTab: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 2026-05-26：用户/类型/关键字筛选 + 自动重新拉数据
  const [filterUserId, setFilterUserId] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const users = useAdminUsers();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (filterUserId) sp.set('user_id', filterUserId);
      if (filterType) sp.set('item_type', filterType);
      if (filterKeyword.trim()) sp.set('keyword', filterKeyword.trim());
      sp.set('limit', '300');
      const r = await apiGet<{ items: any[] }>(`/api/admin/media-library/items?${sp.toString()}`);
      setItems(r.items || []);
    } catch (e: any) {
      console.warn('Slice 5 admin media-library 接口或许尚未上线:', e?.message);
      setItems([]);
    } finally { setLoading(false); }
  }, [filterUserId, filterType, filterKeyword]);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (lid: string) => {
    const reason = prompt('删除原因？');
    if (reason === null) return;
    const sp = new URLSearchParams({ reason });
    try {
      await apiDelete(`/api/admin/media-library/items/${lid}?${sp.toString()}`);
      reload();
    } catch (e: any) {
      alert(`删除失败：${await readApiError(e)}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-900 border border-gray-800 rounded">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">筛选</span>
        <select
          value={filterUserId}
          onChange={e => setFilterUserId(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-56"
        >
          <option value="">所有用户</option>
          {users.map(u => (
            <option key={u.id || u.user_id} value={u.id || u.user_id}>
              {u.username || u.email || u.user_id} · {(u.id || u.user_id || '').slice(0, 8)}…
            </option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-32"
        >
          <option value="">所有类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="audio">音频</option>
          <option value="frame">抽帧</option>
          <option value="text">文本</option>
          <option value="other">其他</option>
        </select>
        <input
          value={filterKeyword}
          onChange={e => setFilterKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') reload(); }}
          placeholder="搜索标题 / 文件名… (Enter)"
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs flex-1 min-w-[180px]"
        />
        <button onClick={reload} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
        <span className="text-xs text-gray-500 ml-1">{items.length} 个素材</span>
      </div>
      <div className="overflow-auto border border-gray-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500">
            <tr>
              <th className="text-left p-2">素材</th>
              <th className="text-left p-2">类型</th>
              <th className="text-left p-2">所有者</th>
              <th className="text-left p-2">项目</th>
              <th className="text-left p-2">权限</th>
              <th className="text-left p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.library_item_id} className="border-t border-gray-800/60">
                <td className="p-2">
                  <div className="text-gray-200 truncate max-w-[300px]">{it.title || it.file_name}</div>
                  <div className="text-[10px] text-gray-500 font-mono">{it.library_item_id}</div>
                </td>
                <td className="p-2 text-gray-300">{it.item_type}</td>
                <td className="p-2 text-[11px] text-gray-300">
                  {(() => {
                    const u = users.find(x => (x.id || x.user_id) === it.user_id);
                    return u
                      ? (<><span className="text-gray-200">{u.username || u.email}</span><span className="ml-1 text-[9px] text-gray-500 font-mono">{(it.user_id || '').slice(0, 8)}…</span></>)
                      : (<span className="font-mono text-gray-400">{it.user_id}</span>);
                  })()}
                </td>
                <td className="p-2 font-mono text-[10px] text-gray-400">{it.project_id || '-'}</td>
                <td className="p-2 text-gray-300">{it.permission_scope}</td>
                <td className="p-2">
                  <button onClick={() => handleDelete(it.library_item_id)} className="px-2 py-0.5 text-[10px] rounded bg-red-900/40 hover:bg-red-900/70 text-red-200">删除</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="text-center py-6 text-gray-500">暂无素材</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// ============================================
// 7. 审计日志 (Slice 5)
// ============================================
const AuditLogsTab: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adminFilter, setAdminFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (adminFilter) sp.set('admin_user_id', adminFilter);
      if (actionFilter) sp.set('action', actionFilter);
      sp.set('limit', '300');
      const r = await apiGet<{ logs: any[] }>(`/api/admin/audit-logs?${sp.toString()}`);
      setLogs(r.logs || []);
    } catch (e: any) {
      console.warn('Slice 5 admin audit-logs 接口或许尚未上线:', e?.message);
      setLogs([]);
    } finally { setLoading(false); }
  }, [adminFilter, actionFilter]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={adminFilter} onChange={e => setAdminFilter(e.target.value)} placeholder="admin_user_id" className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-44" />
        <input value={actionFilter} onChange={e => setActionFilter(e.target.value)} placeholder="action" className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-44" />
        <button onClick={reload} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
        <span className="ml-auto text-xs text-gray-500">{logs.length} 条</span>
      </div>
      <div className="overflow-auto border border-gray-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500">
            <tr>
              <th className="text-left p-2">时间</th>
              <th className="text-left p-2">管理员</th>
              <th className="text-left p-2">操作</th>
              <th className="text-left p-2">目标</th>
              <th className="text-left p-2">IP</th>
              <th className="text-left p-2">User-Agent</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.audit_id} className="border-t border-gray-800/60">
                <td className="p-2 text-gray-400 text-[10px]">{new Date(l.created_at).toLocaleString('zh-CN')}</td>
                <td className="p-2 font-mono text-[10px]">{l.admin_user_id}</td>
                <td className="p-2 text-gray-300">{l.action}</td>
                <td className="p-2 font-mono text-[10px] text-gray-400">{l.target_type}/{l.target_id}</td>
                <td className="p-2 text-gray-500 text-[10px]">{l.ip || '-'}</td>
                <td className="p-2 text-gray-500 text-[10px] truncate max-w-[200px]">{l.user_agent || '-'}</td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={6} className="text-center py-6 text-gray-500">暂无审计日志</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};


export default AdminFeatureTabs;
