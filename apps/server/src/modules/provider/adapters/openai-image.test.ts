import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openaiImageGenerate } from './openai-image.js';

const cfg = { baseUrl: 'https://img.example.com/v1/', apiKey: 'sk-img-key', model: 'img-x' };

const PNG_BYTES = Buffer.from('fake-png-字节');

function okResponse() {
  return new Response(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString('base64') }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function tmpOut(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ovideo-img-')), 'out.png');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openaiImageGenerate', () => {
  it('成功：POST 到去尾斜杠的 /images/generations，带 Bearer 头，b64 解码落盘', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const outPath = tmpOut();
    await openaiImageGenerate(cfg, { prompt: '一只赛博猫', outPath });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://img.example.com/v1/images/generations');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-img-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('img-x');
    expect(body.prompt).toBe('一只赛博猫');
    expect(body.size).toBe('1024x1792'); // 缺省竖屏
    expect(body.response_format).toBe('b64_json');

    expect(fs.readFileSync(outPath)).toEqual(PNG_BYTES);
    fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
  });

  it('传入 size 时透传', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const outPath = tmpOut();
    await openaiImageGenerate(cfg, { prompt: 'x', outPath, size: '512x512' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).size).toBe('512x512');
    fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
  });

  it('非 2xx：抛出含状态码与响应片段的错误，不落盘', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })));
    const outPath = tmpOut();
    await expect(openaiImageGenerate(cfg, { prompt: 'x', outPath })).rejects.toThrow(/429/);
    expect(fs.existsSync(outPath)).toBe(false);
    fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
  });

  it('结构异常：2xx 但缺 data[0].b64_json 时抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    await expect(openaiImageGenerate(cfg, { prompt: 'x', outPath: tmpOut() })).rejects.toThrow(
      /结构异常/,
    );
  });

  it('响应不是 JSON：抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(openaiImageGenerate(cfg, { prompt: 'x', outPath: tmpOut() })).rejects.toThrow(
      /非 JSON/,
    );
  });

  describe('参考图门禁（对齐视频/语音的厂商门禁）', () => {
    /** 造一张真实存在的参考图文件（门禁必须发生在读文件、发请求之前也无所谓，但不能因缺文件而假通过） */
    function tmpRef(): string {
      const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ovideo-ref-')), 'ref.png');
      fs.writeFileSync(p, PNG_BYTES);
      return p;
    }

    it('非方舟厂商 + 有参考图 → 400 拦下，且一个请求都不发（不白花钱）', async () => {
      // 宽松网关会忽略未知的 image 字段照样出图照样计费，形象全漂而无处可察；严格端点则直接 400。
      const fetchMock = vi.fn(async () => okResponse());
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        openaiImageGenerate(cfg, { prompt: 'x', outPath: tmpOut(), refImagePaths: [tmpRef()] }),
      ).rejects.toThrow(/不支持参考图/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('拦下时说清该怎么办（换回 Seedream 或解除参考图绑定）', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
      const err = await openaiImageGenerate(cfg, {
        prompt: 'x',
        outPath: tmpOut(),
        refImagePaths: [tmpRef()],
      }).catch((e: Error) => e);
      expect((err as { statusCode?: number }).statusCode).toBe(400);
      expect((err as Error).message).toContain('Seedream');
      expect((err as Error).message).toContain('解除');
    });

    it('非方舟厂商但没有参考图 → 照常出图（门禁只管参考图这条路）', async () => {
      const fetchMock = vi.fn(async () => okResponse());
      vi.stubGlobal('fetch', fetchMock);
      const outPath = tmpOut();
      await openaiImageGenerate(cfg, { prompt: 'x', outPath, refImagePaths: [] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
    });

    it('方舟厂商 → 放行，参考图仍按 image 字段上送', async () => {
      const fetchMock = vi.fn(async () => okResponse());
      vi.stubGlobal('fetch', fetchMock);
      const arkCfg = {
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: 'sk-ark',
        model: 'doubao-seedream-4-0',
      };
      const outPath = tmpOut();
      await openaiImageGenerate(arkCfg, { prompt: 'x', outPath, refImagePaths: [tmpRef()] });
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { image?: string[] };
      expect(body.image).toHaveLength(1);
      expect(body.image![0]).toMatch(/^data:image\/png;base64,/);
      fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
    });
  });

  it('请求带 AbortSignal 超时控制', async () => {
    // 模拟一个永不返回、但尊重 AbortSignal 的 fetch（不真等 120s，只验证 signal 被传入）
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return okResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const outPath = tmpOut();
    await openaiImageGenerate(cfg, { prompt: 'x', outPath });
    fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
  });
});
