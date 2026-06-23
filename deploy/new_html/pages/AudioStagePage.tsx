import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, ArrowRight } from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import {
  // 2026-05-24 (Bug 2)：移除 generateSpeech（Gemini TTS）导入。
  // 配音页所有 TTS 统一走 MiniMax；没有绑定 voice_id 的角色用 MINIMAX_DEFAULT_VOICE 兜底，
  // 历史持久化里残留的 legacy persona 字符串（'narrator'/'male_young'/...）通过
  // LEGACY_VOICE_ALIAS 转译成 MiniMax 官方音色 id。
  createStoryboardItem as apiCreateStoryboardItem,
} from '../services/storyboardMutationService';
import { getStoryboardItems, updateStoryboardItem as apiUpdateStoryboardItem } from '../services/episodeDataService';
import { minimaxTTS } from '../services/audioGenerationService';
import { crmMessage } from '../admin/crmUI';

// MiniMax 默认音色（与 VoiceSidebar 的 SYSTEM_VOICE_DEFAULT 对齐）
const MINIMAX_DEFAULT_VOICE = 'presenter_male';

// 历史 characterVoices 里若残留 Gemini TTS 时代的 persona 字符串，转译到 MiniMax 官方音色 id
const LEGACY_VOICE_ALIAS: Record<string, string> = {
  narrator: 'presenter_male',
  male_young: 'male-qn-qingse',
  female_young: 'female-shaonv',
  elder: 'audiobook_male_2',
  child: 'cute_boy',
};

function resolveMinimaxVoiceId(modelId?: string | null): string {
  const raw = (modelId || '').trim();
  if (!raw) return MINIMAX_DEFAULT_VOICE;
  return LEGACY_VOICE_ALIAS[raw] || raw;
}
import { parseBoundAssetTags } from '../utils/episodeAdapters';
import { stripDialogueMarkers, extractSpokenDialogue } from '../utils/scriptPipelineParsers';
import { waitForIdle } from '../utils/idleScheduler';
import { VoiceSidebar } from '../components/audio/VoiceSidebar';
import { DubbingPanel, type DubbingPanelHandle } from '../components/audio/DubbingPanel';
import { MultiTrackTimeline } from '../components/audio/MultiTrackTimeline';
import type { AudioClipInfo, ClipOverride, CharacterVoice, AssetItem, StoryboardItemDB } from '../types';
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

function safeBoundAssets(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    } catch {}
  }
  return [];
}

function normalizeAudioStageStoryboardItem(r: any): StoryboardItemDB {
  return {
    itemId: r.item_id ?? r.itemId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    sceneHeading: r.scene_heading ?? r.sceneHeading ?? '',
    actionText: r.action_text ?? r.actionText ?? '',
    dialogue: r.dialogue ?? '',
    cameraMovement: r.camera_movement ?? r.cameraMovement ?? '',
    imagePrompt: r.image_prompt ?? r.imagePrompt ?? '',
    videoPrompt: r.video_prompt ?? r.videoPrompt ?? '',
    generatedImageUrl: null,
    boundAssets: safeBoundAssets(r.bound_assets ?? r.boundAssets),
    status: r.status ?? 'draft',
    dialogueAudioUrl: r.dialogue_audio_url ?? r.dialogueAudioUrl ?? null,
    narrationAudioUrl: r.narration_audio_url ?? r.narrationAudioUrl ?? null,
    sfxAudioUrl: r.sfx_audio_url ?? r.sfxAudioUrl ?? null,
    audioDurationMs: r.audio_duration_ms ?? r.audioDurationMs ?? null,
    plannedDurationMs: r.planned_duration_ms ?? r.plannedDurationMs ?? null,
  };
}

function applyAudioStageStoryboardPatch(item: StoryboardItemDB, patch: Record<string, any>): StoryboardItemDB {
  return {
    ...item,
    sceneHeading: patch.scene_heading ?? patch.sceneHeading ?? item.sceneHeading,
    actionText: patch.action_text ?? patch.actionText ?? item.actionText,
    dialogue: patch.dialogue ?? item.dialogue,
    cameraMovement: patch.camera_movement ?? patch.cameraMovement ?? item.cameraMovement,
    imagePrompt: patch.image_prompt ?? patch.imagePrompt ?? item.imagePrompt,
    videoPrompt: patch.video_prompt ?? patch.videoPrompt ?? item.videoPrompt,
    boundAssets: patch.bound_assets !== undefined || patch.boundAssets !== undefined
      ? safeBoundAssets(patch.bound_assets ?? patch.boundAssets)
      : item.boundAssets,
    dialogueAudioUrl: patch.dialogue_audio_url ?? patch.dialogueAudioUrl ?? item.dialogueAudioUrl,
    narrationAudioUrl: patch.narration_audio_url ?? patch.narrationAudioUrl ?? item.narrationAudioUrl,
    sfxAudioUrl: patch.sfx_audio_url ?? patch.sfxAudioUrl ?? item.sfxAudioUrl,
    audioDurationMs: patch.audio_duration_ms ?? patch.audioDurationMs ?? item.audioDurationMs,
    plannedDurationMs: patch.planned_duration_ms ?? patch.plannedDurationMs ?? item.plannedDurationMs,
    status: patch.status ?? item.status,
  };
}

const AUDIO_STAGE_STORYBOARD_INITIAL_LOAD_LIMIT = 20;
const AUDIO_STAGE_STORYBOARD_BACKGROUND_PAGE_SIZE = 80;

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

  // 「导出到分镜」= 把当前脚本+素材绑定「导出」成一套**全新的分镜镜头**追加到分镜列表
  // （复制场景/动作/台词/提示词 + 素材绑定，但不带已生成的图/音 → 新镜头待重新出图），
  // 原有镜头不动。这样每改一次前面的素材，点一下就生成一套新分镜去重新生成画面。
  const handleExportToStoryboard = useCallback(async () => {
    if (exporting) return;
    const items = [...storyboardItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (!items.length) {
      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`);
      return;
    }
    setExporting(true);
    try {
      let nextSort = items.reduce((m, it) => Math.max(m, it.sortOrder ?? 0), 0);
      for (const it of items) {
        nextSort += 1;
        const res: any = await apiCreateStoryboardItem(episodeId, {
          sort_order: nextSort,
          script_id: selectedScriptId || undefined,
          scene_heading: it.sceneHeading || '',
          action_text: it.actionText || '',
          dialogue: it.dialogue || '',
          camera_movement: it.cameraMovement || '',
          image_prompt: it.imagePrompt || '',
          video_prompt: it.videoPrompt || '',
        });
        const newId = res?.item?.item_id || res?.item?.itemId;
        // 复制素材绑定（create 接口不收 bound_assets，用 update 补）
        if (newId && Array.isArray(it.boundAssets) && it.boundAssets.length) {
          await apiUpdateStoryboardItem(newId, { bound_assets: it.boundAssets });
        }
      }
      crmMessage.success(`已导出 ${items.length} 个新分镜，去分镜页生成画面`);
      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`);
    } catch (e: any) {
      crmMessage.error(`导出到分镜失败：${e?.message || e}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, storyboardItems, episodeId, selectedScriptId, projectId, navigate]);

  const updateAudioStageStoryboardItem = useCallback(async (itemId: string, data: Record<string, any>) => {
    await apiUpdateStoryboardItem(itemId, data);
    setStoryboardItems(prev => prev.map(item =>
      item.itemId === itemId ? applyAudioStageStoryboardPatch(item, data) : item
    ));
  }, []);

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
    names.add('旁白');
    return Array.from(names);
  }, [storyboardItems]);

  // ─── Clips builder (fixed: dialogue only, filter placeholders) ─

  const clips: AudioClipInfo[] = useMemo(() => {
    const result: AudioClipInfo[] = [];
    for (const item of sortedItems) {
      // 剥掉「（台词）/（OS）/（OV）」类型标记，避免 TTS 把标记念出来（兼容历史数据）
      const raw = stripDialogueMarkers((item.dialogue || '').trim());
      if (!raw || /^(无|无台词|无对白|\(无台词\))$/.test(raw)) continue;

      const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
      const { charNames } = parseBoundAssetTags(boundAssets);

      // 提取说话人 + 实际朗读内容：剥掉「名字：」前缀和包裹引号，TTS 只念台词本身。
      // 例：小悟：「别跟我说话……」→ speaker=小悟, text=别跟我说话……
      const parsed = extractSpokenDialogue(raw, charNames);
      let text = parsed.text;
      let speaker = parsed.speaker || charNames[0] || '旁白';

      const type = speaker === '旁白' ? 'narration' as const : 'dialogue' as const;
      const audioField = type === 'narration' ? item.narrationAudioUrl : item.dialogueAudioUrl;

      result.push({
        itemId: item.itemId,
        sortOrder: item.sortOrder,
        type,
        text,
        characterName: speaker,
        audioUrl: audioField ? resolveUrl(audioField) : null,
        durationMs: audioField ? (item.audioDurationMs || null) : null,
        voiceId: voiceMap.get(speaker)?.voiceModelId || null,
      });
    }
    return result;
  }, [sortedItems, voiceMap]);

  const clipKey = useCallback((c: AudioClipInfo) => `${c.itemId}_${c.type}`, []);

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
    const voice = voiceMap.get(override.speaker ?? clip.characterName);

    setErrors(p => { const n = { ...p }; delete n[key]; return n; });
    setGeneratingIds(p => new Set(p).add(key));

    // 2026-05-20 (M3)：注册到全局 taskRegistry。同 itemId 重复生成会用 register 的
    // upsert 行为：旧任务会被新一次的 running 替换。
    const registryTaskId = `tts:${clip.itemId}:${clip.type}`;
    const speakerLabel = override.speaker ?? clip.characterName ?? '配音';
    // 2026-05-24 (Bug 2)：配音页全部统一走 MiniMax，taskRegistry kind 写死 'minimax-tts'
    const provider = 'minimax-tts';
    try {
      taskRegistry.register({
        taskId: registryTaskId,
        kind: provider,
        title: `${clip.type === 'narration' ? '旁白' : '对白'} · ${speakerLabel}`,
        targetPage: 'audio',
        initialStatus: 'running',
        progress: 0,
        targetEntityType: 'storyboard_item',
        targetEntityId: clip.itemId,
        targetItemId: clip.itemId,
        targetProjectId: projectId || undefined,
        episodeId: episodeId || undefined,
        fileRole: clip.type === 'narration' ? 'narration_audio' : 'dialogue_audio',
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
      const vp = (voice?.voiceParams || {}) as any;
      const settingFromParams = (vp.setting || vp) as Record<string, any>;
      const emotion = override.emotion ?? settingFromParams.emotion;
      const speed = override.speed ?? settingFromParams.speed ?? 1.0;
      const pitch = override.pitch ?? settingFromParams.pitch ?? 0;

      // 2026-05-24 (Bug 2)：配音页 TTS 统一走 MiniMax。
      // - 角色已在 VoiceSidebar 显式绑定 minimax 音色 → 直接用 voiceModelId
      // - 未绑定 / 绑定的是 legacy persona 字符串 → 经 resolveMinimaxVoiceId 转译
      // - 完全没绑 → 用 presenter_male 兜底
      // 删除原 Gemini fallback 分支，避免"未绑定时静默走 Gemini"。
      const minimaxVoiceId = resolveMinimaxVoiceId(voice?.voiceModelId);

      // 2026-05-24 (Task 7)：1. enqueue —— handler 立刻返回数据库 task_id，
      // 不再阻塞撞反代 5min idle timeout（recurring-pitfalls §Q）。
      const ttsArgs = {
        text: textToSpeak, voice_id: minimaxVoiceId, speed, emotion, pitch,
        entity_type: 'storyboard_item', entity_id: clip.itemId,
        file_role: clip.type === 'narration' ? 'narration_audio' : 'dialogue_audio',
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

      const updateFields: Record<string, any> = {};
      if (clip.type === 'narration') updateFields.narration_audio_url = url;
      else updateFields.dialogue_audio_url = url;
      if (durationMs != null && Number.isFinite(durationMs)) updateFields.audio_duration_ms = durationMs;

      // 2026-05-20 (Bug 4)：之前 catch 静默吞错，导致 DB 写失败时用户看到 localAudio
      // 显示成功、刷新就丢了。改为：失败时记入 errors[key]、console.error、并提示重试。
      // 同时成功后更新本页轻量 storyboard 状态，保证页面与 DB 一致——下次刷新页面音频不会消失。
      try {
        await updateAudioStageStoryboardItem(clip.itemId, updateFields);
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
  }, [voiceMap, localOverrides, clipKey, episodeId, projectId, updateAudioStageStoryboardItem]);

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

  const handleTextPersist = useCallback(async (itemId: string, speaker: string, newText: string) => {
    const fullDialogue = newText ? (speaker ? `${speaker}：${newText}` : newText) : '';
    try {
      await updateAudioStageStoryboardItem(itemId, { dialogue: fullDialogue });
    } catch (e) {
      console.error('持久化台词失败:', e);
    }
  }, [updateAudioStageStoryboardItem]);

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
    <div className="h-full bg-n20 text-n800 flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-n40 shrink-0">
        <Mic size={20} className="text-primary" />
        <h1 className="text-lg font-bold tracking-tight">声音与配音</h1>
        <span className="flex-1" />
        <button
          onClick={handleExportToStoryboard}
          disabled={exporting}
          title="把当前脚本+素材导出成一套全新分镜（原有镜头不动）"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success hover:bg-success text-white text-sm font-semibold transition-all disabled:opacity-60"
        >
          {exporting ? '导出中…' : <>导出到分镜 <ArrowRight size={14} /></>}
        </button>
      </header>

      {/* Main: Sidebar + DubbingPanel */}
      <div className="flex flex-1 min-h-0">
        <VoiceSidebar
          assets={assets}
          characterVoices={characterVoices}
          projectId={projectId}
          reload={reload}
        />
        <DubbingPanel
          ref={dubbingRef}
          storyboardItems={storyboardItems}
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
          onTextPersist={handleTextPersist}
        />
      </div>

      {/* Timeline */}
      <MultiTrackTimeline
        storyboardItems={storyboardItems}
        clips={clips}
        localAudio={localAudio}
        audioTracks={audioTracks}
        clipKeyFn={clipKey}
        onClickItem={(itemId) => dubbingRef.current?.scrollToItem(itemId)}
        episodeId={episodeId}
        script={script}
        reload={reload}
      />
    </div>
  );
};
