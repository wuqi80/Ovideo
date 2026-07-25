import React, { useCallback, useState } from 'react';
import { X, FileText, Music, Wand2, Loader, Upload } from 'lucide-react';
import { minimaxLyrics, minimaxMusic, createAudioTrack } from '../../services/audioGenerationService';
import { uploadMediaItem } from '../../services/mediaLibraryService';

function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/')) return path;
  return `/${path}`;
}

function fmtSec(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  return `${(ms / 1000).toFixed(1)}s`;
}

function readAudioDurationMs(file: File): Promise<number> {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}

export interface MusicModalProps {
  episodeId: string;
  projectId?: string;
  script: any;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export const MusicModal: React.FC<MusicModalProps> = ({
  episodeId, projectId, script, onClose, onCreated,
}) => {
  const [lyricsInput, setLyricsInput] = useState('');
  const [generatedLyrics, setGeneratedLyrics] = useState('');
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const [musicLyrics, setMusicLyrics] = useState('');
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicResult, setMusicResult] = useState<{ url: string; durationMs: number } | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const durationMs = await readAudioDurationMs(uploadFile);
      const uploaded = await uploadMediaItem(uploadFile, {
        projectId,
        episodeId,
        permissionScope: projectId ? 'project' : 'private',
        title: uploadFile.name,
        tags: ['bgm'],
      });
      await createAudioTrack(episodeId, {
        track_type: 'bgm',
        name: uploadFile.name || 'BGM',
        audio_url: uploaded.file_url,
        duration_ms: durationMs,
        generation_params: {
          source: 'local_upload',
          file_id: uploaded.file_id,
          library_item_id: uploaded.library_item_id,
        },
      });
      await onCreated();
    } catch (e) {
      console.error('上传背景音乐失败:', e);
      alert(`上传背景音乐失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }, [episodeId, onCreated, projectId, uploadFile]);

  const handleGenerateLyrics = useCallback(async () => {
    const text = lyricsInput.trim() || (script?.adaptedScript || script?.adapted_script || '').slice(0, 500);
    if (!text) return;
    setLyricsLoading(true);
    try {
      const res = await minimaxLyrics(text);
      setGeneratedLyrics(res.lyrics || '');
      setMusicLyrics(res.lyrics || '');
    } catch (e) {
      console.error('歌词生成失败:', e);
      alert(`歌词生成失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLyricsLoading(false);
    }
  }, [lyricsInput, script]);

  const handleGenerateMusic = useCallback(async () => {
    if (!musicLyrics.trim()) return;
    setMusicLoading(true);
    try {
      const res = await minimaxMusic(musicLyrics);
      if (res.audio_url) {
        setMusicResult({ url: resolveUrl(res.audio_url), durationMs: res.duration_ms || 0 });
        await createAudioTrack(episodeId, {
          track_type: 'bgm',
          name: `AI 音乐 ${new Date().toLocaleTimeString()}`,
          audio_url: res.audio_url,
          duration_ms: res.duration_ms || 0,
          generation_params: { source: 'minimax_music' },
        });
        await onCreated();
      }
    } catch (e) {
      console.error('音乐生成失败:', e);
      alert(`音乐生成失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMusicLoading(false);
    }
  }, [musicLyrics, episodeId, onCreated]);

  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-n900/50" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="添加背景音乐" className="app-modal-surface relative max-h-[84vh] w-[640px] overflow-auto rounded-2xl border border-n40 bg-n0 p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-n800">
            <Music size={16} className="text-success" /> 添加背景音乐
          </h3>
          <button onClick={onClose} className="text-n100 hover:text-n700">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 rounded-md border border-n40 bg-n30 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-n700">
            <Upload size={14} className="text-success" /> 添加本地 BGM
          </h4>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="audio/*"
              onChange={e => setUploadFile(e.target.files?.[0] || null)}
              className="flex-1 rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
            />
            <button
              onClick={handleUpload}
              disabled={!uploadFile || uploading}
              className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-success disabled:opacity-50"
            >
              {uploading ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
              添加
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-md border border-n40 bg-n30 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-n700">
            <FileText size={14} className="text-primary" /> 歌词生成
          </h4>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-n100">输入故事概要，留空则使用当前剧本</label>
              <textarea
                value={lyricsInput}
                onChange={e => setLyricsInput(e.target.value)}
                rows={3}
                placeholder="描述故事情节、情绪或音乐主题..."
                className="w-full resize-none rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
              />
            </div>
            <button
              onClick={handleGenerateLyrics}
              disabled={lyricsLoading}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
            >
              {lyricsLoading ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
              生成歌词
            </button>
            {generatedLyrics && (
              <div className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-n40 bg-n0 p-3 text-sm text-n700">
                {generatedLyrics}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border border-n40 bg-n30 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-n700">
            <Music size={14} className="text-success" /> AI 音乐制作
          </h4>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-n100">歌词</label>
              <textarea
                value={musicLyrics}
                onChange={e => setMusicLyrics(e.target.value)}
                rows={4}
                placeholder="输入歌词，或先从上方生成..."
                className="w-full resize-none rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
              />
            </div>
            <button
              onClick={handleGenerateMusic}
              disabled={musicLoading || !musicLyrics.trim()}
              className="flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-success disabled:opacity-50"
            >
              {musicLoading ? <Loader size={14} className="animate-spin" /> : <Music size={14} />}
              生成音乐
            </button>
            {musicResult && (
              <div className="flex items-center gap-3 pt-2">
                <audio controls src={musicResult.url} className="h-10 flex-1" />
                <span className="tabular-nums text-xs text-n100">{fmtSec(musicResult.durationMs)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
