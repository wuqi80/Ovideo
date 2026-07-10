import { isDashScopeVideoModel, type VideoModel } from '../services/videoModelService';

/**
 * 2026-05-25 四次收紧 — 左右卡片像素级对齐策略
 *
 * 问题：固定 480px 卡里 Seedance / DashScope 参数面板还是要内部滚（"滑块"），
 *       用户明确"所有参数都要显示，不要滚动条"。
 *
 * 策略：
 *   1. 固定外框高度 h-[Npx]（不用 h-auto）— 左/右同一 group 必须调同一函数
 *   2. 统一 flex 骨架：header(shrink-0) + media(shrink-0 h-28) + body(flex-1 min-h-0)
 *   3. body 在卡片足够高时不出现 overflow；textarea 在 body 内填满
 *
 * 高度档（2026-05-25 第 4 次调整，Seedance/DashScope 分档拉满）：
 *   - placeholder 空镜：280px
 *   - 普通 I2V：380px
 *   - DashScope 三家（Kling 3-mode / Vidu / HappyHorse）：580px
 *   - Seedance 多模态控制台（3 媒体框 + 6 参数 + 警告）：680px
 */

/** 空镜 / placeholder 卡（无图） */
export const PLACEHOLDER_CARD_HEIGHT_CLASS = 'h-[280px] flex flex-col overflow-hidden';
/** 普通 I2V / Morph（Wan2、Sora2、大能…） */
export const COMPACT_CARD_HEIGHT_CLASS = 'h-[380px] flex flex-col overflow-hidden';
/** DashScope 三家：Kling / Vidu / HappyHorse */
export const DASHSCOPE_CARD_HEIGHT_CLASS = 'h-[580px] flex flex-col overflow-hidden';
/** Seedance 多模态控制台（3 媒体框 + 全部参数自适应展示） */
export const SEEDANCE_CARD_HEIGHT_CLASS = 'h-[680px] flex flex-col overflow-hidden';
/** @deprecated 旧别名，留给 tests 兼容；新代码用 DASHSCOPE_/SEEDANCE_ 二档 */
export const PARAMETRIC_CARD_HEIGHT_CLASS = DASHSCOPE_CARD_HEIGHT_CLASS;

/** 左图预览 / 右侧 idle 原图 / 单视频预览 — 统一 112px */
export const CARD_MEDIA_HEIGHT_CLASS = 'h-28 shrink-0';
/** 右侧结果预览：比左侧输入图更高，便于检查成片画面 */
export const RESULT_MEDIA_HEIGHT_CLASS = 'h-36 shrink-0';
/** Seedance 右侧结果预览：多模态视频卡信息更长，预览区适当再放大 */
export const SEEDANCE_RESULT_MEDIA_HEIGHT_CLASS = 'h-44 shrink-0';

/** 卡片主体（prompt / Seedance / DashScope 参数）— 占满剩余高度并内部滚 */
export const CARD_BODY_SCROLL_CLASS = 'flex-1 min-h-0 overflow-y-auto mt-2 pr-0.5';

/** 普通 I2V textarea：填满 body 区域，长文内部滚 */
export const SIMPLE_PROMPT_TEXTAREA_CLASS =
    'w-full h-full min-h-[72px] overflow-y-auto bg-black/30 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none resize-none';

/** 空镜 textarea 容器内样式 */
export const PLACEHOLDER_PROMPT_TEXTAREA_CLASS =
    'w-full h-full min-h-[56px] overflow-y-auto bg-black/30 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none resize-none';

/** 右侧只读 prompt 展示 */
export const RESULT_PROMPT_READONLY_CLASS =
    'w-full max-h-[220px] overflow-y-auto bg-n0 border border-n40 rounded px-3 py-2 text-[12px] leading-5 text-n700 border-l-2 border-l-primary/40 whitespace-pre-wrap break-words';

export function isSeedanceModel(model: VideoModel): boolean {
    return model === 'Seedance2' || model === 'Seedance2Fast';
}

/**
 * 返回卡片外层 className。左 storyboard 卡与右 result 卡必须传入相同 model + isPlaceholder。
 */
export function getCardHeightClass(model: VideoModel, isPlaceholder = false): string {
    if (isPlaceholder) return PLACEHOLDER_CARD_HEIGHT_CLASS;
    if (isSeedanceModel(model)) return SEEDANCE_CARD_HEIGHT_CLASS;
    if (isDashScopeVideoModel(model)) return DASHSCOPE_CARD_HEIGHT_CLASS;
    return COMPACT_CARD_HEIGHT_CLASS;
}

/** @deprecated 用 CARD_MEDIA_HEIGHT_CLASS；保留兼容旧调用 */
export function getPreviewImageHeightClass(model: VideoModel, isPair: boolean): string {
    return isPair ? 'h-24 shrink-0' : CARD_MEDIA_HEIGHT_CLASS;
}

/** 结果卡 idle/loading 视觉区 — 与左图预览同高 */
export function getResultVisualHeightClass(model: VideoModel): string {
    return isSeedanceModel(model) ? SEEDANCE_RESULT_MEDIA_HEIGHT_CLASS : RESULT_MEDIA_HEIGHT_CLASS;
}
