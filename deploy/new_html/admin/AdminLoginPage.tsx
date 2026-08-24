/**
 * AdminLoginPage.tsx — 后台独立登录
 *
 * 设计要点：
 *  - 与主站登录完全独立：调用相同 /api/login，但 token 写到 sessionStorage 独立 key
 *  - 前端白名单兜底：只有 admin / lllsdhr 用户可以进；其他用户登录返回也提示"非管理员"
 *  - 视觉：与创作端登录页共用“深色品牌区 + 浅色表单区”的创剧品牌语言
 *  - 不再依赖主站是否已登录；管理员可以"主站匿名 + 后台已登录"或反之
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Lock, User as UserIcon, AlertTriangle, ArrowLeft } from 'lucide-react';
import {
    setAdminSession,
    isAdminWhitelisted,
    getAdminToken,
    getAdminUsername,
    getAndClearAdminPostLoginRedirect,
} from './adminAuth';
import { apiJson } from '../services/httpClient';
import { BrandLogo } from '../components/BrandLogo';

type WorkflowPreviewKind = 'story' | 'shots' | 'final';

interface WorkflowPreviewProps {
    index: string;
    title: string;
    description: string;
    kind: WorkflowPreviewKind;
}

/**
 * 管理端登录页只展示流程轮廓，不加载真实项目数据，避免登录前产生额外请求。
 * 三张卡片与创作端登录页一一对应，品牌升级时只需同步这组语义即可。
 */
const WorkflowPreview: React.FC<WorkflowPreviewProps> = ({ index, title, description, kind }) => (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.055] p-2.5">
        <div className="h-[72px] overflow-hidden rounded-lg border border-white/10 bg-[#111C2E] p-2" aria-hidden="true">
            {kind === 'story' && (
                <div className="flex h-full gap-2">
                    <div className="w-5 rounded bg-[#263754]" />
                    <div className="flex-1 rounded bg-[#E7ECF5] p-2">
                        <i className="mb-1.5 block h-1.5 w-3/4 rounded bg-[#7D8BA4]" />
                        <i className="mb-1.5 block h-1.5 w-1/2 rounded bg-[#AAB4C5]" />
                        <i className="block h-2 w-1/3 rounded bg-[#5B49F0]" />
                    </div>
                </div>
            )}
            {kind === 'shots' && (
                <div className="grid h-full grid-cols-3 gap-1.5">
                    <i className="rounded bg-gradient-to-br from-[#4D8DFF] to-[#244D9A]" />
                    <i className="rounded bg-gradient-to-br from-[#8B6BFF] to-[#4936A4]" />
                    <i className="rounded bg-gradient-to-br from-[#22C7C9] to-[#147477]" />
                </div>
            )}
            {kind === 'final' && (
                <div className="flex h-full flex-col gap-2">
                    <div className="relative flex-1 rounded bg-gradient-to-br from-[#6553F2] via-[#334A80] to-[#142239]">
                        <span className="absolute left-1/2 top-1/2 h-0 w-0 -translate-x-1/2 -translate-y-1/2 border-y-[7px] border-l-[11px] border-y-transparent border-l-white" />
                    </div>
                    <div className="flex h-2 gap-1"><i className="w-1/3 rounded bg-[#5B49F0]" /><i className="flex-1 rounded bg-[#33425C]" /></div>
                </div>
            )}
        </div>
        <div className="mt-2 flex items-start gap-2">
            <span className="text-[10px] font-bold text-[#8B9FFF]">{index}</span>
            <div className="min-w-0">
                <div className="text-xs font-semibold text-white">{title}</div>
                <div className="mt-0.5 truncate text-[10px] text-white/50">{description}</div>
            </div>
        </div>
    </article>
);

function getLoginRedirect(location: ReturnType<typeof useLocation>): string {
    const redirect = new URLSearchParams(location.search).get('redirect');
    const from = (location.state as any)?.from;
    const pending = getAndClearAdminPostLoginRedirect();
    const candidates = [redirect, from, pending];

    for (const rawTarget of candidates) {
        const target = normalizeAdminRedirect(rawTarget);
        if (target) return target;
    }
    return '/admin';
}

function normalizeAdminRedirect(rawTarget: unknown): string | null {
    if (typeof rawTarget !== 'string' || !rawTarget.trim()) return null;
    try {
        const url = new URL(rawTarget, window.location.origin);
        if (url.origin !== window.location.origin) return null;
        if (!url.pathname.startsWith('/admin') || url.pathname.startsWith('/admin/login')) return null;
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return null;
    }
}

export const AdminLoginPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // 已登录后台 → 直跳目标
    useEffect(() => {
        const token = getAdminToken();
        const u = getAdminUsername();
        if (token && isAdminWhitelisted(u)) {
            navigate(getLoginRedirect(location), { replace: true });
        }
    }, [navigate, location]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (loading) return;
        if (!username.trim() || !password) {
            setError('请输入账号和密码');
            return;
        }
        setError('');
        setLoading(true);
        try {
            // 2026-05-26 修复：后端路由是 /api/login（cluster_main.py:1104），
            //   不存在 /api/auth/login —— 旧 URL 会 404，res.ok=false → setError 但不写 token，
            //   用户感觉"登录成功"实际未登录，点"生成管理"时 AdminOperationsRoute 看 token=null → 弹回登录页。
            // 后端响应格式 { success, message, token, username } 完全匹配下面的解构。
            const data = await apiJson<any>('/api/login', {
                method: 'POST',
                body: JSON.stringify({ username: username.trim(), password }),
            }, '登录', { requireAuth: false });
            if (!data.success || !data.token) {
                setError(data?.detail || data?.message || '登录失败');
                return;
            }
            const respUsername = data.username || username.trim();
            if (!isAdminWhitelisted(respUsername)) {
                setError(`账号 ${respUsername} 不在管理员白名单内`);
                return;
            }
            setAdminSession(data.token, respUsername);
            navigate(getLoginRedirect(location), { replace: true });
        } catch (err: any) {
            setError(err?.message || '网络异常');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen w-full bg-n20 font-sans text-n700 lg:flex lg:h-screen lg:overflow-hidden">
            {/* 品牌区保持与创作端登录页相同的 44/56 桌面比例。 */}
            <section className="relative hidden h-screen w-[44%] min-w-[520px] overflow-hidden bg-[#09111F] px-12 py-8 text-white lg:flex lg:flex-col">
                <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(139,107,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(139,107,255,0.9) 1px, transparent 1px)',
                        backgroundSize: '40px 40px',
                    }} />
                <div className="pointer-events-none absolute -right-56 top-16 h-[620px] w-[620px] rounded-full border border-white/10" />
                <div className="pointer-events-none absolute -bottom-40 -left-36 h-[440px] w-[440px] rounded-full bg-primary/20 blur-[120px]" />

                <BrandLogo tone="dark" className="relative z-10 w-[136px]" />

                <div className="relative z-10 my-auto max-w-[560px] py-6">
                    <p className="mb-4 text-xs font-semibold tracking-[0.18em] text-[#9DAEFF]">创剧 · 系统管理</p>
                    <h1 className="font-display text-[40px] font-bold leading-[1.14] tracking-tight xl:text-[48px]">
                        <span className="block">把一个好想法，</span>
                        <span className="block">变成一部好漫剧</span>
                    </h1>
                    <p className="mt-5 max-w-[500px] text-sm leading-7 text-white/60">
                        在统一后台管理用户、模型、积分和系统运行状态，为每一步创作提供稳定支持。
                    </p>
                </div>

                <div className="relative z-10 grid grid-cols-3 gap-3">
                    <WorkflowPreview index="01" title="写剧本" description="管理创作与文本能力" kind="story" />
                    <WorkflowPreview index="02" title="做分镜" description="管理素材与生成能力" kind="shots" />
                    <WorkflowPreview index="03" title="出成片" description="管理任务与服务状态" kind="final" />
                </div>
                <p className="relative z-10 mt-5 text-[10px] text-white/35">© 2026 创剧 · 系统管理后台</p>
            </section>

            <section className="relative flex min-h-screen flex-1 items-center justify-center bg-[#F6F7FA] px-5 py-16 lg:h-screen lg:min-h-0 lg:px-10">
                <button
                    onClick={() => navigate('/')}
                    className="absolute left-5 top-5 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-n200 transition-colors hover:bg-n0 hover:text-n700 lg:left-8 lg:top-7"
                >
                    <ArrowLeft className="h-3.5 w-3.5" /> 返回创作端
                </button>

                <div className="w-full max-w-[440px] rounded-[20px] border border-n40 bg-n0 p-7 shadow-bottom sm:p-9">
                    <BrandLogo className="mb-9 w-[132px] lg:hidden" />

                    <div className="mb-7">
                        <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light text-primary">
                            <ShieldCheck className="h-5 w-5" />
                        </span>
                        <h2 className="font-display text-[30px] font-bold tracking-tight text-n800">创剧管理后台</h2>
                        <p className="mt-2 text-sm text-n200">管理员专用入口，登录后进入系统管理控制台</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="admin-username" className="mb-2 block text-sm font-medium text-n500">管理员账号</label>
                            <div className="relative">
                                <UserIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-n100" />
                                <input
                                    id="admin-username"
                                    type="text"
                                    autoFocus
                                    autoComplete="username"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    placeholder="请输入管理员账号"
                                    className="h-12 w-full rounded-lg border border-n40 bg-n0 pl-10 pr-3 text-sm outline-none transition-all placeholder:text-n100 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="admin-password" className="mb-2 block text-sm font-medium text-n500">密码</label>
                            <div className="relative">
                                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-n100" />
                                <input
                                    id="admin-password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="请输入密码"
                                    className="h-12 w-full rounded-lg border border-n40 bg-n0 pl-10 pr-3 text-sm outline-none transition-all placeholder:text-n100 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-r50 px-3 py-2.5">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                                <div className="text-xs leading-relaxed text-danger">{error}</div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-card transition-all hover:bg-primary-hover hover:shadow-atlas disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? (
                                <>
                                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                    验证中…
                                </>
                            ) : (
                                <>
                                    进入管理后台 <ShieldCheck className="h-4 w-4" />
                                </>
                            )}
                        </button>
                    </form>

                    <p className="mt-6 border-t border-n40 pt-5 text-center text-xs leading-5 text-n100">
                        后台与创作端登录状态相互独立<br />凭据仅在当前浏览器标签页内保留
                    </p>
                </div>
            </section>
        </main>
    );
};

export default AdminLoginPage;
