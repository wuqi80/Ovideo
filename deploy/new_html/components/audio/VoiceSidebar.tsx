import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  User, ChevronRight, Settings, Play, Save, Trash2, Loader,
  Volume2, Copy, Wand2, Upload, X,
} from 'lucide-react';
import {
  createCharacterVoice, updateCharacterVoice, deleteCharacterVoice,
  minimaxVoiceDesign, minimaxVoiceClone, minimaxFileUpload,
  minimaxTTSSync,
} from '../../services/apiService';
// 2026-05-25：试听切到 minimaxTTSSync (POST /api/minimax/tts/sync) 一步同步拿结果，
// 不再走 worker 入队 + 轮询。本组件不再 import ttsTaskPoller / TtsTimeoutError。
// 批量场景（AudioStagePage.runGenerate）仍用 worker 路径，那里继续 import minimaxTTS。
// Plan: docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md
import type { AssetItem, CharacterVoice, VoiceDesignSetting } from '../../types';
import {
  getVoicePreview, setVoicePreview,
  makeSystemKey, makeDesignKey, makeCloneKey,
} from '../../utils/voicePreviewCache';

function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/')) return path;
  return `/${path}`;
}

function hexToAudioBlobUrl(hex: string, mime = 'audio/mpeg') {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/**
 * 稳定的 JSON 序列化：递归对对象 key 排序后输出。
 * 必要性：voice_params.setting 存进 PostgreSQL JSONB 时**键序不保留**，
 * 取回后 JSON.stringify 可能产生不同字符串，导致 cache key 不匹配触发
 * 重复付费生成。所有用作"内容指纹"的 key 必须用 stableStringify。
 */
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function buildVoiceDesignPrompt(setting: VoiceDesignSetting): string {
  const gender = setting.voice_type === 'male' ? '男性' : '女性';
  const emotionMap: Record<string, string> = {
    happy: '高兴活泼', sad: '悲伤低沉', angry: '愤怒有力', fearful: '紧张害怕',
    disgusted: '厌恶冷淡', surprised: '惊讶明亮', neutral: '中性自然',
  };
  const pace = setting.speed > 1.05 ? '语速偏快' : setting.speed < 0.95 ? '语速偏慢' : '语速适中';
  const pitch = setting.pitch > 2 ? '音调偏高' : setting.pitch < -2 ? '音调偏低' : '音调自然';
  return `${gender}配音员，${emotionMap[setting.emotion] || '中性自然'}，${pace}，${pitch}，适合影视对白与旁白。`;
}

function getAssetThumb(asset: AssetItem | undefined): string {
  if (!asset) return '';
  const ef = (asset.entityFiles || []).find(f => f.fileRole === 'reference_image');
  if (ef) return resolveUrl(ef.fileUrl);
  const t = (asset as any).thumbnailUrl || (asset as any).thumbnail_url || '';
  if (t) return resolveUrl(t);
  const refs = (asset as any).referenceImages || (asset as any).reference_images || [];
  if (Array.isArray(refs) && refs.length > 0) {
    const first = typeof refs[0] === 'string' ? refs[0] : refs[0]?.url || '';
    return resolveUrl(first);
  }
  return '';
}

// MiniMax T2A 预置音色 (https://platform.minimaxi.com/document/T2A%20V2)
const SYSTEM_VOICES: Array<{ id: string; label: string; group: '男声' | '女声' | '主持' | '童声' }> = [
  { id: 'male-qn-qingse',       label: '青年男·清涩',  group: '男声' },
  { id: 'male-qn-jingying',     label: '青年男·精英',  group: '男声' },
  { id: 'male-qn-badao',        label: '青年男·霸道',  group: '男声' },
  { id: 'male-qn-daxuesheng',   label: '青年男·大学生', group: '男声' },
  { id: 'female-shaonv',        label: '少女',         group: '女声' },
  { id: 'female-yujie',         label: '御姐',         group: '女声' },
  { id: 'female-chengshu',      label: '成熟女声',      group: '女声' },
  { id: 'female-tianmei',       label: '甜美女声',      group: '女声' },
  { id: 'presenter_male',       label: '男主持',        group: '主持' },
  { id: 'presenter_female',     label: '女主持',        group: '主持' },
  { id: 'audiobook_male_1',     label: '男声有声书 1',  group: '主持' },
  { id: 'audiobook_male_2',     label: '男声有声书 2',  group: '主持' },
  { id: 'audiobook_female_1',   label: '女声有声书 1',  group: '主持' },
  { id: 'audiobook_female_2',   label: '女声有声书 2',  group: '主持' },
  { id: 'clever_boy',           label: '聪明男童',      group: '童声' },
  { id: 'cute_boy',             label: '可爱男童',      group: '童声' },
  { id: 'lovely_girl',          label: '可爱女童',      group: '童声' },
];

const SYSTEM_VOICE_DEFAULT = 'presenter_male';

// 仅在切换到 Gemini TTS 兜底时用到（保留旧 alias，避免历史角色配置失效）
const LEGACY_VOICE_ALIAS: Record<string, string> = {
  narrator: 'presenter_male',
  male_young: 'male-qn-qingse',
  female_young: 'female-shaonv',
  elder: 'audiobook_male_2',
  child: 'cute_boy',
};

type VoiceSource = 'system' | 'clone' | 'design';

export interface VoiceSidebarProps {
  assets: AssetItem[];
  characterVoices: CharacterVoice[];
  projectId: string;
  reload: () => Promise<void>;
}

export const VoiceSidebar: React.FC<VoiceSidebarProps> = ({
  assets, characterVoices, projectId, reload,
}) => {
  const characterAssets = useMemo(
    () => assets.filter(a => ((a as any).assetType || (a as any).asset_type) === 'character'),
    [assets],
  );

  const roles = useMemo(() => {
    const list: { name: string; asset?: AssetItem; voice?: CharacterVoice }[] = [];
    const voiceMap = new Map(characterVoices.map(v => [v.characterName, v]));
    for (const a of characterAssets) {
      const name = (a as any).name || '未命名';
      list.push({ name, asset: a, voice: voiceMap.get(name) });
    }
    if (!list.some(r => r.name === '旁白')) {
      list.push({ name: '旁白', voice: voiceMap.get('旁白') });
    }
    return list;
  }, [characterAssets, characterVoices]);

  const [drawerRole, setDrawerRole] = useState<string | null>(null);

  return (
    <div className="w-52 shrink-0 flex flex-col border-r border-gray-800 bg-gray-950">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-3 pt-4 pb-2">
        角色声音
      </h3>
      <div className="flex-1 overflow-auto space-y-1 px-2">
        {roles.map(role => {
          const thumb = getAssetThumb(role.asset);
          return (
            <button
              key={role.name}
              onClick={() => setDrawerRole(role.name)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all hover:bg-gray-900 group"
            >
              {thumb ? (
                <img src={thumb} alt="" className="w-8 h-8 rounded-lg object-cover bg-gray-800"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty('display'); }}
                />
              ) : null}
              <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center" style={thumb ? { display: 'none' } : undefined}>
                <User size={14} className="text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{role.name}</div>
                {role.voice ? (
                  <div className="text-[10px] text-emerald-400 truncate">
                    {role.voice.voiceName || '已配音'}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-600">未配音</div>
                )}
              </div>
              <ChevronRight size={12} className="text-gray-700 group-hover:text-gray-500 shrink-0" />
            </button>
          );
        })}
      </div>

      {drawerRole && (
        <VoiceDrawer
          roleName={drawerRole}
          role={roles.find(r => r.name === drawerRole)}
          projectId={projectId}
          onClose={() => setDrawerRole(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
};

// ─── Voice Design Drawer ──────────────────────────────────────────

export interface VoiceDrawerProps {
  roleName: string;
  role?: { name: string; asset?: AssetItem; voice?: CharacterVoice };
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /**
   * 当 open 从 true → false 时，进行中的 TTS 轮询会被 AbortController 取消。
   * 父组件 VoiceSidebar 现在通过条件挂载/卸载来"关闭"抽屉（不传 open），
   * 此时默认 true + unmount 清理仍能 abort 轮询。该 prop 主要用于测试。
   */
  open?: boolean;
}

export const VoiceDrawer: React.FC<VoiceDrawerProps> = ({
  roleName, role, projectId, onClose, onSaved, open = true,
}) => {
  // 从既有 voice / voice_params 还原 voiceSource。historical safety:
  // 老数据可能只有 voiceProvider + voiceModelId 没 voice_params.source，按
  // voice_id 前缀推断（ttv-voice 是 design，'_'前缀 / 长 id 视为 clone）。
  const existingParams = (role?.voice?.voiceParams || {}) as Record<string, any>;
  const inferSource = (): VoiceSource => {
    const src = existingParams.source as VoiceSource | undefined;
    if (src === 'system' || src === 'clone' || src === 'design') return src;
    const id = role?.voice?.voiceModelId || '';
    if (id.startsWith('ttv-voice-')) return 'design';
    if (id && !SYSTEM_VOICES.some(v => v.id === id)) return 'clone';
    return 'system';
  };

  const inferSystemVoiceId = (): string => {
    const id = role?.voice?.voiceModelId || '';
    if (SYSTEM_VOICES.some(v => v.id === id)) return id;
    if (id in LEGACY_VOICE_ALIAS) return LEGACY_VOICE_ALIAS[id];
    return SYSTEM_VOICE_DEFAULT;
  };

  const [voiceSource, setVoiceSource] = useState<VoiceSource>(inferSource);
  const [systemVoiceId, setSystemVoiceId] = useState(inferSystemVoiceId);

  // clone 不能从 File 对象恢复，但能从 voice_params 显示元信息
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [savedCloneMeta, setSavedCloneMeta] = useState<{ file_id?: string; filename?: string }>(() => ({
    file_id: existingParams.file_id, filename: existingParams.original_filename,
  }));

  const [designSetting, setDesignSetting] = useState<VoiceDesignSetting>(
    (existingParams.setting as VoiceDesignSetting) || {
      voice_type: 'female', emotion: 'neutral', speed: 1.0, pitch: 0,
    }
  );
  const [designText, setDesignText] = useState(
    (existingParams.preview_text as string) || '你好，这是一段测试语音。'
  );

  const [saving, setSaving] = useState(false);

  // ── 试听音频 cache（模块级 + localStorage 持久化）─────────────────
  // 关键修复（recurring-pitfalls §H state-coupled-to-lifecycle）：
  // 上一版用 useRef，drawer 卸载就丢。改用 voicePreviewCache 模块，
  // 跨 drawer 实例 / 跨 page / 跨刷新都活着。
  const designKey = useCallback(
    () => makeDesignKey(stableStringify(designSetting), designText),
    [designSetting, designText]
  );
  const systemKey = useCallback(() => makeSystemKey(systemVoiceId), [systemVoiceId]);

  const currentInputKey = voiceSource === 'design' ? designKey()
    : voiceSource === 'system' ? systemKey()
    : makeCloneKey(savedCloneMeta.file_id || '');

  // mount 时同步初始化：先查 cache，再 fallback 到 DB 里的 sample_audio_url。
  // 同时把 sample_audio_url 反向写入 cache，让模块成为真正的 single source of truth。
  const sampleAudioFromDb = role?.voice?.sampleAudioUrl ? resolveUrl(role.voice.sampleAudioUrl) : '';
  const initialCached = getVoicePreview(currentInputKey);
  const initialPreviewUrl = initialCached?.audioUrl || sampleAudioFromDb;
  if (sampleAudioFromDb && !initialCached && role?.voice?.voiceModelId) {
    setVoicePreview(currentInputKey, {
      voiceId: role.voice.voiceModelId,
      audioUrl: sampleAudioFromDb,
    });
  }

  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRef = useRef<HTMLAudioElement>(null);

  // 2026-05-24：MiniMax TTS 改异步后，handlePreview 进入"提交+长轮询"模式。
  // 抽屉关闭 / 组件卸载 时必须 abort，避免轮询泄漏到下一次打开（见
  // recurring-pitfalls §H state-coupled-to-lifecycle）。
  const previewAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open && previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }
    return () => {
      if (previewAbortRef.current) {
        previewAbortRef.current.abort();
        previewAbortRef.current = null;
      }
    };
  }, [open]);

  // previewUrl 是否"来自持久缓存"——影响 UI 文案
  const [previewIsPersisted, setPreviewIsPersisted] = useState(!!initialPreviewUrl);

  // input key 变化时（用户切系统音色 / 改设计参数 / 切音源）→ 自动从 cache 还原
  useEffect(() => {
    const entry = getVoicePreview(currentInputKey);
    if (entry?.audioUrl) {
      setPreviewUrl(entry.audioUrl);
      setPreviewIsPersisted(true);
    } else {
      setPreviewUrl('');
      setPreviewIsPersisted(false);
    }
  }, [currentInputKey]);

  // 没有 stale 概念了——cache 命中=立即还原；不命中=audio 清空。previewIsStale 删除。

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true);
    // 每次试听都用一个新的 AbortController：先 abort 上一次未完成的轮询。
    if (previewAbortRef.current) previewAbortRef.current.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;

    try {
      if (voiceSource === 'design') {
        const key = designKey();
        const cached = getVoicePreview(key);
        if (cached?.audioUrl) {
          setPreviewUrl(cached.audioUrl);
          setPreviewIsPersisted(true);
          return;
        }
        const res = await minimaxVoiceDesign(buildVoiceDesignPrompt(designSetting), designText);
        const audioUrl = res.audio_url ? resolveUrl(res.audio_url)
          : res.trial_audio ? hexToAudioBlobUrl(res.trial_audio)
          : '';
        if (res.voice_id && audioUrl) {
          setVoicePreview(key, { voiceId: res.voice_id, audioUrl });
        }
        if (audioUrl) {
          setPreviewUrl(audioUrl);
          // setVoicePreview 已写入持久层，从用户角度看就是"已保存"，UI 不必区分
          setPreviewIsPersisted(true);
        }
      } else if (voiceSource === 'system') {
        const key = systemKey();
        const cached = getVoicePreview(key);
        if (cached?.audioUrl) {
          setPreviewUrl(cached.audioUrl);
          setPreviewIsPersisted(true);
          return;
        }
        // 2026-05-25：试听走同步 fast-path（recurring-pitfalls §R 子陷阱 4）。
        // handler 内 1-3s 直接拿到 audio_url（典型短文本试听 < 100 字符），
        // 不再走 worker 入队 + 轮询。若 bind_to_character_voice_id 已传，
        // 后端 handler 会同时回写 character_voices.sample_audio_url，
        // 让下次直接命中持久缓存。
        const existingVoiceId = role?.voice?.voiceId;
        const result = await minimaxTTSSync({
          text: '你好，这是一段测试语音。',
          voice_id: systemVoiceId,
          speed: 1.0, pitch: 0,
          bind_to_character_voice_id: existingVoiceId,
        }, controller.signal);
        if (result.audio_url) {
          const url = resolveUrl(result.audio_url);
          setVoicePreview(key, { voiceId: systemVoiceId, audioUrl: url });
          setPreviewUrl(url);
          setPreviewIsPersisted(true);
        }
      } else if (voiceSource === 'clone') {
        // clone 试听本应在 handleSave 上传后才产生；如果已经保存过且 sample_audio_url 在，
        // previewUrl 已是该 URL，无需重新合成
        if (!previewUrl) {
          alert('请先选择并保存克隆音频，再试听');
        }
      }
    } catch (e: any) {
      // Drawer 关闭 / 用户重新点试听 触发的 abort 不算错误
      if (e?.name === 'AbortError') return;
      console.error('试听失败:', e);
      const msg = e?.message || '试听失败';
      // 2026-05-25：fast-path 是同步 endpoint，没有 worker timeout 概念。
      // 413 / 502 / 500 等错由 handleResponse 抛带后端 detail 文本的 Error。
      if (/未配置|MINIMAX_API_KEY|503/.test(msg)) {
        alert(`试听失败：${msg}\n\n请联系管理员在后台 → API 配置 中添加 MINIMAX_API_KEY（与 Hailuo 视频共用）。`);
      } else if (/过长|413/.test(msg)) {
        alert(`试听失败：试听文本过长（>1000 字符）。试听通常只用短文本，请检查代码或联系开发。`);
      } else {
        alert(`试听失败：${msg}`);
      }
    } finally {
      setPreviewLoading(false);
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
      }
    }
  }, [voiceSource, designText, designSetting, systemVoiceId, designKey, systemKey, previewUrl, role]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const existing = role?.voice;
      let provider = 'minimax';
      let modelId = systemVoiceId;
      let voiceName = SYSTEM_VOICES.find(v => v.id === systemVoiceId)?.label || systemVoiceId;
      let params: Record<string, any> = { source: 'system', voice_id: systemVoiceId };
      let sampleUrl: string | null = previewUrl || null;

      if (voiceSource === 'clone') {
        if (cloneFile) {
          const uploadRes = await minimaxFileUpload(cloneFile, 'voice_clone');
          const fileId = uploadRes.file_id;
          const cloneRes = await minimaxVoiceClone(fileId, undefined, '你好，这是一段测试语音。', roleName);
          modelId = cloneRes.voice_id || '';
          voiceName = `${roleName}-克隆`;
          const cloneAudio = cloneRes.audio_url ? resolveUrl(cloneRes.audio_url)
            : cloneRes.demo_audio || '';
          sampleUrl = cloneAudio || sampleUrl;
          params = {
            source: 'clone',
            file_id: fileId,
            original_filename: cloneFile.name,
            cloned_voice_id: modelId,
          };
          if (cloneAudio) {
            setVoicePreview(makeCloneKey(fileId), { voiceId: modelId, audioUrl: cloneAudio });
            setPreviewUrl(cloneAudio);
            setPreviewIsPersisted(true);
          }
        } else if (existing?.voiceProvider === 'minimax' && existing.voiceModelId) {
          // 用户没重新上传文件，复用已保存的克隆音色
          modelId = existing.voiceModelId;
          voiceName = existing.voiceName || `${roleName}-克隆`;
          params = { ...existingParams, source: 'clone' };
        } else {
          alert('请选择要克隆的音频文件');
          return;
        }
      } else if (voiceSource === 'design') {
        const key = designKey();
        const cached = getVoicePreview(key);
        if (cached?.voiceId) {
          // 复用试听拿到的 voice_id → 保存的音色就是试听听到的那个，杜绝"两次生成两个不同 voice_id"
          modelId = cached.voiceId;
          sampleUrl = cached.audioUrl || sampleUrl;
        } else {
          // 用户没试听就直接保存，临时调一次
          const designRes = await minimaxVoiceDesign(buildVoiceDesignPrompt(designSetting), designText);
          modelId = designRes.voice_id || '';
          const audioUrl = designRes.audio_url ? resolveUrl(designRes.audio_url)
            : designRes.trial_audio ? hexToAudioBlobUrl(designRes.trial_audio)
            : '';
          sampleUrl = audioUrl || sampleUrl;
          if (modelId && audioUrl) {
            setVoicePreview(key, { voiceId: modelId, audioUrl });
            setPreviewUrl(audioUrl);
            setPreviewIsPersisted(true);
          }
        }
        voiceName = `${roleName}-设计`;
        params = {
          source: 'design',
          setting: designSetting,
          preview_text: designText,
          designed_voice_id: modelId,
        };
      } else {
        // system：把 cached 试听 URL 写到 sample_audio_url，下次重开直接放
        const cached = getVoicePreview(systemKey());
        if (cached?.audioUrl) {
          sampleUrl = cached.audioUrl;
        }
        params = { source: 'system', voice_id: systemVoiceId };
      }

      if (!modelId) {
        alert('未生成有效音色 ID，请重试或换一种音源');
        return;
      }

      if (existing) {
        await updateCharacterVoice(existing.voiceId, {
          voice_provider: provider,
          voice_model_id: modelId,
          voice_name: voiceName,
          voice_params: params,
          sample_audio_url: sampleUrl,
        });
      } else {
        const matchingAsset = role?.asset;
        await createCharacterVoice({
          project_id: projectId,
          character_name: roleName,
          asset_id: matchingAsset ? ((matchingAsset as any).assetId || (matchingAsset as any).asset_id) : undefined,
          voice_provider: provider,
          voice_model_id: modelId,
          voice_name: voiceName,
          voice_params: params,
          sample_audio_url: sampleUrl || undefined,
        });
      }
      if (voiceSource === 'clone' && cloneFile) {
        setSavedCloneMeta({ file_id: (params as any).file_id, filename: cloneFile.name });
        setCloneFile(null);
      }
      await onSaved();
      onClose();
    } catch (e: any) {
      console.error('保存音色失败:', e);
      alert(`保存音色失败：${e?.message || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }, [
    roleName, voiceSource, systemVoiceId, cloneFile, designSetting, designText,
    previewUrl, role, projectId, onSaved, onClose, designKey, systemKey, existingParams,
  ]);

  const handleDeleteVoice = useCallback(async (voiceId: string) => {
    try {
      await deleteCharacterVoice(voiceId);
      await onSaved();
      onClose();
    } catch (e) {
      console.error('删除失败:', e);
    }
  }, [onSaved, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-96 bg-gray-900 border-l border-gray-800 h-full overflow-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Settings size={16} className="text-indigo-400" />
            {roleName} — 声音配置
            {role?.voice && (
              <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded ml-2">
                已配: {role.voice.voiceName}
              </span>
            )}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        {/* Source selector */}
        <div className="flex gap-2 mb-5">
          {([
            { id: 'system' as VoiceSource, label: '系统预设', icon: Volume2 },
            { id: 'clone' as VoiceSource, label: '声音克隆', icon: Copy },
            { id: 'design' as VoiceSource, label: '声音设计', icon: Wand2 },
          ]).map(src => (
            <button
              key={src.id}
              onClick={() => setVoiceSource(src.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                voiceSource === src.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'
              }`}
            >
              <src.icon size={12} /> {src.label}
            </button>
          ))}
        </div>

        {/* System preset (MiniMax 海螺 预置音色) */}
        {voiceSource === 'system' && (
          <div className="space-y-3 mb-5">
            <label className="block text-xs text-gray-500">
              选择系统声音 <span className="text-gray-600">(MiniMax 海螺 T2A)</span>
            </label>
            {(['男声', '女声', '主持', '童声'] as const).map(group => {
              const items = SYSTEM_VOICES.filter(v => v.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <div className="text-[10px] text-gray-600 mb-1.5">{group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map(v => (
                      <button
                        key={v.id}
                        onClick={() => setSystemVoiceId(v.id)}
                        className={`px-2.5 py-1.5 rounded-md text-xs transition-all ${
                          systemVoiceId === v.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Clone */}
        {voiceSource === 'clone' && (
          <div className="space-y-3 mb-5">
            {savedCloneMeta.filename && !cloneFile && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                <Volume2 size={12} />
                <span className="flex-1 truncate">已配置克隆音色：{savedCloneMeta.filename}</span>
                <span className="text-emerald-500/70 text-[10px]">复用已克隆</span>
              </div>
            )}
            <label className="block text-xs text-gray-500">
              {savedCloneMeta.filename ? '重新上传参考音频（可选）' : '上传参考音频（10-300 秒清晰人声）'}
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 cursor-pointer hover:bg-gray-700 transition-all">
                <Upload size={14} />
                {cloneFile ? cloneFile.name : '选择文件'}
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={e => setCloneFile(e.target.files?.[0] || null)}
                />
              </label>
              {cloneFile && (
                <span className="text-xs text-gray-500">{(cloneFile.size / 1024).toFixed(0)} KB</span>
              )}
            </div>
          </div>
        )}

        {/* Design */}
        {voiceSource === 'design' && (
          <div className="space-y-4 mb-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">声音类型</label>
                <select
                  value={designSetting.voice_type}
                  onChange={e => setDesignSetting(p => ({ ...p, voice_type: e.target.value as any }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                >
                  <option value="male">男声</option>
                  <option value="female">女声</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">情绪</label>
                <select
                  value={designSetting.emotion}
                  onChange={e => setDesignSetting(p => ({ ...p, emotion: e.target.value as any }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                >
                  <option value="neutral">中性</option>
                  <option value="happy">快乐</option>
                  <option value="sad">悲伤</option>
                  <option value="angry">愤怒</option>
                  <option value="excited">兴奋</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">语速 ({designSetting.speed.toFixed(1)}x)</label>
                <input
                  type="range" min="0.5" max="2.0" step="0.1"
                  value={designSetting.speed}
                  onChange={e => setDesignSetting(p => ({ ...p, speed: parseFloat(e.target.value) }))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">音调 ({designSetting.pitch})</label>
                <input
                  type="range" min="-12" max="12" step="1"
                  value={designSetting.pitch}
                  onChange={e => setDesignSetting(p => ({ ...p, pitch: parseInt(e.target.value) }))}
                  className="w-full"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">试听文本</label>
              <textarea
                value={designText}
                onChange={e => setDesignText(e.target.value)}
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none"
              />
            </div>
          </div>
        )}

        {/* Preview + Save —— 两行布局：上行 audio 全宽，下行操作按钮 */}
        <div className="pt-4 border-t border-gray-800 space-y-3">
          {/* 试听音频卡片：独立全宽，避免被按钮挤成"白点" */}
          {previewUrl ? (
            <div className="rounded-lg border p-3 transition-colors bg-gradient-to-br from-indigo-500/8 to-purple-500/5 border-indigo-500/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[11px] text-indigo-300 font-medium">
                  <Volume2 size={11} />
                  试听音频
                </div>
                {previewIsPersisted ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    已永久缓存
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    新生成
                  </span>
                )}
              </div>
              <audio
                ref={previewRef}
                src={previewUrl}
                controls
                className="w-full h-9"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-700 p-3 text-center text-[11px] text-gray-500">
              {voiceSource === 'clone' && !cloneFile && !savedCloneMeta.filename
                ? '请先上传参考音频后再试听'
                : '点击"试听"生成预览音频'}
            </div>
          )}

          {/* 操作按钮行 */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreview}
              disabled={previewLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:bg-gray-700 transition-all disabled:opacity-50"
            >
              {previewLoading ? <Loader size={13} className="animate-spin" /> : <Play size={13} />}
              {previewUrl && previewIsPersisted ? '重新生成' : '试听'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20"
            >
              {saving ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
              保存配置
            </button>
            {role?.voice && (
              <button
                onClick={() => handleDeleteVoice(role.voice!.voiceId)}
                className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-red-400 hover:bg-red-600/10 text-xs transition-all"
                title="删除当前角色配音"
              >
                <Trash2 size={13} />
                <span>删除</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
