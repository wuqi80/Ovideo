// 迟到产物的跨版本补挂。
// 异步生成要跑几分钟（视频尤甚），这期间用户每改一次分镜就出一个新版本——Shot 被全量复制、
// 全部换新 id。产物落库时按入队那一刻抓住的 shotId 写回，Take 就留在了已退位的旧版本上；
// 复制发生时 Take 还不存在，新版本也没东西可复制。用户视角就是"生成成功了，但找不到"。
//
// 处理方式：产物照旧落在原版本（历史完整，切回旧版本仍看得见），额外把同一个 assetId
// 挂到当前版本的同血脉镜头上——两边都有，不是搬走。付费产物只增不删。
import type { PrismaClient } from '@prisma/client';
import type { TakeSlot } from '@ovideo/shared';

/** 补挂只需要镜头身份与它所处的分镜版本坐标（loadShot 的返回值天然满足） */
interface LateTakeShot {
  id: string;
  lineageId: string | null;
  storyboard: { id: string; episodeId: string; version: number };
}

/**
 * 把刚落库的产物额外挂一份到当前分镜版本的同血脉镜头上。
 * 返回新 Take 的 id；无需补挂（已在当前版本）或补不了（血脉断代）时返回 null。
 *
 * 【不动 selected 指针】这几分钟里用户可能已经手动选了别的 take，自动选中会覆盖人的选择——
 * 既有约定是人的选择优先。原版本上"首个 take 自动选中"的语义由调用方保持不变。
 *
 * 【自身不抛错】产物已经产出并计费了，补挂只是锦上添花，绝不能把一次成功的生成判成失败。
 */
export async function alsoAttachToCurrentVersion(
  db: PrismaClient,
  shot: LateTakeShot,
  slot: TakeSlot,
  assetId: string,
  jobId: string | null,
): Promise<string | null> {
  try {
    /**
     * 循环而不是一次就走：applyPatch 是在事务里"先读全部 base.takes、再逐条复制"，
     * 大分镜这个事务能跑好几秒。如果我们的 create 恰好落在它读完之后、复制之前，
     * 新版本照样拿不到——那正是这次要修的 bug 本身，只是窗口从几分钟缩到几秒。
     * 所以补挂之后再确认一次"有没有又出新版本"，有就再补一轮。
     * 幂等检查保证重复轮次不会插出多余的行；轮数设上限，免得跟一个正在连续改动的人死磕。
     */
    const MAX_ROUNDS = 3;
    let from = { version: shot.storyboard.version, shotId: shot.id, lineageId: shot.lineageId };
    let lastTakeId: string | null = null;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // 一次查询回答"我这一版是不是已经被翻篇了"：没有更高版本即绝大多数情况，就此收工不留额外开销
      const current = await db.storyboard.findFirst({
        where: { episodeId: shot.storyboard.episodeId, version: { gt: from.version } },
        orderBy: { version: 'desc' },
      });
      if (!current) return lastTakeId;

      // lineageId 是跨版本的镜头身份；为空说明这行没入过血脉（回填脚本未覆盖的存量行）
      const target = from.lineageId
        ? await db.shot.findFirst({ where: { storyboardId: current.id, lineageId: from.lineageId } })
        : null;
      if (!target) {
        // 分镜被整个重新生成、血脉换代时会走到这里。不是 bug，但产物确实停在旧版本，留痕可查。
        console.warn(
          `[late-take] 产物停在旧版本：shot=${from.shotId} v${from.version} slot=${slot} asset=${assetId}，` +
            `当前版本 v${current.version} 找不到同血脉镜头（lineage=${from.lineageId ?? 'null'}）`,
        );
        return lastTakeId;
      }

      // 幂等：同一 (镜头, 资产) 已经挂过就不再插第二条（重试、重复调用、以及本循环的下一轮）
      const existing = await db.take.findFirst({ where: { shotId: target.id, assetId } });
      if (existing) {
        lastTakeId = existing.id;
      } else {
        const take = await db.take.create({ data: { shotId: target.id, slot, assetId, jobId } });
        lastTakeId = take.id;
        console.warn(
          `[late-take] 迟到产物已补挂到当前版本：v${from.version} → v${current.version}，` +
            `shot=${from.shotId} → ${target.id} slot=${slot} take=${take.id}`,
        );
      }
      from = { version: current.version, shotId: target.id, lineageId: target.lineageId };
    }
    return lastTakeId;
  } catch (err) {
    console.warn(`[late-take] 补挂失败（不影响本次生成结果）：shot=${shot.id} slot=${slot}`, err);
    return null;
  }
}
