export const VISUAL_STYLE_REFERENCE =
  '古风写实，暖黄暗调，室内光影层次丰富，略带神秘氛围。';

export const STABILITY_CONSTRAINT_REFERENCE =
  '无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换；角色五官、妆容、发型、服饰全程100%固定不变；人物肢体自然正常，无多手指、无肢体扭曲、无穿模；画面焦点始终锁定核心主体；竖屏主体居中，纵向空间充分利用。同一场景内，所有镜头的摄影机机位、人物朝向、人物与场景的相对位置、光影色调、道具位置必须保持100%一致，严禁出现跳轴、人物瞬移、道具穿帮、光影突变。';

export function countPromptCharacters(value: string): number {
  return String(value || '').replace(/\s/g, '').length;
}

export const MIN_VISUAL_STYLE_CHARACTERS = 25;
export const MIN_STABILITY_CONSTRAINT_CHARACTERS = 200;

export function isIndependentSegmentPrompt(value: string): boolean {
  const normalized = String(value || '').replace(/\s/g, '');
  if (!normalized) return false;
  return !/^(?:同上|同前|同第一组|同前一组|沿用上组|参照上组)/.test(normalized);
}

function appendPromptClause(value: string, clause: string): string {
  const base = value.trim().replace(/[，,；;。.\s]+$/g, '');
  return base ? `${base}；${clause}` : clause;
}

export function ensureVisualStyleLength(value: string): string {
  let result = String(value || '').trim();
  if (!result) return '';
  const additions = [
    '画面质感统一，色彩与光影层次稳定',
    '构图与整体氛围始终贴合当前剧情',
  ];
  for (const addition of additions) {
    if (countPromptCharacters(result) >= MIN_VISUAL_STYLE_CHARACTERS) break;
    result = appendPromptClause(result, addition);
  }
  return /[。！？]$/.test(result) ? result : `${result}。`;
}

const STABILITY_CLAUSES = [
  { key: '无背景音乐', text: '无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换' },
  { key: '角色五官', text: '角色五官、妆容、发型、服饰全程100%固定不变' },
  { key: '人物肢体', text: '人物肢体自然正常，无多手指、无肢体扭曲、无穿模' },
  { key: '画面焦点', text: '画面焦点始终锁定核心主体' },
  { key: '竖屏主体', text: '竖屏主体居中，纵向空间充分利用' },
  {
    key: '同一场景内',
    text: '同一场景内，所有镜头的摄影机机位、人物朝向、人物与场景的相对位置、光影色调、道具位置必须保持100%一致，严禁出现跳轴、人物瞬移、道具穿帮、光影突变',
  },
];

export function ensureStabilityConstraintLength(value: string): string {
  let result = String(value || '').trim();
  if (!result) return '';
  for (const clause of STABILITY_CLAUSES) {
    if (countPromptCharacters(result) >= MIN_STABILITY_CONSTRAINT_CHARACTERS) break;
    if (!result.includes(clause.key)) result = appendPromptClause(result, clause.text);
  }
  if (countPromptCharacters(result) < MIN_STABILITY_CONSTRAINT_CHARACTERS) {
    result = appendPromptClause(
      result,
      '镜头之间动作衔接自然连贯，主体比例、景深、色温、环境陈设与关键细节全程统一稳定',
    );
  }
  return /[。！？]$/.test(result) ? result : `${result}。`;
}

export function ensureSegmentPromptLengths(
  visualStyle: string,
  stabilityConstraint: string,
): { visualStyle: string; stabilityConstraint: string } {
  return {
    visualStyle: ensureVisualStyleLength(visualStyle),
    stabilityConstraint: ensureStabilityConstraintLength(stabilityConstraint),
  };
}
