import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../pages/EnhancePage.tsx'), 'utf-8');

describe('EnhancePage compose audio mode', () => {
  it('defaults future compositions to reference dubbing', () => {
    expect(source).toContain(
      'useState<ComposeAudioMode>(DEFAULT_COMPOSE_AUDIO_MODE)',
    );
  });

  it('does not let a completed legacy job restore video-original mode', () => {
    expect(source).toContain(
      "if (s.status === 'running' && s.audio_mode) setComposeAudioMode(s.audio_mode)",
    );
    expect(source).not.toContain(
      'if (s.audio_mode) setComposeAudioMode(s.audio_mode)',
    );
  });

  it('warns when video-original mode would ignore timeline dubbing', () => {
    expect(source).toContain("audioClips.length > 0 && composeAudioMode === 'video_original'");
    expect(source).toContain('将忽略时间线配音');
  });
});
