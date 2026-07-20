// OpenAI 兼容图像生成适配器：POST /images/generations（b64_json → 直接落盘）。
// 错误处理与超时风格同 openai-compatible.ts（AbortSignal.timeout，错误带状态码与响应片段）。
import fs from 'node:fs';
import path from 'node:path';
import { badRequest } from '../../../lib/errors.js';

export interface OpenAiImageConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface OpenAiImageArgs {
  prompt: string;
  /** 生成图直接写入该绝对路径（由调用方 allocFilePath 预分配） */
  outPath: string;
  /** 缺省竖屏 1024x1792（平台统一 9:16 方向） */
  size?: string;
  /**
   * 参考图本地绝对路径（角色/场景一致性的关键）：以 base64 data URL 经 `image` 字段上送。
   * 这是火山方舟 Seedream 等对 OpenAI images 协议的扩展；标准 OpenAI 端点会忽略未知字段。
   * 最多取前 MAX_REF_IMAGES 张（Ark 上限），空数组时不携带该字段。
   */
  refImagePaths?: string[];
}

/**
 * 单次请求能携带的参考图上限（Ark 侧限制）。
 * 【为什么导出】这个数原本只活在适配器里：调用方按全量参考图写提示词正文与 meta.refImages，
 * 到这里被静默截断——提示词写着「参考图6」却没发第 6 张，而「实际提示词」弹窗还列着 7 条。
 * 排查形象不一致的人会去怀疑模型和提示词，永远查不到问题在这一行 slice 上。
 * 上限必须两侧同源：调用方在构造提示词之前就按它截断，并把被截掉的部分显式记账。
 */
export const MAX_REF_IMAGES = 5;

/**
 * 该厂商/模型是否支持 image 字段上送参考图。
 * 判据与视频（isArk）、语音（isDashScope）的门禁同源：认域名或认模型名，不新造能力位模型。
 */
function supportsRefImages(cfg: OpenAiImageConfig): boolean {
  return cfg.baseUrl.includes('volces.com') || /seedream|seededit/i.test(cfg.model);
}

function toDataUrl(filePath: string): string {
  const ext = path.extname(filePath).replace('.', '').toLowerCase() || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

/** 图像生成默认超时 120s（比文本长：出图普遍慢） */
const DEFAULT_TIMEOUT_MS = 120_000;

export async function openaiImageGenerate(
  cfg: OpenAiImageConfig,
  args: OpenAiImageArgs,
): Promise<void> {
  /**
   * 参考图门禁（对齐 smartVideoGen / smartTtsGen 的写法）。
   * image 是方舟对 OpenAI images 协议的私有扩展：宽松网关会把它当未知字段忽略，
   * 照样出图、照样计费，出来的却是没有任何形象约束的图——形象全漂而无处可察，
   * 排查的人只会去怀疑提示词；严格端点则直接 400。两种结局都不该由用户自己撞上，
   * 所以在花钱之前拦下，并说清接下来该怎么办。
   */
  const refPaths = args.refImagePaths ?? [];
  if (refPaths.length > 0 && !supportsRefImages(cfg)) {
    throw badRequest(
      `图像模型「${cfg.model}」不支持参考图：参考图靠火山方舟私有的 image 字段上送，` +
        `换到其他 OpenAI 兼容出图厂商后，这 ${refPaths.length} 张参考图要么被网关静默丢弃（照常计费，但角色/场景形象不再一致），` +
        `要么直接被拒。请到管理后台把图像模型换回火山方舟 Seedream 系列，` +
        `或先解除该镜头/标签的参考图绑定（会失去形象一致性）后再生成。`,
    );
  }

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/images/generations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      prompt: args.prompt,
      size: args.size ?? '1024x1792',
      response_format: 'b64_json',
      ...(refPaths.length > 0 ? { image: refPaths.slice(0, MAX_REF_IMAGES).map(toDataUrl) } : {}),
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`图像生成请求失败：HTTP ${res.status}，响应：${text.slice(0, 300)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`图像生成响应结构异常（非 JSON）：${text.slice(0, 300)}`);
  }
  const b64 = (parsed as { data?: Array<{ b64_json?: unknown }> })?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error(`图像生成响应结构异常（缺 data[0].b64_json）：${text.slice(0, 300)}`);
  }
  fs.writeFileSync(args.outPath, Buffer.from(b64, 'base64'));
}
