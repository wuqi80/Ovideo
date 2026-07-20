// Cut 成片服务（v2 §6 美化/成品页数据底座）。
// 语义：Cut 是"合成动作"的快照——合成不花钱，可在创建时快照选定片段列表
// （与生成类任务"执行时实时解析绑定"的铁律不冲突，见 m2 计划 S2.COMPOSE_CUT）。
import type { Asset, Cut, PrismaClient } from '@prisma/client';
import { badRequest, notFound } from '../../lib/errors.js';
import { parseJson, toJson } from '../../lib/json.js';

/** Cut.itemsJson 的条目：按镜头顺序排列的选定视频片段 */
export interface CutItem {
  shotId: string;
  sortOrder: number;
  takeId: string;
  assetId: string;
  uri: string;
  durationMs: number | null;
}

/** Cut.audioTracksJson 的条目：创建时快照的就绪配音行（镜头内按台词顺序，合成时从镜头起点顺序混入） */
export interface CutAudioLine {
  shotId: string;
  dubbingLineId: string;
  assetId: string;
  uri: string;
  durationMs: number | null;
  /** 镜头内播放顺序（= DialogueLine.sortOrder，无关联台词行时为 0） */
  order: number;
}

/** 对外返回形态：itemsJson 解析为 items；outputAssetId 有值时附带 outputAsset 对象 */
export interface CutView extends Omit<Cut, 'itemsJson'> {
  items: CutItem[];
  outputAsset: Asset | null;
}

export interface CreateCutInput {
  episodeId: string;
  storyboardId: string;
}

/**
 * 创建成片：读取指定分镜的全部镜头（sortOrder 序），要求每个镜头都已选定视频 take，
 * 否则报错并列出缺失镜头序号（序号 = sortOrder + 1，人类可读）。
 * 通过校验后快照 items 并建 COMPOSING 状态的 Cut（version 自增）。
 */
export async function createCut(db: PrismaClient, input: CreateCutInput): Promise<Cut> {
  const { episodeId, storyboardId } = input;
  const storyboard = await db.storyboard.findUnique({ where: { id: storyboardId } });
  if (!storyboard || storyboard.episodeId !== episodeId) throw notFound('分镜');

  const shots = await db.shot.findMany({
    where: { storyboardId },
    orderBy: { sortOrder: 'asc' },
  });
  if (shots.length === 0) throw badRequest('该分镜没有镜头，无法合成成片');

  // 一次性取回全部 selected video take（含资产），避免逐镜头查询
  const takeIds = shots.map((s) => s.videoSelectedTakeId).filter((id): id is string => id !== null);
  const takes = await db.take.findMany({
    where: { id: { in: takeIds } },
    include: { asset: true },
  });
  const takeById = new Map(takes.map((t) => [t.id, t]));

  // selected 指针为空或悬空（take 已不存在）都算"未选定"
  const missing = shots.filter(
    (s) => !s.videoSelectedTakeId || !takeById.has(s.videoSelectedTakeId),
  );
  if (missing.length > 0) {
    const nums = missing.map((s) => `#${s.sortOrder + 1}`).join(', ');
    throw badRequest(`以下镜头还没有选定视频片段：${nums}`);
  }

  const items: CutItem[] = shots.map((s) => {
    const take = takeById.get(s.videoSelectedTakeId!)!;
    return {
      shotId: s.id,
      sortOrder: s.sortOrder,
      takeId: take.id,
      assetId: take.assetId,
      uri: take.asset.uri,
      durationMs: take.asset.durationMs,
    };
  });

  const shotIds = shots.map((s) => s.id);
  const dubbingLines = await db.dubbingLine.findMany({
    where: { shotId: { in: shotIds } },
    include: { audioAsset: true, dialogueLine: true },
  });

  // 守门：逐镜头（逐台词行）检查配音完整性。
  // 只要有台词没有对应的就绪配音，成片就会缺一句台词、画面还被按短了的配音时长硬裁一截，
  // 且 Cut=READY / Job=SUCCEEDED 零提示——所以这里必须拦下，并说清是哪几个镜头。
  const dialogues = await db.dialogueLine.findMany({ where: { shotId: { in: shotIds } } });
  if (dialogues.length > 0) {
    assertDubbingComplete(shots, dialogues, dubbingLines);
  }

  // 配音快照：READY 且有音频资产的配音行（镜头内按台词 sortOrder 排序）。
  const audioLines: CutAudioLine[] = dubbingLines
    .filter((l) => l.status === 'READY' && l.audioAssetId !== null && l.audioAsset !== null)
    .map((l) => ({
      shotId: l.shotId,
      dubbingLineId: l.id,
      assetId: l.audioAssetId!,
      uri: l.audioAsset!.uri,
      durationMs: l.durationMs ?? l.audioAsset!.durationMs,
      order: l.dialogueLine?.sortOrder ?? 0,
    }))
    .sort((a, b) => a.order - b.order || a.dubbingLineId.localeCompare(b.dubbingLineId));

  const agg = await db.cut.aggregate({ where: { episodeId }, _max: { version: true } });
  const version = (agg._max.version ?? 0) + 1;

  return db.cut.create({
    data: {
      episodeId,
      version,
      itemsJson: toJson(items),
      audioTracksJson: toJson(audioLines),
      status: 'COMPOSING',
    },
  });
}

/** 未就绪台词行的档位：决定给用户哪种建议 */
type DubGap = 'GENERATING' | 'PENDING' | 'FAILED';

/** 报错时按档位分组，同一镜头只归入最需要用户动手的那一档 */
const GAP_ORDER: DubGap[] = ['FAILED', 'PENDING', 'GENERATING'];
const GAP_ADVICE: Record<DubGap, string> = {
  FAILED: '配音生成失败，需重新生成',
  PENDING: '还没有发起配音',
  GENERATING: '配音正在生成中，请稍候',
};

/**
 * 逐台词行核对配音覆盖：有台词却没有"READY 且带音频资产"的配音行 → 拦下，
 * 并按 FAILED / PENDING / GENERATING 分档列出具体镜头序号（#sortOrder+1）。
 */
function assertDubbingComplete(
  shots: { id: string; sortOrder: number }[],
  dialogues: { id: string; shotId: string }[],
  dubbingLines: { dialogueLineId: string | null; status: string; audioAssetId: string | null }[],
): void {
  // 同一台词行可能有多条配音行（重生成留痕），只要有一条真正就绪即算覆盖
  const covered = new Set<string>();
  const statesByDialogue = new Map<string, Set<string>>();
  for (const l of dubbingLines) {
    if (!l.dialogueLineId) continue;
    if (l.status === 'READY' && l.audioAssetId !== null) covered.add(l.dialogueLineId);
    const set = statesByDialogue.get(l.dialogueLineId) ?? new Set<string>();
    set.add(l.status === 'READY' ? 'FAILED' : l.status); // READY 但没音频资产 = 坏行，得重生成
    statesByDialogue.set(l.dialogueLineId, set);
  }

  // 每个镜头取最需要用户动手的那一档
  const gapByShot = new Map<string, DubGap>();
  for (const d of dialogues) {
    if (covered.has(d.id)) continue;
    const states = statesByDialogue.get(d.id);
    const gap: DubGap = !states || states.size === 0
      ? 'PENDING' // 压根没建配音行
      : states.has('FAILED')
        ? 'FAILED'
        : states.has('GENERATING')
          ? 'GENERATING'
          : 'PENDING';
    const prev = gapByShot.get(d.shotId);
    if (prev === undefined || GAP_ORDER.indexOf(gap) < GAP_ORDER.indexOf(prev)) {
      gapByShot.set(d.shotId, gap);
    }
  }
  if (gapByShot.size === 0) return;

  const parts: string[] = [];
  for (const gap of GAP_ORDER) {
    const nums = shots
      .filter((s) => gapByShot.get(s.id) === gap)
      .map((s) => `#${s.sortOrder + 1}`);
    if (nums.length > 0) parts.push(`${nums.join(', ')} ${GAP_ADVICE[gap]}`);
  }
  throw badRequest(`以下镜头有台词但配音未就绪，无法合成：${parts.join('；')}`);
}

/** 单个 Cut 的序列化：items 解析 + outputAsset 附带 */
export async function getCut(db: PrismaClient, cutId: string): Promise<CutView> {
  const cut = await db.cut.findUnique({ where: { id: cutId } });
  if (!cut) throw notFound('成片');
  const [view] = await serializeCuts(db, [cut]);
  return view;
}

/** 分集下全部 Cut，新版本在前 */
export async function listCuts(db: PrismaClient, episodeId: string): Promise<CutView[]> {
  const cuts = await db.cut.findMany({
    where: { episodeId },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
  });
  return serializeCuts(db, cuts);
}

async function serializeCuts(db: PrismaClient, cuts: Cut[]): Promise<CutView[]> {
  const assetIds = cuts
    .map((c) => c.outputAssetId)
    .filter((id): id is string => id !== null);
  const assets =
    assetIds.length > 0 ? await db.asset.findMany({ where: { id: { in: assetIds } } }) : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  return cuts.map((cut) => {
    const { itemsJson, ...rest } = cut;
    return {
      ...rest,
      items: parseJson<CutItem[]>(itemsJson, []),
      outputAsset: cut.outputAssetId ? (assetById.get(cut.outputAssetId) ?? null) : null,
    };
  });
}
