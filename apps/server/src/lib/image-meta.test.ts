import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sniffImageMime, readImageDimensions } from './image-meta.js';

/**
 * 这套测试守的是验收时真实撞到的那个坑：厂商回 JPEG、适配器按 .png 落盘，
 * 于是文件真身、库里 mime、扩展名三处对不上。所以断言一律基于「构造出真实字节」，
 * 不是相信扩展名。
 */

const tmp: string[] = [];
function writeTmp(name: string, bytes: Buffer): string {
  const p = path.join(os.tmpdir(), `imgmeta-${Date.now()}-${name}`);
  fs.writeFileSync(p, bytes);
  tmp.push(p);
  return p;
}
afterAll(() => {
  for (const p of tmp) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* 清理失败无所谓 */
    }
  }
});

/** 一张 2x3 的最小合法 PNG（含 IHDR，宽=2 高=3） */
function tinyPng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.from([0, 0, 0, 0x0d]);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const wh = Buffer.alloc(8);
  wh.writeUInt32BE(2, 0); // width
  wh.writeUInt32BE(3, 4); // height
  const rest = Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]); // bit depth/color/... + 占位
  const crc = Buffer.from([0, 0, 0, 0]);
  return Buffer.concat([sig, ihdrLen, ihdrType, wh, rest, crc]);
}

/** 一张最小 JPEG：SOI + APP0 + SOF0(高=5 宽=7) + EOI */
function tinyJpeg(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof0 = Buffer.alloc(11);
  sof0[0] = 0xff;
  sof0[1] = 0xc0; // SOF0
  sof0.writeUInt16BE(9, 2); // 段长
  sof0[4] = 8; // 精度
  sof0.writeUInt16BE(5, 5); // height
  sof0.writeUInt16BE(7, 7); // width
  sof0[9] = 1; // 分量数
  sof0[10] = 1;
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, sof0, eoi]);
}

describe('sniffImageMime：只信字节，不信扩展名', () => {
  it('内容是 JPEG、扩展名是 .png → 报 image/jpeg（验收撞到的正是这一种）', () => {
    const p = writeTmp('fake.png', tinyJpeg());
    expect(sniffImageMime(p)).toBe('image/jpeg');
  });

  it('真 PNG → image/png', () => {
    const p = writeTmp('real.png', tinyPng());
    expect(sniffImageMime(p)).toBe('image/png');
  });

  it('认不出的字节 → null（交给调用方回退，绝不瞎猜）', () => {
    const p = writeTmp('junk.bin', Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]));
    expect(sniffImageMime(p)).toBeNull();
  });
});

describe('readImageDimensions：从文件头读真实宽高', () => {
  it('PNG 从 IHDR 读', () => {
    const p = writeTmp('dim.png', tinyPng());
    expect(readImageDimensions(p)).toEqual({ width: 2, height: 3 });
  });

  it('JPEG 从 SOF0 读（高宽顺序不能搞反）', () => {
    const p = writeTmp('dim.jpg', tinyJpeg());
    expect(readImageDimensions(p)).toEqual({ width: 7, height: 5 });
  });

  it('读不出 → null，不返回 0×0 之类的假值', () => {
    const p = writeTmp('nodim.bin', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(readImageDimensions(p)).toBeNull();
  });
});
