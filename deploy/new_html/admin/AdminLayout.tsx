/**
 * AdminLayout.tsx — 统一后台 Shell（refactor/v2）
 *
 * 一个台子、一套层级菜单。左侧 AdminSidebar 提供 一级/二级/三级 折叠菜单（始终在场），
 * 右侧只换内容区——彻底消除「在多个后台之间跳动」的割裂感。
 *
 * 路由（由 App.tsx 提供）：
 *   /admin               → 运营概览 (AdminDashboard)
 *   /admin/operations    → AdminPage（embedTab 由 ?tab 决定：users/stats/results/system）
 *   /admin/features      → AdminFeatureTabs（embedTab 由 ?tab 决定：accounts/groups/...）
 *   /admin/settings      → AdminSettingsPage（?item 决定：apiconfig/cluster/workflows/... 内嵌 legacy）
 *   /admin/login         → AdminLoginPage（独立，不被本 Shell 包裹）
 */

import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAdminToken, getAdminUsername, clearAdminSession, isAdminWhitelisted } from './adminAuth';
import { AdminSidebar } from './AdminSidebar';
import { getActiveTrail } from './adminMenu';

export const AdminLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [now, setNow] = useState(() => new Date());

    // 鉴权门：未登录后台或非白名单 → 跳 /admin/login
    useEffect(() => {
        const token = getAdminToken();
        const username = getAdminUsername();
        if (!token || !isAdminWhitelisted(username)) {
            const from = `${location.pathname}${location.search}${location.hash}`;
            navigate(`/admin/login?redirect=${encodeURIComponent(from)}`, {
                replace: true,
                state: { from },
            });
        }
    }, [navigate, location.pathname, location.search, location.hash]);

    useEffect(() => {
        const t = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(t);
    }, []);

    const adminName = getAdminUsername() || '—';
    const trail = getActiveTrail(location.pathname, location.search);

    const handleLogout = () => {
        if (!confirm('确认退出管理后台？（不影响主站登录状态）')) return;
        clearAdminSession();
        navigate('/admin/login', { replace: true });
    };

    return (
        <div className="layout-safe h-screen w-full min-w-0 bg-n20 text-n700 flex overflow-hidden"
             style={{ fontFamily: '"PingFang SC", "Source Han Sans CN", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif' }}>
            {/* ============ 统一层级菜单 ============ */}
            <AdminSidebar />

            {/* ============ 主区 ============ */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {/* 顶栏：面包屑 + 在线/时钟 + 当前管理员 + 退出 */}
                <header className="responsive-toolbar shrink-0 bg-n0 border-b border-n40 flex items-center justify-between gap-3 px-5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-1.5 rounded-md text-n100 hover:text-n700 hover:bg-n20 transition-colors"
                            title="返回上一页"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        {/* 面包屑 */}
                        <nav className="flex items-center gap-1.5 text-sm min-w-0">
                            {trail.map((seg, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-n70 shrink-0" />}
                                    <span className={i === trail.length - 1 ? 'font-semibold text-n800 truncate' : 'text-n200 truncate'}>
                                        {seg}
                                    </span>
                                </React.Fragment>
                            ))}
                        </nav>
                    </div>

                    <div className="flex items-center gap-4 text-xs shrink-0 min-w-0">
                        <div className="hidden md:flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                            <span className="text-n100 uppercase tracking-wider"
                                  style={{ fontFamily: 'var(--font-mono)' }}>ONLINE</span>
                        </div>
                        <div className="hidden lg:block text-n200 tabular-nums"
                            style={{ fontFamily: 'var(--font-mono)' }}>
                            {now.toLocaleTimeString('zh-CN', { hour12: false })}
                        </div>
                        <div className="flex items-center gap-2 pl-3 border-l border-n40">
                            <div className="text-right leading-tight">
                                <div className="text-[9px] uppercase tracking-widest text-n100"
                                    style={{ fontFamily: 'var(--font-mono)' }}>SIGNED IN</div>
                                <div className="text-xs font-semibold text-primary">{adminName}</div>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-n300 hover:text-danger hover:bg-r50 border border-n40 hover:border-danger/30 transition-all"
                                title="退出管理后台"
                            >
                                <LogOut className="w-3.5 h-3.5" /> 退出
                            </button>
                        </div>
                    </div>
                </header>

                {/* 内容区 */}
                <main className="layout-safe flex-1 min-h-0 min-w-0 overflow-auto bg-n20">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default AdminLayout;
