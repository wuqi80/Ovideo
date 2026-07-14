import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';
import { ArrowRight, Film, Loader, Image as ImageIcon, Upload, RefreshCw } from 'lucide-react';
import type { SeedanceParams, ShotType, VideoModel } from '../services/videoModelService';
import type { TaskGroup, UploadedImage } from '../services/videoTaskTypes';
import {
  generateUUID,
  mixStoryboardAudio,
  runWithConcurrency,
} from '../services/videoTaskService';
import {
  computeReactiveDurationFromMeta,
  loadWorkspaceSession,
  patchWorkspaceSession,
  saveWorkspaceSession,
  type StoryboardMeta,
} from '../services/videoWorkspaceService';
import { estimateDurationMs } from '../utils/durationMapping';
import { getStoryboardItems, updateStoryboardItem as apiUpdateStoryboardItem } from '../services/episodeDataService';
import { secureApiUrl } from '../services/httpClient';
import { runWhenIdle } from '../utils/idleScheduler';

const VIDEO_INITIAL_STORYBOARD_COUNT = 10;
const VideoPage = React.lazy(() => import('../components/VideoPage').then(m => ({ default: m.VideoPage })));

function hasImportedWorkspaceContent(session: any): boolean {
  return Boolean(
    session
    && (((session.task_groups || []).length > 0) || ((session.uploaded_images || []).length > 0))
  );
}

const WorkflowChunkFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-full min-h-[240px] flex items-center justify-center text-n300">
    <div className="flex items-center gap-2 text-sm">
      <Loader size={16} className="animate-spin text-primary" />
      <span>{label}</span>
    </div>
  </div>
);

function secureMediaUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  return secureApiUrl(url, { absolute: true, requireAuth: false });
}

function getStoryboardItemId(item: any): string {
  return (item?.item_id ?? item?.itemId ?? '').toString();
}

function looksLikeStoryboardId(value: any): boolean {
  return typeof value === 'string' && value.startsWith('sb_');
}

function getWorkspaceImageStoryboardId(image: any): string {
  const explicit = image?.storyboardItemId;
  if (explicit) return explicit.toString();
  const id = image?.id;
  return looksLikeStoryboardId(id) ? id.toString() : '';
}

function collectWorkspaceStoryboardIds(session: any): Set<string> {
  const ids = new Set<string>();
  for (const image of session?.uploaded_images || []) {
    const id = getWorkspaceImageStoryboardId(image);
    if (id) ids.add(id);
  }
  for (const group of session?.task_groups || []) {
    for (const id of group?.ids || []) {
      if (looksLikeStoryboardId(id)) ids.add(id.toString());
    }
  }
  return ids;
}

function isWorkspaceForDifferentStoryboard(session: any, storyboardItems: any[]): boolean {
  const currentIds = new Set(storyboardItems.map(getStoryboardItemId).filter(Boolean));
  const workspaceIds = collectWorkspaceStoryboardIds(session);
  if (currentIds.size === 0 || workspaceIds.size === 0) return false;
  for (const id of workspaceIds) {
    if (currentIds.has(id)) return false;
  }
  return true;
}

function isPrimaryStoryboardImageMedia(media: any): boolean {
  if (!media || media.kind !== 'image') return false;
  const role = media.role || 'reference_image';
  return role === 'reference_image' || role === 'first_frame';
}

export const VideoGenPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    episodeId,
    projectId,
    selectedScriptId,
    storyboardItems,
    storyboardTotalCount,
    isLoading,
    loadSlicesQuiet,
    loadStoryboardItemsPage,
  } = useEpisode();
  useEffect(() => {
    loadStoryboardItemsPage({ limit: VIDEO_INITIAL_STORYBOARD_COUNT, includeTotal: true });
    const loadSupportSlices = () => {
      void loadSlicesQuiet('audioTracks', 'characterVoices', 'assets');
    };
    return runWhenIdle(loadSupportSlices, { timeout: 1500 });
  }, [loadStoryboardItemsPage, loadSlicesQuiet, selectedScriptId]);
  const [showImportPanel, setShowImportPanel] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [workspaceChecked, setWorkspaceChecked] = useState(false);
  const [hasWorkspaceImport, setHasWorkspaceImport] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const autoImported = useRef(false);
  // 分镜图改了之后，视频页用的是缓存会话里的旧图——这里检测差异并提供"非破坏性同步"
  // （只更新变化的图片 URL + 参考图，保留任务组和已生成视频），同步后重挂载 VideoPage 刷新。
  const [syncNonce, setSyncNonce] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [changedCount, setChangedCount] = useState(0);

  const sessionScope = useMemo(
    () => selectedScriptId ? `${episodeId}:${selectedScriptId}` : episodeId || '',
    [episodeId, selectedScriptId]
  );

  const itemsWithImages = useMemo(
    () =>
      [...storyboardItems]
        .filter(i => {
          const url = (i as any).generated_image_url ?? (i as any).generatedImageUrl;
          return !!url;
        })
        .sort((a, b) => ((a as any).sort_order ?? (a as any).sortOrder ?? 0) - ((b as any).sort_order ?? (b as any).sortOrder ?? 0)),
    [storyboardItems]
  );

  const allStoryboardItems = useMemo(
    () =>
      [...(storyboardItems || [])].sort((a, b) =>
        ((a as any).sort_order ?? (a as any).sortOrder ?? 0) -
        ((b as any).sort_order ?? (b as any).sortOrder ?? 0)
      ),
    [storyboardItems]
  );

  const totalStoryboardCount = Math.max(storyboardTotalCount || 0, allStoryboardItems.length);
  const isStoryboardPagePartial = totalStoryboardCount > allStoryboardItems.length;

  const ensureAllStoryboardItemsForImport = useCallback(async () => {
    if (!episodeId || !isStoryboardPagePartial) return allStoryboardItems;
    const res = await getStoryboardItems(episodeId, selectedScriptId || undefined, { fields: 'video' });
    if (!res?.success) throw new Error('加载全部分镜失败');
    return [...(res.items || [])].sort((a, b) =>
      ((a as any).sort_order ?? (a as any).sortOrder ?? 0) -
      ((b as any).sort_order ?? (b as any).sortOrder ?? 0)
    );
  }, [allStoryboardItems, episodeId, isStoryboardPagePartial, selectedScriptId]);

  const handleImportAll = useCallback(async () => {
    if (importing || totalStoryboardCount === 0) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const storyboardItemsForImport = await ensureAllStoryboardItemsForImport();
      if (storyboardItemsForImport.length === 0) return;
      const images: UploadedImage[] = [];
      const prompts: Record<string, string> = {};
      const meta: Record<string, StoryboardMeta> = {};
      const seedanceParams: Record<string, SeedanceParams> = {};
      const groups: TaskGroup[] = [];
      const skipped: { id: string; reason: string; sample?: string }[] = [];

      for (const item of storyboardItemsForImport) {
        const rawUrl = (item as any).generated_image_url ?? (item as any).generatedImageUrl;
        const itemId = getStoryboardItemId(item);
        // 视频页优先用 video_prompt（视频生成专用），fallback 到 image_prompt（图像生成 prompt）。
        // storyboard_items 表两个字段都存在；此前只读 image_prompt 导致视频提示词丢失。
        const prompt =
            (item as any).video_prompt ?? (item as any).videoPrompt ??
            (item as any).image_prompt ?? (item as any).imagePrompt ?? '';
        const sortOrder = (item as any).sort_order ?? (item as any).sortOrder ?? 0;
        if (!itemId) {
          skipped.push({ id: '(no itemId)', reason: 'missing itemId' });
          continue;
        }

        // URL 严格白名单：只接受 http(s):// 或 / 起头；data:/blob: 跳过画面但仍保留占位卡。
        const urlRaw = (rawUrl || '').toString();
        const url = urlRaw.split('?')[0];
        let imgUrl = '';
        let isPlaceholder = true;
        if (url) {
          if (url.startsWith('data:')) {
            skipped.push({ id: itemId, reason: 'data: URL（已跳过画面，仍占空位）', sample: url.slice(0, 60) + '...' });
          } else if (url.startsWith('blob:')) {
            skipped.push({ id: itemId, reason: 'blob: URL（已跳过画面，仍占空位）', sample: url.slice(0, 60) });
          } else if (!url.startsWith('http') && !url.startsWith('/')) {
            skipped.push({ id: itemId, reason: '未识别 URL 协议（已跳过画面）', sample: url.slice(0, 60) });
          } else {
            imgUrl = url;
            isPlaceholder = false;
          }
        }

        const upImg: UploadedImage = {
          id: itemId,
          url: imgUrl,
          filename: imgUrl ? `storyboard_${sortOrder + 1}.png` : `placeholder_${sortOrder + 1}`,
          storageUrl: imgUrl || undefined,
          uploadTime: Date.now(),
          isPlaceholder,
          storyboardItemId: itemId,
          sortOrder,
          tags: [],
          linkedGroupUuids: [],
        };
        images.push(upImg);
        if (prompt) prompts[itemId] = prompt;

        // Storyboard meta（音轨 URL + 计划/音频时长 + 场景/对白快照 + 已混音）
        const audioUrls = {
          dialogue:  (item as any).dialogue_audio_url ?? (item as any).dialogueAudioUrl ?? undefined,
          narration: (item as any).narration_audio_url ?? (item as any).narrationAudioUrl ?? undefined,
          sfx:       (item as any).sfx_audio_url ?? (item as any).sfxAudioUrl ?? undefined,
        };
        // 2026-05-20 (Bug 3)：旧数据迁移 — 若 DB 里 planned_duration_ms 为 NULL，
        // 前端按台词字数估算后主动 PUT 回 storyboard_items，下次刷新永久同步。
        let plannedDurationMs: number | undefined =
          (item as any).planned_duration_ms ?? (item as any).plannedDurationMs ?? undefined;
        if (plannedDurationMs == null || plannedDurationMs <= 0) {
          plannedDurationMs = estimateDurationMs({
            dialogueText: (item as any).dialogue || '',
          });
          // best-effort backfill；catch 后只 warn，不阻塞 import 流程
          apiUpdateStoryboardItem(itemId, { planned_duration_ms: plannedDurationMs })
            .catch(e => console.warn('[VideoGenPage] backfill planned_duration_ms 失败:', itemId, e?.message || e));
        }
        meta[itemId] = {
          plannedDurationMs,
          audioDurationMs:   (item as any).audio_duration_ms ?? (item as any).audioDurationMs ?? undefined,
          audioUrls: (audioUrls.dialogue || audioUrls.narration || audioUrls.sfx) ? audioUrls : undefined,
          mixedAudioUrl:  (item as any).mixed_audio_url ?? (item as any).mixedAudioUrl ?? undefined,
          mixedAudioHash: (item as any).mixed_audio_hash ?? (item as any).mixedAudioHash ?? undefined,
          sceneHeading: (item as any).scene_heading ?? (item as any).sceneHeading ?? undefined,
          dialogue:     (item as any).dialogue ?? undefined,
          lastSyncedAt: Date.now(),
        };

        const initialDuration = computeReactiveDurationFromMeta(meta[itemId]);

        // 默认模型 = Seedance2（飞升）
        const groupUuid = generateUUID();
        const group: TaskGroup = {
          uuid: groupUuid,
          ids: [itemId],
          model: 'Seedance2' as VideoModel,
          shotType: 'single' as ShotType,
          duration: initialDuration,
          durationUserOverride: false,
        };
        groups.push(group);
        upImg.linkedGroupUuids = [groupUuid];

        // 初始 SeedanceParams：占位卡 prompt = '@'，方便 mention popover 自动打开
        const sp: SeedanceParams = {
          sub_model: 'standard',
          prompt: isPlaceholder ? '@' : (prompt || ''),
          // Default to reference_image (all-purpose reference / 全能参考).
          // Users can switch to first/last-frame mode via the panel toggle (Task 3).
          media_inputs: imgUrl
            ? [{ kind: 'image', url: imgUrl, role: 'reference_image' }]
            : [],
          duration: initialDuration,
          ratio: 'adaptive',
          seed: -1,
          watermark: false,
          generate_audio: true,
          camera_fixed: false,
        };
        // 2026-05-20 (Bug 3b)：自动注入「本分镜的参考音」一条 reference_audio。
        // 优先级：mixed_audio_url（合成完）> dialogue > narration > sfx。
        // 多音轨可能合并失败时，先用 dialogue 顶上；用户后续可在 modal/手动 @ 替换。
        const m = meta[itemId];
        const refAudio =
          m.mixedAudioUrl
          || m.audioUrls?.dialogue
          || m.audioUrls?.narration
          || m.audioUrls?.sfx
          || null;
        if (refAudio) {
          sp.media_inputs.push({
            kind: 'audio',
            url: refAudio,
            role: 'reference_audio',
          });
        }
        seedanceParams[groupUuid] = sp;
      }

      if (images.length === 0) {
        const msg = `没有可导入的分镜（共 ${storyboardItemsForImport.length} 个，全部被跳过）`;
        setImportMsg({ kind: 'error', text: msg });
        return;
      }
      if (skipped.length > 0) {
        console.warn('[VideoGenPage] 跳过 %d 个画面（占位仍导入）', skipped.length, skipped);
      }

      console.log('[VideoGenPage] 导入分镜 → workspace', {
        scope: sessionScope,
        images: images.length,
        groups: groups.length,
        skipped: skipped.length,
        placeholders: images.filter(i => i.isPlaceholder).length,
      });

      // 1) 立即保存会话，让用户先看到所有卡片（混音稍后异步完成）
      const saveRes = await saveWorkspaceSession({
        uploaded_images: images,
        task_groups: groups,
        image_prompts: prompts,
        tasks_status: {},
        seedance_params: seedanceParams,
        storyboard_meta: meta,
      }, sessionScope);
      if (!saveRes?.success) {
        setImportMsg({ kind: 'error', text: '保存工作区会话失败，请稍后重试' });
        return;
      }
      setImportDone(true);
      setWorkspaceChecked(true);
      setHasWorkspaceImport(true);
      setShowImportPanel(false);
      setSyncNonce(n => n + 1);

      // 2) 后台批量混音：对有音轨但没有 mixedAudio 的 item 调用 mix-audio
      const itemsToMix = Object.entries(meta).filter(([, m]) =>
        !m.mixedAudioUrl && m.audioUrls && (m.audioUrls.dialogue || m.audioUrls.narration || m.audioUrls.sfx)
      );
      if (itemsToMix.length > 0) {
        setImportMsg({ kind: 'info', text: `正在后台混音 ${itemsToMix.length} 条音频...` });
        await runWithConcurrency(itemsToMix, 3, async ([itemId, m]) => {
          try {
            const r = await mixStoryboardAudio({
              item_id: itemId,
              dialogue_url:  m.audioUrls?.dialogue,
              narration_url: m.audioUrls?.narration,
              sfx_url:       m.audioUrls?.sfx,
            });
            await patchWorkspaceSession(sessionScope, (cur) => {
              const newMeta = {
                ...(cur.storyboard_meta || {}),
                [itemId]: {
                  ...(cur.storyboard_meta?.[itemId] || {}),
                  mixedAudioUrl: r.mixed_audio_url,
                  mixedAudioHash: undefined,
                },
              };
              const groupForItem = (cur.task_groups || []).find(g => g.ids.includes(itemId));
              const newSP = { ...(cur.seedance_params || {}) };
              if (groupForItem) {
                const existing = newSP[groupForItem.uuid];
                if (existing) {
                  const others = existing.media_inputs.filter(mi => mi.role !== 'reference_audio');
                  newSP[groupForItem.uuid] = {
                    ...existing,
                    media_inputs: [...others, { kind: 'audio', url: r.mixed_audio_url, role: 'reference_audio' }],
                  };
                }
              }
              return { storyboard_meta: newMeta, seedance_params: newSP };
            });
          } catch (e) {
            console.warn('[VideoGenPage] mix-audio failed for', itemId, e);
          }
        });
        setImportMsg({ kind: 'info', text: `导入完成（${images.length} 个分镜，混音 ${itemsToMix.length} 条）` });
      } else {
        setImportMsg({ kind: 'info', text: `导入完成（${images.length} 个分镜）` });
      }
    } catch (err: any) {
      console.error('[VideoGenPage] 导入失败:', err);
      setImportMsg({ kind: 'error', text: `导入失败：${err?.message || String(err)}` });
    } finally {
      setImporting(false);
    }
  }, [ensureAllStoryboardItemsForImport, importing, sessionScope, totalStoryboardCount]);

  const handleReimportAll = useCallback(() => {
    if (importing) return;
    const confirmed = window.confirm(
      '再次导入会覆盖当前视频工作区已经导入的卡片、模型参数和任务状态。确定要覆盖并重新导入全部分镜吗？'
    );
    if (!confirmed) return;
    handleImportAll();
  }, [handleImportAll, importing]);

  useEffect(() => {
    autoImported.current = false;
    setImportDone(false);
    setWorkspaceChecked(false);
    setHasWorkspaceImport(false);
    setShowImportPanel(true);
  }, [sessionScope]);

  useEffect(() => {
    if (autoImported.current || importing || importDone || isLoading) return;
    if (allStoryboardItems.length === 0) return;
    let alive = true;
    (async () => {
      try {
        const existing = await loadWorkspaceSession(sessionScope);
        const sess: any = existing.session;
        const hasImported = existing.success && hasImportedWorkspaceContent(sess);
        if (!alive) return;
        setWorkspaceChecked(true);
        setHasWorkspaceImport(hasImported);

        if (hasImported) {
          if (isWorkspaceForDifferentStoryboard(sess, allStoryboardItems)) {
            autoImported.current = true;
            setImportDone(false);
            setHasWorkspaceImport(false);
            setShowImportPanel(false);
            setImportMsg({ kind: 'info', text: '检测到视频工作区仍是旧分镜，正在重新导入当前分镜。' });
            handleImportAll();
            return;
          }
          autoImported.current = true;
          setImportDone(true);
          setShowImportPanel(false);
          return;
        }

        if (!existing.success || !hasImported) {
          if (isStoryboardPagePartial) {
            setImportMsg({
              kind: 'info',
              text: `已先加载 ${allStoryboardItems.length}/${totalStoryboardCount} 个分镜预览，需要时点击导入全部。`,
            });
            return;
          }
          autoImported.current = true;
          handleImportAll();
        }
      } catch {
        if (alive) setWorkspaceChecked(true);
      }
    })();
    return () => { alive = false; };
  }, [
    isLoading,
    allStoryboardItems,
    importing,
    importDone,
    handleImportAll,
    sessionScope,
    isStoryboardPagePartial,
    totalStoryboardCount,
  ]);

  // 最新分镜图：item_id -> 去 query 的图片 URL
  const latestImageById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const item of allStoryboardItems) {
      const id = getStoryboardItemId(item);
      const raw = ((item as any).generated_image_url ?? (item as any).generatedImageUrl ?? '').toString().split('?')[0];
      if (id && raw && !raw.startsWith('data:') && !raw.startsWith('blob:')) m[id] = raw;
    }
    return m;
  }, [allStoryboardItems]);

  // 检测会话里缓存的图与最新分镜图有多少处不一致
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await loadWorkspaceSession(sessionScope);
        if (!alive || !r.success || !r.session) { if (alive) setChangedCount(0); return; }
        let n = 0;
        for (const img of (r.session.uploaded_images || [])) {
          const id = getWorkspaceImageStoryboardId(img);
          if (!id) continue;
          const lu = latestImageById[id];
          if (lu && lu !== (img.url || '').split('?')[0]) {
            n++;
          } else if (!lu && looksLikeStoryboardId(id)) {
            n++;
          }
        }
        if (alive) setChangedCount(n);
      } catch { if (alive) setChangedCount(0); }
    })();
    return () => { alive = false; };
  }, [sessionScope, latestImageById, importDone, syncNonce]);

  // 非破坏性同步：把变化的分镜图更新进会话（图片 + seedance 参考图），保留任务组/已生成视频
  const handleSyncImages = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await loadWorkspaceSession(sessionScope);
      if (!r.success || !r.session || !(r.session.task_groups?.length)) {
        // 没有会话可同步 —— 退化为全量导入
        handleImportAll();
        return;
      }
      const sess = r.session;
      if (isWorkspaceForDifferentStoryboard(sess, allStoryboardItems)) {
        setImportMsg({ kind: 'info', text: '检测到视频工作区仍是旧分镜，正在重新导入当前分镜。' });
        handleImportAll();
        return;
      }
      const newImages = (sess.uploaded_images || []).map((img: any) => {
        const id = getWorkspaceImageStoryboardId(img);
        const lu = latestImageById[id];
        return (lu && lu !== (img.url || '').split('?')[0])
          ? { ...img, url: lu, storageUrl: lu, isPlaceholder: false }
          : img;
      });
      const newSP: Record<string, any> = { ...(sess.seedance_params || {}) };
      for (const g of (sess.task_groups || [])) {
        const id = (g.ids || [])[0];
        const lu = latestImageById[id];
        const sp = newSP[g.uuid];
        if (lu && sp) {
          const cur = (sp.media_inputs || []).find(isPrimaryStoryboardImageMedia);
          if (!cur || (cur.url || '').split('?')[0] !== lu) {
            const role = cur?.role || 'reference_image';
            const others = (sp.media_inputs || []).filter((mi: any) => mi !== cur);
            newSP[g.uuid] = { ...sp, media_inputs: [{ kind: 'image', url: lu, role }, ...others] };
          }
        }
      }
      await patchWorkspaceSession(sessionScope, () => ({ uploaded_images: newImages, seedance_params: newSP }));
      setChangedCount(0);
      setHasWorkspaceImport(true);
      setSyncNonce(n => n + 1); // 重挂载 VideoPage，从更新后的会话重新加载
      setImportMsg({ kind: 'info', text: '已同步最新分镜图（保留已生成的视频）' });
    } catch {
      setImportMsg({ kind: 'error', text: '同步失败，请重试' });
    } finally {
      setSyncing(false);
    }
  }, [sessionScope, latestImageById, handleImportAll, allStoryboardItems]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-n300">
        <Loader className="w-5 h-5 animate-spin mr-2" /> 加载视频数据...
      </div>
    );
  }

  return (
    <div className="layout-safe h-full flex flex-col bg-n20">
      {/* Import panel */}
      {workspaceChecked && showImportPanel && !importDone && (
        <div className="shrink-0 border-b border-n40 bg-n0 px-4 py-3">
          {importMsg && (
            <div
              className={`mb-2 flex items-center justify-between gap-2 rounded px-3 py-1.5 text-xs ${
                importMsg.kind === 'error'
                  ? 'bg-r50 border border-r75 text-danger'
                  : 'bg-n30 border border-n40 text-success'
              }`}
            >
              <span>{importMsg.text}</span>
              <button
                onClick={() => setImportMsg(null)}
                className="text-[10px] opacity-60 hover:opacity-100"
              >
                关闭
              </button>
            </div>
          )}
          <div className="responsive-toolbar flex items-center justify-between">
            <div className="toolbar-group text-xs text-n100">
              <Film size={14} className="text-primary" />
              <span>已预览 {allStoryboardItems.length}/{totalStoryboardCount} 个分镜</span>
              <span className="text-n100">|</span>
              <span>{itemsWithImages.length} 个预览分镜已有画面</span>
            </div>
            <div className="toolbar-actions">
              <button
                onClick={handleImportAll}
                disabled={importing || totalStoryboardCount === 0}
                className="flex items-center gap-2 px-4 py-1.5 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {importing ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
                导入全部分镜到视频工作区
              </button>
              <button
                onClick={() => setShowImportPanel(false)}
                className="text-xs text-n100 hover:text-n300 px-2 py-1"
              >
                跳过
              </button>
            </div>
          </div>

          {/* Preview thumbnails */}
          {itemsWithImages.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {itemsWithImages.slice(0, 12).map((item, idx) => {
                const url = (item as any).generated_image_url ?? (item as any).generatedImageUrl;
                return (
                  <div key={(item as any).item_id ?? (item as any).itemId ?? idx} className="shrink-0 w-16 h-10 rounded overflow-hidden border border-n40">
                    <img
                      src={secureMediaUrl(url)!}
                      alt={`分镜 ${idx + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </div>
                );
              })}
              {itemsWithImages.length > 12 && (
                <div className="shrink-0 w-16 h-10 rounded border border-n40 flex items-center justify-center text-[10px] text-n100">
                  +{itemsWithImages.length - 12}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Navigation + 同步最新分镜图 */}
      <div className="responsive-toolbar shrink-0 flex justify-between items-center px-4 py-1.5 border-b border-n40">
        <div className="toolbar-group">
          {hasWorkspaceImport && (
            <button
              onClick={handleReimportAll}
              disabled={importing || totalStoryboardCount === 0}
              title="再次导入会覆盖当前视频工作区已经导入的卡片、模型参数和任务状态"
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-n40 bg-n0 text-n300 hover:text-n700 transition-colors disabled:opacity-50"
            >
              {importing ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
              再次导入全部分镜到视频工作区
            </button>
          )}
          {changedCount > 0 && (
            <span className="text-[11px] text-amber-600">⚠ {changedCount} 个分镜图已在分镜页更新</span>
          )}
          <button
            onClick={handleSyncImages}
            disabled={syncing}
            title="把分镜页改过的最新画面同步到视频工作区（保留已生成的视频，不会清空）"
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
              changedCount > 0
                ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                : 'bg-n0 border-n40 text-n300 hover:text-n700'
            }`}
          >
            {syncing ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            同步最新分镜图
          </button>
        </div>
        <button
          onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/enhance`)}
          className="flex items-center gap-2 px-3 py-1 bg-success hover:bg-success text-white text-xs rounded-lg transition-colors"
        >
          导出到美化 <ArrowRight size={12} />
        </button>
      </div>

      {/* Embedded old VideoPage */}
      <div className="layout-safe flex-1 min-h-0 overflow-auto">
        <React.Suspense fallback={<WorkflowChunkFallback label="加载视频工作台..." />}>
          <VideoPage
            isActive={true}
            sessionScope={sessionScope}
            projectId={projectId || ''}
            episodeId={episodeId || ''}
            storyboardItems={allStoryboardItems}
            onRequestReimport={handleImportAll}
            key={`${sessionScope}-${importDone}-${syncNonce}`}
          />
        </React.Suspense>
      </div>
    </div>
  );
};
