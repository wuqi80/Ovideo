import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../layouts/WorkflowLayout.tsx'), 'utf-8');

describe('WorkflowLayout account summary', () => {
  it('shows the signed-in username before logout', () => {
    expect(source).toContain("localStorage.getItem('username') || '用户'");
    expect(source).toContain('aria-label={`当前用户：${username}`}');
    expect(source).toContain('<UserRound');
  });

  it('shows the available credit balance and links to the credits page', () => {
    expect(source).toContain('await getCreditBalance()');
    expect(source).toContain('balance.available_credits');
    expect(source).toContain("onClick={() => navigate('/credits')}");
    expect(source).toContain('<Coins');
    expect(source).toContain('availableCredits.toLocaleString()');
  });

  it('does not translate the logout button on hover', () => {
    expect(source).not.toContain('button-shift');
  });
});
