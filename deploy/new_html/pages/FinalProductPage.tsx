/**
 * FinalProductPage.tsx — 成品页（2026-06-14）
 *
 * 工作流「美化」之后的一站：把本项目合成好的整片汇总在这里查看/下载。
 * 数据复用项目级素材库（listMediaItems, item_type=video）；标题含「成片/完整/全片」的
 * 视为「完整成片」，置顶大播放器；其余视频作为片段列在下方。
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Clapperboard, Download, Film, AlertCircle, Loader2, Wand2, Check, X, RefreshCw } from 'lucide-react';
import { listMediaItems } from '../services/mediaLibraryService';
import { useEpisode } from '../contexts/EpisodeContext';
import { getVideoTakes, startCompose, getComposeStatus, type VideoShot, type ComposeStatus } from '../services/videoWorkflowService';
import { LazyVideo } from '../components/LazyVideo';

const isFinalFilm = (title: string | null | undefined) =>
  !!title && /成片|完整|全片|整片|final\s*cut|finalcut/i.test(title);

export const FinalProductPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { episodeId } = useEpisode();
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 合成挑选面板
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shots, setShots] = useState<VideoShot[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({}); // item_id -> segment_id
  const [loadingShots, setLoadingShots] = useState(false);
  const [compose, setCompose] = useState<ComposeStatus | null>(null);
  const composeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const resp = await listMediaItems({ project_id: projectId, item_type: 'video', limit: 200 } as any);
        if (alive) setVideos((resp as any).items || []);
      } catch (e: any) {
        if (alive) setErr(e?.message || '加载成品失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId, reloadKey]);

  // 打开挑选面板：拉取每镜的所有 take，默认选最新一条
  const openPicker = useCallback(async () => {
    if (!episodeId) { alert('未找到当前集，请从某一集进入'); return; }
    setPickerOpen(true);
    setLoadingShots(true);
    try {
      const r = await getVideoTakes(episodeId);
      const sh = r.shots || [];
      setShots(sh);
      const def: Record<string, string> = {};
      sh.forEach(s => { if (s.takes?.length) def[s.item_id] = s.takes[0].segment_id; });
      setPicks(def);
    } catch (e: any) {
      alert('加载镜头失败：' + (e?.message || ''));
      setPickerOpen(false);
    } finally {
      setLoadingShots(false);
    }
  }, [episodeId]);

  const pollCompose = useCallback(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      setCompose(s);
      if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 4000);
      else if (s.status === 'done') setReloadKey(k => k + 1); // 完成后刷新成品列表
    }).catch(() => {});
  }, [episodeId]);

  const confirmCompose = useCallback(async () => {
    if (!episodeId) return;
    setPickerOpen(false);
    try {
      const s = await startCompose(episodeId, picks);
      setCompose({ ...s, status: (s.status as any) || 'running' });
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
      composeTimerRef.current = window.setTimeout(pollCompose, 3000);
    } catch (e: any) {
      setCompose({ status: 'failed', total: 0, done: 0, error: e?.message || '启动失败' });
    }
  }, [episodeId, picks, pollCompose]);

  useEffect(() => () => { if (composeTimerRef.current) clearTimeout(composeTimerRef.current); }, []);
  useEffect(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      if (s.status && s.status !== 'idle') {
        setCompose(s);
        if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 3000);
      }
    }).catch(() => {});
  }, [episodeId]);

  const finals = videos.filter(v => isFinalFilm(v.title));
  const others = videos.filter(v => !isFinalFilm(v.title));
  const featured = finals[0] || null;
  const rest = finals.slice(1).concat(others);

  return (
    <div className="layout-safe flex-1 overflow-auto p-6 bg-n20">
      <header className="responsive-toolbar mb-5 flex items-center gap-2">
        <Clapperboard className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold text-n800">成品</h1>
        <span className="text-xs text-n100">合成好的整片在这里查看与下载</span>
        <div className="flex-1 min-w-[16px]" />
        {compose?.status === 'running' ? (
          <span className="flex items-center gap-1 px-3 py-1.5 bg-primary-light text-primary text-xs rounded-lg border border-primary/20">
            <Loader2 size={13} className="animate-spin" /> 合成中 {compose.done}/{compose.total || '…'}
          </span>
        ) : (
          <button
            onClick={openPicker}
            disabled={!episodeId}
            title="挑选每个镜头要用的视频，合成一个完整成片"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors disabled:opacity-50"
          >
            <Wand2 size={13} /> 合成成品
          </button>
        )}
        {compose?.status === 'done' && (
          <span className="text-[11px] text-emerald-600 flex items-center gap-1"><Check size={12} /> 已生成</span>
        )}
        {compose?.status === 'failed' && (
          <span className="text-[11px] text-danger" title={compose.error || ''}>合成失败</span>
        )}
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-n300 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 加载成品中…
        </div>
      ) : err ? (
        <div className="flex items-center gap-2 text-danger"><AlertCircle className="w-4 h-4" />{err}</div>
      ) : !videos.length ? (
        <div className="bg-n0 border border-n40 rounded-md p-10 text-center text-n100">
          <Film className="w-10 h-10 mx-auto mb-3 opacity-40" />
          还没有成品视频 —— 在「视频 / 美化」阶段合成整片后，会自动出现在这里。
        </div>
      ) : (
        <div className="space-y-6 max-w-6xl min-w-0">
          {/* 主成片 */}
          {featured ? (
            <div className="bg-n0 border border-n40 rounded-md shadow-card overflow-hidden">
              <div className="responsive-toolbar flex items-center justify-between px-4 py-3 border-b border-n40">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-success-light text-success font-medium shrink-0">完整成片</span>
                  <span className="text-sm font-semibold text-n800 truncate">{featured.title}</span>
                </div>
                <a href={featured.file_url} download
                   className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-primary hover:bg-primary-light border border-n40 shrink-0">
                  <Download className="w-3.5 h-3.5" /> 下载
                </a>
              </div>
              <LazyVideo
                src={featured.file_url}
                controls
                muted={false}
                firstFrame={false}
                hoverPreview={false}
                className="w-full max-h-[70vh] bg-black block"
              />
            </div>
          ) : (
            <div className="bg-y50 border border-y200 rounded-md p-4 text-sm text-y400">
              暂无「完整成片」（标题含“成片/完整/全片”）。下面是本项目的全部视频片段——在「视频/美化」合成整片后会自动归到这里置顶。
            </div>
          )}

          {/* 其它片段 / 全部视频 */}
          {rest.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-n300 mb-2">{featured ? '其它视频片段' : '全部视频'}（{rest.length}）</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {rest.map(v => (
                  <div key={v.library_item_id} className="bg-n0 border border-n40 rounded-md overflow-hidden shadow-card">
                    <LazyVideo
                      src={v.file_url}
                      preload="none"
                      controls
                      muted={false}
                      firstFrame={false}
                      hoverPreview={false}
                      className="w-full aspect-video bg-black block"
                    />
                    <div className="px-2.5 py-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-n700 truncate" title={v.title || ''}>{v.title || '未命名'}</span>
                      <a href={v.file_url} download className="text-n100 hover:text-primary shrink-0" title="下载">
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 合成挑选面板 */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="modal-surface bg-n0 rounded-lg shadow-bottom w-[900px] max-w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="responsive-toolbar px-5 py-3 border-b border-n40 flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-n800">挑选每镜要用的视频</h2>
              <span className="text-xs text-n100">默认选中最新一条，可逐镜更换</span>
              <div className="flex-1" />
              <button onClick={() => setPickerOpen(false)} className="text-n100 hover:text-n700"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingShots ? (
                <div className="flex items-center gap-2 text-n300 py-10 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载镜头中…
                </div>
              ) : shots.length === 0 ? (
                <div className="text-center text-n100 py-10">本集还没有生成过视频，无法合成。</div>
              ) : shots.map((s, i) => (
                <div key={s.item_id} className="border border-n40 rounded-md p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-bold text-n300">镜头 {String(i + 1).padStart(2, '0')}</span>
                    <span className="text-[11px] text-n100 truncate">{s.dialogue || s.scene || ''}</span>
                    <span className="ml-auto text-[10px] text-n100">{s.takes.length} 条</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {s.takes.map((t, ti) => {
                      const selected = picks[s.item_id] === t.segment_id;
                      return (
                        <button
                          key={t.segment_id}
                          onClick={() => setPicks(p => ({ ...p, [s.item_id]: t.segment_id }))}
                          className={`relative shrink-0 w-28 aspect-video rounded border-2 overflow-hidden transition-all ${
                            selected ? 'border-primary ring-2 ring-primary/30' : 'border-n40 hover:border-n100'
                          }`}
                          title={ti === 0 ? '最新' : `第 ${s.takes.length - ti} 次生成`}
                        >
                          <LazyVideo src={t.video_url} preload="none" className="w-full h-full object-contain bg-black" />
                          {ti === 0 && <span className="absolute top-0.5 left-0.5 bg-n800/70 text-white text-[9px] px-1 rounded">最新</span>}
                          {selected && (
                            <span className="absolute bottom-0.5 right-0.5 bg-primary text-white rounded-full p-0.5"><Check className="w-3 h-3" /></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-n40 flex items-center justify-end gap-2">
              <span className="text-[11px] text-n100 mr-auto">将合成 {shots.length} 个镜头</span>
              <button onClick={() => setPickerOpen(false)} className="px-3 py-1.5 text-xs text-n300 hover:text-n800 rounded">取消</button>
              <button
                onClick={confirmCompose}
                disabled={shots.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg disabled:opacity-50"
              >
                <Wand2 className="w-3.5 h-3.5" /> 开始合成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinalProductPage;
