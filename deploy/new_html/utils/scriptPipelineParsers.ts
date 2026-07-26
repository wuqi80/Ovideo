/**
 * 三步生成链路 parser（纯函数，无副作用，可单测）
 * 2026-05-29
 */
import type {
    ScriptSegment,
    VideoScriptBlock,
    VideoScriptGroup,
    ExtractedStoryboardPrompt,
} from '../types';
import {
    ensureSegmentPromptLengths,
    STABILITY_CONSTRAINT_REFERENCE,
} from './scriptPromptStandards';

let _segCounter = 0;
function segLocalId(): string {
    _segCounter += 1;
    return `seg_local_${Date.now().toString(36)}_${_segCounter}`;
}

/** 从一行里解析 时长：N秒 / 时长（秒）：N / 时间：N秒，取第一个正整数，找不到返回 null */
function parseDurationSec(line: string): number | null {
    const m = line.match(/(?:时长|时间)[（(]?秒?[)）]?\s*[:：]\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    return null;
}

/**
 * Stage 1 输出 → ScriptSegment[]
 * 优先按单独一行 --- 切块；若无 ---，按空行分块。每块末尾的 时长 行被剥离。
 */
export function parseScriptSegments(text: string): ScriptSegment[] {
    if (!text || !text.trim()) return [];

    let blocks: string[];
    if (/^\s*---\s*$/m.test(text)) {
        blocks = text.split(/^\s*---\s*$/m);
    } else {
        blocks = text.split(/\n\s*\n/);
    }

    const segments: ScriptSegment[] = [];
    for (const raw of blocks) {
        const lines = raw.split('\n');
        let durationSec: number | null = null;
        const kept: string[] = [];
        for (const line of lines) {
            const d = parseDurationSec(line);
            if (d !== null && /时长/.test(line)) {
                durationSec = d;
                continue; // 剥离时长行
            }
            kept.push(line);
        }
        const sourceText = kept.join('\n').trim();
        if (!sourceText) continue;
        segments.push({
            id: segLocalId(),
            order: segments.length,
            sourceText,
            estimatedDurationSec: durationSec,
            status: 'done',
        });
    }
    return segments;
}

const SHOT_HEADER_PATTERN = /^\s*(?:镜头|分镜)\s*(\d+)(?:\s*[-－—]\s*(\d+))?\s*[:：]?\s*$/;
const SHOT_HEADER_WITH_CONTENT_PATTERN = /^\s*(?:镜头|分镜)\s*(\d+)(?:\s*[-－—]\s*(\d+))?\s*[:：]/;

export interface HierarchicalShotNumber {
    segmentNo: number | null;
    localShotNo: number;
}

/** 兼容历史“镜头1”，并解析新标准“镜头1-2”。 */
export function parseHierarchicalShotNumber(value: string): HierarchicalShotNumber | null {
    const match = String(value || '').match(/(?:镜头|分镜)\s*(\d+)(?:\s*[-－—]\s*(\d+))?/);
    if (!match) return null;
    const first = Number.parseInt(match[1], 10);
    const second = match[2] ? Number.parseInt(match[2], 10) : null;
    if (!Number.isFinite(first) || first <= 0 || (second !== null && (!Number.isFinite(second) || second <= 0))) {
        return null;
    }
    return second === null
        ? { segmentNo: null, localShotNo: first }
        : { segmentNo: first, localShotNo: second };
}

export function formatHierarchicalShotNumber(segmentNo: number, localShotNo: number): string {
    return `镜头${segmentNo}-${localShotNo}`;
}

/** 从单个镜头正文中移除分段级提示词，分段提示词由独立卡片展示和持久化。 */
export function stripVideoScriptGroupPromptSections(value: string): string {
    const text = String(value || '');
    const promptStart = text.search(/^[ \t]*【(?:视觉风格|正向稳定约束)】/m);
    return (promptStart >= 0 ? text.slice(0, promptStart) : text).trim();
}

/** 精确提取指定镜头文本块，避免把镜头2-2误识别为镜头2-1。 */
export function findVideoScriptShotBlock(content: string, shotNumber: string): string | null {
    const parsed = parseHierarchicalShotNumber(shotNumber);
    if (!parsed) return null;
    const shotToken = parsed.segmentNo === null
        ? `0*${parsed.localShotNo}(?!\\d)(?!\\s*[-－—]\\s*\\d)`
        : `0*${parsed.segmentNo}\\s*[-－—]\\s*0*${parsed.localShotNo}(?!\\d)`;
    const headerPattern = new RegExp(`^[ \\t]*(?:镜头|分镜)\\s*${shotToken}`, 'm');
    const match = headerPattern.exec(content);
    if (!match) return null;

    const bodyStart = match.index + match[0].length;
    const remaining = content.slice(bodyStart);
    const nextHeader = /^[ \t]*镜头\s*\d+(?:\s*[-－—]\s*\d+)?/m.exec(remaining);
    const end = nextHeader ? bodyStart + nextHeader.index : content.length;
    return stripVideoScriptGroupPromptSections(content.slice(match.index, end));
}

/** 把镜头标题规范化；非镜头标题返回 null。 */
export function normalizeShotHeader(line: string): string | null {
    const match = line.match(SHOT_HEADER_PATTERN) || line.match(SHOT_HEADER_WITH_CONTENT_PATTERN);
    if (!match) return null;
    return match[2]
        ? formatHierarchicalShotNumber(Number(match[1]), Number(match[2]))
        : `镜头${Number(match[1])}`;
}

/**
 * Stage 2 输出 → VideoScriptBlock[]
 * 以 "镜头N" 行作为块起点，块内找 时长（秒）：N；兼容历史镜头设计里的 时间：N秒。
 */
export function parseVideoScriptBlocks(text: string): VideoScriptBlock[] {
    if (!text || !text.trim()) return [];
    const lines = text.split('\n');
    const blocks: VideoScriptBlock[] = [];
    let current: { shotNo: string; lines: string[] } | null = null;

    const flush = () => {
        if (!current) return;
        const rawBlock = stripVideoScriptGroupPromptSections(current.lines.join('\n'));
        let durationSec: number | null = null;
        for (const l of rawBlock.split('\n')) {
            const d = parseDurationSec(l);
            if (d !== null && /(?:时长|时间)/.test(l)) { durationSec = d; break; }
        }
        blocks.push({ shotNo: current.shotNo, durationSec, rawBlock });
        current = null;
    };

    for (const line of lines) {
        const shotNo = normalizeShotHeader(line);
        if (shotNo) {
            flush();
            current = { shotNo, lines: [line] };
        } else if (current) {
            current.lines.push(line);
        }
    }
    flush();
    return blocks;
}

function extractBracketSection(text: string, label: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(
        `【${escaped}】\\s*([\\s\\S]*?)(?=\\n\\s*【(?:视觉风格|正向稳定约束)】|\\n\\s*分段\\s*\\d+|$)`,
        'i',
    ));
    return (match?.[1] || '').trim();
}

function shotRange(blocks: VideoScriptBlock[], groupNo: number): string {
    if (blocks.length === 0) return formatHierarchicalShotNumber(groupNo, 1);
    const first = formatHierarchicalShotNumber(groupNo, 1);
    const last = formatHierarchicalShotNumber(groupNo, blocks.length);
    return first === last ? first : `${first}至${last}`;
}

/**
 * Stage 2 文本中的每个分段代表一次视频生成，组内可拆成多个静态画面镜头。
 * 视觉风格和稳定约束属于整个分段，并会被组合为组内所有最终镜头共享的视频提示词。
 */
export function parseVideoScriptGroups(text: string): VideoScriptGroup[] {
    if (!text || !text.trim()) return [];

    const explicit = /^\s*分段\s*(\d+)\s*[:：]?\s*$/gm;
    const headers = [...text.matchAll(explicit)];
    const rawGroups: Array<{ groupNo: number; rawGroup: string }> = [];

    if (headers.length > 0) {
        headers.forEach((header, index) => {
            const start = (header.index || 0) + header[0].length;
            const end = index + 1 < headers.length ? (headers[index + 1].index || text.length) : text.length;
            rawGroups.push({
                groupNo: Number(header[1]) || index + 1,
                rawGroup: text.slice(start, end).trim(),
            });
        });
    } else {
        rawGroups.push({ groupNo: 1, rawGroup: text.trim() });
    }

    return rawGroups.flatMap(({ groupNo, rawGroup }) => {
        const blocks = parseVideoScriptBlocks(rawGroup);
        if (blocks.length === 0) return [];
        const visualStyle = extractBracketSection(rawGroup, '视觉风格');
        const stabilityConstraint = extractBracketSection(rawGroup, '正向稳定约束');
        const promptParts = [
            shotRange(blocks, groupNo),
            visualStyle ? `【视觉风格】${visualStyle}` : '',
            stabilityConstraint ? `【正向稳定约束】${stabilityConstraint}` : '',
        ].filter(Boolean);
        return [{
            groupNo,
            blocks,
            visualStyle,
            stabilityConstraint,
            sharedVideoPrompt: `${promptParts.join('，')}。`,
            rawGroup,
        }];
    });
}

function splitVideoScriptOutputGroups(output: string): string[] {
    const headers = [...output.matchAll(/^\s*分段\s*\d+\s*[:：]?\s*$/gm)];
    if (headers.length === 0) return [output.trim()].filter(Boolean);
    return headers.map((header, index) => {
        const start = (header.index || 0) + header[0].length;
        const end = index + 1 < headers.length ? (headers[index + 1].index || output.length) : output.length;
        return output.slice(start, end).trim();
    }).filter(Boolean);
}

function renumberVideoScriptGroup(rawGroup: string, segmentNo: number): string {
    let localShotNo = 0;
    const body = rawGroup.replace(
        /^(\s*)(?:镜头|分镜)\s*\d+(?:\s*[-－—]\s*\d+)?(\s*[:：]?\s*.*)$/gm,
        (_full, indent: string, suffix: string) => {
            localShotNo += 1;
            return `${indent}${formatHierarchicalShotNumber(segmentNo, localShotNo)}${suffix}`;
        },
    );
    return `分段${segmentNo}\n${body.trim()}`;
}

/**
 * 合并 Stage 2 输出，并同时收口两个强契约：
 * - 分段号全局连续；
 * - 镜头号统一为“镜头{分段号}-{段内镜头号}”，不会跨段重复。
 */
export function combineVideoScriptOutputs(outputs: string[]): string {
    let groupNo = 0;
    const combined: string[] = [];
    for (const output of outputs.map(value => value.trim()).filter(Boolean)) {
        for (const rawGroup of splitVideoScriptOutputGroups(output)) {
            groupNo += 1;
            combined.push(renumberVideoScriptGroup(rawGroup, groupNo));
        }
    }
    return combined.join('\n\n');
}

/**
 * 补足新生成/新编辑脚本的分段级提示词长度，并保持镜头正文与分段编号不变。
 * 缺失字段不会在这里伪造，交由后续校验明确拒绝。
 */
export function ensureVideoScriptPromptLengths(content: string): string {
    const groups = parseVideoScriptGroups(content);
    if (groups.length === 0) return content.trim();

    return groups.map((group) => {
        const shotBody = stripVideoScriptGroupPromptSections(group.rawGroup);
        const lightAndColor = group.rawGroup.match(/^\s*光影色调\s*[：:]\s*([^\n]+)/m)?.[1]?.trim() || '';
        const derivedVisualStyle = lightAndColor
            ? `${lightAndColor}，电影级写实质感，画面氛围贴合当前剧情`
            : '电影级写实质感，统一色彩与光影层次，画面氛围贴合当前剧情';
        const prompts = ensureSegmentPromptLengths(
            group.visualStyle || derivedVisualStyle,
            group.stabilityConstraint || STABILITY_CONSTRAINT_REFERENCE,
        );
        return [
            `分段${group.groupNo}`,
            shotBody,
            prompts.visualStyle ? `【视觉风格】${prompts.visualStyle}` : '',
            prompts.stabilityConstraint ? `【正向稳定约束】${prompts.stabilityConstraint}` : '',
        ].filter(Boolean).join('\n\n');
    }).join('\n\n');
}

/**
 * 清理模型内部续写协议并补齐分段级生产约束。
 * 这是纯文本、零网络调用的最终收口，不触发模型重试，也不改变镜头正文。
 */
export function normalizeGeneratedVideoScript(content: string): string {
    const cleaned = String(content || '')
        .replace(/^[ \t]*---CUT---[ \t]*$/gmi, '')
        .replace(/^[ \t]*<<<\s*CONTINUE_FROM\b[^>\r\n]*>>>[ \t]*$/gmi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return ensureVideoScriptPromptLengths(cleaned);
}

/**
 * 清除台词里的「类型标记」括号：（台词）/（OS）/（OV）/（台词/OS/OV）及其半角形式。
 *
 * 提示词模板要求 AI 按「角色（台词/OS/OV）：内容」输出，这些括号只是给人看的
 * 镜头类型标注。配音流程直接朗读 dialogue 文本，会把「台词」「OS」念出来，
 * 因此在解析阶段就把这类标记剥掉，保留「角色：内容」。
 */
export function stripDialogueMarkers(s: string): string {
    if (!s) return '';
    // 匹配仅由 台词/OS/OV/O.S./V.O./画外音/旁白（可用 / 、 组合）构成的括号
    const MARKER = /[（(]\s*(?:台词|OS|OV|O\.S\.|V\.O\.|画外音|旁白)(?:\s*[/／、]\s*(?:台词|OS|OV|画外音|旁白))*\s*[）)]/g;
    return s
        .replace(MARKER, '')
        // 收尾：「角色 ：内容」→「角色：内容」，去掉标记移除后残留的多余空格
        .replace(/[ \t]+([:：])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

const QUOTE_PAIRS: Array<[string, string]> = [
    ['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'],
    ['"', '"'], ["'", "'"], ['【', '】'], ['《', '》'],
];

/** 去掉成对包裹的引号（支持多层），如 「「内容」」 / "内容" → 内容 */
function stripWrappingQuotes(s: string): string {
    let t = (s || '').trim();
    let changed = true;
    while (changed && t.length >= 2) {
        changed = false;
        for (const [l, r] of QUOTE_PAIRS) {
            if (t.startsWith(l) && t.endsWith(r) && t.length > l.length + r.length - 1) {
                t = t.slice(l.length, t.length - r.length).trim();
                changed = true;
                break;
            }
        }
    }
    return t;
}

/**
 * 从一行台词里提取「说话人」与「实际朗读内容」，供 TTS 使用。
 *
 * 例：`小悟：「别跟我说话……」` → { speaker:'小悟', text:'别跟我说话……' }
 *
 * 规则：① 优先匹配已知角色名/旁白前缀；② 兜底匹配任意「名字：」前缀（名字≤10 字、
 * 不含引号/冒号/空白）；③ 去掉成对包裹引号。这样 TTS 只念引号内的台词，而不会把
 * 「小悟：」和引号也念出来。解析为空时回退原文，绝不丢内容。
 */
export function extractSpokenDialogue(
    raw: string,
    charNames: string[] = [],
): { speaker: string; text: string } {
    const original = (raw || '').trim();
    let speaker = '';
    let text = original;
    // ① 已知角色名 / 旁白前缀
    for (const name of [...charNames, '旁白']) {
        if (name && original.startsWith(name)) {
            speaker = name;
            text = original.slice(name.length).replace(/^[：:，,\s]+/, '');
            break;
        }
    }
    // ② 兜底：任意「名字：」前缀（仅当未匹配到已知角色名）
    if (!speaker) {
        const m = text.match(/^([^：:「」『』“”‘’"'【】《》\s]{1,10})[：:]\s*/);
        if (m) { speaker = m[1]; text = text.slice(m[0].length); }
    }
    // ③ 去掉包裹引号
    text = stripWrappingQuotes(text);
    if (!text) { speaker = ''; text = original; }  // 解析空了：回退原文，不丢内容
    return { speaker, text };
}

const STORYBOARD_LABELS: Array<{ key: keyof ExtractedStoryboardPrompt | 'shotNoRaw' | 'charactersRaw' | 'propsRaw'; label: RegExp }> = [
    { key: 'shotNoRaw', label: /^镜头号\s*[:：]\s*(.*)$/ },
    { key: 'shotSize', label: /^景别\s*[:：]\s*(.*)$/ },
    { key: 'sceneDescription', label: /^画面描述\s*[:：]\s*(.*)$/ },
    { key: 'charactersRaw', label: /^人物\s*[:：]\s*(.*)$/ },
    { key: 'scene', label: /^场景\s*[:：]\s*(.*)$/ },
    { key: 'propsRaw', label: /^道具\s*[:：]\s*(.*)$/ },
    { key: 'imagePrompt', label: /^分镜生成提示词\s*[:：]\s*(.*)$/ },
    { key: 'cameraAngle', label: /^拍摄角度\s*[:：]\s*(.*)$/ },
    { key: 'cameraMove', label: /^运镜方式\s*[:：]\s*(.*)$/ },
    { key: 'dialogue', label: /^台词\s*[:：]\s*(.*)$/ },
];

/**
 * 解析单个「镜头号」块 → ExtractedStoryboardPrompt（内部 helper）
 * 逐行解析；遇到已知 label 行开始新字段，后续非 label 行追加到当前字段（支持多行画面描述）。
 */
function parseOneStoryboardBlock(text: string): ExtractedStoryboardPrompt {
    const result: ExtractedStoryboardPrompt = {
        shotNo: '', shotSize: '', sceneDescription: '', characters: [], scene: '', props: [],
        imagePrompt: '', cameraAngle: '', cameraMove: '', dialogue: '', durationSec: null,
    };
    if (!text) return result;

    const lines = text.split('\n');
    let currentKey: keyof ExtractedStoryboardPrompt | 'shotNoRaw' | 'charactersRaw' | 'propsRaw' | null = null;
    const buf: Record<string, string[]> = {};

    const matchLabel = (line: string) => {
        for (const { key, label } of STORYBOARD_LABELS) {
            const m = line.match(label);
            if (m) return { key, rest: m[1] ?? '' };
        }
        return null;
    };

    for (const line of lines) {
        const dur = line.match(/^时长\s*[:：]\s*(\d+)/);
        if (dur) { result.durationSec = parseInt(dur[1], 10); currentKey = null; continue; }

        const hit = matchLabel(line);
        if (hit) {
            currentKey = hit.key;
            buf[currentKey] = [hit.rest];
        } else if (currentKey) {
            buf[currentKey].push(line);
        }
    }

    const take = (k: string) => (buf[k] ? buf[k].join('\n').trim() : '');
    const shotNo = parseHierarchicalShotNumber(`镜头${take('shotNoRaw')}`);
    result.shotNo = shotNo
        ? shotNo.segmentNo
            ? formatHierarchicalShotNumber(shotNo.segmentNo, shotNo.localShotNo)
            : `镜头${shotNo.localShotNo}`
        : '';
    result.shotSize = take('shotSize');
    result.sceneDescription = take('sceneDescription');
    const charactersRaw = take('charactersRaw');
    result.characters = charactersRaw.trim() === '无'
        ? []
        : charactersRaw.split(/[、，,/／]/).map(c => c.trim()).filter(Boolean);
    const scene = take('scene');
    result.scene = scene.trim() === '无' ? '' : scene;
    const propsRaw = take('propsRaw');
    result.props = propsRaw.trim() === '无'
        ? []
        : propsRaw.split(/[、，,/／]/).map(p => p.trim()).filter(Boolean);
    result.cameraAngle = take('cameraAngle');
    result.cameraMove = take('cameraMove');
    result.imagePrompt = take('imagePrompt') || [
        result.shotSize,
        result.cameraAngle,
        result.sceneDescription,
    ].filter(Boolean).join('，');
    const dialogue = take('dialogue');
    result.dialogue = dialogue.trim() === '无' ? '' : stripDialogueMarkers(dialogue);
    return result;
}

/**
 * Stage 3 输出 → ExtractedStoryboardPrompt[]
 * 单次只转写「一个视频镜头」，但 AI 可把它拆成多个「镜头号」块（更细的分镜）。
 * 按行首「镜头号」切块，每块单独解析；若整段没有任何「镜头号」则兜底为一个块。
 */
export function parseStoryboardPromptExtractions(text: string): ExtractedStoryboardPrompt[] {
    if (!text || !text.trim()) return [];
    const lines = text.split('\n');
    const rawBlocks: string[] = [];
    let current: string[] | null = null;
    for (const line of lines) {
        if (/^\s*镜头号/.test(line)) {
            if (current) rawBlocks.push(current.join('\n'));
            current = [line];
        } else if (current) {
            current.push(line);
        }
    }
    if (current) rawBlocks.push(current.join('\n'));

    if (rawBlocks.length === 0) {
        const single = parseOneStoryboardBlock(text);
        return (single.imagePrompt || single.sceneDescription || single.shotSize) ? [single] : [];
    }
    return rawBlocks
        .map(parseOneStoryboardBlock)
        .filter(b => b.imagePrompt || b.sceneDescription || b.shotSize);
}
