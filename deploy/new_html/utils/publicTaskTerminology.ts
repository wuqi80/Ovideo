import type { TaskKind } from '../types';

const PUBLIC_SCRIPT_LABELS = {
  tier1: '一阶 · 连续写作模型',
  tier2: '二阶 · 快速写作模型',
  tier3: '三阶 · 推理写作模型',
  tier4: '四阶 · 全能写作模型',
} as const;

const PUBLIC_IMAGE_LABELS = {
  tier1: '一阶 · 快速生图模型',
  tier2: '二阶 · 高质量生图模型',
  tier3: '三阶 · 参考图生图模型',
  tier4Hd: '四阶 · 高清生图模型',
  tier4All: '四阶 · 全能生图模型',
} as const;

/**
 * Task history used to persist provider/runtime names in display_name/title.
 * Keep operation text, but translate those internal names to the same public
 * labels used by the current model selectors. This also protects old rows and
 * sessionStorage records without rewriting historical data.
 */
export function formatPublicTaskText(value: unknown, kind?: TaskKind): string {
  let text = String(value || '').trim();
  if (!text) return '';

  const imageContext = String(kind || '').includes('image')
    || /图像|图片|生图|image|seedream|doubao|豆包/i.test(text);

  if (imageContext) {
    text = text
      .replace(/(?:doubao[\s_-]*)?seedream[\w.\s_-]*/gi, PUBLIC_IMAGE_LABELS.tier3)
      .replace(/豆包(?:图像|图片)?(?:生成)?/g, PUBLIC_IMAGE_LABELS.tier3)
      .replace(/doubao(?:\s*(?:image|图像|图片))?(?:\s*生成)?/gi, PUBLIC_IMAGE_LABELS.tier3)
      .replace(/gemini\s*2\.5\s*flash\s*image/gi, PUBLIC_IMAGE_LABELS.tier1)
      .replace(/gemini\s*3(?:\.\d+)?\s*(?:pro|flash)?\s*image(?:\s*preview)?/gi, PUBLIC_IMAGE_LABELS.tier2)
      .replace(/gemini(?:\s*(?:image|图像|图片))?(?:\s*生成)?/gi, 'AI 生图任务')
      .replace(/gpt[\s_-]*image[\s_-]*(?:vip|2[\s_-]*vip)/gi, PUBLIC_IMAGE_LABELS.tier4Hd)
      .replace(/gpt[\s_-]*image[\s_-]*(?:official|2)/gi, PUBLIC_IMAGE_LABELS.tier4All)
      .replace(/gpt[\s_-]*image/gi, PUBLIC_IMAGE_LABELS.tier4All)
      .replace(/qwen(?:n)?[\s_-]*lora/gi, '二阶 · 风格强化模型')
      .replace(/qwen(?:n)?(?:[\s_-]*image)?/gi, '二阶 · 多参考图模型')
      .replace(/kontext/gi, '三阶 · 高质量生图模型')
      .replace(/nanobanana/gi, PUBLIC_IMAGE_LABELS.tier1);
  } else {
    text = text
      .replace(/deepseek[\s_-]*(?:reasoner|r1|v4[\s_-]*pro)\s*文本生成/gi, PUBLIC_SCRIPT_LABELS.tier3)
      .replace(/deepseek[\s_-]*(?:chat|v4[\s_-]*flash)?\s*文本生成/gi, PUBLIC_SCRIPT_LABELS.tier2)
      .replace(/minimax[\s_-]*m3\s*文本生成/gi, PUBLIC_SCRIPT_LABELS.tier1)
      .replace(/gemini\s*文本生成/gi, PUBLIC_SCRIPT_LABELS.tier4)
      .replace(/deepseek[\s_-]*(?:reasoner|r1|v4[\s_-]*pro)/gi, PUBLIC_SCRIPT_LABELS.tier3)
      .replace(/deepseek[\s_-]*(?:chat|v4[\s_-]*flash)/gi, PUBLIC_SCRIPT_LABELS.tier2)
      .replace(/deepseek/gi, PUBLIC_SCRIPT_LABELS.tier2)
      .replace(/minimax[\s_-]*m3/gi, PUBLIC_SCRIPT_LABELS.tier1)
      .replace(/gemini/gi, PUBLIC_SCRIPT_LABELS.tier4);
  }

  text = text
    .replace(/seedance[\s_-]*2[\s_-]*fast/gi, '渡劫')
    .replace(/seedance[\s_-]*2[\s_-]*mini/gi, '元婴')
    .replace(/seedance(?:[\s_-]*2(?:\.0)?)?/gi, '飞升')
    .replace(/wan[\s_-]*2(?:\.\d+)?/gi, '集群视频')
    .replace(/happy[\s_-]*horse/gi, '炼虚')
    .replace(/kling/gi, '合体')
    .replace(/vidu/gi, '大乘')
    .replace(/sora[\s_-]*2/gi, '化神')
    .replace(/veo(?:[\s_-]*3(?:\.1)?)?/gi, '筑基');

  return text
    .replace(/\s*API\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:\s*·\s*){2,}/g, ' · ')
    .trim();
}
