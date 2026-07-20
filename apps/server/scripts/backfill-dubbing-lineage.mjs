// 存量配音行的血脉回填（一次性）。
// 背景见 modules/generation/late-dubbing.ts：DubbingLine.lineageId 是后加的字段，
// 此前所有配音行都是 null。没有它，TTS 跑的这几分钟里用户改一次分镜，音频就写回已退位的
// 旧版本行，当前版本那行永远停在 GENERATING——用户只能再付一次 TTS 的钱。
//
// 归组口径：同一分集里跨版本的配音行，靠 shot.lineageId + 关联对白的 sortOrder 对齐——
// 这与 applyPatch 复制配音行时"按 sortOrder 把旧台词映射到新台词"的口径完全一致。
// 锚点取该组里版本最小的那一行的 id，与 applyPatch 的 `base.lineageId ?? base.id` 同义。
//
// 【写不准的宁可留 null】以下三种一律不猜：
//   - 镜头本身没有 lineageId（跨版本身份无从谈起）
//   - 配音行没有关联对白（没有 sortOrder 可对齐）
//   - 同一组里同一个版本出现多行（口径含糊，猜错等于把音频写到别的台词上）
// 留 null 的后果只是"这一行享受不到跨版本写回"，猜错的后果是串台词，两者不对等。
//
// 只写 lineageId，不碰任何音频资产、状态与配音行本身；按"已有值就不覆盖"幂等，可反复执行。
//
// 运行：apps/server 下
//   pnpm exec tsx scripts/backfill-dubbing-lineage.mjs          # dry-run，只打印将要做什么
//   pnpm exec tsx scripts/backfill-dubbing-lineage.mjs --apply  # 真正写库
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const lines = await db.dubbingLine.findMany({
    include: {
      // text 也要取：只按 sortOrder 对齐会在"台词整组换过"的版本之间错位一格
      dialogueLine: { select: { sortOrder: true, text: true } },
      shot: {
        select: {
          id: true,
          lineageId: true,
          storyboard: { select: { id: true, episodeId: true, version: true } },
        },
      },
    },
  });

  // key = 镜头血脉 + 对白 sortOrder → 同一句台词在各版本的全部分身
  const groups = new Map();
  let skippedNoShotLineage = 0;
  let skippedNoDialogue = 0;
  let alreadySet = 0;

  for (const line of lines) {
    if (line.lineageId) {
      alreadySet += 1;
      continue; // 幂等：已有血脉的行一概不动
    }
    if (!line.shot.lineageId) {
      skippedNoShotLineage += 1;
      continue;
    }
    if (!line.dialogueLine) {
      skippedNoDialogue += 1;
      continue;
    }
    const key = `${line.shot.lineageId}::${line.dialogueLine.sortOrder}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  let planned = 0;
  let written = 0;
  let ambiguous = 0;

  for (const [key, members] of groups) {
    // 同一版本里出现两行 = 归组口径在这里说不清，整组放弃
    const versions = new Set(members.map((m) => m.shot.storyboard.id));
    if (versions.size !== members.length) {
      ambiguous += members.length;
      console.log(
        `跳过（同一版本内多行，口径含糊）：${key}，涉及 ${members.length} 行：` +
          members.map((m) => `${m.id}@v${m.shot.storyboard.version}`).join(', '),
      );
      continue;
    }

    /**
     * 【必须再验一次台词文本】只靠 sortOrder 对齐是不够的。
     * applyPatch 在 overrides.dialogue 存在时**有意跳过**复制配音行——台词整组换了，
     * 血脉本就该在那里断代。可这个脚本看不见那件事，于是把换台词前后的两条不同血脉焊成一条。
     * 实测：真实库里 47 组有 5 组是这样，其中三组是整体错位一位
     *（旧版 sortOrder=0 是标题行，新版 sortOrder=0 是第一句台词）。
     * 焊错的后果不是"享受不到跨版本写回"，而是 A 句的音频被写进 B 句那一行、
     * 界面显示已生成、成片里说错话——用户还得再付一次 TTS 的钱改回来。
     * 归组只在台词逐字相同的成员之间成立，其余整组放弃。
     */
    const texts = new Set(members.map((m) => (m.dialogueLine?.text ?? '').trim()));
    if (texts.size > 1) {
      ambiguous += members.length;
      console.log(
        `跳过（组内台词不一致，多半是台词换过导致 sortOrder 错位）：${key}，涉及 ${members.length} 行：` +
          [...texts].map((t) => `「${t.slice(0, 20)}」`).join(' vs '),
      );
      continue;
    }

    // 锚点 = 版本最小的那一行自身 id（applyPatch 里 `base.lineageId ?? base.id` 的同义写法）
    const sorted = [...members].sort((a, b) => a.shot.storyboard.version - b.shot.storyboard.version);
    const anchorId = sorted[0].id;

    for (const m of sorted) {
      planned += 1;
      console.log(
        `${APPLY ? '回填' : '将回填'}：line=${m.id} v${m.shot.storyboard.version} ` +
          `shot=${m.shot.id} → lineage=${anchorId}`,
      );
      if (APPLY) {
        await db.dubbingLine.update({ where: { id: m.id }, data: { lineageId: anchorId } });
        written += 1;
      }
    }
  }

  console.log(
    `\n扫描 ${lines.length} 条配音行：待回填 ${planned} 条（归为 ${groups.size} 条血脉），` +
      `已有血脉 ${alreadySet} 条，镜头无血脉跳过 ${skippedNoShotLineage} 条，` +
      `无关联对白跳过 ${skippedNoDialogue} 条，口径含糊跳过 ${ambiguous} 条。` +
      `${APPLY ? `本次写入 ${written} 条。` : '未写库（加 --apply 生效）。'}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
