import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Job, PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '../../test/testdb.js';
import { STORAGE_ROOT } from '../../lib/storage.js';
import { toJson } from '../../lib/json.js';
import { getExecutor, clearExecutors } from '../job/registry.js';
import { registerGenerationExecutors, type GenerationGens } from './executors.js';
import { alsoAttachToCurrentVersion } from './late-take.js';

let t: TestDb;
let db: PrismaClient;
let projectId: string;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  const project = await db.project.create({ data: { name: '迟到产物补挂测试项目' } });
  projectId = project.id;
});

afterAll(async () => {
  await t.cleanup();
  fs.rmSync(path.join(STORAGE_ROOT, projectId), { recursive: true, force: true });
});

beforeEach(() => {
  clearExecutors();
});

/** loadShot 的返回形状（storyboard 已 include），补挂函数只用这几个字段 */
async function loadShot(shotId: string) {
  const shot = await db.shot.findUnique({ where: { id: shotId }, include: { storyboard: true } });
  return shot!;
}

/**
 * 造一个"生成期间用户改了分镜"的现场：v1 有镜头（产物挂在它上面），
 * newer=true 时再出一个 v2，v2 里的同血脉镜头就是产物本该出现的地方。
 */
async function seed(opts: { newer: boolean; lineage?: 'inherit' | 'broken' | 'null' } = { newer: true }) {
  const episode = await db.episode.create({ data: { projectId, title: '测试集' } });
  const draft = await db.scriptDraft.create({ data: { episodeId: episode.id, isMain: true } });
  const sb1 = await db.storyboard.create({
    data: { episodeId: episode.id, scriptDraftId: draft.id, version: 1 },
  });
  const oldShot = await db.shot.create({
    data: { storyboardId: sb1.id, sortOrder: 0, sourceText: '男主走进教室' },
  });
  if (opts.lineage !== 'null') {
    await db.shot.update({ where: { id: oldShot.id }, data: { lineageId: oldShot.id } });
  }

  let sb2 = null;
  let newShot = null;
  if (opts.newer) {
    sb2 = await db.storyboard.create({
      data: { episodeId: episode.id, scriptDraftId: draft.id, version: 2 },
    });
    newShot = await db.shot.create({
      data: {
        storyboardId: sb2.id,
        sortOrder: 0,
        sourceText: '男主走进教室',
        // broken：分镜整个重生成，血脉换了代，旧产物无处可挂
        lineageId: opts.lineage === 'broken' ? null : oldShot.id,
      },
    });
  }

  const asset = await db.asset.create({
    data: { projectId, type: 'IMAGE', source: 'GENERATED', uri: `/storage/${projectId}/late.png` },
  });
  return { episode, sb1, sb2, oldShot: await loadShot(oldShot.id), newShot, asset };
}

describe('alsoAttachToCurrentVersion', () => {
  it('产物所在版本就是当前版本：不新增 Take，也不去查血脉', async () => {
    const { oldShot, asset } = await seed({ newer: false });
    let lineageLookups = 0;
    const spy = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'shot') {
          return {
            findFirst: async (...args: unknown[]) => {
              lineageLookups += 1;
              return (target.shot.findFirst as (...a: unknown[]) => unknown)(...args);
            },
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaClient;

    const takeId = await alsoAttachToCurrentVersion(spy, oldShot, 'KEYFRAME', asset.id, null);

    expect(takeId).toBeNull();
    expect(lineageLookups).toBe(0);
    expect(await db.take.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it('跨版本且有同血脉镜头：当前版本多出一条指向同资产的 Take，且不动 selected 指针', async () => {
    const { oldShot, newShot, asset } = await seed({ newer: true });
    // 这几分钟里用户已经手动选了别的 take —— 补挂绝不能覆盖这个选择
    const otherAsset = await db.asset.create({
      data: { projectId, type: 'IMAGE', source: 'GENERATED', uri: `/storage/${projectId}/x.png` },
    });
    const otherTake = await db.take.create({
      data: { shotId: newShot!.id, slot: 'KEYFRAME', assetId: otherAsset.id },
    });
    await db.shot.update({
      where: { id: newShot!.id },
      data: { keyframeSelectedTakeId: otherTake.id, videoSelectedTakeId: otherTake.id },
    });

    const takeId = await alsoAttachToCurrentVersion(db, oldShot, 'KEYFRAME', asset.id, null);

    expect(takeId).not.toBeNull();
    const created = await db.take.findUnique({ where: { id: takeId! } });
    expect(created?.shotId).toBe(newShot!.id);
    expect(created?.assetId).toBe(asset.id);
    expect(created?.slot).toBe('KEYFRAME');
    // 原版本上的那份不受影响（不是搬走，是两边都有）
    const after = await db.shot.findUnique({ where: { id: newShot!.id } });
    expect(after?.keyframeSelectedTakeId).toBe(otherTake.id);
    expect(after?.videoSelectedTakeId).toBe(otherTake.id);
  });

  it('补挂刚写完又出了新版本：再追一轮，产物不会停在已经退位的那一版', async () => {
    // applyPatch 是"事务内先读全部 base.takes、再逐条复制"，大分镜要跑几秒。
    // 我们的 create 若正好落在它读完之后、复制之前，新版本照样拿不到——
    // 那就是这次要修的 bug 本身，只是窗口从几分钟缩到几秒。所以补完要再确认一次。
    const { episode, oldShot, newShot, asset } = await seed({ newer: true });
    const draft = await db.scriptDraft.findFirst({ where: { episodeId: episode.id } });

    // 模拟并发：我们刚往 v2 写完 take，用户的编辑就把 v3 造了出来
    let shot3Id: string | null = null;
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'take') return Reflect.get(target, prop, receiver);
        return new Proxy(target.take, {
          get(tTarget, tProp, tRecv) {
            if (tProp !== 'create') return Reflect.get(tTarget, tProp, tRecv);
            return async (args: Parameters<typeof db.take.create>[0]) => {
              const created = await db.take.create(args);
              if (shot3Id === null) {
                const sb3 = await db.storyboard.create({
                  data: { episodeId: episode.id, scriptDraftId: draft!.id, version: 3 },
                });
                const s3 = await db.shot.create({
                  data: {
                    storyboardId: sb3.id,
                    sortOrder: 0,
                    sourceText: '男主走进教室',
                    lineageId: oldShot.id,
                  },
                });
                shot3Id = s3.id;
              }
              return created;
            };
          },
        });
      },
    }) as typeof db;

    await alsoAttachToCurrentVersion(racing, oldShot, 'VIDEO', asset.id, null);

    // v2 是写入当时的最新版；v3 是写完才诞生的，靠再追一轮才补上
    expect(await db.take.count({ where: { shotId: newShot!.id, assetId: asset.id } })).toBe(1);
    expect(shot3Id).not.toBeNull();
    expect(await db.take.count({ where: { shotId: shot3Id!, assetId: asset.id } })).toBe(1);
    // 依然不碰任何人的选择
    const after = await db.shot.findUnique({ where: { id: shot3Id! } });
    expect(after?.videoSelectedTakeId).toBeNull();
  });

  it('跨版本但当前版本没有同血脉镜头：不新增、不报错', async () => {
    const { oldShot, newShot, asset } = await seed({ newer: true, lineage: 'broken' });
    expect(await alsoAttachToCurrentVersion(db, oldShot, 'VIDEO', asset.id, null)).toBeNull();
    expect(await db.take.count({ where: { shotId: newShot!.id } })).toBe(0);
  });

  it('产物所在镜头没有 lineageId（存量行）：不新增、不报错', async () => {
    const { oldShot, newShot, asset } = await seed({ newer: true, lineage: 'null' });
    expect(await alsoAttachToCurrentVersion(db, oldShot, 'VIDEO', asset.id, null)).toBeNull();
    expect(await db.take.count({ where: { shotId: newShot!.id } })).toBe(0);
  });

  it('幂等：重复调用不产生第二条', async () => {
    const { oldShot, newShot, asset } = await seed({ newer: true });
    const first = await alsoAttachToCurrentVersion(db, oldShot, 'VIDEO', asset.id, null);
    const second = await alsoAttachToCurrentVersion(db, oldShot, 'VIDEO', asset.id, null);
    expect(second).toBe(first);
    expect(await db.take.count({ where: { shotId: newShot!.id, assetId: asset.id } })).toBe(1);
  });
});

/** 写占位文件即可（这些用例只关心 Take 落在哪，不碰真实生成） */
function fakeGens(): GenerationGens {
  return {
    imageGen: async (args) => fs.writeFileSync(args.outPath, 'fake-png'),
    videoGen: async (args) => fs.writeFileSync(args.outPath, 'fake-mp4'),
    ttsGen: async (args) => fs.writeFileSync(args.outPath, 'fake-wav'),
  };
}

async function makeCtx(type: string, input: unknown) {
  const job: Job = await db.job.create({
    data: { projectId, type, status: 'RUNNING', inputJson: toJson(input) },
  });
  return { db, job, updateProgress: async () => {} };
}

describe('关键图执行器：生成期间版本翻篇', () => {
  it('产物同时留在原版本并补挂到当前版本，原版本的首个 take 仍自动选中', async () => {
    registerGenerationExecutors(fakeGens());
    const { oldShot, newShot } = await seed({ newer: true });

    const result = await getExecutor('GENERATE_IMAGE')!(
      await makeCtx('GENERATE_IMAGE', { kind: 'keyframe', shotId: oldShot.id }),
    );
    const assetId = result.outputAssetIds![0];

    const takes = await db.take.findMany({ where: { assetId } });
    expect(takes.map((t) => t.shotId).sort()).toEqual([oldShot.id, newShot!.id].sort());
    const oldAfter = await db.shot.findUnique({ where: { id: oldShot.id } });
    // 原版本"首个 take 自动选中"的既有语义不变；当前版本那条不自动选中
    expect(oldAfter?.keyframeSelectedTakeId).toBe((result.output as { takeId: string }).takeId);
    const newAfter = await db.shot.findUnique({ where: { id: newShot!.id } });
    expect(newAfter?.keyframeSelectedTakeId).toBeNull();
  });

  it('补挂过程抛错时生成照常算成功（产物已产出并计费）', async () => {
    registerGenerationExecutors(fakeGens());
    const { oldShot } = await seed({ newer: true });
    const ctx = await makeCtx('GENERATE_IMAGE', { kind: 'keyframe', shotId: oldShot.id });
    // 只有补挂函数会查 storyboard.findFirst，借此精准注入故障
    const brokenDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'storyboard') {
          return {
            findFirst: async () => {
              throw new Error('数据库炸了');
            },
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaClient;

    const result = await getExecutor('GENERATE_IMAGE')!({ ...ctx, db: brokenDb });

    expect(result.outputAssetIds?.length).toBe(1);
    expect(await db.take.count({ where: { assetId: result.outputAssetIds![0] } })).toBe(1);
  });
});
