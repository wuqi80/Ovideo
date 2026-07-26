import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useParams, NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Image, Mic, Palette, Film, Sparkles, Clock, Brush, LogOut, LayoutGrid, Library, Clapperboard, Coins, UserRound } from 'lucide-react';
import { EpisodeProvider } from '../contexts/EpisodeContext';
import type { SourcePage } from '../types';
import { TaskBadge } from '../components/TaskBadge';
import { NotificationPanel } from '../components/NotificationPanel';
import { getCreditBalance } from '../services/creditService';

// 2026-05-20 (Task System Overhaul M1)：每个 nav item 关联 sourcePage，用于 per-page TaskBadge。
// 视频反推已整合到剧本对话工具栏；素材库保留为独立工作流阶段。
const NAV_ITEMS: { path: string; label: string; icon: any; sourcePage: SourcePage }[] = [
  { path: 'script',         label: '剧本',     icon: FileText,   sourcePage: 'script' },
  { path: 'design',         label: '设计',     icon: Palette,    sourcePage: 'design' },
  { path: 'materials',      label: '素材',     icon: Image,      sourcePage: 'materials' },
  { path: 'audio',          label: '配音',     icon: Mic,        sourcePage: 'audio' },
  { path: 'storyboard',     label: '分镜',     icon: LayoutGrid, sourcePage: 'storyboard' },
  { path: 'video',          label: '视频',     icon: Film,       sourcePage: 'video' },
  { path: 'enhance',        label: '美化',     icon: Sparkles,   sourcePage: 'enhance' },
  { path: 'final',          label: '成品',     icon: Clapperboard, sourcePage: 'final' },
  { path: 'media-library',  label: '素材库',   icon: Library,    sourcePage: 'media-library' },
  { path: 'history',        label: '历史',     icon: Clock,      sourcePage: 'history' },
];

// Webflow shell：56px 白色顶栏 + #d8d8d8 细边 + #146ef5 活跃态。
// 导航项、路由和业务逻辑保持不变。
export const WorkflowLayout: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const navigate = useNavigate();
  const username = localStorage.getItem('username') || '用户';
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);

  const refreshCredits = useCallback(async () => {
    try {
      const balance = await getCreditBalance();
      setAvailableCredits(balance.available_credits);
    } catch (error) {
      console.warn('获取用户积分失败:', error);
      setAvailableCredits(null);
    }
  }, []);

  useEffect(() => {
    void refreshCredits();
    const intervalId = window.setInterval(() => void refreshCredits(), 60_000);
    const handleCreditsUpdated = (event: Event) => {
      const rawBalance = (event as CustomEvent<{ balance?: number | null }>).detail?.balance;
      if (typeof rawBalance === 'number' && Number.isFinite(rawBalance)) setAvailableCredits(rawBalance);
      else void refreshCredits();
    };
    window.addEventListener('focus', refreshCredits);
    window.addEventListener('credits:updated', handleCreditsUpdated);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshCredits);
      window.removeEventListener('credits:updated', handleCreditsUpdated);
    };
  }, [refreshCredits]);

  return (
    <EpisodeProvider>
      <div className="layout-safe flex flex-col h-screen min-w-0 overflow-hidden bg-n0 text-n800">
        <nav className="responsive-toolbar flex items-center gap-1 px-4 border-b border-n40 bg-n0 shadow-card shrink-0 min-w-0 overflow-hidden">
          <button
            onClick={() => navigate(`/projects/${projectId}/episodes`)}
            className="shrink-0 flex items-center gap-1.5 pr-4 mr-1 py-1.5 px-3 text-sm font-medium text-n300 hover:text-n800 rounded hover:bg-n20 transition-colors border-r border-n40"
            title="返回分集管理"
          >
            <ArrowLeft size={15} /> 分集
          </button>
          <div className="flex flex-1 min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-atlas">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `relative shrink-0 flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-primary bg-primary-light'
                        : 'text-n300 hover:text-n800 hover:bg-n20'
                    }`
                  }
                >
                  <Icon size={15} />
                  {item.label}
                  {/* per-page 任务指示器（仅活跃时渲染） */}
                  <TaskBadge page={item.sourcePage} />
                </NavLink>
              );
            })}
          </div>
          <NavLink
            to={`/projects/${projectId}/ep/${episodeId}/canvas`}
            className="shrink-0 ml-2 flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium text-n300 hover:text-teal hover:bg-t50 transition-colors"
          >
            <Brush size={15} /> 自由创作
          </NavLink>
          {/* 2026-05-20：通知铃铛（统一面板） */}
          <div className="ml-1">
            <NotificationPanel compact />
          </div>
          <div className="ml-1 flex shrink-0 items-center gap-1 border-l border-n40 pl-2">
            <div
              className="inline-flex h-8 max-w-[132px] items-center gap-1.5 rounded px-2 text-xs text-n500"
              title={`当前用户：${username}`}
              aria-label={`当前用户：${username}`}
            >
              <UserRound className="h-4 w-4 shrink-0 text-n300" />
              <span className="truncate font-medium">{username}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/credits')}
              className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-n500 hover:bg-y50 hover:text-warning"
              title="查看我的积分"
              aria-label={`可用积分：${availableCredits ?? '加载中'}`}
            >
              <Coins className="h-4 w-4 shrink-0 text-warning" />
              <span className="tabular-nums">{availableCredits === null ? '--' : availableCredits.toLocaleString()}</span>
            </button>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('auth_token');
              localStorage.removeItem('username');
              window.location.href = '/login';
            }}
            className="flex items-center gap-1.5 px-2.5 py-2 ml-1 rounded text-sm text-n300 hover:text-danger hover:bg-r50 transition-colors"
            title="退出登录"
          >
            <LogOut size={15} />
          </button>
        </nav>
        <main className="layout-safe flex-1 min-h-0 min-w-0 overflow-auto scrollbar-atlas">
          <Outlet />
        </main>
      </div>
    </EpisodeProvider>
  );
};
