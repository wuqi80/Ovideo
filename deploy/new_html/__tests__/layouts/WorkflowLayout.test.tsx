import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../layouts/WorkflowLayout.tsx'), 'utf-8');
const tokenSource = readFileSync(resolve(__dirname, '../../styles/design-tokens.css'), 'utf-8');
const workspaceSource = readFileSync(resolve(__dirname, '../../WorkspaceApp.tsx'), 'utf-8');
const designSource = readFileSync(resolve(__dirname, '../../pages/DesignPage.tsx'), 'utf-8');
const materialSource = readFileSync(resolve(__dirname, '../../components/MaterialPage.tsx'), 'utf-8');
const audioSource = readFileSync(resolve(__dirname, '../../pages/AudioStagePage.tsx'), 'utf-8');
const voiceSidebarSource = readFileSync(resolve(__dirname, '../../components/audio/VoiceSidebar.tsx'), 'utf-8');
const dubbingPanelSource = readFileSync(resolve(__dirname, '../../components/audio/DubbingPanel.tsx'), 'utf-8');
const storyboardSource = readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf-8');
const videoSource = readFileSync(resolve(__dirname, '../../components/VideoPage.tsx'), 'utf-8');
const enhanceSource = readFileSync(resolve(__dirname, '../../pages/EnhancePage.tsx'), 'utf-8');
const mediaLibrarySource = readFileSync(resolve(__dirname, '../../pages/MediaLibraryPage.tsx'), 'utf-8');

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

describe('WorkflowLayout visual workspace shell', () => {
  it('keeps the workflow navigation and account actions in one fixed header', () => {
    expect(source).toContain("import BrandLogo from '../components/BrandLogo'");
    expect(source).toContain('className="workflow-shell-header');
    expect(source).toContain('aria-label="流程化制作导航"');
    expect(source).toContain('<NotificationPanel compact />');
    expect(source).toContain('<AccountMenu compact />');
    expect(source).toContain('className="workflow-shell-workspace');
  });

  it('defines isolated white sidebar and gray canvas scroll regions', () => {
    expect(tokenSource).toMatch(/\.workflow-stage-layout\s*\{[\s\S]*?overflow:\s*hidden;/);
    expect(tokenSource).toMatch(/\.workflow-stage-sidebar\s*\{[\s\S]*?background:\s*var\(--n0\);/);
    expect(tokenSource).toMatch(/\.workflow-stage-canvas\s*\{[\s\S]*?background:\s*var\(--n20\);/);
    expect(tokenSource).toMatch(/\.workflow-stage-scroll\s*\{[\s\S]*?overflow:\s*auto;/);
    expect(tokenSource).toContain('overscroll-behavior: contain');
  });

  it.each([
    ['script', workspaceSource],
    ['design', designSource],
    ['materials', materialSource],
    ['audio', `${audioSource}\n${voiceSidebarSource}\n${dubbingPanelSource}`],
    ['storyboard', storyboardSource],
    ['video', videoSource],
    ['enhance', enhanceSource],
    ['media library', mediaLibrarySource],
  ])('uses the shared sidebar and canvas contract on %s', (_name, pageSource) => {
    expect(pageSource).toContain('workflow-stage-sidebar');
    expect(pageSource).toContain('workflow-stage-canvas');
  });
});
