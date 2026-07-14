import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft, LayoutList, Grid3X3, Clock, Film, MoreVertical, Trash2, LogOut, Pencil, Copy, Maximize2, Minimize2 } from 'lucide-react';
import { apiJson } from '../services/httpClient';
import { duplicateEpisode as duplicateEpisodeRequest } from '../services/projectWorkflowService';
import type { Episode } from '../types';

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
    if (!confirm('确定要删除此分集吗？')) return;
    try {
      const data = await apiJson<any>(`/api/episodes/${episodeId}`, {
        method: 'DELETE',
      }, '删除分集');
      if (data.success) loadEpisodes();
    } catch (e) {
      console.error('Failed to delete episode:', e);
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
        alert('复制失败：' + (data.detail || '未知错误'));
      }
    } catch (e) {
      console.error('Failed to duplicate episode:', e);
      alert('复制失败，请检查网络');
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

  const shellWidthClass = isWideLayout ? 'max-w-none' : 'max-w-6xl';
  const episodeGridClass = isWideLayout
    ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4'
    : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';

  return (
    <div className="min-h-screen bg-n20 p-6 md:p-10">
      <div className={`w-full ${shellWidthClass} mx-auto`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-slideDown">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/projects')}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-n0 border border-n40 text-n300 hover:text-n800 hover:border-n40 transition-all duration-200"
              title="返回项目列表"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-n800 tracking-tight">分集管理</h1>
              <p className="text-sm text-n100 mt-0.5">{episodes.length} 个分集 · {localStorage.getItem('username') || '未登录'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleLayoutWidth}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-n300 hover:text-n800 hover:bg-n0 border border-n40 hover:border-primary transition-all duration-200"
            title={isWideLayout ? '切回窄屏' : '切到宽屏'}
          >
            {isWideLayout ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {isWideLayout ? '窄屏' : '宽屏'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-semibold transition-all duration-200 shadow-card hover:shadow-atlas"
          >
            <Plus size={18} /> 新建分集
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('auth_token');
              localStorage.removeItem('username');
              window.location.href = '/login';
            }}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-n100 hover:text-danger hover:bg-r50 border border-n40 hover:border-n40 transition-all duration-200"
            title="退出登录"
          >
            <LogOut size={16} /> 退出
          </button>
          </div>
        </div>

        {/* Create Panel */}
        {showCreate && (
          <div className="bg-n0 rounded-md p-5 mb-6 border border-n40 shadow-card animate-slideUp">
            <label className="block text-sm font-medium text-n700 mb-2">分集标题</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="例如：第一集 - 序章"
              className="w-full px-4 py-2.5 bg-n0 border border-n40 rounded-lg text-n800 placeholder:text-n100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              onKeyDown={(e) => e.key === 'Enter' && createEpisode()}
              autoFocus
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={createEpisode}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
              >
                创建
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewTitle(''); }}
                className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded-lg text-sm font-medium transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Episode Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-n100">
            <div className="w-8 h-8 border-2 border-n40 border-t-primary rounded-full animate-spin mb-4" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : episodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-n100">
            <Film size={48} className="mb-4 text-n100" />
            <p className="text-lg font-medium text-n300 mb-2">暂无分集</p>
            <p className="text-sm">点击上方「新建分集」开始创作</p>
          </div>
        ) : (
          <div className={episodeGridClass}>
            {episodes.map((ep, idx) => (
              <div
                key={ep.episodeId}
                className="group bg-n0 rounded-md border border-n40 hover:border-n40 shadow-card hover:shadow-atlas transition-all duration-300 overflow-hidden animate-slideUp"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <div className="p-5">
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-primary bg-primary-light px-2 py-0.5 rounded">
                          #{idx + 1}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${statusColors[ep.status] || statusColors.draft}`}>
                          {ep.status === 'draft' ? '草稿' : ep.status === 'in_progress' ? '制作中' : ep.status === 'completed' ? '已完成' : ep.status === 'published' ? '已发布' : ep.status}
                        </span>
                      </div>
                      {editingId === ep.episodeId ? (
                        <input
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setEditingId(null); }}
                          onBlur={submitRename}
                          autoFocus
                          className="w-full text-base font-semibold text-n800 bg-n0 border border-primary rounded px-2 py-0.5 focus:outline-none"
                        />
                      ) : (
                        <h3 className="text-base font-semibold text-n800 truncate">{ep.episodeName || '未命名分集'}</h3>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === ep.episodeId ? null : ep.episodeId)}
                        className="p-1 rounded text-n100 hover:text-n700 hover:bg-n20 transition-colors"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {menuOpen === ep.episodeId && (
                        <div className="absolute right-0 top-8 z-10 bg-n0 border border-n40 rounded-lg shadow-bottom py-1 min-w-[120px] animate-scaleIn">
                          <button
                            onClick={() => startRename(ep)}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-n700 hover:bg-n20 transition-colors"
                          >
                            <Pencil size={14} /> 重命名
                          </button>
                          <button
                            onClick={() => duplicateEpisode(ep.episodeId)}
                            disabled={duplicatingId === ep.episodeId}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-n700 hover:bg-n20 transition-colors disabled:opacity-50"
                          >
                            <Copy size={14} /> {duplicatingId === ep.episodeId ? '复制中…' : '复制'}
                          </button>
                          <button
                            onClick={() => deleteEpisode(ep.episodeId)}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-danger hover:bg-r50 transition-colors"
                          >
                            <Trash2 size={14} /> 删除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {ep.description && (
                    <p className="text-sm text-n100 mb-3 line-clamp-2">{ep.description}</p>
                  )}

                  <div className="flex items-center text-xs text-n100 mb-4">
                    <Clock size={12} className="mr-1" />
                    {ep.updatedAt ? new Date(ep.updatedAt).toLocaleDateString('zh-CN') : '未编辑'}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => goToWorkflow(ep.episodeId)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium bg-primary-light text-primary border border-primary/20 hover:bg-primary-light hover:border-primary transition-all duration-200"
                    >
                      <LayoutList size={15} /> 流程化制作
                    </button>
                    <button
                      onClick={() => goToCanvas(ep.episodeId)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium bg-n30 text-success border border-n40 hover:bg-n30 hover:border-n40 transition-all duration-200"
                    >
                      <Grid3X3 size={15} /> 自由创作
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
