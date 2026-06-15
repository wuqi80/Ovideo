/**
 * 三步生成链路 parser（纯函数，无副作用，可单测）
 * 2026-05-29
 */
import type { ScriptSegment, VideoScriptBlock, ExtractedStoryboardPrompt } from '../types';

let _segCounter = 0;
function segLocalId(): string {
    _segCounter += 1;
    return `seg_local_${Date.now().toString(36)}_${_segCounter}`;
}

/** 从一行里解析 时长：N秒 / 时长（秒）：N，取第一个正整数，找不到返回 null */
function parseDurationSec(line: string): number | null {
    const m = line.match(/时长[（(]?秒?[)）]?\s*[:：]\s*(\d+)/);
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

/** 把 "镜头1" / "镜头 1" / "镜头1：" 规范化成 "镜头1"；非镜头头返回 null */
function normalizeShotHeader(line: string): string | null {
    const m = line.match(/^\s*镜头\s*(\d+)\s*[:：]?\s*$/);
    if (m) return `镜头${m[1]}`;
    // 行内带内容的也允许（如 "镜头1：xxx"），但 Stage 2 模板镜头号独占一行
    const m2 = line.match(/^\s*镜头\s*(\d+)\s*[:：]/);
    if (m2) return `镜头${m2[1]}`;
    return null;
}

/**
 * Stage 2 输出 → VideoScriptBlock[]
 * 以 "镜头N" 行作为块起点，块内找 时长（秒）：N。
 */
export function parseVideoScriptBlocks(text: string): VideoScriptBlock[] {
    if (!text || !text.trim()) return [];
    const lines = text.split('\n');
    const blocks: VideoScriptBlock[] = [];
    let current: { shotNo: string; lines: string[] } | null = null;

    const flush = () => {
        if (!current) return;
        const rawBlock = current.lines.join('\n').trim();
        let durationSec: number | null = null;
        for (const l of current.lines) {
            const d = parseDurationSec(l);
            if (d !== null && /时长/.test(l)) { durationSec = d; break; }
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

const STORYBOARD_LABELS: Array<{ key: keyof ExtractedStoryboardPrompt | 'shotNoRaw' | 'charactersRaw'; label: RegExp }> = [
    { key: 'shotNoRaw', label: /^镜头号\s*[:：]\s*(.*)$/ },
    { key: 'shotSize', label: /^景别\s*[:：]\s*(.*)$/ },
    { key: 'sceneDescription', label: /^画面描述\s*[:：]\s*(.*)$/ },
    { key: 'charactersRaw', label: /^人物\s*[:：]\s*(.*)$/ },
    { key: 'scene', label: /^场景\s*[:：]\s*(.*)$/ },
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
        shotNo: '', shotSize: '', sceneDescription: '', characters: [], scene: '',
        imagePrompt: '', cameraAngle: '', cameraMove: '', dialogue: '', durationSec: null,
    };
    if (!text) return result;

    const lines = text.split('\n');
    let currentKey: keyof ExtractedStoryboardPrompt | 'shotNoRaw' | 'charactersRaw' | null = null;
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
    const shotNoRaw = take('shotNoRaw').replace(/[^\d]/g, '');
    result.shotNo = shotNoRaw ? `镜头${shotNoRaw}` : '';
    result.shotSize = take('shotSize');
    result.sceneDescription = take('sceneDescription');
    const charactersRaw = take('charactersRaw');
    result.characters = charactersRaw.trim() === '无'
        ? []
        : charactersRaw.split(/[、，,/／]/).map(c => c.trim()).filter(Boolean);
    const scene = take('scene');
    result.scene = scene.trim() === '无' ? '' : scene;
    result.imagePrompt = take('imagePrompt');
    result.cameraAngle = take('cameraAngle');
    result.cameraMove = take('cameraMove');
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
