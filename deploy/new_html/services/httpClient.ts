import { pickTokenForCurrentRoute } from '../admin/adminAuth';
import { isAdminPath } from '../admin/adminRoute';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';

type HeaderMap = Record<string, string>;

interface HeaderOptions {
  requireAuth?: boolean;
  authErrorMessage?: string;
  includeContentType?: boolean;
  includeAuth?: boolean;
  apiName?: string;
  redirectOnMissingAuth?: boolean;
}

interface ApiFetchConfig extends HeaderOptions {}

/**
 * 统一的响应处理函数
 * 2026-05-24：504 / 4xx / 5xx 的 detail 若是 dict，平铺到 Error 对象上，
 * 让上层能用 e.task_id / e.error 做精细处理（之前一律 [object Object]）。
 *
 * 后台与前台共用主站登录 token。后台路径发生 401 时清除失效的主站会话，
 * 跳到公开登录页，并保留通过校验的同源后台回跳地址。
 *
 * 2026-07-01 修复：缺少本地 token 的受保护 API 请求也会走这里。
 * 旧行为是在 buildAuthHeaders 阶段直接抛“未登录”，请求尚未发出，因此绕过了 401 跳转。
 */
export function handleUnauthorized(apiName: string = 'API', reason: 'response401' | 'missingToken' = 'response401'): never {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const adminRoute = isAdminPath(path);
  const isLoginPage = path === '/login';
  const reasonText = reason === 'missingToken'
    ? '缺少登录 token'
    : '返回401，token可能已失效';
  console.error(`${apiName} ${reasonText}（path=${path}, isAdmin=${adminRoute}）`);

  if (adminRoute) {
    try {
      sessionStorage.removeItem('admin_session_token');
      sessionStorage.removeItem('admin_session_username');
      sessionStorage.removeItem('admin_session_login_at');
      sessionStorage.removeItem('admin_session_role');
    } catch {}
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    if (!isLoginPage) {
      const from = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.href = `/login?redirect=${encodeURIComponent(from)}`;
    }
  } else {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    if (!isLoginPage) window.location.href = '/login';
  }
  throw new Error('未授权，请重新登录');
}

export async function handleResponse(response: Response, apiName: string = 'API'): Promise<any> {
  const publicApiName = sanitizeProcessingTerminology(apiName);
  if (response.status === 401) {
    handleUnauthorized(apiName);
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    console.error(`${publicApiName} 返回非JSON响应 (${response.status}):`, sanitizeProcessingTerminology(text.substring(0, 200)));
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      throw new Error(`${publicApiName} 返回了HTML页面而非JSON (${response.status})，可能是路由不存在或服务器错误`);
    }
    throw new Error(`${publicApiName} 返回了非JSON响应: ${sanitizeProcessingTerminology(text.substring(0, 100))}`);
  }

  let data: any;
  try {
    data = await response.json();
  } catch (e) {
    const text = await response.text();
    console.error(`${publicApiName} JSON解析失败:`, sanitizeProcessingTerminology(text.substring(0, 200)));
    throw new Error(`${publicApiName} 返回的数据无法解析为JSON`);
  }

  if (!response.ok) {
    const detail = data?.detail ?? data?.message;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const human =
        detail.error ||
        detail.message ||
        JSON.stringify(detail);
      console.error(`${publicApiName} 返回错误 (${response.status}):`, sanitizeProcessingTerminology(JSON.stringify(detail)));
      const err: any = new Error(`${publicApiName} 失败 (${response.status}): ${sanitizeProcessingTerminology(human)}`);
      err.status = response.status;
      const { message: _detailMessage, ...rest } = detail as Record<string, any>;
      Object.assign(err, rest);
      throw err;
    }
    const text = typeof detail === 'string' ? detail : JSON.stringify(data);
    console.error(`${publicApiName} 返回错误 (${response.status}):`, sanitizeProcessingTerminology(text));
    const err: any = new Error(`${publicApiName} 失败 (${response.status}): ${sanitizeProcessingTerminology(text)}`);
    err.status = response.status;
    throw err;
  }

  return data;
}

/**
 * 获取认证 token。
 *
 * 前台与后台统一使用主站登录 token；后台角色由服务端逐请求校验。
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

function withoutAuthorization(headers: HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key.toLowerCase() !== 'authorization') out[key] = value;
  });
  return out;
}

export function buildAuthHeaders(
  extraHeaders?: HeadersInit,
  options: HeaderOptions = {},
): HeaderMap {
  const normalizedBaseHeaders = normalizeHeaders(getHeaders());
  const baseHeaders = options.includeAuth === false
    ? withoutAuthorization(normalizedBaseHeaders)
    : normalizedBaseHeaders;
  const headers = {
    ...(options.includeContentType === false ? withoutContentType(baseHeaders) : baseHeaders),
    ...normalizeHeaders(extraHeaders),
  };

  if (options.requireAuth !== false && options.includeAuth !== false && !hasAuthorization(headers)) {
    if (options.redirectOnMissingAuth) {
      handleUnauthorized(options.apiName || 'API', 'missingToken');
    }
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

/** 从 URL 的查询串里移除任何 token= 参数（保留 path、其余 query 和 #fragment）。 */
function stripTokenParam(url: string): string {
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = noHash.indexOf('?');
  if (qIdx < 0) return url;
  const path = noHash.slice(0, qIdx);
  const kept = noHash
    .slice(qIdx + 1)
    .split('&')
    .filter(part => part && !/^token=/i.test(part));
  return kept.length ? `${path}?${kept.join('&')}${hash}` : `${path}${hash}`;
}

export function secureApiUrl(url: string, options: { absolute?: boolean; requireAuth?: boolean } = {}): string {
  if (!url) return url;
  const base = options.absolute && url.startsWith('/')
    ? `${window.location.origin}${url}`
    : url;

  const token = authTokenFromHeaders({ requireAuth: options.requireAuth ?? false });
  // 没有可用 token 时保持原样（无法做得更好，也不要把仅有的旧 token 删掉）。
  if (!token) return base;

  // 关键：始终用当前 token 覆盖 URL 里可能已过期的旧 token。
  // 媒体 <img>/<video> 无法携带 Authorization 头，只能把 JWT 拼进 ?token=。
  // JWT 默认 24h 过期，若某个带旧 token 的 URL 被持久化下来，旧逻辑“已含 token 就跳过”
  // 会导致隔天 token 失效后媒体 401 消失（配音/分镜“隔天不见”）。先剥旧再注新可自愈。
  const cleaned = stripTokenParam(base);
  return `${cleaned}${cleaned.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
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
      apiName: config.apiName,
      redirectOnMissingAuth: true,
    }),
  });

  if (response.status === 401) {
    await handleResponse(response, config.apiName || 'API');
  }

  return response;
}

export async function publicFetch(
  url: string,
  options: RequestInit = {},
  config: Pick<ApiFetchConfig, 'apiName' | 'includeContentType'> = {},
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: buildAuthHeaders(options.headers, {
      requireAuth: false,
      includeAuth: false,
      includeContentType: config.includeContentType,
    }),
  });
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

/** Use an explicit one-off token before a route-scoped session has been stored. */
export async function apiJsonWithToken<T>(
  url: string,
  token: string,
  options: RequestInit = {},
  apiName: string = 'API',
): Promise<T> {
  const headers = normalizeHeaders(options.headers);
  headers.Authorization = `Bearer ${token}`;
  return apiJson<T>(url, { ...options, headers }, apiName, { requireAuth: false });
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

export async function publicBlob(
  url: string,
  options: RequestInit = {},
  apiName: string = 'Public Blob',
  config: Pick<ApiFetchConfig, 'includeContentType'> = {},
): Promise<Blob> {
  const response = await publicFetch(url, options, {
    apiName,
    includeContentType: config.includeContentType ?? false,
  });
  if (!response.ok) {
    throw new Error(`${apiName} failed (${response.status})`);
  }
  return response.blob();
}
