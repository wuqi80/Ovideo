import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft, LayoutList, Grid3X3, Clock, Film, MoreVertical, Trash2, LogOut, Pencil } from 'lucide-react';
import { getHeaders } from '../services/apiService';
import type { Episode } from '../types';

const API_BASE = '';

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

  const loadEpisodes = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/episodes`, {
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        setEpisodes((data.episodes || []).map((ep: any) => ({
          episodeId: ep.episode_id,
          projectId: ep.project_id,
          episodeNumber: ep.episode_number,
          episodeName: ep.episode_name,
          title: ep.episode_name,
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

  const createEpisode = async () => {
    if (!newTitle.trim() || !projectId) return;
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/episodes`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ episode_name: newTitle })
      });
      const data = await res.json();
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
      const res = await fetch(`${API_BASE}/api/episodes/${episodeId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) loadEpisodes();
    } catch (e) {
      console.error('Failed to delete episode:', e);
    }
    setMenuOpen(null);
  };

  const startRename = (ep: Episode) => {
    setEditingId(ep.episodeId);
    setEditingName(ep.title || ep.episodeName || '');
    setMenuOpen(null);
  };

  const submitRename = async () => {
    if (!editingId || !editingName.trim()) { setEditingId(null); return; }
    try {
      const res = await fetch(`${API_BASE}/api/episodes/${editingId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ episode_name: editingName.trim() })
      });
      const data = await res.json();
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
    draft: 'bg-gray-700 text-gray-300',
    'in-progress': 'bg-indigo-900/50 text-indigo-300',
    completed: 'bg-emerald-900/50 text-emerald-300',
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-slideDown">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/projects')}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-all duration-200"
              title="返回项目列表"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">分集管理</h1>
              <p className="text-sm text-gray-500 mt-0.5">{episodes.length} 个分集 · {localStorage.getItem('username') || '未登录'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all duration-200 shadow-lg shadow-indigo-600/20 hover:shadow-indigo-500/30"
          >
            <Plus size={18} /> 新建分集
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('auth_token');
              localStorage.removeItem('username');
              window.location.href = '/login';
            }}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:text-red-400 hover:bg-red-600/10 border border-gray-700 hover:border-red-800 transition-all duration-200"
            title="退出登录"
          >
            <LogOut size={16} /> 退出
          </button>
          </div>
        </div>

        {/* Create Panel */}
        {showCreate && (
          <div className="bg-gray-900 rounded-xl p-5 mb-6 border border-indigo-500/20 animate-slideUp">
            <label className="block text-sm font-medium text-gray-300 mb-2">分集标题</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="例如：第一集 - 序章"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              onKeyDown={(e) => e.key === 'Enter' && createEpisode()}
              autoFocus
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={createEpisode}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                创建
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewTitle(''); }}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Episode Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <div className="w-8 h-8 border-2 border-gray-700 border-t-indigo-500 rounded-full animate-spin mb-4" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : episodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Film size={48} className="mb-4 text-gray-700" />
            <p className="text-lg font-medium text-gray-400 mb-2">暂无分集</p>
            <p className="text-sm">点击上方「新建分集」开始创作</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {episodes.map((ep, idx) => (
              <div
                key={ep.episodeId}
                className="group bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-600 transition-all duration-300 overflow-hidden animate-slideUp"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <div className="p-5">
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                          #{(ep.sortOrder ?? 0) + 1}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${statusColors[ep.status] || statusColors.draft}`}>
                          {ep.status === 'draft' ? '草稿' : ep.status === 'in-progress' ? '制作中' : ep.status === 'completed' ? '已完成' : ep.status}
                        </span>
                      </div>
                      {editingId === ep.episodeId ? (
                        <input
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setEditingId(null); }}
                          onBlur={submitRename}
                          autoFocus
                          className="w-full text-base font-semibold text-white bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 focus:outline-none"
                        />
                      ) : (
                        <h3 className="text-base font-semibold text-white truncate">{ep.title || '未命名分集'}</h3>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === ep.episodeId ? null : ep.episodeId)}
                        className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {menuOpen === ep.episodeId && (
                        <div className="absolute right-0 top-8 z-10 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[120px] animate-scaleIn">
                          <button
                            onClick={() => startRename(ep)}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                          >
                            <Pencil size={14} /> 重命名
                          </button>
                          <button
                            onClick={() => deleteEpisode(ep.episodeId)}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                          >
                            <Trash2 size={14} /> 删除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {ep.description && (
                    <p className="text-sm text-gray-500 mb-3 line-clamp-2">{ep.description}</p>
                  )}

                  <div className="flex items-center text-xs text-gray-600 mb-4">
                    <Clock size={12} className="mr-1" />
                    {ep.updatedAt ? new Date(ep.updatedAt).toLocaleDateString('zh-CN') : '未编辑'}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => goToWorkflow(ep.episodeId)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-600/20 hover:border-indigo-500/40 transition-all duration-200"
                    >
                      <LayoutList size={15} /> 流程化制作
                    </button>
                    <button
                      onClick={() => goToCanvas(ep.episodeId)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-600/20 hover:border-emerald-500/40 transition-all duration-200"
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
