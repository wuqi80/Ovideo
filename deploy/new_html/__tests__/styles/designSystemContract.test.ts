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
    expect(login).not.toContain('transform: translateX(6px)');
    expect(login).toContain('transition: background-color 150ms ease, box-shadow 150ms ease');
    expect(login).toContain('background: transparent');
    expect(login).toContain('input:-webkit-autofill + label');
    expect(login).toContain('box-shadow: 0 0 0 1000px var(--n0) inset');
    expect(login).toContain('@media (max-width: 479px)');
    expect(login).not.toMatch(/#0052CC|#0065FF|#0747A6|#172B4D/i);
  });

  it('uses one SPTI.AI identity and favicon set across public shells', () => {
    const appHtml = readProjectFile('index.html');
    const loginHtml = readProjectFile('../login.html');
    const legacyAdminHtml = readProjectFile('../admin/index.html');
    const studioHtml = readProjectFile('../../studio/index.html');
    const header = readProjectFile('components/Header.tsx');
    const brandLogo = readProjectFile('components/BrandLogo.tsx');
    const accountMenu = readProjectFile('components/AccountMenu.tsx');
    const app = readProjectFile('App.tsx');
    const studioApp = readProjectFile('../../studio/App.tsx');

    for (const assetPath of [
      '../static/branding/spti-ai-logo-light.png',
      '../static/branding/spti-ai-logo-dark.png',
      '../static/branding/spti-ai-mark.png',
      '../static/favicon.ico',
      '../static/favicon-32x32.png',
      '../static/apple-touch-icon.png',
    ]) {
      expect(fs.statSync(path.join(projectRoot, assetPath)).size, assetPath).toBeGreaterThan(0);
    }

    expect(brandLogo).toContain('/static/branding/spti-ai-logo-light.png');
    expect(brandLogo).toContain('/static/branding/spti-ai-logo-dark.png');
    expect(brandLogo).toContain('/static/branding/spti-ai-mark.png');
    expect(brandLogo).toContain("tone = 'light'");
    expect(header).toContain('<BrandLogo');
    expect(header).not.toContain('<text x="14"');
    expect(accountMenu).toContain('个人中心');
    expect(accountMenu).toContain("window.location.href = '/profile'");
    expect(app).toContain("const ProfilePage");
    expect(app).toContain('path="/profile"');
    expect(appHtml).toContain('<title>SPTI.AI 漫剧创作平台</title>');
    expect(appHtml).not.toContain('MECHA.ONE · AI 漫剧创作平台');
    expect(appHtml).toContain('/favicon.ico?v=20260731-white-panel-v1');
    expect(appHtml).toContain('/favicon-32x32.png?v=20260731-white-panel-v1');
    expect(appHtml).toContain('/apple-touch-icon.png?v=20260731-white-panel-v1');
    expect(loginHtml).toContain('/favicon.ico?v=20260731-white-panel-v1');
    expect(loginHtml).toContain('/favicon-32x32.png?v=20260731-white-panel-v1');
    expect(loginHtml).toContain('/apple-touch-icon.png?v=20260731-white-panel-v1');
    expect(loginHtml).toContain('/static/branding/spti-ai-logo-dark.png');
    expect(loginHtml).toContain('/static/branding/spti-ai-logo-light.png');
    expect(loginHtml).not.toContain('drop-shadow(2px 0 0 rgba(255,255,255,0.98))');
    expect(legacyAdminHtml).toContain('/favicon.ico?v=20260731-white-panel-v1');
    expect(legacyAdminHtml).toContain('/static/branding/spti-ai-logo-dark.png');
    expect(studioHtml).toContain('/favicon.ico?v=20260731-white-panel-v1');
    expect(studioHtml).toContain('/apple-touch-icon.png?v=20260731-white-panel-v1');
    expect(loginHtml).not.toContain('MECHA<span class="brand-dot">.</span>ONE');
    expect(loginHtml).toContain('SPTI.ai（Story Production Technology Intelligence）意为“故事生产技术智能”，是一个基于 AI 能力打造的漫剧生产智能平台。');
    expect(studioApp).toContain("isDarkCanvas");
    expect(studioApp).toContain('/static/branding/spti-ai-logo-dark.png');
    expect(studioApp).toContain('/static/branding/spti-ai-logo-light.png');
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
    expect(projectHub).toContain('已归档');
    expect(projectHub).toContain('title="SPTI.AI 漫剧创作平台"');
    expect(projectHub).toContain('<BrandLogo className="h-8 w-auto max-w-[170px]" alt="SPTI.AI 漫剧创作平台" />');
    expect(projectHub).not.toContain('MECHA <span className="text-primary">·</span> 漫剧创作平台');
    expect(projectHub).toContain('include_archived: \'true\'');
    expect(projectHub).toContain('<AccountMenu');
    expect(projectHub).toContain('编辑项目');
    expect(projectHub).toContain('上传封面');
    expect(projectHub).toContain('object-cover object-center');
    expect(projectHub).not.toContain('含已归档');
    expect(episodeHub).toContain('全部分集');
    expect(episodeHub).toContain('草稿');
    expect(episodeHub).toContain('制作中');
    expect(episodeHub).toContain('已完成');
    expect(episodeHub).toContain('已发布');
    expect(episodeHub).toContain('title="SPTI.AI 漫剧创作平台"');
    expect(episodeHub).toContain('<BrandLogo className="h-8 w-auto max-w-[170px]" alt="SPTI.AI 漫剧创作平台" />');
    expect(episodeHub).not.toContain('MECHA <span className="text-primary">·</span> 漫剧创作平台');
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
