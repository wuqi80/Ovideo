import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const adminLogin = readFileSync(resolve(__dirname, '../../admin/AdminLoginPage.tsx'), 'utf-8');
const publicLogin = readFileSync(resolve(__dirname, '../../../login.html'), 'utf-8');

describe('admin verified-phone migration contract', () => {
  it('sends unbound legacy admins into the existing verified-phone binding flow', () => {
    expect(adminLogin).toContain('data.requires_phone_binding && data.binding_token');
    expect(adminLogin).toContain("sessionStorage.setItem(LEGACY_PHONE_BINDING_TOKEN_KEY, data.binding_token)");
    expect(adminLogin).toContain("window.location.assign('/bind-phone')");
  });

  it('allows migrated admins to use their bound phone and existing password', () => {
    expect(adminLogin).toContain("phoneLogin ? '/api/auth/phone/login' : '/api/login'");
    expect(adminLogin).toContain("{ phone: identity, method: 'password', password }");
    expect(adminLogin).toContain('管理员账号或已绑定手机号');
  });

  it('returns a newly bound admin to the isolated admin session', () => {
    expect(publicLogin).toContain("const BINDING_RETURN_KEY = 'legacy_phone_binding_return_to'");
    expect(publicLogin).toContain("state.view === 'bind' && Boolean(sessionStorage.getItem(BINDING_TOKEN_KEY))");
    expect(publicLogin).toContain("/^\\/admin(?:\\/|\\?|#|$)/.test(bindingReturn || '')");
    expect(publicLogin).toContain("sessionStorage.setItem('admin_session_token', result.token)");
    expect(publicLogin).toContain('sessionStorage.removeItem(BINDING_TOKEN_KEY)');
    expect(publicLogin).toContain('window.location.href = bindingReturn');
  });
});
