import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Archive, Trash2, Users, Clock, Tag, FolderOpen, MoreVertical, Star, ChevronDown, Share2 } from 'lucide-react';
import { getHeaders } from '../services/apiService';
import { useCurrentOrgId, useWorkspace } from '../contexts/WorkspaceContext';
import ShareResourceDialog from './ShareResourceDialog';
import { createShare } from '../services/shareService';
import type { ProjectInfo } from '../types';
import { crmMessage, crmConfirm } from '../admin/crmUI';

const API_BASE = '';

type SortKey = 'updated' | 'created' | 'name';

const ProjectHub: React.FC = () => {
    const navigate = useNavigate();
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [sortBy, setSortBy] = useState<SortKey>('updated');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDesc, setNewProjectDesc] = useState('');
    const [contextMenu, setContextMenu] = useState<{ projectId: string; x: number; y: number; isArchived?: boolean } | null>(null);

    // 2026-05-26 组织管理 MVP — workspace 联动 + share dialog 状态
    const orgId = useCurrentOrgId();
    const { isOrgWorkspace, currentName } = useWorkspace();
    const [shareTarget, setShareTarget] = useState<ProjectInfo | null>(null);

    // 2026-05-26 组织管理 MVP — Slice 5: 创建项目时的 visibility
    // org workspace 默认 'org-default'，personal workspace 默认 'private'
    const [newProjectVisibility, setNewProjectVisibility] = useState<'private' | 'org-default'>('private');
    useEffect(() => {
        setNewProjectVisibility(isOrgWorkspace ? 'org-default' : 'private');
    }, [isOrgWorkspace, showCreateModal]);

    const loadProjects = useCallback(async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams({ include_archived: String(showArchived) });
            if (orgId) qs.set('org_id', orgId);
            const res = await fetch(`${API_BASE}/api/projects?${qs.toString()}`, {
                headers: getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                setProjects(data.projects.map((p: any) => ({
                    projectId: p.project_id,
                    projectName: p.project_name,
                    description: p.description || '',
                    coverUrl: p.cover_url,
                    tags: typeof p.tags === 'string' ? JSON.parse(p.tags || '[]') : (p.tags || []),
                    ownerId: p.user_id,
                    ownerName: p.owner_name || p.user_id,
                    memberCount: p.member_count || 1,
                    isArchived: p.is_archived,
                    createdAt: new Date(p.created_at).getTime(),
                    updatedAt: new Date(p.updated_at).getTime(),
                    lastAccessedAt: p.last_accessed_at ? new Date(p.last_accessed_at).getTime() : undefined,
                    memberRole: p.member_role,
                    visibility: p.visibility,
                    groupId: p.group_id,
                    episodeCount: typeof p.episode_count === 'number' ? p.episode_count : Number(p.episode_count || 0),
                })));
            }
        } catch (e) {
            console.error('加载项目列表失败:', e);
        } finally {
            setLoading(false);
        }
    }, [showArchived, orgId]);

    useEffect(() => { loadProjects(); }, [loadProjects]);

    const filteredProjects = useMemo(() => {
        let list = projects;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(p =>
                p.projectName.toLowerCase().includes(q) ||
                p.description.toLowerCase().includes(q) ||
                p.tags.some(t => t.toLowerCase().includes(q))
            );
        }
        list.sort((a, b) => {
            if (sortBy === 'name') return a.projectName.localeCompare(b.projectName);
            if (sortBy === 'created') return b.createdAt - a.createdAt;
            return b.updatedAt - a.updatedAt;
        });
        return list;
    }, [projects, searchQuery, sortBy]);

    const handleCreate = async () => {
        if (!newProjectName.trim()) return;
        try {
            const res = await fetch(`${API_BASE}/api/projects`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({
                    project_name: newProjectName,
                    description: newProjectDesc,
                    visibility: newProjectVisibility,
                })
            });
            const data = await res.json();
            if (data.success) {
                const createdProjectId = data.project?.project_id;
                // 2026-05-26 组织管理 MVP — Slice 5
                //   visibility='org-default' + org workspace → 自动 share 给当前组织
                if (createdProjectId && newProjectVisibility === 'org-default' && orgId) {
                    try {
                        await createShare({
                            resource_type: 'project',
                            resource_id: createdProjectId,
                            share_target_type: 'org',
                            share_target_id: orgId,
                        });
                    } catch (e) {
                        console.warn('自动共享给组织失败：', e);
                    }
                }
                setShowCreateModal(false);
                setNewProjectName('');
                setNewProjectDesc('');
                navigate(`/projects/${createdProjectId}`);
            }
        } catch (e) {
            console.error('创建项目失败:', e);
        }
    };

    const handleDelete = async (projectId: string) => {
        setContextMenu(null);
        // 删除确认显示项目名 + 集数；有内容时强警告，避免误删真实项目（曾因卡片同名误删）
        const proj = projects.find(p => p.projectId === projectId);
        const epCount = proj?.episodeCount ?? 0;
        const name = proj?.projectName || projectId;
        const message = epCount > 0
            ? `⚠️ 项目「${name}」含 ${epCount} 集内容！\n\n删除将永久移除该项目的所有集、分镜、视频段，且不可恢复。\n\n确定要删除这个有内容的项目吗？`
            : `确定删除空项目「${name}」？（无集内容）此操作不可撤销。`;
        if (!await crmConfirm({ title: epCount > 0 ? '⚠️ 删除有内容的项目' : '删除空项目', message, type: 'danger', confirmText: epCount > 0 ? `仍要删除（含${epCount}集）` : '删除' })) return;
        try {
            await fetch(`${API_BASE}/api/projects/${projectId}`, {
                method: 'DELETE',
                headers: getHeaders()
            });
            crmMessage.success('已删除');
            loadProjects();
        } catch (e) {
            console.error('删除失败:', e);
            crmMessage.error('删除失败，请检查网络');
        }
    };

    const handleArchive = async (projectId: string) => {
        setContextMenu(null);
        try {
            const res = await fetch(`${API_BASE}/api/projects/${projectId}/archive`, {
                method: 'POST',
                headers: getHeaders()
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                crmMessage.error(`归档失败: ${err.detail || res.statusText}`);
                return;
            }
            crmMessage.success('已归档');
            loadProjects();
        } catch (e) {
            console.error('归档失败:', e);
            crmMessage.error('归档请求失败，请检查网络');
        }
    };

    const handleUnarchive = async (projectId: string) => {
        setContextMenu(null);
        try {
            const res = await fetch(`${API_BASE}/api/projects/${projectId}/unarchive`, {
                method: 'POST',
                headers: getHeaders()
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                crmMessage.error(`取消归档失败: ${err.detail || res.statusText}`);
                return;
            }
            crmMessage.success('已取消归档');
            loadProjects();
        } catch (e) {
            console.error('取消归档失败:', e);
            crmMessage.error('请求失败，请检查网络');
        }
    };

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        const now = Date.now();
        const diff = now - ts;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
        return d.toLocaleDateString('zh-CN');
    };

    // refactor/v2 (P1 旗舰)：项目中心整体换肤为 Atlassian 企业级浅色。
    // 逻辑/状态/handler 全部不变，仅替换样式（暗 gray/purple → 浅 n色阶/primary）。
    return (
        <div className="layout-safe h-screen bg-n20 text-n800 flex flex-col" onClick={() => setContextMenu(null)}>
            {/* 顶部栏 */}
            <header className="responsive-toolbar bg-n0 border-b border-n40 shadow-card flex items-center px-6 justify-between flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <FolderOpen className="w-5 h-5 text-primary" />
                    <h1 className="text-lg font-semibold text-n800">项目管理</h1>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm text-n300">
                        {localStorage.getItem('username') || ''}
                    </span>
                    <button
                        onClick={() => {
                            localStorage.removeItem('auth_token');
                            localStorage.removeItem('username');
                            window.location.href = '/login';
                        }}
                        className="text-sm text-n200 hover:text-danger transition-colors"
                    >
                        退出
                    </button>
                </div>
            </header>

            {/* 工具栏 */}
            <div className="responsive-toolbar px-6 py-4 flex items-center gap-4 border-b border-n40 bg-n0">
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded text-sm font-medium transition-colors shadow-card"
                >
                    <Plus className="w-4 h-4" /> 新建项目
                </button>

                <div className="flex-1 relative max-w-md min-w-[220px]">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-n100" />
                    <input
                        type="text"
                        placeholder="搜索项目名称、描述或标签..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                    />
                </div>

                <div className="flex items-center gap-2 text-sm min-w-0">
                    <span className="text-n200">排序:</span>
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as SortKey)}
                        className="bg-n0 border border-n40 rounded px-2 py-1.5 text-sm text-n800 focus:outline-none focus:border-primary"
                    >
                        <option value="updated">最近更新</option>
                        <option value="created">创建时间</option>
                        <option value="name">名称</option>
                    </select>
                </div>

                <label className="flex items-center gap-2 text-sm text-n300 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={e => setShowArchived(e.target.checked)}
                        className="rounded accent-primary"
                    />
                    显示已归档
                </label>
            </div>

            {/* 项目列表 */}
            <div className="layout-safe flex-1 overflow-auto p-6 scrollbar-atlas">
                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-48 bg-n30 rounded-md animate-pulse" />
                        ))}
                    </div>
                ) : filteredProjects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-n100">
                        <FolderOpen className="w-16 h-16 mb-4 opacity-30" />
                        <p className="text-lg mb-2 text-n300">
                            {searchQuery ? '未找到匹配的项目' : '还没有项目'}
                        </p>
                        <p className="text-sm">
                            {searchQuery ? '尝试其他搜索词' : '点击「新建项目」开始创作'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredProjects.map(p => (
                            <div
                                key={p.projectId}
                                className={`group relative bg-n0 border border-n40 hover:border-primary shadow-card hover:shadow-atlas rounded-md p-4 cursor-pointer transition-all ${p.isArchived ? 'opacity-60' : ''}`}
                                onClick={() => navigate(`/projects/${p.projectId}`)}
                            >
                                {/* 封面区域 */}
                                <div className="h-24 bg-gradient-to-br from-primary-light to-p50 rounded mb-3 flex items-center justify-center overflow-hidden">
                                    {p.coverUrl ? (
                                        <img src={p.coverUrl} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <FolderOpen className="w-10 h-10 text-n50" />
                                    )}
                                </div>

                                {/* 项目信息 */}
                                <h3 className="font-medium text-sm truncate mb-1 flex items-center gap-1.5 text-n800">
                                    <span className="truncate">{p.projectName}</span>
                                    {/* 内容标识：一眼区分"有内容"和"空项目"，避免误删 */}
                                    {(p.episodeCount ?? 0) > 0 ? (
                                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300 font-semibold">
                                            {p.episodeCount} 集
                                        </span>
                                    ) : (
                                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-n30 text-n200 border border-n40">
                                            空
                                        </span>
                                    )}
                                    {/* 2026-05-26 组织管理 MVP — Slice 5: visibility badge */}
                                    {p.visibility && p.visibility !== 'private' && (
                                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-b50 text-b400 border border-b75">
                                            🌐 组
                                        </span>
                                    )}
                                </h3>
                                {p.description && (
                                    <p className="text-xs text-n200 truncate mb-2">{p.description}</p>
                                )}

                                {/* 标签 */}
                                {p.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-2">
                                        {p.tags.slice(0, 3).map(t => (
                                            <span key={t} className="text-[10px] px-1.5 py-0.5 bg-n30 text-n300 rounded">
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* 底部元信息 */}
                                <div className="flex items-center justify-between text-xs text-n100 mt-auto">
                                    <div className="flex items-center gap-1">
                                        <Users className="w-3 h-3" />
                                        <span>{p.memberCount}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        <span>{formatTime(p.updatedAt)}</span>
                                    </div>
                                </div>

                                {/* 右上角菜单 */}
                                <button
                                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-n20 transition-all"
                                    onClick={e => {
                                        e.stopPropagation();
                                        setContextMenu({ projectId: p.projectId, x: e.clientX, y: e.clientY, isArchived: p.isArchived });
                                    }}
                                >
                                    <MoreVertical className="w-4 h-4 text-n200" />
                                </button>

                                {p.isArchived && (
                                    <div className="absolute top-3 left-3">
                                        <Archive className="w-4 h-4 text-warning" />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 右键菜单 */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-n0 border border-n40 rounded-md shadow-bottom py-1 min-w-[140px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={e => e.stopPropagation()}
                >
                    {contextMenu.isArchived ? (
                    <button
                        className="w-full px-4 py-2 text-left text-sm hover:bg-n20 flex items-center gap-2 text-success"
                        onClick={() => handleUnarchive(contextMenu.projectId)}
                    >
                        <Archive className="w-4 h-4" /> 取消归档
                    </button>
                    ) : (
                    <button
                        className="w-full px-4 py-2 text-left text-sm hover:bg-n20 flex items-center gap-2 text-n700"
                        onClick={() => handleArchive(contextMenu.projectId)}
                    >
                        <Archive className="w-4 h-4" /> 归档
                    </button>
                    )}
                    <button
                        className="w-full px-4 py-2 text-left text-sm hover:bg-n20 flex items-center gap-2 text-primary"
                        onClick={() => {
                            const proj = projects.find(p => p.projectId === contextMenu.projectId);
                            if (proj) setShareTarget(proj);
                            setContextMenu(null);
                        }}
                    >
                        <Share2 className="w-4 h-4" /> 共享…
                    </button>
                    <button
                        className="w-full px-4 py-2 text-left text-sm hover:bg-r50 flex items-center gap-2 text-danger"
                        onClick={() => handleDelete(contextMenu.projectId)}
                    >
                        <Trash2 className="w-4 h-4" /> 删除
                    </button>
                </div>
            )}

            {shareTarget && (
                <ShareResourceDialog
                    resourceType="project"
                    resourceId={shareTarget.projectId}
                    resourceName={shareTarget.projectName}
                    onClose={() => setShareTarget(null)}
                    onChange={() => { loadProjects(); }}
                />
            )}

            {/* 新建项目弹窗 */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-n900/50 flex items-center justify-center z-50 animate-fadeIn" onClick={() => setShowCreateModal(false)}>
                    <div className="bg-n0 rounded-md p-6 w-full max-w-md border border-n40 shadow-bottom animate-scaleIn" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-semibold mb-4 text-n800">新建项目</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-n300 mb-1">项目名称</label>
                                <input
                                    type="text"
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    placeholder="输入项目名称"
                                    className="w-full px-3 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                                    autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-n300 mb-1">项目描述（可选）</label>
                                <textarea
                                    value={newProjectDesc}
                                    onChange={e => setNewProjectDesc(e.target.value)}
                                    placeholder="简要描述项目内容"
                                    rows={3}
                                    className="w-full px-3 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none transition-colors"
                                />
                            </div>
                            {/* 2026-05-26 组织管理 MVP — Slice 5: visibility radio */}
                            <div>
                                <label className="block text-sm text-n300 mb-1.5">可见性</label>
                                <div className="space-y-1.5">
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input
                                            type="radio"
                                            checked={newProjectVisibility === 'private'}
                                            onChange={() => setNewProjectVisibility('private')}
                                            className="accent-primary"
                                        />
                                        <span className="text-n700">🔒 私有</span>
                                        <span className="text-xs text-n100">— 仅我可见</span>
                                    </label>
                                    <label className={`flex items-center gap-2 text-sm cursor-pointer ${!isOrgWorkspace ? 'opacity-50' : ''}`}>
                                        <input
                                            type="radio"
                                            checked={newProjectVisibility === 'org-default'}
                                            onChange={() => setNewProjectVisibility('org-default')}
                                            disabled={!isOrgWorkspace}
                                            className="accent-primary"
                                        />
                                        <span className="text-n700">🌐 对组可见</span>
                                        <span className="text-xs text-n100">
                                            {isOrgWorkspace ? `— 自动共享给「${currentName}」` : '— 切到组织 workspace 才能用'}
                                        </span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="px-4 py-2 text-sm text-n300 hover:text-n800 hover:bg-n20 rounded transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!newProjectName.trim()}
                                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
                            >
                                创建
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectHub;
