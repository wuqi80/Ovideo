import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../pages/MaterialsPage.tsx'), 'utf-8');

describe('MaterialsPage binding propagation', () => {
  it('asks before replacing the locked material on later matching shots', () => {
    expect(source).toContain('const [bindDialog, setBindDialog] = useState');
    expect(source).toContain('setBindDialog({ shotId, tagName, materialId, cascadeTargets })');
    expect(source).toContain('title="同步锁定后续镜头"');
    expect(source).toContain('confirmText="同步后续镜头"');
    expect(source).toContain('cancelText="仅当前镜头"');
  });

  it('can either update the current shot only or overwrite all later matching shots', () => {
    expect(source).toContain('const handleBindConfirm = useCallback');
    expect(source).toContain('const handleBindCurrentOnly = useCallback');
    expect(source).toContain("await persistNormalizedMaterialBinding(currentItem, tagName, materialId, 'project')");
    expect(source).toContain('await persistLegacyMaterialBinding(target, tagName, materialId)');
    expect(source).toContain('已仅更新当前镜头素材');
  });

  it('disables a binding that already applies to the current and all later matching shots', () => {
    expect(source).toContain('isMaterialSyncedToCurrentAndFollowing');
    expect(source).toContain('const isMaterialFullySynced = useCallback');
    expect(source).toContain('isMaterialFullySynced={isMaterialFullySynced}');
  });

  it('persists material-stage additions without overwriting design reference images', () => {
    expect(source).not.toContain('updateAsset as apiUpdateAsset');
    expect(source).not.toContain('reference_images: newUrls');
    expect(source).toContain("await linkEntityFile(material.fileId, 'asset', targetAssetId, 'material_image')");
    expect(source).toContain('const additions = materials.filter');
  });
});
