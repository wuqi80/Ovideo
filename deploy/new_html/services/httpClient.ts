import { pickTokenForCurrentRoute } from '../admin/adminAuth';

type HeaderMap = Record<string, string>;

interface HeaderOptions {
  requireAuth?: boolean;
  authErrorMessage?: string;
  includeContentType?: boolean;
}

interface ApiFetchConfig extends HeaderOptions {
  apiName?: string;
}

/**
 * 统一的响应处理函数
 * 2026-05-24：504 / 4xx / 5xx 的 detail 若是 dict，平铺到 Error 对象上，
 * 让上层能用 e.task_id / e.error 做精细处理（之前一律 [object Object]）。
 *
 * 2026-05-26 修复：401 处理改为路径感知 —
 *   - /admin/* 路径下 401 → 清 sessionStorage admin session，跳 /admin/login（保留 from 状态）
 *   - 其他路径 → 清 localStorage 主站 token，跳 /login（行为不变）
 *   - 在 /admin/login 或 /login 自身上 401 → 不再跳（防死循环）
 * 旧 bug：admin 路径下 401 清的是主站 token，跳 /login 又被 App.tsx 的 path="*" 兜底到 /projects。
 */
export async function handleResponse(response: Response, apiName: string = 'API'): Promise<any> {
  if (response.status === 401) {
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const isAdminPath = path.startsWith('/admin');
    const isLoginPage = path === '/login' || path === '/admin/login';
    console.error(`${apiName} 返回401，token可能已失效（path=${path}, isAdmin=${isAdminPath}）`);

    if (isAdminPath) {
      try {
        sessionStorage.removeItem('admin_session_token');
        sessionStorage.removeItem('admin_session_username');
        sessionStorage.removeItem('admin_session_login_at');
      } catch {}
      if (!isLoginPage) {
        const from = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.href = `/admin/login?redirect=${encodeURIComponent(from)}`;
      }
    } else {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('username');
      if (!isLoginPage) window.location.href = '/login';
    }
    throw new Error('未授权，请重新登录');
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    console.error(`${apiName} 返回非JSON响应 (${response.status}):`, text.substring(0, 200));
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      throw new Error(`${apiName} 返回了HTML页面而非JSON (${response.status})，可能是路由不存在或服务器错误`);
    }
    throw new Error(`${apiName} 返回了非JSON响应: ${text.substring(0, 100)}`);
  }

  let data: any;
  try {
    data = await response.json();
  } catch (e) {
    const text = await response.text();
    console.error(`${apiName} JSON解析失败:`, text.substring(0, 200));
    throw new Error(`${apiName} 返回的数据无法解析为JSON`);
  }

  if (!response.ok) {
    const detail = data?.detail ?? data?.message;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const human =
        detail.error ||
        detail.message ||
        JSON.stringify(detail);
      console.error(`${apiName} 返回错误 (${response.status}):`, detail);
      const err: any = new Error(`${apiName} 失败 (${response.status}): ${human}`);
      err.status = response.status;
      const { message: _detailMessage, ...rest } = detail as Record<string, any>;
      Object.assign(err, rest);
      throw err;
    }
    const text = typeof detail === 'string' ? detail : JSON.stringify(data);
    console.error(`${apiName} 返回错误 (${response.status}):`, text);
    const err: any = new Error(`${apiName} 失败 (${response.status}): ${text}`);
    err.status = response.status;
    throw err;
  }

  return data;
}

/**
 * 获取认证 token。
 *
 * Admin 路由下优先使用独立的 sessionStorage admin token，避免后台登录态和主站登录态互相污染。
 */
export function getAuthToken(): string | null {
  return pickTokenForCurrentRoute();
}

export function getHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

function normalizeHeaders(headers?: HeadersInit): HeaderMap {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: HeaderMap = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<HeaderMap>((out, [key, value]) => {
      out[key] = value;
      return out;
    }, {});
  }
  return { ...(headers as HeaderMap) };
}

function hasAuthorization(headers: HeaderMap): boolean {
  return Boolean(headers.Authorization || headers.authorization);
}

function withoutContentType(headers: HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key.toLowerCase() !== 'content-type') out[key] = value;
  });
  return out;
}

export function buildAuthHeaders(
  extraHeaders?: HeadersInit,
  options: HeaderOptions = {},
): HeaderMap {
  const baseHeaders = normalizeHeaders(getHeaders());
  const headers = {
    ...(options.includeContentType === false ? withoutContentType(baseHeaders) : baseHeaders),
    ...normalizeHeaders(extraHeaders),
  };

  if (options.requireAuth !== false && !hasAuthorization(headers)) {
    throw new Error(options.authErrorMessage || '未登录，请先登录');
  }

  return headers;
}

export function buildJsonHeaders(
  extraHeaders?: HeadersInit,
  options: HeaderOptions = {},
): HeaderMap {
  return buildAuthHeaders(extraHeaders, { ...options, includeContentType: true });
}

export function authTokenFromHeaders(options: HeaderOptions = {}): string {
  const headers = buildAuthHeaders(undefined, {
    requireAuth: options.requireAuth,
    authErrorMessage: options.authErrorMessage,
    includeContentType: false,
  });
  const auth = headers.Authorization || headers.authorization || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

export function secureApiUrl(url: string, options: { absolute?: boolean; requireAuth?: boolean } = {}): string {
  if (!url) return url;
  const base = options.absolute && url.startsWith('/')
    ? `${window.location.origin}${url}`
    : url;
  if (base.includes('token=')) return base;

  const token = authTokenFromHeaders({ requireAuth: options.requireAuth ?? false });
  if (!token) return base;

  return `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
  config: ApiFetchConfig = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: buildAuthHeaders(options.headers, {
      requireAuth: config.requireAuth,
      authErrorMessage: config.authErrorMessage,
      includeContentType: config.includeContentType,
    }),
  });

  if (response.status === 401) {
    await handleResponse(response, config.apiName || 'API');
  }

  return response;
}

export async function apiJson<T>(
  url: string,
  options: RequestInit = {},
  apiName: string = 'API',
  config: Omit<ApiFetchConfig, 'apiName'> = {},
): Promise<T> {
  const response = await apiFetch(url, options, { ...config, apiName });
  return handleResponse(response, apiName) as Promise<T>;
}

export async function apiBlob(
  url: string,
  options: RequestInit = {},
  apiName: string = 'API',
  config: Omit<ApiFetchConfig, 'apiName'> = {},
): Promise<Blob> {
  const response = await apiFetch(url, options, { ...config, apiName });
  if (!response.ok) {
    await handleResponse(response, apiName);
  }
  return response.blob();
}
