/**
 * 提示词配置中心 - 统一导出
 * 
 * 使用说明：
 * 1. 所有AI提示词都在这里集中管理
 * 2. 修改提示词只需要编辑对应的配置文件
 * 3. 可以通过参数覆盖默认提示词
 * 
 * 示例：
 * ```typescript
 * import { SCRIPT_PROMPTS } from './prompts';
 * 
 * // 使用默认提示词
 * const prompt = SCRIPT_PROMPTS.REWRITE_NOVEL_TO_SCRIPT;
 * 
 * // 替换占位符
 * const userPrompt = prompt.user.replace('{novelText}', myNovelText);
 * 
 * // 调用AI服务
 * await callAI(userPrompt, prompt.system);
 * ```
 */

// 剧本相关提示词
export * from './scriptPrompts';

// 分镜相关提示词
export * from './storyboardPrompts';

// 图像生成相关提示词
export * from './imagePrompts';

// 三步生成链路提示词（2026-05-29）
export * from './scriptPipelinePrompts';

/**
 * 提示词工具函数
 */

/**
 * 替换提示词中的占位符
 * @param template 提示词模板
 * @param variables 变量对象 {key: value}
 * @returns 替换后的提示词
 */
export function fillPrompt(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * 组合多个提示词片段
 * @param parts 提示词片段数组
 * @param separator 分隔符（默认为双换行）
 * @returns 组合后的提示词
 */
export function combinePrompts(parts: string[], separator: string = '\n\n'): string {
  return parts.filter(Boolean).join(separator);
}

/**
 * 添加提示词后缀
 * @param base 基础提示词
 * @param suffix 后缀
 * @param separator 分隔符
 * @returns 组合后的提示词
 */
export function addSuffix(base: string, suffix: string, separator: string = ', '): string {
  return `${base}${separator}${suffix}`;
}

