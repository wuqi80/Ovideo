/**
 * 画幅与图像生成尺寸的唯一真相。
 *
 * 【为什么单独收在这里】这张表原本在 apps/web 里抄了两份（分镜页、设计页），
 * 服务端一份都没有——于是"画幅"这件事只活在前端：任何不经前端的生成路径
 * （自动收敛 agent 就是其一）压根不知道项目是横是竖，只能落到适配器里那个
 * 写死的竖屏兜底。16:9 的项目会收敛出一堆竖图，还会被自动设为选定，
 * 视频跟随首帧，整条片子从那一镜起变竖屏。
 *
 * 约束只写在一侧就是这么出事的——两侧各自都对，说谎的是接缝。
 */

export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * 2K 档：满足 Seedream 4.5/5.0 的最小像素要求（≥368.6 万像素），
 * 4.0 兼容且按张计费不加价，所以统一走这一档，不为省钱降档。
 */
export const RATIO_TO_SIZE: Record<AspectRatio, string> = {
  '9:16': '1440x2560',
  '16:9': '2560x1440',
  '1:1': '2048x2048',
  '3:4': '1728x2304',
  '4:3': '2304x1728',
};

/** 项目没设画幅时的兜底。竖屏是漫剧的常见形态，但这只是默认值，不是假设 */
export const DEFAULT_ASPECT_RATIO: AspectRatio = '9:16';

export function isAspectRatio(v: unknown): v is AspectRatio {
  return typeof v === 'string' && (ASPECT_RATIOS as readonly string[]).includes(v);
}

/** 画幅 → 生成尺寸。传入非法值时退回默认画幅，而不是抛错——生成路径不该因为一个脏值中断 */
export function sizeForRatio(ratio: string | null | undefined): string {
  return RATIO_TO_SIZE[isAspectRatio(ratio) ? ratio : DEFAULT_ASPECT_RATIO];
}
