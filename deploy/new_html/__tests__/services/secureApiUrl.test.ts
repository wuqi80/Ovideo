import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { secureApiUrl } from '../../services/httpClient';

describe('secureApiUrl token 刷新', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('给无 token 的 URL 注入当前 token', () => {
    localStorage.setItem('auth_token', 'fresh-1');
    expect(secureApiUrl('/storage/audio/x.mp3')).toBe('/storage/audio/x.mp3?token=fresh-1');
  });

  it('用当前 token 覆盖 URL 里已过期的旧 token（隔天消失根因）', () => {
    localStorage.setItem('auth_token', 'fresh-2');
    const stale = '/storage/audio/x.mp3?token=expired-yesterday';
    expect(secureApiUrl(stale)).toBe('/storage/audio/x.mp3?token=fresh-2');
  });

  it('保留其它查询参数，仅替换 token', () => {
    localStorage.setItem('auth_token', 'fresh-3');
    const url = '/api/file?id=42&token=old&v=2';
    const out = secureApiUrl(url);
    expect(out).toContain('id=42');
    expect(out).toContain('v=2');
    expect(out).toContain('token=fresh-3');
    expect(out).not.toContain('token=old');
  });

  it('未登录（无 token）时保持原样，不删除已有 token', () => {
    const url = '/storage/audio/x.mp3?token=whatever';
    expect(secureApiUrl(url)).toBe(url);
  });
});
