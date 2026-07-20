// DubbingLine.status 与 TTS Job 真实状态的对账。
//
// 病根：GENERATING 是入队方（dubbing 路由）写进去的，但能让这条流程终止的路有三条——
// 取消排队、重试耗尽、进程重启。一个状态只有一条路写得进去、却有三条路让它泄漏，
// 它必然会永久卡死：语速改不了、单行重生成锁死、页面每 5 秒空轮询。
// 因此这里把 DubbingLine.status 降格成 Job 状态的投影，由 job 侧的每个终止路径调用。
import type { PrismaClient } from '@prisma/client';
import { parseJson } from '../../lib/json.js';

/** 对账只关心 TTS 任务；其余类型直接返回 null，调用方可以无脑对每个 Job 调一次 */
export interface TtsJobLike {
  type: string;
  inputJson: string | null;
}

/** 从 Job.inputJson 取出它照看的配音行 id（契约见 dubbing/routes.ts 顶部注释） */
export function dubbingLineIdOfJob(job: TtsJobLike): string | null {
  if (job.type !== 'GENERATE_TTS') return null;
  const input = parseJson<{ kind?: string; dubbingLineId?: string }>(job.inputJson, {});
  return input.kind === 'dubbing' && input.dubbingLineId ? input.dubbingLineId : null;
}

/**
 * 把某个 Job 照看的配音行拉回与该 Job 一致的状态。
 *
 * 只动仍停在 GENERATING 的行：READY 意味着音频已经落库（付费产物只增不删），
 * 绝不能被一次迟到的对账覆盖成 PENDING/FAILED 而让用户重付一次。
 * 对账本身失败不许影响调用方的主流程（Job 状态才是权威），因此吞错落警告。
 */
export async function syncDubbingLineForJob(
  db: PrismaClient,
  job: TtsJobLike,
  to: 'PENDING' | 'GENERATING' | 'FAILED',
): Promise<void> {
  const lineId = dubbingLineIdOfJob(job);
  if (!lineId) return;
  try {
    await db.dubbingLine.updateMany({
      // GENERATING → 终止：正常对账；FAILED → GENERATING：手动重试重新开跑
      where: { id: lineId, status: to === 'GENERATING' ? { in: ['FAILED', 'PENDING'] } : 'GENERATING' },
      data: { status: to },
    });
  } catch (err) {
    console.warn(
      `[dubbing] 配音行状态对账失败（不影响任务状态）lineId=${lineId} → ${to}：`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * 启动清扫：进程重启后，入队时写下的那批 GENERATING 已经没有任何在途任务与之对应。
 *
 * 两类分开处理，因为对用户的含义不同：
 * - 被"启动恢复"判死的中断任务（调用方传进来）→ 行同样置 FAILED。它们可能已在厂商侧计费，
 *   打回 PENDING 会让页面显示成"从没生成过"，诱导用户再付一次钱。
 * - 其余无人照看的 GENERATING 行 → 打回 PENDING。这批是取消、崩溃等路径的残留，
 *   从未真正开跑，应当能改语速、能重新生成。
 */
export async function recoverDubbingLinesOnStartup(
  db: PrismaClient,
  interruptedJobs: TtsJobLike[],
): Promise<{ failed: number; released: number }> {
  const interruptedLineIds = interruptedJobs
    .map((j) => dubbingLineIdOfJob(j))
    .filter((id): id is string => id !== null);

  const failed = interruptedLineIds.length
    ? (
        await db.dubbingLine.updateMany({
          where: { id: { in: interruptedLineIds }, status: 'GENERATING' },
          data: { status: 'FAILED' },
        })
      ).count
    : 0;

  // 仍有 QUEUED/RUNNING 的 TTS 任务照看的行不能碰——那是本轮正常在跑的
  const activeJobs = await db.job.findMany({
    where: { type: 'GENERATE_TTS', status: { in: ['QUEUED', 'RUNNING'] } },
    select: { type: true, inputJson: true },
  });
  const guarded = new Set(
    activeJobs.map((j) => dubbingLineIdOfJob(j)).filter((id): id is string => id !== null),
  );

  const stranded = await db.dubbingLine.findMany({
    where: { status: 'GENERATING' },
    select: { id: true },
  });
  const orphanIds = stranded.map((l) => l.id).filter((id) => !guarded.has(id));
  const released = orphanIds.length
    ? (
        await db.dubbingLine.updateMany({
          where: { id: { in: orphanIds }, status: 'GENERATING' },
          data: { status: 'PENDING' },
        })
      ).count
    : 0;

  if (failed > 0 || released > 0) {
    console.warn(`[dubbing] 启动清扫：${failed} 行随中断任务标记失败，${released} 行无人照看已打回待生成`);
  }
  return { failed, released };
}
