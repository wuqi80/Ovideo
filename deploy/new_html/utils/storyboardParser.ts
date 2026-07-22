/**
 * 🆕 分镜脚本解析器
 * 
 * 解析 ---CUT--- 分隔的镜头块格式，自动提取字段并生成 prompt
 */

import { StoryboardItem } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * 镜头块原始字段
 * 🔧 根据 GENERATE_STORYBOARD_SCRIPT 提示词输出格式（支持新旧字段名）
 */
export interface ShotBlockFields {
  shotId: string;       // 镜头01, 镜头02 等
  segmentNo?: number;   // 分段01；段内镜头允许重新从 01 编号
  时长?: string;
  时间?: string;        // 🆕 新字段名
  取景?: string;
  角度?: string;
  摄像机角度?: string;  // 🆕 新字段名
  运动?: string;
  镜头运动?: string;    // 🆕 新字段名
  机位?: string;
  站位与构图?: string;
  动作与神态?: string;
  氛围与特效?: string;
  人声?: string;        // 🔧 对应 dialogue（人物台词）
  音效?: string;
  转场?: string;
  场景名称?: string;
  人物名称?: string;
  道具名称?: string;
  视觉化描述?: string;
}

/**
 * 解析结果
 */
export interface ParseResult {
  shots: StoryboardItem[];
  displayText: string;        // 用于显示的文本（已移除控制符）
  continueFrom?: string;      // 如果有 <<<CONTINUE_FROM>>> 标记
  rawBlocks: ShotBlockFields[]; // 原始解析的字段
}

export function estimateDialogueDurationSeconds(dialogue: string | undefined): number {
  const raw = String(dialogue || '').trim();
  if (!raw || raw === '无') return 0;

  const quotedSegments = [...raw.matchAll(/[“"]([^”"]+)[”"]/g)].map(match => match[1]);
  const spokenText = (quotedSegments.length > 0 ? quotedSegments.join('') : raw.replace(/^[^：:\n]{1,24}[：:]\s*/, ''))
    .replace(/\s+/g, '');
  const chineseCharacters = (spokenText.match(/[\u3400-\u9fff]/g) || []).length;
  const englishCharacters = (spokenText.match(/[A-Za-z0-9]/g) || []).length;
  if (chineseCharacters === 0 && englishCharacters === 0) return 0;
  return Math.max(1, Math.ceil(chineseCharacters / 4 + englishCharacters / 8));
}

/**
 * 从流式文本中解析镜头块
 * 返回已完成的镜头块和剩余的缓冲区
 */
export function parseStreamingBlocks(buffer: string): {
  completedBlocks: ShotBlockFields[];
  displayText: string;
  remainingBuffer: string;
  continueFrom?: string;
} {
  const completedBlocks: ShotBlockFields[] = [];
  let displayText = '';
  let remainingBuffer = buffer;
  let continueFrom: string | undefined;

  // 检查 CONTINUE_FROM 标记
  const continueMatch = buffer.match(/<<<CONTINUE_FROM\s+(镜头\d+)>>>/);
  if (continueMatch) {
    continueFrom = continueMatch[1];
    // 从显示文本中移除
    remainingBuffer = buffer.replace(/<<<CONTINUE_FROM\s+镜头\d+>>>\s*/, '');
  }

  // 按 ---CUT--- 分割
  const parts = remainingBuffer.split(/---CUT---/);
  let activeSegmentNo: number | undefined;

  const parsePart = (part: string): ShotBlockFields | null => {
    const segmentMatch = part.match(/(?:^|\n)\s*(?:分段|段落)\s*0*(\d+)\s*(?:\n|$)/);
    if (segmentMatch) activeSegmentNo = Number.parseInt(segmentMatch[1], 10);
    const block = parseBlockFields(part.trim());
    if (block && activeSegmentNo) block.segmentNo = activeSegmentNo;
    return block;
  };
  
  // 除了最后一个部分，其他都是完整的镜头块
  for (let i = 0; i < parts.length - 1; i++) {
    const block = parsePart(parts[i]);
    if (block) {
      completedBlocks.push(block);
      // 添加到显示文本（不包含 ---CUT---）
      displayText += parts[i].trim() + '\n\n';
    }
  }

  // 最后一个部分是未完成的缓冲区（除非它也以 ---CUT--- 结尾）
  const lastPart = parts[parts.length - 1];
  if (buffer.endsWith('---CUT---') || buffer.trim().endsWith('---CUT---')) {
    // 最后一个也是完整的
    const block = parsePart(lastPart);
    if (block) {
      completedBlocks.push(block);
      displayText += lastPart.trim() + '\n\n';
    }
    remainingBuffer = '';
  } else {
    remainingBuffer = lastPart;
  }

  return {
    completedBlocks,
    displayText: displayText.trim(),
    remainingBuffer,
    continueFrom
  };
}

/**
 * 解析单个镜头块的字段
 * 🔧 正确处理分组标题（镜头描述：、画面描述：）避免内容混入
 */
export function parseBlockFields(blockText: string): ShotBlockFields | null {
  if (!blockText.trim()) return null;

  const lines = blockText.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return null;

  const fields: ShotBlockFields = { shotId: '' };
  let currentField: string | null = null;
  let currentValue: string[] = [];

  // 已知的字段名列表（支持新旧两种字段名）
  const knownFields = [
    '时长', '时间',  // 时间/时长
    '取景', 
    '角度', '摄像机角度',  // 支持新旧格式
    '运动', '镜头运动',    // 支持新旧格式
    '机位', 
    '站位与构图', '动作与神态', '氛围与特效', 
    '人声', '音效', '转场', '场景名称', '人物名称', '道具名称',
    '视觉化描述'
  ];
  
  // 🆕 分组标题（不是字段，需要跳过）
  const groupHeaders = ['镜头描述', '画面描述', '镜头语言'];

  for (let line of lines) {
    // 🔧 去除行首空格 + 列表标记（- * • · ◦ → 等），兼容用户/AI 用 markdown 列表语法
    // 例: "- 取景：中景" / "* 站位与构图：xxx" / "• 人声：xxx" 都能被后续匹配到
    line = line.replace(/^[\s\-\*•·◦→●○]+/, '');

    // 分段标题由 parseStreamingBlocks 维护，不属于镜头字段。
    if (/^(?:分段|段落)\s*0*\d+\s*$/.test(line)) continue;

    // 检查是否是镜头ID行 (如 "镜头01" 或 "镜头 01")
    const shotIdMatch = line.match(/^镜头\s*(\d+)/);
    if (shotIdMatch) {
      // 保存之前的字段
      if (currentField && currentValue.length > 0) {
        (fields as any)[currentField] = currentValue.join('\n');
      }

      fields.shotId = `镜头${shotIdMatch[1].padStart(2, '0')}`;
      currentField = null;
      currentValue = [];
      continue;
    }

    // 🆕 检查是否是分组标题行（如 "镜头描述：" 或 "画面描述："）
    let isGroupHeader = false;
    for (const header of groupHeaders) {
      if (line.startsWith(header + '：') || line.startsWith(header + ':') || line === header + '：' || line === header + ':') {
        // 保存之前的字段
        if (currentField && currentValue.length > 0) {
          (fields as any)[currentField] = currentValue.join('\n');
        }
        // 重置当前字段（分组标题不是字段）
        currentField = null;
        currentValue = [];
        isGroupHeader = true;
        break;
      }
    }
    if (isGroupHeader) continue;

    // 🆕 Bug 4 修复：检查"合并字段名"行，如 "取景/角度/机位：近景，小乙揉着头"
    // 用户输入文字脚本常用合并字段格式（取景/角度/机位、运动/机位 等），
    // AI 看到原文格式会模仿输出。如果不识别，整行被忽略 → imagePrompt 为空。
    // 修复：把合并值塞给第一个匹配的已知字段（让 imagePromptParts 拿到内容）。
    // 同时支持中文斜杠 ／、英文 /、顿号 、 三种分隔符。
    const mergedFieldMatch = line.match(/^([^：:]+)[：:](.*)$/);
    if (mergedFieldMatch) {
      const fieldNamesPart = mergedFieldMatch[1].trim();
      const valuePart = mergedFieldMatch[2].trim();
      if (/[\/／、]/.test(fieldNamesPart)) {
        const subFields = fieldNamesPart.split(/[\/／、]/).map(s => s.trim()).filter(Boolean);
        const knownSubFields = subFields.filter(sf => knownFields.includes(sf));
        // 必须每个分量都是已知字段，避免误伤普通文本里的斜杠
        if (knownSubFields.length === subFields.length && knownSubFields.length >= 2 && valuePart) {
          // 保存之前的字段
          if (currentField && currentValue.length > 0) {
            (fields as any)[currentField] = currentValue.join('\n');
          }
          // 把整个值赋给第一个已知字段（避免 imagePromptParts 重复）
          // 这样 convertToStoryboardItem 拼 imagePrompt 时能拿到这部分内容
          (fields as any)[knownSubFields[0]] = valuePart;
          currentField = null;
          currentValue = [];
          continue;
        }
      }
    }

    // 检查是否是字段行 (如 "取景：中景")
    let foundField = false;
    for (const fieldName of knownFields) {
      if (line.startsWith(fieldName + '：') || line.startsWith(fieldName + ':')) {
        // 保存之前的字段
        if (currentField && currentValue.length > 0) {
          (fields as any)[currentField] = currentValue.join('\n');
        }

        currentField = fieldName;
        const value = line.substring(fieldName.length + 1).trim();
        currentValue = value ? [value] : [];
        foundField = true;
        break;
      }
    }

    // 如果不是字段行，可能是多行内容的延续
    if (!foundField && currentField) {
      currentValue.push(line);
    }
  }

  // 保存最后一个字段
  if (currentField && currentValue.length > 0) {
    (fields as any)[currentField] = currentValue.join('\n');
  }

  // 必须有镜头ID
  if (!fields.shotId) return null;

  return fields;
}

/**
 * 将解析的字段转换为 StoryboardItem
 * 🔧 按照新规则生成提示词：
 * - imagePrompt（生图提示词）: 取景 + 角度 + 机位 + 站位与构图 + 氛围与特效
 * - videoPrompt（视频提示词）: 运动 + 动作与神态
 * - dialogue（人物台词）: 人声字段
 */
export function convertToStoryboardItem(fields: ShotBlockFields): StoryboardItem {
  // 🔧 清理字段值：移除可能残留的分组标题文字
  const cleanFieldValue = (value: string | undefined): string => {
    if (!value) return '';
    return value
      .replace(/^(镜头描述|画面描述|视觉化描述)[：:]\s*/gi, '')
      .trim();
  };
  
  // 🔧 兼容新旧字段名
  const 角度 = fields.角度 || fields.摄像机角度 || '';
  const 运动 = fields.运动 || fields.镜头运动 || '';
  const originalDuration = fields.时长 || fields.时间 || '';
  const dialogueDurationFloor = estimateDialogueDurationSeconds(fields.人声);
  const parsedDuration = Number.parseFloat(originalDuration);
  const 时长 = dialogueDurationFloor > 0 && (!Number.isFinite(parsedDuration) || parsedDuration < dialogueDurationFloor)
    ? `${dialogueDurationFloor}秒`
    : originalDuration;
  
  // 🔧 生图提示词: 取景 + 角度 + 机位 + 站位与构图 + 氛围与特效
  const imagePromptParts = [
    cleanFieldValue(fields.取景),
    cleanFieldValue(角度),
    cleanFieldValue(fields.机位),
    cleanFieldValue(fields.站位与构图),
    cleanFieldValue(fields.氛围与特效)
  ].filter(v => v && v.length > 0);
  
  // 🆕 如果主要字段为空，使用视觉化描述作为备用
  let imagePrompt = imagePromptParts.join('，');
  if (!imagePrompt && fields.视觉化描述) {
    imagePrompt = cleanFieldValue(fields.视觉化描述);
  }

  // 🔧 视频提示词: 运动 + 动作与神态
  const videoPromptParts = [
    cleanFieldValue(运动),
    cleanFieldValue(fields.动作与神态)
  ].filter(v => v && v.length > 0);
  const videoPrompt = videoPromptParts.join('，');

  // 解析人物名称为数组
  const characters = fields.人物名称
    ? fields.人物名称.split(/[,，、]/).map(c => c.trim()).filter(c => c)
    : [];
  const props = fields.道具名称 && fields.道具名称.trim() !== '无'
    ? fields.道具名称.split(/[,，、]/).map(p => p.trim()).filter(p => p)
    : [];

  // 构建原始文本用于存储和显示
  const originalTextParts = [
    fields.shotId,
    时长 ? `时间：${时长}` : '',
    fields.取景 ? `取景：${fields.取景}` : '',
    角度 ? `摄像机角度：${角度}` : '',
    运动 ? `镜头运动：${运动}` : '',
    fields.机位 ? `机位：${fields.机位}` : '',
    fields.站位与构图 ? `站位与构图：${fields.站位与构图}` : '',
    fields.动作与神态 ? `动作与神态：${fields.动作与神态}` : '',
    fields.氛围与特效 ? `氛围与特效：${fields.氛围与特效}` : '',
    fields.人声 ? `人声：${fields.人声}` : '',
    fields.音效 ? `音效：${fields.音效}` : '',
    fields.转场 ? `转场：${fields.转场}` : '',
    fields.场景名称 ? `场景名称：${fields.场景名称}` : '',
    fields.人物名称 ? `人物名称：${fields.人物名称}` : '',
    fields.道具名称 ? `道具名称：${fields.道具名称}` : ''
  ].filter(Boolean).join('\n');

  // 生成场景描述 (scriptSegment)
  const scriptSegmentParts = [
    fields.取景,
    角度,
    fields.站位与构图,
    fields.动作与神态
  ].filter(Boolean);
  const scriptSegment = scriptSegmentParts.slice(0, 2).join('，') + '。' + 
    (scriptSegmentParts.slice(2).join('，') || '');

  return {
    id: uuidv4(),
    originalText: originalTextParts,
    scriptSegment: scriptSegment.trim() || fields.shotId,
    imagePrompt,
    videoPrompt,
    dialogue: fields.人声 || '',  // 🔧 人物台词对应人声字段
    characters,
    scene: fields.场景名称 || '',
    props,
    shotNumber: fields.shotId,
    scriptSegmentId: fields.segmentNo ? `storyboard-segment-${fields.segmentNo}` : undefined,
    sourceVideoShotNo: fields.shotId,
    duration: 时长  // 🔧 兼容 时长/时间 两种字段名
  };
}

/**
 * 完整解析分镜脚本文本
 */
export function parseStoryboardScript(scriptText: string): ParseResult {
  const { completedBlocks, displayText, continueFrom } = parseStreamingBlocks(scriptText + '---CUT---');
  
  const shots: StoryboardItem[] = completedBlocks.map(convertToStoryboardItem);

  return {
    shots,
    displayText,
    continueFrom,
    rawBlocks: completedBlocks
  };
}

/**
 * 从流式内容增量更新分镜列表
 */
export function updateShotsFromStream(
  existingShots: StoryboardItem[],
  newBlocks: ShotBlockFields[]
): StoryboardItem[] {
  const newShots = newBlocks.map(convertToStoryboardItem);
  
  // 如果已有镜头，检查是否需要替换（根据 shotNumber）
  const existingShotNumbers = new Set(existingShots.map(s => s.shotNumber));
  const updatedShots = [...existingShots];
  
  for (const newShot of newShots) {
    if (existingShotNumbers.has(newShot.shotNumber)) {
      // 替换已存在的
      const index = updatedShots.findIndex(s => s.shotNumber === newShot.shotNumber);
      if (index !== -1) {
        updatedShots[index] = { ...updatedShots[index], ...newShot, id: updatedShots[index].id };
      }
    } else {
      // 添加新的
      updatedShots.push(newShot);
    }
  }
  
  return updatedShots;
}

/**
 * 移除文本中的控制符用于显示
 */
export function removeControlCharacters(text: string): string {
  return text
    .replace(/---CUT---/g, '')
    .replace(/<<<CONTINUE_FROM\s+镜头\d+>>>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 🆕 分段输入内容
 * 将长输入按镜头标识或段落分成多个部分，每部分约10个镜头
 * 
 * @param content 原始输入内容
 * @param shotsPerSegment 每段包含的镜头数量（默认10）
 * @param overlapShots 重叠的镜头数量，保证连贯性（默认1）
 * @returns 分段后的内容数组
 */
export function segmentInputContent(
  content: string,
  shotsPerSegment: number = 10,
  overlapShots: number = 1
): string[] {
  if (!content.trim()) return [];

  // 识别镜头标识的正则：匹配 "镜头1"、"镜头 1"、"镜头01" 等格式
  const shotPattern = /镜头\s*(\d+)/g;
  const matches = [...content.matchAll(shotPattern)];
  
  // 如果没有找到镜头标识，按空行分段
  if (matches.length === 0) {
    return segmentByParagraphs(content, shotsPerSegment);
  }
  
  console.log(`📊 检测到 ${matches.length} 个镜头标识`);
  
  // 如果镜头数量不超过单次处理量，直接返回
  if (matches.length <= shotsPerSegment) {
    return [content];
  }
  
  const segments: string[] = [];
  
  // 按镜头标识分段
  for (let i = 0; i < matches.length; i += shotsPerSegment - overlapShots) {
    const startMatch = matches[i];
    const endIndex = Math.min(i + shotsPerSegment, matches.length);
    const endMatch = matches[endIndex - 1];
    
    // 获取起始位置
    const startPos = startMatch.index!;
    
    // 获取结束位置：下一个镜头的开始位置，或者文档结尾
    let endPos: number;
    if (endIndex < matches.length) {
      // 如果还有下一段，结束位置是下一段开始镜头的位置
      endPos = matches[endIndex].index!;
    } else {
      // 最后一段，取到文档末尾
      endPos = content.length;
    }
    
    const segment = content.substring(startPos, endPos).trim();
    if (segment) {
      segments.push(segment);
      console.log(`📎 分段 ${segments.length}: 镜头 ${startMatch[1]} - ${endMatch[1]} (${segment.length} 字符)`);
    }
    
    // 如果已经处理到最后，退出
    if (endIndex >= matches.length) break;
  }
  
  return segments;
}

/**
 * 按段落分段（备用方案，当没有镜头标识时使用）
 */
function segmentByParagraphs(content: string, itemsPerSegment: number): string[] {
  // 按双换行分割段落
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
  
  if (paragraphs.length <= itemsPerSegment) {
    return [content];
  }
  
  const segments: string[] = [];
  for (let i = 0; i < paragraphs.length; i += itemsPerSegment) {
    const segment = paragraphs.slice(i, i + itemsPerSegment).join('\n\n');
    if (segment.trim()) {
      segments.push(segment);
    }
  }
  
  console.log(`📎 按段落分段: ${segments.length} 段`);
  return segments;
}

/**
 * 🆕 获取镜头数量
 */
export function countShots(content: string): number {
  const shotPattern = /镜头\s*\d+/g;
  const matches = content.match(shotPattern);
  return matches ? matches.length : 0;
}

