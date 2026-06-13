/**
 * AdminLayout.tsx — 后台总管 Shell
 *
 * 视觉 DNA（参考 cluster_main 舰桥控制台风格）：
 *  - 暗黑工业风：bg-zinc-950 主背景，bg-zinc-900 卡片，border-zinc-800/60 极细边
 *  - 状态色：emerald（健康）/ amber（待处理）/ red（异常）；不复用主站 indigo
 *  - 字体：中文 PingFang/Source Han，等宽 ID 用 'JetBrains Mono', ui-monospace
 *  - 左 sidebar 固定 14rem，顶 topbar 56px，主区 zinc-950
 *
 * 路由结构（由 App.tsx 提供 Routes）：
 *  /admin/login        → AdminLoginPage（独立，不被本 Layout 包裹）
 *  /admin              → AdminLayout > Outlet → AdminHubPage
 *  /admin/operations   → AdminLayout > Outlet → AdminOperationsPage（5 tab：用户/统计/审计/集群/新功能）
 *  /admin/settings     → AdminLayout > Outlet → AdminSettingsPage
 */

import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard, Cpu, Settings as SettingsIcon, LogOut, ShieldCheck,
    ExternalLink, ChevronLeft,
} from 'lucide-react';
import { getAdminToken, getAdminUsername, clearAdminSession, isAdminWhitelisted } from './adminAuth';

const NAV_ITEMS = [
    { to: '/admin',            label: '总览',     icon: LayoutDashboard, end: true },
    { to: '/admin/operations', label: '生成管理', icon: Cpu },
    { to: '/admin/settings',   label: '系统设置', icon: SettingsIcon },
];

export const AdminLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [now, setNow] = useState(() => new Date());

    // 鉴权门：未登录后台或非白名单 → 跳 /admin/login
    useEffect(() => {
        const token = getAdminToken();
        const username = getAdminUsername();
        if (!token || !isAdminWhitelisted(username)) {
            navigate('/admin/login', { replace: true, state: { from: location.pathname } });
        }
    }, [navigate, location.pathname]);

    // 顶栏右侧的实时时钟（小细节，提升仪表盘感）
    useEffect(() => {
        const t = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(t);
    }, []);

    const adminName = getAdminUsername() || '—';

    const handleLogout = () => {
        if (!confirm('确认退出管理后台？（不影响主站登录状态）')) return;
        clearAdminSession();
        navigate('/admin/login', { replace: true });
    };

    return (
        <div className="min-h-screen w-screen bg-n20 text-n700 flex"
             style={{ fontFamily: '"PingFang SC", "Source Han Sans CN", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif' }}>
            {/* ================ Sidebar ================ */}
            <aside className="w-56 shrink-0 bg-n0 border-r border-n40 flex flex-col">
                {/* Brand */}
                <div className="h-14 flex items-center gap-2.5 px-4 border-b border-n40">
                    <div className="w-8 h-8 rounded-md bg-primary-light border border-primary/40 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-primary" />
                    </div>
                    <div className="leading-tight">
                        <div className="text-sm font-bold tracking-tight text-n800">MESSIAH</div>
                        <div className="text-[10px] uppercase tracking-widest text-n100" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>Admin Console</div>
                    </div>
                </div>

                {/* Primary nav */}
                <nav className="flex-1 p-3 space-y-1">
                    {NAV_ITEMS.map(item => {
                        const Icon = item.icon;
                        return (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={(item as any).end}
                                className={({ isActive }) =>
                                    `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-150 ${
                                        isActive
                                            ? 'bg-primary-light text-primary border border-primary/20'
                                            : 'text-n300 hover:text-n800 hover:bg-n20 border border-transparent'
                                    }`
                                }
                            >
                                <Icon className="w-4 h-4" />
                                <span>{item.label}</span>
                            </NavLink>
                        );
                    })}

                    {/* 外链：集群仪表盘（cluster_main 静态后台） */}
                    <a
                        href="/admin-legacy/" target="_blank" rel="noreferrer"
                        className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-n100 hover:text-n700 hover:bg-n20 transition-all duration-150"
                        title="Cluster Admin（旧版，独立窗口）"
                    >
                        <ExternalLink className="w-4 h-4" />
                        <span>集群仪表盘</span>
                    </a>
                </nav>

                {/* Footer — 当前管理员 + 退出 */}
                <div className="p-3 border-t border-n40">
                    <div className="px-3 py-2 mb-2 rounded-md bg-n20 border border-n40">
                        <div className="text-[9px] uppercase tracking-widest text-n100 mb-0.5" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>SIGNED IN AS</div>
                        <div className="text-xs font-semibold text-primary">{adminName}</div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs text-n300 hover:text-danger hover:bg-r50 border border-n40 hover:border-danger/30 transition-all"
                    >
                        <LogOut className="w-3.5 h-3.5" /> 退出后台
                    </button>
                </div>
            </aside>

            {/* ================ Main pane ================ */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Topbar */}
                <header className="h-14 shrink-0 bg-n0 backdrop-blur-sm border-b border-n40 flex items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-1.5 rounded-md text-n100 hover:text-n700 hover:bg-n20 transition-colors"
                            title="返回上一页"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="text-[11px] uppercase tracking-widest text-n100"
                             style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                            {location.pathname.replace('/admin', '').replace(/^\//, '') || 'overview'}
                        </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                        <div className="hidden md:flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                            <span className="text-n100 uppercase tracking-wider"
                                  style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>ONLINE</span>
                        </div>
                        <div className="text-n300 tabular-nums"
                             style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                            {now.toLocaleString('zh-CN', { hour12: false })}
                        </div>
                    </div>
                </header>

                {/* Body */}
                <main className="flex-1 overflow-auto bg-n20 scrollbar-atlas">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default AdminLayout;
