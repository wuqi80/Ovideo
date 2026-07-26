import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../layouts/WorkflowLayout.tsx'), 'utf-8');

describe('WorkflowLayout account summary', () => {
  it('uses the shared account dropdown before the credit balance', () => {
    expect(source).toContain("import AccountMenu from '../components/AccountMenu'");
    expect(source).toContain('<AccountMenu compact />');
    expect(source).not.toContain("localStorage.getItem('username')");
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
