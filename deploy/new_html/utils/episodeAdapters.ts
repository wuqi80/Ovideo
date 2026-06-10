/**
 * 适配层：在 Episode DB 模型 和 旧 ProjectFile/StoryboardItem 模型之间转换。
 * 旧组件（ScriptColumn, StoryboardColumn, MaterialPage, GenerationPage）
 * 期望 ProjectFile 格式的数据，本模块提供双向转换。
 */
import type {
  StoryboardItemDB, EpisodeScript, AssetItem,
  ProjectFile, StoryboardItem, StoryboardData,
  FileStatus, FileVersion, GeneratedImage,
} from '../types';

const CHAR_PREFIX = 'char:';
const SCENE_PREFIX = 'scene:';
const SEL_PREFIX = 'sel:';
const NOSEL_PREFIX = 'nosel:';

export function parseBoundAssetTags(boundAssets: string[]): {
  charNames: string[];
  sceneName: string;
  assetIds: string[];
  selections: Record<string, string>;
  noSelections: Set<string>;
} {
  const charNames: string[] = [];
  let sceneName = '';
  const assetIds: string[] = [];
  const selections: Record<string, string> = {};
  const noSelections = new Set<string>();
  for (const entry of boundAssets) {
    if (entry.startsWith(CHAR_PREFIX)) {
      charNames.push(entry.slice(CHAR_PREFIX.length));
    } else if (entry.startsWith(SCENE_PREFIX)) {
      sceneName = entry.slice(SCENE_PREFIX.length);
    } else if (entry.startsWith(SEL_PREFIX)) {
      const rest = entry.slice(SEL_PREFIX.length);
      const idx = rest.indexOf(':');
      if (idx > 0) {
        selections[rest.slice(0, idx)] = rest.slice(idx + 1);
      }
    } else if (entry.startsWith(NOSEL_PREFIX)) {
      noSelections.add(entry.slice(NOSEL_PREFIX.length));
    } else {
      assetIds.push(entry);
    }
  }
  return { charNames, sceneName, assetIds, selections, noSelections };
}

function assetHasImages(asset: AssetItem): boolean {
  const ef = (asset.entityFiles || []).filter(f => f.fileRole === 'reference_image');
  if (ef.length > 0) return true;
  const refs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
  return refs.length > 0 || !!asset.thumbnailUrl;
}

export function dbItemToStoryboardItem(item: StoryboardItemDB, assets?: AssetItem[]): StoryboardItem {
  const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
  const { charNames, sceneName, assetIds, selections, noSelections } = parseBoundAssetTags(boundAssets);

  let characters = charNames;
  let scene = sceneName;

  if (assets && assetIds.length > 0) {
    const boundChars = assets
      .filter(a => assetIds.includes(a.assetId) && a.assetType === 'character')
      .map(a => a.name);
    if (boundChars.length > 0) {
      const merged = new Set([...characters, ...boundChars]);
      characters = Array.from(merged);
    }
    if (!scene) {
      scene = assets.find(a => assetIds.includes(a.assetId) && a.assetType === 'scene')?.name || '';
    }
  }

  if (assets && (characters.length === 0 || !scene)) {
    const searchText = [
      item.sceneHeading, item.actionText, item.dialogue,
      item.imagePrompt, item.videoPrompt,
    ].filter(Boolean).join(' ');
    if (searchText && characters.length === 0) {
      characters = assets
        .filter(a => a.assetType === 'character' && a.name && searchText.includes(a.name))
        .map(a => a.name);
    }
    if (searchText && !scene) {
      scene = assets
        .find(a => a.assetType === 'scene' && a.name && searchText.includes(a.name))
        ?.name || '';
    }
  }

  // Last resort: if text fields are empty (old buggy data), assign all characters
  if (assets && characters.length === 0) {
    const allChars = assets.filter(a => a.assetType === 'character' && a.name);
    if (allChars.length > 0) characters = allChars.map(a => a.name);
  }
  if (assets && !scene) {
    const allScenes = assets.filter(a => a.assetType === 'scene' && a.name);
    if (allScenes.length === 1) scene = allScenes[0].name;
  }

  const generatedImages: GeneratedImage[] = item.generatedImageUrl
    ? [{ id: `gen_${item.itemId}`, url: item.generatedImageUrl, timestamp: Date.now() }]
    : [];

  const materialSelections: Record<string, string> = {};
  if (assets) {
    for (const charName of characters) {
      if (selections[charName]) {
        materialSelections[charName] = selections[charName];
        continue;
      }
      if (noSelections.has(charName)) continue;
      const asset = assets.find(a => a.assetType === 'character' && a.name === charName);
      if (asset && assetHasImages(asset)) {
        materialSelections[charName] = `${asset.assetId}_0`;
      }
    }
    if (scene) {
      if (selections[scene]) {
        materialSelections[scene] = selections[scene];
      } else if (noSelections.has(scene)) {
        // 用户已显式解绑此场景，不自动回退
      } else {
        const sceneAsset = assets.find(a => a.assetType === 'scene' && a.name === scene);
        if (sceneAsset && assetHasImages(sceneAsset)) {
          materialSelections[scene] = `${sceneAsset.assetId}_0`;
        }
      }
    }
  }

  return {
    id: item.itemId,
    originalText: item.sceneHeading || '',
    scriptSegment: item.actionText || '',
    characters,
    scene,
    dialogue: item.dialogue || '',
    imagePrompt: item.imagePrompt || '',
    videoPrompt: item.videoPrompt || '',
    cameraMovement: item.cameraMovement,
    generatedImage: item.generatedImageUrl || undefined,
    generatedImages,
    selectedImageId: generatedImages.length > 0 ? generatedImages[0].id : undefined,
    materialSelections,
    boundCharNames: charNames,
    boundSceneName: sceneName,
    isLocked: item.status === 'locked',
    status: item.status,
  };
}

export function dbItemsToStoryboardData(items: StoryboardItemDB[], assets?: AssetItem[]): StoryboardData {
  return {
    items: items
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(item => dbItemToStoryboardItem(item, assets)),
  };
}

/**
 * 写入端守卫：generated_image_url 必须是持久化 URL。
 * data:/blob: 等内联或临时 URL 会撑爆 DB 字段并触发下游 414 / 视频页空白。
 * 详见 docs/conventions.md § Data URL Prohibition、docs/faq.md。
 */
function isPersistentImageUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u) return false;
  if (u.startsWith('data:')) return false;
  if (u.startsWith('blob:')) return false;
  return u.startsWith('http') || u.startsWith('/');
}

export function storyboardItemToDbUpdate(updates: Partial<StoryboardItem>): Record<string, any> {
  const result: Record<string, any> = {};
  if (updates.originalText !== undefined) result.scene_heading = updates.originalText;
  if (updates.scriptSegment !== undefined) result.action_text = updates.scriptSegment;
  if (updates.dialogue !== undefined) result.dialogue = updates.dialogue;
  if (updates.imagePrompt !== undefined) result.image_prompt = updates.imagePrompt;
  if (updates.videoPrompt !== undefined) result.video_prompt = updates.videoPrompt;
  if (updates.isLocked !== undefined) result.status = updates.isLocked ? 'locked' : 'draft';
  if (updates.generatedImage !== undefined) {
    if (updates.generatedImage === null || isPersistentImageUrl(updates.generatedImage)) {
      result.generated_image_url = updates.generatedImage;
    } else {
      console.warn(
        '[episodeAdapters] storyboardItemToDbUpdate: 拒绝把非持久化 URL 写入 generated_image_url',
        { sample: String(updates.generatedImage).slice(0, 60) }
      );
    }
  }
  if ((updates as any).cameraMovement !== undefined) result.camera_movement = (updates as any).cameraMovement;
  if (updates.isConfigConfirmed !== undefined) result.is_config_confirmed = updates.isConfigConfirmed;
  return result;
}

export function newShotToDbFields(shot: Omit<StoryboardItem, 'id'>, sortOrder: number): Record<string, any> {
  return {
    sort_order: sortOrder,
    scene_heading: shot.originalText || '',
    action_text: shot.scriptSegment || '',
    dialogue: shot.dialogue || '',
    camera_movement: (shot as any).cameraMovement || '',
    image_prompt: shot.imagePrompt || '',
    video_prompt: shot.videoPrompt || '',
    bound_assets: [
      ...(shot.characters || []).map((c: string) => `${CHAR_PREFIX}${c}`),
      ...(shot.scene ? [`${SCENE_PREFIX}${shot.scene}`] : []),
    ],
  };
}

export function scriptToProjectFile(
  script: EpisodeScript | null,
  items: StoryboardItemDB[],
  assets: AssetItem[],
  episodeId: string,
): ProjectFile {
  return {
    id: episodeId,
    name: '当前集',
    originalContent: script?.originalContent || '',
    scriptContent: script?.adaptedScript || null,
    storyboard: items.length > 0 ? dbItemsToStoryboardData(items, assets) : null,
    extractedCharacters: script?.metadata?.extracted_characters || [],
    extractedScenes: script?.metadata?.extracted_scenes || [],
    status: 'Idle' as FileStatus,
    lastUpdated: Date.now(),
    versions: [],
  };
}

export function assetsToMaterialLibrary(assets: AssetItem[]): Record<string, Array<{ id: string; url: string; thumbnail?: string; name: string; source: string }>> {
  const lib: Record<string, Array<{ id: string; url: string; thumbnail?: string; name: string; source: string }>> = {};
  for (const asset of assets) {
    const key = asset.name;
    if (!lib[key]) lib[key] = [];

    const efImages = (asset.entityFiles || [])
      .filter(f => f.fileRole === 'reference_image')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (efImages.length > 0) {
      efImages.forEach((f, i) => {
        lib[key].push({
          id: `${asset.assetId}_${i}`,
          url: f.fileUrl,
          thumbnail: i === 0 ? (asset.thumbnailUrl || f.fileUrl) : f.fileUrl,
          name: asset.name,
          source: 'entity_file',
        });
      });
    } else {
      const refs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
      const allUrls = [...refs];
      if (asset.thumbnailUrl && !allUrls.includes(asset.thumbnailUrl)) {
        allUrls.unshift(asset.thumbnailUrl);
      }
      if (allUrls.length > 0) {
        allUrls.forEach((url, i) => {
          lib[key].push({
            id: `${asset.assetId}_${i}`,
            url,
            thumbnail: i === 0 ? (asset.thumbnailUrl || url) : url,
            name: asset.name,
            source: 'asset',
          });
        });
      }
    }
  }
  return lib;
}
