import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, Mountain, Sword, Plus, Trash2, Loader, Palette, ArrowRight, Check,
  Upload, ZoomIn, X, Sparkles, Camera, Maximize, Grid3X3,
  Wand2, Scissors, CheckCircle, Layers, Square, CheckSquare,
} from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import { createAsset, deleteAsset, updateAsset } from '../services/assetMutationService';
import { generateGeminiImageVariant } from '../services/geminiImageGenerationService';
import { adjustImageAngle, processMaterialImage, generateHumanMultiAngleQueued } from '../services/comfyuiGenerationService';
import { waitForComfyUITask } from '../services/comfyuiTaskWaitService';
import { generateDoubaoImages, GeneratedFileResult } from '../services/doubaoService';
import { callAI } from '../services/aiService';
import { crmMessage } from '../admin/crmUI';
import { AiModel } from '../types';
import { IMAGE_QUALITY_SUFFIX } from '../prompts/imagePrompts';
import type { AssetItem } from '../types';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
import { apiBlob, secureApiUrl } from '../services/httpClient';
import { isAssetImageFileRole } from '../utils/assetImageRoles';

type AssetTab = 'character' | 'scene' | 'prop';
type MaterialAIEngine = 'nanobanana' | 'doubao';
interface ModalMaterial { id: string; url: string; thumbnail?: string; name?: string }
type AssetEntityFile = NonNullable<AssetItem['entityFiles']>[number];
type RawAssetImage = { key: string; rawUrl: string; fileId?: string };

const TAB_CONFIG: { key: AssetTab; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { key: 'character', label: '人物', Icon: User },
  { key: 'scene', label: '场景', Icon: Mountain },
  { key: 'prop', label: '道具', Icon: Sword },
];

const STYLE_PRESETS = [
  { id: 'anime', label: '动画', suffix: IMAGE_QUALITY_SUFFIX.anime },
  { id: 'realistic', label: '写实', suffix: IMAGE_QUALITY_SUFFIX.realistic },
  { id: 'watercolor', label: '水彩', suffix: IMAGE_QUALITY_SUFFIX.watercolor },
  { id: 'render3d', label: '3D渲染', suffix: IMAGE_QUALITY_SUFFIX.render3d },
  { id: 'highQuality', label: '高质量', suffix: IMAGE_QUALITY_SUFFIX.highQuality },
];

const THREE_VIEW_SUFFIX = '\nCreate a character turnaround sheet showing frontal view, right side view, left side view and back view, on a clean white background.';

/* ---- localStorage helpers ---- */
const LS = {
  get: (k: string, def: string) => { try { return localStorage.getItem(k) || def; } catch { return def; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};
const savedEngine = () => LS.get('design_ai_engine', 'nanobanana') as MaterialAIEngine;
const savedGeminiModel = () => LS.get('design_ai_gemini_model', 'gemini-2.5-flash-image');
const savedStyle = () => LS.get('design_ai_style', '');
const savedAspect = () => LS.get('design_ai_aspect_ratio', '1:1');
const savedResolution = () => LS.get('design_ai_resolution', '2K') as '1K' | '2K' | '4K';
const savedRefineModel = () => LS.get('design_ai_refine_model', 'gemini') as AiModel;

function savePrefs(p: { engine?: string; geminiModel?: string; style?: string; aspect?: string; resolution?: string; refineModel?: string }) {
  if (p.engine) LS.set('design_ai_engine', p.engine);
  if (p.geminiModel) LS.set('design_ai_gemini_model', p.geminiModel);
  if (p.style !== undefined) LS.set('design_ai_style', p.style);
  if (p.aspect) LS.set('design_ai_aspect_ratio', p.aspect);
  if (p.resolution) LS.set('design_ai_resolution', p.resolution);
  if (p.refineModel) LS.set('design_ai_refine_model', p.refineModel);
}

/* ---- Helpers ---- */
function safeArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
function safeObj(val: unknown): Record<string, unknown> {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
  if (typeof val === 'string') { try { const p = JSON.parse(val); return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {}; } catch { return {}; } }
  return {};
}

function secureMediaUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  const normalized = url.startsWith('http') ? url : (url.startsWith('/') ? url : `/${url}`);
  return secureApiUrl(normalized, { absolute: true });
}

function isAssetNotFoundError(error: unknown): boolean {
  const err = error as { status?: number; message?: string } | null | undefined;
  const msg = err?.message || String(error || '');
  return err?.status === 404 || /(^|\D)404(\D|$)|资产不存在|not found/i.test(msg);
}

function getLegacyAssetImageUrls(asset: AssetItem): string[] {
  const urls = [...(asset.referenceImages || [])];
  if (asset.thumbnailUrl && !urls.includes(asset.thumbnailUrl)) urls.unshift(asset.thumbnailUrl);
  return urls.filter(Boolean);
}

function getSortedAssetImageFiles(entityFiles: AssetEntityFile[] | undefined): AssetEntityFile[] {
  return (entityFiles || [])
    .filter(f => isAssetImageFileRole(f.fileRole) && Boolean(f.fileUrl))
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
}

function collectAssetImages(assetId: string, entityFiles: AssetEntityFile[] | undefined, legacyImages: string[]): RawAssetImage[] {
  const images: RawAssetImage[] = [];
  const seenUrls = new Set<string>();
  const pushImage = (url: string | null | undefined, key: string, fileId?: string) => {
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    images.push({ key, rawUrl: url, fileId });
  };

  legacyImages.forEach((url, index) => pushImage(url, `${assetId}_legacy_${index}`));
  getSortedAssetImageFiles(entityFiles).forEach((file, index) => {
    pushImage(file.fileUrl, file.fileId || `${assetId}_entity_${index}`, file.fileId);
  });

  return images;
}

function assetHasDesignImages(asset: AssetItem): boolean {
  return collectAssetImages(asset.assetId, asset.entityFiles, getLegacyAssetImageUrls(asset)).length > 0;
}

async function ensureDataUrl(input: string): Promise<string> {
  if (!input) throw new Error('图片URL无效');
  if (input.startsWith('data:')) return input;
  const secured = secureMediaUrl(input) || input;
  const blob = await apiBlob(secured, { method: 'GET' }, '下载图片', {
    requireAuth: false,
    includeContentType: false,
  });
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onloadend = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob); });
}

const randomSeed = () => Math.floor(Math.random() * 900000000000000) + 100000000000000;

function assetToMaterials(asset: AssetItem): ModalMaterial[] {
  return collectAssetImages(asset.assetId, asset.entityFiles, getLegacyAssetImageUrls(asset))
    .map((img, index) => ({ id: `${asset.assetId}_${index}`, url: img.rawUrl, name: asset.name }));
}

/* ---- AI Describe Prompt ---- */
function buildRefinePrompt(assetType: string, assetName: string, existingDesc: string, scriptText: string): { system: string; user: string } {
  const typeLabel = assetType === 'character' ? '角色' : assetType === 'scene' ? '场景' : '道具';
  const system = `你是一位专业的${typeLabel}视觉设计师。根据剧本内容和${typeLabel}名称，生成一段详细的${typeLabel}外观设定（100-200字），包含外形特征、服饰/材质、色彩、风格、氛围等细节，适合直接作为AI绘画提示词。只输出设定文案，不要任何解释或标题。`;
  const hasDesc = existingDesc.trim().length > 0;
  const scriptExcerpt = scriptText.length > 3000 ? scriptText.substring(0, 3000) + '...' : scriptText;
  const user = hasDesc
    ? `${typeLabel}名称：${assetName}\n用户描述：${existingDesc}\n\n剧本内容（供参考）：\n${scriptExcerpt}\n\n请结合用户描述和剧本中关于"${assetName}"的信息，输出润色后的${typeLabel}设定文案：`
    : `${typeLabel}名称：${assetName}\n\n剧本内容：\n${scriptExcerpt}\n\n请根据剧本中对"${assetName}"的描写和上下文，推断并输出详细的${typeLabel}设定文案：`;
  return { system, user };
}

/* ======================== Asset Image Row (entity-file backed) ======================== */
const AssetImageRow: React.FC<{
  assetId: string;
  entityFiles: AssetEntityFile[];
  legacyImages: string[];
  onLightbox: (url: string) => void;
  onDeleteImage: (assetId: string, imageUrl: string, fileId?: string) => void;
  busy: boolean;
}> = ({ assetId, entityFiles, legacyImages, onLightbox, onDeleteImage, busy }) => {
  const images: { key: string; displayUrl: string; rawUrl: string; fileId?: string }[] = useMemo(() => {
    return collectAssetImages(assetId, entityFiles, legacyImages)
      .map(img => ({
        key: img.key,
        displayUrl: secureMediaUrl(img.rawUrl) || '',
        rawUrl: img.rawUrl,
        fileId: img.fileId,
      }))
      .filter(i => i.displayUrl);
  }, [assetId, entityFiles, legacyImages]);

  if (images.length === 0) return null;
  return (
    <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
      {images.map(img => (
        <div key={img.key} className="shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-n40 hover:border-primary transition-colors group relative">
          <button type="button" onClick={() => onLightbox(img.displayUrl)} className="w-full h-full">
            <img src={img.displayUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center pointer-events-none"><ZoomIn size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" /></div>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDeleteImage(assetId, img.rawUrl, img.fileId); }}
            disabled={busy}
            className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-n900/50 text-danger hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
};

/* ======================== Main Component ======================== */
export const DesignPage: React.FC = () => {
  const navigate = useNavigate();
  const { episodeId, projectId, selectedScriptId, assets, script, isLoading, error, forceReloadSlices } = useEpisode();
  useEffect(() => {
    // 2026-06-14：强制刷新资产，保证别处新生成的资产图在设计页可见。
    forceReloadSlices('assets', 'script');
  }, [forceReloadSlices]);
  // 2026-05-20 (Bug #3)：当前查看的素材分类 tab（人物/场景/道具）持久化，按 episodeId scope。
  // 切走再回 / 刷新都保留用户的查看位置；不同剧集互相隔离。
  const [tab, setTab] = usePersistedPageState<AssetTab>({
    page: 'DesignPage:tab',
    episodeId,
    version: 1,
    defaultValue: 'character',
  });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [aiModal, setAiModal] = useState<{ asset: AssetItem } | null>(null);
  const [cameraModal, setCameraModal] = useState<{ asset: AssetItem; materials: ModalMaterial[] } | null>(null);
  const [processModal, setProcessModal] = useState<{ asset: AssetItem; materials: ModalMaterial[]; workflow: 'upscale_hd' | 'remove_watermark' } | null>(null);
  const [batchModal, setBatchModal] = useState(false);

  const filtered = useMemo(() => assets.filter(a => a.assetType === tab), [assets, tab]);
  const assetHasDesign = (a: AssetItem) => assetHasDesignImages(a);
  const totalDesignedCount = assets.filter(assetHasDesign).length;
  const tabDesignedCount = filtered.filter(assetHasDesign).length;
  const scriptText = script?.adaptedScript || script?.originalContent || '';

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllFiltered = () => setSelectedIds(new Set(filtered.map(a => a.assetId)));
  const selectUndesigned = () => setSelectedIds(new Set(filtered.filter(a => !assetHasDesign(a)).map(a => a.assetId)));
  const isBusy = (id: string) => busyAssetId === id || uploadingId === id || deletingId === id;

  /* ---- CRUD ---- */
  const handleCreate = useCallback(async () => {
    setFormError(null);
    const n = name.trim();
    if (!n) { setFormError('请填写名称'); return; }
    if (!projectId) { setFormError('缺少项目信息'); return; }
    setIsCreating(true);
    try {
      const res = await createAsset({ project_id: projectId, asset_type: tab, name: n, episode_id: episodeId || undefined, script_id: selectedScriptId || undefined, description: description.trim() || undefined });
      if (!res?.success) { setFormError(typeof res?.detail === 'string' ? res.detail : '创建失败'); return; }
      setName(''); setDescription('');
      await forceReloadSlices('assets');
    } catch (e: unknown) { setFormError(e instanceof Error ? e.message : '创建失败'); }
    finally { setIsCreating(false); }
  }, [name, description, projectId, episodeId, selectedScriptId, tab, forceReloadSlices]);

  const handleDelete = useCallback(async (assetId: string) => {
    setDeletingId(assetId);
    try {
      const res = await deleteAsset(assetId);
      if (res?.success) await forceReloadSlices('assets');
    } catch (e) {
      if (isAssetNotFoundError(e)) {
        crmMessage.warning('该资产已不存在，已刷新列表');
        await forceReloadSlices('assets');
      } else {
        console.error(e);
        crmMessage.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    finally { setDeletingId(null); }
  }, [forceReloadSlices]);

  const handleUploadImage = useCallback(async (assetId: string, file: File) => {
    setUploadingId(assetId);
    try {
      const { uploadEntityFile } = await import('../services/entityFileService');
      await uploadEntityFile(file, 'asset', assetId, 'reference_image', episodeId);
      await forceReloadSlices('assets');
    } catch (err) { console.error('上传失败:', err); }
    finally { setUploadingId(null); }
  }, [episodeId, forceReloadSlices]);

  const handleDeleteImage = useCallback(async (assetId: string, imageUrl: string, fileId?: string) => {
    if (fileId) {
      const { deleteEntityFile } = await import('../services/entityFileService');
      try {
        await deleteEntityFile(fileId);
        await forceReloadSlices('assets');
      } catch (err) { console.error('删除图片失败:', err); }
      return;
    }
    const asset = assets.find(a => a.assetId === assetId);
    if (!asset) return;
    const newRefs = (asset.referenceImages || []).filter(u => u !== imageUrl);
    const newThumb = asset.thumbnailUrl === imageUrl ? (newRefs[0] || '') : asset.thumbnailUrl;
    try {
      await updateAsset(assetId, { reference_images: newRefs, thumbnail_url: newThumb });
      await forceReloadSlices('assets');
    } catch (err) { console.error('删除图片失败:', err); }
  }, [assets, forceReloadSlices]);

  /* ---- AI Generation (from modal) ---- */
  const handleAIGeneration = useCallback(async (payload: {
    assetId: string; engine: MaterialAIEngine; geminiModel: string; prompt: string;
    references: string[]; aspectRatio: string; resolution: '1K' | '2K' | '4K';
    sequential: string; count: number;
  }) => {
    setAiModal(null);
    savePrefs({ engine: payload.engine, geminiModel: payload.geminiModel, aspect: payload.aspectRatio, resolution: payload.resolution });
    setBusyAssetId(payload.assetId); setBusyLabel('AI 生图中...');
    try {
      const entityOpts = { entityType: 'asset' as const, entityId: payload.assetId, fileRole: 'reference_image' as const, episodeId: episodeId || undefined };
      if (payload.engine === 'nanobanana') {
        await generateGeminiImageVariant({ model: payload.geminiModel, prompt: payload.prompt, references: payload.references, aspectRatio: payload.aspectRatio, ...entityOpts });
      } else {
        await generateDoubaoImages({ prompt: payload.prompt, references: payload.references, size: payload.resolution, sequential: payload.sequential as any, count: payload.count, ...entityOpts });
      }
      await forceReloadSlices('assets');
    } catch (err: any) { console.error('AI生成失败:', err); crmMessage.error(err?.message || 'AI生成失败'); }
    finally { setBusyAssetId(null); }
  }, [episodeId, forceReloadSlices]);

  /* ---- Camera ---- */
  const handleCameraGenerate = useCallback(async (payload: { assetId: string; imageUrl: string; rotate: number; move: number; vertical: number; wideAngle: boolean; customPrompt?: string; seed: number }) => {
    setCameraModal(null);
    setBusyAssetId(payload.assetId); setBusyLabel('角度调整中...');
    try {
      const prompts: string[] = [];
      if (payload.rotate !== 0) prompts.push(payload.rotate > 0 ? `Rotate camera ${payload.rotate}° to the right.` : `Rotate camera ${Math.abs(payload.rotate)}° to the left.`);
      if (payload.move > 0) prompts.push(`Move camera forward by ${payload.move} steps.`);
      if (payload.vertical === 1) prompts.push("Turn the camera to a worm's-eye view.");
      else if (payload.vertical === -1) prompts.push("Turn the camera to a bird's-eye view.");
      if (payload.wideAngle) prompts.push("Switch to a wide-angle lens.");
      const finalPrompt = payload.customPrompt?.trim() || prompts.join(' ') || 'Adjust the camera angle slightly.';
      const { taskId } = await adjustImageAngle(payload.imageUrl, finalPrompt, payload.seed, {
        entityType: 'asset', entityId: payload.assetId, fileRole: 'reference_image', episodeId: episodeId || undefined,
      });
      // 2026-05-20 (M3)：接入 taskRegistry，让铃铛能看到设计页的 ComfyUI 任务
      await waitForComfyUITask(taskId, undefined, {
        title: `角度调整 · 资产 ${String(payload.assetId).slice(0, 6)}`,
        kind: 'angle-adjust',
        targetPage: 'design',
        targetEntityType: 'asset',
        targetEntityId: payload.assetId,
        targetItemId: payload.assetId,
        targetProjectId: projectId || undefined,
        episodeId: episodeId || undefined,
        fileRole: 'reference_image',
      });
      await forceReloadSlices('assets');
    } catch (err: any) { console.error('角度调整失败:', err); crmMessage.error(err?.message || '角度调整失败'); }
    finally { setBusyAssetId(null); }
  }, [episodeId, projectId, forceReloadSlices]);

  /* ---- Process (upscale/watermark) ---- */
  const handleProcessSubmit = useCallback(async (materialUrl: string) => {
    if (!processModal) return;
    setProcessModal(null);
    setBusyAssetId(processModal.asset.assetId); setBusyLabel(processModal.workflow === 'upscale_hd' ? '高清放大中...' : '去水印中...');
    try {
      const { taskId } = await processMaterialImage(materialUrl, processModal.workflow, {
        entityType: 'asset', entityId: processModal.asset.assetId, fileRole: 'reference_image', episodeId: episodeId || undefined,
      });
      // 2026-05-20 (M3)：接入 taskRegistry
      await waitForComfyUITask(taskId, undefined, {
        title: `${processModal.workflow === 'upscale_hd' ? '高清放大' : '去水印'} · ${String(processModal.asset.assetId).slice(0, 6)}`,
        kind: processModal.workflow === 'upscale_hd' ? 'video-upscale' : 'matting',
        targetPage: 'design',
        targetEntityType: 'asset',
        targetEntityId: processModal.asset.assetId,
        targetItemId: processModal.asset.assetId,
        targetProjectId: projectId || undefined,
        episodeId: episodeId || undefined,
        fileRole: 'reference_image',
      });
      await forceReloadSlices('assets');
    } catch (err: any) { console.error('处理失败:', err); crmMessage.error(err?.message || '处理失败'); }
    finally { setBusyAssetId(null); }
  }, [processModal, episodeId, projectId, forceReloadSlices]);

  /* ---- Batch Generation ---- */
  const handleBatchGenerate = useCallback(async (config: {
    assetIds: string[]; engine: MaterialAIEngine; geminiModel: string; style: string;
    aspectRatio: string; resolution: '1K' | '2K' | '4K'; threeView: boolean;
    refineModel: AiModel;
  }) => {
    setBatchModal(false);
    savePrefs({ engine: config.engine, geminiModel: config.geminiModel, style: config.style, aspect: config.aspectRatio, resolution: config.resolution, refineModel: config.refineModel });
    const targets = assets.filter(a => config.assetIds.includes(a.assetId));
    let okCount = 0;
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const asset = targets[i];
      setBusyAssetId(asset.assetId); setBusyLabel(`批量生成 ${i + 1}/${targets.length}...`);
      try {
        let desc = asset.description || '';
        if (!desc.trim()) {
          const p = buildRefinePrompt(asset.assetType, asset.name, '', scriptText);
          let result: any;
          try {
            result = await callAI(config.refineModel, { system: p.system, user: p.user });
          } catch (refineErr: any) {
            // Gemini 文本对剧本内容常触发内容审查（PROHIBITED_CONTENT）而拒绝；
            // 自动回退 DeepSeek 完成描述推断，避免整批静默失败。
            if (config.refineModel !== AiModel.DeepseekChat) {
              console.warn(`${asset.name} Gemini 推断被拦，回退 DeepSeek：`, refineErr?.message);
              result = await callAI(AiModel.DeepseekChat, { system: p.system, user: p.user });
            } else {
              throw refineErr;
            }
          }
          if (result && typeof result === 'string') {
            desc = result.trim();
            await updateAsset(asset.assetId, { description: desc });
          }
        }
        const styleSuffix = STYLE_PRESETS.find(s => s.id === config.style)?.suffix || '';
        let prompt = desc + styleSuffix;
        if (config.threeView && asset.assetType === 'character') prompt += THREE_VIEW_SUFFIX;
        const entityOpts = { entityType: 'asset' as const, entityId: asset.assetId, fileRole: 'reference_image' as const, episodeId: episodeId || undefined };
        if (config.engine === 'nanobanana') {
          await generateGeminiImageVariant({ model: config.geminiModel, prompt, references: [], aspectRatio: config.threeView && asset.assetType === 'character' ? '16:9' : config.aspectRatio, ...entityOpts });
        } else {
          await generateDoubaoImages({ prompt, references: [], size: config.resolution, ...entityOpts });
        }
        okCount++;
      } catch (err: any) {
        // 不再静默吞错：累计失败原因，循环结束后用 toast 汇总暴露给用户。
        errors.push(`${asset.name}：${err?.message || String(err)}`);
        console.error(`批量生成 ${asset.name} 失败:`, err);
      }
    }
    await forceReloadSlices('assets');
    setBusyAssetId(null); setBusyLabel('');
    if (!errors.length) {
      crmMessage.success(`批量生成完成：成功 ${okCount} 项`);
    } else if (okCount > 0) {
      crmMessage.warning(`批量生成：成功 ${okCount}，失败 ${errors.length}。首个失败 → ${errors[0]}`);
    } else {
      crmMessage.error(`批量生成全部失败（${errors.length} 项）。原因 → ${errors[0]}`);
    }
  }, [assets, scriptText, episodeId, forceReloadSlices]);

  const tabLabel = tab === 'character' ? '人物' : tab === 'scene' ? '场景' : '道具';

  return (
    <div className="min-h-full bg-n20 text-n800 p-6">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">资产设计工作台</h1>
          <p className="text-sm text-n100 mt-1">
            AI 辅助设计人物、场景、道具 ·
            <span className="text-success ml-1">共 {totalDesignedCount}/{assets.length} 已设计</span>
            {filtered.length - tabDesignedCount > 0 && <span className="text-warning ml-2">当前分类 {tabDesignedCount}/{filtered.length}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button onClick={() => setBatchModal(true)} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors">
              <Layers size={14} /> 批量生成 ({selectedIds.size})
            </button>
          )}
          <button onClick={() => setBatchModal(true)} className="flex items-center gap-2 px-4 py-2 bg-n0 hover:bg-n20 text-n700 text-sm rounded-lg transition-colors border border-n40">
            <Layers size={14} /> 批量生成
          </button>
          <button onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/materials`)}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors">
            导出到素材绑定 <ArrowRight size={14} />
          </button>
        </div>
      </header>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-r50 border border-r75 text-sm text-danger">{error}</div>}

      <div className="flex gap-2 mb-4 flex-wrap items-center" role="tablist">
        {TAB_CONFIG.map(({ key, label, Icon }) => {
          const active = tab === key; const count = assets.filter(a => a.assetType === key).length;
          return (<button key={key} role="tab" aria-selected={active} onClick={() => { setTab(key); setSelectedIds(new Set()); }}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border ${active ? 'bg-primary-light border-primary text-primary' : 'bg-n0 border-n40 text-n100 hover:text-n700 hover:border-n40'}`}>
            <Icon size={16} /> {label} {count > 0 && <span className="text-xs bg-n0 px-1.5 py-0.5 rounded">{count}</span>}
          </button>);
        })}
        <div className="ml-auto flex items-center gap-2 text-xs text-n100">
          <button onClick={selectAllFiltered} className="hover:text-n800 transition-colors">全选</button>
          <span>|</span>
          <button onClick={selectUndesigned} className="hover:text-n800 transition-colors">选未设计</button>
          <span>|</span>
          <button onClick={() => setSelectedIds(new Set())} className="hover:text-n800 transition-colors">清空</button>
        </div>
      </div>

      <div className="flex gap-6 items-start flex-col lg:flex-row">
        <aside className="w-full lg:w-72 shrink-0 bg-n0 rounded-md p-5 border border-n40 shadow-card">
          <div className="flex items-center gap-2 mb-4"><Plus size={18} className="text-primary" /><span className="font-semibold text-sm">新建{tabLabel}</span></div>
          <label className="block text-xs text-n100 mb-1.5">名称</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例如：主角 / 客厅 / 古剑"
            className="w-full px-3 py-2.5 rounded-lg bg-n0 border border-n40 text-n800 text-sm placeholder:text-n100 focus:outline-none focus:ring-2 focus:ring-primary/20 mb-4" />
          <label className="block text-xs text-n100 mb-1.5">描述</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="外观、风格等" rows={3}
            className="w-full px-3 py-2.5 rounded-lg bg-n0 border border-n40 text-n800 text-sm placeholder:text-n100 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 mb-4" />
          {formError && <p className="text-xs text-danger mb-3">{formError}</p>}
          <button onClick={handleCreate} disabled={isCreating || !projectId}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-sm transition-all disabled:opacity-50 shadow-lg shadow-indigo-600/20">
            {isCreating && <Loader size={16} className="animate-spin" />} {isCreating ? '创建中...' : '创建'}
          </button>
        </aside>

        <section className="flex-1 min-w-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-n100 text-sm"><Loader size={20} className="animate-spin" /> 加载资产...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 bg-n0 rounded-md border border-dashed border-n40 text-n100">
              <Palette size={40} className="mx-auto mb-3 opacity-40" /><p className="text-sm">暂无{tabLabel}资产</p>
              <p className="text-xs mt-1 text-n100">在左侧创建，或从剧本页导出</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((asset) => {
                const hasDesign = assetHasDesign(asset);
                const legacyImgs = getLegacyAssetImageUrls(asset);
                const busy = isBusy(asset.assetId);
                const checked = selectedIds.has(asset.assetId);
                return (
                  <div key={asset.assetId} className={`bg-n0 rounded-md border transition-all duration-300 shadow-card hover:shadow-atlas ${hasDesign ? 'border-n40' : 'border-warning border-dashed'}`}>
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <button onClick={() => toggleSelect(asset.assetId)} className="shrink-0 mt-0.5">
                            {checked ? <CheckSquare size={18} className="text-primary" /> : <Square size={18} className="text-n100" />}
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold truncate">{asset.name}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${hasDesign ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>
                                {hasDesign ? '已设计' : '待设计'}
                              </span>
                              {busy && <span className="text-[10px] text-primary animate-pulse flex items-center gap-1"><Loader size={10} className="animate-spin" />{busyLabel}</span>}
                            </div>
                            {asset.description && <p className="text-[11px] text-n100 mt-1 line-clamp-2">{asset.description}</p>}
                          </div>
                        </div>
                        <button onClick={() => handleDelete(asset.assetId)} disabled={busy}
                          className="p-1.5 rounded-lg text-[11px] border border-r75 bg-r50 text-danger hover:bg-r50 transition-all disabled:opacity-30 shrink-0 ml-2">
                          {deletingId === asset.assetId ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                      <AssetImageRow
                        assetId={asset.assetId}
                        entityFiles={asset.entityFiles || []}
                        legacyImages={legacyImgs}
                        onLightbox={setLightboxUrl}
                        onDeleteImage={handleDeleteImage}
                        busy={busy}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => setAiModal({ asset })} disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-primary-light border border-primary text-primary hover:bg-primary-light transition-all disabled:opacity-30">
                          <Sparkles size={11} /> AI 生图
                        </button>
                        <label className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-n0 border border-n40 text-n300 hover:bg-n20 transition-all cursor-pointer ${busy ? 'opacity-30' : ''}`}>
                          <Upload size={11} /> 上传
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadImage(asset.assetId, f); e.target.value = ''; }} />
                        </label>
                        <button onClick={() => { const m = assetToMaterials(asset); if (!m.length) { crmMessage.error('请先上传或生成图片'); return; } setCameraModal({ asset, materials: m }); }} disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-n0 border border-n40 text-n300 hover:bg-n20 transition-all disabled:opacity-30">
                          <Camera size={11} /> 角度
                        </button>
                        <button onClick={() => { const m = assetToMaterials(asset); if (!m.length) { crmMessage.error('请先上传或生成图片'); return; } setProcessModal({ asset, materials: m, workflow: 'upscale_hd' }); }} disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-n0 border border-n40 text-n300 hover:bg-n20 transition-all disabled:opacity-30">
                          <Maximize size={11} /> 高清放大
                        </button>
                        <button onClick={() => { const m = assetToMaterials(asset); if (!m.length) { crmMessage.error('请先上传或生成图片'); return; } setProcessModal({ asset, materials: m, workflow: 'remove_watermark' }); }} disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-n0 border border-n40 text-n300 hover:bg-n20 transition-all disabled:opacity-30">
                          <Scissors size={11} /> 去水印
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-8" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-6 right-6 text-white/70 hover:text-white" onClick={() => setLightboxUrl(null)}><X size={24} /></button>
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {aiModal && <UnifiedAIModal asset={aiModal.asset} scriptText={scriptText} onClose={() => setAiModal(null)} onSubmit={handleAIGeneration} />}
      {cameraModal && <CameraModal asset={cameraModal.asset} materials={cameraModal.materials} onClose={() => setCameraModal(null)} onSubmit={(p) => handleCameraGenerate({ ...p, assetId: cameraModal.asset.assetId })} />}
      {processModal && <ProcessModal asset={processModal.asset} materials={processModal.materials} workflow={processModal.workflow} onClose={() => setProcessModal(null)} onSubmit={handleProcessSubmit} />}
      {batchModal && <BatchGenerateModal assets={assets} selectedIds={selectedIds} scriptText={scriptText} onClose={() => setBatchModal(false)} onSubmit={handleBatchGenerate} />}
    </div>
  );
};

/* ======================== Unified AI Modal ======================== */
const UnifiedAIModal: React.FC<{
  asset: AssetItem; scriptText: string; onClose: () => void;
  onSubmit: (p: { assetId: string; engine: MaterialAIEngine; geminiModel: string; prompt: string; references: string[]; aspectRatio: string; resolution: '1K' | '2K' | '4K'; sequential: string; count: number }) => void;
}> = ({ asset, scriptText, onClose, onSubmit }) => {
  const { forceReloadSlices } = useEpisode();
  const initialPrompt = useMemo(
    () => (asset.styleParams?.ai_prompt as string) || asset.description || asset.name,
    [asset]
  );
  const [engine, setEngine] = useState<MaterialAIEngine>(savedEngine());
  const [geminiModel, setGeminiModel] = useState(savedGeminiModel());
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aspectRatio, setAspectRatio] = useState(savedAspect());
  const [resolution, setResolution] = useState(savedResolution());
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [sequential, setSequential] = useState<'disabled' | 'auto'>('disabled');
  const [count, setCount] = useState(1);
  const [activeStyle, setActiveStyle] = useState(savedStyle());
  const [isRefining, setIsRefining] = useState(false);
  const [refineModel, setRefineModel] = useState(savedRefineModel());
  const persistedPromptRef = useRef(initialPrompt);
  const materials = useMemo(() => assetToMaterials(asset), [asset]);
  const maxRefs = engine === 'nanobanana' ? 6 : 14;

  useEffect(() => { if (engine === 'nanobanana') { setSequential('disabled'); setCount(1); } }, [engine]);

  const persistPrompt = useCallback(async (newPrompt: string) => {
    const text = (newPrompt || '').trim();
    if (!text || text === persistedPromptRef.current) return;
    try {
      await updateAsset(asset.assetId, {
        style_params: { ...(asset.styleParams || {}), ai_prompt: text },
      });
      persistedPromptRef.current = text;
      forceReloadSlices('assets').catch(() => { /* ignore */ });
    } catch (e) {
      console.warn('保存提示词失败:', e);
    }
  }, [asset, forceReloadSlices]);

  const handleClose = useCallback(() => {
    persistPrompt(prompt);
    onClose();
  }, [persistPrompt, prompt, onClose]);

  const toggleRef = (id: string) => setSelectedRefs(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { if (n.size >= maxRefs) { crmMessage.error(`最多 ${maxRefs} 张`); return prev; } n.add(id); } return n; });

  const appendStyle = (styleId: string, suffix: string) => {
    if (activeStyle === styleId) { const prev = STYLE_PRESETS.find(s => s.id === styleId); if (prev) setPrompt(p => p.replace(prev.suffix, '').trim()); setActiveStyle(''); }
    else { if (activeStyle) { const prev = STYLE_PRESETS.find(s => s.id === activeStyle); if (prev) setPrompt(p => p.replace(prev.suffix, '').trim()); } setPrompt(p => p.trim() + suffix); setActiveStyle(styleId); }
  };

  const handleRefine = async () => {
    setIsRefining(true);
    try {
      const p = buildRefinePrompt(asset.assetType, asset.name, prompt, scriptText);
      const result = await callAI(refineModel, { system: p.system, user: p.user });
      if (result && typeof result === 'string') {
        const refined = result.trim();
        setPrompt(refined);
        savePrefs({ refineModel });
        persistPrompt(refined);
      }
    } catch (err) { console.error('AI润色失败:', err); crmMessage.error('AI润色失败，请重试'); }
    finally { setIsRefining(false); }
  };

  return (
    <div className="fixed inset-0 bg-n900/50 backdrop-blur-sm flex items-center justify-center z-[120]" onClick={handleClose}>
      <div className="w-full max-w-4xl bg-n0 border border-n40 rounded-2xl shadow-bottom p-6 space-y-5 relative max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div><h3 className="text-lg font-bold text-n800">AI 生成素材 - {asset.name}</h3><p className="text-xs text-n300 mt-1">基于剧本内容智能生成，支持风格预设和参考图。提示词会自动保存。</p></div>
          <button onClick={handleClose} className="text-n300 hover:text-n800"><X className="w-5 h-5" /></button>
        </div>

        {/* Prompt + Refine */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-n100 uppercase">提示词</span>
            <div className="flex items-center gap-1.5">
              <select value={refineModel} onChange={e => setRefineModel(e.target.value as AiModel)} className="text-[10px] bg-n0 border border-n40 rounded px-1.5 py-0.5 text-n300">
                <option value={AiModel.Gemini}>Gemini</option><option value={AiModel.DeepseekChat}>DeepSeek</option>
              </select>
              <button onClick={handleRefine} disabled={isRefining} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-primary-light border border-primary text-primary hover:bg-primary-light transition-all disabled:opacity-50">
                {isRefining ? <Loader size={10} className="animate-spin" /> : <Wand2 size={10} />} AI 润色
              </button>
            </div>
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
            className="w-full bg-n0 border border-n40 rounded-md text-sm text-n800 p-3 focus:outline-none focus:border-primary resize-none" placeholder="描述你想要生成的内容..." />
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="text-[10px] text-n100 self-center mr-1">风格：</span>
            {STYLE_PRESETS.map(s => (
              <button key={s.id} onClick={() => appendStyle(s.id, s.suffix)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${activeStyle === s.id ? 'bg-primary text-white border-primary' : 'bg-n0 text-n300 border-n40 hover:border-primary hover:text-n800'}`}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="col-span-1 space-y-3 border border-n40 rounded-md p-4">
            <span className="text-[11px] font-bold text-n100 uppercase">引擎</span>
            <div className="flex gap-2">
              <button onClick={() => setEngine('nanobanana')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${engine === 'nanobanana' ? 'bg-primary text-white border-primary' : 'border-n40 text-n300 hover:text-n800 hover:border-n40'}`}>化神进阶</button>
              <button onClick={() => setEngine('doubao')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${engine === 'doubao' ? 'bg-primary text-white border-primary' : 'border-n40 text-n300 hover:text-n800 hover:border-n40'}`}>筑基境界</button>
            </div>
            {engine === 'nanobanana' && (
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-n100 uppercase">模型</span>
                {[{ id: 'gemini-2.5-flash-image', label: '化神1阶', desc: '快速' }, { id: 'gemini-3-pro-image-preview', label: '化神2阶', desc: '高质量' }].map(m => (
                  <label key={m.id} className={`flex items-center gap-2 text-xs p-2 rounded border cursor-pointer ${geminiModel === m.id ? 'bg-primary-light border-primary text-primary' : 'border-n40 text-n300'}`}>
                    <input type="radio" name="gm" value={m.id} checked={geminiModel === m.id} onChange={() => setGeminiModel(m.id)} /><span className="font-semibold">{m.label}</span><span className="text-[10px] text-n100">({m.desc})</span>
                  </label>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-n100 uppercase">输出</span>
              <div className="grid grid-cols-2 gap-1.5">{['1:1', '3:4', '4:3', '9:16', '16:9'].map(r => (<button key={r} onClick={() => setAspectRatio(r)} className={`py-1 rounded text-[11px] border ${aspectRatio === r ? 'bg-primary text-white font-semibold' : 'border-n40 text-n300 hover:text-n800'}`}>{r}</button>))}</div>
              <select value={resolution} onChange={e => setResolution(e.target.value as any)} className="w-full bg-n0 border border-n40 rounded-lg text-xs text-n800 px-2 py-1.5"><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></select>
            </div>
            {engine === 'doubao' && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-n700"><input type="checkbox" checked={sequential === 'auto'} onChange={e => setSequential(e.target.checked ? 'auto' : 'disabled')} /> 关联组图</label>
                {sequential === 'auto' && <div className="flex items-center gap-2 text-xs text-n700"><span>张数</span><input type="number" min={1} max={15} value={count} onChange={e => setCount(Math.min(15, Math.max(1, +e.target.value)))} className="w-16 bg-n0 border border-n40 rounded px-2 py-1" /><span className="text-[10px] text-n100">参考图+生成≤15</span></div>}
              </div>
            )}
          </div>
          <div className="col-span-2">
            <div className="flex items-center justify-between text-[11px] text-n100 mb-2"><span className="font-bold uppercase">参考图 (最多 {maxRefs})</span><span className={selectedRefs.size > 0 ? "text-success font-semibold" : ""}>{selectedRefs.size}/{maxRefs}</span></div>
            {materials.length === 0 ? <div className="border border-dashed border-n40 rounded-md text-center py-6 text-xs text-n100">暂无素材</div> : (
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">{materials.map(m => { const a = selectedRefs.has(m.id); return (<button key={m.id} onClick={() => toggleRef(m.id)} className={`relative aspect-square rounded-lg overflow-hidden border ${a ? 'border-success ring-2 ring-success/40' : 'border-n40'}`}><img src={secureMediaUrl(m.thumbnail || m.url) || ''} loading="lazy" className="w-full h-full object-cover" />{a && <div className="absolute inset-0 bg-success/30" />}</button>); })}</div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
          <button onClick={handleClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
          <button onClick={() => { if (!prompt.trim()) { crmMessage.error('请输入提示词'); return; } persistPrompt(prompt); onSubmit({ assetId: asset.assetId, engine, geminiModel, prompt: prompt.trim(), references: materials.filter(m => selectedRefs.has(m.id)).map(m => m.url), aspectRatio, resolution, sequential, count }); }}
            className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg">开始生成</button>
        </div>
      </div>
    </div>
  );
};

/* ======================== BatchGenerateModal ======================== */
const BatchGenerateModal: React.FC<{
  assets: AssetItem[]; selectedIds: Set<string>; scriptText: string;
  onClose: () => void; onSubmit: (config: { assetIds: string[]; engine: MaterialAIEngine; geminiModel: string; style: string; aspectRatio: string; resolution: '1K' | '2K' | '4K'; threeView: boolean; refineModel: AiModel }) => void;
}> = ({ assets, selectedIds, scriptText, onClose, onSubmit }) => {
  const [checked, setChecked] = useState<Set<string>>(() => selectedIds.size > 0 ? new Set(selectedIds) : new Set(assets.filter(a => !a.thumbnailUrl && !(a.referenceImages?.length > 0)).map(a => a.assetId)));
  const [engine, setEngine] = useState<MaterialAIEngine>(savedEngine());
  const [geminiModel, setGeminiModel] = useState(savedGeminiModel());
  const [style, setStyle] = useState(savedStyle());
  const [aspectRatio, setAspectRatio] = useState(savedAspect());
  const [resolution, setResolution] = useState(savedResolution());
  const [threeView, setThreeView] = useState(true);
  const [refineModel, setRefineModel] = useState(savedRefineModel());

  const toggle = (id: string) => setChecked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const charCount = assets.filter(a => a.assetType === 'character' && checked.has(a.assetId)).length;
  const sceneCount = assets.filter(a => a.assetType === 'scene' && checked.has(a.assetId)).length;
  const propCount = assets.filter(a => a.assetType === 'prop' && checked.has(a.assetId)).length;

  const grouped = useMemo(() => {
    const g: Record<string, AssetItem[]> = { character: [], scene: [], prop: [] };
    assets.forEach(a => { if (g[a.assetType]) g[a.assetType].push(a); });
    return g;
  }, [assets]);

  return (
    <div className="fixed inset-0 bg-n900/50 backdrop-blur-sm flex items-center justify-center z-[120]" onClick={onClose}>
      <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-2xl shadow-bottom p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div><h3 className="text-lg font-bold text-n800">批量生成</h3><p className="text-xs text-n300 mt-1">选择资产和统一配置，空描述的将由 AI 基于剧本自动推断。</p></div>
          <button onClick={onClose} className="text-n300 hover:text-n800"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3 border border-n40 rounded-md p-4 max-h-[50vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-n100 uppercase">选择资产</span>
              <div className="flex gap-2 text-[10px]">
                <button onClick={() => setChecked(new Set(assets.map(a => a.assetId)))} className="text-primary hover:text-primary-hover">全选</button>
                <button onClick={() => setChecked(new Set(assets.filter(a => !a.thumbnailUrl && !(a.referenceImages?.length > 0)).map(a => a.assetId)))} className="text-warning hover:text-warning">选未设计</button>
                <button onClick={() => setChecked(new Set())} className="text-n100 hover:text-n700">清空</button>
              </div>
            </div>
            {(['character', 'scene', 'prop'] as const).map(type => {
              const items = grouped[type];
              if (!items.length) return null;
              const label = type === 'character' ? '人物' : type === 'scene' ? '场景' : '道具';
              return (
                <div key={type}>
                  <span className="text-[10px] font-bold text-n100 uppercase">{label}</span>
                  {items.map(a => {
                    const hasDesign = !!(a.thumbnailUrl || a.referenceImages?.length);
                    const isChecked = checked.has(a.assetId);
                    return (
                      <button key={a.assetId} onClick={() => toggle(a.assetId)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-all ${isChecked ? 'bg-primary-light border border-primary' : 'hover:bg-n20 border border-transparent'}`}>
                        {isChecked ? <CheckSquare size={14} className="text-primary shrink-0" /> : <Square size={14} className="text-n100 shrink-0" />}
                        <span className="truncate flex-1">{a.name}</span>
                        <span className={`text-[10px] ${a.description ? 'text-n100' : 'text-warning'}`}>{a.description ? '有描述' : '空描述'}</span>
                        <span className={`text-[10px] ${hasDesign ? 'text-success' : 'text-n100'}`}>{hasDesign ? '已设计' : '待设计'}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="space-y-4 border border-n40 rounded-md p-4">
            <span className="text-[11px] font-bold text-n100 uppercase">统一配置</span>
            <div className="flex gap-2">
              <button onClick={() => setEngine('nanobanana')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${engine === 'nanobanana' ? 'bg-primary text-white border-primary' : 'border-n40 text-n300'}`}>化神进阶</button>
              <button onClick={() => setEngine('doubao')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${engine === 'doubao' ? 'bg-primary text-white border-primary' : 'border-n40 text-n300'}`}>筑基境界</button>
            </div>
            {engine === 'nanobanana' && (
              <div className="flex gap-2">{[{ id: 'gemini-2.5-flash-image', label: '化神1阶' }, { id: 'gemini-3-pro-image-preview', label: '化神2阶' }].map(m => (
                <button key={m.id} onClick={() => setGeminiModel(m.id)} className={`flex-1 py-1.5 rounded text-xs border ${geminiModel === m.id ? 'bg-primary-light border-primary text-primary' : 'border-n40 text-n300'}`}>{m.label}</button>
              ))}</div>
            )}
            <div>
              <span className="text-[11px] font-bold text-n100 uppercase block mb-1.5">风格</span>
              <div className="flex flex-wrap gap-1.5">{STYLE_PRESETS.map(s => (<button key={s.id} onClick={() => setStyle(style === s.id ? '' : s.id)} className={`text-[11px] px-2.5 py-1 rounded border ${style === s.id ? 'bg-primary text-white border-primary' : 'bg-n0 text-n300 border-n40 hover:text-n800'}`}>{s.label}</button>))}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-[11px] text-n100 block mb-1">比例</span><select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className="w-full bg-n0 border border-n40 rounded-lg text-xs text-n800 px-2 py-1.5">{['1:1', '3:4', '4:3', '9:16', '16:9'].map(r => <option key={r} value={r}>{r}</option>)}</select></div>
              <div><span className="text-[11px] text-n100 block mb-1">分辨率</span><select value={resolution} onChange={e => setResolution(e.target.value as any)} className="w-full bg-n0 border border-n40 rounded-lg text-xs text-n800 px-2 py-1.5"><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></select></div>
            </div>
            <div><span className="text-[11px] text-n100 block mb-1">AI 推断模型</span><select value={refineModel} onChange={e => setRefineModel(e.target.value as AiModel)} className="w-full bg-n0 border border-n40 rounded-lg text-xs text-n800 px-2 py-1.5"><option value={AiModel.Gemini}>Gemini</option><option value={AiModel.DeepseekChat}>DeepSeek</option></select></div>
            <label className="flex items-center gap-2 text-xs text-n700 p-3 bg-n30 rounded-lg border border-n40">
              <input type="checkbox" checked={threeView} onChange={e => setThreeView(e.target.checked)} className="accent-indigo-500" />
              人物默认生成三视图（正面/侧面/背面设定图）
            </label>
            <div className="text-xs text-n100 bg-n30 rounded-lg p-3 border border-n40">
              已选 <strong className="text-n800">{checked.size}</strong> 项
              {charCount > 0 && <span className="ml-2 text-primary">{charCount} 人物</span>}
              {sceneCount > 0 && <span className="ml-2 text-success">{sceneCount} 场景</span>}
              {propCount > 0 && <span className="ml-2 text-warning">{propCount} 道具</span>}
              <br />空描述资产将由 AI 基于剧本自动推断外观。
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
          <button onClick={() => { if (!checked.size) { crmMessage.error('请至少选择一个资产'); return; } onSubmit({ assetIds: Array.from(checked), engine, geminiModel, style, aspectRatio, resolution, threeView, refineModel }); }}
            disabled={!checked.size} className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg disabled:opacity-50">
            开始批量生成 ({checked.size} 项)
          </button>
        </div>
      </div>
    </div>
  );
};

/* ======================== CameraModal ======================== */
const CameraModal: React.FC<{
  asset: AssetItem; materials: ModalMaterial[]; onClose: () => void;
  onSubmit: (p: { imageUrl: string; rotate: number; move: number; vertical: number; wideAngle: boolean; customPrompt?: string; seed: number }) => void;
}> = ({ asset, materials, onClose, onSubmit }) => {
  const [selId, setSelId] = useState(materials[0]?.id);
  const [rotate, setRotate] = useState(0);
  const [move, setMove] = useState(0);
  const [vertical, setVertical] = useState(0);
  const [wideAngle, setWideAngle] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [seed, setSeed] = useState(randomSeed());
  const cur = materials.find(m => m.id === selId) || materials[0];
  const promptExamples = ["镜头向前移动", "镜头向左移动", "转为俯视", "转为广角", "转为特写"];
  const Slider: React.FC<{ label: string; values: number[]; value: number; onChange: (v: number) => void }> = ({ label, values, value, onChange }) => {
    const idx = values.indexOf(value); const di = idx === -1 ? 0 : idx;
    return (<div className="space-y-1"><div className="flex justify-between text-[11px] text-n300"><span>{label}</span><span className="text-n800 font-semibold">{value}</span></div><input type="range" min={0} max={values.length - 1} step={1} value={di} onChange={e => onChange(values[+e.target.value])} className="w-full accent-indigo-500" /></div>);
  };
  return (
    <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
      <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-2xl shadow-bottom p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div><h3 className="text-lg font-bold text-n800">角度调整 - {asset.name}</h3></div><button onClick={onClose} className="text-n300 hover:text-n800"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="rounded-2xl overflow-hidden border border-n40 h-64 bg-n30 flex items-center justify-center">{cur ? <img src={secureMediaUrl(cur.url) || ''} className="w-full h-full object-contain" /> : <span className="text-xs text-n100">无</span>}</div>
            <div className="grid grid-cols-5 gap-2">{materials.map(m => (<button key={m.id} onClick={() => setSelId(m.id)} className={`aspect-square rounded-lg overflow-hidden border ${selId === m.id ? 'border-success ring-2 ring-success/40' : 'border-n40'}`}><img src={secureMediaUrl(m.thumbnail || m.url) || ''} className="w-full h-full object-cover" /></button>))}</div>
          </div>
          <div className="space-y-4">
            <div className="bg-n30 border border-n40 rounded-md p-4 space-y-3">
              <Slider label="水平旋转 (°)" values={[-90, -45, 0, 45, 90]} value={rotate} onChange={setRotate} />
              <Slider label="推进距离" values={[0, 5, 10]} value={move} onChange={setMove} />
              <Slider label="垂直角度" values={[-1, 0, 1]} value={vertical} onChange={setVertical} />
              <label className="flex items-center gap-2 text-xs text-n700"><input type="checkbox" checked={wideAngle} onChange={e => setWideAngle(e.target.checked)} /> 广角</label>
            </div>
            <textarea rows={2} value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} className="w-full bg-n0 border border-n40 rounded-lg text-sm text-n800 p-3 resize-none" placeholder="自定义提示词..." />
            <div className="flex flex-wrap gap-1">{promptExamples.map((ex, i) => (<button key={i} onClick={() => setCustomPrompt(ex)} className="text-[10px] px-2 py-1 bg-n0 text-n300 rounded border border-n40 hover:bg-primary hover:text-white">{ex}</button>))}</div>
            <div className="flex items-center gap-2 text-xs text-n700"><span>种子</span><input type="number" value={seed} onChange={e => setSeed(+e.target.value)} className="w-28 bg-n0 border border-n40 rounded px-2 py-1" /><button onClick={() => setSeed(randomSeed())} className="px-2 py-1 rounded border border-n40 hover:text-n800">随机</button></div>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-n40">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
          <button onClick={() => { if (!cur) return; onSubmit({ imageUrl: cur.url, rotate, move, vertical, wideAngle, customPrompt: customPrompt.trim() || undefined, seed }); }} className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg">生成新角度</button>
        </div>
      </div>
    </div>
  );
};

/* ======================== ProcessModal ======================== */
const ProcessModal: React.FC<{
  asset: AssetItem; materials: ModalMaterial[]; workflow: 'upscale_hd' | 'remove_watermark'; onClose: () => void; onSubmit: (url: string) => void;
}> = ({ asset, materials, workflow, onClose, onSubmit }) => {
  const [selId, setSelId] = useState(materials[0]?.id);
  const cur = materials.find(m => m.id === selId) || materials[0];
  const info = workflow === 'upscale_hd' ? { title: '高清放大', desc: 'AI放大到4K' } : { title: '去水印', desc: '智能移除水印' };
  return (
    <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
      <div className="w-full max-w-3xl bg-n0 border border-n40 rounded-2xl shadow-bottom p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div><h3 className="text-lg font-bold text-n800">{info.title} - {asset.name}</h3><p className="text-xs text-n300 mt-1">{info.desc}</p></div><button onClick={onClose} className="text-n300 hover:text-n800"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl overflow-hidden border border-n40 h-64 bg-n30 flex items-center justify-center">{cur ? <img src={secureMediaUrl(cur.url) || ''} className="w-full h-full object-contain" /> : <span className="text-xs text-n100">无</span>}</div>
          <div><span className="text-[11px] font-bold text-n100 uppercase mb-2 block">选择素材</span><div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto p-2 bg-n0 rounded-lg border border-n40">{materials.map(m => (<button key={m.id} onClick={() => setSelId(m.id)} className={`relative aspect-square rounded-lg overflow-hidden border-2 ${selId === m.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-n40'}`}><img src={secureMediaUrl(m.thumbnail || m.url) || ''} className="w-full h-full object-cover" />{selId === m.id && <div className="absolute inset-0 bg-primary-light flex items-center justify-center"><Check className="w-6 h-6 text-primary" /></div>}</button>))}</div></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-n40">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
          <button onClick={() => { if (!cur) return; onSubmit(cur.url); }} className={`px-5 py-2 rounded-lg text-xs font-bold text-white shadow-lg ${workflow === 'upscale_hd' ? 'bg-primary hover:bg-primary-hover' : 'bg-primary hover:bg-primary-hover'}`}>开始处理</button>
        </div>
      </div>
    </div>
  );
};
