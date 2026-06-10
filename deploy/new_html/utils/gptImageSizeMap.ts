/**
 * GPT Image 2 系列尺寸推荐表
 * 
 * 设计目的：
 * - GPT Image 2 (vip / official) 的 OpenAI Images API 接受 `size` 字符串（如 "1024x1024"）
 *   或 `"auto"` 让上游自选。
 * - 为了让用户体验和化神(Gemini Flash)一致——只挑「比例」+「分辨率档位 K」，
 *   推荐尺寸由 service 自动算出，避免用户面对 30+ 个像素值。
 * 
 * 表来源：根据 GPT Image 2 / DALL·E 3 通行的尺寸约束 + 1K/2K/4K 档位换算：
 *   1K 基线像素 ≈ 1 megapixel；2K ≈ 4 megapixel；4K ≈ 16 megapixel。
 *   每个 (ratio, K) 组合就近取上游支持的稳定尺寸。
 * 
 * 注意：
 * - 上游若拒绝某些 4K 组合，会 fallback；前端总能用 "auto" 兜底。
 * - 化神(Gemini Flash)走自己的 aspectRatio+imageSize（"1K"/"2K"/"4K" 字面量）路径，
 *   不经此映射。
 */

export type GptImageRatio =
  | '1:1'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16'
  | '3:2'
  | '2:3'
  | '21:9'
  | '5:4'
  | '4:5'
  | 'auto';

export type GptImageK = '1K' | '2K' | '4K' | 'auto';

/**
 * (ratio, K) → "WxH" 像素映射。
 * "auto" 任一维即返回 "auto"。
 */
const SIZE_TABLE: Record<Exclude<GptImageRatio, 'auto'>, Record<Exclude<GptImageK, 'auto'>, string>> = {
  '1:1':  { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
  '4:3':  { '1K': '1152x896',  '2K': '2304x1792', '4K': '4608x3584' },
  '3:4':  { '1K': '896x1152',  '2K': '1792x2304', '4K': '3584x4608' },
  '16:9': { '1K': '1344x768',  '2K': '2688x1536', '4K': '5376x3072' },
  '9:16': { '1K': '768x1344',  '2K': '1536x2688', '4K': '3072x5376' },
  '3:2':  { '1K': '1216x832',  '2K': '2432x1664', '4K': '4864x3328' },
  '2:3':  { '1K': '832x1216',  '2K': '1664x2432', '4K': '3328x4864' },
  '21:9': { '1K': '1536x640',  '2K': '3072x1280', '4K': '6144x2560' },
  '5:4':  { '1K': '1152x896',  '2K': '2304x1792', '4K': '4608x3584' },
  '4:5':  { '1K': '896x1152',  '2K': '1792x2304', '4K': '3584x4608' },
};

/**
 * 给定比例 + K 档位，推荐 GPT Image API 的 size 字符串。
 * 任意一项为 "auto" → 返回 "auto"（让上游自选）。
 */
export function recommendGptImageSize(ratio: GptImageRatio, k: GptImageK): string {
  if (ratio === 'auto' || k === 'auto') return 'auto';
  const row = SIZE_TABLE[ratio];
  if (!row) return 'auto';
  return row[k] ?? 'auto';
}

export const GPT_IMAGE_RATIO_OPTIONS: { value: GptImageRatio; label: string }[] = [
  { value: 'auto',  label: '自动' },
  { value: '1:1',   label: '1:1 方形' },
  { value: '16:9',  label: '16:9 横屏' },
  { value: '9:16',  label: '9:16 竖屏' },
  { value: '4:3',   label: '4:3 横屏' },
  { value: '3:4',   label: '3:4 竖屏' },
  { value: '3:2',   label: '3:2 横屏' },
  { value: '2:3',   label: '2:3 竖屏' },
  { value: '21:9',  label: '21:9 超宽' },
  { value: '5:4',   label: '5:4' },
  { value: '4:5',   label: '4:5' },
];

export const GPT_IMAGE_K_OPTIONS: { value: GptImageK; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: '1K',   label: '1K (标准)' },
  { value: '2K',   label: '2K (高清)' },
  { value: '4K',   label: '4K (超清)' },
];

export const GPT_IMAGE_QUALITY_OPTIONS: { value: 'auto' | 'low' | 'medium' | 'high'; label: string }[] = [
  { value: 'auto',   label: '自动' },
  { value: 'high',   label: '高质量 (慢)' },
  { value: 'medium', label: '中质量' },
  { value: 'low',    label: '低质量 (快)' },
];

/**
 * 化神(Gemini Flash nano2)走 aspectRatio + imageSize="1K"/"2K"/"4K" 字面量路径，
 * 不需要经过 SIZE_TABLE 转换。这里集中导出供 GenerationPage 复用同一份选项数组。
 */
export const GEMINI_NANO2_RATIO_OPTIONS: { value: string; label: string }[] = [
  { value: '1:1',  label: '1:1 方形' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '4:3',  label: '4:3 横屏' },
  { value: '3:4',  label: '3:4 竖屏' },
  { value: '3:2',  label: '3:2 横屏' },
  { value: '2:3',  label: '2:3 竖屏' },
  { value: '21:9', label: '21:9 超宽' },
];

export const GEMINI_NANO2_SIZE_OPTIONS: { value: '1K' | '2K' | '4K'; label: string }[] = [
  { value: '1K', label: '1K (标准)' },
  { value: '2K', label: '2K (高清)' },
  { value: '4K', label: '4K (超清)' },
];
