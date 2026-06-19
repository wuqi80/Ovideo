/**
 * Gemini 服务 - 通过后端代理
 * 后端统一管理API Key，前端无需配置
 */

import { apiJson } from './httpClient';

interface GeminiTextResponse {
  content?: string;
}

/**
 * 通过后端代理调用Gemini文本生成
 */
export const callGeminiProxy = async (
  prompt: string,
  systemPrompt?: string,
  model?: string
): Promise<string> => {
  try {
    console.log('📤 发送请求到后端Gemini代理');

    const body: Record<string, unknown> = {
      prompt,
      system_prompt: systemPrompt,
      temperature: 0.7
    };
    if (model?.trim()) {
      body.model = model.trim();
    }

    const data = await apiJson<GeminiTextResponse>('/api/gemini/text', {
      method: 'POST',
      body: JSON.stringify(body)
    }, 'Gemini 文本代理');

    const content = data.content;
    
    if (!content) {
      console.error('❌ 返回内容为空');
      throw new Error('Gemini返回内容为空');
    }

    console.log('✅ 成功获取内容，长度:', content.length);
    return content;
  } catch (error) {
    console.error('❌ Gemini API调用失败:', error);
    throw error;
  }
};

/**
 * 带重试的Gemini中转站调用
 */
export const callGeminiProxyWithRetry = async (
  prompt: string,
  systemPrompt?: string,
  maxRetries: number = 3,
  model?: string
): Promise<string> => {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await callGeminiProxy(prompt, systemPrompt, model);
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ Gemini中转站调用失败（第${i + 1}次），重试中...`);
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
      }
    }
  }
  
  throw lastError || new Error('Gemini中转站调用失败');
};

