import React from 'react';
import { Outlet, useParams, NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Image, Mic, Palette, Film, Sparkles, Clock, Brush, LogOut, LayoutGrid, Wand2, Library } from 'lucide-react';
import { EpisodeProvider } from '../contexts/EpisodeContext';
import type { SourcePage } from '../types';
import { TaskBadge } from '../components/TaskBadge';
import { NotificationPanel } from '../components/NotificationPanel';

// 2026-05-20 (Task System Overhaul M1)：每个 nav item 关联 sourcePage，用于 per-page TaskBadge。
// 2026-05-26 Slice 1/3：插入"视频反推"（剧本之后）与"素材库"（历史之前），
//                        两者本身是项目级页面，但挂在 workflow 路由下以复用顶部统一导航。
const NAV_ITEMS: { path: string; label: string; icon: any; sourcePage: SourcePage }[] = [
  { path: 'script',         label: '剧本',     icon: FileText,   sourcePage: 'script' },
  { path: 'video-reverse',  label: '视频反推', icon: Wand2,      sourcePage: 'video-reverse' },
  { path: 'design',         label: '设计',     icon: Palette,    sourcePage: 'design' },
  { path: 'materials',      label: '素材',     icon: Image,      sourcePage: 'materials' },
  { path: 'audio',          label: '配音',     icon: Mic,        sourcePage: 'audio' },
  { path: 'storyboard',     label: '分镜',     icon: LayoutGrid, sourcePage: 'storyboard' },
  { path: 'video',          label: '视频',     icon: Film,       sourcePage: 'video' },
  { path: 'enhance',        label: '美化',     icon: Sparkles,   sourcePage: 'enhance' },
  { path: 'media-library',  label: '素材库',   icon: Library,    sourcePage: 'media-library' },
  { path: 'history',        label: '历史',     icon: Clock,      sourcePage: 'history' },
];

export const WorkflowLayout: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const navigate = useNavigate();
  // 2026-05-26：流程化页面顶部不再放"管理"入口 — 后台抽成独立 /admin Shell，
  // 详见 docs/vertical-slices.md "Admin Shell（2026-05-26）" 章节。

  return (
    <EpisodeProvider>
      <div className="flex flex-col h-screen bg-gray-950">
        <nav className="flex items-center gap-1 px-3 h-12 border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm shrink-0">
          <button
            onClick={() => navigate(`/projects/${projectId}/episodes`)}
            className="flex items-center gap-1.5 px-3 py-1.5 mr-2 text-sm text-gray-500 hover:text-white rounded-md hover:bg-gray-800 transition-all duration-200 border-r border-gray-800 pr-4"
            title="返回分集管理"
          >
            <ArrowLeft size={14} /> 分集
          </button>
          <div className="flex items-center gap-0.5">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-indigo-600/15 text-indigo-400 shadow-sm'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'
                    }`
                  }
                >
                  <Icon size={14} />
                  {item.label}
                  {/* per-page 任务指示器（仅活跃时渲染） */}
                  <TaskBadge page={item.sourcePage} />
                </NavLink>
              );
            })}
          </div>
          <NavLink
            to={`/projects/${projectId}/ep/${episodeId}/canvas`}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-gray-500 hover:text-emerald-400 hover:bg-emerald-600/10 transition-all duration-200"
          >
            <Brush size={14} /> 自由创作
          </NavLink>
          {/* 2026-05-20 (Task System Overhaul M1)：通知铃铛（统一面板，点击下拉显示任务列表） */}
          <div className="ml-1">
            <NotificationPanel compact />
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('auth_token');
              localStorage.removeItem('username');
              window.location.href = '/login';
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 ml-2 rounded-md text-sm text-gray-500 hover:text-red-400 hover:bg-red-600/10 transition-all duration-200"
            title="退出登录"
          >
            <LogOut size={14} />
          </button>
        </nav>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </EpisodeProvider>
  );
};
