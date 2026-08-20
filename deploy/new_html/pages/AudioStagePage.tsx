import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, ArrowRight, Music } from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import {
  getStoryboardItems,
  syncStoryboardItems,
} from '../services/episodeDataService';
import { updateStoryboardItem as apiUpdateStoryboardItem } from '../services/storyboardMutationService';
import { minimaxTTS } from '../services/audioGenerationService';
import { crmMessage } from '../admin/crmUI';
import {
  applyStoryboardRecordPatch,
  normalizeStoryboardRecord,
  parseBoundAssetTags,
} from '../utils/episodeAdapters';
import { waitForIdle } from '../utils/idleScheduler';
import { resolveStoryboardPlannedDurationMs } from '../utils/audioTimeline';
import {
  audioSegmentsToClips,
  resolveStoryboardAudioSegments,
  serializeAudioSegmentsDialogue,
  sumPersistedAudioSegmentDurationMs,
} from '../utils/audioSegments';
import {
  resolveBoundCharacterVoice,
  resolveEffectiveSpeaker,
  resolveVoiceGenerationSettings,
} from '../utils/audioVoiceBinding';
import { VoiceSidebar } from '../components/audio/VoiceSidebar';
import { DubbingPanel, type DubbingPanelHandle } from '../components/audio/DubbingPanel';
import { MultiTrackTimeline } from '../components/audio/MultiTrackTimeline';
import { MusicModal } from '../components/audio/MusicModal';
import { MusicAssetSidebar } from '../components/audio/MusicAssetSidebar';
import type {
  AudioClipInfo,
  ClipOverride,
  CharacterVoice,
  AssetItem,
  StoryboardAudioSegment,
  StoryboardItemDB,
} from '../types';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
// 2026-05-20 (Task System Overhaul M3)：把 TTS 任务注册到全局 taskRegistry，
// 让铃铛 / TaskBadge / 跨页通知能感知配音页的 TTS 生成进度。
import { taskRegistry } from '../services/taskRegistry';
// 2026-05-24 (Task 7 — MiniMax TTS async overhaul)：minimaxTTS 现在只返回 task_id，
// 需要 pollTtsTaskUntilDone 把任务轮询到 worker 完成。Drawer 关 / episode 切换 / 用户
// 重新生成 时通过 AbortController 终止旧轮询。TtsTimeoutError 用于呈现 8 分钟兜底超时的友好文案。
import { pollTtsTaskUntilDone, TtsTimeoutError } from '../services/ttsTaskPoller';

function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/') || path.startsWith('data:')) return path;
  return `/${path}`;
}

const AUDIO_STAGE_STORYBOARD_INITIAL_LOAD_LIMIT = 20;
const AUDIO_STAGE_STORYBOARD_BACKGROUND_PAGE_SIZE = 80;

function normalizeAudioStageStoryboardItem(record: Record<string, any>): StoryboardItemDB {
  const item = normalizeStoryboardRecord(record);
  return {
    ...item,
    plannedDurationMs: resolveStoryboardPlannedDurationMs(item),
  };
}

function sortAudioStageStoryboardItems(items: StoryboardItemDB[]): StoryboardItemDB[] {
  return [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function mergeAudioStageStoryboardItems(existing: StoryboardItemDB[], incoming: StoryboardItemDB[]): StoryboardItemDB[] {
  const byId = new Map(existing.map(item => [item.itemId, item]));
  for (const item of incoming) {
    if (!byId.has(item.itemId)) byId.set(item.itemId, item);
  }
  return sortAudioStageStoryboardItems(Array.from(byId.values()));
}

export const AudioStagePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    assets, characterVoices, audioTracks,
    projectId, episodeId, selectedScriptId, script, isLoading, error, reload,
    forceReloadSlices,
  } = useEpisode();
  const [storyboardItems, setStoryboardItems] = useState<StoryboardItemDB[]>([]);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<'dubbing' | 'music'>('dubbing');
  const storyboardItemsRef = useRef<StoryboardItemDB[]>([]);

  const reloadAudioTracks = useCallback(async () => {
    await forceReloadSlices('audioTracks');
  }, [forceReloadSlices]);

  useEffect(() => {
    storyboardItemsRef.current = storyboardItems;
  }, [storyboardItems]);

  useEffect(() => {
    setTimelineCollapsed(true);
  }, [episodeId]);

  // 「同步到分镜」只原地更新发生变化的配音字段；找不到对应分镜时才新增。
  // 保留原 item_id，避免误伤已经生成的画面、视频段和未改动配音。
  const handleExportToStoryboard = useCallback(async () => {
    if (exporting) return;
    const items = [...storyboardItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (!items.length) {
      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`);
      return;
    }
    setExporting(true);
    try {
      const payload = items.map(it => ({
        item_id: it.itemId,
        sort_order: it.sortOrder ?? 0,
        dialogue: it.dialogue || '',
        dialogue_audio_url: it.dialogueAudioUrl || null,
        narration_audio_url: it.narrationAudioUrl || null,
        sfx_audio_url: it.sfxAudioUrl || null,
        audio_duration_ms: it.audioDurationMs ?? null,
        planned_duration_ms: it.plannedDurationMs ?? null,
        audio_segments: it.audioSegments || [],
        video_script_block: it.videoScriptBlock || '',
        bound_assets: Array.isArray(it.boundAssets) ? it.boundAssets : [],
      }));
      const res: any = await syncStoryboardItems(episodeId, payload, selectedScriptId || undefined);
      crmMessage.success(`已同步分镜：更新 ${res?.updated || 0}，新增 ${res?.created || 0}，未变化 ${res?.skipped || 0}`);
      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`);
    } catch (e: any) {
      crmMessage.error(`同步到分镜失败：${e?.message || e}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, storyboardItems, episodeId, selectedScriptId, projectId, navigate]);

  const updateAudioStageStoryboardItem = useCallback(async (itemId: string, data: Record<string, any>) => {
    await apiUpdateStoryboardItem(itemId, data);
    setStoryboardItems(prev => {
      const next = prev.map(item =>
        item.itemId === itemId ? applyStoryboardRecordPatch(item, data) : item
      );
      storyboardItemsRef.current = next;
      return next;
    });
  }, []);

  const persistAudioSegments = useCallback(async (
    itemId: string,
    update: (segments: StoryboardAudioSegment[]) => StoryboardAudioSegment[],
    extraFields: Record<string, any> = {},
  ) => {
    const item = storyboardItemsRef.current.find(candidate => candidate.itemId === itemId);
    if (!item) throw new Error('未找到对应镜头');
    const { charNames } = parseBoundAssetTags(
      Array.isArray(item.boundAssets) ? item.boundAssets : [],
    );
    const updatedSegments = update(resolveStoryboardAudioSegments(item, charNames))
      .map((segment, sequenceIndex) => ({ ...segment, sequenceIndex }));
    const fields = {
      audio_segments: updatedSegments,
      dialogue: serializeAudioSegmentsDialogue(updatedSegments),
      audio_duration_ms: sumPersistedAudioSegmentDurationMs(updatedSegments) || null,
      ...extraFields,
    };
    await updateAudioStageStoryboardItem(itemId, fields);
    return updatedSegments;
  }, [updateAudioStageStoryboardItem]);

  // 2026-06-14：进入配音页强制刷新，跨页改动可见。
  // 2026-06-19：storyboard 改为 fields=audio_stage 的轻量直拉，避免整行分镜数据进入 context。
  useEffect(() => {
    forceReloadSlices('assets', 'characterVoices', 'script', 'audioTracks');
  }, [forceReloadSlices]);

  useEffect(() => {
    let active = true;
    if (!episodeId) {
      setStoryboardItems([]);
      return () => { active = false; };
    }
    const currentEpisodeId = episodeId;
    const scriptId = selectedScriptId || undefined;

    const loadRemainingAudioStageStoryboardPages = async (offset: number, total: number) => {
      let nextOffset = offset;
      while (active && nextOffset < total) {
        await waitForIdle();
        if (!active) return;
        try {
          const res = await getStoryboardItems(currentEpisodeId, scriptId, {
            fields: 'audio_stage',
            limit: AUDIO_STAGE_STORYBOARD_BACKGROUND_PAGE_SIZE,
            offset: nextOffset,
          });
          if (!active) return;
          const pageItems = res.success
            ? (res.items || []).map(normalizeAudioStageStoryboardItem)
            : [];
          if (!pageItems.length) return;
          setStoryboardItems(prev => mergeAudioStageStoryboardItems(prev, pageItems));
          nextOffset += pageItems.length;
          if (pageItems.length < AUDIO_STAGE_STORYBOARD_BACKGROUND_PAGE_SIZE) return;
        } catch (err) {
          console.warn('storyboard audio-stage background fields load failed:', err);
          return;
        }
      }
    };

    setStoryboardLoading(true);
    setStoryboardError(null);
    getStoryboardItems(currentEpisodeId, scriptId, {
      fields: 'audio_stage',
      limit: AUDIO_STAGE_STORYBOARD_INITIAL_LOAD_LIMIT,
      includeTotal: true,
    })
      .then(res => {
        if (!active) return;
        const items = res.success ? (res.items || []).map(normalizeAudioStageStoryboardItem) : [];
        const sortedItems = sortAudioStageStoryboardItems(items);
        setStoryboardItems(sortedItems);
        const total = typeof res.total === 'number' ? res.total : sortedItems.length;
        if (total > sortedItems.length) {
          void loadRemainingAudioStageStoryboardPages(sortedItems.length, total);
        }
      })
      .catch(err => {
        console.warn('storyboard audio-stage fields load failed:', err);
        if (active) {
          setStoryboardItems([]);
          setStoryboardError(err?.message || '分镜配音数据加载失败');
        }
      })
      .finally(() => {
        if (active) setStoryboardLoading(false);
      });
    return () => { active = false; };
  }, [episodeId, selectedScriptId]);

  // ─── Derived data ──────────────────────────────────────────────

  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  const voiceMap = useMemo(() => {
    const m = new Map<string, CharacterVoice>();
    characterVoices.forEach(v => m.set(v.characterName, v));
    return m;
  }, [characterVoices]);

  const charAssetMap = useMemo(() => {
    const m = new Map<string, AssetItem>();
    assets
      .filter(a => ((a as any).assetType || (a as any).asset_type) === 'character')
      .forEach(a => m.set((a as any).name, a));
    return m;
  }, [assets]);

  const allCharNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of storyboardItems) {
      const { charNames } = parseBoundAssetTags(Array.isArray(item.boundAssets) ? item.boundAssets : []);
      charNames.forEach(n => names.add(n));
    }
    assets
      .filter(a => ((a as any).assetType || (a as any).asset_type) === 'character')
      .forEach(a => {
        const name = String((a as any).name || '').trim();
        if (name) names.add(name);
      });
    characterVoices.forEach(voice => {
      const name = voice.characterName.trim();
      if (name) names.add(name);
    });
    names.add('旁白');
    return Array.from(names);
  }, [storyboardItems, assets, characterVoices]);

  // 每个镜头拥有一条有序音频序列：多段配音与无声动作互不覆盖。
  const resolvedItems = useMemo(
    () => sortedItems.map(item => {
      const { charNames } = parseBoundAssetTags(
        Array.isArray(item.boundAssets) ? item.boundAssets : [],
      );
      return {
        ...item,
        audioSegments: resolveStoryboardAudioSegments(item, charNames),
      };
    }),
    [sortedItems],
  );

  const clips: AudioClipInfo[] = useMemo(
    () => resolvedItems.flatMap(item => audioSegmentsToClips(
      item,
      item.audioSegments || [],
      speaker => voiceMap.get(speaker)?.voiceModelId || null,
    )),
    [resolvedItems, voiceMap],
  );

  const clipKey = useCallback((clip: AudioClipInfo) => clip.clipId, []);

  // ─── Per-clip overrides + audio state ─────────────────────────

  // 2026-05-20 (Bug #3)：localOverrides 是用户编辑的草稿（对白文本/speaker/情绪/速度/音高
  // 的覆盖值），属于"未入库 transient state"。改用 usePersistedPageState 后，切页面 + 刷新
  // 都不会丢；按 episodeId 隔离避免不同剧集互相污染。
  // localAudio 不持久化 —— TTS 成功后会同步更新本页轻量 storyboard 状态，刷新后由 fields=audio_stage 重拉。
  const [localOverrides, setLocalOverrides] = usePersistedPageState<Record<string, ClipOverride>>({
    page: 'AudioStagePage:localOverrides',
    episodeId,
    version: 1,
    defaultValue: {},
  });
  const [localAudio, setLocalAudio] = useState<Record<string, { url: string; durationMs?: number }>>({});
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [playingKey, setPlayingKey] = useState('');
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const dubbingRef = useRef<DubbingPanelHandle>(null);
  const batchRunningRef = useRef(false);

  // 2026-05-24 (Task 7)：per-clip AbortController map。每条 clip 对应一个
  // runGenerate 调用 / 一个 minimaxTTS 入队请求 / 一个 pollTtsTaskUntilDone 轮询。
  // 触发 abort 的场景（防 recurring-pitfalls §H —— state coupled to lifecycle）：
  //   - 用户对同一 clip 连点"重新生成"：先 abort 旧 controller 再开新轮询
  //   - 切换 episodeId：episode-keyed cleanup effect 一次性 abort + clear 所有控制器
  //   - 组件卸载：cleanup return 同上
  const ttsAbortControllers = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    return () => {
      ttsAbortControllers.current.forEach(c => c.abort());
      ttsAbortControllers.current.clear();
    };
  }, [episodeId]);

  // ─── TTS generation ───────────────────────────────────────────

  const runGenerate = useCallback(async (clip: AudioClipInfo) => {
    // 2026-05-25：本函数有意保留 minimaxTTS（worker 异步）路径，不切到
    // minimaxTTSSync fast-path。
    //
    // 为什么：
    //   - 批量生成（一集 200 条对白）× 每条 5-15s = 17-50 分钟总耗时，handler
    //     同步会撞 autodl 反代 5min idle timeout（即使单条 sync 接口几秒返回，
    //     FastAPI worker 线程池被长时间占住会导致整服务排队）
    //   - 用户切 episode 时旧任务必须能 abort，worker 路径有 task_queue 状态
    //     可追溯（每条 clip 对应一个 registry 行 + 一个 AbortController）
    //   - retry 在 MiniMax 偶发 502/限流时很必要，worker 自动重试 3 次（fast-path
    //     是「请求即终态」，失败要前端自己重试，对 200 条批量不现实）
    //   - 失败仍可在「我的任务」面板查到
    //
    // 试听场景见 VoiceSidebar.handlePreview，用 minimaxTTSSync 一次拿结果。
    // Plan: docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md
    // 子陷阱见 recurring-pitfalls.md §R 子陷阱 4「sync/async 双轨设计」。
    const key = clipKey(clip);
    const override = localOverrides[key] || {};
    const speakerLabel = resolveEffectiveSpeaker(clip, override);
    const voice = resolveBoundCharacterVoice(voiceMap, speakerLabel);

    setErrors(p => { const n = { ...p }; delete n[key]; return n; });
    setGeneratingIds(p => new Set(p).add(key));

    // 2026-05-20 (M3)：注册到全局 taskRegistry。同 itemId 重复生成会用 register 的
    // upsert 行为：旧任务会被新一次的 running 替换。
    const registryTaskId = `tts:${clip.clipId}`;
    // 2026-05-24 (Bug 2)：配音页全部统一走 MiniMax，taskRegistry kind 写死 'minimax-tts'
    const provider = 'minimax-tts';
    const isNarration = speakerLabel === '旁白';
    const fileRole = `${isNarration ? 'narration_audio' : 'dialogue_audio'}:${clip.clipId}`;
    try {
      taskRegistry.register({
        taskId: registryTaskId,
        kind: provider,
        title: `${isNarration ? '旁白' : '对白'} · ${speakerLabel}`,
        targetPage: 'audio',
        initialStatus: 'running',
        progress: 0,
        targetEntityType: 'storyboard_item',
        targetEntityId: clip.itemId,
        targetItemId: clip.itemId,
        targetProjectId: projectId || undefined,
        episodeId: episodeId || undefined,
        fileRole,
      });
    } catch { /* registry 失败不阻断业务 */ }

    // 2026-05-24 (Task 7)：先 abort 该 clip 已存在的进行中任务（场景：用户连点重试 / 切 speaker 后重新生成）。
    // 然后建一个新的 AbortController 放进 map，传给 minimaxTTS(fetch) 和 pollTtsTaskUntilDone 两段。
    const oldCtrl = ttsAbortControllers.current.get(key);
    if (oldCtrl) oldCtrl.abort();
    const controller = new AbortController();
    ttsAbortControllers.current.set(key, controller);

    try {
      const textToSpeak = override.text ?? clip.text;
      // voice_params shape：
      //   system → { source:'system', voice_id }
      //   clone  → { source:'clone', file_id, cloned_voice_id, ... }
      //   design → { source:'design', setting:{voice_type,emotion,speed,pitch}, preview_text, designed_voice_id }
      // 兼容旧数据：fallback 到根字段
      // 人物切换、单条生成与批量生成统一从当前人物绑定的音色读取参数；
      // 未绑定时才使用 MiniMax 默认音色。
      const {
        voiceId: minimaxVoiceId,
        emotion,
        speed,
        pitch,
      } = resolveVoiceGenerationSettings(voice, override);

      // 2026-05-24 (Task 7)：1. enqueue —— handler 立刻返回数据库 task_id，
      // 不再阻塞撞反代 5min idle timeout（recurring-pitfalls §Q）。
      const ttsArgs = {
        text: textToSpeak, voice_id: minimaxVoiceId, speed, emotion, pitch,
        entity_type: 'storyboard_item', entity_id: clip.itemId,
        file_role: fileRole,
        episode_id: episodeId,
      };
      // 2026-06-14：入队对瞬时网络失败（Failed to fetch / TypeError，如后端重启空窗、
      // 连接抖动）自动重试 1 次；主动 abort（用户切集/重点）不重试。
      let submitted: { task_id: string };
      try {
        submitted = await minimaxTTS(ttsArgs, controller.signal);
      } catch (enqErr: any) {
        const isNetErr = enqErr instanceof TypeError
          || /failed to fetch|networkerror|load failed|fetch/i.test(enqErr?.message || '');
        if (!isNetErr || controller.signal.aborted || enqErr?.name === 'AbortError') throw enqErr;
        await new Promise(r => setTimeout(r, 800));
        submitted = await minimaxTTS(ttsArgs, controller.signal);
      }

      // 2. poll —— worker 端进程内跑完整 MiniMax 轮询 + 下载 + 入库 + entity 同步。
      // timeoutMs=10min（配音页 worker 上限 600s + 缓冲），intervalMs=2s。
      const result = await pollTtsTaskUntilDone(submitted.task_id, {
        signal: controller.signal,
        intervalMs: 2000,
        timeoutMs: 10 * 60 * 1000,
      });

      if (!result.audio_url) {
        try { taskRegistry.fail(registryTaskId, '后端未返回 audio_url'); } catch { /* noop */ }
        throw new Error('后端未返回 audio_url');
      }

      const url = result.audio_url;
      const durationMs = result.duration_ms;
      setLocalAudio(p => ({ ...p, [key]: { url: resolveUrl(url), durationMs } }));

      // 2026-05-20 (Bug 4)：之前 catch 静默吞错，导致 DB 写失败时用户看到 localAudio
      // 显示成功、刷新就丢了。改为：失败时记入 errors[key]、console.error、并提示重试。
      // 同时成功后更新本页轻量 storyboard 状态，保证页面与 DB 一致——下次刷新页面音频不会消失。
      try {
        await persistAudioSegments(
          clip.itemId,
          segments => segments.map(segment => (
            segment.segmentId === clip.clipId
              ? {
                ...segment,
                speaker: speakerLabel,
                text: textToSpeak,
                audioUrl: url,
                durationMs: durationMs != null && Number.isFinite(durationMs)
                  ? durationMs
                  : segment.durationMs,
                voiceId: minimaxVoiceId,
              }
              : segment
          )),
          isNarration
            ? { narration_audio_url: url }
            : { dialogue_audio_url: url },
        );
        // 2026-05-20 (M3)：标记任务完成，铃铛会有完成提示
        try { taskRegistry.complete(registryTaskId, { resultUrls: [resolveUrl(url)], progress: 1 }); } catch { /* noop */ }
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error('[AudioStagePage] 配音持久化失败', clip.itemId, msg);
        setErrors(p => ({ ...p, [key]: `已生成但保存失败：${msg}（请点击重新生成）` }));
        try { taskRegistry.fail(registryTaskId, `已生成但保存失败：${msg}`); } catch { /* noop */ }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // 用户切 episode / 重新点同一 clip = 静默丢弃，不写 errors / taskRegistry.fail 标"失败"。
        // 但 taskRegistry 仍需要一个终态，否则铃铛上的"进行中"会卡住 —— 用 fail("已取消")。
        try { taskRegistry.fail(registryTaskId, '已取消'); } catch { /* noop */ }
        return;
      }
      const taskTail = e?.task_id ? `（task_id: ${e.task_id}）` : '';
      const msg = e instanceof TtsTimeoutError
        ? `TTS 超时${taskTail}：可能 MiniMax 端排队中，请稍后重试`
        : `${e?.message || String(e)}${taskTail}`;
      setErrors(p => ({ ...p, [key]: msg }));
      // 2026-05-20 (M3)：标记任务失败
      try { taskRegistry.fail(registryTaskId, msg); } catch { /* noop */ }
    } finally {
      setGeneratingIds(p => { const n = new Set(p); n.delete(key); return n; });
      // 只在 map 里仍是我们自己的 controller 时才清掉 —— 避免连点重试时把"新 controller"误删。
      if (ttsAbortControllers.current.get(key) === controller) {
        ttsAbortControllers.current.delete(key);
      }
    }
  }, [voiceMap, localOverrides, clipKey, episodeId, projectId, persistAudioSegments]);

  const handleBatchGenerate = useCallback(async () => {
    if (batchRunningRef.current || batchRunning || clips.length === 0) return;
    const pendingClips = clips.filter(clip => {
      const key = clipKey(clip);
      return !generatingIds.has(key) && !(localAudio[key]?.url || clip.audioUrl);
    });
    if (pendingClips.length === 0) return;
    batchRunningRef.current = true;
    setBatchRunning(true);
    try {
      for (const clip of pendingClips) await runGenerate(clip);
    } finally {
      batchRunningRef.current = false;
      setBatchRunning(false);
    }
  }, [clips, batchRunning, runGenerate, clipKey, generatingIds, localAudio]);

  const handleClipPersist = useCallback(async (
    clip: AudioClipInfo,
    patch: { speaker?: string; text?: string },
  ) => {
    try {
      await persistAudioSegments(clip.itemId, segments => segments.map(segment => (
        segment.segmentId === clip.clipId
          ? {
            ...segment,
            ...(patch.speaker !== undefined ? { speaker: patch.speaker } : {}),
            ...(patch.text !== undefined ? { text: patch.text } : {}),
          }
          : segment
      )));
    } catch (e) {
      console.error('持久化配音片段失败:', e);
    }
  }, [persistAudioSegments]);

  const createSegmentId = useCallback((itemId: string, kind: StoryboardAudioSegment['kind']) => {
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `${itemId}:${kind}:${suffix}`;
  }, []);

  const handleAddSpeech = useCallback(async (itemId: string) => {
    const speaker = allCharNames.find(name => name !== '旁白') || '旁白';
    await persistAudioSegments(itemId, segments => [
      ...segments,
      {
        segmentId: createSegmentId(itemId, 'speech'),
        kind: 'speech',
        sequenceIndex: segments.length,
        speaker,
        text: '请输入台词',
        audioUrl: null,
        durationMs: null,
        voiceId: null,
      },
    ]);
  }, [allCharNames, createSegmentId, persistAudioSegments]);

  const handleAddSilence = useCallback(async (itemId: string) => {
    await persistAudioSegments(itemId, segments => [
      ...segments,
      {
        segmentId: createSegmentId(itemId, 'silence'),
        kind: 'silence',
        sequenceIndex: segments.length,
        label: '无声动作',
        durationMs: 1000,
      },
    ]);
  }, [createSegmentId, persistAudioSegments]);

  const handleUpdateSilence = useCallback(async (
    itemId: string,
    segmentId: string,
    patch: { label?: string; durationMs?: number },
  ) => {
    await persistAudioSegments(itemId, segments => segments.map(segment => (
      segment.segmentId === segmentId ? { ...segment, ...patch } : segment
    )));
  }, [persistAudioSegments]);

  const handleRemoveSegment = useCallback(async (itemId: string, segmentId: string) => {
    await persistAudioSegments(
      itemId,
      segments => segments.filter(segment => segment.segmentId !== segmentId),
    );
    setLocalOverrides(prev => {
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
    setLocalAudio(prev => {
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
  }, [persistAudioSegments, setLocalOverrides]);

  const handleMoveSegment = useCallback(async (
    itemId: string,
    segmentId: string,
    direction: 'up' | 'down',
  ) => {
    await persistAudioSegments(itemId, segments => {
      const ordered = [...segments].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      const currentIndex = ordered.findIndex(segment => segment.segmentId === segmentId);
      if (currentIndex < 0) return ordered;
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= ordered.length) return ordered;
      [ordered[currentIndex], ordered[targetIndex]] = [ordered[targetIndex], ordered[currentIndex]];
      return ordered;
    });
  }, [persistAudioSegments]);

  // ─── Playback ─────────────────────────────────────────────────

  const togglePlay = useCallback((key: string) => {
    const existing = audioRefs.current.get(key);
    if (existing && !existing.paused) {
      existing.pause();
      setPlayingKey('');
      return;
    }

    audioRefs.current.forEach((a, k) => { if (k !== key) a.pause(); });

    const audioUrl = localAudio[key]?.url || clips.find(c => clipKey(c) === key)?.audioUrl;
    if (!audioUrl) return;

    let el = audioRefs.current.get(key);
    if (!el) {
      el = new Audio(audioUrl);
      audioRefs.current.set(key, el);
      el.onended = () => setPlayingKey(prev => prev === key ? '' : prev);
    } else {
      el.src = audioUrl;
    }
    el.play().catch(() => {});
    setPlayingKey(key);
  }, [localAudio, clips, clipKey]);

  // ─── Loading / Error ──────────────────────────────────────────

  if (isLoading || storyboardLoading) {
    return (
      <div className="min-h-full bg-n20 flex items-center justify-center text-n100">
        加载中...
      </div>
    );
  }
  if (error || storyboardError) {
    return (
      <div className="min-h-full bg-n20 text-danger p-6">
        {error || storyboardError}
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="workflow-stage-layout h-full bg-n20 text-n800 flex flex-col">
      {/* Header */}
      <header className="workflow-stage-toolbar flex items-center gap-3 px-6 py-3 border-b border-n40 shrink-0">
        <Mic size={20} className="text-primary" />
        <h1 className="text-lg font-bold tracking-tight">声音工作台</h1>
        <div role="tablist" aria-label="声音工作台功能" className="ml-4 flex items-center rounded-xl border border-n40 bg-n30 p-1">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'dubbing'}
            onClick={() => setWorkspaceMode('dubbing')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              workspaceMode === 'dubbing'
                ? 'bg-primary text-white shadow-sm'
                : 'text-n500 hover:bg-n0 hover:text-n800'
            }`}
          >
            <Mic size={15} /> 配音制作
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${workspaceMode === 'dubbing' ? 'bg-white/20' : 'bg-n40 text-n100'}`}>台词</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'music'}
            onClick={() => setWorkspaceMode('music')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              workspaceMode === 'music'
                ? 'bg-success text-white shadow-sm'
                : 'text-n500 hover:bg-n0 hover:text-n800'
            }`}
          >
            <Music size={15} /> 音乐生成
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${workspaceMode === 'music' ? 'bg-white/20' : 'bg-success/10 text-success'}`}>BGM / 主题曲</span>
          </button>
        </div>
        <span className="flex-1" />
        <button
          onClick={handleExportToStoryboard}
          disabled={exporting}
          title="把配音字段同步回现有分镜；缺失时才新增"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success hover:bg-success text-white text-sm font-semibold transition-all disabled:opacity-60"
        >
          {exporting ? '同步中…' : <>同步到分镜 <ArrowRight size={14} /></>}
        </button>
      </header>

      {/* Main: parallel dubbing and music workspaces */}
      {workspaceMode === 'dubbing' ? (
        <div className="workflow-stage-layout flex flex-1 min-h-0">
          <VoiceSidebar
            assets={assets}
            characterVoices={characterVoices}
            projectId={projectId}
            reload={reload}
          />
          <DubbingPanel
            ref={dubbingRef}
            storyboardItems={resolvedItems}
            clips={clips}
            voiceMap={voiceMap}
            charAssetMap={charAssetMap}
            localOverrides={localOverrides}
            setLocalOverrides={setLocalOverrides}
            localAudio={localAudio}
            generatingIds={generatingIds}
            errors={errors}
            playingKey={playingKey}
            onGenerate={runGenerate}
            onTogglePlay={togglePlay}
            onBatchGenerate={handleBatchGenerate}
            batchRunning={batchRunning}
            allCharNames={allCharNames}
            clipKeyFn={clipKey}
            onClipPersist={handleClipPersist}
            onAddSpeech={handleAddSpeech}
            onAddSilence={handleAddSilence}
            onUpdateSilence={handleUpdateSilence}
            onRemoveSegment={handleRemoveSegment}
            onMoveSegment={handleMoveSegment}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden bg-n20 p-5">
          <MusicAssetSidebar audioTracks={audioTracks} />
          <div className="min-w-0 flex-1 overflow-hidden">
            <MusicModal
              presentation="embedded"
              episodeId={episodeId}
              projectId={projectId}
              script={script}
              onCreated={reloadAudioTracks}
            />
          </div>
        </div>
      )}

      {/* Timeline */}
      <MultiTrackTimeline
        storyboardItems={resolvedItems}
        clips={clips}
        localAudio={localAudio}
        audioTracks={audioTracks}
        clipKeyFn={clipKey}
        onClickItem={(itemId) => dubbingRef.current?.scrollToItem(itemId)}
        episodeId={episodeId}
        projectId={projectId}
        script={script}
        reload={reloadAudioTracks}
        collapsed={timelineCollapsed}
        onCollapsedChange={setTimelineCollapsed}
      />
    </div>
  );
};
