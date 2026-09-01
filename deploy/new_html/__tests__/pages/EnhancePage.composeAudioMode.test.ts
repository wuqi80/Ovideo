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

  it('exposes voice, music and sound-effect entry points with separate timeline lanes', () => {
    expect(source).toContain('加入配音');
    expect(source).toContain('背景音乐');
    expect(source).toContain('特效音');
    expect(source).toContain("{ key: 'voice', clips: voiceClips }");
    expect(source).toContain("{ key: 'bgm', clips: bgmClips }");
    expect(source).toContain("{ key: 'sfx', clips: sfxClips }");
  });

  it('offers precise audio alignment controls instead of drag-only editing', () => {
    expect(source).toContain('对齐当前视频片段');
    expect(source).toContain('移到播放头');
    expect(source).toContain('开始时间（秒）');
    expect(source).toContain('使用时长（秒）');
  });

  it('shows queue acceptance and processing failures inside the page', () => {
    expect(source).toContain('任务已进入处理队列');
    expect(source).toContain('role="alert"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('setEnhanceError(`提交');
  });
});
