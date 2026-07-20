// 存量"迟到产物"的跨版本补挂（一次性）。
// 背景与 modules/generation/late-take.ts 相同：异步生成期间用户改了分镜，新版本 Shot 全量复制时
// Take 还不存在，产物最终落回已退位的旧版本，当前版本永远看不见——用户视角是"生成成功了，但找不到"。
// 补挂逻辑上线前已经攒下一批这样的产物，本脚本把它们接到当前版本。
//
// 判定口径：Take 的创建时间晚于"比它所在版本更新的那一版"的诞生时间 —— 即产物落库时版本已经翻篇。
// 单纯属于旧版本的历史 take 不在此列（那是正常的版本历史，不该往新版本搬）。
// 只增不删、不动任何 selected 指针、按 (shotId, assetId) 幂等，可反复执行。
//
// 运行：apps/server 下
//   pnpm exec tsx scripts/backfill-late-takes.mjs          # dry-run，只打印将要做什么
//   pnpm exec tsx scripts/backfill-late-takes.mjs --apply  # 真正写库
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const storyboards = await db.storyboard.findMany({
    select: { id: true, episodeId: true, version: true, createdAt: true },
    orderBy: [{ episodeId: 'asc' }, { version: 'asc' }],
  });
  // 每个分集的当前版本 = version 最大的那条
  const currentByEpisode = new Map();
  for (const sb of storyboards) {
    const cur = currentByEpisode.get(sb.episodeId);
    if (!cur || sb.version > cur.version) currentByEpisode.set(sb.episodeId, sb);
  }
  const byId = new Map(storyboards.map((sb) => [sb.id, sb]));
  // episodeId → 按版本升序的全部版本（用于找"紧随其后的那一版"的诞生时间）
  const versionsByEpisode = new Map();
  for (const sb of storyboards) {
    if (!versionsByEpisode.has(sb.episodeId)) versionsByEpisode.set(sb.episodeId, []);
    versionsByEpisode.get(sb.episodeId).push(sb);
  }

  const takes = await db.take.findMany({
    include: { shot: { select: { id: true, storyboardId: true, lineageId: true } } },
    orderBy: { createdAt: 'asc' },
  });

  let planned = 0;
  let created = 0;
  let alreadyThere = 0;
  let noLineage = 0;

  for (const take of takes) {
    const sb = byId.get(take.shot.storyboardId);
    if (!sb) continue;
    const current = currentByEpisode.get(sb.episodeId);
    if (!current || current.id === sb.id) continue; // 产物已在当前版本

    // 版本翻篇之后才落库的才算"迟到"：取紧随其后那一版的诞生时间作分界
    const next = versionsByEpisode
      .get(sb.episodeId)
      .find((v) => v.version > sb.version);
    if (!next || take.createdAt <= next.createdAt) continue;

    const target = take.shot.lineageId
      ? await db.shot.findFirst({
          where: { storyboardId: current.id, lineageId: take.shot.lineageId },
          select: { id: true },
        })
      : null;
    if (!target) {
      noLineage += 1;
      console.log(
        `跳过（当前版本 v${current.version} 无同血脉镜头）：take=${take.id} slot=${take.slot} ` +
          `shot=${take.shot.id} v${sb.version} lineage=${take.shot.lineageId ?? 'null'}`,
      );
      continue;
    }

    const existing = await db.take.findFirst({
      where: { shotId: target.id, assetId: take.assetId },
      select: { id: true },
    });
    if (existing) {
      alreadyThere += 1;
      continue;
    }

    const lateSec = Math.round((take.createdAt.getTime() - next.createdAt.getTime()) / 1000);
    planned += 1;
    console.log(
      `${APPLY ? '补挂' : '将补挂'}：slot=${take.slot} asset=${take.assetId} ` +
        `v${sb.version}(${take.shot.id}) → v${current.version}(${target.id})，迟到 ${lateSec}s`,
    );
    if (APPLY) {
      // 只新增一条指向同一 assetId 的 Take；selected 指针一概不动（人的选择优先）
      await db.take.create({
        data: { shotId: target.id, slot: take.slot, assetId: take.assetId, jobId: take.jobId },
      });
      created += 1;
    }
  }

  console.log(
    `\n扫描 ${takes.length} 条 Take：待补挂 ${planned} 条，已补挂过 ${alreadyThere} 条，` +
      `血脉断代跳过 ${noLineage} 条。${APPLY ? `本次新建 ${created} 条 Take。` : '未写库（加 --apply 生效）。'}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
