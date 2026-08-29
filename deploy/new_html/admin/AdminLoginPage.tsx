/**
 * AdminLoginPage.tsx — 后台独立登录
 *
 * 设计要点：
 *  - 与主站登录完全独立：调用相同 /api/login，但 token 写到 sessionStorage 独立 key
 *  - 管理权限由后端 users.role 校验，不把可变用户名写死在前端
 *  - 视觉：独立的后台控制台风格，用克制的网格、状态色和终端排版与创作端区分
 *  - 不再依赖主站是否已登录；管理员可以"主站匿名 + 后台已登录"或反之
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Lock, User as UserIcon, AlertTriangle, ArrowLeft } from 'lucide-react';
import {
    setAdminSession,
    clearAdminSession,
    getAdminToken,
    getAdminUsername,
    getAndClearAdminPostLoginRedirect,
} from './adminAuth';
import { apiJson } from '../services/httpClient';
import { apiJsonWithToken } from '../services/httpClient';
import { BrandLogo } from '../components/BrandLogo';

const LEGACY_PHONE_BINDING_TOKEN_KEY = 'legacy_phone_binding_token';
const LEGACY_PHONE_BINDING_RETURN_KEY = 'legacy_phone_binding_return_to';

function isMainlandPhoneLogin(value: string): boolean {
    return /^((\+?86)|0086)?1[3-9]\d{9}$/.test(value.replace(/[\s-]/g, ''));
}

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

type AdminSessionResponse = {
    success: boolean;
    user_id: string;
    username: string;
    role: string;
};

async function verifyAdminSession(token: string): Promise<AdminSessionResponse> {
    return apiJsonWithToken<AdminSessionResponse>(
        '/api/admin/session',
        token,
        { method: 'GET' },
        '管理员权限校验',
    );
}

export const AdminLoginPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // 已登录后台 → 向后端确认当前角色后再跳转。
    useEffect(() => {
        const token = getAdminToken();
        const storedUsername = getAdminUsername();
        if (!token || !storedUsername) return;
        let active = true;
        verifyAdminSession(token)
            .then(session => {
                if (!active) return;
                setAdminSession(token, session.username);
                navigate(getLoginRedirect(location), { replace: true });
            })
            .catch(() => {
                if (active) clearAdminSession();
            });
        return () => { active = false; };
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
            const identity = username.trim();
            const phoneLogin = isMainlandPhoneLogin(identity);
            const data = await apiJson<any>(phoneLogin ? '/api/auth/phone/login' : '/api/login', {
                method: 'POST',
                body: JSON.stringify(phoneLogin
                    ? { phone: identity, method: 'password', password }
                    : { username: identity, password }),
            }, '登录', { requireAuth: false });
            if (data.requires_phone_binding && data.binding_token) {
                sessionStorage.setItem(LEGACY_PHONE_BINDING_TOKEN_KEY, data.binding_token);
                sessionStorage.setItem(LEGACY_PHONE_BINDING_RETURN_KEY, getLoginRedirect(location));
                window.location.assign('/bind-phone');
                return;
            }
            if (!data.success || !data.token) {
                setError(data?.detail || data?.message || '登录失败');
                return;
            }
            const respUsername = data.username || username.trim();
            const session = await verifyAdminSession(data.token);
            setAdminSession(data.token, session.username || respUsername);
            navigate(getLoginRedirect(location), { replace: true });
        } catch (err: any) {
            setError(err?.message || '网络异常');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-screen flex items-center justify-center relative overflow-hidden bg-n0 text-n700 font-sans">
            {/* 后台保留独立的控制台网格与状态光效，避免与创作端品牌页混淆。 */}
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

            <button
                onClick={() => navigate('/')}
                className="absolute top-5 left-5 z-10 flex items-center gap-1.5 px-3 py-1.5 text-xs text-n100 hover:text-n700 transition-colors"
            >
                <ArrowLeft className="w-3.5 h-3.5" /> 返回主站
            </button>

            <div className="relative z-10 w-full max-w-md mx-4">
                <div className="text-center mb-8">
                    <BrandLogo className="mx-auto mb-3 h-12 w-auto max-w-[220px]" />
                    <h1 className="text-sm font-semibold tracking-[0.18em] text-n300">ADMIN CONSOLE</h1>
                    <p className="text-xs text-n100 mt-1.5 tracking-wider uppercase"
                      style={{ fontFamily: 'var(--font-mono)' }}>
                        Restricted · Authentication Required
                    </p>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="relative bg-n0 backdrop-blur-xl border border-n40 rounded-md p-6 shadow-bottom"
                >
                    <div className="absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

                    <div className="space-y-4">
                        <div>
                            <label className="block text-[10px] uppercase tracking-widest text-n100 mb-1.5"
                                  style={{ fontFamily: 'var(--font-mono)' }}>
                                ACCOUNT
                            </label>
                            <div className="relative">
                                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-n100" />
                                <input
                                    type="text"
                                    autoFocus
                                    autoComplete="username"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    placeholder="管理员账号或已绑定手机号"
                                    className="w-full bg-n0 border border-n40 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-md pl-10 pr-3 py-2.5 text-sm transition-all outline-none placeholder:text-n100"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] uppercase tracking-widest text-n100 mb-1.5"
                                  style={{ fontFamily: 'var(--font-mono)' }}>
                                PASSPHRASE
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-n100" />
                                <input
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full bg-n0 border border-n40 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-md pl-10 pr-3 py-2.5 text-sm transition-all outline-none placeholder:text-n100"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-r50 border border-danger/30">
                                <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                                <div className="text-xs text-danger leading-relaxed">{error}</div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary hover:bg-primary-hover disabled:bg-n0 disabled:cursor-not-allowed text-sm font-semibold text-white shadow-card hover:shadow-atlas transition-all"
                        >
                            {loading ? (
                                <>
                                    <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                    验证中…
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="w-4 h-4" /> 进入控制台
                                </>
                            )}
                        </button>
                    </div>

                    <div className="mt-5 pt-4 border-t border-n40 flex items-center justify-between text-[10px] text-n100"
                        style={{ fontFamily: 'var(--font-mono)' }}>
                        <span>SESSION · SANDBOXED</span>
                        <span>v 2026.05.26</span>
                    </div>
                </form>

                <p className="text-center text-[11px] text-n100 mt-5 leading-relaxed">
                    本控制台与主站会话隔离 · 主站登录状态不会被改动<br />
                    凭据仅在当前浏览器标签页内保留
                </p>
            </div>
        </div>
    );
};

export default AdminLoginPage;
