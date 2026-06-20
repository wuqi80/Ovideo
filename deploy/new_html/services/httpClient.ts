import { getHeaders, handleResponse } from './apiService';

type HeaderMap = Record<string, string>;

interface HeaderOptions {
  requireAuth?: boolean;
  authErrorMessage?: string;
  includeContentType?: boolean;
}

interface ApiFetchConfig extends HeaderOptions {
  apiName?: string;
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
