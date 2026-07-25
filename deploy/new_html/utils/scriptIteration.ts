export interface ScriptIterationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const normalizeWhitespace = (value: string): string =>
  String(value || '').replace(/\s+/g, ' ').trim();

export function buildScriptIterationContext(
  messages: ScriptIterationMessage[],
  maxCharacters = 2400,
): string {
  if (!messages.length) return '（首次修改，无历史意见）';

  const lines = messages
    .slice(-10)
    .map((message) => {
      const speaker = message.role === 'user' ? '用户' : '系统';
      const content = normalizeWhitespace(message.content);
      return content ? `${speaker}：${content}` : '';
    })
    .filter(Boolean);

  const context = lines.join('\n');
  if (context.length <= maxCharacters) return context;
  return `…${context.slice(context.length - maxCharacters)}`;
}

export function normalizeScriptIterationResult(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Some models preserve every shot header but omit the CUT delimiter on edits.
 * Insert delimiters between standalone shot headers before parsing the reply.
 */
export function ensureStoryboardCutSeparators(value: string): string {
  const normalized = normalizeScriptIterationResult(value);
  if (!normalized) return '';

  const lines = normalized.split(/\r?\n/);
  const output: string[] = [];
  let hasShot = false;

  lines.forEach((line) => {
    const isShotHeader = /^\s*镜头\s*\d+(?:\s*[-－—]\s*\d+)?\s*$/.test(line);
    const isSegmentHeader = /^\s*(?:分段|段落)\s*\d+\s*$/.test(line);
    if ((isShotHeader || isSegmentHeader) && hasShot) {
      const previous = [...output].reverse().find(item => item.trim())?.trim();
      const previousIsSegmentHeader = /^(?:分段|段落)\s*\d+$/.test(previous || '');
      if (previous !== '---CUT---' && !(isShotHeader && previousIsSegmentHeader)) output.push('---CUT---');
    }
    if (isShotHeader) hasShot = true;
    output.push(line);
  });

  return output.join('\n').replace(/(?:\s*---CUT---\s*){2,}/g, '\n---CUT---\n').trim();
}
