import { getHeaders, handleResponse } from './apiService';

type HeaderMap = Record<string, string>;

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

export function buildJsonHeaders(
  extraHeaders?: HeadersInit,
  options: { requireAuth?: boolean; authErrorMessage?: string } = {},
): HeaderMap {
  const headers = {
    ...normalizeHeaders(getHeaders()),
    ...normalizeHeaders(extraHeaders),
  };

  if (options.requireAuth !== false && !hasAuthorization(headers)) {
    throw new Error(options.authErrorMessage || '未登录，请先登录');
  }

  return headers;
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
  config: { apiName?: string; requireAuth?: boolean; authErrorMessage?: string } = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: buildJsonHeaders(options.headers, {
      requireAuth: config.requireAuth,
      authErrorMessage: config.authErrorMessage,
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
): Promise<T> {
  const response = await apiFetch(url, options, { apiName });
  return handleResponse(response, apiName) as Promise<T>;
}
