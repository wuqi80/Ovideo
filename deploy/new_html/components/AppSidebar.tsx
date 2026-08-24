/**
 * AppSidebar.tsx — 全局深色侧边栏（完全对齐 docs/design-standard 模板的侧栏结构）
 *
 * 结构自上而下：品牌块 → 面向普通用户的主导航 → 最近项目
 * → 更多功能（可选）→ 创作点数 → 用户行。
 * credits 传 undefined 时组件自行拉取；仅视觉与导航，不承载业务状态。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Plus, LayoutGrid, Share2, ChevronDown, LogOut, UserRound } from 'lucide-react';
import { apiFetch, apiJson } from '../services/httpClient';
import { getCreditBalance } from '../services/creditService';
import { clearAccountIdentity, getStoredUsername } from '../services/accountStorage';
import BrandLogo from './BrandLogo';
import { BRAND_NAME, BRAND_PRODUCT_NAME } from '../config/brand';

export interface AppSidebarItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  to?: string;
  end?: boolean;
  onClick?: () => void;
  badge?: React.ReactNode;
}

interface RecentProject {
  project_id: string;
  project_name?: string;
  name?: string;
}

interface AppSidebarProps {
  /** 成片与分享的目标路由；缺省时不渲染该项（无分集上下文的页面） */
  exportTo?: string;
  /** 按需使用的功能区（如工作流内的 我的素材 / 版本记录 / 专业画布） */
  tools?: AppSidebarItem[];
  credits?: number | null;
  className?: string;
}

const RECENT_DOTS = ['#8B6BFF', '#FF9A6B', '#3FCB8F', '#66A0F5'];

const itemClass = (active: boolean) =>
  `flex w-full min-w-0 items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors ${
    active ? 'bg-primary text-n0' : 'text-n90 hover:bg-n700 hover:text-n0'
  }`;

const sectionLabelClass = 'px-2.5 pb-2 pt-0 font-mono text-[10px] font-bold tracking-[0.14em] text-n400';

export const AppSidebar: React.FC<AppSidebarProps> = ({ exportTo, tools = [], credits, className = '' }) => {
  const navigate = useNavigate();
  const managed = credits === undefined;
  const [selfCredits, setSelfCredits] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [username, setUsername] = useState(() => getStoredUsername('未登录'));
  const [menuOpen, setMenuOpen] = useState(false);
  const userRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!managed) return;
    let alive = true;
    const refresh = async () => {
      try {
        const balance = await getCreditBalance();
        if (alive) setSelfCredits(balance.available_credits);
      } catch {
        if (alive) setSelfCredits(null);
      }
    };
    void refresh();
    const handleCreditsUpdated = (event: Event) => {
      const raw = (event as CustomEvent<{ balance?: number | null }>).detail?.balance;
      if (typeof raw === 'number' && Number.isFinite(raw)) setSelfCredits(raw);
      else void refresh();
    };
    window.addEventListener('credits:updated', handleCreditsUpdated);
    return () => {
      alive = false;
      window.removeEventListener('credits:updated', handleCreditsUpdated);
    };
  }, [managed]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiJson<{ success?: boolean; projects?: RecentProject[] }>('/api/projects', {}, '最近项目');
        if (alive && Array.isArray(data?.projects)) setRecent(data.projects.slice(0, 3));
      } catch {
        /* 静默：侧栏最近项目为增强信息 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const syncUsername = () => setUsername(getStoredUsername('未登录'));
    const handlePointerDown = (event: MouseEvent) => {
      if (!userRowRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('account:updated', syncUsername);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('account:updated', syncUsername);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  const handleLogout = useCallback(async () => {
    setMenuOpen(false);
    try {
      await apiFetch('/api/logout', { method: 'POST' }, { apiName: 'logout' });
    } catch (error) {
      console.warn('退出登录请求失败:', error);
    }
    clearAccountIdentity();
    window.location.href = '/login';
  }, []);

  const shownCredits = managed ? selfCredits : credits;
  const initial = (username.trim().charAt(0) || 'U').toUpperCase();

  return (
    <aside className={`w-[230px] shrink-0 flex-col bg-n900 px-3 py-4 text-n90 flex ${className}`}>
      {/* 品牌块 */}
      <button
        type="button"
        onClick={() => navigate('/projects')}
        className="mb-4 flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-n700"
        title={BRAND_PRODUCT_NAME}
      >
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-n0/95 p-1 shadow-glow">
          <BrandLogo variant="mark" className="h-6 w-6" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-display text-[15px] font-bold tracking-tight text-n0">{BRAND_NAME}</span>
          <span className="block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-n200">AI 视频创作平台</span>
        </span>
      </button>

      {/* 主导航（模板固定三项） */}
      <NavLink to="/create" className={({ isActive }) => itemClass(isActive)}>
        <Plus size={17} className="shrink-0" />
        <span className="truncate">开始新作品</span>
      </NavLink>
      <NavLink to="/projects" end className={({ isActive }) => itemClass(isActive)}>
        <LayoutGrid size={17} className="shrink-0" />
        <span className="truncate">我的作品</span>
      </NavLink>
      {exportTo && (
        <NavLink to={exportTo} className={({ isActive }) => itemClass(isActive)}>
          <Share2 size={17} className="shrink-0" />
          <span className="truncate">成片与分享</span>
        </NavLink>
      )}

      <div className="mx-1.5 my-3 h-px bg-n600" />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
        {/* 最近项目 RECENT */}
        {recent.length > 0 && (
          <>
            <div className={sectionLabelClass}>最近作品</div>
            {recent.map((project, index) => (
              <button
                key={project.project_id}
                type="button"
                onClick={() => navigate(`/projects/${project.project_id}/episodes`)}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] text-n70 transition-colors hover:bg-n700 hover:text-n0"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: RECENT_DOTS[index % RECENT_DOTS.length] }}
                />
                <span className="min-w-0 flex-1 truncate">{project.project_name || project.name || project.project_id}</span>
              </button>
            ))}
          </>
        )}

        {/* 上下文工具区 */}
        {tools.length > 0 && (
          <>
            <div className={`${sectionLabelClass} pt-3`}>更多功能</div>
            {tools.map(item => {
              const Icon = item.icon;
              const inner = (
                <>
                  <Icon size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge}
                </>
              );
              return item.to ? (
                <NavLink
                  key={item.key}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex w-full min-w-0 items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                      isActive ? 'bg-primary text-n0' : 'text-n70 hover:bg-n700 hover:text-n0'
                    }`
                  }
                >
                  {inner}
                </NavLink>
              ) : (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className="flex w-full min-w-0 items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] text-n70 transition-colors hover:bg-n700 hover:text-n0"
                >
                  {inner}
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* 创作点数卡 */}
      <button
        type="button"
        onClick={() => navigate('/credits')}
        className="ui-dark-panel mb-3 mt-3 w-full px-3.5 py-3 text-left transition-colors hover:border-n400"
        title="查看创作点数明细"
      >
        <span className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-[0.05em] text-b200">创作点数</span>
          <span className="text-[11px] text-n200">查看明细 →</span>
        </span>
        <span className="mt-1 block font-display text-[22px] font-bold text-n0">
          {typeof shownCredits === 'number' ? shownCredits.toLocaleString() : '—'}
          <span className="ml-1 font-sans text-[13px] font-normal text-n200">可用</span>
        </span>
        <span className="mt-2 block h-1.5 overflow-hidden rounded bg-n600">
          <span
            className="block h-full rounded"
            style={{ width: '80%', background: 'linear-gradient(90deg,#5B49F0,#8B6BFF)' }}
          />
        </span>
      </button>

      {/* 用户行（上拉菜单：个人中心 / 退出登录） */}
      <div ref={userRowRef} className="relative">
        {menuOpen && (
          <div
            role="menu"
            aria-label="账号菜单"
            className="absolute bottom-full left-0 z-30 mb-2 w-full overflow-hidden rounded-[10px] border border-n40 bg-n0 py-1 shadow-atlas"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                window.location.href = '/profile';
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-n500 transition-colors hover:bg-n20 hover:text-n800"
            >
              <UserRound size={15} /> 个人中心
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-n500 transition-colors hover:bg-r50 hover:text-danger"
            >
              <LogOut size={15} /> 退出登录
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen(open => !open)}
          className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-n700"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold text-n0"
            style={{ background: 'linear-gradient(135deg,#FF6A3D,#FF9A6B)' }}
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-medium text-n0">{username}</span>
            <span className="block truncate text-[11px] text-n200">创作者</span>
          </span>
          <ChevronDown size={15} className={`shrink-0 text-n200 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
