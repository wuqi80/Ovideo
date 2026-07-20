// 配音行状态与 Job 状态的对账回归。
// 守的是两笔真实损失：卡死在 GENERATING 的行（语速改不了、重生成锁死、页面无限轮询），
// 以及"中途重排队却显示失败"诱使用户手点重生成导致的重复计费。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '../../test/testdb.js';
import { toJson } from '../../lib/json.js';
import { registerExecutor, clearExecutors } from '../job/registry.js';
import { enqueueJob, cancelJob, failJob, retryJob } from '../job/service.js';
import { startWorker } from '../job/worker.js';
import { recoverDubbingLinesOnStartup } from './job-sync.js';

let t: TestDb;
let db: PrismaClient;
let projectId: string;
let shotId: string;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  const project = await db.project.create({ data: { name: '配音对账测试' } });
  projectId = project.id;
  const episode = await db.episode.create({ data: { projectId, title: '第1集' } });
  const draft = await db.scriptDraft.create({ data: { episodeId: episode.id, isMain: true } });
  const storyboard = await db.storyboard.create({
    data: { episodeId: episode.id, scriptDraftId: draft.id, version: 1 },
  });
  const shot = await db.shot.create({ data: { storyboardId: storyboard.id, sortOrder: 0 } });
  shotId = shot.id;
});

afterAll(async () => {
  await t.cleanup();
});

beforeEach(async () => {
  clearExecutors();
  await db.job.deleteMany({});
  await db.dubbingLine.deleteMany({});
});

/** 一条已被入队方置为 GENERATING 的配音行 + 照看它的 TTS 任务 */
async function seedGeneratingLine(jobOverrides: Record<string, unknown> = {}) {
  const line = await db.dubbingLine.create({ data: { shotId, status: 'GENERATING' } });
  const job = await db.job.create({
    data: {
      projectId,
      type: 'GENERATE_TTS',
      executor: 'API',
      status: 'QUEUED',
      inputJson: toJson({ kind: 'dubbing', dubbingLineId: line.id }),
      ...jobOverrides,
    },
  });
  return { line, job };
}

const statusOf = async (id: string) =>
  (await db.dubbingLine.findUnique({ where: { id } }))?.status;

describe('取消排队中的 TTS 任务', () => {
  it('配音行打回 PENDING，而不是永远卡在 GENERATING', async () => {
    const { line, job } = await seedGeneratingLine();
    await cancelJob(db, job.id);
    // 卡在 GENERATING 的话：语速改不了、单行重生成按钮锁死、页面每 5 秒空轮询
    expect(await statusOf(line.id)).toBe('PENDING');
  });

  it('已经 READY 的行不会被对账覆盖（付费产物只增不删）', async () => {
    const line = await db.dubbingLine.create({ data: { shotId, status: 'READY', durationMs: 1200 } });
    const job = await db.job.create({
      data: {
        projectId,
        type: 'GENERATE_TTS',
        executor: 'API',
        status: 'QUEUED',
        inputJson: toJson({ kind: 'dubbing', dubbingLineId: line.id }),
      },
    });
    await cancelJob(db, job.id);
    expect(await statusOf(line.id)).toBe('READY');
  });
});

describe('失败：中途重排队 vs 终态失败', () => {
  it('未耗尽 attempts 的重排队【不】把行置 FAILED——否则用户会去点重生成，同一行付两遍钱', async () => {
    const { line, job } = await seedGeneratingLine({ status: 'RUNNING', attempts: 1, maxAttempts: 2 });
    const after = await failJob(db, job.id, '厂商侧偶发 500');
    expect(after.status).toBe('QUEUED');
    expect(await statusOf(line.id)).toBe('GENERATING');
  });

  it('重试耗尽的终态失败才把行置 FAILED', async () => {
    const { line, job } = await seedGeneratingLine({ status: 'RUNNING', attempts: 2, maxAttempts: 2 });
    const after = await failJob(db, job.id, '一直失败');
    expect(after.status).toBe('FAILED');
    expect(await statusOf(line.id)).toBe('FAILED');
  });

  it('手动重试把行拉回 GENERATING，与重新排上队的任务一致', async () => {
    const { line, job } = await seedGeneratingLine({ status: 'RUNNING', attempts: 2, maxAttempts: 2 });
    await failJob(db, job.id, '一直失败');
    await retryJob(db, job.id);
    expect(await statusOf(line.id)).toBe('GENERATING');
  });
});

describe('worker 走完重试链路后的行状态（端到端）', () => {
  it('执行器第一次抛错只是重排队，行全程不显示失败；耗尽后才 FAILED', async () => {
    const seen: (string | undefined)[] = [];
    const { line, job } = await seedGeneratingLine({ maxAttempts: 2 });
    registerExecutor('GENERATE_TTS', async () => {
      seen.push(await statusOf(line.id));
      throw new Error('TTS 挂了');
    });

    const worker = startWorker(db, { intervalMs: 20 });
    try {
      const start = Date.now();
      while (Date.now() - start < 25000) {
        if ((await db.job.findUnique({ where: { id: job.id } }))?.status === 'FAILED') break;
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      await worker.stop();
    }

    expect(seen).toHaveLength(2);
    // 第二次进执行器时，行仍应是 GENERATING——中途重排队从未让用户看到「失败」
    expect(seen[1]).toBe('GENERATING');
    expect(await statusOf(line.id)).toBe('FAILED');
  });
});

describe('进程重启后的启动清扫', () => {
  it('被中断的在跑任务：行置 FAILED（可能已在厂商侧计费，不能显示成没生成过）', async () => {
    const { line, job } = await seedGeneratingLine({ status: 'RUNNING' });
    const interrupted = await db.job.findMany({
      where: { id: job.id },
      select: { type: true, inputJson: true },
    });
    await db.job.update({ where: { id: job.id }, data: { status: 'FAILED' } });
    await recoverDubbingLinesOnStartup(db, interrupted);
    expect(await statusOf(line.id)).toBe('FAILED');
  });

  it('无任何在途任务照看的 GENERATING 行：打回 PENDING', async () => {
    // 任务已 CANCELED（或压根没落库），行却还挂着入队时写下的 GENERATING
    const { line, job } = await seedGeneratingLine();
    await db.job.update({ where: { id: job.id }, data: { status: 'CANCELED' } });
    await recoverDubbingLinesOnStartup(db, []);
    expect(await statusOf(line.id)).toBe('PENDING');
  });

  it('仍有 QUEUED 任务照看的行不许被清扫误伤', async () => {
    const { line } = await seedGeneratingLine();
    await recoverDubbingLinesOnStartup(db, []);
    expect(await statusOf(line.id)).toBe('GENERATING');
  });

  it('worker 启动时自动完成清扫（不必等用户手点任何按钮）', async () => {
    const line = await db.dubbingLine.create({ data: { shotId, status: 'GENERATING' } });
    const worker = startWorker(db, { intervalMs: 20 });
    try {
      const start = Date.now();
      while (Date.now() - start < 25000) {
        if ((await statusOf(line.id)) === 'PENDING') break;
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      await worker.stop();
    }
    expect(await statusOf(line.id)).toBe('PENDING');
  });
});

describe('非 TTS 任务不受影响', () => {
  it('取消一个图像任务不会碰任何配音行', async () => {
    const line = await db.dubbingLine.create({ data: { shotId, status: 'GENERATING' } });
    const job = await enqueueJob(db, {
      projectId,
      type: 'GENERATE_IMAGE',
      inputPayload: { kind: 'keyframe', shotId },
    });
    await cancelJob(db, job.id);
    expect(await statusOf(line.id)).toBe('GENERATING');
  });
});
