/**
 * Voice Preview Cache —— 模块级单例 + localStorage 持久化
 *
 * 设计动机（命中 recurring-pitfalls §H state-coupled-to-lifecycle）：
 * VoiceSidebar 把试听产物缓存在 useRef，drawer 一关 component 卸载就丢，
 * 用户重开同一角色还是要重新付费生成。
 *
 * 修复：把"input 指纹 → 音色 voice_id + audio_url"映射放到模块级 + localStorage，
 * 跨 drawer 实例、跨 page、跨刷新都活着。
 *
 * Cache key 约定（必须用 stableStringify 保证 JSONB 来源也能命中）：
 * - system : `system:<voice_id>`                       — 跨项目/角色复用
 * - design : `design:<stableStringify(setting)>:<text>` — 参数文本完全一致才复用
 * - clone  : `clone:<file_id>`                         — 同一上传文件复用
 *
 * audio_url 必须是**持久 URL**（/storage/audio/xxx.mp3 或绝对 URL），
 * blob: 前缀视为内存对象不入 cache。
 */

const LS_KEY = 'voice_preview_cache_v1';
const MAX_ENTRIES = 100;

export type VoicePreviewEntry = {
  voiceId: string;
  audioUrl: string;
  ts: number;
};

type Store = Record<string, VoicePreviewEntry>;

function safeLoad(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

let memory: Store = safeLoad();

function persist() {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(memory);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].ts - a[1].ts);
      memory = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }
    window.localStorage.setItem(LS_KEY, JSON.stringify(memory));
  } catch (e) {
    console.warn('[voicePreviewCache] persist failed:', e);
  }
}

export function getVoicePreview(key: string): VoicePreviewEntry | null {
  if (!key) return null;
  const e = memory[key];
  if (!e || !e.audioUrl) return null;
  // 触摸时间戳供 LRU
  e.ts = Date.now();
  return e;
}

export function setVoicePreview(
  key: string,
  entry: { voiceId: string; audioUrl: string }
): void {
  if (!key || !entry.audioUrl) return;
  if (entry.audioUrl.startsWith('blob:')) return;
  memory[key] = { ...entry, ts: Date.now() };
  persist();
}

export function clearVoicePreview(key?: string): void {
  if (key) {
    delete memory[key];
  } else {
    memory = {};
  }
  persist();
}

/**
 * 计算 cache key（与 VoiceSidebar 内部使用一致）。
 * 注意：stableStringify 在 VoiceSidebar 内已存在，此处接受调用方传入 string。
 */
export function makeSystemKey(voiceId: string): string {
  return `system:${voiceId}`;
}
export function makeDesignKey(settingStableJSON: string, text: string): string {
  return `design:${settingStableJSON}:${text}`;
}
export function makeCloneKey(fileId: string): string {
  return `clone:${fileId}`;
}
