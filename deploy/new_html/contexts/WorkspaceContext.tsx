/**
 * WorkspaceContext.tsx
 * 2026-05-26 组织管理 MVP — Slice 3
 *
 * 当前活动 workspace（'personal' | org_id）+ 我加入的组织列表。
 *
 * 状态持久化：sessionStorage（tab 级隔离，admin 也用同 key 不互通因为不同窗口/tab）。
 */

import React, {
  createContext, useContext, useEffect, useState, useCallback, useMemo,
} from 'react';
import type { Organization } from '../services/organizationService';
import { isAdminPath } from '../admin/adminRoute';

export type WorkspaceId = 'personal' | string;   // 'personal' 或 org_id

interface WorkspaceContextValue {
  currentWorkspace: WorkspaceId;
  /** 当前 workspace 显示名（"个人空间" / "Acme 组织"）*/
  currentName: string;
  /** 当前 workspace 是不是组织（true = org_id；false = personal） */
  isOrgWorkspace: boolean;
  /** 我加入的组织列表 */
  organizations: Organization[];
  /** 切到指定 workspace */
  setWorkspace: (ws: WorkspaceId) => void;
  /** 重新拉组织列表（admin 给我新加成员后调） */
  refreshOrganizations: () => Promise<void>;
  /** 加载状态 */
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const STORAGE_KEY = 'current_workspace';

function readSavedWorkspace(): WorkspaceId {
  try {
    if (typeof window === 'undefined') return 'personal';
    return (sessionStorage.getItem(STORAGE_KEY) as WorkspaceId) || 'personal';
  } catch {
    return 'personal';
  }
}

function saveWorkspace(ws: WorkspaceId) {
  try {
    sessionStorage.setItem(STORAGE_KEY, ws);
  } catch {}
}


export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceId>(readSavedWorkspace);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshOrganizations = useCallback(async () => {
    // 2026-05-26：admin shell 不需要 workspace（独立登录），skip
    try {
      if (
        typeof window !== 'undefined'
        && (isAdminPath(window.location.pathname) || window.location.pathname.startsWith('/share/final/'))
      ) {
        return;
      }
    } catch {}
    setLoading(true);
    try {
      const { listMyOrganizations } = await import('../services/organizationService');
      const r = await listMyOrganizations();
      setOrganizations(r.organizations || []);

      // 如果当前 workspace 是 org_id，但用户已不在该 org（被踢出 / 组织被删），回退到 personal
      const saved = readSavedWorkspace();
      if (saved !== 'personal') {
        const stillMember = (r.organizations || []).some(o => o.org_id === saved);
        if (!stillMember) {
          saveWorkspace('personal');
          setCurrentWorkspace('personal');
        }
      }
    } catch (e) {
      console.warn('refreshOrganizations failed:', e);
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshOrganizations(); }, [refreshOrganizations]);

  const setWorkspace = useCallback((ws: WorkspaceId) => {
    saveWorkspace(ws);
    setCurrentWorkspace(ws);
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => {
    const isOrg = currentWorkspace !== 'personal';
    const org = organizations.find(o => o.org_id === currentWorkspace);
    return {
      currentWorkspace,
      currentName: isOrg ? (org?.name || currentWorkspace) : '个人空间',
      isOrgWorkspace: isOrg,
      organizations,
      setWorkspace,
      refreshOrganizations,
      loading,
    };
  }, [currentWorkspace, organizations, setWorkspace, refreshOrganizations, loading]);

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
};


export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    // 兜底：未挂 Provider 时返回 personal-only 静态值，让组件继续工作
    return {
      currentWorkspace: 'personal',
      currentName: '个人空间',
      isOrgWorkspace: false,
      organizations: [],
      setWorkspace: () => {},
      refreshOrganizations: async () => {},
      loading: false,
    };
  }
  return ctx;
}

/**
 * 便捷 helper：得到要传给 API 的 org_id。
 * personal workspace → undefined（旧行为）
 * org workspace → org_id
 */
export function useCurrentOrgId(): string | undefined {
  const ws = useWorkspace();
  return ws.isOrgWorkspace ? ws.currentWorkspace : undefined;
}
