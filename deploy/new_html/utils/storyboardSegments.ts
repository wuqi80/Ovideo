import type { ScriptSegment, StoryboardItem } from '../types';
import { parseStoryboardScript } from './storyboardParser';

const TARGET_SEGMENT_DURATION_SECONDS = 15;
const DEFAULT_SHOT_DURATION_SECONDS = 3;
// 对话时长参考：约 4 个中文字或 8 个英文字符为 1 秒。
const DIALOGUE_CJK_CHARS_PER_SECOND = 4;
const DIALOGUE_LATIN_CHARS_PER_SECOND = 8;

/** 从台词文本估算口播时长（秒）：中文字 /4 + 英文字母数字 /8。 */
export function estimateDialogueDurationSeconds(text: string): number {
  const value = String(text || '').trim();
  if (!value) return 0;
  const cjkCount = (value.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latinCount = (value.match(/[A-Za-z0-9]/g) || []).length;
  return cjkCount / DIALOGUE_CJK_CHARS_PER_SECOND + latinCount / DIALOGUE_LATIN_CHARS_PER_SECOND;
}

/** 提取镜头用于估算口播时长的台词：优先 dialogue 字段，兜底取首个非空正文的引号内文本。 */
function getDialogueTextForEstimate(item: StoryboardItem): string {
  if (item.dialogue?.trim()) return item.dialogue;
  // 只用首个非空字段，避免同一台词在 originalText/scriptSegment 重复出现导致双倍估算。
  const text = item.originalText?.trim() || item.videoScriptBlock?.trim() || item.scriptSegment || '';
  const quoted = text.match(/["「『“][^"」』”]*["」』”]/g);
  return quoted ? quoted.join('\n') : '';
}

export interface StoryboardSegmentEntry {
  item: StoryboardItem;
  globalIndex: number;
  localShotNo: number;
  localShotLabel: string;
}

export interface StoryboardSegmentGroup {
  key: string;
  segmentNo: number;
  segmentLabel: string;
  estimatedDurationSec: number;
  sourceText?: string;
  inferred: boolean;
  entries: StoryboardSegmentEntry[];
}

export interface StoryboardSegmentLookupEntry {
  segmentKey: string;
  segmentNo: number;
  segmentLabel: string;
  localShotNo: number;
  localShotLabel: string;
  estimatedDurationSec: number;
  isFirstInSegment: boolean;
}

/**
 * Removes Markdown decorations commonly found in historical model replies
 * without changing the underlying script stored in the database.
 */
export function cleanStoryboardDisplayLine(line: string): string {
  let value = String(line || '').trim();
  if (!value) return '';

  value = value
    .replace(/^>\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(?:[-+*]\s+|\d+[.)、]\s+)/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();

  return value;
}

export function cleanStoryboardDisplayText(content: string): string {
  return String(content || '')
    .split(/\r?\n/)
    .map(cleanStoryboardDisplayLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Uses the immutable conversation reply as the display source while retaining
 * persistence identifiers from the stored storyboard items. Older database
 * rows may only contain a shortened scene/action summary, while `content`
 * still contains the complete shot fields shown to the user.
 */
function parseStoryboardDisplayItems(content: string): StoryboardItem[] {
  const value = String(content || '').trim();
  if (!value) return [];

  const blocks: Array<{ text: string; segmentNo?: number }> = [];
  let activeSegmentNo: number | undefined;
  let currentSegmentNo: number | undefined;
  let currentLines: string[] = [];

  const flush = () => {
    const text = currentLines.join('\n').trim();
    if (text) blocks.push({ text, segmentNo: currentSegmentNo });
    currentLines = [];
    currentSegmentNo = undefined;
  };

  value.split(/\r?\n/).forEach((line) => {
    const trimmed = cleanStoryboardDisplayLine(line);
    const segmentMatch = trimmed.match(/^(?:分段|段落)\s*0*(\d+)\s*$/);
    if (segmentMatch) {
      flush();
      activeSegmentNo = Number.parseInt(segmentMatch[1], 10);
      return;
    }
    if (/^---CUT---$/.test(trimmed)) {
      flush();
      return;
    }
    if (/^镜头\s*\d+\s*$/.test(trimmed)) {
      flush();
      currentSegmentNo = activeSegmentNo;
      currentLines = [trimmed];
      return;
    }
    if (currentLines.length > 0) currentLines.push(trimmed);
  });
  flush();

  if (blocks.length === 0) return parseStoryboardScript(value).shots;

  return blocks.map((block, index) => {
    const parsed = parseStoryboardScript(block.text).shots[0];
    const shotNumber = block.text.match(/^镜头\s*(\d+)/)?.[1] || String(index + 1);
    const fallback: StoryboardItem = {
      id: `storyboard-display-${index + 1}`,
      originalText: block.text,
      scriptSegment: block.text,
      imagePrompt: '',
      videoPrompt: '',
      dialogue: '',
      characters: [],
      shotNumber: `镜头${shotNumber.padStart(2, '0')}`,
      sourceVideoShotNo: `镜头${shotNumber.padStart(2, '0')}`,
    };
    return {
      ...(parsed || fallback),
      originalText: block.text,
      scriptSegmentId: block.segmentNo
        ? `storyboard-segment-${block.segmentNo}`
        : parsed?.scriptSegmentId,
    };
  });
}

export function mergeStoryboardDisplayItems(
  content: string,
  persistedItems: StoryboardItem[] = [],
): StoryboardItem[] {
  const parsedItems = parseStoryboardDisplayItems(content);
  if (parsedItems.length === 0) return persistedItems;

  return parsedItems.map((parsedItem, index) => {
    const persistedItem = persistedItems[index];
    if (!persistedItem) return parsedItem;
    return {
      ...persistedItem,
      ...parsedItem,
      id: persistedItem.id,
      scriptSegmentId: parsedItem.scriptSegmentId || persistedItem.scriptSegmentId,
    };
  });
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getStoryboardItemDurationSeconds(item: StoryboardItem): number {
  const planned = positiveNumber(item.plannedDurationMs);
  if (planned) return planned / 1000;

  const direct = positiveNumber(item.duration);
  if (direct) return direct;

  const text = [item.originalText, item.videoScriptBlock, item.scriptSegment]
    .filter(Boolean)
    .join('\n');
  const match = text.match(/(?:时间|时长)(?:\s*[（(]秒[)）])?\s*[：:]\s*(\d+(?:\.\d+)?)\s*秒?/);
  const explicit = positiveNumber(match?.[1]);
  if (explicit) return explicit;

  // 无显式时长时按台词字数估算口播时长，短台词不低于默认镜头时长。
  const dialogueSeconds = estimateDialogueDurationSeconds(getDialogueTextForEstimate(item));
  return Math.max(dialogueSeconds, DEFAULT_SHOT_DURATION_SECONDS);
}

function makeSyntheticSegmentId(segmentNo: number): string {
  return `storyboard-segment-${segmentNo}`;
}

function replaceShotHeader(value: string, localShotNo: number): string {
  const label = `镜头${String(localShotNo).padStart(2, '0')}`;
  const text = String(value || '').trim();
  if (!text) return label;
  return /^\s*镜头\s*\d+/m.test(text)
    ? text.replace(/^\s*镜头\s*\d+/m, label)
    : `${label}\n${text}`;
}

/**
 * Fills the segment metadata used by the whole storyboard workflow.
 * Existing Stage 1/2 segment ids are preserved. Legacy flat storyboards are
 * grouped sequentially near the 15-second model limit.
 */
export function normalizeStoryboardSegmentMetadata(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): StoryboardItem[] {
  const segmentOrderById = new Map(
    [...scriptSegments]
      .sort((a, b) => a.order - b.order)
      .map((segment, index) => [segment.id, index + 1]),
  );
  const orderedSegmentIds = [...scriptSegments]
    .sort((a, b) => a.order - b.order)
    .map(segment => segment.id);
  let nextSegmentNo = 1;
  const encounteredSegmentNos = new Map<string, number>();
  let currentKey = '';
  let currentDuration = 0;
  let currentSegmentNo = 0;

  return items.map((item) => {
    if (item.isPlaceholder) return item;

    const duration = getStoryboardItemDurationSeconds(item);
    const explicitKey = String(item.scriptSegmentId || '').trim();
    if (explicitKey) {
      if (!encounteredSegmentNos.has(explicitKey)) {
        const knownNo = segmentOrderById.get(explicitKey);
        while ([...encounteredSegmentNos.values()].includes(nextSegmentNo)) nextSegmentNo += 1;
        const assignedNo = knownNo || nextSegmentNo;
        encounteredSegmentNos.set(explicitKey, assignedNo);
        nextSegmentNo = Math.max(nextSegmentNo, assignedNo + 1);
      }
      if (currentKey !== explicitKey) currentDuration = 0;
      currentKey = explicitKey;
      currentSegmentNo = encounteredSegmentNos.get(explicitKey)!;
    } else if (!currentKey || (currentDuration > 0 && currentDuration + duration > TARGET_SEGMENT_DURATION_SECONDS)) {
      while ([...encounteredSegmentNos.values()].includes(nextSegmentNo)) nextSegmentNo += 1;
      currentSegmentNo = nextSegmentNo++;
      currentKey = orderedSegmentIds[currentSegmentNo - 1] || makeSyntheticSegmentId(currentSegmentNo);
      currentDuration = 0;
      encounteredSegmentNos.set(currentKey, currentSegmentNo);
    }

    currentDuration += duration;
    return {
      ...item,
      scriptSegmentId: currentKey,
    };
  });
}

export function buildStoryboardSegmentGroups(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): StoryboardSegmentGroup[] {
  const normalized = normalizeStoryboardSegmentMetadata(items, scriptSegments)
    .filter(item => !item.isPlaceholder);
  const sourceById = new Map(scriptSegments.map(segment => [segment.id, segment]));
  const groups: StoryboardSegmentGroup[] = [];
  const byKey = new Map<string, StoryboardSegmentGroup>();

  normalized.forEach((item, globalIndex) => {
    const key = item.scriptSegmentId || makeSyntheticSegmentId(groups.length + 1);
    let group = byKey.get(key);
    if (!group) {
      const source = sourceById.get(key);
      group = {
        key,
        segmentNo: groups.length + 1,
        segmentLabel: `分段 ${String(groups.length + 1).padStart(2, '0')}`,
        estimatedDurationSec: 0,
        sourceText: source?.sourceText,
        inferred: !source && !items.some(row => row.scriptSegmentId === key),
        entries: [],
      };
      groups.push(group);
      byKey.set(key, group);
    }
    const localShotNo = group.entries.length + 1;
    group.entries.push({
      item,
      globalIndex,
      localShotNo,
      localShotLabel: `镜头 ${String(localShotNo).padStart(2, '0')}`,
    });
    group.estimatedDurationSec += getStoryboardItemDurationSeconds(item);
  });

  return groups;
}

export function buildStoryboardSegmentLookup(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): Map<string, StoryboardSegmentLookupEntry> {
  const lookup = new Map<string, StoryboardSegmentLookupEntry>();
  buildStoryboardSegmentGroups(items, scriptSegments).forEach((group) => {
    group.entries.forEach((entry, index) => {
      lookup.set(entry.item.id, {
        segmentKey: group.key,
        segmentNo: group.segmentNo,
        segmentLabel: group.segmentLabel,
        localShotNo: entry.localShotNo,
        localShotLabel: entry.localShotLabel,
        estimatedDurationSec: group.estimatedDurationSec,
        isFirstInSegment: index === 0,
      });
    });
  });
  return lookup;
}

/** Keeps persistence ids globally unique while storing the user-facing shot no per segment. */
export function normalizeStoryboardItemsForWorkflow(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): StoryboardItem[] {
  const normalized = normalizeStoryboardSegmentMetadata(items, scriptSegments);
  const lookup = buildStoryboardSegmentLookup(normalized, scriptSegments);
  return normalized.map((item, index) => {
    if (item.isPlaceholder) return item;
    const segment = lookup.get(item.id);
    return {
      ...item,
      shotNumber: `镜头${String(index + 1).padStart(2, '0')}`,
      originalText: segment
        ? replaceShotHeader(item.originalText || item.videoScriptBlock || item.scriptSegment, segment.localShotNo)
        : item.originalText,
      sourceVideoShotNo: segment
        ? `镜头${String(segment.localShotNo).padStart(2, '0')}`
        : item.sourceVideoShotNo,
    };
  });
}

/** Serializes the canonical segmented script persisted in conversation versions. */
export function serializeStoryboardItemsWithSegments(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): string {
  return buildStoryboardSegmentGroups(items, scriptSegments)
    .flatMap(group => [
      `分段${String(group.segmentNo).padStart(2, '0')}`,
      ...group.entries.flatMap(entry => [
        replaceShotHeader(
          entry.item.originalText || entry.item.videoScriptBlock || entry.item.scriptSegment,
          entry.localShotNo,
        ),
        '---CUT---',
      ]),
    ])
    .join('\n')
    .trim();
}
