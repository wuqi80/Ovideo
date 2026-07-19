import type {
  CharacterIdentityAnchor,
  GenerationReference,
  Material,
  MaterialLibrary,
  StoryboardItem,
  StoryboardQualityReview,
} from '../types';

export type StoryboardGenerationModel =
  | 'nanobanana'
  | 'qwen'
  | 'qwen_lora'
  | 'kontext'
  | 'qwenN'
  | 'qwenN_lora'
  | 'gpt_image_vip'
  | 'gpt_image_official';

const AUTO_REFERENCE_SOURCES = new Set(['identity_anchor', 'material_binding']);

export interface StoryboardReferenceExclusion {
  reference: GenerationReference;
  reason: 'capacity';
  isCritical: boolean;
}

export interface StoryboardReferencePlan {
  references: GenerationReference[];
  excluded: StoryboardReferenceExclusion[];
  criticalExcluded: StoryboardReferenceExclusion[];
  maxReferences: number;
}

function normalizedAnchor(raw: unknown): CharacterIdentityAnchor {
  const anchor = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    age: String(anchor.age || '').trim(),
    face: String(anchor.face || '').trim(),
    hair: String(anchor.hair || '').trim(),
    outfit: String(anchor.outfit || '').trim(),
    distinguishingFeatures: String(anchor.distinguishing_features || anchor.distinguishingFeatures || '').trim(),
    forbiddenChanges: String(anchor.forbidden_changes || anchor.forbiddenChanges || '').trim(),
  };
}

function selectedMaterial(materials: Material[], selectedId?: string): Material | undefined {
  if (!selectedId) return undefined;
  return materials.find(material => material.id === selectedId);
}

function toReference(
  material: Material,
  type: GenerationReference['type'],
  name: string,
  source: NonNullable<GenerationReference['source']>,
): GenerationReference {
  return {
    id: `${source}:${material.assetId || name}:${material.id}`,
    url: material.url,
    type,
    name,
    assetId: material.assetId,
    fileId: material.fileId,
    description: material.description,
    source,
    isLocked: source === 'identity_anchor',
  };
}

export function resolveShotReferencePlan(
  shot: StoryboardItem,
  materialLibrary: MaterialLibrary,
  existing: GenerationReference[] = [],
  maxReferences = 6,
): StoryboardReferencePlan {
  const automatic: GenerationReference[] = [];
  const add = (reference?: GenerationReference) => {
    if (!reference || automatic.some(item => item.url === reference.url)) return;
    automatic.push(reference);
  };

  for (const character of shot.characters || []) {
    const materials = materialLibrary[character] || [];
    const selectedId = shot.materialSelections?.[character];
    const primary = selectedMaterial(materials, selectedId);
    if (primary) add(toReference(primary, 'character', character, 'identity_anchor'));
  }

  if (shot.scene) {
    const materials = materialLibrary[shot.scene] || [];
    const selectedId = shot.materialSelections?.[shot.scene];
    const primary = selectedMaterial(materials, selectedId);
    if (primary) add(toReference(primary, 'scene', shot.scene, 'material_binding'));
  }

  for (const prop of shot.props || []) {
    const materials = materialLibrary[prop] || [];
    const selectedId = shot.materialSelections?.[prop];
    const primary = selectedMaterial(materials, selectedId);
    if (primary) add(toReference(primary, 'prop', prop, 'material_binding'));
  }

  const boundNames = new Set([...(shot.characters || []), ...(shot.props || []), ...(shot.scene ? [shot.scene] : [])]);
  const manual = existing
    .filter(reference => {
      if (AUTO_REFERENCE_SOURCES.has(String(reference.source || ''))) return false;
      if (reference.source === 'manual') return true;
      // Older saved auto references had no source marker. Recognize them by the
      // bound entity name and library URL so a changed material binding replaces them.
      const legacyBoundMaterial = Boolean(
        reference.name
        && boundNames.has(reference.name)
        && (materialLibrary[reference.name] || []).some(material => material.url === reference.url),
      );
      return !legacyBoundMaterial;
    })
    .map(reference => ({ ...reference, source: reference.source || ('manual' as const) }));

  const candidates: GenerationReference[] = [];
  for (const reference of [...automatic, ...manual]) {
    if (!reference.url || candidates.some(item => item.url === reference.url)) continue;
    candidates.push(reference);
  }

  const references = candidates.slice(0, maxReferences);
  const excluded = candidates.slice(maxReferences).map(reference => ({
    reference,
    reason: 'capacity' as const,
    isCritical: reference.type === 'character' || reference.type === 'scene',
  }));
  return {
    references,
    excluded,
    criticalExcluded: excluded.filter(item => item.isCritical),
    maxReferences,
  };
}

export function resolveShotReferences(
  shot: StoryboardItem,
  materialLibrary: MaterialLibrary,
  existing: GenerationReference[] = [],
  maxReferences = 6,
): GenerationReference[] {
  return resolveShotReferencePlan(shot, materialLibrary, existing, maxReferences).references;
}

function materialMetadata(name: string, materialLibrary: MaterialLibrary, selectedId?: string): Material | undefined {
  const materials = materialLibrary[name] || [];
  return selectedMaterial(materials, selectedId);
}

export function buildIdentityAnchoredPrompt(
  shot: StoryboardItem,
  basePrompt: string,
  materialLibrary: MaterialLibrary,
  retryFeedback = '',
  references: GenerationReference[] = [],
): string {
  const characterBlocks = (shot.characters || []).map(name => {
    const material = materialMetadata(name, materialLibrary, shot.materialSelections?.[name]);
    const anchor = normalizedAnchor(material?.styleParams?.identity_anchor);
    const details = [
      material?.description ? `身份描述：${material.description}` : '',
      anchor.age ? `年龄感：${anchor.age}` : '',
      anchor.face ? `脸型与五官：${anchor.face}` : '',
      anchor.hair ? `发型发色：${anchor.hair}` : '',
      anchor.outfit ? `固定服装：${anchor.outfit}` : '',
      anchor.distinguishingFeatures ? `识别特征：${anchor.distinguishingFeatures}` : '',
      anchor.forbiddenChanges ? `禁止变化：${anchor.forbiddenChanges}` : '',
    ].filter(Boolean);
    return details.length ? `【${name}】${details.join('；')}` : `【${name}】严格匹配同名角色参考图。`;
  });

  const hardConstraints = characterBlocks.length > 0
    ? [
        '角色身份锚点（最高优先级硬约束）：',
        ...characterBlocks,
        '同名角色参考图用于锁定人物身份。不得改变脸型、五官比例、年龄感、发型发色、固定服装和显著识别特征；不得把不同角色的特征互相混合。',
      ].join('\n')
    : '';

  const storyRequirements = [
    shot.scriptSegment ? `脚本画面要求：${shot.scriptSegment}` : '',
    shot.scene ? `场景：${shot.scene}` : '',
    shot.characters?.length ? `画面角色：${shot.characters.join('、')}` : '',
    shot.props?.length ? `关键道具：${shot.props.join('、')}` : '',
  ].filter(Boolean).join('\n');

  const referenceTypeLabels: Record<GenerationReference['type'], string> = {
    character: '角色身份锚点（最高优先级）',
    scene: '场景参考',
    pose: '姿态/构图参考',
    prop: '道具参考',
    effect: '风格/效果参考',
  };
  const referenceMap = references.length > 0
    ? [
        '参考图职责映射（编号与上传顺序一致）：',
        ...references.map((reference, index) => (
          `参考图${index + 1} = ${referenceTypeLabels[reference.type]}【${reference.name || '未命名'}】`
          + (reference.type === 'character' ? '，必须生成该参考图中的同一人物，不得替换成相似人物' : '')
        )),
      ].join('\n')
    : '';

  return [
    basePrompt.trim(),
    hardConstraints,
    referenceMap,
    storyRequirements,
    retryFeedback ? `上次验收未通过，必须修正：${retryFeedback}` : '',
    '输出要求：角色一致性优先于装饰性变化；准确执行人物、场景、动作和构图描述；保持稳定画质，避免多余人物、错位肢体和身份漂移。',
  ].filter(Boolean).join('\n\n');
}

export function resolveConsistencyModel(
  requestedModel: StoryboardGenerationModel,
  references: GenerationReference[],
  characterCount: number,
  smartRouting: boolean,
): { model: StoryboardGenerationModel; reason?: string } {
  if (!smartRouting || characterCount === 0) return { model: requestedModel };
  const characterReferenceCount = references.filter(reference => reference.type === 'character').length;
  const weakMultiReferenceModels = new Set<StoryboardGenerationModel>(['qwen', 'kontext', 'qwenN']);
  if (weakMultiReferenceModels.has(requestedModel) && (characterCount > 1 || references.length > 2)) {
    return {
      model: 'nanobanana',
      reason: `当前镜头包含 ${characterCount} 个角色 / ${references.length} 张参考图（角色 ${characterReferenceCount} 张），已优先使用支持多图参考的化神模型`,
    };
  }
  return { model: requestedModel };
}

export function reviewPassed(review?: StoryboardQualityReview): boolean {
  return review?.status === 'passed'
    && review.characterConsistencyScore >= 80
    && review.scriptComplianceScore >= 75;
}
