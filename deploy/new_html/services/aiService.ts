/**
 * 通用AI服务层
 * 
 * 这个文件提供统一的AI调用接口，接受提示词作为参数
 * 不再硬编码提示词，而是从 prompts/ 配置中读取
 */

import { AiModel } from '../types';
import { callGeminiProxyWithRetry } from './geminiProxyService';
import { callDeepseekWithRetry, callDeepseekChatWithRetry } from './deepseekService';
import { PromptTemplate, fillPrompt } from '../prompts';

/**
 * 通用AI调用（文本生成）
 * 
 * @param model AI模型选择
 * @param promptTemplate 提示词模板
 * @param variables 变量替换对象
 * @param onStream 流式输出回调（可选）
 * @returns 生成的文本
 */
export async function callAI(
  model: AiModel,
  promptTemplate: PromptTemplate,
  variables: Record<string, string> = {},
  onStream?: (chunk: string) => void
): Promise<string> {
  // 替换提示词中的占位符
  const userPrompt = fillPrompt(promptTemplate.user, variables);
  const systemPrompt = promptTemplate.system;

  // 根据模型选择对应的服务
  if (model === AiModel.Deepseek) {
    return await callDeepseekWithRetry(userPrompt, systemPrompt, onStream);
  } else if (model === AiModel.DeepseekChat) {
    return await callDeepseekChatWithRetry(userPrompt, systemPrompt, onStream);
  } else {
    return await callGeminiProxyWithRetry(userPrompt, systemPrompt);
  }
}

/**
 * 通用AI调用（JSON生成）
 * 
 * @param model AI模型选择
 * @param promptTemplate 提示词模板
 * @param variables 变量替换对象
 * @returns 解析后的JSON对象
 */
export async function callAIForJSON<T = any>(
  model: AiModel,
  promptTemplate: PromptTemplate,
  variables: Record<string, string> = {}
): Promise<T> {
  const response = await callAI(model, promptTemplate, variables);
  
  // 清理可能的markdown代码块标记
  const cleanResponse = response
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  
  // 尝试提取JSON（支持多种格式）
  let jsonStr = cleanResponse;
  
  // 如果响应中包含JSON对象
  const objectMatch = cleanResponse.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }
  
  // 如果响应中包含JSON数组
  const arrayMatch = cleanResponse.match(/\[[\s\S]*\]/);
  if (arrayMatch && !objectMatch) {
    jsonStr = arrayMatch[0];
  }
  
  try {
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('❌ JSON解析失败，原始响应:', cleanResponse);
    throw new Error(`JSON解析失败: ${(error as Error).message}`);
  }
}

/**
 * 通用AI调用（带重试，文本生成）
 * 
 * @param model AI模型选择
 * @param promptTemplate 提示词模板
 * @param variables 变量替换对象
 * @param maxRetries 最大重试次数
 * @param onStream 流式输出回调（可选）
 * @returns 生成的文本
 */
export async function callAIWithRetry(
  model: AiModel,
  promptTemplate: PromptTemplate,
  variables: Record<string, string> = {},
  maxRetries: number = 3,
  onStream?: (chunk: string) => void
): Promise<string> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await callAI(model, promptTemplate, variables, onStream);
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ AI调用失败（第${i + 1}次），重试中...`);
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
      }
    }
  }
  
  throw lastError || new Error('AI调用失败');
}

/**
 * 批量AI调用（并发）
 * 
 * @param model AI模型选择
 * @param tasks 任务数组，每个任务包含promptTemplate和variables
 * @param concurrency 并发数（默认3）
 * @returns 结果数组
 */
export async function batchCallAI<T = any>(
  model: AiModel,
  tasks: Array<{ promptTemplate: PromptTemplate; variables: Record<string, string> }>,
  concurrency: number = 3
): Promise<T[]> {
  const results: T[] = [];
  const queue = [...tasks];
  
  // 并发执行
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      
      try {
        const result = await callAIForJSON<T>(model, task.promptTemplate, task.variables);
        results.push(result);
      } catch (error) {
        console.error('❌ 批量任务失败:', error);
        results.push(null as any);
      }
    }
  });
  
  await Promise.all(workers);
  return results;
}

