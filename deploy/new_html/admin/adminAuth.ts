/**
 * adminAuth.ts — 独立 admin 会话凭据存取
 *
 * 设计要点：
 *  - 主站登录：`localStorage.auth_token`（持久）
 *  - 后台登录：`sessionStorage.admin_session_token`（仅当前标签页生命周期）
 *  - 同一浏览器可以同时以两身份运行（主站普通用户 + 另一标签 admin 后台）
 *  - apiService.getAuthToken 检测到当前路径 `/admin/*` 时优先返回本 token
 *  - 后台退出 = 清 sessionStorage，主站完全不受影响
 *  - 后端 require_admin 仍是唯一真实闸门，前端只做 UX 兜底
 */

export const ADMIN_TOKEN_KEY = 'admin_session_token';
export const ADMIN_USERNAME_KEY = 'admin_session_username';
export const ADMIN_LOGIN_AT_KEY = 'admin_session_login_at';

export function getAdminToken(): string | null {
    try {
        return sessionStorage.getItem(ADMIN_TOKEN_KEY);
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

export function setAdminSession(token: string, username: string): void {
    try {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
        sessionStorage.setItem(ADMIN_USERNAME_KEY, username);
        sessionStorage.setItem(ADMIN_LOGIN_AT_KEY, String(Date.now()));
    } catch {
        // sessionStorage 不可用时静默 fail（隐私模式 / 配额超限）
    }
}

export function clearAdminSession(): void {
    try {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        sessionStorage.removeItem(ADMIN_USERNAME_KEY);
        sessionStorage.removeItem(ADMIN_LOGIN_AT_KEY);
    } catch {}
}

export function isAdminWhitelisted(username: string | null): boolean {
    if (!username) return false;
    return username === 'admin' || username === 'lllsdhr';
}

/**
 * 路径感知的 token 优先级：
 *   - /admin/* 路径下 + 存在 admin_session_token → 返回 admin token（后端 require_admin 闸门）
 *   - 其他路径 → 返回主站 localStorage.auth_token
 *
 * 该函数被 apiService.getAuthToken() 间接调用；也被 AdminFeatureTabs 直接用。
 */
export function pickTokenForCurrentRoute(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        if (window.location.pathname.startsWith('/admin')) {
            const adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
            if (adminToken) return adminToken;
        }
    } catch {}
    try {
        return localStorage.getItem('auth_token');
    } catch {
        return null;
    }
}
