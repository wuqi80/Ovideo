import { pickTokenForCurrentRoute } from '../admin/adminAuth';
import { apiJson } from './httpClient';

export interface CurrentAdminSession {
  user_id: string;
  username: string;
  role: 'admin' | 'super_admin';
}

let cachedToken = '';
let cachedRequest: Promise<CurrentAdminSession | null> | null = null;

/**
 * Resolve whether the currently logged-in creator account may enter the admin
 * shell. This controls visibility only; every admin API still performs its own
 * server-side role check.
 */
export function getCurrentAdminSession(): Promise<CurrentAdminSession | null> {
  const token = pickTokenForCurrentRoute() || '';
  if (!token) return Promise.resolve(null);
  if (cachedRequest && cachedToken === token) return cachedRequest;

  cachedToken = token;
  cachedRequest = apiJson<CurrentAdminSession>('/api/admin/session', { method: 'GET' }, '后台入口权限校验')
    .then(session => session?.role === 'admin' || session?.role === 'super_admin' ? session : null)
    .catch(() => null);
  return cachedRequest;
}

export function clearAdminAccessCache(): void {
  cachedToken = '';
  cachedRequest = null;
}
