// 迟到配音的跨版本写回。
// 与 late-take.ts 同一个病根：TTS 要跑几十秒到几分钟，这期间用户每改一次分镜就出一个新版本——
// applyPatch 全量复制 Shot 与它们的 DubbingLine、全部换新 id。音频落库时按入队那一刻抓住的
// dubbingLineId 写回，就写进了已退位的旧版本行；当前版本那一行永远停在 GENERATING 转圈，
// 成片里这句台词静默丢失，用户唯一出路是再点一次生成——同一句话付两次 TTS 钱。
//
// 与 take 的本质区别：take 是"多张候选任选其一"，补挂即新增一行，只增不改；
// 配音行是"这一句台词的音频"，当前版本那一行此刻正停在 GENERATING，所以这里是**改写**它。
// 改写就有覆盖风险，故多一道闸：目标行已经 READY（用户自己重新生成过）就不动，人的选择优先。
import type { PrismaClient } from '@prisma/client';
import { onDubbingDurationChanged } from '../stale/service.js';

/** 行间静音间隔（重算镜头配音总时长用），与合成阶段的 LINE_GAP 必须一致 */
export const DUBBING_GAP_MS = 300;

/** 写回只需要配音行身份与它所处的分镜版本坐标 */
interface LateDubbingLine {
  id: string;
  lineageId: string | null;
  shotId: string;
  shot: { storyboard: { id: string; episodeId: string; version: number } };
}

/**
 * 按镜头重算"全部 READY 行时长之和 + (n-1) 个行间间隔"，并把结果推给时长链路（v2 §3）。
 * 缺陷 1（音频）与缺陷 2（时长锁）同源，必须在同一次写回里一起做完，
 * 否则会留下"音频补过去了、时长没跟上"的中间态：8.2 秒台词配 3 秒视频、末帧定格硬撑。
 */
export async function recalcShotDubbingDuration(db: PrismaClient, shotId: string): Promise<void> {
  const readyLines = await db.dubbingLine.findMany({ where: { shotId, status: 'READY' } });
  const totalMs =
    readyLines.reduce((sum, l) => sum + (l.durationMs ?? 0), 0) +
    Math.max(0, readyLines.length - 1) * DUBBING_GAP_MS;
  await onDubbingDurationChanged(db, shotId, totalMs);
}

/**
 * 把刚落库的音频同时写到当前分镜版本的同血脉配音行上，并重算那一侧的镜头时长锁。
 * 无需写回（已在当前版本）、写不了（血脉断代）、不该写（目标行已 READY）时静默返回。
 *
 * 【自身不抛错】音频已经产出并计费了，写回只是补救，绝不能把一次成功的生成判成失败。
 */
export async function alsoWriteDubbingToCurrentVersion(
  db: PrismaClient,
  line: LateDubbingLine,
  audioAssetId: string,
  durationMs: number,
): Promise<void> {
  try {
    /**
     * 循环而不是一次就走：applyPatch 在事务里"先读全部 base.dubbingLines、再逐条复制"，
     * 大分镜这个事务能跑好几秒。我们的 update 若正好落在它读完之后、复制完之前，
     * 新版本复制到的仍是 GENERATING 的旧值——那正是这次要修的 bug 本身，只是窗口缩到几秒。
     * 所以写完再确认一次有没有更新的版本。轮数设上限，免得跟一个正在连续改动的人死磕。
     */
    const MAX_ROUNDS = 3;
    let from = {
      version: line.shot.storyboard.version,
      lineId: line.id,
      lineageId: line.lineageId,
    };

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // 一次查询回答"我这一版是不是已经被翻篇了"：没有更高版本即绝大多数情况，就此收工不留额外开销
      const current = await db.storyboard.findFirst({
        where: { episodeId: line.shot.storyboard.episodeId, version: { gt: from.version } },
        orderBy: { version: 'desc' },
      });
      if (!current) return;

      // lineageId 是跨版本的配音行身份；为空说明这行没入过血脉（回填脚本未覆盖的存量行）
      const target = from.lineageId
        ? await db.dubbingLine.findFirst({
            where: { lineageId: from.lineageId, shot: { storyboardId: current.id } },
          })
        : null;
      if (!target) {
        // 分镜整个重生成、或台词被整组替换（applyPatch 有意跳过复制配音行）时会走到这里。
        // 不是 bug，但音频确实停在旧版本，留痕可查。
        console.warn(
          `[late-dubbing] 音频停在旧版本：line=${from.lineId} v${from.version} asset=${audioAssetId}，` +
            `当前版本 v${current.version} 找不到同血脉配音行（lineage=${from.lineageId ?? 'null'}）`,
        );
        return;
      }

      // 幂等：重试、重复调用、以及本循环的下一轮都会走到这里，已经是这份音频就不重复写
      if (target.audioAssetId !== audioAssetId) {
        if (target.status === 'READY') {
          // 这几分钟里用户自己又重新生成过一次，那一份是更新的、也是他要的。
          // 覆盖等于把人的选择擦掉，宁可让本次产物停在旧版本，如实留日志。
          console.warn(
            `[late-dubbing] 当前版本该行已 READY，不覆盖：line=${from.lineId} v${from.version} → ` +
              `v${current.version} 的 ${target.id}（本次产物 asset=${audioAssetId} 停在旧版本）`,
          );
          return;
        }
        await db.dubbingLine.update({
          where: { id: target.id },
          data: { status: 'READY', durationMs, audioAssetId },
        });
        console.warn(
          `[late-dubbing] 迟到音频已写回当前版本：v${from.version} → v${current.version}，` +
            `line=${from.lineId} → ${target.id} asset=${audioAssetId}`,
        );
      }
      // 时长锁必须落在新版本的镜头上：新行的 durationLockedMs 停在 patch 那一刻的旧值，
      // videoStale 也标不起来，"待重生成"面板一片绿，没人知道该重做。每轮都算，幂等。
      await recalcShotDubbingDuration(db, target.shotId);

      from = { version: current.version, lineId: target.id, lineageId: target.lineageId };
    }
  } catch (err) {
    console.warn(`[late-dubbing] 写回失败（不影响本次生成结果）：line=${line.id}`, err);
  }
}
