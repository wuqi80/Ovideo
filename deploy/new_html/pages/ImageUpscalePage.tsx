import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileImage,
  ImagePlus,
  Loader2,
  ScanLine,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
import { processMaterial, uploadImageToComfyUI } from '../services/comfyuiBridgeService';
import { waitForComfyUITask } from '../services/comfyuiTaskWaitService';
import { estimateCredits } from '../services/creditService';
import { apiBlob, apiJson } from '../services/httpClient';

const LONG_EDGE_PRESETS = [4096, 8192, 16000, 32000, 50000] as const;
const DPI_PRESETS = [72, 150, 300] as const;

function fallbackCost(targetLongEdge: number, textClarity: boolean): number {
  const base = targetLongEdge <= 4096
    ? 8
    : targetLongEdge <= 8192
      ? 15
      : targetLongEdge <= 16000
        ? 25
        : targetLongEdge <= 32000
          ? 38
          : 50;
  return Math.min(50, Math.round(base * (textClarity ? 1.1 : 1)));
}

function formatPixels(value: number): string {
  return value.toLocaleString('zh-CN');
}

function outputSize(
  source: { width: number; height: number } | null,
  targetLongEdge: number,
): { width: number; height: number } | null {
  if (!source || source.width <= 0 || source.height <= 0) return null;
  const scale = targetLongEdge / Math.max(source.width, source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export const ImageUpscalePage: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [targetLongEdge, setTargetLongEdge] = useState<number>(8192);
  const [dpi, setDpi] = useState<number>(300);
  const [textClarity, setTextClarity] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'queued' | 'running' | 'completed' | 'failed'>('idle');
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');
  const [estimatedCost, setEstimatedCost] = useState(() => fallbackCost(8192, false));

  const estimatedOutput = useMemo(
    () => outputSize(sourceSize, targetLongEdge),
    [sourceSize, targetLongEdge],
  );
  const busy = ['uploading', 'queued', 'running'].includes(status);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      estimateCredits('image_upscale', {
        target_long_edge: targetLongEdge,
        dpi,
        text_clarity: textClarity,
      })
        .then(quote => {
          if (active) setEstimatedCost(quote.enabled ? quote.estimated_cost : fallbackCost(targetLongEdge, textClarity));
        })
        .catch(() => {
          if (active) setEstimatedCost(fallbackCost(targetLongEdge, textClarity));
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [dpi, targetLongEdge, textClarity]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const selectFile = useCallback((selected: File | null) => {
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setError('请选择 PNG、JPG、WEBP 或 TIFF 图片。');
      return;
    }
    const nextUrl = URL.createObjectURL(selected);
    const probe = new Image();
    probe.onload = () => {
      setSourceSize({ width: probe.naturalWidth, height: probe.naturalHeight });
      setFile(selected);
      setPreviewUrl(nextUrl);
      setStatus('idle');
      setProgress(0);
      setTaskId('');
      setResultUrl('');
      setError('');
    };
    probe.onerror = () => {
      URL.revokeObjectURL(nextUrl);
      setError('无法读取这张图片，请更换文件后重试。');
    };
    probe.src = nextUrl;
  }, []);

  const clearFile = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
    setSourceSize(null);
    setResultUrl('');
    setTaskId('');
    setStatus('idle');
    setProgress(0);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }, [previewUrl]);

  const startUpscale = useCallback(async () => {
    if (!file || !previewUrl || !projectId || !episodeId || busy) return;
    setStatus('uploading');
    setProgress(0);
    setError('');
    setResultUrl('');
    try {
      const upload = await uploadImageToComfyUI(previewUrl);
      setStatus('queued');
      const submitted = await processMaterial(upload.filename, 'image_upscale', {
        entityType: 'project',
        entityId: projectId,
        fileRole: 'upscaled_image',
        projectId,
        episodeId,
        targetLongEdge,
        dpi,
        textClarity,
      });
      setTaskId(submitted.task_id);
      setStatus('running');
      const url = await waitForComfyUITask(
        submitted.task_id,
        value => setProgress(value > 1 ? value / 100 : value),
        {
          title: `图片高清放大 · ${formatPixels(targetLongEdge)}px`,
          kind: 'image-upscale',
          targetPage: 'image-upscale',
          targetProjectId: projectId,
          episodeId,
          targetEntityType: 'project',
          targetEntityId: projectId,
          fileRole: 'upscaled_image',
        },
      );
      setResultUrl(url);
      setProgress(1);
      setStatus('completed');
      window.dispatchEvent(new CustomEvent('credits:updated'));
    } catch (caught: any) {
      setStatus('failed');
      setError(caught?.message || '图片放大失败，请稍后重试。');
    }
  }, [busy, dpi, episodeId, file, previewUrl, projectId, targetLongEdge, textClarity]);

  const downloadResult = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const nodeOutputMatch = resultUrl.match(/^\/api\/node-outputs\/[^/]+\/[^/]+\/download(?:\?.*)?$/);
      if (nodeOutputMatch) {
        const ticketEndpoint = resultUrl.replace(/\/download(?:\?.*)?$/, '/ticket');
        const ticket = await apiJson<{ download_url: string }>(
          ticketEndpoint,
          { method: 'POST' },
          '申请高清图片下载',
        );
        const anchor = document.createElement('a');
        anchor.href = ticket.download_url;
        anchor.download = `${(file?.name || 'image').replace(/\.[^.]+$/, '')}_${targetLongEdge}px_${dpi}dpi.png`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return;
      }
      const blob = await apiBlob(resultUrl, { method: 'GET' }, '下载高清放大图片');
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${(file?.name || 'image').replace(/\.[^.]+$/, '')}_${targetLongEdge}px_${dpi}dpi.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (caught: any) {
      setError(caught?.message || '下载失败，请从任务通知重新打开结果。');
    }
  }, [dpi, file?.name, resultUrl, targetLongEdge]);

  return (
    <div className="h-full overflow-y-auto bg-n20 px-6 py-6 scrollbar-atlas">
      <div className="mx-auto w-full max-w-[1480px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
              <ScanLine size={15} /> 本地节点图片工具
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-n900">图片高清放大</h1>
            <p className="mt-1 text-sm text-n300">AI 修复细节后按原比例输出，最长边最高 50,000px，最高写入 300 DPI。</p>
          </div>
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs leading-5 text-n500">
            <span className="font-semibold text-warning">本地队列任务</span> · 成功后扣除 {estimatedCost} 点 · 单张不超过 50 点
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(390px,0.75fr)]">
          <section className="overflow-hidden rounded-2xl border border-n50 bg-n0 shadow-soft">
            <div className="flex items-center justify-between border-b border-n40 px-5 py-4">
              <div>
                <h2 className="font-display text-base font-bold text-n800">1. 添加图片</h2>
                <p className="mt-0.5 text-xs text-n200">推荐使用清晰原图；极限尺寸输出文件可能较大。</p>
              </div>
              {file && (
                <button type="button" onClick={clearFile} disabled={busy} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-n300 hover:bg-r50 hover:text-danger disabled:opacity-40">
                  <X size={13} /> 更换图片
                </button>
              )}
            </div>

            {!file ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragEnter={event => { event.preventDefault(); setDragging(true); }}
                onDragOver={event => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={event => {
                  event.preventDefault();
                  setDragging(false);
                  selectFile(event.dataTransfer.files?.[0] || null);
                }}
                className={`m-5 flex min-h-[440px] w-[calc(100%-2.5rem)] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 text-center transition-colors ${dragging ? 'border-primary bg-primary-light' : 'border-n60 bg-n10 hover:border-b300 hover:bg-b50/40'}`}
              >
                <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-light text-primary"><ImagePlus size={30} /></span>
                <span className="font-display text-lg font-bold text-n800">拖入图片，或点击选择</span>
                <span className="mt-2 max-w-md text-sm leading-6 text-n200">支持 PNG、JPG、WEBP、TIFF；保留原始构图与宽高比。</span>
              </button>
            ) : (
              <div className="relative flex min-h-[500px] items-center justify-center bg-[linear-gradient(45deg,#f5f5f5_25%,transparent_25%),linear-gradient(-45deg,#f5f5f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f5f5f5_75%),linear-gradient(-45deg,transparent_75%,#f5f5f5_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-6">
                <img src={previewUrl} alt="待放大原图预览" className="max-h-[620px] max-w-full rounded-xl object-contain shadow-bottom" />
                <span className="absolute bottom-4 left-4 rounded-lg bg-n900/85 px-3 py-2 font-mono text-xs text-n0 backdrop-blur">
                  {resultUrl && estimatedOutput
                    ? `结果 ${formatPixels(estimatedOutput.width)} × ${formatPixels(estimatedOutput.height)} · ${dpi} DPI`
                    : sourceSize
                      ? `原图 ${formatPixels(sourceSize.width)} × ${formatPixels(sourceSize.height)}`
                      : '正在读取图片'}
                </span>
              </div>
            )}
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/tiff" className="hidden" onChange={event => selectFile(event.target.files?.[0] || null)} />
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-n50 bg-n0 p-5 shadow-soft">
              <h2 className="font-display text-base font-bold text-n800">2. 输出规格</h2>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-n500">目标最长边</span>
                  {estimatedOutput && <span className="font-mono text-n200">{formatPixels(estimatedOutput.width)} × {formatPixels(estimatedOutput.height)} px</span>}
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {LONG_EDGE_PRESETS.map(value => (
                    <button key={value} type="button" onClick={() => setTargetLongEdge(value)} disabled={busy} className={`rounded-lg border px-1 py-2 text-xs font-semibold transition-colors ${targetLongEdge === value ? 'border-primary bg-primary-light text-primary' : 'border-n50 bg-n0 text-n400 hover:border-b300'} disabled:opacity-50`}>
                      {value === 4096 ? '4K' : value === 8192 ? '8K' : `${value / 1000}K`}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-n200">50K 为极限输出，处理与下载时间会明显增加。</p>
              </div>

              <div className="mt-5 border-t border-n40 pt-4">
                <div className="mb-2 text-xs font-semibold text-n500">输出 DPI</div>
                <div className="grid grid-cols-3 gap-2">
                  {DPI_PRESETS.map(value => (
                    <button key={value} type="button" onClick={() => setDpi(value)} disabled={busy} className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${dpi === value ? 'border-primary bg-primary-light text-primary' : 'border-n50 text-n400 hover:border-b300'} disabled:opacity-50`}>
                      {value} DPI
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-n200">DPI 是打印密度信息；实际像素由上方最长边决定。</p>
              </div>
            </section>

            <section className="rounded-2xl border border-n50 bg-n0 p-5 shadow-soft">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-b50 text-primary"><Type size={17} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-n800">文字清晰</h3>
                      <p className="mt-0.5 text-[11px] text-n200">海报、标识、字幕边缘增强</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="文字清晰"
                      aria-checked={textClarity}
                      onClick={() => setTextClarity(value => !value)}
                      disabled={busy}
                      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${textClarity ? 'border-primary bg-primary' : 'border-n100 bg-n70'} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span className={`pointer-events-none absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-n0 shadow transition-transform ${textClarity ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3 text-[11px] leading-5 text-n400">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
                    <span>AI 放大可能改变细小文字。该选项只增强已有文字边缘，不重新生成字符；请下载后校对。纯图片背景效果通常更稳定。</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-n50 bg-n0 p-5 shadow-soft">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-n500">预计创作点数</span>
                <span className="font-display text-xl font-bold text-warning">{estimatedCost} 点</span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-n200">加入本地节点队列；成功后扣除，失败或取消自动退回。结果保留 30 天。</p>

              {busy && (
                <div className="mt-4 rounded-xl bg-b50 p-3">
                  <div className="flex items-center justify-between text-xs text-primary">
                    <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />{status === 'uploading' ? '正在上传原图' : status === 'queued' ? '正在加入本地队列' : '本地节点处理中'}</span>
                    <span className="font-mono">{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-b100"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>
                  {taskId && <div className="mt-2 truncate font-mono text-[10px] text-n200">task_id: {taskId}</div>}
                </div>
              )}

              {status === 'completed' && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-success/25 bg-success/10 p-3 text-xs font-semibold text-success"><CheckCircle2 size={16} /> 放大完成，可以下载原尺寸图片。</div>
              )}
              {error && <div className="mt-4 rounded-xl border border-danger/25 bg-r50 p-3 text-xs leading-5 text-danger">{error}</div>}

              <div className="mt-4 flex gap-2">
                {resultUrl ? (
                  <button type="button" onClick={downloadResult} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-n0 shadow-glow hover:bg-primary-hover">
                    <Download size={16} /> 下载高清图片
                  </button>
                ) : (
                  <button type="button" onClick={startUpscale} disabled={!file || busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-n0 shadow-glow hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n70 disabled:shadow-none">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {busy ? '处理中' : `加入处理队列 · ${estimatedCost} 点`}
                  </button>
                )}
              </div>
              {!file && <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-n200"><FileImage size={13} /> 请先添加一张图片</div>}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default ImageUpscalePage;
