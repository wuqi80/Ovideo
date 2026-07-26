import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Archive, Trash2, Users, Clock, FolderOpen, MoreVertical, Share2, Maximize2, Minimize2, LogOut } from 'lucide-react';
import { apiJson } from '../services/httpClient';
import { useCurrentOrgId, useWorkspace } from '../contexts/WorkspaceContext';
import ShareResourceDialog from './ShareResourceDialog';
import { createShare } from '../services/shareService';
import type { ProjectInfo } from '../types';
import { crmMessage, crmConfirm } from '../admin/crmUI';
import { BrandLogo } from './BrandLogo';

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
    const [newProjectMembers, setNewProjectMembers] = useState('');
    const [contextMenu, setContextMenu] = useState<{ projectId: string; x: number; y: number; isArchived?: boolean } | null>(null);
    const [isWideLayout, setIsWideLayout] = useState(() => localStorage.getItem('project_hub_layout') === 'wide');

    // 2026-05-26 组织管理 MVP — workspace 联动 + share dialog 状态
    const orgId = useCurrentOrgId();
    const { isOrgWorkspace, currentName } = useWorkspace();
    const [shareTarget, setShareTarget] = useState<ProjectInfo | null>(null);

    // 新项目始终默认私有；需要协作时由创建者明确添加成员或共享给组织。
    const [newProjectVisibility, setNewProjectVisibility] = useState<'private' | 'org-default'>('private');
    useEffect(() => {
        setNewProjectVisibility('private');
    }, [showCreateModal]);

    const toggleLayoutWidth = useCallback(() => {
        setIsWideLayout(prev => {
            const next = !prev;
            localStorage.setItem('project_hub_layout', next ? 'wide' : 'narrow');
            return next;
        });
    }, []);

    const loadProjects = useCallback(async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams({ include_archived: String(showArchived) });
            if (orgId) qs.set('org_id', orgId);
            const data = await apiJson<any>(`/api/projects?${qs.toString()}`, {}, '项目列表');
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
            const data = await apiJson<any>('/api/projects', {
                method: 'POST',
                body: JSON.stringify({
                    project_name: newProjectName,
                    description: newProjectDesc,
                    visibility: newProjectVisibility,
                    member_usernames: newProjectMembers
                        .split(/[\s,，;；]+/)
                        .map(value => value.trim())
                        .filter(Boolean),
                })
            }, '创建项目');
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
                setNewProjectMembers('');
                const missingMembers = data.member_additions?.missing_usernames || [];
                if (missingMembers.length > 0) {
                    crmMessage.warning(`项目已创建，以下成员未找到：${missingMembers.join('、')}`);
                }
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
            await apiJson(`/api/projects/${projectId}`, {
                method: 'DELETE',
            }, '删除项目');
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
            await apiJson(`/api/projects/${projectId}/archive`, {
                method: 'POST',
            }, '归档项目');
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
            await apiJson(`/api/projects/${projectId}/unarchive`, {
                method: 'POST',
            }, '取消归档项目');
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

    // 项目中心只调整表现层；查询、组织共享、归档与删除链路保持原样。
    const shellWidthClass = isWideLayout ? 'max-w-none' : 'max-w-[1320px]';
    const projectGridClass = isWideLayout
        ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5'
        : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5';
    const currentUsername = localStorage.getItem('username') || '未登录';

    return (
        <div className="layout-safe min-h-screen bg-n20 text-n800" onClick={() => setContextMenu(null)}>
            <div className={`min-h-screen w-full ${shellWidthClass} mx-auto bg-n0 md:border-x md:border-n40`}>
                <header className="animate-slideDown">
                    <div className="flex min-h-[84px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
                        <div className="flex min-w-0 items-center gap-4">
                            <button
                                type="button"
                                onClick={() => navigate('/projects')}
                                className="shrink-0 rounded focus:outline-none focus:ring-2 focus:ring-primary/25"
                                title="MECHA.ONE 项目"
                            >
                                <BrandLogo className="h-8 w-auto max-w-[156px]" />
                            </button>
                            <div className="h-8 w-px shrink-0 bg-n40" />
                            <div className="min-w-0">
                                <h1 className="truncate text-xl font-bold tracking-tight text-n800 sm:text-2xl">项目</h1>
                                <p className="mt-0.5 text-xs text-n100 lg:hidden">{filteredProjects.length} 个项目</p>
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
                            onClick={() => setShowCreateModal(true)}
                            className="inline-flex h-10 min-w-[128px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-card transition-all hover:bg-primary-hover hover:shadow-atlas sm:flex-none"
                        >
                            <Plus size={17} /> 新建项目
                        </button>
                        <span className="hidden max-w-[140px] truncate text-sm text-n300 xl:block" title={currentUsername}>
                            {currentUsername}
                        </span>
                        <button
                            onClick={() => {
                                localStorage.removeItem('auth_token');
                                localStorage.removeItem('username');
                                window.location.href = '/login';
                            }}
                            className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-n40 px-3 text-sm text-n100 transition-colors hover:border-r75 hover:bg-r50 hover:text-danger"
                            title="退出登录"
                        >
                            <LogOut size={15} /> <span className="hidden sm:inline">退出</span>
                        </button>
                        </div>
                    </div>
                    <div className="flex flex-col gap-3 border-y border-n40 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:py-0 lg:px-8">
                        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                            <button
                                type="button"
                                onClick={() => setShowArchived(false)}
                                className={`relative h-12 shrink-0 px-1.5 text-sm transition-colors md:h-16 md:px-2 ${
                                    !showArchived ? 'font-medium text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-n300 hover:text-n800'
                                }`}
                            >
                                全部项目 <span className="ml-1 text-xs text-n100">{!showArchived ? filteredProjects.length : ''}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowArchived(true)}
                                className={`relative h-12 shrink-0 px-3 text-sm transition-colors md:h-16 ${
                                    showArchived ? 'font-medium text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-n300 hover:text-n800'
                                }`}
                            >
                                含已归档
                            </button>
                            <div className="ml-2 flex shrink-0 items-center gap-2 border-l border-n40 pl-3 text-sm">
                                <span className="text-n100">排序</span>
                                <select
                                    value={sortBy}
                                    onChange={e => setSortBy(e.target.value as SortKey)}
                                    className="h-9 rounded border border-n40 bg-n0 px-2 text-sm text-n700 outline-none transition-colors focus:border-primary"
                                >
                                    <option value="updated">最近更新</option>
                                    <option value="created">创建时间</option>
                                    <option value="name">名称</option>
                                </select>
                            </div>
                        </div>
                        <div className="relative w-full md:w-80">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-n100" />
                            <input
                                type="search"
                                placeholder="搜索项目"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="h-10 w-full rounded-lg border border-n40 bg-n0 pl-10 pr-4 text-sm text-n800 outline-none transition-all placeholder:text-n100 focus:border-primary focus:ring-2 focus:ring-primary/15"
                            />
                        </div>
                    </div>
                </header>

                <main className="px-4 py-7 sm:px-6 lg:px-8">
                    <div className="mb-5 flex items-end justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-n800">{showArchived ? '全部项目（含归档）' : '全部项目'}</h2>
                            <p className="mt-1 text-xs text-n100">共 {filteredProjects.length} 个项目</p>
                        </div>
                    </div>

                    {loading ? (
                        <div className={projectGridClass}>
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="aspect-[4/3] animate-pulse rounded-lg border border-n40 bg-n20" />
                            ))}
                        </div>
                    ) : filteredProjects.length === 0 ? (
                        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-n40 bg-n10 px-6 text-center text-n100">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-light text-primary">
                                <FolderOpen className="h-7 w-7" />
                            </div>
                            <p className="mb-1 text-base font-medium text-n700">
                                {searchQuery ? '未找到匹配的项目' : '还没有项目'}
                            </p>
                            <p className="text-sm">
                                {searchQuery ? '尝试其他搜索词' : '点击「新建项目」开始创作'}
                            </p>
                        </div>
                    ) : (
                        <div className={projectGridClass}>
                            {filteredProjects.map(p => (
                                <article
                                    key={p.projectId}
                                    className={`group relative cursor-pointer overflow-hidden rounded-lg border border-n40 bg-n0 shadow-card transition-all hover:-translate-y-0.5 hover:border-n70 hover:shadow-atlas ${p.isArchived ? 'opacity-65' : ''}`}
                                    onClick={() => navigate(`/projects/${p.projectId}`)}
                                >
                                    <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-n30 via-primary-light to-b75">
                                        {p.coverUrl ? (
                                            <img src={p.coverUrl} alt={`${p.projectName} 封面`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                                        ) : (
                                            <div className="flex h-full items-center justify-center">
                                                <BrandLogo variant="mark" className="h-20 w-20 opacity-[0.12]" alt="" />
                                            </div>
                                        )}
                                        {p.isArchived && (
                                            <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded bg-n800/80 px-2 py-1 text-[11px] font-medium text-white">
                                                <Archive className="h-3 w-3" /> 已归档
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            aria-label={`${p.projectName} 更多操作`}
                                            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-n40 bg-n0 text-n300 shadow-card transition-colors hover:text-n800"
                                            onClick={e => {
                                                e.stopPropagation();
                                                setContextMenu({ projectId: p.projectId, x: e.clientX, y: e.clientY, isArchived: p.isArchived });
                                            }}
                                        >
                                            <MoreVertical className="h-4 w-4" />
                                        </button>
                                    </div>

                                    <div className="p-4">
                                        <div className="mb-2 flex min-w-0 items-center gap-1.5">
                                            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-n800">{p.projectName}</h3>
                                            {(p.episodeCount ?? 0) > 0 ? (
                                                <span className="shrink-0 rounded bg-g50 px-1.5 py-0.5 text-[10px] font-semibold text-g400">{p.episodeCount} 集</span>
                                            ) : (
                                                <span className="shrink-0 rounded bg-n30 px-1.5 py-0.5 text-[10px] text-n200">空项目</span>
                                            )}
                                            {p.visibility && p.visibility !== 'private' && (
                                                <span className="shrink-0 rounded bg-b50 px-1.5 py-0.5 text-[10px] text-b400">组织</span>
                                            )}
                                        </div>
                                        <p className="mb-3 min-h-4 truncate text-xs text-n200">{p.description || '暂无项目描述'}</p>
                                        {p.tags.length > 0 && (
                                            <div className="mb-3 flex flex-wrap gap-1">
                                                {p.tags.slice(0, 3).map(t => (
                                                    <span key={t} className="rounded bg-n20 px-1.5 py-0.5 text-[10px] text-n300">{t}</span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between gap-3 border-t border-n30 pt-3 text-xs text-n100">
                                            <span className="flex min-w-0 items-center gap-1">
                                                <Users className="h-3 w-3 shrink-0" /> {p.memberCount} 位成员
                                            </span>
                                            <span className="flex shrink-0 items-center gap-1">
                                                <Clock className="h-3 w-3" /> {formatTime(p.updatedAt)}
                                            </span>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </main>
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
                <div
                    className="app-modal-backdrop fixed inset-0 flex items-center justify-center z-50 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="create-project-title"
                    onClick={() => setShowCreateModal(false)}
                >
                    <div className="app-modal-surface w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="app-modal-header">
                            <h2 id="create-project-title" className="text-lg font-semibold text-n800">新建项目</h2>
                        </div>
                        <div className="app-modal-body space-y-4">
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
                            <div>
                                <label className="block text-sm text-n300 mb-1">项目成员（可选）</label>
                                <textarea
                                    value={newProjectMembers}
                                    onChange={e => setNewProjectMembers(e.target.value)}
                                    placeholder="输入平台用户名，多个成员用逗号或换行分隔"
                                    rows={2}
                                    className="w-full px-3 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none transition-colors"
                                />
                                <p className="mt-1 text-xs text-n100">成员将获得项目访问权限；移除成员不会删除其已创建的内容。</p>
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
                        <div className="app-modal-footer">
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
