/**
 * FinalProductPage.tsx — 成品页（2026-06-14）
 *
 * 工作流「美化」之后的一站：把本项目合成好的整片汇总在这里查看/下载。
 * 数据复用项目级素材库（listMediaItems, item_type=video）；标题含「成片/完整/全片」的
 * 视为「完整成片」，置顶大播放器；其余视频作为片段列在下方。
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Clapperboard, Download, Film, AlertCircle, Loader2 } from 'lucide-react';
import { listMediaItems } from '../services/mediaLibraryService';

const isFinalFilm = (title: string | null | undefined) =>
  !!title && /成片|完整|全片|整片|final\s*cut|finalcut/i.test(title);

export const FinalProductPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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
  }, [projectId]);

  const finals = videos.filter(v => isFinalFilm(v.title));
  const others = videos.filter(v => !isFinalFilm(v.title));
  const featured = finals[0] || null;
  const rest = finals.slice(1).concat(others);

  return (
    <div className="flex-1 overflow-auto p-6 bg-n20">
      <header className="mb-5 flex items-center gap-2">
        <Clapperboard className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold text-n800">成品</h1>
        <span className="text-xs text-n100">合成好的整片在这里查看与下载</span>
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
        <div className="space-y-6 max-w-6xl">
          {/* 主成片 */}
          {featured ? (
            <div className="bg-n0 border border-n40 rounded-md shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-n40">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-success-light text-success font-medium shrink-0">完整成片</span>
                  <span className="text-sm font-semibold text-n800 truncate">{featured.title}</span>
                </div>
                <a href={featured.file_url} download
                   className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-primary hover:bg-primary-light border border-n40 shrink-0">
                  <Download className="w-3.5 h-3.5" /> 下载
                </a>
              </div>
              <video src={featured.file_url} controls preload="metadata" className="w-full max-h-[70vh] bg-black block" />
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
                    <video src={v.file_url} controls preload="metadata" className="w-full aspect-video bg-black block" />
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
    </div>
  );
};

export default FinalProductPage;
