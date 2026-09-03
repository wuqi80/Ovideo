/**
 * adminAuth.ts — 后台角色校验结果缓存
 *
 * 设计要点：
 *  - 主站登录：`localStorage.auth_token`（持久），也是进入后台的第一层凭据
 *  - 后台仅缓存已校验的身份显示信息，不提供第二套账号密码登录
 *  - 后端 `/api/admin/session` 与 `require_admin` 是管理员角色的第二层真实闸门
 *  - 后端 require_admin 仍是唯一真实闸门，前端只做 UX 兜底
 */

import { isAdminPath } from './adminRoute';

export const ADMIN_TOKEN_KEY = 'admin_session_token';
export const ADMIN_USERNAME_KEY = 'admin_session_username';
export const ADMIN_LOGIN_AT_KEY = 'admin_session_login_at';
export const ADMIN_ROLE_KEY = 'admin_session_role';

export function getAdminToken(): string | null {
    try {
        return localStorage.getItem('auth_token');
    } catch {
        return null;
    }
}

export function getAdminUsername(): string | null {
    try {
        return sessionStorage.getItem(ADMIN_USERNAME_KEY);
    } catch {
        return null;
    }
}

export function getAdminRole(): string | null {
    try {
        return sessionStorage.getItem(ADMIN_ROLE_KEY);
    } catch {
        return null;
    }
}

export function setAdminSession(token: string, username: string, role?: string): void {
    try {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
        sessionStorage.setItem(ADMIN_USERNAME_KEY, username);
        sessionStorage.setItem(ADMIN_LOGIN_AT_KEY, String(Date.now()));
        if (role) sessionStorage.setItem(ADMIN_ROLE_KEY, role);
    } catch {
        // sessionStorage 不可用时静默 fail（隐私模式 / 配额超限）
    }
}

export function clearAdminSession(): void {
    try {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        sessionStorage.removeItem(ADMIN_USERNAME_KEY);
        sessionStorage.removeItem(ADMIN_LOGIN_AT_KEY);
        sessionStorage.removeItem(ADMIN_ROLE_KEY);
    } catch {}
}

/**
 * 路径感知的 token 优先级：
 * 后台与前台使用同一主站 token；后台页面只在角色校验成功后渲染。
 *
 * 该函数被 apiService.getAuthToken() 间接调用。
 */
export function pickTokenForCurrentRoute(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        if (isAdminPath(window.location.pathname)) return localStorage.getItem('auth_token');
    } catch {}
    try {
        return localStorage.getItem('auth_token');
    } catch {
        return null;
    }
}
