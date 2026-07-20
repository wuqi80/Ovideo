import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, ProviderConfig } from '@prisma/client';
import { createTestDb, type TestDb } from '../../test/testdb.js';
import { healthCheckAll, healthCheckProvider } from './health.js';

let t: TestDb;
let db: PrismaClient;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});

afterAll(async () => {
  await t.cleanup();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const textCapability = JSON.stringify({ modality: 'text', input: ['prompt'] });

let seq = 0;
async function makeProvider(overrides: Partial<ProviderConfig> = {}): Promise<ProviderConfig> {
  seq += 1;
  return db.providerConfig.create({
    data: {
      name: `体检厂${seq}`,
      vendor: 'openai',
      category: 'TEXT',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-health-123456',
      ...overrides,
    },
  });
}

async function addModel(
  providerConfigId: string,
  key: string,
  modality: string,
  enabled = true,
  sortOrder = 0,
) {
  return db.modelConfig.create({
    data: { providerConfigId, key, label: key, modality, capabilityJson: textCapability, enabled, sortOrder },
  });
}

/** 造一个 fetch 桩：按请求体里的 model 决定返回什么，并记录每次调用 */
function stubFetch(handler: (model: string, url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; model: string; body: Record<string, unknown> }> = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const model = String(body.model ?? '');
    calls.push({ url: String(url), model, body });
    return handler(model, String(url), init ?? {});
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

function okChat(content = 'h'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function errChat(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('healthCheckProvider —— 各状态分支', () => {
  it('文本模型真实调通 → ok，并把结果落库', async () => {
    const p = await makeProvider();
    const m = await addModel(p.id, 'good-text', 'text');
    stubFetch(() => okChat());

    const result = await healthCheckProvider(db, p.id);

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({ modelConfigId: m.id, key: 'good-text', status: 'ok' });
    expect(result.models[0]!.latencyMs).toBeTypeOf('number');

    const saved = await db.modelConfig.findUniqueOrThrow({ where: { id: m.id } });
    expect(saved.healthStatus).toBe('ok');
    expect(saved.healthCheckedAt).toBeInstanceOf(Date);
    expect(saved.healthDetail).toContain('真实调用成功');
  });

  it('Base URL 写错导致的网关 404 → 不判 dead，提示先核对 Base URL', async () => {
    // 路径漏了 /v3 时网关也回 404，正文常是 HTML、压根不提模型名。
    // 若无条件判 dead，整个厂商的模型会被集体误标，把人送去控制台白折腾一趟，
    // 真正要改的只是一个输入框——而 dead 一旦开始误报，红色横幅就会被学会无视。
    const p = await makeProvider();
    await addModel(p.id, 'doubao-seed-1-6-250615', 'text');
    stubFetch(() => errChat(404, '<html><body>404 Not Found</body></html>'));

    const result = await healthCheckProvider(db, p.id);

    expect(result.models[0]!.status).toBe('error');
    expect(result.models[0]!.detail).toContain('Base URL');
  });

  it('探针超时 → 未下结论，而不是"网络不通"', async () => {
    // 超时说明握手成功、请求发出去了，只是没等到回答。报成"网络不通"会让人去查代理，
    // 而同一条记录的原文却写着"连接本身是通的"——两句话指向相反的排查方向。
    const p = await makeProvider();
    await addModel(p.id, 'slow-model', 'text');
    stubFetch(() => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    });

    const result = await healthCheckProvider(db, p.id);

    expect(result.models[0]!.status).toBe('error');
    expect(result.models[0]!.detail).toContain('未下结论');
    expect(result.models[0]!.detail).not.toContain('网络不可达');
  });

  it('404 InvalidEndpointOrModel → dead，说明要去控制台开通或改用推理接入点', async () => {
    const p = await makeProvider();
    const m = await addModel(p.id, 'doubao-seed-1-6-250615', 'text');
    stubFetch(() =>
      errChat(404, { error: { code: 'InvalidEndpointOrModel.NotFound', message: 'model not found' } }),
    );

    const result = await healthCheckProvider(db, p.id);

    expect(result.models[0]!.status).toBe('dead');
    expect(result.models[0]!.detail).toContain('推理接入点');
    const saved = await db.modelConfig.findUniqueOrThrow({ where: { id: m.id } });
    expect(saved.healthStatus).toBe('dead');
  });

  it('400 且措辞指向模型不存在 → dead', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'ghost', 'text');
    stubFetch(() => errChat(400, { error: { message: 'The model `ghost` does not exist' } }));

    const result = await healthCheckProvider(db, p.id);
    expect(result.models[0]!.status).toBe('dead');
  });

  it('400 但只是普通参数错误 → error，不冤枉成 dead', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'picky', 'text');
    stubFetch(() => errChat(400, { error: { message: 'temperature must be between 0 and 2' } }));

    const result = await healthCheckProvider(db, p.id);
    expect(result.models[0]!.status).toBe('error');
  });

  it('401 → auth', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'any-text', 'text');
    stubFetch(() => errChat(401, { error: { message: 'invalid api key' } }));

    const result = await healthCheckProvider(db, p.id);
    expect(result.models[0]!.status).toBe('auth');
    expect(result.models[0]!.detail).toContain('API Key');
  });

  it('429 → error（限流不等于模型死了）', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'busy', 'text');
    stubFetch(() => errChat(429, 'rate limited'));

    const result = await healthCheckProvider(db, p.id);
    expect(result.models[0]!.status).toBe('error');
    expect(result.models[0]!.detail).toContain('限流');
  });

  it('网络层不通 → unreachable', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'offline', 'text');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const result = await healthCheckProvider(db, p.id);
    expect(result.models[0]!.status).toBe('unreachable');
  });

  it('厂商缺 baseUrl/apiKey → unreachable，且一个请求都不发', async () => {
    const p = await makeProvider({ baseUrl: '', apiKey: '' });
    await addModel(p.id, 'nokey', 'text');
    const calls = stubFetch(() => okChat());

    const result = await healthCheckProvider(db, p.id);
    expect(result.models[0]!.status).toBe('unreachable');
    expect(result.models[0]!.detail).toContain('Base URL');
    expect(calls).toHaveLength(0);
  });

  it('HTTP 200 但响应体不合 OpenAI 形状（max_tokens=1 截断）仍判 ok', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'truncating', 'text');
    // 部分厂商在 finish_reason=length 时返回 content: null
    stubFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 }));

    const result = await healthCheckProvider(db, p.id);
    expect(result.models[0]!.status).toBe('ok');
  });

  it('未体检过的模型三个 health 字段都是 null，不伪装成没问题', async () => {
    const p = await makeProvider();
    const m = await addModel(p.id, 'never-checked', 'text');
    const saved = await db.modelConfig.findUniqueOrThrow({ where: { id: m.id } });
    expect(saved.healthStatus).toBeNull();
    expect(saved.healthCheckedAt).toBeNull();
    expect(saved.healthDetail).toBeNull();
  });
});

describe('成本红线', () => {
  it('图像/视频/语音一律 untested，且确实没有发出任何真实请求', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'seedream-4', 'image', true, 0);
    await addModel(p.id, 'seedance-v1', 'video', true, 1);
    await addModel(p.id, 'qwen-tts', 'tts', true, 2);
    const calls = stubFetch(() => okChat());

    const result = await healthCheckProvider(db, p.id);

    expect(result.models.map((m) => m.status)).toEqual(['untested', 'untested', 'untested']);
    // 正面断言成本红线：这三类模型一次 HTTP 都不该发出去
    expect(calls).toHaveLength(0);
    // 未实测的原因必须说清楚"为什么不测"和"你自己怎么验"
    expect(result.models[0]!.detail).toContain('按张计费');
    expect(result.models[1]!.detail).toContain('最贵');
    expect(result.models[2]!.detail).toContain('按字符计费');
  });

  it('混合模态时，只有文本模型发出真实请求', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'text-a', 'text', true, 0);
    await addModel(p.id, 'image-b', 'image', true, 1);
    await addModel(p.id, 'text-c', 'text', true, 2);
    const calls = stubFetch(() => okChat());

    await healthCheckProvider(db, p.id);

    expect(calls.map((c) => c.model).sort()).toEqual(['text-a', 'text-c']);
  });

  it('探针请求确实是最小请求：max_tokens=1', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'minimal', 'text');
    const calls = stubFetch(() => okChat());

    await healthCheckProvider(db, p.id);

    expect(calls[0]!.body.max_tokens).toBe(1);
    expect(calls[0]!.url).toContain('/chat/completions');
  });

  it('已停用的模型不体检，不为它花钱', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'disabled-one', 'text', false);
    const calls = stubFetch(() => okChat());

    const result = await healthCheckProvider(db, p.id);
    expect(result.models).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe('隔离性与副作用', () => {
  it('一个模型失败不影响其余模型继续体检', async () => {
    const p = await makeProvider();
    await addModel(p.id, 'alpha', 'text', true, 0);
    await addModel(p.id, 'boom', 'text', true, 1);
    await addModel(p.id, 'gamma', 'text', true, 2);
    stubFetch((model) => {
      if (model === 'boom') throw new TypeError('fetch failed');
      return okChat();
    });

    const result = await healthCheckProvider(db, p.id);

    expect(result.models.map((m) => `${m.key}:${m.status}`)).toEqual([
      'alpha:ok',
      'boom:unreachable',
      'gamma:ok',
    ]);
  });

  it('体检结果绝不自动停用模型——dead 也保持 enabled', async () => {
    const p = await makeProvider();
    const m = await addModel(p.id, 'dead-but-enabled', 'text');
    // 用真实的厂商回应：裸 "not found" 现在算证据不足（网关 404 也长这样），不再判 dead
    stubFetch(() => errChat(404, { error: { message: 'The model does not exist' } }));

    await healthCheckProvider(db, p.id);

    const saved = await db.modelConfig.findUniqueOrThrow({ where: { id: m.id } });
    expect(saved.healthStatus).toBe('dead');
    expect(saved.enabled).toBe(true); // 标出来让人自己决定，不越权
  });

  it('detail 与响应里绝不出现 apiKey', async () => {
    const p = await makeProvider({ apiKey: 'sk-super-secret-key-999' });
    await addModel(p.id, 'leaky', 'text');
    stubFetch(() => errChat(404, 'model not found'));

    const result = await healthCheckProvider(db, p.id);

    expect(JSON.stringify(result)).not.toContain('sk-super-secret-key-999');
    const saved = await db.modelConfig.findFirstOrThrow({ where: { providerConfigId: p.id } });
    expect(saved.healthDetail ?? '').not.toContain('sk-super-secret-key-999');
  });

  it('厂商不存在 → 404 AppError', async () => {
    await expect(healthCheckProvider(db, 'no-such-provider')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('healthCheckAll', () => {
  it('只体检已启用厂商，且一个厂商的模型故障不影响另一个厂商', async () => {
    // 独立库，避免前面用例留下的厂商干扰全局体检
    const t2 = await createTestDb();
    try {
      const alive = await t2.db.providerConfig.create({
        data: { name: '在线厂', vendor: 'openai', category: 'TEXT', baseUrl: 'https://a.example.com/v1', apiKey: 'sk-a-123456' },
      });
      const broken = await t2.db.providerConfig.create({
        data: { name: '故障厂', vendor: 'openai', category: 'TEXT', baseUrl: 'https://b.example.com/v1', apiKey: 'sk-b-123456' },
      });
      const off = await t2.db.providerConfig.create({
        data: { name: '停用厂', vendor: 'openai', category: 'TEXT', baseUrl: 'https://c.example.com/v1', apiKey: 'sk-c-123456', enabled: false },
      });
      for (const [p, key] of [
        [alive, 'a-text'],
        [broken, 'b-text'],
        [off, 'c-text'],
      ] as const) {
        await t2.db.modelConfig.create({
          data: { providerConfigId: p.id, key, label: key, modality: 'text', capabilityJson: textCapability },
        });
      }

      stubFetch((model) =>
        model === 'b-text' ? errChat(404, { error: { message: 'The model does not exist' } }) : okChat(),
      );

      const result = await healthCheckAll(t2.db);

      expect(result.providers.map((p) => p.providerName)).toEqual(['在线厂', '故障厂']);
      expect(result.providers[0]!.models[0]!.status).toBe('ok');
      expect(result.providers[1]!.models[0]!.status).toBe('dead');
      // 停用厂商一次都没测
      const offModel = await t2.db.modelConfig.findFirstOrThrow({ where: { providerConfigId: off.id } });
      expect(offModel.healthStatus).toBeNull();
    } finally {
      await t2.cleanup();
    }
  });
});
