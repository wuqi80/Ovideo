// new_html/utils/durationMapping.ts
// Pure helpers for video card duration. No React, no I/O.

export const DURATION_MIN_SEC = 3;
export const DURATION_MAX_SEC = 15;
export const DURATION_DEFAULT_SEC = 5;
export const SEEDANCE_AGENT_PLAN_MAX_DURATION_SEC = 12;

function normalizeMaxSec(maxSec: number = DURATION_MAX_SEC): number {
    const n = Number(maxSec);
    if (!Number.isFinite(n)) return DURATION_MAX_SEC;
    return Math.max(DURATION_MIN_SEC, Math.round(n));
}

function clampFiniteSec(value: number, maxSec: number): number {
    const rounded = Math.round(value);
    if (rounded < DURATION_MIN_SEC) return DURATION_MIN_SEC;
    if (rounded > maxSec) return maxSec;
    return rounded;
}

export function clampSec(
    value: unknown,
    fallback: number = DURATION_DEFAULT_SEC,
    maxSec: number = DURATION_MAX_SEC,
): number {
    const max = normalizeMaxSec(maxSec);
    const n = Number(value);
    if (!Number.isFinite(n)) return clampFiniteSec(Number(fallback), max);
    return clampFiniteSec(n, max);
}

export interface DurationInputs {
    audioDurationMs?: number;
    plannedDurationMs?: number;
}

export function computeReactiveDuration(
    inputs: DurationInputs,
    maxSec: number = DURATION_MAX_SEC,
): number {
    const { audioDurationMs, plannedDurationMs } = inputs;
    if (audioDurationMs && audioDurationMs > 0) {
        return clampSec(audioDurationMs / 1000, DURATION_DEFAULT_SEC, maxSec);
    }
    if (plannedDurationMs && plannedDurationMs > 0) {
        return clampSec(plannedDurationMs / 1000, DURATION_DEFAULT_SEC, maxSec);
    }
    return clampSec(DURATION_DEFAULT_SEC, DURATION_DEFAULT_SEC, maxSec);
}

// 2026-05-20 (Bug 3): 估算 planned_duration_ms。
//
// 解析顺序：
//   1) parseDurationString(durationStr)  — 支持「2秒/3.5秒/2分/4s/4」等格式
//   2) 若 1 失败、且有 dialogueText：按中文 4 字/秒 估算（区间 2-8s）
//   3) 兜底 2000ms
//
// 用于：
//   - WorkspaceApp.export-script: 生成 storyboard_items.planned_duration_ms 时
//     代替原来直接返回 null 的 parseDurationToMs；
//   - VideoGenPage.handleImportAll: 对 DB 里 planned_duration_ms 为 NULL 的旧
//     分镜，前端补齐后 apiUpdateStoryboardItem 写回（旧数据迁移）。
//
// 设计：返回数字（不是 null），让上游不再需要单独 fallback。
export const ESTIMATE_DURATION_FALLBACK_MS = 2000;
export const ESTIMATE_DURATION_MIN_MS = 2000;
export const ESTIMATE_DURATION_MAX_MS = 8000;
export const ESTIMATE_CHARS_PER_SECOND = 4; // 中文阅读速度

export function parseDurationString(raw: string | undefined | null): number | null {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    let totalMs = 0;
    const minMatch = s.match(/([\d.]+)\s*分/);
    if (minMatch) totalMs += parseFloat(minMatch[1]) * 60 * 1000;
    const secMatch = s.match(/([\d.]+)\s*秒/);
    if (secMatch) totalMs += parseFloat(secMatch[1]) * 1000;
    if (totalMs === 0) {
        const sMatch = s.match(/([\d.]+)\s*s\b/i);
        if (sMatch) totalMs = parseFloat(sMatch[1]) * 1000;
    }
    if (totalMs === 0) {
        const numMatch = s.match(/([\d.]+)/);
        if (numMatch) totalMs = parseFloat(numMatch[1]) * 1000;
    }
    return totalMs > 0 ? Math.round(totalMs) : null;
}

export function estimateDurationFromText(text: string | undefined | null): number {
    const len = (text || '').replace(/\s/g, '').length;
    if (len === 0) return ESTIMATE_DURATION_FALLBACK_MS;
    const ms = Math.round((len / ESTIMATE_CHARS_PER_SECOND) * 1000);
    return Math.max(ESTIMATE_DURATION_MIN_MS, Math.min(ESTIMATE_DURATION_MAX_MS, ms));
}

export interface EstimateDurationInputs {
    durationStr?: string;
    dialogueText?: string;
}

/** 估算 planned_duration_ms。永远返回正整数（≥ 2000ms）。 */
export function estimateDurationMs(inputs: EstimateDurationInputs): number {
    const parsed = parseDurationString(inputs.durationStr);
    if (parsed != null) return Math.max(ESTIMATE_DURATION_MIN_MS, parsed);
    const estimated = estimateDurationFromText(inputs.dialogueText || '');
    return estimated;
}
