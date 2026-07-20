// Job.modelKey 的可信度回归：入队时写的是"打算用谁"，跑完必须改写成"实际是谁"。
// 这组用例守住成本归因——转移链换过人、显式指定、全军覆没，三条路都要在任务历史里留下真相。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Episode, Project, ScriptDraft } from '@prisma/client';
import { createTestDb, type TestDb } from '../../test/testdb.js';
import { toJson } from '../../lib/json.js';
import { registerExecutors } from '../../app.js';
import { getExecutor } from './registry.js';
import { recordJobModelKey, failJob, retryJob } from './service.js';
import {
  createFailoverTextGen,
  describeModelUsage,
  describeModelUsageHistory,
  type ModelUsage,
} from '../provider/scheduler.js';

let tdb: TestDb;
let project: Project;
let episode: Episode;
let draft: ScriptDraft;

const SCRIPT = ['【场景：天台】', '林凡：你终于来了。', '苏瑶：我一直都在。'].join('\n');

/** 模型返回的最小可用两级分镜（够 applyPatch 落库即可） */
const STORYBOARD_JSON = JSON.stringify({
  scenes: [
    {
      title: '天台',
      location: '天台',
      interiorExterior: 'EXT',
      timeOfDay: '傍晚',
      sourceText: SCRIPT,
      shots: [
        {
          sourceText: '林凡：你终于来了。',
          imagePrompt: '@天台 上，@林凡 转身',
          videoPrompt: '@林凡 正在说话，嘴部自然开合',
          durationPlannedMs: 4000,
          shotSize: '中景',
          cameraAngle: '平视',
          cameraMovement: '固定',
          composition: '人物居中',
          transition: '切',
          tags: [
            { name: '天台', type: 'SCENE' },
            { name: '林凡', type: 'CHARACTER' },
          ],
          dialogue: [{ speaker: '林凡', isNarrator: false, text: '你终于来了。' }],
        },
      ],
    },
  ],
});

const chatOk = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

beforeAll(async () => {
  tdb = await createTestDb();
  project = await tdb.db.project.create({ data: { name: '归因测试项目' } });
  episode = await tdb.db.episode.create({ data: { projectId: project.id, title: '第一集' } });
  draft = await tdb.db.scriptDraft.create({
    data: { episodeId: episode.id, content: SCRIPT, isMain: true },
  });
  registerExecutors();
});
afterAll(async () => {
  await tdb.cleanup();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await tdb.db.modelConfig.deleteMany({});
  await tdb.db.providerConfig.deleteMany({});
});

/** 一挂一好的两家文本厂商，队首必失败 */
async function seedDownThenUp() {
  const db = tdb.db;
  const p1 = await db.providerConfig.create({
    data: { name: '一号（会挂）', vendor: 'openai-compatible', category: 'TEXT', baseUrl: 'https://down.example', apiKey: 'k1', enabled: true },
  });
  const p2 = await db.providerConfig.create({
    data: { name: '二号（正常）', vendor: 'openai-compatible', category: 'TEXT', baseUrl: 'https://up.example', apiKey: 'k2', enabled: true },
  });
  await db.modelConfig.create({
    data: { providerConfigId: p1.id, key: 'doubao-seed-1-6', label: 'D', modality: 'text', capabilityJson: '{}', enabled: true, sortOrder: 0 },
  });
  await db.modelConfig.create({
    data: { providerConfigId: p2.id, key: 'qwen-plus', label: 'Q', modality: 'text', capabilityJson: '{}', enabled: true, sortOrder: 1 },
  });
}

async function newStoryboardJob(input: Record<string, unknown>) {
  return tdb.db.job.create({
    data: {
      projectId: project.id,
      type: 'GENERATE_STORYBOARD',
      executor: 'API',
      status: 'RUNNING',
      inputJson: toJson({ scriptDraftId: draft.id, ...input }),
      modelKey: '自动调度（首选 doubao-seed-1-6）',
    },
  });
}

async function runStoryboardJob(jobId: string) {
  const job = await tdb.db.job.findUniqueOrThrow({ where: { id: jobId } });
  const executor = getExecutor('GENERATE_STORYBOARD')!;
  return executor({ db: tdb.db, job, updateProgress: async () => {} });
}

const modelKeyOf = async (jobId: string) =>
  (await tdb.db.job.findUniqueOrThrow({ where: { id: jobId } })).modelKey;

describe('describeModelUsage', () => {
  it('一次成交只写模型名；转移过则写清是谁顶上、谁失败了', () => {
    expect(describeModelUsage({ key: 'qwen-plus', failedKeys: [] })).toBe('qwen-plus');
    expect(describeModelUsage({ key: 'qwen-plus', failedKeys: ['doubao-seed-1-6'] })).toBe(
      'qwen-plus（doubao-seed-1-6 失败后转移）',
    );
    expect(describeModelUsage({ key: null, failedKeys: ['a', 'b'] })).toBe('全部失败（依次试过 a、b）');
    expect(describeModelUsage({ key: null, failedKeys: [] })).toBe('未调用真实模型（无可用候选）');
  });
});

describe('转移链的成交回执', () => {
  it('首选失败、次选成功 → 回执记次选，并保留失败过的首选', async () => {
    await seedDownThenUp();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).startsWith('https://down.example')) throw new TypeError('fetch failed');
        return chatOk('{"ok":true}');
      }),
    );
    const seen: ModelUsage[] = [];
    const gen = createFailoverTextGen(tdb.db, async () => 'mock', {
      onModelUsed: (u) => void seen.push(u),
    });
    await expect(gen('测试')).resolves.toBe('{"ok":true}');
    expect(seen).toEqual([{ key: 'qwen-plus', failedKeys: ['doubao-seed-1-6'] }]);
  });

  it('全军覆没 → 回执仍留下依次试过谁（否则失败任务历史里查无此人）', async () => {
    await seedDownThenUp();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const seen: ModelUsage[] = [];
    const gen = createFailoverTextGen(tdb.db, async () => 'mock', {
      onModelUsed: (u) => void seen.push(u),
    });
    await expect(gen('测试')).rejects.toThrow(/全部 2 个文本模型调用失败/);
    expect(seen).toEqual([{ key: null, failedKeys: ['doubao-seed-1-6', 'qwen-plus'] }]);
  });

  it('不传 onModelUsed 的调用方（对话式修改/提示词改写）行为原样，不报错', async () => {
    await seedDownThenUp();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).startsWith('https://down.example')) throw new TypeError('fetch failed');
        return chatOk('{"ok":true}');
      }),
    );
    const gen = createFailoverTextGen(tdb.db, async () => 'mock');
    await expect(gen('测试')).resolves.toBe('{"ok":true}');
  });

  it('回执自己抛错也不能把已成功的生成拖成失败', async () => {
    await seedDownThenUp();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).startsWith('https://down.example')) throw new TypeError('fetch failed');
        return chatOk('{"ok":true}');
      }),
    );
    const gen = createFailoverTextGen(tdb.db, async () => 'mock', {
      onModelUsed: async () => {
        throw new Error('记账通道炸了');
      },
    });
    await expect(gen('测试')).resolves.toBe('{"ok":true}');
  });
});

describe('转移链要用加长的超时上限', () => {
  it('timeoutMs 真的透传下去（用一个慢响应验证，而不是只看 signal 存不存在）', async () => {
    // 曾经只有"显式指定模型"那条路调高了上限，转移链漏了 —— 于是自动调度时
    // 千问必定卡在默认 60s 超时，整条链走到底全挂。实测就是这么失败的。
    await seedDownThenUp();
    // 每个候选都慢 150ms 才回应
    const slowFetch = vi.fn(
      (_url: string | URL, init?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(chatOk(STORYBOARD_JSON)), 150);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
          });
        }),
    );
    vi.stubGlobal('fetch', slowFetch);

    // 上限比响应还短 → 每个候选都被掐断，整条链失败
    await expect(
      createFailoverTextGen(tdb.db, async () => 'unused', { timeoutMs: 20 })('hi'),
    ).rejects.toThrow(/全部 .* 个文本模型调用失败/);

    // 上限放宽 → 同样的慢响应能跑完。证明这个值确实被用上了，不是摆设。
    await expect(
      createFailoverTextGen(tdb.db, async () => 'unused', { timeoutMs: 5000 })('hi'),
    ).resolves.toContain('scenes');
  });
});

describe('describeModelUsageHistory：一个任务内的多次调用', () => {
  it('只调一次时与单次描述完全一致（不给常见情况增加噪音）', () => {
    expect(describeModelUsageHistory([{ key: 'qwen-plus', failedKeys: [] }])).toBe('qwen-plus');
  });

  it('调了多次就逐次列出——后写不能覆盖掉已经成功并计费的前一次', () => {
    // 真实场景：第一次 qwen 返回了但 JSON 不可解析（钱已经花了），重试时全挂。
    // 若只记最后一次，账面上是"一次都没成交"，而实际已经烧掉一整篇的 token。
    expect(
      describeModelUsageHistory([
        { key: 'qwen-plus', failedKeys: [] },
        { key: null, failedKeys: ['doubao-seed-1-6', 'qwen-plus'] },
      ]),
    ).toBe('第1次 qwen-plus；第2次 全部失败（依次试过 doubao-seed-1-6、qwen-plus）');
  });
});

describe('modelKey 是结果，重排队时必须跟着清', () => {
  it('failJob 重排队会清掉上一轮的成交记录', async () => {
    const job = await newStoryboardJob({});
    await recordJobModelKey(tdb.db, job.id, '全部失败（依次试过 a、b）');
    await failJob(tdb.db, job.id, '本轮失败');
    const after = await tdb.db.job.findUnique({ where: { id: job.id } });
    // 否则任务面板会同时显示「排队中」和「全部失败…」两个自相矛盾的标签
    expect(after?.status).toBe('QUEUED');
    expect(after?.modelKey).toBeNull();
  });

  it('手动重试同样清掉，新一轮不该背着上一轮的账', async () => {
    const job = await newStoryboardJob({});
    await recordJobModelKey(tdb.db, job.id, 'qwen-plus');
    await failJob(tdb.db, job.id, '致命失败', { fatal: true });
    await retryJob(tdb.db, job.id);
    const after = await tdb.db.job.findUnique({ where: { id: job.id } });
    expect(after?.status).toBe('QUEUED');
    expect(after?.modelKey).toBeNull();
  });
});

describe('recordJobModelKey', () => {
  it('写入实际模型；任务不存在时吞掉错误（记账不该判死生成结果）', async () => {
    const job = await newStoryboardJob({});
    await recordJobModelKey(tdb.db, job.id, 'qwen-plus');
    expect(await modelKeyOf(job.id)).toBe('qwen-plus');
    await expect(recordJobModelKey(tdb.db, 'job-不存在', 'qwen-plus')).resolves.toBeUndefined();
  });
});

describe('GENERATE_STORYBOARD 执行器落到 Job.modelKey 上的真相', () => {
  it('自动调度：首选挂了由次选顶上 → modelKey 改写为次选并注明转移', async () => {
    await seedDownThenUp();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).startsWith('https://down.example')) throw new TypeError('fetch failed');
        return chatOk(STORYBOARD_JSON);
      }),
    );
    const job = await newStoryboardJob({});
    await runStoryboardJob(job.id);
    expect(await modelKeyOf(job.id)).toBe('qwen-plus（doubao-seed-1-6 失败后转移）');
  });

  it('自动调度全挂 → 任务失败，但 modelKey 留下试过谁', async () => {
    await seedDownThenUp();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const job = await newStoryboardJob({});
    await expect(runStoryboardJob(job.id)).rejects.toThrow();
    expect(await modelKeyOf(job.id)).toBe('全部失败（依次试过 doubao-seed-1-6、qwen-plus）');
  });

  it('用户显式指定模型（绕开转移链）→ modelKey 记的就是该模型，不再是 null', async () => {
    await seedDownThenUp();
    const picked = await tdb.db.modelConfig.findFirstOrThrow({ where: { key: 'qwen-plus' } });
    vi.stubGlobal('fetch', vi.fn(async () => chatOk(STORYBOARD_JSON)));
    const job = await newStoryboardJob({ modelConfigId: picked.id });
    await runStoryboardJob(job.id);
    expect(await modelKeyOf(job.id)).toBe('qwen-plus');
  });

  it('显式指定的模型调用失败 → modelKey 也留痕（排查时能看出试过它）', async () => {
    await seedDownThenUp();
    const picked = await tdb.db.modelConfig.findFirstOrThrow({ where: { key: 'doubao-seed-1-6' } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const job = await newStoryboardJob({ modelConfigId: picked.id });
    await expect(runStoryboardJob(job.id)).rejects.toThrow();
    expect(await modelKeyOf(job.id)).toBe('doubao-seed-1-6（指定模型，调用失败）');
  });
});
