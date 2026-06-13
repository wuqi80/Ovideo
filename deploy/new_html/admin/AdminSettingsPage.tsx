/**
 * AdminSettingsPage.tsx — 系统设置（refactor/v2，?item 驱动）
 *
 * 由统一壳的「系统设置」三级菜单驱动：?item= 决定渲染哪个面板。
 *  - apiconfig / cluster / workflows：内嵌旧版控制台 /admin-legacy/（?embed=1 隐藏其自带侧栏 + #page 深链），
 *    使其看起来就是本壳的一个内容页，而非「另一个后台」。
 *  - routing / ratelimit / notify：尚未独立后端，先给规划占位面板。
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Gauge, Bell, Info } from 'lucide-react';

/** 旧版控制台对应页（hash 深链）。null = 非 legacy 项。 */
const LEGACY_PAGE: Record<string, string | undefined> = {
    apiconfig: 'apiconfig',
    cluster: 'cluster',
    workflows: 'workflows',
};

const PLACEHOLDERS: Record<string, { icon: React.ReactNode; title: string; desc: string }> = {
    routing: {
        icon: <Bot className="w-6 h-6 text-p300" />,
        title: '模型路由',
        desc: '生成请求 → 提供商的优先级与故障回退策略。当前路由规则内置于后端 worker 配置；可视化编辑面板规划中。',
    },
    ratelimit: {
        icon: <Gauge className="w-6 h-6 text-warning" />,
        title: '速率限制',
        desc: '按用户 / 按厂商 / 按 endpoint 的 QPS 与并发配额。后端限流已生效，独立配置面板规划中。',
    },
    notify: {
        icon: <Bell className="w-6 h-6 text-warning" />,
        title: '通知映射',
        desc: '任务完成 / 失败 / 待审批的消息渠道与模板。规划中。',
    },
};

// 版本号：旧版静态资源（index/style/app）改动后手动 +1，强制 iframe 重新拉取、
// 绕开浏览器对 iframe 子资源的缓存（刷新外层 SPA 未必会让 iframe 资源重新校验）。
const LEGACY_VER = '20260613b';

const LegacyEmbed: React.FC<{ page: string }> = ({ page }) => (
    // 内嵌旧版控制台：?embed=1 隐藏其侧栏，#page 直达对应页，&v 击穿缓存
    <iframe
        title="legacy-admin"
        src={`/admin-legacy/?embed=1&v=${LEGACY_VER}#${page}`}
        className="w-full h-full border-0 block bg-n20"
    />
);

const Placeholder: React.FC<{ item: string }> = ({ item }) => {
    const p = PLACEHOLDERS[item] ?? PLACEHOLDERS.notify;
    return (
        <div className="p-8 max-w-3xl mx-auto">
            <div className="bg-n0 border border-n40 rounded-md p-8 shadow-card">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center border border-n40 bg-n10 shrink-0">
                        {p.icon}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-n800">{p.title}</h2>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-n30 text-n300 uppercase tracking-wider"
                                  style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>PLANNED</span>
                        </div>
                        <p className="text-sm text-n300 mt-2 leading-relaxed">{p.desc}</p>
                    </div>
                </div>
                <div className="mt-6 pt-5 border-t border-n40 flex items-start gap-2.5 text-xs text-n100 leading-relaxed">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    该能力已在后端生效，仅可视化配置面板待补。需要调整请在「系统设置 › API 与模型 › API 厂商配置」或后端配置中处理。
                </div>
            </div>
        </div>
    );
};

export const AdminSettingsPage: React.FC = () => {
    const [sp] = useSearchParams();
    const item = sp.get('item') || 'apiconfig';
    const legacyPage = LEGACY_PAGE[item];

    if (legacyPage) {
        return (
            <div className="h-full w-full">
                <LegacyEmbed page={legacyPage} />
            </div>
        );
    }
    return <Placeholder item={item} />;
};

export default AdminSettingsPage;
