/**
 * 单镜时长的硬边界。
 * 上限 8s 不是审美偏好：两级生成里一个镜头就是一次视频调用，模型单次上限就是 8 秒，
 * 填 12s 不会得到 12s 的片子，只会在生成时被截断或降质。下限 2s 是为了避免短到装不下
 * 一句台词的碎镜。
 *
 * 【为什么单独一个文件】这三个常量既要被 storyboard-patch.ts 的 zod 契约消费（服务端校验），
 * 又要被 api.ts、拆镜提示词、镜头检查器、镜头表消费。api.ts 依赖 storyboard-patch.ts，
 * 所以常量不能住在 api.ts——否则 storyboard-patch.ts 引它就成了循环依赖。
 */
export const SHOT_DURATION_MIN_MS = 2000;
export const SHOT_DURATION_MAX_MS = 8000;
/** 拆镜提示词与各处默认值统一用的推荐时长（落在 MIN~MAX 中段） */
export const SHOT_DURATION_PREFERRED_MS = 4000;
