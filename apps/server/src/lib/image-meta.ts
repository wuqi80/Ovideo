import fs from 'node:fs';
import { fileSize } from './storage.js';

/**
 * 从文件头字节嗅探真实图片格式，返回标准 mime。
 *
 * 【为什么不信扩展名】出图适配器把厂商回的 base64 一律按 .png 落盘，但方舟 Seedream
 * 实际回的是 JPEG。于是"文件真是 JPEG、库里 mime 写着 image/png、扩展名也是 .png"三处全对不上。
 * 前端按 mime 决定怎么渲染/下载，对不上就会在某些客户端裂图。落库时只信字节。
 */
export function sniffImageMime(absPath: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(absPath, 'r');
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return 'image/png';
    }
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif';
    // WEBP：RIFF....WEBP
    if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') {
      return 'image/webp';
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * 从文件头读图片宽高（PNG / JPEG），不依赖 ffprobe。
 * 【为什么不用 probeDimensions】那个走 ffprobe 子进程，出图是每张都要落库的高频路径，
 * 而 PNG/JPEG 的尺寸就在文件头几十字节里，直接读更省。读不出返回 null，绝不猜。
 */
export function readImageDimensions(absPath: string): { width: number; height: number } | null {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(absPath);
  } catch {
    return null;
  }
  // PNG：IHDR 紧跟 8 字节签名，宽高在偏移 16/20（各 4 字节大端）
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG：扫描到 SOFn 段（0xC0-0xCF，除 C4/C8/CC）读高宽
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      // 段长在 marker 后 2 字节，跳过整段
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * 出图落库前统一算出与文件事实一致的资产字段：真实 mime、真实宽高、字节数。
 * 三处出图点（关键图 / 设计图 / 视频首帧）共用，免得各写一遍再各漏一处。
 * mime 嗅探不出时回退到调用方给的 fallback（扩展名猜测），尺寸读不出就留 null（不猜）。
 */
export function imageAssetFields(
  absPath: string,
  fallbackMime: string,
): { mime: string; width?: number; height?: number; sizeBytes: number } {
  // createAsset 用 undefined 表示"没有该字段"，读不出尺寸时给 undefined 而非 null
  const dims = readImageDimensions(absPath);
  return {
    mime: sniffImageMime(absPath) ?? fallbackMime,
    width: dims?.width,
    height: dims?.height,
    sizeBytes: fileSize(absPath),
  };
}
