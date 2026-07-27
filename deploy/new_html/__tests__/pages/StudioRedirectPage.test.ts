import { describe, expect, it } from 'vitest';
import { buildStudioUrl } from '../../pages/StudioRedirectPage';

describe('StudioRedirectPage', () => {
  it('preserves the project and episode scope in the Studio URL', () => {
    expect(buildStudioUrl('project A', 'episode/1')).toBe(
      '/studio/?projectId=project+A&episodeId=episode%2F1&returnTo=%2Fprojects%2Fproject+A%2Fep%2Fepisode%2F1',
    );
  });
});
