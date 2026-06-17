/**
 * AdminSettingsPage.tsx — 系统设置（refactor/v2，?item 驱动）
 *
 * 系统设置目前只有「确有后端、可真实操作」的页，全部内嵌旧版控制台 /admin-legacy/：
 *   apiconfig  → API 厂商配置（密钥/端点/模型/代理）
 *   cluster    → 集群节点（GPU Agent 注册与健康）
 *   workflows  → 工作流模板（ComfyUI workflow JSON）
 * 以 ?embed=1 隐藏旧版自带侧栏 + ?page=<page> 直达对应页，使其成为本壳的内容页而非「另一个后台」。
 * （模型路由/速率限制/通知映射等无后端的空壳菜单已移除。）
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';

// 版本号：旧版静态资源（index/style/app）改动后手动 +1，强制 iframe 重新拉取、
// 绕开浏览器对 iframe 子资源的缓存（刷新外层 SPA 未必会让 iframe 资源重新校验）。
const LEGACY_VER = '20260617a';

/** 合法的 legacy 内嵌页；非法 item 一律回落到 apiconfig。
 *  dashboard 即旧版「仪表盘」：实时任务列表 + 集群统计 + 清理僵尸任务（挂在「数据监控 › 任务监控」）。 */
const LEGACY_PAGES = ['apiconfig', 'cluster', 'workflows', 'dashboard'];

export const AdminSettingsPage: React.FC = () => {
    const [sp] = useSearchParams();
    const raw = sp.get('item') || 'apiconfig';
    const page = LEGACY_PAGES.includes(raw) ? raw : 'apiconfig';

    return (
        <div className="h-full w-full">
            {/* 内嵌旧版控制台：?embed=1 隐藏自带侧栏，?page=<page> 直达，&v 击穿缓存。
                key={page} 强制按页重新挂载——否则仅 hash 变化浏览器不重载 iframe，各页会「都一样」。 */}
            <iframe
                key={page}
                title="legacy-admin"
                src={`/admin-legacy/?embed=1&v=${LEGACY_VER}&page=${page}#${page}`}
                className="w-full h-full border-0 block bg-n20"
            />
        </div>
    );
};

export default AdminSettingsPage;
