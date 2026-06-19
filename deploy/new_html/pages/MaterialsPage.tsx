import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';
import { MaterialPage } from '../components/MaterialPage';
import {
  scriptToProjectFile,
  assetsToMaterialLibrary,
  dbItemToStoryboardItem,
} from '../utils/episodeAdapters';
import {
  getStoryboardItems,
  updateStoryboardItem as apiUpdateStoryboardItem,
  updateAsset as apiUpdateAsset,
  createAsset as apiCreateAsset,
} from '../services/apiService';
import { Image as ImageIcon, Loader } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { MaterialLibrary, Material, FileVersion, StoryboardItemDB } from '../types';

function safeBoundAssets(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    } catch {}
  }
  return [];
}

function normalizeMaterialsStoryboardItem(r: any): StoryboardItemDB {
  return {
    itemId: r.item_id ?? r.itemId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    sceneHeading: r.scene_heading ?? r.sceneHeading ?? '',
    actionText: r.action_text ?? r.actionText ?? '',
    dialogue: r.dialogue ?? '',
    cameraMovement: r.camera_movement ?? r.cameraMovement ?? '',
    imagePrompt: r.image_prompt ?? r.imagePrompt ?? '',
    videoPrompt: r.video_prompt ?? r.videoPrompt ?? '',
    generatedImageUrl: r.generated_image_url ?? r.generatedImageUrl ?? null,
    boundAssets: safeBoundAssets(r.bound_assets ?? r.boundAssets),
    status: r.status ?? 'draft',
    dialogueAudioUrl: null,
    narrationAudioUrl: null,
    sfxAudioUrl: null,
    audioDurationMs: null,
    plannedDurationMs: null,
  };
}

function applyMaterialsStoryboardPatch(item: StoryboardItemDB, patch: Record<string, any>): StoryboardItemDB {
  return {
    ...item,
    sceneHeading: patch.scene_heading ?? patch.sceneHeading ?? item.sceneHeading,
    actionText: patch.action_text ?? patch.actionText ?? item.actionText,
    dialogue: patch.dialogue ?? item.dialogue,
    cameraMovement: patch.camera_movement ?? patch.cameraMovement ?? item.cameraMovement,
    imagePrompt: patch.image_prompt ?? patch.imagePrompt ?? item.imagePrompt,
    videoPrompt: patch.video_prompt ?? patch.videoPrompt ?? item.videoPrompt,
    generatedImageUrl: patch.generated_image_url ?? patch.generatedImageUrl ?? item.generatedImageUrl,
    boundAssets: patch.bound_assets !== undefined || patch.boundAssets !== undefined
      ? safeBoundAssets(patch.bound_assets ?? patch.boundAssets)
      : item.boundAssets,
    status: patch.status ?? item.status,
  };
}

export const MaterialsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    episodeId, projectId, selectedScriptId,
    script, assets,
    isLoading, error,
    forceReloadSlices,
  } = useEpisode();
  const [storyboardItems, setStoryboardItems] = useState<StoryboardItemDB[]>([]);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);

  // 2026-06-14：进入素材页强制刷新，保证跨页（设计/分镜）改动能看到最新数据。
  // 2026-06-19：storyboard 改为 fields=materials 的轻量直拉，避免整行分镜数据进入 context。
  useEffect(() => {
    forceReloadSlices('assets', 'script');
  }, [forceReloadSlices]);

  useEffect(() => {
    let active = true;
    if (!episodeId) {
      setStoryboardItems([]);
      return () => { active = false; };
    }
    setStoryboardLoading(true);
    setStoryboardError(null);
    getStoryboardItems(episodeId, selectedScriptId || undefined, { fields: 'materials' })
      .then(res => {
        if (!active) return;
        setStoryboardItems(res.success ? (res.items || []).map(normalizeMaterialsStoryboardItem) : []);
      })
      .catch(err => {
        console.warn('storyboard material fields load failed:', err);
        if (active) {
          setStoryboardItems([]);
          setStoryboardError(err?.message || '素材绑定分镜数据加载失败');
        }
      })
      .finally(() => {
        if (active) setStoryboardLoading(false);
      });
    return () => { active = false; };
  }, [episodeId, selectedScriptId]);

  const updateMaterialsStoryboardItem = useCallback(async (itemId: string, data: Record<string, any>) => {
    await apiUpdateStoryboardItem(itemId, data);
    setStoryboardItems(prev => prev.map(item =>
      item.itemId === itemId ? applyMaterialsStoryboardPatch(item, data) : item
    ));
  }, []);

  const pseudoFile = useMemo(
    () => scriptToProjectFile(script, storyboardItems, assets, episodeId),
    [script, storyboardItems, assets, episodeId],
  );

  const materialLibraryFromDb = useMemo(
    () => assetsToMaterialLibrary(assets) as MaterialLibrary,
    [assets],
  );

  const effectiveLibrary = materialLibraryFromDb;

  const assetNameToId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of assets) {
      map[a.name] = a.assetId;
    }
    return map;
  }, [assets]);

  // Auto-patch: add char:/scene: tags to storyboard items that lack them
  const patchedRef = useRef(false);
  useEffect(() => {
    if (patchedRef.current || !storyboardItems.length || !assets.length) return;
    const charAssets = assets.filter(a => a.assetType === 'character' && a.name);
    const sceneAssets = assets.filter(a => a.assetType === 'scene' && a.name);
    if (!charAssets.length && !sceneAssets.length) return;

    const needsPatch = storyboardItems.filter(item => {
      const bound = Array.isArray(item.boundAssets) ? item.boundAssets : [];
      return !bound.some((b: string) => typeof b === 'string' && (b.startsWith('char:') || b.startsWith('scene:')));
    });
    if (!needsPatch.length) return;

    patchedRef.current = true;
    const doPatch = async () => {
      let patched = 0;
      for (const item of needsPatch) {
        const searchText = [
          item.sceneHeading, item.actionText, item.dialogue,
          (item as any).imagePrompt, (item as any).videoPrompt,
        ].filter(Boolean).join(' ');
        const existing = Array.isArray(item.boundAssets) ? [...item.boundAssets] : [];
        const tags = [...existing];

        const matchedChars = searchText
          ? charAssets.filter(a => searchText.includes(a.name))
          : charAssets;
        tags.push(...matchedChars.map(a => `char:${a.name}`));

        const matchedScene = searchText
          ? sceneAssets.find(a => searchText.includes(a.name))
          : (sceneAssets.length === 1 ? sceneAssets[0] : undefined);
        if (matchedScene) tags.push(`scene:${matchedScene.name}`);

        if (tags.length > existing.length) {
          try {
            await updateMaterialsStoryboardItem(item.itemId, { bound_assets: tags, boundAssets: tags });
            patched++;
          } catch (e) {
            console.error('Auto-patch bound_assets failed:', e);
          }
        }
      }
      if (patched > 0) {
        console.log(`Auto-patched ${patched} storyboard items with char/scene tags`);
      }
    };
    doPatch();
  }, [storyboardItems, assets, updateMaterialsStoryboardItem]);

  const handleUpdateLibrary = useCallback(async (newLibrary: MaterialLibrary) => {

    for (const [tagName, materials] of Object.entries(newLibrary)) {
      const assetId = assetNameToId[tagName];
      if (!assetId) {
        const newUrls = materials.map(m => m.url).filter(Boolean);
        if (newUrls.length > 0) {
          try {
            const assetType = storyboardItems.some(si => {
              const converted = dbItemToStoryboardItem(si, assets);
              return converted.characters.includes(tagName);
            }) ? 'character' : 'scene';

            await apiCreateAsset({
              project_id: projectId,
              episode_id: episodeId,
              script_id: selectedScriptId || undefined,
              asset_type: assetType,
              name: tagName,
              reference_images: newUrls,
            });
          } catch (e) {
            console.error('创建素材失败:', e);
          }
        }
        continue;
      }

      const currentAsset = assets.find(a => a.assetId === assetId);
      const currentUrls = currentAsset?.referenceImages || [];
      const newUrls = materials.map(m => m.url).filter(Boolean);

      const urlsChanged =
        currentUrls.length !== newUrls.length ||
        currentUrls.some((u, i) => u !== newUrls[i]);

      if (urlsChanged) {
        try {
          await apiUpdateAsset(assetId, { reference_images: newUrls });
        } catch (e) {
          console.error('更新素材图片失败:', e);
        }
      }
    }

    await forceReloadSlices('assets');
  }, [assetNameToId, assets, storyboardItems, projectId, episodeId, selectedScriptId, forceReloadSlices]);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>(0);

  const [unbindDialog, setUnbindDialog] = useState<{
    shotId: string;
    tagName: string;
    cascadeTargets: typeof storyboardItems;
  } | null>(null);

  const handleBindMaterial = useCallback(async (shotId: string, tagName: string, materialId: string) => {
    const currentIndex = storyboardItems.findIndex(si => si.itemId === shotId);
    const item = storyboardItems[currentIndex];
    if (!item || currentIndex < 0) return;

    const asset = assets.find(a => a.name === tagName);
    const prefix = asset?.assetType === 'scene' ? 'scene' : 'char';
    const tagEntry = `${prefix}:${tagName}`;

    const buildBoundAssets = (si: typeof item) => {
      const currentBound = Array.isArray(si.boundAssets) ? [...si.boundAssets] : [];
      if (!currentBound.includes(tagEntry)) {
        currentBound.push(tagEntry);
      }
      const rawId = assetNameToId[tagName];
      const cleaned = currentBound.filter(id =>
        !id.startsWith(`sel:${tagName}:`) && id !== rawId && id !== `nosel:${tagName}`
      );
      cleaned.push(`sel:${tagName}:${materialId}`);
      return cleaned;
    };

    try {
      const cleaned = buildBoundAssets(item);
      await updateMaterialsStoryboardItem(shotId, { bound_assets: cleaned, boundAssets: cleaned });
    } catch (e) {
      console.error('绑定素材失败:', e);
      return;
    }

    let cascadeCount = 0;
    for (let i = currentIndex + 1; i < storyboardItems.length; i++) {
      const si = storyboardItems[i];
      const bound = Array.isArray(si.boundAssets) ? si.boundAssets : [];
      const hasTag = bound.some((b: string) => b === `char:${tagName}` || b === `scene:${tagName}`);
      if (!hasTag) continue;
      const alreadyBound = bound.some((b: string) => b.startsWith(`sel:${tagName}:`));
      if (alreadyBound) continue;

      try {
        const newBound = buildBoundAssets(si);
        await updateMaterialsStoryboardItem(si.itemId, { bound_assets: newBound, boundAssets: newBound });
        cascadeCount++;
      } catch (e) {
        console.error(`级联绑定镜头${i + 1}失败:`, e);
      }
    }

    if (cascadeCount > 0) {
      setToastMsg(`已同步绑定到后续 ${cascadeCount} 个镜头`);
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToastMsg(null), 3000);
    }
  }, [storyboardItems, assets, assetNameToId, updateMaterialsStoryboardItem]);

  const handleUnbindMaterial = useCallback(async (shotId: string, tagName: string) => {
    const currentIndex = storyboardItems.findIndex(si => si.itemId === shotId);
    const item = storyboardItems[currentIndex];
    if (!item || currentIndex < 0) return;

    let cascadeTargets: typeof storyboardItems = [];
    for (let i = currentIndex + 1; i < storyboardItems.length; i++) {
      const si = storyboardItems[i];
      const bound = Array.isArray(si.boundAssets) ? si.boundAssets : [];
      if (bound.some((b: string) => b.startsWith(`sel:${tagName}:`))) {
        cascadeTargets.push(si);
      }
    }

    if (cascadeTargets.length > 0) {
      setUnbindDialog({ shotId, tagName, cascadeTargets });
      return;
    }

    const assetId = assetNameToId[tagName];
    const currentBound = Array.isArray(item.boundAssets) ? item.boundAssets : [];
    const filtered = currentBound.filter((id: string) =>
      id !== assetId &&
      !id.startsWith(`sel:${tagName}:`) &&
      id !== `nosel:${tagName}`
    );
    filtered.push(`nosel:${tagName}`);
    try {
      await updateMaterialsStoryboardItem(shotId, { bound_assets: filtered, boundAssets: filtered });
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [storyboardItems, assetNameToId, updateMaterialsStoryboardItem]);

  const handleUnbindConfirm = useCallback(async () => {
    if (!unbindDialog) return;
    const { shotId, tagName, cascadeTargets } = unbindDialog;
    setUnbindDialog(null);

    const unbindItem = async (itemId: string, boundAssets: string[]) => {
      const assetId = assetNameToId[tagName];
      const filtered = boundAssets.filter((id: string) =>
        id !== assetId &&
        !id.startsWith(`sel:${tagName}:`) &&
        id !== `nosel:${tagName}`
      );
      filtered.push(`nosel:${tagName}`);
      await updateMaterialsStoryboardItem(itemId, { bound_assets: filtered, boundAssets: filtered });
    };

    try {
      const currentItem = storyboardItems.find(si => si.itemId === shotId);
      if (currentItem) {
        await unbindItem(currentItem.itemId, Array.isArray(currentItem.boundAssets) ? currentItem.boundAssets : []);
      }
      for (const si of cascadeTargets) {
        try {
          await unbindItem(si.itemId, Array.isArray(si.boundAssets) ? si.boundAssets : []);
        } catch (e) {
          console.error('级联解绑镜头失败:', e);
        }
      }
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [unbindDialog, storyboardItems, assetNameToId, updateMaterialsStoryboardItem]);

  const handleUnbindCancel = useCallback(async () => {
    if (!unbindDialog) return;
    const { shotId, tagName } = unbindDialog;
    setUnbindDialog(null);

    const currentItem = storyboardItems.find(si => si.itemId === shotId);
    if (!currentItem) return;

    const assetId = assetNameToId[tagName];
    const currentBound = Array.isArray(currentItem.boundAssets) ? currentItem.boundAssets : [];
    const filtered = currentBound.filter((id: string) =>
      id !== assetId &&
      !id.startsWith(`sel:${tagName}:`) &&
      id !== `nosel:${tagName}`
    );
    filtered.push(`nosel:${tagName}`);

    try {
      await updateMaterialsStoryboardItem(shotId, { bound_assets: filtered, boundAssets: filtered });
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [unbindDialog, storyboardItems, assetNameToId, updateMaterialsStoryboardItem]);

  const handleNextStep = useCallback(() => {
    navigate(`/projects/${projectId}/ep/${episodeId}/workflow/audio`);
  }, [navigate, projectId, episodeId]);

  const noopSaveVersion = useCallback((_name: string) => {}, []);
  const noopRestoreVersion = useCallback((_v: FileVersion) => {}, []);
  const noopDeleteVersion = useCallback((_id: string) => {}, []);
  const noopImportProject = useCallback(() => {}, []);

  if (isLoading || storyboardLoading) {
    return (
      <div className="flex items-center justify-center h-full text-n300">
        <div className="animate-pulse flex items-center gap-2">
          <Loader className="w-5 h-5 animate-spin" />
          <span>加载素材数据...</span>
        </div>
      </div>
    );
  }

  if (error || storyboardError) {
    return (
      <div className="flex items-center justify-center h-full text-danger p-6">
        <p>{error || storyboardError}</p>
      </div>
    );
  }

  if (!pseudoFile.storyboard || pseudoFile.storyboard.items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-n300">
        <div className="text-center space-y-3">
          <ImageIcon className="w-12 h-12 mx-auto text-primary" />
          <p className="text-xl font-medium text-n700">素材绑定</p>
          <p className="text-sm text-n100">暂无分镜数据，请先在设计页面创建分镜</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <MaterialPage
        files={[pseudoFile]}
        selectedFileId={episodeId}
        materialLibrary={effectiveLibrary}
        onUpdateLibrary={handleUpdateLibrary}
        onBindMaterial={handleBindMaterial}
        onUnbindMaterial={handleUnbindMaterial}
        onNextStep={handleNextStep}
        onSaveVersion={noopSaveVersion}
        onRestoreVersion={noopRestoreVersion}
        onDeleteVersion={noopDeleteVersion}
        onImportProject={noopImportProject}
        hideVersionArchive
        assetNameToId={assetNameToId}
      />
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-success text-white text-sm rounded-lg shadow-bottom">
          {toastMsg}
        </div>
      )}
      {unbindDialog && (
        <ConfirmDialog
          open={!!unbindDialog}
          onConfirm={handleUnbindConfirm}
          onCancel={handleUnbindCancel}
          title="解除素材绑定"
          message={`确定要解除当前镜头「${unbindDialog.tagName}」的素材绑定吗？`}
          detail={
            <div className="space-y-2">
              <p className="text-xs text-warning font-medium">
                后续还有 {unbindDialog.cascadeTargets.length} 个镜头绑定了同一素材
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unbindDialog.cascadeTargets.slice(0, 8).map((si, i) => (
                  <span key={si.itemId} className="text-[10px] bg-n30 text-warning px-2 py-0.5 rounded-md">
                    镜头 {storyboardItems.indexOf(si) + 1}
                  </span>
                ))}
                {unbindDialog.cascadeTargets.length > 8 && (
                  <span className="text-[10px] text-warning">
                    +{unbindDialog.cascadeTargets.length - 8} 个
                  </span>
                )}
              </div>
            </div>
          }
          confirmText="全部解绑"
          cancelText="仅当前镜头"
          variant="warning"
        />
      )}
    </>
  );
};
