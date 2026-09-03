import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStudioUrl } from '../../pages/StudioRedirectPage';

const source = readFileSync(resolve(__dirname, '../../pages/StudioRedirectPage.tsx'), 'utf-8');

describe('StudioRedirectPage', () => {
  it('preserves the project and episode scope in the Studio URL', () => {
    expect(buildStudioUrl('project A', 'episode/1')).toBe(
      '/studio/?projectId=project+A&episodeId=episode%2F1&returnTo=%2Fprojects%2Fproject+A%2Fep%2Fepisode%2F1%2Fworkflow%2Fscript',
    );
  });

  it('hosts the isolated Studio inside the global navigation shell', () => {
    expect(source).toContain('<AppSidebar');
    expect(source).toContain('<iframe');
    expect(source).toContain('title="专业画布"');
    expect(source).not.toContain('window.location.replace');
  });
});
