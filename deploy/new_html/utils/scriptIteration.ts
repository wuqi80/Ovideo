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
    const isShotHeader = /^\s*镜头\s*\d+\s*$/.test(line);
    if (isShotHeader && hasShot) {
      const previous = [...output].reverse().find(item => item.trim())?.trim();
      if (previous !== '---CUT---') output.push('---CUT---');
    }
    if (isShotHeader) hasShot = true;
    output.push(line);
  });

  return output.join('\n').replace(/(?:\s*---CUT---\s*){2,}/g, '\n---CUT---\n').trim();
}

export interface ShotCountValidation {
  valid: boolean;
  message?: string;
}

function requestedShotTarget(instruction: string): number | null {
  const match = instruction.match(/(?:减少到|压缩到|保留|调整为|改成|变为)\s*(\d+)\s*(?:个)?镜头/);
  if (!match) return null;
  const target = Number(match[1]);
  return Number.isFinite(target) && target > 0 ? target : null;
}

/**
 * Prevent an ordinary rewrite from silently collapsing a complete storyboard.
 * Explicit numeric targets win; vague structural edits are allowed a bounded
 * change, while non-structural edits must preserve the existing shot count.
 */
export function validateStoryboardIterationCount(
  previousCount: number,
  nextCount: number,
  instruction: string,
): ShotCountValidation {
  if (previousCount <= 0) return { valid: nextCount > 0 };

  const target = requestedShotTarget(instruction);
  if (target !== null) {
    return nextCount === target
      ? { valid: true }
      : { valid: false, message: `本轮要求保留 ${target} 个镜头，但模型返回了 ${nextCount} 个镜头。` };
  }

  const asksToReduce = /(?:减少|删(?:除|掉)?|合并|精简|压缩).{0,8}(?:镜头|分镜)|(?:镜头|分镜).{0,8}(?:减少|删(?:除|掉)?|合并|精简|压缩)/.test(instruction);
  const asksToAdd = /(?:增加|新增|添加|拆分|扩充).{0,8}(?:镜头|分镜)|(?:镜头|分镜).{0,8}(?:增加|新增|添加|拆分|扩充)/.test(instruction);

  if (asksToReduce) {
    const minimum = Math.max(1, Math.ceil(previousCount * 0.7));
    return nextCount >= minimum && nextCount <= previousCount
      ? { valid: true }
      : {
          valid: false,
          message: `模型把 ${previousCount} 个镜头异常改成了 ${nextCount} 个；“减少几个”最多允许缩减约 30%。`,
        };
  }

  if (asksToAdd) {
    const maximum = Math.max(previousCount + 1, Math.ceil(previousCount * 1.5));
    return nextCount >= previousCount && nextCount <= maximum
      ? { valid: true }
      : {
          valid: false,
          message: `模型把 ${previousCount} 个镜头异常改成了 ${nextCount} 个，超出本轮增补范围。`,
        };
  }

  return nextCount === previousCount
    ? { valid: true }
    : {
        valid: false,
        message: `本轮未要求调整镜头数量，必须保留原有 ${previousCount} 个镜头；模型返回了 ${nextCount} 个。`,
      };
}
