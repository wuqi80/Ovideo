import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const accountsSource = readFileSync(resolve(__dirname, '../../components/AdminFeatureTabs.tsx'), 'utf-8');
const authSource = readFileSync(resolve(__dirname, '../../admin/adminAuth.ts'), 'utf-8');
const loginSource = readFileSync(resolve(__dirname, '../../admin/AdminLoginPage.tsx'), 'utf-8');
const layoutSource = readFileSync(resolve(__dirname, '../../admin/AdminLayout.tsx'), 'utf-8');

describe('admin username management contract', () => {
  it('exposes an account rename action backed by the stable user id', () => {
    expect(accountsSource).toContain('>修改用户名</CrmActionLink>');
    expect(accountsSource).toContain('`/api/admin/users/${uid}/username`');
    expect(accountsSource).toContain('setAdminSession(result.session.token, result.session.username)');
    expect(accountsSource).toContain("disabled={u.user_id === 'admin'}");
  });

  it('uses the backend role gate instead of a hard-coded username whitelist', () => {
    expect(authSource).not.toContain('isAdminWhitelisted');
    expect(loginSource).not.toContain('isAdminWhitelisted');
    expect(layoutSource).not.toContain('isAdminWhitelisted');
    expect(loginSource).toContain("verifyAdminSession(data.token)");
    expect(loginSource).toContain("'/api/admin/session'");
  });
});
