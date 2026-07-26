import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

const readProjectFile = (relativePath: string): string =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

describe('Webflow design-system contract', () => {
  it('keeps the source-of-truth palette aligned across CSS and Tailwind', () => {
    const css = readProjectFile('styles/design-tokens.css');
    const tailwind = readProjectFile('tailwind.config.cjs');

    for (const color of [
      '#080808',
      '#146EF5',
      '#3B89FF',
      '#006ACC',
      '#0055D4',
      '#7A3DFF',
      '#ED52CB',
      '#00D722',
      '#FF6B00',
      '#FFAE13',
      '#EE1D36',
      '#D8D8D8',
      '#898989',
      '#ABABAB',
      '#5A5A5A',
    ]) {
      expect(css.toUpperCase()).toContain(color);
      expect(tailwind.toUpperCase()).toContain(color);
    }
  });

  it('clamps functional radii and uses the five-layer floating shadow', () => {
    const css = readProjectFile('styles/design-tokens.css');

    expect(css).toContain('--radius-base: 4px');
    expect(css).toContain('--radius-lg: 8px');
    expect(css).toMatch(/\.rounded-lg,\s*\n\.rounded-xl,\s*\n\.rounded-2xl,\s*\n\.rounded-3xl\s*\{\s*border-radius: var\(--radius-lg\)/);
    expect(css).toContain('rgba(0, 0, 0, 0.09) 0 3px 7px');
  });

  it('provides one responsive overlay and dialog surface contract', () => {
    const css = readProjectFile('styles/design-tokens.css');

    expect(css).toContain('.app-modal-backdrop');
    expect(css).toContain('.app-modal-surface');
    expect(css).toContain('.app-modal-header');
    expect(css).toContain('.app-modal-body');
    expect(css).toContain('.app-modal-footer');
    expect(css).toContain('.app-drawer-backdrop');
    expect(css).toContain('.app-drawer-surface');
    expect(css).toContain('@media (max-width: 479px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('migrates dedicated modal components onto the shared surface', () => {
    const modalFiles = [
      'components/AIRewritePromptModal.tsx',
      'components/ConfirmDialog.tsx',
      'components/CreditEstimateModal.tsx',
      'components/ImageFusionModal.tsx',
      'components/MattingModal.tsx',
      'components/ProjectHub.tsx',
      'components/SeedanceAssetPickerModal.tsx',
      'components/ShareResourceDialog.tsx',
      'components/StoryboardToolModal.tsx',
      'components/audio/MusicModal.tsx',
      'components/audio/SfxModal.tsx',
      'components/video/SeedanceDetailModal.tsx',
      'components/video/StoryboardSyncModal.tsx',
    ];

    for (const modalFile of modalFiles) {
      const source = readProjectFile(modalFile);
      expect(source, modalFile).toContain('app-modal-backdrop');
      expect(source, modalFile).toContain('app-modal-surface');
      expect(source, modalFile).toContain('aria-modal="true"');
    }

    const voiceDrawer = readProjectFile('components/audio/VoiceSidebar.tsx');
    expect(voiceDrawer).toContain('app-drawer-backdrop');
    expect(voiceDrawer).toContain('app-drawer-surface');
    expect(voiceDrawer).toContain('aria-modal="true"');
  });

  it('loads the theme globally without an inline legacy page color', () => {
    const html = readProjectFile('index.html');

    expect(html).toContain('class="theme-webflow');
    expect(html).not.toContain('style="background-color:');
  });

  it('keeps the standalone unauthenticated login page on the same Webflow system', () => {
    const login = readProjectFile('../login.html');

    expect(login).toContain('--primary: #146EF5');
    expect(login).toContain('--n800: #080808');
    expect(login).toContain('--n40: #D8D8D8');
    expect(login).toContain('"WF Visual Sans Variable"');
    expect(login).toContain('var(--shadow-cascade)');
    expect(login).toContain('transform: translateX(6px)');
    expect(login).toContain('@media (max-width: 479px)');
    expect(login).not.toMatch(/#0052CC|#0065FF|#0747A6|#172B4D/i);
  });

  it('uses one MECHA.ONE identity and favicon set across public shells', () => {
    const appHtml = readProjectFile('index.html');
    const loginHtml = readProjectFile('../login.html');
    const header = readProjectFile('components/Header.tsx');
    const brandLogo = readProjectFile('components/BrandLogo.tsx');

    for (const assetPath of [
      '../static/branding/mecha-one-logo.png',
      '../static/branding/mecha-one-mark.png',
      '../static/favicon.ico',
      '../static/favicon-32x32.png',
      '../static/apple-touch-icon.png',
    ]) {
      expect(fs.statSync(path.join(projectRoot, assetPath)).size, assetPath).toBeGreaterThan(0);
    }

    expect(brandLogo).toContain('/static/branding/mecha-one-logo.png');
    expect(brandLogo).toContain('/static/branding/mecha-one-mark.png');
    expect(header).toContain('<BrandLogo');
    expect(header).not.toContain('<text x="14"');
    expect(appHtml).toContain('/static/favicon.ico');
    expect(loginHtml).toContain('/static/favicon.ico');
    expect(loginHtml).toContain('/static/branding/mecha-one-mark.png');
    expect(loginHtml).toContain('MECHA<span class="brand-dot">.</span>ONE');
  });

  it('keeps project and episode hubs on the shared centered media-library shell', () => {
    const projectHub = readProjectFile('components/ProjectHub.tsx');
    const episodeHub = readProjectFile('pages/EpisodeHubPage.tsx');

    for (const source of [projectHub, episodeHub]) {
      expect(source).toContain("max-w-[1320px]");
      expect(source).toContain('min-h-screen bg-n20');
      expect(source).toContain('<BrandLogo');
      expect(source).toContain('border-y border-n40');
      expect(source).toContain('shadow-atlas');
    }

    expect(projectHub).toContain('全部项目');
    expect(projectHub).toContain('含已归档');
    expect(episodeHub).toContain('全部分集');
    expect(episodeHub).toContain('app-modal-backdrop');
    expect(episodeHub).toContain('aria-modal="true"');
    expect(episodeHub).toContain('流程化制作');
    expect(episodeHub).toContain('自由创作');
  });

  it('does not reintroduce dark neutral utilities into product source', () => {
    const sourceRoots = [
      'admin',
      'canvas',
      'components',
      'contexts',
      'hooks',
      'layouts',
      'pages',
      'services',
      'utils',
    ];
    const sourceFiles: string[] = [];

    const collectFiles = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) collectFiles(absolutePath);
        if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(absolutePath);
      }
    };

    for (const sourceRoot of sourceRoots) collectFiles(path.join(projectRoot, sourceRoot));

    const forbiddenNeutral = /\b(?:bg|text|border|ring|from|via|to)-(?:gray|slate|zinc|neutral|stone|indigo)-\d+(?:\/\d+)?\b/;
    const forbiddenDarkStatus = /\b(?:bg|border|text)-(?:red|amber|yellow|orange|green|emerald|teal|cyan|sky|blue|purple|pink)-(?:800|900|950)(?:\/\d+)?\b/;

    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(sourceFile, 'utf8');
      expect(source, path.relative(projectRoot, sourceFile)).not.toMatch(forbiddenNeutral);
      expect(source, path.relative(projectRoot, sourceFile)).not.toMatch(forbiddenDarkStatus);
    }
  });
});
