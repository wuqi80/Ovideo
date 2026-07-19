import { describe, expect, it } from 'vitest';

import type { MaterialLibrary, StoryboardItem } from '../../types';
import {
  buildIdentityAnchoredPrompt,
  resolveConsistencyModel,
  resolveShotReferencePlan,
  resolveShotReferences,
} from '../../utils/storyboardConsistency';

const library: MaterialLibrary = {
  女1: [
    {
      id: 'char_0', url: '/storage/char/old.png', type: 'image', source: 'asset', timestamp: 1,
      name: '女1', description: '冷静的女总裁', styleParams: {}, isIdentityReference: true,
    },
    {
      id: 'char_1', url: '/storage/char/bound.png', type: 'image', source: 'asset', timestamp: 2,
      assetId: 'asset-char', fileId: 'file-char',
      name: '女1', description: '冷静的女总裁',
      styleParams: { identity_anchor: { hair: '黑色齐肩直发', outfit: '黑色西装' } },
    },
  ],
  客厅: [{ id: 'scene_0', url: '/storage/scene.png', type: 'image', source: 'asset', timestamp: 1, name: '客厅' }],
};

const shot: StoryboardItem = {
  id: 'shot_1',
  originalText: '',
  scriptSegment: '女1坐在沙发上翻阅文件',
  imagePrompt: '中景，女1坐在沙发上',
  characters: ['女1'],
  scene: '客厅',
  props: [],
  materialSelections: { 女1: 'char_1', 客厅: 'scene_0' },
};

describe('storyboard consistency', () => {
  it('uses the existing material binding as the fixed character reference', () => {
    const refs = resolveShotReferences(shot, library);
    expect(refs[0]).toMatchObject({
      url: '/storage/char/bound.png',
      assetId: 'asset-char',
      fileId: 'file-char',
      name: '女1',
      source: 'identity_anchor',
      isLocked: true,
    });
    expect(refs[1]).toMatchObject({ url: '/storage/scene.png', source: 'material_binding' });
  });

  it('honors explicit unbinding and preserves manual references', () => {
    const refs = resolveShotReferences(
      { ...shot, materialSelections: {} },
      library,
      [{ id: 'manual', url: '/storage/manual.png', type: 'pose', source: 'manual' }],
    );
    expect(refs).toEqual([expect.objectContaining({ id: 'manual', url: '/storage/manual.png' })]);
  });

  it('does not reuse another character material when the saved binding is missing', () => {
    const staleBindingShot = {
      ...shot,
      materialSelections: { ...shot.materialSelections, 女1: 'missing_material' },
    };
    const refs = resolveShotReferences(staleBindingShot, library);
    const prompt = buildIdentityAnchoredPrompt(staleBindingShot, staleBindingShot.imagePrompt || '', library);

    expect(refs.some(item => item.type === 'character')).toBe(false);
    expect(prompt).not.toContain('冷静的女总裁');
    expect(prompt).not.toContain('黑色齐肩直发');
  });

  it('replaces legacy auto references after the material binding changes', () => {
    const refs = resolveShotReferences(shot, library, [
      { id: 'old-auto', url: '/storage/char/old.png', type: 'character', name: '女1' },
      { id: 'manual', url: '/storage/manual.png', type: 'pose', name: '构图参考' },
    ]);
    expect(refs.map(item => item.url)).toEqual([
      '/storage/char/bound.png',
      '/storage/scene.png',
      '/storage/manual.png',
    ]);
  });

  it('adds bound asset identity fields to the generation prompt', () => {
    const refs = resolveShotReferences(shot, library);
    const prompt = buildIdentityAnchoredPrompt(shot, shot.imagePrompt || '', library, '', refs);
    expect(prompt).toContain('冷静的女总裁');
    expect(prompt).toContain('黑色齐肩直发');
    expect(prompt).toContain('黑色西装');
    expect(prompt).toContain('女1坐在沙发上翻阅文件');
    expect(prompt).toContain('参考图1 = 角色身份锚点（最高优先级）【女1】');
    expect(prompt).toContain('必须生成该参考图中的同一人物');
    expect(prompt).toContain('参考图2 = 场景参考【客厅】');
  });

  it('prefers the multi-reference model for weak multi-character routes', () => {
    const refs = [
      { id: '1', url: '/1.png', type: 'character' as const },
      { id: '2', url: '/2.png', type: 'character' as const },
      { id: '3', url: '/3.png', type: 'character' as const },
    ];
    expect(resolveConsistencyModel('qwen', refs, 2, true)).toMatchObject({ model: 'nanobanana' });
    expect(resolveConsistencyModel('qwen', refs, 2, false)).toEqual({ model: 'qwen' });
  });

  it('reports every reference excluded by the provider capacity', () => {
    const crowdedLibrary: MaterialLibrary = {};
    const characters = Array.from({ length: 7 }, (_, index) => `角色${index + 1}`);
    const materialSelections: Record<string, string> = {};
    for (const [index, name] of characters.entries()) {
      const id = `character_${index + 1}`;
      materialSelections[name] = id;
      crowdedLibrary[name] = [{
        id,
        url: `/storage/characters/${index + 1}.png`,
        type: 'image',
        source: 'asset',
        timestamp: index,
        name,
      }];
    }

    const plan = resolveShotReferencePlan({
      ...shot,
      characters,
      scene: '',
      materialSelections,
    }, crowdedLibrary, [], 6);

    expect(plan.references).toHaveLength(6);
    expect(plan.excluded).toEqual([
      expect.objectContaining({
        isCritical: true,
        reference: expect.objectContaining({ name: '角色7', url: '/storage/characters/7.png' }),
      }),
    ]);
    expect(plan.criticalExcluded).toHaveLength(1);
  });

  it('does not mark an omitted manual or prop reference as critical', () => {
    const manual = Array.from({ length: 6 }, (_, index) => ({
      id: `manual_${index}`,
      url: `/storage/manual/${index}.png`,
      type: 'pose' as const,
      name: `构图${index + 1}`,
      source: 'manual' as const,
    }));
    const plan = resolveShotReferencePlan(shot, library, manual, 2);

    expect(plan.references.map(item => item.type)).toEqual(['character', 'scene']);
    expect(plan.excluded).toHaveLength(6);
    expect(plan.criticalExcluded).toHaveLength(0);
  });
});
