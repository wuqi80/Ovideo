import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layers3 } from 'lucide-react';
import { TaskProvider } from '@drama/contexts/TaskContext';
import { getAuthToken } from '@drama/services/httpClient';
import { App } from './App';
import { createDramaRuntime } from './platform/dramaRuntime';
import { StudioRuntimeProvider } from './services/runtime';
// 品牌字体（构建期打包，不依赖外网 CDN）：Sora 标题 / Space Mono 编号标签；中文回退系统字体
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function StudioEntry() {
  const search = new URLSearchParams(window.location.search);
  const projectId = search.get('projectId')?.trim() || '';
  const episodeId = search.get('episodeId')?.trim() || '';
  const safeDefaultReturn = projectId && episodeId
    ? `/projects/${encodeURIComponent(projectId)}/ep/${encodeURIComponent(episodeId)}`
    : '/projects';
  const requestedReturn = search.get('returnTo') || safeDefaultReturn;
  const returnTo = requestedReturn.startsWith('/') && !requestedReturn.startsWith('//')
    ? requestedReturn
    : safeDefaultReturn;

  const runtime = useMemo(() => (
    projectId && episodeId
      ? createDramaRuntime({ projectId, episodeId, returnTo })
      : null
  ), [episodeId, projectId, returnTo]);

  if (!getAuthToken()) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login?next=${encodeURIComponent(next)}`);
    return null;
  }

  if (!runtime) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#141419] px-6 text-white">
        <section className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <Layers3 className="mx-auto mb-4 text-cyan-400" size={32} />
          <h1 className="text-lg font-semibold">无法打开自由创作</h1>
          <p className="mt-2 text-sm text-zinc-400">缺少项目或分集参数，请从分集页面重新进入。</p>
          <a className="mt-6 inline-flex rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white" href="/projects">
            返回项目
          </a>
        </section>
      </main>
    );
  }

  return (
    <StudioRuntimeProvider runtime={runtime}>
      <App />
    </StudioRuntimeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TaskProvider>
        <StudioEntry />
      </TaskProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
