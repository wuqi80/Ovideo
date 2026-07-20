import type { PrismaClient, Job } from '@prisma/client';
import {
  JobTypeSchema,
  JobExecutorKindSchema,
  type JobType,
  type JobExecutorKind,
} from '@ovideo/shared';
import { toJson } from '../../lib/json.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { JobExecutorResult } from './registry.js';

export interface EnqueueJobInput {
  projectId: string;
  type: JobType;
  executor?: JobExecutorKind;
  inputPayload: unknown;
  providerConfigId?: string;
  modelKey?: string;
  batchId?: string;
  maxAttempts?: number;
}

export async function enqueueJob(db: PrismaClient, input: EnqueueJobInput): Promise<Job> {
  return db.job.create({
    data: {
      projectId: input.projectId,
      type: JobTypeSchema.parse(input.type),
      executor: JobExecutorKindSchema.parse(input.executor ?? 'LOCAL'),
      inputJson: toJson(input.inputPayload ?? {}),
      providerConfigId: input.providerConfigId,
      modelKey: input.modelKey,
      batchId: input.batchId,
      maxAttempts: input.maxAttempts,
    },
  });
}

/**
 * 回填"实际是哪个模型干完的"。入队时写的是意图（首选谁），跑完才知道真相——
 * 转移链换过人、或用户显式指定的那条路径，都靠这次回填让成本归因落到真花钱的那家头上。
 * 记账是旁路：这次 update 自己抛错（比如任务已被清理）绝不能把一个本已成功的生成任务判死，
 * 所以在此吞掉并落警告，由调用方继续按生成结果本身决定成败。
 */
export async function recordJobModelKey(db: PrismaClient, jobId: string, modelKey: string): Promise<void> {
  try {
    await db.job.update({ where: { id: jobId }, data: { modelKey } });
  } catch (err) {
    console.warn(
      `[job] 回填 modelKey 失败（不影响任务结果）jobId=${jobId} modelKey=${modelKey}：`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * 事务内领取最早的 QUEUED 任务：置 RUNNING、attempts+1、startedAt 落值。
 * SQLite 下 Prisma 事务串行执行，同进程多路领取不会拿到同一条。队列空返回 null。
 */
export async function claimNextJob(db: PrismaClient): Promise<Job | null> {
  return db.$transaction(async (tx) => {
    const next = await tx.job.findFirst({
      where: { status: 'QUEUED' },
      // id 作 tiebreaker：同毫秒入队时仍保持稳定的先进先出
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!next) return null;
    return tx.job.update({
      where: { id: next.id },
      data: { status: 'RUNNING', attempts: next.attempts + 1, startedAt: new Date(), error: null },
    });
  });
}

export async function completeJob(db: PrismaClient, jobId: string, result: JobExecutorResult): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('任务');
  return db.job.update({
    where: { id: jobId },
    data: {
      status: 'SUCCEEDED',
      progress: 100,
      outputJson: toJson({ outputAssetIds: result.outputAssetIds ?? [], output: result.output ?? null }),
      error: null,
      finishedAt: new Date(),
    },
  });
}

/**
 * 执行失败：attempts 未耗尽回 QUEUED 等待再次领取（错误留档供面板展示），
 * 耗尽或 fatal（如无执行器，重试无意义）则置 FAILED。
 */
export async function failJob(
  db: PrismaClient,
  jobId: string,
  errMsg: string,
  opts: { fatal?: boolean } = {},
): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('任务');
  if (!opts.fatal && job.attempts < job.maxAttempts) {
    return db.job.update({
      where: { id: jobId },
      data: {
        status: 'QUEUED',
        progress: 0,
        error: errMsg,
        startedAt: null,
        /**
         * modelKey 现在记的是"实际是谁干的"，属于结果，必须跟着 error/progress 一起清。
         * 不清的话，重排队期间它还挂着上一轮的失败文案，
         * 任务面板上会同时出现「排队中」和「全部失败（依次试过…）」两个自相矛盾的标签。
         * 从前它是"自动调度（首选 X）"这种恒为意图的占位，永远不会和状态打架；
         * 升格成结果之后，生命周期也得跟着变。
         */
        modelKey: null,
      },
    });
  }
  return db.job.update({
    where: { id: jobId },
    data: { status: 'FAILED', error: errMsg, finishedAt: new Date() },
  });
}

/** M1 仅支持取消排队中的任务；RUNNING 的中断留待执行器支持取消信号后实现 */
export async function cancelJob(db: PrismaClient, jobId: string): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('任务');
  if (job.status !== 'QUEUED') {
    throw badRequest(
      job.status === 'RUNNING' ? '任务已在运行，M1 暂不支持中断' : `状态为 ${job.status} 的任务不能取消`,
    );
  }
  return db.job.update({ where: { id: jobId }, data: { status: 'CANCELED', finishedAt: new Date() } });
}

export async function retryJob(db: PrismaClient, jobId: string): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('任务');
  if (job.status !== 'FAILED') throw badRequest(`仅失败的任务可重试（当前状态 ${job.status}）`);
  return db.job.update({
    where: { id: jobId },
    data: {
      status: 'QUEUED',
      attempts: 0,
      error: null,
      progress: 0,
      outputJson: null,
      startedAt: null,
      finishedAt: null,
      // 同 failJob 的重排队分支：结果类字段一并清掉，别让上一轮的成交记录挂到新一轮头上
      modelKey: null,
    },
  });
}

export async function updateJobProgress(db: PrismaClient, jobId: string, progress: number): Promise<void> {
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  await db.job.update({ where: { id: jobId }, data: { progress: p } });
}
