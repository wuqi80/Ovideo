import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const loginHtml = readFileSync(resolve(__dirname, '../../../login.html'), 'utf-8');

describe('unified account and phone login contract', () => {
  it('uses one password-login identity field without a separate legacy entry', () => {
    expect(loginHtml).toContain("authSubtitle.textContent = '使用手机号继续完成你的故事'");
    expect(loginHtml).toContain("state.method === 'password' ? 'text' : 'tel',\n                    '手机号',");
    expect(loginHtml).not.toContain('手机号或原账号');
    expect(loginHtml).toContain("authFooter.innerHTML = `还没有账号？ ${footerButton('创建账号', 'register')}`");
    expect(loginHtml).not.toContain("footerButton('旧账号登录', 'legacy')");
    expect(loginHtml).not.toContain("state.view === 'legacy'");
  });

  it('routes password identities by phone shape and preserves mandatory binding', () => {
    expect(loginHtml).toContain("const identity = field('identity')");
    expect(loginHtml).toContain("const phoneLogin = isMainlandPhone(identity)");
    expect(loginHtml).toContain("await api('/api/login', { username: identity, password: field('password') })");
    expect(loginHtml).toContain("await api('/api/auth/phone/login'");
    expect(loginHtml).toContain('result.requires_phone_binding && result.binding_token');
    expect(loginHtml).toContain("setView('bind')");
  });

  it('keeps verification-code login phone-only and normalizes old bookmarks', () => {
    expect(loginHtml).toContain("state.method === 'sms_code' && !phoneLogin");
    expect(loginHtml).toContain("location.pathname === '/legacy-login'");
    expect(loginHtml).toContain("history.replaceState(null, '', '/login')");
  });

  it('validates new passwords locally and renders structured API errors readably', () => {
    expect(loginHtml).toContain('minlength="8" maxlength="128"');
    expect(loginHtml).toContain("if (field('password').length < 8) throw new Error('密码至少需要 8 位')");
    expect(loginHtml).toContain('function validationErrorMessage(payload');
    expect(loginHtml).toContain("item.type === 'string_too_short'");
    expect(loginHtml).toContain('throw new Error(validationErrorMessage(payload))');
    expect(loginHtml).not.toContain("throw new Error(payload.detail || payload.error || '请求失败，请稍后重试')");
  });
});
