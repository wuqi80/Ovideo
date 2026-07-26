import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft, LayoutList, Grid3X3, Clock, Film, MoreVertical, Trash2, Pencil, Copy, Maximize2, Minimize2 } from 'lucide-react';
import { apiJson } from '../services/httpClient';
import { duplicateEpisode as duplicateEpisodeRequest } from '../services/projectWorkflowService';
import type { Episode } from '../types';
import { BrandLogo } from '../components/BrandLogo';
import AccountMenu from '../components/AccountMenu';
import { crmConfirm, crmMessage } from '../admin/crmUI';

export const EpisodeHubPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isWideLayout, setIsWideLayout] = useState(() => localStorage.getItem('episode_hub_layout') === 'wide');

  const loadEpisodes = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await apiJson<any>(`/api/projects/${projectId}/episodes`, {}, '分集列表');
      if (data.success) {
        setEpisodes((data.episodes || []).map((ep: any) => ({
          episodeId: ep.episode_id,
          projectId: ep.project_id,
          episodeNumber: ep.episode_number,
          episodeName: ep.episode_name,
          description: ep.description || '',
          status: ep.status || 'draft',
          settings: ep.settings || {},
          sortOrder: ep.sort_order ?? 0,
          createdAt: ep.created_at,
          updatedAt: ep.updated_at,
        })));
      }
    } catch (e) {
      console.error('Failed to load episodes:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadEpisodes(); }, [loadEpisodes]);

  const toggleLayoutWidth = useCallback(() => {
    setIsWideLayout(prev => {
      const next = !prev;
      localStorage.setItem('episode_hub_layout', next ? 'wide' : 'narrow');
      return next;
    });
  }, []);

  const createEpisode = async () => {
    if (!newTitle.trim() || !projectId) return;
    try {
      const data = await apiJson<any>(`/api/projects/${projectId}/episodes`, {
        method: 'POST',
        body: JSON.stringify({ episode_name: newTitle })
      }, '创建分集');
      if (data.success) {
        setNewTitle('');
        setShowCreate(false);
        loadEpisodes();
      }
    } catch (e) {
      console.error('Failed to create episode:', e);
    }
  };

  const deleteEpisode = async (episodeId: string) => {
    const episode = episodes.find(item => item.episodeId === episodeId);
    if (!await crmConfirm({
      title: '删除分集',
      message: `确定删除「${episode?.episodeName || '未命名分集'}」？该分集的剧本、分镜和生成结果将一并删除，且不可恢复。`,
      type: 'danger',
      confirmText: '删除分集',
    })) return;
    try {
      const data = await apiJson<any>(`/api/episodes/${episodeId}`, {
        method: 'DELETE',
      }, '删除分集');
      if (data.success) {
        crmMessage.success('分集已删除');
        loadEpisodes();
      }
    } catch (e) {
      console.error('Failed to delete episode:', e);
      crmMessage.error('删除失败，请检查网络');
    }
    setMenuOpen(null);
  };

  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const duplicateEpisode = async (episodeId: string) => {
    setMenuOpen(null);
    if (duplicatingId) return;
    setDuplicatingId(episodeId);
    try {
      const data = await duplicateEpisodeRequest(episodeId);
      if (data.success) {
        await loadEpisodes();
      } else {
        crmMessage.error('复制失败：' + (data.detail || '未知错误'));
      }
    } catch (e) {
      console.error('Failed to duplicate episode:', e);
      crmMessage.error('复制失败，请检查网络');
    } finally {
      setDuplicatingId(null);
    }
  };

  const startRename = (ep: Episode) => {
    setEditingId(ep.episodeId);
    setEditingName(ep.episodeName || '');
    setMenuOpen(null);
  };

  const submitRename = async () => {
    if (!editingId || !editingName.trim()) { setEditingId(null); return; }
    try {
      const data = await apiJson<any>(`/api/episodes/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({ episode_name: editingName.trim() })
      }, '重命名分集');
      if (data.success) loadEpisodes();
    } catch (e) {
      console.error('Failed to rename episode:', e);
    }
    setEditingId(null);
  };

  const goToWorkflow = (episodeId: string) => {
    navigate(`/projects/${projectId}/ep/${episodeId}/workflow/script`);
  };

  const goToCanvas = (episodeId: string) => {
    navigate(`/projects/${projectId}/ep/${episodeId}/canvas`);
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-n30 text-n700',
    in_progress: 'bg-primary-light text-primary',
    completed: 'bg-n30 text-success',
    published: 'bg-g50 text-g400',
  };

  const shellWidthClass = isWideLayout ? 'max-w-none' : 'max-w-[1320px]';
  const episodeGridClass = isWideLayout
    ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5'
    : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5';

  return (
    <div className="layout-safe min-h-screen bg-n20 text-n800" onClick={() => setMenuOpen(null)}>
      <div className={`min-h-screen w-full ${shellWidthClass} mx-auto bg-n0 md:border-x md:border-n40`}>
        <header className="animate-slideDown">
          <div className="flex min-h-[84px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <button
                type="button"
                onClick={() => navigate('/projects')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-n40 bg-n0 text-n300 transition-colors hover:border-n70 hover:text-n800"
                title="返回项目列表"
              >
                <ArrowLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/projects')}
                className="hidden shrink-0 rounded focus:outline-none focus:ring-2 focus:ring-primary/25 sm:block"
                title="MECHA.ONE 项目"
              >
                <BrandLogo className="h-8 w-auto max-w-[156px]" />
              </button>
              <div className="hidden h-8 w-px shrink-0 bg-n40 sm:block" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold tracking-tight text-n800 sm:text-2xl">分集</h1>
                <p className="mt-0.5 text-xs text-n100 lg:hidden">{episodes.length} 个分集</p>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap lg:gap-3">
              <button
                type="button"
                onClick={toggleLayoutWidth}
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-n40 bg-n0 px-3 text-sm text-n300 transition-colors hover:border-n70 hover:text-n800"
                title={isWideLayout ? '切回窄屏' : '切到宽屏'}
              >
                {isWideLayout ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                {isWideLayout ? '窄屏' : '宽屏'}
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex h-10 min-w-[128px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-card transition-all hover:bg-primary-hover hover:shadow-atlas sm:flex-none"
              >
                <Plus size={17} /> 新建分集
              </button>
              <AccountMenu />
            </div>
          </div>

          <div className="flex h-14 items-end border-y border-n40 px-4 sm:px-6 lg:h-16 lg:px-8">
            <div className="relative flex h-full items-center px-2 text-sm font-medium text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary">
              全部分集
              <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-primary-light px-1.5 py-0.5 text-[11px] text-primary">{episodes.length}</span>
            </div>
          </div>
        </header>

        <main className="px-4 py-7 sm:px-6 lg:px-8">
          <div className="mb-5">
            <h2 className="text-xl font-bold tracking-tight text-n800">全部分集</h2>
            <p className="mt-1 text-xs text-n100">每个分集拥有独立生产链路，选择一种方式开始创作</p>
          </div>

          {loading ? (
            <div className={episodeGridClass}>
              {[1, 2, 3, 4].map(item => (
                <div key={item} className="aspect-[4/3] animate-pulse rounded-lg border border-n40 bg-n20" />
              ))}
            </div>
          ) : episodes.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-n40 bg-n10 px-6 text-center text-n100">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-light text-primary">
                <Film className="h-7 w-7" />
              </div>
              <p className="mb-1 text-base font-medium text-n700">暂无分集</p>
              <p className="text-sm">点击「新建分集」开始创作</p>
            </div>
          ) : (
            <div className={episodeGridClass}>
              {episodes.map((ep, idx) => (
                <article
                  key={ep.episodeId}
                  className="group overflow-hidden rounded-lg border border-n40 bg-n0 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-n70 hover:shadow-atlas animate-slideUp"
                  style={{ animationDelay: `${idx * 60}ms` }}
                  onClick={event => event.stopPropagation()}
                >
                  <div className="relative aspect-video overflow-visible bg-gradient-to-br from-n30 via-n20 to-primary-light">
                    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                      <BrandLogo variant="mark" className="h-24 w-24 opacity-[0.08]" alt="" />
                    </div>
                    <div className="absolute left-3 top-3 flex items-center gap-2">
                      <span className="rounded bg-n800/85 px-2 py-1 text-[11px] font-semibold text-white">EP {String(idx + 1).padStart(2, '0')}</span>
                      <span className={`rounded px-2 py-1 text-[11px] font-medium ${statusColors[ep.status] || statusColors.draft}`}>
                        {ep.status === 'draft' ? '草稿' : ep.status === 'in_progress' ? '制作中' : ep.status === 'completed' ? '已完成' : ep.status === 'published' ? '已发布' : ep.status}
                      </span>
                    </div>
                    <div className="absolute right-3 top-3 z-20">
                      <button
                        type="button"
                        aria-label={`${ep.episodeName || '未命名分集'} 更多操作`}
                        onClick={() => setMenuOpen(menuOpen === ep.episodeId ? null : ep.episodeId)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-n40 bg-n0 text-n300 shadow-card transition-colors hover:text-n800"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {menuOpen === ep.episodeId && (
                        <div className="absolute right-0 top-10 z-30 min-w-[132px] overflow-hidden rounded-lg border border-n40 bg-n0 py-1 shadow-bottom animate-scaleIn">
                          <button onClick={() => startRename(ep)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-n700 transition-colors hover:bg-n20">
                            <Pencil size={14} /> 重命名
                          </button>
                          <button
                            onClick={() => duplicateEpisode(ep.episodeId)}
                            disabled={duplicatingId === ep.episodeId}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-n700 transition-colors hover:bg-n20 disabled:opacity-50"
                          >
                            <Copy size={14} /> {duplicatingId === ep.episodeId ? '复制中…' : '复制'}
                          </button>
                          <button onClick={() => deleteEpisode(ep.episodeId)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-r50">
                            <Trash2 size={14} /> 删除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-4">
                    {editingId === ep.episodeId ? (
                      <input
                        value={editingName}
                        onChange={event => setEditingName(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') submitRename(); if (event.key === 'Escape') setEditingId(null); }}
                        onBlur={submitRename}
                        autoFocus
                        className="mb-2 w-full rounded border border-primary bg-n0 px-2 py-1 text-sm font-semibold text-n800 outline-none ring-2 ring-primary/15"
                      />
                    ) : (
                      <h3 className="mb-2 truncate text-sm font-semibold text-n800">{ep.episodeName || '未命名分集'}</h3>
                    )}
                    {ep.description && <p className="mb-3 line-clamp-2 text-xs text-n200">{ep.description}</p>}
                    <div className="mb-4 flex items-center text-xs text-n100">
                      <Clock size={12} className="mr-1" />
                      更新于 {ep.updatedAt ? new Date(ep.updatedAt).toLocaleDateString('zh-CN') : '未编辑'}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => goToWorkflow(ep.episodeId)}
                        className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-b75 bg-primary-light px-2 text-sm font-medium text-primary transition-colors hover:border-primary"
                      >
                        <LayoutList size={15} /> 流程化制作
                      </button>
                      <button
                        onClick={() => goToCanvas(ep.episodeId)}
                        className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-n40 bg-n20 px-2 text-sm font-medium text-success transition-colors hover:border-g200"
                      >
                        <Grid3X3 size={15} /> 自由创作
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      </div>

      {showCreate && (
        <div
          className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-episode-title"
          onClick={() => { setShowCreate(false); setNewTitle(''); }}
        >
          <div className="app-modal-surface w-full max-w-md overflow-hidden" onClick={event => event.stopPropagation()}>
            <div className="app-modal-header">
              <h2 id="create-episode-title" className="text-lg font-semibold text-n800">新建分集</h2>
            </div>
            <div className="app-modal-body">
              <label className="mb-1.5 block text-sm text-n300">分集标题</label>
              <input
                value={newTitle}
                onChange={event => setNewTitle(event.target.value)}
                placeholder="例如：第一集 - 序章"
                className="w-full rounded-lg border border-n40 bg-n0 px-3 py-2.5 text-sm text-n800 outline-none transition-all placeholder:text-n100 focus:border-primary focus:ring-2 focus:ring-primary/20"
                onKeyDown={event => event.key === 'Enter' && createEpisode()}
                autoFocus
              />
              <p className="mt-2 text-xs text-n100">创建后可选择流程化制作或自由创作。</p>
            </div>
            <div className="app-modal-footer">
              <button onClick={() => { setShowCreate(false); setNewTitle(''); }} className="rounded-lg border border-n40 bg-n0 px-4 py-2 text-sm font-medium text-n700 transition-colors hover:bg-n20">
                取消
              </button>
              <button onClick={createEpisode} disabled={!newTitle.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n70">
                创建分集
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
