/**
 * Gemini 中转站文本服务
 * 使用老张API中转访问Gemini 2.5，处理剧本分镜相关的文本任务
 */

import { callGeminiProxyWithRetry } from './geminiProxyService';
import type { GeminiResponse } from '../types';

/**
 * 改写小说为剧本
 */
export const rewriteNovelToScript = async (novelText: string): Promise<GeminiResponse<string>> => {
    console.log('📝 开始改写小说为剧本，输入长度:', novelText.length);
    
    const systemPrompt = `你是一位专业的编剧，擅长将小说文本改编为剧本格式。请保持故事核心内容，但将叙述性文字转化为对话和场景描述。`;
    
    const prompt = `请将以下小说文本改写为剧本格式：

${novelText}

要求：
1. 保持原有故事情节和人物性格
2. 将叙述转化为对话和动作描述
3. 添加必要的场景说明
4. 使用标准剧本格式

请直接输出改写后的剧本，不要添加额外说明。`;

    try {
        const content = await callGeminiProxyWithRetry(prompt, systemPrompt);
        console.log('✅ 改写成功，输出长度:', content?.length || 0);
        
        if (!content || content.trim().length === 0) {
            console.error('❌ 改写结果为空');
            return { data: null, error: '改写结果为空，请检查API配置' };
        }
        
        return { data: content };
    } catch (error) {
        console.error('❌ 改写失败:', error);
        return { data: null, error: (error as Error).message };
    }
};

/**
 * 生成分镜
 */
export const generateStoryboards = async (scriptContent: string): Promise<GeminiResponse<any>> => {
    console.log('🎬 开始生成分镜，剧本长度:', scriptContent.length);
    
    const systemPrompt = `你是一位专业的分镜师，擅长将剧本拆解为具体的分镜。每个分镜应包含：画面提示词、视频提示词、台词、角色、场景。`;
    
    const prompt = `请将以下剧本拆解为分镜：

${scriptContent}

返回JSON数组格式，每个分镜包含：
- imagePrompt: 画面描述（英文，详细描述构图、光线、氛围）
- videoPrompt: 动作描述（英文，描述运镜和动态）
- dialogue: 台词（中文）
- characters: 角色列表（数组）
- scene: 场景名称（中文）

示例格式：
[
  {
    "imagePrompt": "A young woman sitting by the window, soft morning light, melancholic atmosphere",
    "videoPrompt": "Camera slowly zooms in, wind gently blowing the curtains",
    "dialogue": "又是一个孤独的早晨...",
    "characters": ["李娜"],
    "scene": "卧室"
  }
]

请只返回JSON数组，不要添加任何其他文字。`;

    try {
        const content = await callGeminiProxyWithRetry(prompt, systemPrompt);
        console.log('📥 收到分镜响应，长度:', content?.length || 0);
        
        if (!content || content.trim().length === 0) {
            console.error('❌ 分镜响应为空');
            return { data: null, error: '分镜响应为空，请检查API配置' };
        }
        
        // 尝试解析JSON
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            console.log('✅ 找到JSON数组，开始解析');
            const storyboards = JSON.parse(jsonMatch[0]);
            console.log('✅ 生成分镜成功，数量:', storyboards.length);
            return { data: storyboards };
        }
        
        console.error('❌ 无法从响应中提取JSON数组，响应内容:', content.substring(0, 200));
        return { data: null, error: '无法解析分镜JSON，响应格式不正确' };
    } catch (error) {
        console.error('❌ 生成分镜失败:', error);
        return { data: null, error: (error as Error).message };
    }
};

/**
 * 提取剧本元数据（角色、场景）
 */
export const extractScriptMetadata = async (scriptContent: string): Promise<GeminiResponse<any>> => {
    const systemPrompt = `你是一个文本分析专家，擅长从剧本中提取关键信息。`;
    
    const prompt = `请分析以下剧本，提取所有角色和场景：

${scriptContent}

返回JSON格式：
{
  "characters": ["角色1", "角色2"],
  "scenes": ["场景1", "场景2"]
}

只返回JSON，不要其他文字。`;

    try {
        const content = await callGeminiProxyWithRetry(prompt, systemPrompt);
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const metadata = JSON.parse(jsonMatch[0]);
            return { data: metadata };
        }
        return { data: null, error: '无法解析元数据JSON' };
    } catch (error) {
        return { data: null, error: (error as Error).message };
    }
};

/**
 * 润色剧本片段
 */
export const refineScriptSegment = async (
    selection: string,
    instruction: string,
    context: string
): Promise<GeminiResponse<string>> => {
    const systemPrompt = `你是一位专业编剧，擅长优化和润色剧本内容。`;
    
    const prompt = `上下文：
${context}

选中片段：
${selection}

用户指令：
${instruction}

请根据用户指令润色选中的片段，保持与上下文的连贯性。只返回润色后的文本，不要添加说明。`;

    try {
        const content = await callGeminiProxyWithRetry(prompt, systemPrompt);
        return { data: content };
    } catch (error) {
        return { data: null, error: (error as Error).message };
    }
};

/**
 * 重构分镜（拆分/合并）
 */
export const restructureShot = async (
    selection: string,
    instruction: string,
    type: 'split' | 'merge'
): Promise<GeminiResponse<any>> => {
    const systemPrompt = `你是一位专业的分镜师，擅长调整分镜结构。`;
    
    const typeText = type === 'split' ? '拆分' : '合并';
    const prompt = `请${typeText}以下分镜片段：

${selection}

用户指令：
${instruction}

返回JSON格式（数组）：
[
  {
    "newScriptSegment": "新的剧本文字",
    "newStoryboardItems": [
      {
        "imagePrompt": "画面描述",
        "videoPrompt": "动作描述",
        "dialogue": "台词",
        "characters": ["角色"],
        "scene": "场景"
      }
    ]
  }
]

只返回JSON数组，不要其他文字。`;

    try {
        const content = await callGeminiProxyWithRetry(prompt, systemPrompt);
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            return { data: result };
        }
        return { data: null, error: '无法解析重构结果' };
    } catch (error) {
        return { data: null, error: (error as Error).message };
    }
};

/**
 * 重新生成单个分镜
 */
export const regenerateSingleShot = async (
    selection: string,
    instruction?: string
): Promise<GeminiResponse<any>> => {
    const systemPrompt = `你是一位专业的分镜师。`;
    
    const prompt = `请为以下剧本片段重新生成分镜：

${selection}

${instruction ? `用户指令：${instruction}` : ''}

返回JSON格式：
{
  "imagePrompt": "画面描述（英文）",
  "videoPrompt": "动作描述（英文）",
  "dialogue": "台词（中文）",
  "characters": ["角色"],
  "scene": "场景"
}

只返回JSON，不要其他文字。`;

    try {
        const content = await callGeminiProxyWithRetry(prompt, systemPrompt);
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const shot = JSON.parse(jsonMatch[0]);
            return { data: shot };
        }
        return { data: null, error: '无法解析分镜JSON' };
    } catch (error) {
        return { data: null, error: (error as Error).message };
    }
};

/**
 * 🆕 从剧本中提取分镜和场景描述（返回JSON）
 * 🔧 新方案：按镜头分割，只让模型输出 scriptSegment，大大减少输出长度
 */
export const extractShotsFromScript = async (scriptText: string): Promise<{items: Array<{originalText: string; scriptSegment: string}>}> => {
    console.log(`📏 [Gemini] 开始处理剧本，长度: ${scriptText.length}字符`);
    
    // 🆕 第一步：按镜头编号分割剧本
    const shots = splitScriptByShots(scriptText);
    console.log(`📦 [Gemini] 剧本分割完成，共 ${shots.length} 个镜头`);
    
    // 🆕 第二步：逐个镜头处理，只让模型输出 scriptSegment
    const allItems: Array<{originalText: string; scriptSegment: string}> = [];
    
    for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        console.log(`🎬 [Gemini] 处理镜头 ${i + 1}/${shots.length} (${shot.shotNumber})，长度: ${shot.originalText.length}字符`);
        
        try {
            // 只让模型输出 scriptSegment
            const scriptSegment = await generateScriptSegmentGemini(shot.originalText);
            
            allItems.push({
                originalText: shot.originalText,
                scriptSegment: scriptSegment
            });
            
            console.log(`✅ [Gemini] 镜头 ${shot.shotNumber} 完成，scriptSegment: ${scriptSegment.substring(0, 50)}...`);
        } catch (error) {
            console.error(`❌ [Gemini] 镜头 ${shot.shotNumber} 处理失败:`, error);
            throw error;
        }
    }
    
    console.log(`🎉 [Gemini] 全部完成，共 ${allItems.length} 个镜头`);
    return { items: allItems };
};

/**
 * 按镜头编号分割剧本
 * 🔧 支持多种镜头编号格式：
 *   - "001 【..." / "001\t【..." (三位数+空格/tab+方括号)
 *   - "镜头28 (" / "镜头28（" (镜头+数字+括号)
 *   - "镜头29 (" / "镜头30（"
 */
function splitScriptByShots(scriptText: string): Array<{shotNumber: string; originalText: string}> {
    const lines = scriptText.split('\n');
    const shots: Array<{shotNumber: string; originalText: string}> = [];
    let currentShot = '';
    let currentShotNumber = '';
    let hasStarted = false;
    
    // 🔧 支持多种镜头编号格式的正则
    const shotPatterns = [
        /^(\d{3})\s*[\t\【\(（]/,           // 001 【... 或 001（...
        /^镜头\s*(\d+)\s*[\(（\【\|｜]/,    // 镜头28 ( 或 镜头28（ 或 镜头28 |
        /^镜头(\d+)\s*[\(（\【\|｜]/,       // 镜头28( 无空格
        /^[Ss]hot\s*(\d+)\s*[\(\[]/i,        // Shot 28 ( 英文格式
    ];
    
    const matchShotNumber = (line: string): string | null => {
        for (const pattern of shotPatterns) {
            const match = line.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
    };
    
    for (const line of lines) {
        const shotNumber = matchShotNumber(line);
        
        if (shotNumber) {
            hasStarted = true;
            
            // 遇到新镜头，保存上一个镜头
            if (currentShot) {
                shots.push({
                    shotNumber: currentShotNumber,
                    originalText: currentShot.trim()
                });
            }
            // 开始新镜头
            currentShotNumber = shotNumber;
            currentShot = line;
        } else if (hasStarted) {
            // 只有在已经开始记录镜头后，才累积内容
            currentShot += '\n' + line;
        }
    }
    
    // 保存最后一个镜头
    if (currentShot) {
        shots.push({
            shotNumber: currentShotNumber,
            originalText: currentShot.trim()
        });
    }
    
    console.log(`📋 [Gemini] 分割完成，共 ${shots.length} 个镜头`);
    return shots;
}

/**
 * 为单个镜头生成 scriptSegment（只输出描述，不输出原文）
 */
async function generateScriptSegmentGemini(originalText: string): Promise<string> {
    const prompt = `你是专业的分镜师。请为以下镜头生成一个精炼的场景描述。

**要求：**
- 只输出场景描述文本，不要JSON格式
- 控制在40字以内
- 只包含最核心的视觉信息：镜头类型、主要动作、氛围
- 去除对话、音效、时长等信息
- 例如："大广角俯视，林临渊黑袍走入藏书阁，光柱中尘埃浮动，肃穆压抑。"

**镜头原文：**
${originalText}

**请直接输出场景描述（40字以内，纯文本，无需JSON）：**`;

    const response = await callGeminiProxyWithRetry(prompt);
    return response.trim();
}

/**
 * 🆕 为单个分镜生成详细信息
 */
export const generateShotDetails = async (
    originalText: string,
    scriptSegment: string,
    userRequirements?: string
): Promise<{
    imagePrompt: string;
    videoPrompt: string;
    dialogue: string;
    characters: string[];
    scene: string;
}> => {
    const prompt = `你是专业的镜头设计师。请为以下场景生成详细的镜头设计信息。

**场景信息：**
原文段落：
${originalText}

场景描述：
${scriptSegment}

${userRequirements ? `**用户整体要求：**\n${userRequirements}\n` : ''}

**请返回JSON格式：**
{
  "imagePrompt": "中文图像生成提示词，描述画面构图、光影效果、角色状态、视觉风格",
  "videoPrompt": "中文视频提示词，描述镜头运动（推拉摇移跟）、画面节奏、转场方式",
  "dialogue": "人物台词（直接从原文提取）",
  "characters": ["角色1", "角色2"],
  "scene": "场景位置"
}`;

    const response = await callGeminiProxyWithRetry(prompt);
    
    // 清理可能的markdown代码块标记
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanResponse);
};

