import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/MaterialPage.tsx'), 'utf-8');

describe('MaterialPage workspace layout', () => {
  it('keeps the shot context collapsed by default and exposes an explicit toggle', () => {
    expect(source).toContain('const [isContextExpanded, setIsContextExpanded] = usePersistedPageState<boolean>');
    expect(source).toContain("page: 'MaterialPage:shotContext'");
    expect(source).toContain('episodeId: selectedFileId');
    expect(source).toContain('defaultValue: false');
    expect(source).toContain('aria-controls="material-shot-context"');
    expect(source).toContain("{isContextExpanded ? '收起提示词' : '展开提示词'}");
    expect(source).toContain('{isContextExpanded && (');
  });

  it('shows up to three cards per row inside every material category on desktop', () => {
    expect(source).toContain('data-testid="material-category-grid"');
    expect(source).toContain('data-testid="material-character-cards"');
    expect(source).toContain('data-testid="material-scene-cards"');
    expect(source).toContain('data-testid="material-prop-cards"');
    expect(source).toContain('grid grid-cols-1 lg:grid-cols-3');
    expect(source).toContain('aria-labelledby="material-characters-heading"');
    expect(source).toContain('aria-labelledby="material-scene-heading"');
    expect(source).toContain('aria-labelledby="material-props-heading"');
  });

  it('keeps one material row scrollbar-free and uses compact image-operation controls', () => {
    expect(source).toContain("materials.length > 3 ? 'max-h-[104px] overflow-y-auto custom-scrollbar' : 'overflow-hidden'");
    expect(source).toContain('className={`relative group/item h-20');
    expect(source).toContain('<span>AI 生图</span>');
    expect(source).toContain('<span>角度</span>');
    expect(source).toContain('<span>高清放大</span>');
    expect(source).toContain('<span>去水印</span>');
    expect(source).toContain('<span>四视图</span>');
  });

  it('uses the same preview and green-border thumbnail picker for four-view generation', () => {
    expect(source).toContain('左侧：当前素材预览与统一缩略图选择');
    expect(source).toContain("selectedMaterialId === mat.id");
    expect(source).toContain("'border-success ring-2 ring-success/30'");
    expect(source).toContain('className="w-full h-72');
  });

  it('stores every material-stage image as an independent material_image entity file', () => {
    expect(source).toContain("targetAssetId ? 'asset' : 'storyboard_item'");
    expect(source).toContain("'material_image'");
    expect(source).toContain('fileId: saved.fileId');
    expect(source).toContain('fileId: r.fileId');
    expect(source).toContain('fileId: results[0]?.fileId');
    expect(source).toContain('fileId: results[0].fileId');
  });

  it('only deletes images created by the material stage', () => {
    expect(source).toContain("targetMaterial.source === 'entity_file:material_image'");
    expect(source).toContain("targetMaterial.source === 'ai'");
    expect(source).toContain("targetMaterial.source === 'upload'");
    expect(source).toContain('await deleteEntityFile(targetMaterial.fileId)');
  });
});
