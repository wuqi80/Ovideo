import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';
import { VideoPage } from '../components/VideoPage';
import { ArrowRight, Film, Loader, Image as ImageIcon, Upload } from 'lucide-react';
import * as videoService from '../services/videoService';
import { estimateDurationMs } from '../utils/durationMapping';
import { updateStoryboardItem as apiUpdateStoryboardItem } from '../services/apiService';

function secureMediaUrl(url: string | null): string | null {
  if (!url) return null;
  const token = localStorage.getItem('auth_token');
  if (!token || url.startsWith('data:') || url.startsWith('blob:')) return url;
  let absolute = url;
  if (!url.startsWith('http')) {
    const path = url.startsWith('/') ? url : `/${url}`;
    absolute = `${window.location.origin}${path}`;
  }
  if (absolute.includes('token=')) return absolute;
  return `${absolute}${absolute.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export const VideoGenPage: React.FC = () => {
  const navigate = useNavigate();
  const { episodeId, projectId, selectedScriptId, storyboardItems, isLoading, error, loadSlices, forceReloadSlices } = useEpisode();
  useEffect(() => {
    // 2026-05-20 (Bug 3a)：视频页 @ 候选需要 character_voices + audio_tracks
    // 2026-06-14：强制刷新，跨页改动（新分镜图/音频）可见。
    forceReloadSlices('storyboardItems', 'audioTracks', 'characterVoices', 'assets');
  }, [forceReloadSlices]);
  const [showImportPanel, setShowImportPanel] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const autoImported = useRef(false);

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

  const handleImportAll = useCallback(async () => {
    if (importing || allStoryboardItems.length === 0) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const images: videoService.UploadedImage[] = [];
      const prompts: Record<string, string> = {};
      const meta: Record<string, videoService.StoryboardMeta> = {};
      const seedanceParams: Record<string, videoService.SeedanceParams> = {};
      const groups: videoService.TaskGroup[] = [];
      const skipped: { id: string; reason: string; sample?: string }[] = [];

      for (const item of allStoryboardItems) {
        const rawUrl = (item as any).generated_image_url ?? (item as any).generatedImageUrl;
        const itemId = (item as any).item_id ?? (item as any).itemId;
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

        const upImg: videoService.UploadedImage = {
          id: itemId,
          url: imgUrl,
          filename: imgUrl ? `storyboard_${sortOrder + 1}.png` : `placeholder_${sortOrder + 1}`,
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

        const initialDuration = videoService.computeReactiveDurationFromMeta(meta[itemId]);

        // 默认模型 = Seedance2（飞升）
        const groupUuid = videoService.generateUUID();
        const group: videoService.TaskGroup = {
          uuid: groupUuid,
          ids: [itemId],
          model: 'Seedance2' as videoService.VideoModel,
          shotType: 'single' as videoService.ShotType,
          duration: initialDuration,
          durationUserOverride: false,
        };
        groups.push(group);
        upImg.linkedGroupUuids = [groupUuid];

        // 初始 SeedanceParams：占位卡 prompt = '@'，方便 mention popover 自动打开
        const sp: videoService.SeedanceParams = {
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
        const msg = `没有可导入的分镜（共 ${allStoryboardItems.length} 个，全部被跳过）`;
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
      const saveRes = await videoService.saveWorkspaceSession({
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
      setShowImportPanel(false);

      // 2) 后台批量混音：对有音轨但没有 mixedAudio 的 item 调用 mix-audio
      const itemsToMix = Object.entries(meta).filter(([, m]) =>
        !m.mixedAudioUrl && m.audioUrls && (m.audioUrls.dialogue || m.audioUrls.narration || m.audioUrls.sfx)
      );
      if (itemsToMix.length > 0) {
        setImportMsg({ kind: 'info', text: `正在后台混音 ${itemsToMix.length} 条音频...` });
        await videoService.runWithConcurrency(itemsToMix, 3, async ([itemId, m]) => {
          try {
            const r = await videoService.mixStoryboardAudio({
              item_id: itemId,
              dialogue_url:  m.audioUrls?.dialogue,
              narration_url: m.audioUrls?.narration,
              sfx_url:       m.audioUrls?.sfx,
            });
            await videoService.patchWorkspaceSession(sessionScope, (cur) => {
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
  }, [importing, allStoryboardItems, sessionScope]);

  useEffect(() => {
    autoImported.current = false;
    setImportDone(false);
    setShowImportPanel(true);
  }, [sessionScope]);

  useEffect(() => {
    if (autoImported.current || importing || importDone || isLoading) return;
    if (allStoryboardItems.length === 0) return;
    (async () => {
      try {
        const existing = await videoService.loadWorkspaceSession(sessionScope);
        if (!existing.success || !existing.session?.task_groups?.length) {
          autoImported.current = true;
          handleImportAll();
        }
      } catch {}
    })();
  }, [isLoading, allStoryboardItems, importing, importDone, handleImportAll, sessionScope]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-n300">
        <Loader className="w-5 h-5 animate-spin mr-2" /> 加载视频数据...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-n20">
      {/* Import panel */}
      {showImportPanel && !importDone && (
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-n100">
              <Film size={14} className="text-primary" />
              <span>{itemsWithImages.length} 个分镜已生成画面</span>
              <span className="text-n100">|</span>
              <span>{storyboardItems.length - itemsWithImages.length} 个待生成</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleImportAll}
                disabled={importing || allStoryboardItems.length === 0}
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

      {/* Navigation to next step */}
      <div className="shrink-0 flex justify-end px-4 py-1.5 border-b border-n40">
        <button
          onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/enhance`)}
          className="flex items-center gap-2 px-3 py-1 bg-success hover:bg-success text-white text-xs rounded-lg transition-colors"
        >
          导出到美化 <ArrowRight size={12} />
        </button>
      </div>

      {/* Embedded old VideoPage */}
      <div className="flex-1 min-h-0 overflow-auto">
        <VideoPage
          isActive={true}
          sessionScope={sessionScope}
          episodeId={episodeId || ''}
          storyboardItems={allStoryboardItems}
          onRequestReimport={handleImportAll}
          key={`${sessionScope}-${importDone}`}
        />
      </div>
    </div>
  );
};
