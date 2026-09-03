import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useParams, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Clock, Brush, Library, Coins, Download, ScanLine } from 'lucide-react';
import { EpisodeProvider } from '../contexts/EpisodeContext';
import type { SourcePage } from '../types';
import { TaskBadge } from '../components/TaskBadge';
import { NotificationPanel } from '../components/NotificationPanel';
import { getCreditBalance } from '../services/creditService';
import { apiJson } from '../services/httpClient';
import AppSidebar, { type AppSidebarItem } from '../components/AppSidebar';

// The four-stage shell is the stable beginner-facing navigation contract.
// Feature pages may evolve independently, but their stage ownership must remain
// explicit so deep links, task notifications, and return navigation stay valid.
interface StageSub {
  path: string;
  label: string;
  sourcePage: SourcePage;
}
const STAGES: { key: string; label: string; hint: string; primary: string; subs: StageSub[] }[] = [
  { key: 'script', label: '写故事', hint: '第 1 步', primary: 'script', subs: [{ path: 'script', label: '故事内容', sourcePage: 'script' }] },
  {
    key: 'art', label: '定角色和场景', hint: '第 2 步', primary: 'design',
    subs: [
      { path: 'design', label: '角色场景', sourcePage: 'design' },
      { path: 'materials', label: '可用素材', sourcePage: 'materials' },
    ],
  },
  {
    key: 'storyboard', label: '排画面和声音', hint: '第 3 步', primary: 'storyboard',
    subs: [
      { path: 'storyboard', label: '镜头画面', sourcePage: 'storyboard' },
      { path: 'audio', label: '声音对白', sourcePage: 'audio' },
    ],
  },
  {
    key: 'video', label: '生成短片', hint: '第 4 步', primary: 'video',
    subs: [
      { path: 'video', label: '生成视频', sourcePage: 'video' },
      { path: 'enhance', label: '优化合成', sourcePage: 'enhance' },
      { path: 'final', label: '导出成片', sourcePage: 'final' },
    ],
  },
];

export const WorkflowLayout: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState<string>('');

  const refreshCredits = useCallback(async () => {
    try {
      const balance = await getCreditBalance();
      setAvailableCredits(balance.available_credits);
    } catch (error) {
      console.warn('获取用户创作点数失败:', error);
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

  // 顶栏标题：分集名（仅取一次，静默失败）
  useEffect(() => {
    if (!projectId || !episodeId) return;
    let alive = true;
    (async () => {
      try {
        const data = await apiJson<{ success?: boolean; episodes?: any[] }>(`/api/projects/${projectId}/episodes`, {}, '分集信息');
        const row = data?.episodes?.find(e => (e.episode_id ?? e.episodeId) === episodeId);
        if (alive && row) setEpisodeTitle(row.episode_name ?? row.title ?? row.name ?? '');
      } catch {
        /* 静默 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, episodeId]);

  const segment = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const activeStageIdx = useMemo(() => STAGES.findIndex(stage => stage.subs.some(sub => sub.path === segment)), [segment]);
  const activeStage = activeStageIdx >= 0 ? STAGES[activeStageIdx] : null;

  const sidebarTools: AppSidebarItem[] = [
    { key: 'canvas', label: '专业画布', icon: Brush, to: `/projects/${projectId}/ep/${episodeId}/canvas` },
    { key: 'media-library', label: '我的素材', icon: Library, to: 'media-library', badge: <TaskBadge page="media-library" /> },
    { key: 'image-upscale', label: '图片高清放大', icon: ScanLine, to: 'image-upscale', badge: <TaskBadge page="image-upscale" /> },
    { key: 'history', label: '版本记录', icon: Clock, to: 'history', badge: <TaskBadge page="history" /> },
  ];

  return (
    <EpisodeProvider>
      <div className="workflow-shell layout-safe flex h-screen min-w-0 overflow-hidden bg-n20 text-n800">
        <AppSidebar exportTo="final" tools={sidebarTools} credits={availableCredits} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="workflow-shell-header flex shrink-0 items-center gap-4 border-b border-n40 bg-n20/90 px-5">
            {/* 左：分集标题 */}
            <div className="min-w-[130px] max-w-[210px] shrink-0 leading-tight">
              <div className="truncate font-display text-[15px] font-bold tracking-tight">{episodeTitle || '创作作品'}</div>
              <div className="mt-0.5 truncate text-[11px] text-n200">跟着 4 步完成作品</div>
            </div>

            {/* 中：四阶段步骤条 */}
            <nav
              className="workflow-shell-nav flex min-w-0 flex-1 items-center justify-center overflow-x-auto scrollbar-atlas"
              aria-label="流程化制作导航"
            >
              {STAGES.map((stage, index) => {
                const done = activeStageIdx >= 0 && index < activeStageIdx;
                const active = index === activeStageIdx;
                return (
                  <React.Fragment key={stage.key}>
                    {index > 0 && (
                      <span aria-hidden className={`mx-1 h-0.5 w-8 shrink-0 ${done || active ? 'bg-success' : 'bg-n40'}`} />
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(stage.primary)}
                      className="flex shrink-0 items-center gap-2 rounded px-1.5 py-1 transition-opacity hover:opacity-85"
                    >
                      <span
                        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold transition-all ${
                          active
                            ? 'bg-primary text-n0 ring-4 ring-primary/15'
                            : done
                              ? 'bg-success text-n0'
                              : 'bg-n40 text-n200'
                        }`}
                      >
                        {done ? '✓' : index + 1}
                      </span>
                      <span className="flex flex-col items-start leading-[1.15]">
                        <span
                          className={`whitespace-nowrap font-display text-[12.5px] ${
                            active ? 'font-bold text-n800' : done ? 'font-medium text-n600' : 'font-medium text-n80'
                          }`}
                        >
                          {stage.label}
                        </span>
                        <span className="whitespace-nowrap text-[10px] tracking-[0.03em] text-n80">{stage.hint}</span>
                      </span>
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>

            {/* 右：创作点数 · 通知 · 导出 */}
            <div className="workflow-shell-account flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => navigate('/credits')}
                className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-n500 hover:bg-y50 hover:text-warning"
                title="查看我的创作点数"
                aria-label={`可用创作点数：${availableCredits ?? '加载中'}`}
              >
                <Coins className="h-4 w-4 shrink-0 text-warning" />
                <span className="font-mono font-bold tabular-nums">{availableCredits === null ? '--' : availableCredits.toLocaleString()}</span>
              </button>
              <NotificationPanel compact />
              <button
                type="button"
                onClick={() => navigate('final')}
                className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-primary px-3.5 text-xs font-semibold text-n0 shadow-glow transition-colors hover:bg-primary-hover"
              >
                <Download size={13} />
                查看成片
              </button>
            </div>
          </header>

          {/* 阶段内子页签（模板 art-tabs 样式；单子页阶段不渲染） */}
          {activeStage && activeStage.subs.length > 1 && (
            <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-n40 bg-n10 px-5">
              <span className="mr-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-n100">{activeStage.label}</span>
              {activeStage.subs.map(sub => (
                <NavLink
                  key={sub.path}
                  to={sub.path}
                  className={({ isActive }) =>
                    `inline-flex h-7 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                      isActive
                        ? 'border-b100 bg-primary-light text-primary'
                        : 'border-n50 bg-n0 text-n300 hover:border-b300 hover:text-primary'
                    }`
                  }
                >
                  {sub.label}
                  <TaskBadge page={sub.sourcePage} />
                </NavLink>
              ))}
            </div>
          )}

          <main className="workflow-shell-workspace layout-safe min-h-0 min-w-0 flex-1 overflow-hidden bg-n20">
            <Outlet />
          </main>
        </div>
      </div>
    </EpisodeProvider>
  );
};
