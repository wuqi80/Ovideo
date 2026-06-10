/**
 * AdminSettingsPage.tsx — 系统设置
 *
 * 目前阶段：列出可配置入口（API 厂商 / 模型路由 / 通知 / 集群节点 / 工作流模板 / 速率限制），
 * 部分入口尚未独立 React 化，会引导到现有的静态控制台 /admin-legacy/（cluster_main 原生页）。
 * 后续 Slice 把每个 section 替换为内嵌 React 组件，不破坏当前导航结构。
 */

import React from 'react';
import {
    Settings, Network, Bot, Bell, Server, Workflow, Gauge,
    ExternalLink, ChevronRight,
} from 'lucide-react';

interface SettingTile {
    icon: React.ReactNode;
    title: string;
    desc: string;
    href?: string;        // 外链 / 静态控制台
    status: 'ready' | 'planned';
}

const TILES: SettingTile[] = [
    {
        icon: <Network className="w-5 h-5 text-cyan-400" />,
        title: 'API 厂商配置',
        desc: 'DashScope · Seedance · MiniMax · DeepSeek · 第三方 LLM/IMG/VID 接入',
        href: '/admin-legacy/',
        status: 'ready',
    },
    {
        icon: <Bot className="w-5 h-5 text-violet-400" />,
        title: '模型路由',
        desc: '生成请求 → 提供商的优先级 / 故障回退策略',
        href: '/admin-legacy/',
        status: 'ready',
    },
    {
        icon: <Bell className="w-5 h-5 text-amber-400" />,
        title: '通知映射',
        desc: '任务完成 / 失败 / 待审批的消息渠道与模板',
        status: 'planned',
    },
    {
        icon: <Server className="w-5 h-5 text-emerald-400" />,
        title: '集群节点',
        desc: 'ComfyUI / Worker / Agent 节点注册、健康、限流',
        href: '/admin-legacy/',
        status: 'ready',
    },
    {
        icon: <Workflow className="w-5 h-5 text-rose-400" />,
        title: '工作流模板',
        desc: '管理 ComfyUI workflow JSON 模板与默认参数',
        href: '/admin-legacy/',
        status: 'ready',
    },
    {
        icon: <Gauge className="w-5 h-5 text-yellow-400" />,
        title: '速率限制',
        desc: '按用户 / 按厂商 / 按 endpoint 的 QPS 与并发配额',
        status: 'planned',
    },
];

const TileCard: React.FC<SettingTile> = ({ icon, title, desc, href, status }) => {
    const inner = (
        <div className="group relative bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-5 transition-all duration-200 cursor-pointer overflow-hidden">
            <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-lg flex items-center justify-center border border-zinc-800 bg-zinc-900">
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-zinc-100 tracking-tight">{title}</div>
                        {status === 'planned' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 uppercase tracking-wider"
                                  style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                                PLANNED
                            </span>
                        )}
                        {status === 'ready' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 uppercase tracking-wider"
                                  style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                                READY
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{desc}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-200 group-hover:translate-x-0.5 transition-all shrink-0" />
            </div>
        </div>
    );
    if (status === 'planned') {
        return <div className="opacity-60 cursor-not-allowed pointer-events-none">{inner}</div>;
    }
    if (href) {
        return <a href={href} target="_blank" rel="noreferrer" className="block">{inner}</a>;
    }
    return inner;
};

export const AdminSettingsPage: React.FC = () => {
    return (
        <div className="p-8 max-w-5xl mx-auto">
            <header className="mb-8">
                <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-widest text-zinc-500"
                     style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                    <Settings className="w-3 h-3" /> Settings
                </div>
                <h1 className="text-3xl font-bold text-zinc-100 tracking-tight">系统设置</h1>
                <p className="text-sm text-zinc-500 mt-1">
                    全局配置入口 · 标记 <span className="text-emerald-400">READY</span> 的已可用，<span className="text-zinc-500">PLANNED</span> 项在后续切片中陆续上线
                </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                {TILES.map(t => <TileCard key={t.title} {...t} />)}
            </div>

            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-5">
                <div className="flex items-start gap-3">
                    <ExternalLink className="w-4 h-4 text-zinc-500 mt-0.5" />
                    <div className="flex-1 text-xs text-zinc-500 leading-relaxed">
                        <div className="text-zinc-300 font-semibold mb-1">关于静态控制台</div>
                        许多 READY 项目前由旧版 <code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded"
                            style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>/admin-legacy/</code> 提供（cluster_main 原生）。
                        点击 tile 会在新标签页打开。后续 Slice 计划逐项内嵌到本 Shell。
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminSettingsPage;
