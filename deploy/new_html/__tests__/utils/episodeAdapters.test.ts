import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assetsToMaterialLibrary,
  applyStoryboardRecordPatch,
  dbItemToStoryboardItem,
  newShotToDbFields,
  normalizeStoryboardRecord,
  storyboardItemToDbUpdate,
} from '../../utils/episodeAdapters';

describe('EpisodeContext adapter wiring', () => {
  it('does not retain the removed safeObj runtime helper', () => {
    const source = readFileSync(resolve(__dirname, '../../contexts/EpisodeContext.tsx'), 'utf-8');
    expect(source).not.toContain('safeObj(');
    expect(source).toContain('generationParams: parseRecord(');
    expect(source).toContain('metadata: parseRecord(');
    expect(source).toContain('voiceParams: parseRecord(');
  });
});

describe('assetsToMaterialLibrary', () => {
  it('includes generated material_image files alongside reference images', () => {
    const library = assetsToMaterialLibrary([
      {
        assetId: 'asset_1',
        name: '小悟',
        referenceImages: ['/storage/legacy/original.webp', '/storage/generated/angle.webp'],
        thumbnailUrl: null,
        entityFiles: [
          {
            fileId: 'file_ref',
            fileUrl: '/storage/legacy/original.webp',
            fileType: 'image',
            fileRole: 'reference_image',
            createdAt: '2026-07-04T01:00:00',
          },
          {
            fileId: 'file_angle',
            fileUrl: '/storage/generated/angle.webp',
            fileType: 'image',
            fileRole: 'material_image',
            createdAt: '2026-07-04T02:00:00',
          },
        ],
      } as any,
    ]);

    expect(library['小悟']).toEqual([
      expect.objectContaining({
        id: 'asset_1_0',
        url: '/storage/legacy/original.webp',
        source: 'asset',
        fileId: 'file_ref',
      }),
      expect.objectContaining({
        id: 'asset_1_1',
        url: '/storage/generated/angle.webp',
        source: 'asset',
        fileId: 'file_angle',
      }),
    ]);
  });

  it('keeps legacy references before generated entity files for stable selection ids', () => {
    const library = assetsToMaterialLibrary([
      {
        assetId: 'asset_2',
        name: '角色A',
        referenceImages: ['/storage/legacy/original.webp'],
        thumbnailUrl: null,
        entityFiles: [
          {
            fileId: 'file_angle',
            fileUrl: '/storage/generated/angle.webp',
            fileType: 'image',
            fileRole: 'material_image',
            createdAt: '2026-07-04T02:00:00',
          },
        ],
      } as any,
    ]);

    expect(library['角色A']).toEqual([
      expect.objectContaining({
        id: 'asset_2_0',
        url: '/storage/legacy/original.webp',
      }),
      expect.objectContaining({
        id: 'asset_2_1',
        url: '/storage/generated/angle.webp',
        source: 'entity_file:material_image',
      }),
    ]);
  });
});

describe('prop storyboard bindings', () => {
  it('maps prop bound tags and selections into storyboard items', () => {
    const item = dbItemToStoryboardItem({
      itemId: 'sb_1',
      sceneHeading: '小悟拿起扇子',
      actionText: '桌边动作',
      dialogue: '',
      imagePrompt: '',
      videoPrompt: '',
      cameraMovement: '',
      generatedImageUrl: null,
      boundAssets: ['char:小悟', 'scene:办公室', 'prop:扇子', 'sel:扇子:asset_prop_0'],
      status: 'draft',
    } as any, [
      {
        assetId: 'asset_prop',
        assetType: 'prop',
        name: '扇子',
        referenceImages: ['/storage/fan.png'],
        thumbnailUrl: null,
        entityFiles: [],
      } as any,
    ]);

    expect(item.props).toEqual(['扇子']);
    expect(item.materialSelections?.['扇子']).toBe('asset_prop_0');
  });

  it('auto-selects prop materials even when the shot has no scene', () => {
    const item = dbItemToStoryboardItem({
      itemId: 'sb_1',
      sceneHeading: '小悟拿起扇子',
      actionText: '小悟拿起扇子',
      dialogue: '',
      imagePrompt: '',
      videoPrompt: '',
      cameraMovement: '',
      generatedImageUrl: null,
      boundAssets: ['prop:扇子'],
      status: 'draft',
    } as any, [
      {
        assetId: 'asset_prop',
        assetType: 'prop',
        name: '扇子',
        referenceImages: ['/storage/fan.png'],
        thumbnailUrl: null,
        entityFiles: [],
      } as any,
    ]);

    expect(item.scene).toBe('');
    expect(item.props).toEqual(['扇子']);
    expect(item.materialSelections?.['扇子']).toBe('asset_prop_0');
  });

  it('writes props back as prop bound asset tags', () => {
    const fields = newShotToDbFields({
      originalText: '小悟拿着扇子进入办公室',
      scriptSegment: '小悟入场',
      characters: ['小悟'],
      scene: '办公室',
      props: ['扇子'],
    } as any, 0);

    expect(fields.bound_assets).toEqual(['char:小悟', 'scene:办公室', 'prop:扇子']);
  });
});

describe('storyboard configured references', () => {
  const references = [{
    id: 'ref-1',
    url: '/storage/character.webp',
    type: 'character',
    name: '小悟',
    assetId: 'asset-1',
    fileId: 'file-1',
  }] as any;

  it('maps persisted configured references into the storyboard item', () => {
    const item = dbItemToStoryboardItem({
      itemId: 'sb_1',
      sceneHeading: '',
      actionText: '',
      dialogue: '',
      imagePrompt: '',
      videoPrompt: '',
      cameraMovement: '',
      generatedImageUrl: null,
      boundAssets: [],
      configuredReferences: references,
      status: 'draft',
    } as any);

    expect(item.configuredReferences).toEqual(references);
  });

  it('normalizes JSON encoded references and audio fields without dropping objects', () => {
    const item = normalizeStoryboardRecord({
      item_id: 'sb_1',
      episode_id: 'ep_1',
      sort_order: 2,
      bound_assets: JSON.stringify(['char:hero']),
      configured_references: JSON.stringify(references),
      dialogue_audio_url: '/audio/dialogue.mp3',
      planned_duration_ms: 4200,
    });

    expect(item.boundAssets).toEqual(['char:hero']);
    expect(item.configuredReferences).toEqual(references);
    expect(item.dialogueAudioUrl).toBe('/audio/dialogue.mp3');
    expect(item.plannedDurationMs).toBe(4200);
  });

  it('applies snake-case patches while preserving references and audio metadata', () => {
    const item = normalizeStoryboardRecord({
      item_id: 'sb_1',
      episode_id: 'ep_1',
      configured_references: references,
      dialogue_audio_url: '/audio/dialogue.mp3',
      bound_assets: ['char:hero'],
    });
    const patched = applyStoryboardRecordPatch(item, {
      image_prompt: 'updated prompt',
      bound_assets: ['char:hero', 'scene:classroom'],
    });

    expect(patched.imagePrompt).toBe('updated prompt');
    expect(patched.boundAssets).toEqual(['char:hero', 'scene:classroom']);
    expect(patched.configuredReferences).toEqual(references);
    expect(patched.dialogueAudioUrl).toBe('/audio/dialogue.mp3');
  });

  it('writes configured references for updates and new shots', () => {
    expect(storyboardItemToDbUpdate({ configuredReferences: references } as any))
      .toEqual({ configured_references: references });
    expect(newShotToDbFields({
      originalText: '',
      scriptSegment: '',
      configuredReferences: references,
    } as any, 0).configured_references).toEqual(references);
  });
});
