import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAudioTrack,
  createCharacterVoice,
  generateMusic,
  generateSFX,
  generateSpeech,
  minimaxFileUpload,
  minimaxMusic,
  minimaxTTS,
  minimaxVoiceDesign,
  submitLocalMiniMaxMusic3,
  updateAudioTrack,
  waitForLocalMiniMaxMusic3,
} from '../../services/audioGenerationService';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: any) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('audio generation service', () => {
  it('creates audio tracks through the episode endpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, track: { id: 't1' } }));
    await createAudioTrack('ep_1', { track_type: 'bgm', audio_url: '/a.mp3' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/audio-tracks');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).track_type).toBe('bgm');
  });

  it('persists timeline edits through the audio track endpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, track: { id: 't1' } }));
    await updateAudioTrack('track_1', {
      generation_params: {
        timeline: { startMs: 1_000, durationMs: 5_000, fadeInMs: 800 },
      },
    });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/audio-tracks/track_1');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body).generation_params.timeline.startMs).toBe(1_000);
  });

  it('sends speech generation requests with text and persona', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, audio_url: '/audio/test.wav' }));
    await generateSpeech({ text: 'hello', persona: 'narrator', emotion: 'neutral' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/audio/generate-speech');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.text).toBe('hello');
    expect(body.persona).toBe('narrator');
  });

  it('sends sound effect generation requests', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
    await generateSFX({ description: 'door slam' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/audio/generate-sfx');
    expect(JSON.parse(opts.body).description).toBe('door slam');
  });

  it('sends legacy music generation requests', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
    await generateMusic({ description: 'soft theme', duration_ms: 12000 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/audio/generate-music');
    expect(JSON.parse(opts.body).duration_ms).toBe(12000);
  });

  it('creates character voice bindings', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
    await createCharacterVoice({ project_id: 'p1', character_name: 'hero', voice_provider: 'minimax' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/character-voices');
    expect(JSON.parse(opts.body).character_name).toBe('hero');
  });

  it('starts asynchronous MiniMax TTS tasks with AbortSignal passthrough', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task_1' }));
    const ctrl = new AbortController();
    await minimaxTTS({ text: 'hello', voice_id: 'female-shaonv' }, ctrl.signal);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/minimax/tts');
    expect(opts.signal).toBe(ctrl.signal);
  });

  it('designs MiniMax voices', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
    await minimaxVoiceDesign('warm narrator', 'hello', 'voice_1');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/minimax/voice-design');
    expect(JSON.parse(opts.body).preview_text).toBe('hello');
  });

  it('generates MiniMax music and lyrics payloads', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
    await minimaxMusic('lyrics', 'voice_ref', 'inst_ref');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/minimax/music');
    expect(JSON.parse(opts.body).refer_voice).toBe('voice_ref');
  });

  it('preflights and submits local MiniMax Music 3 through the serial GPU queue', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        queue_mode: 'gpu2_serial', runtime_profile: 'music', tasks_ahead: 0,
        estimated_wait_seconds: 0, requires_confirmation: false,
        can_cancel_before_submit: true, accepting_submissions: true,
      }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'music_task_1' }));

    const result = await submitLocalMiniMaxMusic3({
      caption: 'warm cinematic score',
      durationSeconds: 30,
      episodeId: 'ep_1',
      projectId: 'proj_1',
      seed: 42,
    });

    expect(result.task_id).toBe('music_task_1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/generate/preflight');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/generate');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.task_type).toBe('minimax_music3');
    expect(body.lyrics).toBe('[Instrumental]');
    expect(body.duration).toBe(30);
    expect(body.file_role).toBe('generated_audio');
  });

  it('returns the first persisted audio from a completed local Music 3 task', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      status: 'completed',
      progress: 100,
      result: {
        audios: [{ url: '/storage/audios/score.mp3', file_id: 'file_music_1' }],
      },
    }));

    const result = await waitForLocalMiniMaxMusic3('music_task_1');

    expect(result.url).toBe('/storage/audios/score.mp3');
    expect(result.fileId).toBe('file_music_1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/task/music_task_1');
  });

  it('fails immediately when a local Music 3 task reaches a terminal failure', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      status: 'failed',
      progress: 0,
      error: 'model execution failed',
    }));

    await expect(waitForLocalMiniMaxMusic3('music_task_failed')).rejects.toThrow('model execution failed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('uploads MiniMax files without forcing JSON content type', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, file_id: 'file_1' }));
    const file = new File(['audio'], 'voice.mp3', { type: 'audio/mpeg' });
    await minimaxFileUpload(file, 'voice_clone');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/minimax/files/upload');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.headers['Content-Type']).toBeUndefined();
  });
});
