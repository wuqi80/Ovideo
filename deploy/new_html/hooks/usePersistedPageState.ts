// new_html/hooks/usePersistedPageState.ts
// Page-scoped transient state that survives navigation and reload.
//
// 用法：
//   const [draft, setDraft] = usePersistedPageState({
//       page: 'AudioStagePage',
//       episodeId,           // 不同剧集隔离；可为 null（用 'global'）
//       version: 1,          // bump 后旧 key 自动失效（schema 不兼容时）
//       defaultValue: { localOverrides: {}, localAudio: {} },
//   });
//
// 设计原则：
// - sessionStorage（关 tab/换浏览器就清）— 比 localStorage 更适合 transient state
// - episodeId scoped — 切换剧集时数据隔离，不会混淆
// - versioned key — 修改 schema 时 bump version，旧数据自动忽略
// - SSR-safe — 服务器渲染或 sessionStorage 不可用时 fallback 到内存

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PersistedPageStateOptions<T> {
    /** 页面唯一标识，例如 'AudioStagePage' / 'GenerationPage' / 'VideoPage' */
    page: string;
    /** 剧集 / 项目 id；用于隔离不同剧集数据；null/undefined 时归入 'global' */
    episodeId?: string | null;
    /** schema 版本号；不兼容旧数据时 bump（旧 key 自然失效） */
    version: number;
    /** 默认值（无存储 / 反序列化失败时使用） */
    defaultValue: T;
    /** 自定义 storage 名（默认 sessionStorage；可注入 localStorage 测试或长期保留） */
    storage?: Storage | null;
}

const STORAGE_KEY_PREFIX = 'ostory:page-state';

export function buildStorageKey(page: string, episodeId: string | null | undefined, version: number): string {
    const epi = episodeId == null || episodeId === '' ? 'global' : episodeId;
    return `${STORAGE_KEY_PREFIX}:v${version}:${page}:${epi}`;
}

function safeGetStorage(custom?: Storage | null): Storage | null {
    if (custom !== undefined) return custom;
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function loadInitial<T>(
    page: string,
    episodeId: string | null | undefined,
    version: number,
    defaultValue: T,
    storage: Storage | null,
): T {
    if (!storage) return defaultValue;
    try {
        const key = buildStorageKey(page, episodeId, version);
        const raw = storage.getItem(key);
        if (raw == null) return defaultValue;
        const parsed = JSON.parse(raw);
        return parsed as T;
    } catch (err) {
        console.warn(`[usePersistedPageState] load failed for ${page}:`, err);
        return defaultValue;
    }
}

/**
 * Persist a piece of React state to sessionStorage scoped by page + episodeId.
 *
 * Switching episodeId loads that episode's value (or default if first visit).
 * Refreshing keeps the value. Closing the tab clears (sessionStorage semantics).
 */
export function usePersistedPageState<T>(
    options: PersistedPageStateOptions<T>,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
    const { page, episodeId, version, defaultValue, storage: customStorage } = options;
    const storageRef = useRef<Storage | null>(safeGetStorage(customStorage));
    // 用于 clear() 后跳过下次 save effect，避免立即把 defaultValue 写回 storage
    const skipNextSaveRef = useRef<boolean>(false);

    // Initial value: lazy-init from storage on first mount
    const [value, setValue] = useState<T>(() =>
        loadInitial(page, episodeId, version, defaultValue, storageRef.current),
    );

    // When episodeId changes, reload from new key
    const lastEpiRef = useRef<string | null | undefined>(episodeId);
    useEffect(() => {
        if (lastEpiRef.current !== episodeId) {
            lastEpiRef.current = episodeId;
            const next = loadInitial(page, episodeId, version, defaultValue, storageRef.current);
            // episode 切换后的赋值是从 storage 读出来的，不需要再写回去
            skipNextSaveRef.current = true;
            setValue(next);
        }
    // defaultValue 是引用类型，故意不写依赖（避免每渲染重置）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, episodeId, version]);

    // Persist on value change
    useEffect(() => {
        if (skipNextSaveRef.current) {
            skipNextSaveRef.current = false;
            return;
        }
        const storage = storageRef.current;
        if (!storage) return;
        try {
            const key = buildStorageKey(page, episodeId, version);
            storage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.warn(`[usePersistedPageState] save failed for ${page}:`, err);
        }
    }, [page, episodeId, version, value]);

    const clear = useCallback(() => {
        const storage = storageRef.current;
        if (storage) {
            try {
                const key = buildStorageKey(page, episodeId, version);
                storage.removeItem(key);
            } catch (err) {
                console.warn(`[usePersistedPageState] clear failed for ${page}:`, err);
            }
        }
        // clear 后 setValue(default) 触发的 save 要跳过 — 否则又把 default 写回 storage
        skipNextSaveRef.current = true;
        setValue(defaultValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, episodeId, version]);

    return [value, setValue, clear];
}
