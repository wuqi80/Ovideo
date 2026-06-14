import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, ArrowRight } from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import {
  // 2026-05-24 (Bug 2)：移除 generateSpeech（Gemini TTS）导入。
  // 配音页所有 TTS 统一走 MiniMax；没有绑定 voice_id 的角色用 MINIMAX_DEFAULT_VOICE 兜底，
  // 历史持久化里残留的 legacy persona 字符串（'narrator'/'male_young'/...）通过
  // LEGACY_VOICE_ALIAS 转译成 MiniMax 官方音色 id。
  minimaxTTS,
  updateStoryboardItem as apiUpdateStoryboardItem,
} from '../services/apiService';

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
import { stripDialogueMarkers } from '../utils/scriptPipelineParsers';
import { VoiceSidebar } from '../components/audio/VoiceSidebar';
import { DubbingPanel, type DubbingPanelHandle } from '../components/audio/DubbingPanel';
import { MultiTrackTimeline } from '../components/audio/MultiTrackTimeline';
import type { AudioClipInfo, ClipOverride, CharacterVoice, AssetItem } from '../types';
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

export const AudioStagePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    storyboardItems, assets, characterVoices, audioTracks,
    projectId, episodeId, script, isLoading, error, reload, loadSlices,
    saveStoryboardItem,
  } = useEpisode();

  useEffect(() => {
    loadSlices('storyboardItems', 'assets', 'characterVoices', 'script', 'audioTracks');
  }, [loadSlices]);

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

      let speaker = '';
      let text = raw;
      const candidates = [...charNames, '旁白'];
      for (const name of candidates) {
        if (raw.startsWith(name)) {
          speaker = name;
          text = raw.slice(name.length).replace(/^[：:，,\s]+/, '').trim() || raw;
          break;
        }
      }
      if (!speaker) speaker = charNames[0] || '旁白';

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
  // localAudio 不持久化 —— 已通过 loadSlices('storyboardItems') 从 DB 重拉，刷新后 clips 自带 audioUrl。
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
      // 同时成功后调 loadSlices('storyboardItems') 强制从 DB 重拉，保证 EpisodeContext
      // 与 DB 一致——下次刷新页面音频不会消失。
      try {
        await apiUpdateStoryboardItem(clip.itemId, updateFields);
        await loadSlices('storyboardItems');
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
  }, [voiceMap, localOverrides, clipKey, episodeId, projectId, loadSlices]);

  const handleBatchGenerate = useCallback(async () => {
    if (batchRunning || clips.length === 0) return;
    setBatchRunning(true);
    try {
      for (const clip of clips) await runGenerate(clip);
    } finally {
      setBatchRunning(false);
    }
  }, [clips, batchRunning, runGenerate]);

  const handleTextPersist = useCallback(async (itemId: string, speaker: string, newText: string) => {
    const fullDialogue = newText ? (speaker ? `${speaker}：${newText}` : newText) : '';
    try {
      await saveStoryboardItem(itemId, { dialogue: fullDialogue });
    } catch (e) {
      console.error('持久化台词失败:', e);
    }
  }, [saveStoryboardItem]);

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

  if (isLoading) {
    return (
      <div className="min-h-full bg-n20 flex items-center justify-center text-n100">
        加载中...
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-full bg-n20 text-danger p-6">
        {error}
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
          onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success hover:bg-success text-white text-sm font-semibold transition-all"
        >
          导出到分镜 <ArrowRight size={14} />
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
