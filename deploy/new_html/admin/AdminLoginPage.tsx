/**
 * AdminLoginPage.tsx — 后台独立登录
 *
 * 设计要点：
 *  - 与主站登录完全独立：调用相同 /api/login，但 token 写到 sessionStorage 独立 key
 *  - 前端白名单兜底：只有 admin / lllsdhr 用户可以进；其他用户登录返回也提示"非管理员"
 *  - 视觉：cluster_main 舰桥控制台同款 — 暗黑工业风、emerald accent、终端字体
 *  - 不再依赖主站是否已登录；管理员可以"主站匿名 + 后台已登录"或反之
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Lock, User as UserIcon, AlertTriangle, ArrowLeft } from 'lucide-react';
import { setAdminSession, isAdminWhitelisted, getAdminToken, getAdminUsername } from './adminAuth';

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
            const from = (location.state as any)?.from || '/admin';
            navigate(from, { replace: true });
        }
    }, [navigate, location.state]);

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
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim(), password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success || !data.token) {
                setError(data?.detail || data?.message || `登录失败 (HTTP ${res.status})`);
                return;
            }
            const respUsername = data.username || username.trim();
            if (!isAdminWhitelisted(respUsername)) {
                setError(`账号 ${respUsername} 不在管理员白名单内`);
                return;
            }
            setAdminSession(data.token, respUsername);
            const from = (location.state as any)?.from || '/admin';
            navigate(from, { replace: true });
        } catch (err: any) {
            setError(err?.message || '网络异常');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="min-h-screen w-screen flex items-center justify-center relative overflow-hidden bg-zinc-950 text-zinc-200"
            style={{ fontFamily: '"PingFang SC", "Source Han Sans CN", "Microsoft YaHei", sans-serif' }}
        >
            {/* 背景：径向辉光 + 等距网格 + 微粒噪点 */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 opacity-[0.06]"
                     style={{
                         backgroundImage:
                             'linear-gradient(rgba(16,185,129,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.5) 1px, transparent 1px)',
                         backgroundSize: '32px 32px',
                     }} />
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full blur-3xl opacity-30"
                     style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.35) 0%, rgba(16,185,129,0) 60%)' }} />
                <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-3xl opacity-20"
                     style={{ background: 'radial-gradient(circle, rgba(244,63,94,0.35) 0%, rgba(244,63,94,0) 70%)' }} />
            </div>

            {/* 返回主站 */}
            <button
                onClick={() => navigate('/')}
                className="absolute top-5 left-5 z-10 flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
            >
                <ArrowLeft className="w-3.5 h-3.5" /> 返回主站
            </button>

            {/* 卡片 */}
            <div className="relative z-10 w-full max-w-md mx-4">
                {/* 顶部品牌 */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-700/20 border border-emerald-500/40 mb-3 shadow-[0_0_40px_rgba(16,185,129,0.25)]">
                        <ShieldCheck className="w-7 h-7 text-emerald-400" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-100">MESSIAH · ADMIN</h1>
                    <p className="text-xs text-zinc-500 mt-1.5 tracking-wider uppercase"
                       style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                        Restricted · Authentication Required
                    </p>
                </div>

                {/* 表单卡 */}
                <form
                    onSubmit={handleSubmit}
                    className="relative bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
                >
                    {/* 状态条 */}
                    <div className="absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />

                    <div className="space-y-4">
                        {/* 账号 */}
                        <div>
                            <label className="block text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5"
                                   style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                                ACCOUNT
                            </label>
                            <div className="relative">
                                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                                <input
                                    type="text"
                                    autoFocus
                                    autoComplete="username"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    placeholder="admin / lllsdhr"
                                    className="w-full bg-zinc-950/60 border border-zinc-800 hover:border-zinc-700 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/10 rounded-lg pl-10 pr-3 py-2.5 text-sm transition-all outline-none placeholder:text-zinc-700"
                                />
                            </div>
                        </div>

                        {/* 密码 */}
                        <div>
                            <label className="block text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5"
                                   style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                                PASSPHRASE
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                                <input
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full bg-zinc-950/60 border border-zinc-800 hover:border-zinc-700 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/10 rounded-lg pl-10 pr-3 py-2.5 text-sm transition-all outline-none placeholder:text-zinc-700"
                                />
                            </div>
                        </div>

                        {/* 错误条 */}
                        {error && (
                            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
                                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                                <div className="text-xs text-red-300 leading-relaxed">{error}</div>
                            </div>
                        )}

                        {/* 提交 */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:cursor-not-allowed text-sm font-semibold text-emerald-50 shadow-[0_0_20px_rgba(16,185,129,0.25)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] transition-all"
                        >
                            {loading ? (
                                <>
                                    <span className="inline-block w-3 h-3 border-2 border-emerald-200/40 border-t-emerald-100 rounded-full animate-spin" />
                                    验证中…
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="w-4 h-4" /> 进入控制台
                                </>
                            )}
                        </button>
                    </div>

                    {/* 脚注 */}
                    <div className="mt-5 pt-4 border-t border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-600"
                         style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                        <span>SESSION · SANDBOXED</span>
                        <span>v 2026.05.26</span>
                    </div>
                </form>

                <p className="text-center text-[11px] text-zinc-600 mt-5 leading-relaxed">
                    本控制台与主站会话隔离 · 主站登录状态不会被改动<br />
                    凭据仅在当前浏览器标签页内保留
                </p>
            </div>
        </div>
    );
};

export default AdminLoginPage;
