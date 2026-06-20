import React, { useCallback, useMemo, useState } from 'react';
import { X, FileText, Music, Wand2, Loader } from 'lucide-react';
import { minimaxLyrics, minimaxMusic, createAudioTrack } from '../../services/audioGenerationService';

function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/')) return path;
  return `/${path}`;
}

function fmtSec(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface MusicModalProps {
  episodeId: string;
  script: any;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export const MusicModal: React.FC<MusicModalProps> = ({
  episodeId, script, onClose, onCreated,
}) => {
  const [lyricsInput, setLyricsInput] = useState('');
  const [generatedLyrics, setGeneratedLyrics] = useState('');
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const [musicLyrics, setMusicLyrics] = useState('');
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicResult, setMusicResult] = useState<{ url: string; durationMs: number } | null>(null);

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
      alert('歌词生成失败');
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
        try {
          await createAudioTrack(episodeId, {
            track_type: 'bgm',
            name: `AI 音乐 ${new Date().toLocaleTimeString()}`,
            audio_url: res.audio_url,
            duration_ms: res.duration_ms || 0,
          });
          await onCreated();
        } catch (persistErr) {
          console.error('持久化音乐失败:', persistErr);
        }
      }
    } catch (e) {
      console.error('音乐生成失败:', e);
      alert('音乐生成失败');
    } finally {
      setMusicLoading(false);
    }
  }, [musicLyrics, episodeId, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-n900/50" onClick={onClose} />
      <div className="relative bg-n0 border border-n40 rounded-2xl w-[600px] max-h-[80vh] overflow-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Music size={16} className="text-success" /> 添加背景音乐
          </h3>
          <button onClick={onClose} className="text-n100 hover:text-n700">
            <X size={18} />
          </button>
        </div>

        {/* Lyrics */}
        <div className="bg-n30 rounded-md border border-n40 p-4 mb-4">
          <h4 className="text-sm font-bold text-n700 flex items-center gap-2 mb-3">
            <FileText size={14} className="text-primary" /> 歌词生成
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-n100 mb-1">输入故事概要（或留空使用剧本内容）</label>
              <textarea
                value={lyricsInput}
                onChange={e => setLyricsInput(e.target.value)}
                rows={3}
                placeholder="描述故事情节或主题..."
                className="w-full bg-n0 border border-n40 rounded-lg px-3 py-2 text-sm text-n700 resize-none"
              />
            </div>
            <button
              onClick={handleGenerateLyrics}
              disabled={lyricsLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50"
            >
              {lyricsLoading ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
              生成歌词
            </button>
            {generatedLyrics && (
              <div className="bg-n0 rounded-lg p-3 text-sm text-n700 whitespace-pre-wrap max-h-32 overflow-auto border border-n40">
                {generatedLyrics}
              </div>
            )}
          </div>
        </div>

        {/* Music */}
        <div className="bg-n30 rounded-md border border-n40 p-4">
          <h4 className="text-sm font-bold text-n700 flex items-center gap-2 mb-3">
            <Music size={14} className="text-success" /> 音乐生成
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-n100 mb-1">歌词（可编辑）</label>
              <textarea
                value={musicLyrics}
                onChange={e => setMusicLyrics(e.target.value)}
                rows={4}
                placeholder="输入歌词或从上方生成..."
                className="w-full bg-n0 border border-n40 rounded-lg px-3 py-2 text-sm text-n700 resize-none"
              />
            </div>
            <button
              onClick={handleGenerateMusic}
              disabled={musicLoading || !musicLyrics.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-success hover:bg-success text-white text-sm font-semibold transition-all disabled:opacity-50"
            >
              {musicLoading ? <Loader size={14} className="animate-spin" /> : <Music size={14} />}
              生成音乐
            </button>
            {musicResult && (
              <div className="flex items-center gap-3 pt-2">
                <audio controls src={musicResult.url} className="flex-1 h-10" />
                <span className="text-xs text-n100 tabular-nums">{fmtSec(musicResult.durationMs)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
