/**
 * AdminHubPage.tsx — 后台导航 Hub（总览）
 *
 * 设计要点：
 *  - 两块"航站楼"主入口：生成管理 / 系统设置；附带集群仪表盘外链
 *  - 每个 tile 配备实时数据卡（用户数/任务数/在线 agent 数）
 *  - hover 时浮起 + 边框辉光；点击导航到对应子页面
 *  - 顶部 KPI 条：4 个核心指标（用户/项目/今日任务/待审计），与 cluster_main 仪表盘对齐
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Cpu, Settings as SettingsIcon, Users, FolderTree, Activity,
    ExternalLink, ChevronRight, ScrollText, Image as ImageIcon, ShieldCheck,
} from 'lucide-react';
import { apiJson } from '../services/httpClient';

interface KPI {
    users: number;
    projects: number;
    todayTasks: number;
    pendingAudits: number;
}

const TileBase: React.FC<{
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    accent: string;
    onClick?: () => void;
    href?: string;
    children?: React.ReactNode;
}> = ({ icon, title, subtitle, accent, onClick, href, children }) => {
    const inner = (
        <div className="group relative bg-n0 hover:bg-n0 border border-n40 hover:border-primary rounded-md p-6 transition-all duration-200 cursor-pointer overflow-hidden shadow-card hover:shadow-atlas">
            {/* 顶部辉光线 */}
            <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${accent} to-transparent opacity-50 group-hover:opacity-100 transition-opacity`} />
            {/* 角部装饰 */}
            <div className={`absolute top-3 right-3 w-6 h-6 rounded-md flex items-center justify-center border ${accent.replace('via-', 'border-').replace('/60', '/30')} opacity-40 group-hover:opacity-100 transition-opacity`}>
                <ChevronRight className="w-3.5 h-3.5 text-n700 group-hover:translate-x-0.5 transition-transform" />
            </div>
            {/* 主区 */}
            <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center border ${accent.replace('via-', 'border-').replace('/60', '/40')} bg-n0`}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-n800 tracking-tight">{title}</div>
                    <div className="text-xs text-n100 mt-0.5 leading-relaxed">{subtitle}</div>
                </div>
            </div>
            {children && (
                <div className="mt-5 pt-4 border-t border-n40">
                    {children}
                </div>
            )}
        </div>
    );
    if (href) {
        return <a href={href} target="_blank" rel="noreferrer" className="block">{inner}</a>;
    }
    return <div onClick={onClick} className="block">{inner}</div>;
};

const KPICard: React.FC<{ label: string; value: number | string; accent: string }> = ({ label, value, accent }) => (
    <div className="bg-n0 border border-n40 rounded-lg p-4 shadow-card">
        <div className="text-[10px] uppercase tracking-widest text-n100 mb-1.5"
             style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{label}</div>
        <div className={`text-3xl font-bold tabular-nums ${accent}`}
             style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{value}</div>
    </div>
);

export const AdminHubPage: React.FC = () => {
    const navigate = useNavigate();
    const [kpi, setKpi] = useState<KPI>({ users: 0, projects: 0, todayTasks: 0, pendingAudits: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                // 这些接口都不强求成功，仪表盘只是预览，404/500 静默退化为 0
                const safeJson = async (url: string) => {
                    try { return await apiJson<any>(url, { method: 'GET' }, 'Admin Hub KPI'); }
                    catch { return null; }
                };
                const [statsRes, usersRes] = await Promise.all([
                    safeJson('/api/admin/stats'),
                    safeJson('/api/admin/users?limit=1'),
                ]);
                if (!alive) return;
                setKpi({
                    users: usersRes?.total ?? statsRes?.total_users ?? 0,
                    projects: statsRes?.total_projects ?? 0,
                    todayTasks: statsRes?.today_tasks ?? statsRes?.tasks_today ?? 0,
                    pendingAudits: statsRes?.pending_audits ?? 0,
                });
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    return (
        <div className="p-8 max-w-7xl mx-auto">
            {/* 标题 + 描述 */}
            <header className="mb-8">
                <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-widest text-n100"
                     style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                    Operational
                </div>
                <h1 className="text-3xl font-bold text-n800 tracking-tight">总览</h1>
                <p className="text-sm text-n100 mt-1">
                    管理控制台入口 · 选择需要进入的功能区域
                </p>
            </header>

            {/* KPI 条 */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <KPICard label="USERS"        value={loading ? '—' : kpi.users}         accent="text-success" />
                <KPICard label="PROJECTS"     value={loading ? '—' : kpi.projects}      accent="text-cyan-400" />
                <KPICard label="TASKS TODAY"  value={loading ? '—' : kpi.todayTasks}    accent="text-warning" />
                <KPICard label="PENDING"      value={loading ? '—' : kpi.pendingAudits} accent="text-danger" />
            </section>

            {/* 主入口 */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <TileBase
                    icon={<Cpu className="w-6 h-6 text-primary" />}
                    title="生成管理"
                    subtitle="账号 · 项目分组 · 积分 · 素材库 · 审计日志"
                    accent="via-emerald-500/60"
                    onClick={() => navigate('/admin/features?tab=accounts')}
                >
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-n100">
                        <div className="flex items-center gap-1.5"><Users size={12} className="text-n100" />账号 / 权限</div>
                        <div className="flex items-center gap-1.5"><FolderTree size={12} className="text-n100" />项目分组</div>
                        <div className="flex items-center gap-1.5"><ScrollText size={12} className="text-n100" />积分账户</div>
                        <div className="flex items-center gap-1.5"><ImageIcon size={12} className="text-n100" />素材库</div>
                        <div className="flex items-center gap-1.5"><Activity size={12} className="text-n100" />生成统计</div>
                        <div className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-n100" />审计日志</div>
                    </div>
                </TileBase>

                <TileBase
                    icon={<SettingsIcon className="w-6 h-6 text-cyan-400" />}
                    title="系统设置"
                    subtitle="API 厂商配置 · 集群节点 · 工作流模板"
                    accent="via-cyan-500/60"
                    onClick={() => navigate('/admin/settings?item=apiconfig')}
                >
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-n100">
                        <div className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-n100"></span>API 厂商</div>
                        <div className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-n100"></span>集群节点</div>
                        <div className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-n100"></span>工作流模板</div>
                    </div>
                </TileBase>
            </section>

            {/* 集群仪表盘 — 内嵌入壳（不再弹独立窗口，保持「一个后台」体验） */}
            <section>
                <div
                    onClick={() => navigate('/admin/settings?item=cluster')}
                    className="group flex items-center justify-between bg-n0 hover:bg-n20 border border-n40 hover:border-primary rounded-md p-5 transition-all shadow-card hover:shadow-atlas cursor-pointer"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-n40 bg-n0">
                            <ExternalLink className="w-5 h-5 text-n300 group-hover:text-n700" />
                        </div>
                        <div>
                            <div className="text-sm font-semibold text-n700">集群仪表盘 (Cluster Admin)</div>
                            <div className="text-xs text-n100 mt-0.5">ComfyUI / AI API 控制台 · 已内嵌于「系统设置 › 生成集群」</div>
                        </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-n100 group-hover:text-n700 group-hover:translate-x-1 transition-all" />
                </div>
            </section>
        </div>
    );
};

export default AdminHubPage;
