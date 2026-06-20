import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../services/audioGenerationService', () => ({
  // 2026-05-25：试听切到 fast-path /api/minimax/tts/sync 一次拿结果。
  // minimaxTTS（worker 路径）保留 mock，因为别处仍可能用，但 system 试听不再调它。
  minimaxTTSSync: vi.fn().mockResolvedValue({
    success: true,
    audio_url: '/storage/audio/preview_x.mp3',
    file_id: 'fid-99',
    file_url: '/storage/audio/preview_x.mp3',
    duration_ms: 1500,
  }),
  minimaxTTS: vi.fn(),
  minimaxVoiceDesign: vi.fn(),
  minimaxFileUpload: vi.fn(),
  minimaxVoiceClone: vi.fn(),
  createCharacterVoice: vi.fn(),
  updateCharacterVoice: vi.fn(),
  deleteCharacterVoice: vi.fn(),
}));

// 2026-05-25：fast-path 不再依赖 ttsTaskPoller。保留 mock 以防其它消费方（如
// AudioStagePage）的间接 import 链路触发副作用。
vi.mock('../../services/ttsTaskPoller', () => ({
  pollTtsTaskUntilDone: vi.fn(),
  TtsTimeoutError: class extends Error {},
}));

// Import AFTER vi.mock so the component picks up the mocked modules.
// 测试 VoiceDrawer 是因为它直接 own handlePreview；外层 VoiceSidebar 只是 conditional render。
import { VoiceDrawer } from '../../components/audio/VoiceSidebar';
import { clearVoicePreview } from '../../utils/voicePreviewCache';

const MOCK_ROLE_NO_VOICE = { name: '测试角色', voice: null, asset: null } as any;

const baseProps = {
  roleName: '测试角色',
  role: MOCK_ROLE_NO_VOICE,
  projectId: 'p1',
  onClose: () => {},
  onSaved: async () => {},
};

describe('VoiceSidebar.handlePreview — fast-path 同步 (2026-05-25)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // voicePreviewCache 用 module-level singleton + localStorage 双层持久化。
    // 仅 localStorage.clear() 不够：内存里的 memory 对象不会被刷掉，会让 test 2
    // 还看到 test 1 留下的 audioUrl，从而 "试听" 按钮变成 "重新生成" 导致 getByRole 失败。
    clearVoicePreview();
    localStorage.clear();
  });

  it('点击试听后调 minimaxTTSSync 一次拿到 audio_url（不再轮询）', async () => {
    const { minimaxTTSSync, minimaxTTS } = await import('../../services/audioGenerationService');
    const { pollTtsTaskUntilDone } = await import('../../services/ttsTaskPoller');

    render(<VoiceDrawer {...baseProps} open />);
    fireEvent.click(screen.getByRole('button', { name: /试听/ }));

    await waitFor(() => {
      expect(minimaxTTSSync).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.any(String), voice_id: expect.any(String) }),
        expect.any(AbortSignal),
      );
    });

    // 显式守护：worker 路径不再被走
    expect(minimaxTTS).not.toHaveBeenCalled();
    expect(pollTtsTaskUntilDone).not.toHaveBeenCalled();

    // audio element 应直接拿到 fast-path 返回的 url
    await waitFor(() => {
      const audio = document.querySelector('audio') as HTMLAudioElement | null;
      expect(audio).toBeTruthy();
      expect(audio!.src).toContain('/storage/audio/preview_x.mp3');
    });
  });

  it('Drawer 关闭时 AbortController 必须取消进行中的 fast-path 请求', async () => {
    const { minimaxTTSSync } = await import('../../services/audioGenerationService');
    let abortSignal: AbortSignal | undefined;
    (minimaxTTSSync as any).mockImplementation((_p: any, signal: AbortSignal) => {
      abortSignal = signal;
      return new Promise(() => {}); // 永不完成 — 模拟还在等待 MiniMax 返回
    });

    const { rerender } = render(<VoiceDrawer {...baseProps} open />);
    fireEvent.click(screen.getByRole('button', { name: /试听/ }));
    await waitFor(() => expect(abortSignal).toBeDefined());

    rerender(<VoiceDrawer {...baseProps} open={false} />);
    expect(abortSignal?.aborted).toBe(true);
  });

  it('克隆模式点击生成试听会上传音频并调用 voice-clone', async () => {
    const { minimaxFileUpload, minimaxVoiceClone, minimaxTTSSync } = await import('../../services/audioGenerationService');
    (minimaxFileUpload as any).mockResolvedValue({ success: true, file_id: '123456789' });
    (minimaxVoiceClone as any).mockResolvedValue({
      success: true,
      voice_id: 'clone_test_123456',
      audio_url: '/storage/audio/voice_clone_preview.mp3',
    });

    render(<VoiceDrawer {...baseProps} open />);
    fireEvent.click(screen.getByRole('button', { name: /声音克隆/ }));

    const file = new File(['voice-bytes'], 'voice.mp3', {
      type: 'audio/mpeg',
      lastModified: 123,
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /生成试听/ }));

    await waitFor(() => {
      expect(minimaxFileUpload).toHaveBeenCalledWith(file, 'voice_clone');
      expect(minimaxVoiceClone).toHaveBeenCalledWith(
        '123456789',
        undefined,
        expect.any(String),
        '测试角色',
      );
    });
    expect(minimaxTTSSync).not.toHaveBeenCalled();

    await waitFor(() => {
      const audio = document.querySelector('audio') as HTMLAudioElement | null;
      expect(audio).toBeTruthy();
      expect(audio!.src).toContain('/storage/audio/voice_clone_preview.mp3');
    });
  });
});
