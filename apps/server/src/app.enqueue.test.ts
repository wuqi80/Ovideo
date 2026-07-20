// 入队时的模型标签回填。
// 从前这段写入只长在"自动调度"分支里：同一个任务面板，不选模型的任务有模型标签、
// 显式选了模型的反而没有——而用户最想知道"这次到底用了哪个"的恰恰是后者。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from './test/testdb.js';
import { buildApp } from './app.js';

let t: TestDb;
let db: PrismaClient;
let app: FastifyInstance;
let projectId: string;
let shotId: string;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  const project = await db.project.create({ data: { name: '入队标签测试' } });
  projectId = project.id;
  const episode = await db.episode.create({ data: { projectId, title: '第1集' } });
  const draft = await db.scriptDraft.create({ data: { episodeId: episode.id, isMain: true } });
  const storyboard = await db.storyboard.create({
    data: { episodeId: episode.id, scriptDraftId: draft.id, version: 1 },
  });
  const shot = await db.shot.create({
    data: { storyboardId: storyboard.id, sortOrder: 0, sourceText: '男主走进教室' },
  });
  shotId = shot.id;
  app = await buildApp({ db });
});

afterAll(async () => {
  await app.close();
  await t.cleanup();
});

async function seedModel(category: string, modality: string, key: string, enabled = true) {
  const provider = await db.providerConfig.create({
    data: {
      name: `厂商-${key}`,
      vendor: 'openai-compatible',
      category,
      baseUrl: 'https://example.test',
      apiKey: 'k',
      enabled: true,
    },
  });
  return db.modelConfig.create({
    data: { providerConfigId: provider.id, key, label: key, modality, enabled, capabilityJson: '{}' },
  });
}

const latestJob = async () =>
  db.job.findFirstOrThrow({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });

describe('显式指定模型的任务同样带上模型标签', () => {
  it('关键图：providerConfigId 与 modelKey 都写入（从前两个都是 null）', async () => {
    const model = await seedModel('IMAGE', 'image', 'seedream-4-0-explicit');
    const res = await app.inject({
      method: 'POST',
      url: `/api/shots/${shotId}/generate-keyframe`,
      payload: { modelConfigId: model.id },
    });
    expect(res.statusCode).toBe(202);
    const job = await latestJob();
    expect(job.type).toBe('GENERATE_IMAGE');
    expect(job.modelKey).toBe('seedream-4-0-explicit');
    expect(job.providerConfigId).toBe(model.providerConfigId);
    // 显式指定即走真实厂商调用，执行器类型同自动调度
    expect(job.executor).toBe('API');
  });

  it('视频：同样写入（视频是最贵的一类，任务面板不该查无此模型）', async () => {
    const model = await seedModel('VIDEO', 'video', 'seedance-explicit');
    // 视频路由要求镜头已有选定关键图
    const keyframe = await db.asset.create({
      data: { projectId, type: 'IMAGE', source: 'UPLOADED', uri: `/storage/${projectId}/kf.png` },
    });
    const take = await db.take.create({
      data: { shotId, slot: 'KEYFRAME', assetId: keyframe.id },
    });
    await db.shot.update({ where: { id: shotId }, data: { keyframeSelectedTakeId: take.id } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/shots/${shotId}/generate-video`,
      payload: { modelConfigId: model.id },
    });
    expect(res.statusCode).toBe(202);
    const job = await latestJob();
    expect(job.type).toBe('GENERATE_VIDEO');
    expect(job.modelKey).toBe('seedance-explicit');
    expect(job.providerConfigId).toBe(model.providerConfigId);
  });

  it('模型 id 指向不存在的行：不写标签也不炸，任务照常入队', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/shots/${shotId}/generate-keyframe`,
      payload: { modelConfigId: 'no-such-model' },
    });
    expect(res.statusCode).toBe(202);
    const job = await latestJob();
    expect(job.modelKey).toBeNull();
  });
});

describe('自动调度分支的既有行为不变', () => {
  it('不指定模型 → 按模态选队首真实模型，标签与 payload 都补上', async () => {
    await db.modelConfig.deleteMany({});
    await db.providerConfig.deleteMany({});
    const model = await seedModel('IMAGE', 'image', 'seedream-auto');
    const res = await app.inject({
      method: 'POST',
      url: `/api/shots/${shotId}/generate-keyframe`,
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    const job = await latestJob();
    expect(job.modelKey).toBe('seedream-auto');
    expect(job.providerConfigId).toBe(model.providerConfigId);
  });
});
