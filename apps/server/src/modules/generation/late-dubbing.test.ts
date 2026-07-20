import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Job, PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '../../test/testdb.js';
import { STORAGE_ROOT } from '../../lib/storage.js';
import { toJson } from '../../lib/json.js';
import { getExecutor, clearExecutors } from '../job/registry.js';
import { registerGenerationExecutors, type GenerationGens } from './executors.js';
import { mockTtsGen } from './gens.js';
import { alsoWriteDubbingToCurrentVersion, DUBBING_GAP_MS } from './late-dubbing.js';

let t: TestDb;
let db: PrismaClient;
let projectId: string;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  const project = await db.project.create({ data: { name: '迟到配音写回测试项目' } });
  projectId = project.id;
});

afterAll(async () => {
  await t.cleanup();
  fs.rmSync(path.join(STORAGE_ROOT, projectId), { recursive: true, force: true });
});

beforeEach(() => {
  clearExecutors();
});

/** 写回函数需要的形状（executors 里 findUnique 已 include shot.storyboard） */
async function loadLine(lineId: string) {
  const line = await db.dubbingLine.findUnique({
    where: { id: lineId },
    include: { shot: { include: { storyboard: true } } },
  });
  return line!;
}

/**
 * 造一个"TTS 生成期间用户改了分镜"的现场：v1 的镜头上挂着入队时那条配音行，
 * newer=true 时再出一个 v2——v2 里的同血脉行就是当前版本正停在 GENERATING 的那一句。
 */
async function seed(
  opts: {
    newer?: boolean;
    lineage?: 'inherit' | 'broken';
    /** 当前版本那一行的状态：用户自己重生成过就会是 READY */
    newStatus?: string;
  } = {},
) {
  const { newer = true, lineage = 'inherit', newStatus = 'GENERATING' } = opts;
  const episode = await db.episode.create({ data: { projectId, title: '测试集' } });
  const draft = await db.scriptDraft.create({ data: { episodeId: episode.id, isMain: true } });
  const sb1 = await db.storyboard.create({
    data: { episodeId: episode.id, scriptDraftId: draft.id, version: 1 },
  });
  const oldShot = await db.shot.create({
    data: { storyboardId: sb1.id, sortOrder: 0, sourceText: '男主走进教室', durationPlannedMs: 3000 },
  });
  await db.shot.update({ where: { id: oldShot.id }, data: { lineageId: oldShot.id } });
  const oldDlg = await db.dialogueLine.create({
    data: { shotId: oldShot.id, text: '你终于来了', sortOrder: 0 },
  });
  const oldLine = await db.dubbingLine.create({
    data: { shotId: oldShot.id, dialogueLineId: oldDlg.id, status: 'GENERATING' },
  });
  await db.dubbingLine.update({ where: { id: oldLine.id }, data: { lineageId: oldLine.id } });

  let sb2 = null;
  let newShot = null;
  let newLine = null;
  if (newer) {
    sb2 = await db.storyboard.create({
      data: { episodeId: episode.id, scriptDraftId: draft.id, version: 2 },
    });
    newShot = await db.shot.create({
      data: {
        storyboardId: sb2.id,
        sortOrder: 0,
        sourceText: '男主走进教室',
        durationPlannedMs: 3000,
        lineageId: oldShot.id,
      },
    });
    const newDlg = await db.dialogueLine.create({
      data: { shotId: newShot.id, text: '你终于来了', sortOrder: 0 },
    });
    newLine = await db.dubbingLine.create({
      data: {
        shotId: newShot.id,
        dialogueLineId: newDlg.id,
        status: newStatus,
        // broken：分镜整个重生成，血脉换了代，旧音频无处可写
        lineageId: lineage === 'broken' ? null : oldLine.id,
      },
    });
  }

  const asset = await db.asset.create({
    data: {
      projectId,
      type: 'AUDIO',
      source: 'GENERATED',
      uri: `/storage/${projectId}/late.wav`,
      durationMs: 8200,
    },
  });
  return { episode, sb1, sb2, oldShot, oldLine: await loadLine(oldLine.id), newShot, newLine, asset };
}

describe('alsoWriteDubbingToCurrentVersion', () => {
  it('音频所在版本就是当前版本：不产生额外写入，也不去查血脉', async () => {
    const { oldLine, asset } = await seed({ newer: false });
    let lineageLookups = 0;
    let writes = 0;
    const spy = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'dubbingLine') return Reflect.get(target, prop, receiver);
        return new Proxy(target.dubbingLine, {
          get(dTarget, dProp, dRecv) {
            if (dProp === 'findFirst') {
              return async (...args: unknown[]) => {
                lineageLookups += 1;
                return (dTarget.findFirst as (...a: unknown[]) => unknown)(...args);
              };
            }
            if (dProp === 'update') {
              return async (...args: unknown[]) => {
                writes += 1;
                return (dTarget.update as (...a: unknown[]) => unknown)(...args);
              };
            }
            return Reflect.get(dTarget, dProp, dRecv);
          },
        });
      },
    }) as PrismaClient;

    await alsoWriteDubbingToCurrentVersion(spy, oldLine, asset.id, 8200);

    expect(lineageLookups).toBe(0);
    expect(writes).toBe(0);
  });

  it('跨版本且同血脉行仍在 GENERATING：音频与时长锁都补到当前版本', async () => {
    const { newShot, newLine, oldLine, asset } = await seed();

    await alsoWriteDubbingToCurrentVersion(db, oldLine, asset.id, 8200);

    const after = await db.dubbingLine.findUnique({ where: { id: newLine!.id } });
    expect(after?.status).toBe('READY');
    expect(after?.audioAssetId).toBe(asset.id);
    expect(after?.durationMs).toBe(8200);
    // 缺陷 2：时长锁必须落在新版本的镜头上，否则"待重生成"面板一片绿
    const shotAfter = await db.shot.findUnique({ where: { id: newShot!.id } });
    expect(shotAfter?.durationLockedMs).toBe(8200);
    // 8.2s 台词 vs 3s 计划时长，偏差远超 500ms → 视频必须标 stale
    expect(shotAfter?.videoStale).toBe(true);
  });

  it('跨版本但当前版本那行已 READY：不覆盖人的选择，留日志', async () => {
    const { newLine, oldLine, asset } = await seed({ newStatus: 'READY' });
    const mine = await db.asset.create({
      data: { projectId, type: 'AUDIO', source: 'GENERATED', uri: `/storage/${projectId}/mine.wav` },
    });
    // 这几分钟里用户自己又重新生成过一次，那一份才是他要的
    await db.dubbingLine.update({
      where: { id: newLine!.id },
      data: { audioAssetId: mine.id, durationMs: 4100 },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await alsoWriteDubbingToCurrentVersion(db, oldLine, asset.id, 8200);

    const after = await db.dubbingLine.findUnique({ where: { id: newLine!.id } });
    expect(after?.audioAssetId).toBe(mine.id);
    expect(after?.durationMs).toBe(4100);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('已 READY，不覆盖');
    warn.mockRestore();
  });

  it('血脉断代：不写、不报错', async () => {
    const { newLine, oldLine, asset } = await seed({ lineage: 'broken' });
    await expect(
      alsoWriteDubbingToCurrentVersion(db, oldLine, asset.id, 8200),
    ).resolves.toBeUndefined();
    const after = await db.dubbingLine.findUnique({ where: { id: newLine!.id } });
    expect(after?.status).toBe('GENERATING');
    expect(after?.audioAssetId).toBeNull();
  });

  it('幂等：重复调用不产生第二次写入', async () => {
    const { newLine, oldLine, asset } = await seed();
    await alsoWriteDubbingToCurrentVersion(db, oldLine, asset.id, 8200);
    let writes = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'dubbingLine') return Reflect.get(target, prop, receiver);
        return new Proxy(target.dubbingLine, {
          get(dTarget, dProp, dRecv) {
            if (dProp !== 'update') return Reflect.get(dTarget, dProp, dRecv);
            return async (...args: unknown[]) => {
              writes += 1;
              return (dTarget.update as (...a: unknown[]) => unknown)(...args);
            };
          },
        });
      },
    }) as PrismaClient;

    await alsoWriteDubbingToCurrentVersion(counting, oldLine, asset.id, 8200);

    expect(writes).toBe(0);
    const after = await db.dubbingLine.findUnique({ where: { id: newLine!.id } });
    expect(after?.audioAssetId).toBe(asset.id);
  });

  it('写回刚写完又出了新版本：再追一轮，音频不会停在已经退位的那一版', async () => {
    // applyPatch 是"事务内先读全部 base.dubbingLines、再逐条复制"，大分镜要跑几秒。
    // 我们的 update 若落在它读完之后、复制完之前，新版本复制到的仍是 GENERATING 的旧值。
    const { episode, oldLine, newLine, asset } = await seed();
    const draft = await db.scriptDraft.findFirst({ where: { episodeId: episode.id } });

    let line3Id: string | null = null;
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'dubbingLine') return Reflect.get(target, prop, receiver);
        return new Proxy(target.dubbingLine, {
          get(dTarget, dProp, dRecv) {
            if (dProp !== 'update') return Reflect.get(dTarget, dProp, dRecv);
            return async (args: Parameters<typeof db.dubbingLine.update>[0]) => {
              const updated = await db.dubbingLine.update(args);
              if (line3Id === null) {
                const sb3 = await db.storyboard.create({
                  data: { episodeId: episode.id, scriptDraftId: draft!.id, version: 3 },
                });
                const s3 = await db.shot.create({
                  data: {
                    storyboardId: sb3.id,
                    sortOrder: 0,
                    sourceText: '男主走进教室',
                    lineageId: (await db.dubbingLine.findUnique({ where: { id: newLine!.id } }))!
                      .shotId,
                  },
                });
                const l3 = await db.dubbingLine.create({
                  data: { shotId: s3.id, status: 'GENERATING', lineageId: oldLine.id },
                });
                line3Id = l3.id;
              }
              return updated;
            };
          },
        });
      },
    }) as PrismaClient;

    await alsoWriteDubbingToCurrentVersion(racing, oldLine, asset.id, 8200);

    const v3 = await db.dubbingLine.findUnique({ where: { id: line3Id! } });
    expect(v3?.status).toBe('READY');
    expect(v3?.audioAssetId).toBe(asset.id);
  });
});

/** 图/视频写占位文件即可；TTS 必须产出真能被 ffprobe 读出时长的音频（时长链路是本次断言重点） */
function fakeGens(): GenerationGens {
  return {
    imageGen: async (args) => fs.writeFileSync(args.outPath, 'fake-png'),
    videoGen: async (args) => fs.writeFileSync(args.outPath, 'fake-mp4'),
    ttsGen: mockTtsGen,
  };
}

async function makeCtx(type: string, input: unknown) {
  const job: Job = await db.job.create({
    data: { projectId, type, status: 'RUNNING', inputJson: toJson(input) },
  });
  return { db, job, updateProgress: async () => {} };
}

describe('TTS 执行器：生成期间版本翻篇', () => {
  it('音频同时落在原版本与当前版本，两侧时长锁都跟上', async () => {
    registerGenerationExecutors(fakeGens());
    const { oldLine, newLine, oldShot, newShot } = await seed();

    const result = await getExecutor('GENERATE_TTS')!(
      await makeCtx('GENERATE_TTS', { kind: 'dubbing', dubbingLineId: oldLine.id }),
    );
    const assetId = result.outputAssetIds![0];

    const oldAfter = await db.dubbingLine.findUnique({ where: { id: oldLine.id } });
    const newAfter = await db.dubbingLine.findUnique({ where: { id: newLine!.id } });
    expect(oldAfter?.audioAssetId).toBe(assetId);
    // 缺陷 1：修复前这里是 null、status 停在 GENERATING，成片里这句台词静默丢失
    expect(newAfter?.audioAssetId).toBe(assetId);
    expect(newAfter?.status).toBe('READY');

    // 缺陷 2：两侧镜头的时长锁一致（单行，无行间间隔）
    const dur = newAfter!.durationMs!;
    expect((await db.shot.findUnique({ where: { id: oldShot.id } }))?.durationLockedMs).toBe(dur);
    expect((await db.shot.findUnique({ where: { id: newShot!.id } }))?.durationLockedMs).toBe(dur);
  });

  it('当前版本还有另一条已就绪的行：时长锁按两行之和 + 行间间隔算', async () => {
    registerGenerationExecutors(fakeGens());
    const { oldLine, newShot } = await seed();
    await db.dubbingLine.create({
      data: { shotId: newShot!.id, status: 'READY', durationMs: 1000, lineageId: 'other-lineage' },
    });

    const result = await getExecutor('GENERATE_TTS')!(
      await makeCtx('GENERATE_TTS', { kind: 'dubbing', dubbingLineId: oldLine.id }),
    );
    const dur = (result.output as { durationMs: number }).durationMs;

    const shotAfter = await db.shot.findUnique({ where: { id: newShot!.id } });
    expect(shotAfter?.durationLockedMs).toBe(dur + 1000 + DUBBING_GAP_MS);
  });

  it('写回过程抛错时 TTS 照常算成功（音频已产出并计费）', async () => {
    registerGenerationExecutors(fakeGens());
    const { oldLine } = await seed();
    const ctx = await makeCtx('GENERATE_TTS', { kind: 'dubbing', dubbingLineId: oldLine.id });
    // 只有跨版本写回会查 storyboard.findFirst，借此精准注入故障
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getExecutor('GENERATE_TTS')!({ ...ctx, db: brokenDb });

    expect(result.outputAssetIds?.length).toBe(1);
    // 原版本那一行照常就绪，任务不算失败
    expect((await db.dubbingLine.findUnique({ where: { id: oldLine.id } }))?.status).toBe('READY');
    warn.mockRestore();
  });
});

describe('applyPatch 复制配音行时的血脉继承', () => {
  it('新版本的配音行继承基底血脉，存量行以自身 id 开锚', async () => {
    const { oldLine, oldShot, sb1, episode } = await seed({ newer: false });
    const { applyPatch } = await import('../storyboard/service.js');
    const { findOrCreateTags } = await import('../tag/service.js');
    const draft = await db.scriptDraft.findFirst({ where: { episodeId: episode.id } });

    const next = await applyPatch(db, {
      episodeId: episode.id,
      scriptDraftId: draft!.id,
      baseStoryboardId: sb1.id,
      source: 'test',
      resolveTags: (tags) => findOrCreateTags(db, projectId, tags),
      patch: [{ op: 'update_shot', shotId: oldShot.id, fields: { imagePrompt: '改个提示词' } }],
    });

    const copied = await db.dubbingLine.findFirst({
      where: { shot: { storyboardId: next.storyboard.id } },
    });
    expect(copied).not.toBeNull();
    expect(copied!.id).not.toBe(oldLine.id);
    expect(copied!.lineageId).toBe(oldLine.id);
  });
});
