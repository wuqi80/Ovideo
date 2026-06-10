/**
 * ShareResourceDialog.tsx
 * 2026-05-26 组织管理 MVP — Slice 4
 *
 * 通用资源共享对话框。复用在项目详情 / 素材详情 / 分组详情。
 * 详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §6.3
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Share2, X, Trash2, Plus, Building2, FolderOpen } from 'lucide-react';

import {
  listShares, createShare, deleteShare,
  ShareResourceType, ShareTargetType, ResourceShare,
} from '../services/shareService';
import { listProjects } from '../services/apiService';
import { useWorkspace } from '../contexts/WorkspaceContext';


export interface ShareResourceDialogProps {
  resourceType: ShareResourceType;
  resourceId: string;
  resourceName?: string;
  onClose: () => void;
  /** 共享变更后回调（用于上层刷新 visibility badge）*/
  onChange?: () => void;
}


async function readErr(e: any): Promise<string> {
  const raw = String(e?.message || e || '');
  const m = raw.match(/\{.*\}$/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.detail === 'string') return j.detail;
    } catch {}
  }
  return raw;
}


export const ShareResourceDialog: React.FC<ShareResourceDialogProps> = ({
  resourceType, resourceId, resourceName, onClose, onChange,
}) => {
  const { organizations } = useWorkspace();
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // 表单
  const [targetType, setTargetType] = useState<ShareTargetType>('org');
  const [targetOrgId, setTargetOrgId] = useState<string>('');
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [orgProjects, setOrgProjects] = useState<any[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listShares(resourceType, resourceId);
      setShares(r.shares || []);
    } catch (e) {
      console.warn('listShares failed:', e);
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, [resourceType, resourceId]);

  useEffect(() => { reload(); }, [reload]);

  // 当 targetType=project 且 targetOrgId 选定后，拉该组织里的项目供选择
  useEffect(() => {
    let alive = true;
    if (targetType !== 'project' || !targetOrgId) {
      setOrgProjects([]);
      setTargetProjectId('');
      return;
    }
    (async () => {
      try {
        const r = await listProjects(200, targetOrgId);
        if (alive) setOrgProjects(r.projects || []);
      } catch (e) {
        console.warn('list org projects failed:', e);
        if (alive) setOrgProjects([]);
      }
    })();
    return () => { alive = false; };
  }, [targetType, targetOrgId]);

  const handleAdd = async () => {
    if (!targetOrgId) { alert('请选择组织'); return; }
    let shareTargetId = targetOrgId;
    if (targetType === 'project') {
      if (!targetProjectId) { alert('请选择项目'); return; }
      shareTargetId = targetProjectId;
    }
    setBusy(true);
    try {
      await createShare({
        resource_type: resourceType,
        resource_id: resourceId,
        share_target_type: targetType,
        share_target_id: shareTargetId,
      });
      setTargetOrgId('');
      setTargetProjectId('');
      await reload();
      onChange?.();
    } catch (e: any) {
      alert(`共享失败：${await readErr(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (s: ResourceShare) => {
    if (!confirm(`取消共享给「${s.share_target_name || s.share_target_id}」？`)) return;
    try {
      await deleteShare(s.share_id);
      await reload();
      onChange?.();
    } catch (e: any) {
      alert(`取消失败：${await readErr(e)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
          <Share2 size={14} className="text-indigo-400" />
          <span className="text-sm font-medium text-gray-200">共享资源</span>
          {resourceName && (
            <span className="ml-1 text-xs text-gray-500 truncate">— {resourceName}</span>
          )}
          <button onClick={onClose} className="ml-auto text-gray-500 hover:text-gray-300">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 已共享列表 */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
              已共享 ({shares.length})
            </div>
            {loading ? (
              <div className="text-xs text-gray-500 py-2">加载中…</div>
            ) : shares.length === 0 ? (
              <div className="text-xs text-gray-500 py-2 px-3 bg-gray-900/40 border border-dashed border-gray-800 rounded">
                尚未共享给任何目标
              </div>
            ) : (
              <div className="space-y-1.5">
                {shares.map(s => (
                  <div key={s.share_id} className="flex items-center gap-2 px-3 py-2 bg-gray-800/60 border border-gray-800 rounded">
                    {s.share_target_type === 'org' ? (
                      <Building2 size={12} className="text-indigo-300" />
                    ) : (
                      <FolderOpen size={12} className="text-emerald-300" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-200 truncate">
                        {s.share_target_name || s.share_target_id}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {s.share_target_type === 'org' ? '整个组织' : '组织内项目'} · {new Date(s.granted_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(s)}
                      className="px-2 py-0.5 text-[10px] rounded bg-red-900/40 hover:bg-red-900/70 text-red-200 inline-flex items-center gap-1"
                    ><Trash2 size={10} />取消</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 新增表单 */}
          <div className="border-t border-gray-800 pt-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">添加共享</div>
            {organizations.length === 0 ? (
              <div className="text-xs text-gray-500 px-3 py-2 bg-gray-900/40 border border-dashed border-gray-800 rounded">
                你还没加入任何组织，无法共享资源。请联系管理员把你加入组织。
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={targetType === 'org'}
                      onChange={() => setTargetType('org')}
                    />
                    <span className="text-gray-300">整个组织</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer ml-3">
                    <input
                      type="radio"
                      checked={targetType === 'project'}
                      onChange={() => setTargetType('project')}
                    />
                    <span className="text-gray-300">组织内某项目</span>
                  </label>
                </div>

                <select
                  value={targetOrgId}
                  onChange={e => setTargetOrgId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs"
                >
                  <option value="">— 选择组织 —</option>
                  {organizations.map(o => (
                    <option key={o.org_id} value={o.org_id}>
                      {o.name}{o.my_role ? `（${o.my_role}）` : ''}
                    </option>
                  ))}
                </select>

                {targetType === 'project' && (
                  <select
                    value={targetProjectId}
                    onChange={e => setTargetProjectId(e.target.value)}
                    disabled={!targetOrgId}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs disabled:opacity-40"
                  >
                    <option value="">{targetOrgId ? '— 选择项目 —' : '— 先选组织 —'}</option>
                    {orgProjects.map(p => (
                      <option key={p.project_id} value={p.project_id}>
                        {p.project_name || p.name || p.project_id}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  onClick={handleAdd}
                  disabled={busy || !targetOrgId || (targetType === 'project' && !targetProjectId)}
                  className="w-full px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-xs inline-flex items-center justify-center gap-1"
                >
                  <Plus size={11} />{busy ? '共享中…' : '共享'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareResourceDialog;
