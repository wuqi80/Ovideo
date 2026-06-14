/**
 * 应用入口 — 四层嵌套路由
 *
 * 路由结构:
 *   /projects                                          → 项目管理中心
 *   /projects/:projectId                               → 分集管理
 *   /projects/:projectId/ep/:episodeId                 → 分集中心 (选模式)
 *   /projects/:projectId/ep/:episodeId/workflow/script  → 流程化: 剧本编辑
 *   /projects/:projectId/ep/:episodeId/workflow/materials → 流程化: 素材绑定
 *   /projects/:projectId/ep/:episodeId/workflow/audio    → 流程化: 音频预演
 *   /projects/:projectId/ep/:episodeId/workflow/design   → 流程化: 资产设计
 *   /projects/:projectId/ep/:episodeId/workflow/generation → 流程化: 视频生成
 *   /projects/:projectId/ep/:episodeId/workflow/enhance   → 流程化: 视频增强
 *   /projects/:projectId/ep/:episodeId/workflow/history   → 流程化: 历史记录
 *   /projects/:projectId/ep/:episodeId/canvas            → 自由创作: 无限画布
 *
 * 兼容旧路由 (向后兼容):
 *   /projects/:projectId/editor → redirect to ep/default/workflow/script
 *   /canvas                     → redirect to /projects
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskProvider } from './contexts/TaskContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { GlobalToast } from './components/GlobalToast';
import { useSSEInvalidation } from './hooks/useSSEInvalidation';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});

function SSEInvalidationProvider({ children }: { children: React.ReactNode }) {
  useSSEInvalidation();
  return <>{children}</>;
}

import ProjectHub from './components/ProjectHub';
import ProjectWorkspace from './components/ProjectWorkspace';

import { WorkflowLayout } from './layouts/WorkflowLayout';
import { EpisodeHubPage } from './pages/EpisodeHubPage';
import { ScriptPage } from './pages/ScriptPage';
import { MaterialsPage } from './pages/MaterialsPage';
import { AudioStagePage } from './pages/AudioStagePage';
import { DesignPage } from './pages/DesignPage';
import { GenerationPage } from './pages/GenerationPage';
import { EnhancePage } from './pages/EnhancePage';
import { StoryboardGenPage } from './pages/StoryboardGenPage';
import { VideoGenPage } from './pages/VideoGenPage';
import { HistoryPage } from './pages/HistoryPage';
import { CanvasPage } from './pages/CanvasPage';
import { MediaLibraryPage } from './pages/MediaLibraryPage';
import { CreditsPage } from './pages/CreditsPage';
import { VideoReversePage } from './pages/VideoReversePage';
import { AdminPage } from './components/AdminPage';
import { AdminFeatureTabs } from './components/AdminFeatureTabs';
import { CrmHost } from './admin/crmUI';

import PostProcessPage from './components/PostProcessPage';

// 2026-05-26：独立 Admin Shell
//  - /admin/login            → AdminLoginPage（独立账号密码登录）
//  - /admin                  → AdminLayout > AdminHubPage（导航 Hub）
//  - /admin/settings         → AdminLayout > AdminSettingsPage（系统设置）
//  - /admin/operations       → AdminPage 全屏（5 tab 不变，浮层"返回 Hub"）
// Admin token 走 sessionStorage（adminAuth.ts），与主站 localStorage.auth_token 隔离。
import { AdminLayout } from './admin/AdminLayout';
import { AdminLoginPage } from './admin/AdminLoginPage';
import { AdminHubPage } from './admin/AdminHubPage';
import { AdminSettingsPage } from './admin/AdminSettingsPage';

// refactor/v2：操作面板/功能面板已并入统一壳（AdminLayout 提供层级菜单 + 鉴权门）。
// 这两个轻包装只负责把 ?tab 透传给被内嵌的组件，组件不卸载 → 切 tab 不重复拉数。
const AdminOperationsPanel: React.FC = () => {
    const [sp] = useSearchParams();
    const tab = (sp.get('tab') as 'users' | 'stats' | 'results' | 'system') || 'users';
    return <AdminPage embedded embedTab={tab} />;
};
const AdminFeaturesPanel: React.FC = () => {
    const [sp] = useSearchParams();
    const tab = (sp.get('tab') as any) || 'accounts';
    return <AdminFeatureTabs embedTab={tab} />;
};

const GlobalToastWithNav: React.FC = () => {
    const navigate = useNavigate();
    return (
        <GlobalToast onNavigate={(view, projectId) => {
            if (projectId) {
                navigate(`/projects/${projectId}/episodes`);
            }
        }} />
    );
};

const App: React.FC = () => {
    return (
        <QueryClientProvider client={queryClient}>
        <SSEInvalidationProvider>
        <BrowserRouter>
            <WorkspaceProvider>
            <TaskProvider>
                <GlobalToastWithNav />
                <CrmHost />
                <Routes>
                    {/* ========== 项目管理中心 ========== */}
                    <Route path="/projects" element={<ProjectHub />} />

                    {/* ========== 项目工作区 ========== */}
                    <Route path="/projects/:projectId" element={<ProjectWorkspace />}>
                        {/* 默认跳转到分集管理 (旧路由兼容: 仍可访问 editor 等) */}
                        <Route index element={<Navigate to="episodes" replace />} />

                        {/* 分集管理 */}
                        <Route path="episodes" element={<EpisodeHubPage />} />

                        {/* 2026-05-26 Slice 1: 项目级素材库 */}
                        <Route path="media-library" element={<MediaLibraryPage />} />

                        {/* 2026-05-26 Slice 3: 视频反推工作台 */}
                        <Route path="video-reverse" element={<VideoReversePage />} />

                        {/* ========== 分集级路由 ========== */}
                        <Route path="ep/:episodeId">
                            {/* 分集中心 - 选择模式 */}
                            <Route index element={<EpisodeHubPage />} />

                            {/* 流程化制作 - WorkflowLayout 提供导航 + EpisodeProvider */}
                            <Route path="workflow" element={<WorkflowLayout />}>
                                <Route index element={<Navigate to="script" replace />} />
                                <Route path="script" element={<ScriptPage />} />
                                {/* 2026-05-26 Slice 3：视频反推（项目级页面，挂在 workflow 下复用顶部导航） */}
                                <Route path="video-reverse" element={<VideoReversePage />} />
                                <Route path="design" element={<DesignPage />} />
                                <Route path="materials" element={<MaterialsPage />} />
                                <Route path="audio" element={<AudioStagePage />} />
                                <Route path="storyboard" element={<StoryboardGenPage />} />
                                <Route path="generation" element={<GenerationPage />} />
                                <Route path="video" element={<VideoGenPage />} />
                                <Route path="enhance" element={<EnhancePage />} />
                                {/* 2026-05-26 Slice 1：素材库（项目级页面，挂在 workflow 下复用顶部导航） */}
                                <Route path="media-library" element={<MediaLibraryPage />} />
                                <Route path="history" element={<HistoryPage />} />
                            </Route>

                            {/* 自由创作 - 无限画布 */}
                            <Route path="canvas" element={<CanvasPage />} />
                        </Route>

                            <Route path="postprocess" element={<PostProcessPage />} />
                    </Route>

                    {/* 2026-05-26 Slice 2: 用户积分页 */}
                    <Route path="/credits" element={<CreditsPage />} />

                    {/* 统一 Admin Shell（refactor/v2）— 一个台子、一套层级菜单，与主站 token 隔离 */}
                    <Route path="/admin/login" element={<AdminLoginPage />} />
                    <Route path="/admin" element={<AdminLayout />}>
                        <Route index element={<AdminHubPage />} />
                        <Route path="operations" element={<AdminOperationsPanel />} />
                        <Route path="features" element={<AdminFeaturesPanel />} />
                        <Route path="settings" element={<AdminSettingsPage />} />
                    </Route>

                    {/* ========== 根路径重定向 ========== */}
                    <Route path="/" element={<Navigate to="/projects" replace />} />
                    <Route path="/canvas" element={<Navigate to="/projects" replace />} />
                    <Route path="*" element={<Navigate to="/projects" replace />} />
                </Routes>
            </TaskProvider>
            </WorkspaceProvider>
        </BrowserRouter>
        </SSEInvalidationProvider>
        </QueryClientProvider>
    );
};

export default App;
