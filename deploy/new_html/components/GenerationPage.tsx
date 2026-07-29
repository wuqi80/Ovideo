

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ProjectFile, StoryboardItem, MaterialLibrary, GenerationReference, ReferenceType, GeneratedImage, FileVersion } from '../types';
import { LayoutDashboard, Image as ImageIcon, Sparkles, Upload, X, ChevronLeft, ChevronRight, Wand2, Users, MapPin, Box, Zap, User, Play, CheckCircle2, CircleDashed, CheckSquare, Square, Trash2, ArrowRight, Save, History, Clock, RefreshCw, ZoomIn, Eye, FolderInput, GripVertical, Camera, Pencil, Type, MoveRight, Eraser, RotateCcw, Download, Layers, Scissors, Grid3X3, Clapperboard, AlertTriangle, Library, Search, Check } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { generateFinalIllustrationResult } from '../services/geminiImageGenerationService';
import { generateWithComfyUIWorkflowQueued, generateHumanMultiAngleQueued, generateAroundAngleQueued, adjustImageAngleQueued, generateMattingQueued, generateImageFusionQueued, generatePanorama360Queued, generatePanoramaFusionQueued, generateAutoStoryboardQueued, generateMultiGridStoryboard } from '../services/comfyuiGenerationService';
import { getComfyUIQueueStatus, waitForComfyUITaskAllImages } from '../services/comfyuiTaskWaitService';
// 2026-05-21：分镜页 GPT Image 2 系列 + 化神参数面板
import { generateGptImage, type GptImageQuality } from '../services/gptImageService';
import {
  GPT_IMAGE_RATIO_OPTIONS,
  GPT_IMAGE_K_OPTIONS,
  GPT_IMAGE_QUALITY_OPTIONS,
  recommendGptImageSize,
  resolveGptImageSettings,
  type GptImageRatio,
  type GptImageK,
  type SourceImageDimensions,
} from '../utils/gptImageSizeMap';
import type { GeneratedImageResult, ComfyUITaskRegistryMeta } from '../services/comfyuiTaskWaitService';
import type { TaskKind } from '../types';
import { generateThumbnail } from '../utils/imageOptimization';
import { loadShotImages, clearImageCache, getCachedBlobUrl, setCachedBlobUrl, removeImageFromCache, getImageThumbnailUrl } from '../services/imageLoaderService';
import { saveRunningTask, removeRunningTask, getRecoverableTasks } from '../services/taskRecovery';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
import { apiBlob, secureApiUrl } from '../services/httpClient';
import {
  DEFAULT_GPU_NODE_NAME,
  fetchClusterNodes,
  isClusterNodeUsable,
  resolveGpuTaskRouting,
  setPreferredGpuNodeId,
  type ClusterNodeOption,
} from '../services/clusterNodeService';
import { fitAngleOutputDimensions } from '../utils/angleOutputSize';
import {
  buildIdentityAnchoredPrompt,
  mergeDefaultShotReferences,
  resolveSelectedShotReferences,
  resolveShotReferencePlan,
  resolveShotReferences,
  type StoryboardGenerationModel,
} from '../utils/storyboardConsistency';
import {
  applyStoryboardProviderProgress,
  buildOtherStoryboardImagePickerItems,
  createStoryboardGenerationProgress,
  dedupeGeneratedImages,
  estimateStoryboardGenerationProgress,
  formatStoryboardGenerationEta,
  runSingleFlight,
  type StoryboardGenerationProgressState,
} from '../utils/storyboardGeneration';
import {
  resolveStoryboardImageDrag,
  serializeStoryboardImageDrag,
  STORYBOARD_IMAGE_DRAG_MIME,
} from '../utils/storyboardImageDrag';

const MattingModal = React.lazy(() => import('./MattingModal'));
const ImageFusionModal = React.lazy(() => import('./ImageFusionModal'));
const StoryboardToolModal = React.lazy(() => import('./StoryboardToolModal'));
const MultiAngle3DController = React.lazy(() => import('./MultiAngle3DController'));

function normalizeImageDownloadUrl(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const normalized = url.startsWith('http') ? url : (url.startsWith('/') ? url : `/${url}`);
  return secureApiUrl(normalized, { absolute: true });
}

const imageDimensionRequestCache = new Map<string, Promise<SourceImageDimensions | null>>();

function probeImageDimensions(url: string): Promise<SourceImageDimensions | null> {
  if (!url || typeof Image === 'undefined') return Promise.resolve(null);
  const normalizedUrl = normalizeImageDownloadUrl(url);
  const cached = imageDimensionRequestCache.get(normalizedUrl);
  if (cached) return cached;

  const request = new Promise<SourceImageDimensions | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    image.onerror = () => resolve(null);
    image.src = normalizedUrl;
  });
  imageDimensionRequestCache.set(normalizedUrl, request);
  return request;
}

async function loadImageDimensions(urls: string[]): Promise<SourceImageDimensions[]> {
  const dimensions = await Promise.all(
    Array.from(new Set(urls.filter(Boolean))).map(probeImageDimensions),
  );
  return dimensions.filter((item): item is SourceImageDimensions => item !== null);
}

async function downloadImageBlob(url: string, apiName = '下载图片'): Promise<Blob> {
  return apiBlob(normalizeImageDownloadUrl(url), { method: 'GET' }, apiName, {
    requireAuth: false,
    includeContentType: false,
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function notifyStoryboardImageChanged(episodeId: string | undefined, shotId: string | undefined) {
  if (typeof window === 'undefined' || !shotId) return;
  window.dispatchEvent(new CustomEvent('drama:episode-data-changed', {
    detail: {
      episodeId,
      entityType: 'storyboard_item',
      entityId: shotId,
      fileRole: 'generated_image',
      type: 'image',
      targetPage: 'generation',
      targetItemId: shotId,
      status: 'completed',
    },
  }));
}

const ModalChunkFallback: React.FC = () => (
  <div className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center">
    <div className="rounded-md border border-n40 bg-n0 px-4 py-3 text-sm text-n300 shadow-bottom">
      加载工具...
    </div>
  </div>
);

interface GenerationPageProps {
  files: ProjectFile[];
  selectedFileId: string | null;
  episodeId?: string;
  materialLibrary: MaterialLibrary;
  onUpdateStoryboardItem: (shotId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => void;
  onSaveVersion: (name: string) => void;
  onRestoreVersion: (version: FileVersion) => void;
  onDeleteVersion: (versionId: string) => void;
  onForceSave: () => void;
  onExportNext: (data: any) => void;
  onImportProject: () => void;
  shotPageSize?: number;
  totalShotCount?: number;
  onVisibleShotCountChange?: (count: number) => void;
  onLoadAllStoryboardItems?: () => Promise<void> | void;
  onDeleteStoryboardItem?: (itemId: string) => void;  // 2026-06-14：删除分镜镜头
  onBatchDeleteStoryboardItems?: (itemIds: string[]) => Promise<void> | void;  // 2026-06-14：批量删除选中镜头
  assetScopeMode?: 'episode' | 'project';
  onAssetScopeModeChange?: (mode: 'episode' | 'project') => void;
}

export const GenerationPage: React.FC<GenerationPageProps> = ({
  files,
  selectedFileId,
  episodeId,
  materialLibrary,
  onUpdateStoryboardItem,
  onSaveVersion,
  onRestoreVersion,
  onDeleteVersion,
  onForceSave,
  onExportNext,
  onImportProject,
  shotPageSize,
  totalShotCount,
  onVisibleShotCountChange,
  onLoadAllStoryboardItems,
  onDeleteStoryboardItem,
  onBatchDeleteStoryboardItems,
  assetScopeMode = 'episode',
  onAssetScopeModeChange,
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const selectedFile = files.find(f => f.id === selectedFileId);
  // 2026-05-20 (Bug #3)：当前选中镜头持久化（按 episodeId scope）。刷新或切走再回都保持选中。
  const [selectedShotId, setSelectedShotId] = usePersistedPageState<string | null>({
    page: 'GenerationPage:selectedShotId',
    episodeId,
    version: 1,
    defaultValue: null,
  });
  
  // Batch Selection — 多选 Set 不持久化（运行时态，刷新清空合理）
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());
  const [isLoadingAllShotsForSelection, setIsLoadingAllShotsForSelection] = useState(false);
  const [selectAllAfterLoad, setSelectAllAfterLoad] = useState(false);
  // 分镜列表默认只渲染前 N 个，避免镜头很多时（如 70+）一次性渲染卡顿；点"展开更多"按需加载
  const SHOT_PAGE_SIZE = Math.max(1, shotPageSize || 10);
  const [visibleShotCount, setVisibleShotCount] = useState<number>(SHOT_PAGE_SIZE);

  // Configuration State
  const [prompt, setPrompt] = useState<string>('');
  const [references, setReferences] = useState<GenerationReference[]>([]);
  const referencesRef = useRef<GenerationReference[]>([]);
  const activeReferenceShotIdRef = useRef<string | null>(null);
  const visibleStoryboardItems = useMemo(
    () => selectedFile?.storyboard?.items.slice(0, visibleShotCount) || [],
    [selectedFile?.storyboard?.items, visibleShotCount],
  );

  useEffect(() => {
    onVisibleShotCountChange?.(visibleShotCount);
  }, [visibleShotCount, onVisibleShotCountChange]);

  useEffect(() => {
    setVisibleShotCount(SHOT_PAGE_SIZE);
  }, [selectedFileId, SHOT_PAGE_SIZE]);

  // 2026-05-20 (Task System Overhaul M3)：构造传给 generateXxxQueued 的 registryMeta，
  // 让铃铛 / TaskBadge / 跨页通知能感知该镜头正在生成。
  const buildRegistryMeta = useCallback((
    shot: StoryboardItem | null | undefined,
    kind: TaskKind,
    titlePrefix: string,
  ): ComfyUITaskRegistryMeta => {
    const projectId = (() => {
      try { return localStorage.getItem('current_project_id') || undefined; } catch { return undefined; }
    })();
    const shotLabel = shot?.shotNumber || (shot?.id ? `#${String(shot.id).slice(0, 6)}` : '?');
    return {
      title: `${titlePrefix} · 镜头 ${shotLabel}`,
      kind,
      targetPage: 'generation',
      targetEntityType: 'storyboard_item',
      targetEntityId: shot?.id,
      targetItemId: shot?.id,
      targetProjectId: projectId,
      episodeId,
      fileRole: 'generated_image',
    };
  }, [episodeId]);

  // 追踪用户是否手动修改了prompt（textarea onBlur 用来决定是否写回 shot.imagePrompt）
  const userEditedPromptRef = useRef<boolean>(false);
  const generationRequestsRef = useRef<Map<string, Promise<void>>>(new Map());
  const recoveryStartedRef = useRef(false);
  const updateCurrentShotReferences = useCallback((
    nextValue: GenerationReference[] | ((current: GenerationReference[]) => GenerationReference[]),
    extraUpdates: Partial<StoryboardItem> = {},
  ) => {
    const nextReferences = typeof nextValue === 'function'
      ? nextValue(referencesRef.current)
      : nextValue;
    referencesRef.current = nextReferences;
    setReferences(nextReferences);
    if (selectedShotId) {
      onUpdateStoryboardItem(selectedShotId, {
        ...extraUpdates,
        configuredReferences: nextReferences,
        referenceConfigInitialized: true,
      });
    }
    return nextReferences;
  }, [onUpdateStoryboardItem, selectedShotId]);

  // 2026-05-24 (Bug 1)：移除 filledShotIdsRef "只填充一次" 的优化。
  // 那个 guard 让 effect 在第二次切回某个 shot 时直接 return，
  // 导致 prompt state 留在上一个 shot 的值（"点 shot2 再回 shot1 时 prompt 仍是 shot2 的"）。
  // 改为：每次 selectedShotId 变化，effect 都从 shot.imagePrompt / shot.configuredReferences
  // 重新加载。textarea 的 onBlur 已经把用户编辑写回 shot，所以切换前的编辑不会丢。
  useEffect(() => {
    if (!selectedShotId || !selectedFile?.storyboard) return;

    const shot = selectedFile.storyboard.items.find(s => s.id === selectedShotId);
    if (!shot) return;

    console.log('🔄 切换到镜头，重新加载数据:', selectedShotId);

    // 填充提示词
    setPrompt(shot.imagePrompt || '');
    userEditedPromptRef.current = false;

    // 同一镜头的其他字段更新不能覆盖尚在当前页面编辑的外部参考图。
    // 只有真正切换镜头时，才从该镜头已持久化的 configuredReferences 重新装载。
    const nextReferences = resolveSelectedShotReferences(
      shot,
      materialLibrary,
      activeReferenceShotIdRef.current,
      referencesRef.current,
    );
    activeReferenceShotIdRef.current = shot.id;
    referencesRef.current = nextReferences;
    setReferences(nextReferences);
    if (!shot.referenceConfigInitialized) {
      onUpdateStoryboardItem(shot.id, {
        configuredReferences: nextReferences,
        referenceConfigInitialized: true,
      });
    }
  }, [selectedShotId, selectedFile?.storyboard?.items, materialLibrary, onUpdateStoryboardItem]);

  // 🆕 自动为已有素材生成缩略图（只在首次加载时执行一次）
  const [thumbnailProcessed, setThumbnailProcessed] = useState<Set<string>>(new Set());
  
  useEffect(() => {
    if (!visibleStoryboardItems.length) return;
    
    // 只检查当前可见镜头，避免折叠的长分镜列表提前拉取所有远端图片
    visibleStoryboardItems.forEach(shot => {
      if (!shot.generatedImages) return;
      
      // 只处理未处理过的镜头
      if (thumbnailProcessed.has(shot.id)) return;
      
      const imagesToProcess = shot.generatedImages.filter(img => !img.thumbnail);
      
      if (imagesToProcess.length > 0) {
        console.log(`🔄 镜头 ${shot.id}: 为 ${imagesToProcess.length} 张图片生成缩略图...`);
        
        // 标记为已处理（避免重复生成）
        setThumbnailProcessed(prev => new Set(prev).add(shot.id));
        
        Promise.all(
          imagesToProcess.map(async (img) => {
            try {
              const thumbnail = await generateThumbnail(img.url, 1024, 0.8);
              return { id: img.id, thumbnail };
            } catch (error) {
              console.error('生成缩略图失败:', error);
              return null;
            }
          })
        ).then(results => {
          const updates = results.filter(r => r !== null) as { id: string; thumbnail: string }[];
          
          if (updates.length > 0) {
            const updatedImages = shot.generatedImages!.map(img => {
              const update = updates.find(u => u.id === img.id);
              return update ? { ...img, thumbnail: update.thumbnail } : img;
            });
            
            onUpdateStoryboardItem(shot.id, {
              generatedImages: updatedImages
            });
            
            console.log(`✅ 镜头 ${shot.id}: 已为 ${updates.length} 张图片生成缩略图并保存`);
          }
        });
      } else {
        // 没有需要处理的图片，也标记为已处理
        setThumbnailProcessed(prev => new Set(prev).add(shot.id));
      }
    });
  }, [selectedFile?.id, visibleStoryboardItems]); // 只处理当前可见镜头
  
  const [generatingShotIds, setGeneratingShotIds] = useState<Set<string>>(new Set());
  const [generationProgressByShot, setGenerationProgressByShot] = useState<Record<string, StoryboardGenerationProgressState>>({});
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number, activeShotId?: string} | null>(null);
  const isGenerating = generatingShotIds.size > 0;
  const isCurrentShotGenerating = selectedShotId ? generatingShotIds.has(selectedShotId) : false;
  const currentGenerationProgress = selectedShotId ? generationProgressByShot[selectedShotId] : undefined;

  const beginShotProgress = useCallback((
    shotId: string,
    model: string,
    startedAt = Date.now(),
    stage = '准备生成',
  ) => {
    setGenerationProgressByShot(prev => ({
      ...prev,
      [shotId]: createStoryboardGenerationProgress(model, startedAt, stage),
    }));
  }, []);

  const updateShotProgressStage = useCallback((
    shotId: string,
    stage: string,
    percent?: number,
  ) => {
    setGenerationProgressByShot(prev => {
      const current = prev[shotId];
      if (!current) return prev;
      return {
        ...prev,
        [shotId]: {
          ...current,
          stage,
          percent: percent == null ? current.percent : Math.max(current.percent, percent),
        },
      };
    });
  }, []);

  const updateShotProviderProgress = useCallback((shotId: string, progress: number) => {
    setGenerationProgressByShot(prev => {
      const current = prev[shotId];
      if (!current) return prev;
      return {
        ...prev,
        [shotId]: applyStoryboardProviderProgress(current, progress),
      };
    });
  }, []);

  const clearShotProgress = useCallback((shotId: string) => {
    setGenerationProgressByShot(prev => {
      if (!prev[shotId]) return prev;
      const next = { ...prev };
      delete next[shotId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (generatingShotIds.size === 0) return;
    const timer = window.setInterval(() => {
      setGenerationProgressByShot(prev => {
        let changed = false;
        const next = { ...prev };
        generatingShotIds.forEach(shotId => {
          const current = prev[shotId];
          if (!current) return;
          const updated = estimateStoryboardGenerationProgress(current);
          if (updated.percent !== current.percent || updated.etaSeconds !== current.etaSeconds) {
            next[shotId] = updated;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generatingShotIds]);

  const batchProgressDisplay = useMemo(() => {
    if (!batchProgress || batchProgress.total <= 0) return null;
    const active = batchProgress.activeShotId
      ? generationProgressByShot[batchProgress.activeShotId]
      : undefined;
    const aggregatePercent = Math.min(100, Math.round(
      ((batchProgress.current + ((active?.percent || 0) / 100)) / batchProgress.total) * 100,
    ));
    const remainingQueued = Math.max(
      0,
      batchProgress.total - batchProgress.current - (batchProgress.activeShotId ? 1 : 0),
    );
    const expectedPerQueuedShot = active?.expectedSeconds || 120;
    const activeEta = active?.etaSeconds ?? expectedPerQueuedShot;
    const etaSeconds = activeEta === null
      ? null
      : activeEta + (remainingQueued * expectedPerQueuedShot);
    return { aggregatePercent, etaSeconds, active };
  }, [batchProgress, generationProgressByShot]);

  // Version Control State
  const [showHistory, setShowHistory] = useState(false);
  const [isNamingVersion, setIsNamingVersion] = useState(false);
  const [versionName, setVersionName] = useState('');

  // Image Preview State
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isLoadingFullImage, setIsLoadingFullImage] = useState(false);
  // 🆕 图片预览导航状态 - 用于左右切换
  const [previewShotId, setPreviewShotId] = useState<string | null>(null);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  // 🔧 使用模块级缓存，不再使用本地state（页面切换后不丢失）
  
  // Camera Angle Adjustment State
  const [cameraModalImage, setCameraModalImage] = useState<string | null>(null);
  const [isAngleAdjusting, setIsAngleAdjusting] = useState(false);
  
  // 🆕 Human Multi-Angle Generation State
  const [humanMultiAngleModalImage, setHumanMultiAngleModalImage] = useState<string | null>(null);
  const [isHumanMultiAngleGenerating, setIsHumanMultiAngleGenerating] = useState(false);
  
  // 🆕 Around Angle (全景) Generation State
  const [aroundAngleModalImage, setAroundAngleModalImage] = useState<string | null>(null);
  const [isAroundAngleGenerating, setIsAroundAngleGenerating] = useState(false);

  // 🆕 抠图 (Matting) State
  const [mattingModalImage, setMattingModalImage] = useState<string | null>(null);
  const [isMattingProcessing, setIsMattingProcessing] = useState(false);

  // 🆕 融合 (Image Fusion) State
  const [showFusionModal, setShowFusionModal] = useState(false);
  const [isFusionProcessing, setIsFusionProcessing] = useState(false);

  // 🆕 分镜工具 (Storyboard Tool) State
  const [showStoryboardToolModal, setShowStoryboardToolModal] = useState(false);
  const [isStoryboardToolProcessing, setIsStoryboardToolProcessing] = useState(false);
  
  // 🆕 Image Editor State
  const [imageEditorData, setImageEditorData] = useState<{
    imageUrl: string;
    referenceId: string;  // 用于更新原图
  } | null>(null);
  
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [materialPickerFilter, setMaterialPickerFilter] = useState<'shot' | 'other-shot' | 'character' | 'scene' | 'prop' | 'all'>('shot');
  const [materialPickerSearch, setMaterialPickerSearch] = useState('');
  const [isLoadingOtherShotImages, setIsLoadingOtherShotImages] = useState(false);

  // Generation Model State
  // 2026-05-21：扩 type — 加 qwenN_lora（修历史漏洞，UI 早就在用但 type 没声明）
  // + gpt_image_vip（天劫一阶 / gpt-image-2-vip）+ gpt_image_official（天劫二阶 / gpt-image-2 Sora2）
  type GenerationModel = StoryboardGenerationModel;
  // 2026-05-20 (Bug #3)：模型选择持久化 — 切页 / 刷新都不丢用户偏好。
  const [globalModel, setGlobalModel] = usePersistedPageState<GenerationModel>({
    page: 'GenerationPage:globalModel',
    episodeId,
    // 2026-06-14：默认从 'qwen'（练气一阶，ComfyUI 需 GPU agent）改为 'nanobanana'（化神，走 API 网关，
    // 开箱即用、就是出成片那 8 张图的通道）。version+1 让旧持久化的 'qwen' 失效、回落新默认。
    version: 2,
    defaultValue: 'nanobanana',
  });
  // ComfyUI 档位固定使用用户选择的 GPU 节点，默认 GPU1。
  const COMFYUI_MODELS = React.useMemo(() => new Set<string>(['qwen', 'qwen_lora', 'qwenN', 'qwenN_lora', 'kontext']), []);
  const [clusterNodes, setClusterNodes] = useState<ClusterNodeOption[]>([]);
  const [clusterNodesLoading, setClusterNodesLoading] = useState(false);
  const [clusterNodeMessage, setClusterNodeMessage] = useState('');
  const [selectedClusterNodeId, setSelectedClusterNodeId] = usePersistedPageState<string>({
    page: 'GenerationPage:selectedClusterNodeId',
    episodeId,
    version: 2,
    defaultValue: DEFAULT_GPU_NODE_NAME,
  });
  const usableClusterNodes = useMemo(
    () => clusterNodes.filter(isClusterNodeUsable),
    [clusterNodes],
  );
  const selectedClusterNode = useMemo(
    () => clusterNodes.find((node) => (
      node.id === selectedClusterNodeId
      || node.agentId === selectedClusterNodeId
      || node.name === selectedClusterNodeId
    )),
    [clusterNodes, selectedClusterNodeId],
  );
  const loadClusterNodeOptions = useCallback(async () => {
    setClusterNodesLoading(true);
    try {
      const result = await fetchClusterNodes();
      setClusterNodes(result.nodes);
      setClusterNodeMessage(result.message);
    } catch (error) {
      console.warn('[GenerationPage] cluster nodes unavailable:', error);
      setClusterNodes([]);
      setClusterNodeMessage('GPU 集群节点状态暂时不可用，请刷新后重试。');
    } finally {
      setClusterNodesLoading(false);
    }
  }, []);
  useEffect(() => {
    loadClusterNodeOptions();
  }, [loadClusterNodeOptions]);
  const [shotModels, setShotModels] = usePersistedPageState<Record<string, GenerationModel>>({
    page: 'GenerationPage:shotModels',
    episodeId,
    version: 1,
    defaultValue: {},
  });

  // 所有分镜图像模型共享比例 / 分辨率偏好。默认 16:9 + 1K；
  // 用户主动选择 auto 时，提交前按最大参考图解析为确定值。
  const [imageRatio, setImageRatio] = usePersistedPageState<GptImageRatio>({
    page: 'GenerationPage:imageRatio',
    episodeId,
    version: 2,
    defaultValue: '16:9',
  });
  const [imageK, setImageK] = usePersistedPageState<GptImageK>({
    page: 'GenerationPage:imageK',
    episodeId,
    version: 2,
    defaultValue: '1K',
  });
  const [imageQuality, setImageQuality] = usePersistedPageState<GptImageQuality>({
    page: 'GenerationPage:imageQuality',
    episodeId,
    version: 1,
    defaultValue: 'auto',
  });
  
  // 2026-05-24 (Bug 1)：filledShotIdsRef 也一并移除——effect 已改成每次切 shot 都重新加载

  // Resizable Sidebar State — 持久化（用户的视觉偏好）
  const [sidebarWidth, setSidebarWidth] = usePersistedPageState<number>({
    page: 'GenerationPage:sidebarWidth',
    episodeId: 'global', // 宽度是全局偏好，不按剧集隔离
    version: 1,
    defaultValue: 260,
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback(() => {
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
    if (isResizing) {
        const newWidth = mouseMoveEvent.clientX;
        if (newWidth >= 200 && newWidth <= 600) {
            setSidebarWidth(newWidth);
        }
    }
  }, [isResizing]);

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
        window.removeEventListener("mousemove", resize);
        window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  // Initialize first shot
  // 2026-06-14：持久化的 selectedShotId 可能指向已被删除/改动的镜头（如分镜重建、版本合并后），
  // 此时 find 不到会导致详情区空白（提示词/结果都没）。除了「未选」要回退到首镜，
  // 「已选但当前镜头列表里不存在」也必须回退，否则卡在幽灵 id 上。
  useEffect(() => {
      const items = selectedFile?.storyboard?.items;
      if (!items?.length) return;
      const exists = selectedShotId && items.some(s => s.id === selectedShotId);
      if (!exists) {
          setSelectedShotId(items[0].id);
      }
  }, [selectedFile, selectedShotId]);

  // 选中的镜头若超出当前折叠范围（如从底部时间轴点选了靠后的镜头），自动展开到能显示它
  useEffect(() => {
      const items = selectedFile?.storyboard?.items;
      if (!items?.length || !selectedShotId) return;
      const idx = items.findIndex(s => s.id === selectedShotId);
      if (idx >= visibleShotCount) {
          setVisibleShotCount(Math.ceil((idx + 1) / SHOT_PAGE_SIZE) * SHOT_PAGE_SIZE);
      }
  }, [selectedShotId, selectedFile, visibleShotCount]);


  // 任务恢复：页面加载时检查 localStorage 中未完成的任务，恢复轮询
  useEffect(() => {
    if (recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    const recoverTasks = async () => {
      const tasks = getRecoverableTasks();
      if (tasks.length === 0) return;
      console.log(`🔄 发现 ${tasks.length} 个未完成的生成任务，开始恢复...`);
      for (const task of tasks) {
        try {
          setGeneratingShotIds(prev => new Set(prev).add(task.shotId));
          beginShotProgress(task.shotId, task.model, task.startedAt, '正在恢复生成任务');
          const urls = await waitForComfyUITaskAllImages(
            task.taskId,
            progress => updateShotProviderProgress(task.shotId, progress),
          );
          updateShotProgressStage(task.shotId, '正在保存生成结果', 97);
          removeRunningTask(task.taskId);

          const newImages: GeneratedImage[] = (urls as GeneratedImageResult[])
            .filter((r) => r.url)
            .map((r) => ({
              id: r.fileId || uuidv4(),
              url: r.url,
              thumbnail: r.url,
              timestamp: Date.now(),
              fileId: r.fileId || undefined,
            }));

          if (newImages.length > 0) {
            onUpdateStoryboardItem(task.shotId, {
              generatedImages: newImages,
              selectedImageId: newImages[0].id,
              generatedImage: newImages[0].url,
            });
            window.dispatchEvent(new CustomEvent('generation-save-trigger'));
            console.log(`✅ 恢复任务完成: ${task.shotId}, ${newImages.length} 张图片`);
          }
        } catch (e) {
          console.error(`❌ 恢复任务失败: ${task.taskId}`, e);
          removeRunningTask(task.taskId);
        } finally {
          setGeneratingShotIds(prev => { const next = new Set(prev); next.delete(task.shotId); return next; });
          clearShotProgress(task.shotId);
        }
      }
    };
    recoverTasks();
  }, [beginShotProgress, clearShotProgress, onUpdateStoryboardItem, updateShotProgressStage, updateShotProviderProgress]);

  const renderHistoryPanel = () => (
    <div className="absolute top-[52px] right-0 bottom-0 w-80 bg-n0 border-l border-n40 z-40 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="p-3 border-b border-n40 flex items-center justify-between bg-n0">
            <h3 className="text-xs font-bold text-n700 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                内部历史版本存档
            </h3>
            <button onClick={() => setShowHistory(false)} className="text-n100 hover:text-n800">
                <X className="w-4 h-4" />
            </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {selectedFile?.versions && selectedFile.versions.length > 0 ? (
                [...selectedFile.versions].reverse().map(ver => (
                    <div key={ver.id} className="bg-n30 border border-n40 rounded-lg p-3 hover:bg-n20 transition-colors group">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <div className="text-xs font-bold text-n700">{ver.name}</div>
                                <div className="text-[10px] text-n100 font-mono mt-0.5">
                                    {new Date(ver.timestamp).toLocaleString()}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => {
                                    if(confirm(`确定要从内部存档 "${ver.name}" 恢复吗？\n当前未保存的修改将丢失。`)) {
                                        onRestoreVersion(ver);
                                        setShowHistory(false);
                                    }
                                }}
                                className="flex-1 py-1.5 bg-primary-light hover:bg-primary border border-primary/30 rounded text-[10px] text-primary hover:text-n800 transition-colors flex items-center justify-center gap-1 group-hover:border-primary"
                            >
                                <RefreshCw className="w-3 h-3" />
                                恢复此版本
                            </button>
                            <button 
                                onClick={() => {
                                    if(confirm(`确定要删除版本 "${ver.name}" 吗？\n此操作不可撤销。`)) {
                                        onDeleteVersion(ver.id);
                                    }
                                }}
                                className="py-1.5 px-3 bg-r50 hover:bg-danger border border-danger rounded text-[10px] text-danger hover:text-white transition-colors flex items-center justify-center gap-1 group-hover:border-danger"
                                title="删除此版本"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                ))
            ) : (
                <div className="flex flex-col items-center justify-center py-10 text-n100 gap-2">
                    <History className="w-8 h-8 opacity-20" />
                    <div className="text-center text-xs">
                        暂无内部存档记录<br/>
                        请点击上方 <span className="text-primary font-bold">保存</span> 按钮创建存档
                    </div>
                </div>
            )}
        </div>
    </div>
  );

  // Always show UI, even without data
  const hasStoryboard = selectedFile && selectedFile.storyboard && selectedFile.storyboard.items.length > 0;
  const storyboardTotalCount = totalShotCount ?? selectedFile?.storyboard?.items.length ?? 0;
  const loadedStoryboardCount = selectedFile?.storyboard?.items.length ?? 0;
  const hasUnloadedStoryboardItems = storyboardTotalCount > loadedStoryboardCount;
  const allStoryboardItemsSelected = storyboardTotalCount > 0 && selectedShotIds.size === storyboardTotalCount;
  const selectedShot = hasStoryboard && selectedFile ? selectedFile.storyboard!.items.find(i => i.id === selectedShotId) : null;
  const referencePlan = useMemo(() => (
      selectedShot
          ? resolveShotReferencePlan(selectedShot, materialLibrary, references)
          : { references: [], excluded: [], criticalExcluded: [], maxReferences: 6 }
  ), [materialLibrary, references, selectedShot]);
  const selectedGenerationModel = selectedShot
      ? (shotModels[selectedShot.id] || globalModel)
      : globalModel;
  const [selectedReferenceDimensions, setSelectedReferenceDimensions] = useState<SourceImageDimensions[]>([]);
  const [isLoadingReferenceDimensions, setIsLoadingReferenceDimensions] = useState(false);
  useEffect(() => {
      let active = true;
      const urls = referencePlan.references.map(reference => reference.url).filter(Boolean);
      const needsAutomaticResolution = imageRatio === 'auto' || imageK === 'auto';
      if (!needsAutomaticResolution || urls.length === 0) {
          setSelectedReferenceDimensions([]);
          setIsLoadingReferenceDimensions(false);
          return () => {
              active = false;
          };
      }

      setIsLoadingReferenceDimensions(true);
      loadImageDimensions(urls)
          .then(dimensions => {
              if (active) setSelectedReferenceDimensions(dimensions);
          })
          .finally(() => {
              if (active) setIsLoadingReferenceDimensions(false);
          });
      return () => {
          active = false;
      };
  }, [imageK, imageRatio, referencePlan.references]);
  const selectedImageSettings = useMemo(
      () => resolveGptImageSettings(imageRatio, imageK, selectedReferenceDimensions),
      [imageK, imageRatio, selectedReferenceDimensions],
  );
  const materialPickerItems = useMemo(() => {
      const typeByTag = new Map<string, 'character' | 'scene' | 'prop'>();
      for (const file of files) {
          for (const item of file.storyboard?.items || []) {
              for (const character of item.characters || []) typeByTag.set(character, 'character');
              if (item.scene) typeByTag.set(item.scene, 'scene');
              for (const prop of item.props || []) typeByTag.set(prop, 'prop');
          }
      }

      const relevantTags = new Set([
          ...(selectedShot?.characters || []),
          ...(selectedShot?.props || []),
          ...(selectedShot?.scene ? [selectedShot.scene] : []),
      ]);
      return Object.entries(materialLibrary)
          .flatMap(([tagName, materials]) => materials.map(material => {
              const type = material.assetType || typeByTag.get(tagName) || 'prop';
              return {
                  key: `${tagName}:${material.id}`,
                  tagName,
                  material,
                  type,
                  isRelevant: relevantTags.has(tagName),
              };
          }))
          .sort((left, right) => (
              Number(right.isRelevant) - Number(left.isRelevant)
              || left.type.localeCompare(right.type)
              || left.tagName.localeCompare(right.tagName, 'zh-CN')
          ));
  }, [files, materialLibrary, selectedShot]);

  const visibleMaterialPickerItems = useMemo(() => {
      const keyword = materialPickerSearch.trim().toLowerCase();
      return materialPickerItems.filter(item => {
          if (materialPickerFilter === 'shot' && !item.isRelevant) return false;
          if (materialPickerFilter === 'other-shot') return false;
          if (materialPickerFilter !== 'shot' && materialPickerFilter !== 'all' && item.type !== materialPickerFilter) return false;
          if (!keyword) return true;
          return [item.tagName, item.material.name, item.material.description]
              .some(value => String(value || '').toLowerCase().includes(keyword));
      });
  }, [materialPickerFilter, materialPickerItems, materialPickerSearch]);
  const otherStoryboardImageItems = useMemo(
      () => buildOtherStoryboardImagePickerItems(
          selectedFile?.storyboard?.items || [],
          selectedShot?.id,
      ),
      [selectedFile?.storyboard?.items, selectedShot?.id],
  );
  const visibleOtherStoryboardImageItems = useMemo(() => {
      if (materialPickerFilter !== 'other-shot' && materialPickerFilter !== 'all') return [];
      const keyword = materialPickerSearch.trim().toLowerCase();
      if (!keyword) return otherStoryboardImageItems;
      return otherStoryboardImageItems.filter(item => item.searchText.includes(keyword));
  }, [materialPickerFilter, materialPickerSearch, otherStoryboardImageItems]);
  const materialPickerFilterCounts = useMemo<Record<typeof materialPickerFilter, number>>(() => {
      const counts = materialPickerItems.reduce(
          (acc, item) => {
              acc.all += 1;
              if (item.isRelevant) acc.shot += 1;
              acc[item.type] += 1;
              return acc;
          },
          {
              shot: 0,
              'other-shot': otherStoryboardImageItems.length,
              character: 0,
              scene: 0,
              prop: 0,
              all: otherStoryboardImageItems.length,
          },
      );
      return counts;
  }, [materialPickerItems, otherStoryboardImageItems.length]);

  useEffect(() => {
      if (!selectAllAfterLoad || !selectedFile?.storyboard?.items.length) return;
      const items = selectedFile.storyboard.items;
      const total = storyboardTotalCount || items.length;
      if (items.length < total) return;
      setVisibleShotCount(total);
      setSelectedShotIds(new Set(items.map(i => i.id)));
      setSelectAllAfterLoad(false);
  }, [selectAllAfterLoad, selectedFile?.storyboard?.items, storyboardTotalCount]);

  // --- Selection Logic ---
  const toggleShotSelection = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setSelectedShotIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  };

  const toggleSelectAll = async () => {
      if (allStoryboardItemsSelected) {
          setSelectedShotIds(new Set());
          setSelectAllAfterLoad(false);
      } else {
          if (hasUnloadedStoryboardItems && onLoadAllStoryboardItems) {
              setIsLoadingAllShotsForSelection(true);
              setSelectAllAfterLoad(true);
              try {
                  await onLoadAllStoryboardItems();
              } catch (e) {
                  console.error('加载全部分镜失败:', e);
                  setSelectAllAfterLoad(false);
              } finally {
                  setIsLoadingAllShotsForSelection(false);
              }
              return;
          }
          setSelectedShotIds(new Set(selectedFile.storyboard?.items.map(i => i.id)));
      }
  };

  // --- Reference Logic ---
  const handleAddReference = (
      url: string,
      type: ReferenceType,
      name?: string,
      metadata: Partial<Pick<GenerationReference, 'assetId' | 'fileId' | 'description'>> = {},
  ) => {
      if (references.length >= 6) {
          alert("最多只能加载6张参考图片");
          return;
      }
      if (references.some(reference => reference.url === url)) return;
      const newRef: GenerationReference = {
          id: uuidv4(),
          url,
          type,
          name,
          source: 'manual',
          ...metadata,
      };
      console.log(`➕ 添加参考图片:`, { type, name, urlLength: url.length });
      updateCurrentShotReferences(prev => {
          const updated = [...prev, newRef];
          console.log(`📊 当前参考图片总数: ${updated.length}`);
          return updated;
      });
  };

  const handleAutoFill = () => {
      if (!selectedShot) return;
      const merged = mergeDefaultShotReferences(
        referencesRef.current,
        resolveShotReferences(selectedShot, materialLibrary),
      );
      if (merged.exceedsLimit) {
          alert('无法恢复自动绑定，因为超过6张图');
          return;
      }
      updateCurrentShotReferences(merged.references);
  };

  const handleAddProjectMaterial = (item: (typeof materialPickerItems)[number]) => {
      handleAddReference(
          item.material.url,
          item.type,
          item.tagName || item.material.name,
          {
              assetId: item.material.assetId,
              fileId: item.material.fileId,
              description: item.material.description,
          },
      );
  };

  const handleAddOtherStoryboardImage = (
      item: (typeof otherStoryboardImageItems)[number],
  ) => {
      handleAddReference(
          item.url,
          'pose',
          `${item.shotLabel} · ${item.imageLabel}`,
          {
              fileId: item.fileId || undefined,
              description: `来自其他分镜：${item.shotLabel}`,
          },
      );
  };

  const handleMaterialPickerFilterChange = async (
      filter: typeof materialPickerFilter,
  ) => {
      setMaterialPickerFilter(filter);
      if (
          (filter === 'other-shot' || filter === 'all')
          && hasUnloadedStoryboardItems
          && onLoadAllStoryboardItems
          && !isLoadingOtherShotImages
      ) {
          setIsLoadingOtherShotImages(true);
          try {
              await onLoadAllStoryboardItems();
          } catch (error) {
              console.error('加载其他分镜图片失败:', error);
          } finally {
              setIsLoadingOtherShotImages(false);
          }
      }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: ReferenceType) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          console.log(`📤 上传参考图片: ${file.name}, 大小: ${(file.size / 1024).toFixed(2)}KB`);
          try {
              const { uploadEntityFile } = await import('../services/entityFileService');
              const shotId = selectedShot?.id || 'temp';
              const saved = await uploadEntityFile(file, 'storyboard_item', shotId, 'reference_image', episodeId);
              console.log(`✅ 参考图片已上传到服务器: ${saved.fileUrl}`);
              handleAddReference(saved.fileUrl, type, file.name, { fileId: saved.fileId });
          } catch (err) {
              console.error('❌ 参考图片上传失败，回退到本地预览:', err);
              const reader = new FileReader();
              reader.onload = (ev) => {
                  if (ev.target?.result) {
                      handleAddReference(ev.target.result as string, type, file.name);
                  }
              };
              reader.readAsDataURL(file);
          }
      }
  };

  const handleConfirmConfig = () => {
      if (!selectedShot) return;
      
      // 🔧 确认/取消配置 - 只切换锁定状态，不修改任何页面数据
      const newState = !selectedShot.isConfigConfirmed;
      console.log(newState ? '🔒 锁定配置' : '🔓 解锁配置');
      onUpdateStoryboardItem(selectedShot.id, { 
        isConfigConfirmed: newState
      });
  };

  const handleDeleteReference = (reference: GenerationReference) => {
      if (!selectedShot) return;
      updateCurrentShotReferences(current => (
          current.filter(item => item.id !== reference.id)
      ));
  };

  // 🆕 拖拽状态
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [isDraggingResult, setIsDraggingResult] = useState(false);
  const [imageDropTargetShotId, setImageDropTargetShotId] = useState<string | null>(null);
  const [copyingImageToShotId, setCopyingImageToShotId] = useState<string | null>(null);

  // 🆕 处理文件拖拽到参考图区域
  const handleRefDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingRef(true);
  };

  const handleRefDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingRef(false);
  };

  const handleRefDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingRef(false);
      
      if (references.length >= 6) {
          alert('最多只能添加6张参考图片');
          return;
      }

      // 检查是否是从生成结果拖入的图片URL
      const imageUrl = e.dataTransfer.getData('text/plain');
      if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.startsWith('http') || imageUrl.startsWith('/'))) {
          console.log('📥 从生成结果拖入参考图片');
          handleAddReference(imageUrl, 'character', '从生成结果拖入');
          return;
      }

      // 处理从桌面拖入的文件
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
          const file = files[0];
          if (!file.type.startsWith('image/')) {
              alert('只支持图片文件');
              return;
          }
          console.log(`📤 拖拽上传参考图片: ${file.name}`);
          (async () => {
              try {
                  const { uploadEntityFile } = await import('../services/entityFileService');
                  const shotId = selectedShot?.id || 'temp';
                  const saved = await uploadEntityFile(file, 'storyboard_item', shotId, 'reference_image', episodeId);
                  console.log(`✅ 拖拽参考图片已上传: ${saved.fileUrl}`);
                  handleAddReference(saved.fileUrl, 'character', file.name, { fileId: saved.fileId });
              } catch (err) {
                  console.error('❌ 拖拽上传失败，回退本地预览:', err);
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                      if (ev.target?.result) {
                          handleAddReference(ev.target.result as string, 'character', file.name);
                      }
                  };
                  reader.readAsDataURL(file);
              }
          })();
      }
  };

  // 🆕 处理文件拖拽到生成结果区域
  const handleResultDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingResult(true);
  };

  const handleResultDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingResult(false);
  };

  const handleResultDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingResult(false);
      
      if (!selectedShot) return;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
          const file = files[0];
          if (!file.type.startsWith('image/')) {
              alert('只支持图片文件');
              return;
          }
          console.log(`📤 拖拽上传到生成结果: ${file.name}`);
          // 🛡️ 必须走 uploadEntityFile 上传到服务器，拿到持久化 URL
          // 不能用 FileReader.readAsDataURL（base64 会撑爆 storyboard_items.generated_image_url
          // 字段，并被下游 VideoGenPage 拒收 → 视频页空白）。详见 docs/faq.md。
          (async () => {
              try {
                  const { uploadEntityFile } = await import('../services/entityFileService');
                  const saved = await uploadEntityFile(
                      file, 'storyboard_item', selectedShot.id, 'generated_image', episodeId
                  );
                  console.log(`✅ 拖拽上传画面成功（持久化 URL）: ${saved.fileUrl}`);
                  const newImage: GeneratedImage = {
                      id: saved.fileId || uuidv4(),
                      url: saved.fileUrl,
                      thumbnail: saved.fileUrl,
                      timestamp: Date.now(),
                      fileId: saved.fileId || undefined,
                  };
                  onUpdateStoryboardItem(selectedShot.id, (currentItem) => {
                      const existingImages = currentItem.generatedImages || [];
                      return {
                          generatedImages: [...existingImages, newImage],
                          selectedImageId: newImage.id,
                          generatedImage: saved.fileUrl,
                      };
                  });
                  queryClient.invalidateQueries({
                      queryKey: ['entityFiles', 'storyboard_item', selectedShot.id, 'generated_image'],
                  });
                  notifyStoryboardImageChanged(episodeId, selectedShot.id);
                  console.log('✅ 已添加到生成结果（已持久化，视频页可正常导入）');
              } catch (err) {
                  console.error('❌ 拖拽上传到生成结果失败:', err);
                  alert(`上传失败：${(err as Error).message || '未知错误'}\n\n图片未保存，请重试或检查网络。`);
              }
          })();
      }
  };

  const handleShotImageDragOver = (e: React.DragEvent, targetShotId: string) => {
      const dragTypes = Array.from(e.dataTransfer.types);
      if (
          !dragTypes.includes(STORYBOARD_IMAGE_DRAG_MIME)
          && !dragTypes.includes('text/plain')
      ) {
          return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setImageDropTargetShotId(targetShotId);
  };

  const handleShotImageDragLeave = (e: React.DragEvent, targetShotId: string) => {
      const relatedTarget = e.relatedTarget as Node | null;
      if (relatedTarget && e.currentTarget.contains(relatedTarget)) return;
      if (imageDropTargetShotId === targetShotId) setImageDropTargetShotId(null);
  };

  const handleShotImageDrop = async (e: React.DragEvent, targetShot: StoryboardItem) => {
      e.preventDefault();
      e.stopPropagation();
      setImageDropTargetShotId(null);

      const storyboardItems = selectedFile?.storyboard?.items || [];
      const dragged = resolveStoryboardImageDrag(
          e.dataTransfer.getData(STORYBOARD_IMAGE_DRAG_MIME),
          storyboardItems,
          e.dataTransfer.getData('text/plain'),
      );
      if (!dragged || dragged.sourceShotId === targetShot.id || copyingImageToShotId) return;
      const targetReferences = resolveShotReferences(
          targetShot,
          materialLibrary,
          targetShot.referenceConfigInitialized || (targetShot.configuredReferences?.length || 0) > 0
              ? targetShot.configuredReferences || []
              : undefined,
      );
      if (targetReferences.some(reference => reference.url === dragged.image.url)) {
          setSelectedShotId(targetShot.id);
          return;
      }
      if (targetReferences.length >= 6) {
          alert('目标镜头最多只能提交 6 张参考图片，请先删除不需要的参考图。');
          return;
      }

      setCopyingImageToShotId(targetShot.id);
      try {
          const blob = await downloadImageBlob(dragged.image.url, '复制分镜参考图片');
          const mimeType = blob.type || 'image/png';
          const extension = mimeType.split('/')[1]?.split('+')[0] || 'png';
          const file = new File(
              [blob],
              `shot-${targetShot.shotNumber || targetShot.id}-${Date.now()}.${extension}`,
              { type: mimeType },
          );
          const { uploadEntityFile } = await import('../services/entityFileService');
          const saved = await uploadEntityFile(
              file,
              'storyboard_item',
              targetShot.id,
              'reference_image',
              episodeId,
          );
          const sourceShot = storyboardItems.find(item => item.id === dragged.sourceShotId);
          const copiedReference: GenerationReference = {
              id: saved.fileId || uuidv4(),
              url: saved.fileUrl,
              type: 'pose',
              name: `来自镜头 ${sourceShot?.shotNumber || dragged.sourceShotId}`,
              fileId: saved.fileId || undefined,
              description: '从其他镜头的画面分镜结果拖入',
              source: 'manual',
          };

          onUpdateStoryboardItem(targetShot.id, (currentItem) => {
              const currentReferences = resolveShotReferences(
                  currentItem,
                  materialLibrary,
                  currentItem.referenceConfigInitialized || (currentItem.configuredReferences?.length || 0) > 0
                      ? currentItem.configuredReferences || []
                      : undefined,
              );
              if (currentReferences.some(reference => reference.url === copiedReference.url)) {
                  return {};
              }
              return {
                  configuredReferences: [...currentReferences, copiedReference].slice(0, 6),
                  referenceConfigInitialized: true,
              };
          });
          setSelectedShotId(targetShot.id);
          queryClient.invalidateQueries({
              queryKey: ['entityFiles', 'storyboard_item', targetShot.id, 'reference_image'],
          });
          window.dispatchEvent(new CustomEvent('generation-save-trigger'));
      } catch (error) {
          console.error('复制分镜参考图片失败:', error);
          alert(`复制到目标镜头参考图片失败：${(error as Error)?.message || '请稍后重试'}`);
      } finally {
          setCopyingImageToShotId(null);
      }
  };

  // 🆕 生成结果图片开始拖拽
  const handleResultImageDragStart = (
      e: React.DragEvent,
      image: GeneratedImage,
  ) => {
      if (!selectedShot) return;
      e.dataTransfer.setData(
          STORYBOARD_IMAGE_DRAG_MIME,
          serializeStoryboardImageDrag(selectedShot.id, image),
      );
      e.dataTransfer.setData('text/plain', image.url);
      e.dataTransfer.effectAllowed = 'copy';
  };

  // --- Generation Logic ---

  const executeGenerationForShot = async (
      shot: StoryboardItem,
      useCurrentState = false,
      model?: GenerationModel,
      currentRefs?: GenerationReference[],
  ) => {
      const plan = resolveShotReferencePlan(
          shot,
          materialLibrary,
          currentRefs ?? (
              shot.referenceConfigInitialized || (shot.configuredReferences?.length || 0) > 0
                  ? shot.configuredReferences || []
                  : undefined
          ),
      );
      const submittedReferences = [...plan.references];
      if (submittedReferences.length === 0) {
          const generated = shot.selectedImageId
              ? shot.generatedImages?.find(image => image.id === shot.selectedImageId)
              : shot.generatedImages?.[0];
          const generatedUrl = generated?.url || shot.generatedImage;
          if (generatedUrl) {
              submittedReferences.push({
                  id: `current-result:${shot.id}`,
                  url: generatedUrl,
                  type: 'effect',
                  name: '当前分镜结果',
                  source: 'manual',
              });
          }
      }
      const modelToUse = model || (useCurrentState ? globalModel : (shotModels[shot.id] || globalModel));
      beginShotProgress(shot.id, modelToUse);
      if (COMFYUI_MODELS.has(modelToUse) && submittedReferences.length === 0) {
          throw new Error('练气/筑基等本地 GPU 模型需要一张参考图；请添加参考图，或先选择当前分镜已有的生成结果。');
      }

      const basePrompt = (useCurrentState ? prompt : shot.imagePrompt) || shot.scriptSegment || '';
      const refImages = submittedReferences.map(reference => reference.url);

      const runOnce = async (): Promise<GeneratedImage[]> => {
          const attempt = 1;
          updateShotProgressStage(
              shot.id,
              '正在分析提示词与参考图',
              6,
          );
          const promptToUse = buildIdentityAnchoredPrompt(shot, basePrompt, materialLibrary, submittedReferences);
          const sourceDimensions = imageRatio === 'auto' || imageK === 'auto'
              ? await loadImageDimensions(refImages)
              : [];
          const resolvedImageSettings = resolveGptImageSettings(
              imageRatio,
              imageK,
              sourceDimensions,
          );
          const [outputWidth, outputHeight] = recommendGptImageSize(
              resolvedImageSettings.ratio,
              resolvedImageSettings.k,
          ).split('x').map(Number);
          let generated: GeneratedImage[] = [];

          console.log(`🎨 开始生成 - 模型: ${modelToUse}, 尝试: ${attempt}, 参考图片: ${refImages.length}`);
          if (modelToUse === 'nanobanana') {
              updateShotProgressStage(shot.id, 'AI 正在生成画面', 10);
              const result = await generateFinalIllustrationResult(
                  promptToUse,
                  refImages,
                  { entityType: 'storyboard_item', entityId: shot.id, fileRole: 'generated_image', episodeId },
                  {
                      aspectRatio: resolvedImageSettings.ratio,
                      imageSize: resolvedImageSettings.k,
                  },
                  submittedReferences.map(reference => ({
                      referenceId: reference.id,
                      assetId: reference.assetId,
                      fileId: reference.fileId,
                      type: reference.type,
                      name: reference.name,
                      description: reference.description,
                      source: reference.source,
                  })),
              );
              generated = [{
                  id: result.fileId || uuidv4(),
                  url: result.fileUrl || result.url,
                  thumbnail: result.fileUrl || result.url,
                  timestamp: Date.now(),
                  fileId: result.fileId,
                  generationModel: modelToUse,
                  generationAttempt: attempt,
              }];
          } else if (modelToUse === 'gpt_image_vip' || modelToUse === 'gpt_image_official') {
              updateShotProgressStage(shot.id, 'AI 正在生成画面', 10);
              const tier = modelToUse === 'gpt_image_vip' ? 'vip' : 'official';
              const response = await generateGptImage({
                  tier,
                  prompt: promptToUse,
                  references: refImages,
                  referenceMetadata: submittedReferences.map(reference => ({
                      referenceId: reference.id,
                      assetId: reference.assetId,
                      fileId: reference.fileId,
                      type: reference.type,
                      name: reference.name,
                      description: reference.description,
                      source: reference.source,
                  })),
                  ratio: resolvedImageSettings.ratio,
                  k: resolvedImageSettings.k,
                  quality: tier === 'official' ? imageQuality : 'auto',
                  entityType: 'storyboard_item',
                  entityId: shot.id,
                  fileRole: 'generated_image',
                  episodeId,
              });
              generated = response.files.map((file, index) => {
                  const url = file.file_url || file.url || file.data_url || response.images[index] || '';
                  return {
                      id: file.file_id || uuidv4(),
                      url,
                      thumbnail: url,
                      timestamp: Date.now(),
                      fileId: file.file_id || undefined,
                      generationModel: modelToUse,
                      generationAttempt: attempt,
                  };
              }).filter(image => image.url);
          } else {
              updateShotProgressStage(shot.id, '等待 GPU 接收任务', 8);
              let workflowType: 'qwen' | 'qwen_lora' | 'kontext' | 'qwenN' | 'qwenN_lora';
              if (modelToUse === 'qwen') workflowType = 'qwen';
              else if (modelToUse === 'qwen_lora') workflowType = 'qwen_lora';
              else if (modelToUse === 'kontext') workflowType = 'qwenN';
              else if (modelToUse === 'qwenN') workflowType = 'kontext';
              else if (modelToUse === 'qwenN_lora') workflowType = 'qwenN_lora';
              else workflowType = 'kontext';

              const mainImage = refImages[0] || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
              const preferredAgentId = selectedClusterNode?.agentId || (selectedClusterNode?.kind === 'agent' ? selectedClusterNode.id : undefined);
              const preferredNodeId = selectedClusterNode?.nodeId || selectedClusterNode?.id;
              let currentTaskId = '';
              const resultUrls = await generateWithComfyUIWorkflowQueued(
                  workflowType,
                  promptToUse,
                  mainImage,
                  refImages.slice(1),
                  -1,
                  taskId => {
                      currentTaskId = taskId;
                      saveRunningTask({ taskId, shotId: shot.id, fileId: selectedFileId || '', model: modelToUse, startedAt: Date.now() });
                      updateShotProgressStage(shot.id, 'GPU 已接收任务，正在生成', 10);
                  },
                  {
                      entityType: 'storyboard_item', entityId: shot.id, fileRole: 'generated_image', episodeId,
                      preferredAgentId, preferredNodeId, outputWidth, outputHeight,
                  },
                  buildRegistryMeta(
                      shot,
                      workflowType === 'qwen_lora' ? 'qwen-lora'
                          : workflowType === 'kontext' ? 'kontext'
                              : workflowType === 'qwenN_lora' ? 'qwen-lora' : 'qwen-image',
                      `画面分镜 ${workflowType}`,
                  ),
                  progress => updateShotProviderProgress(shot.id, progress),
              );
              if (currentTaskId) removeRunningTask(currentTaskId);
              generated = (resultUrls as GeneratedImageResult[]).filter(result => result.url).map(result => ({
                  id: result.fileId || uuidv4(),
                  url: result.url,
                  thumbnail: result.url,
                  timestamp: Date.now(),
                  fileId: result.fileId || undefined,
                  generationModel: modelToUse,
                  generationAttempt: attempt,
              }));
          }

          if (!generated.length) throw new Error('未获取到生成结果');
          updateShotProgressStage(
              shot.id,
              '画面已生成，正在整理结果',
              90,
          );
          return generated;
      };

      try {
          const generated = await runOnce();
           const selected = generated[generated.length - 1];
           updateShotProgressStage(shot.id, '正在保存生成结果', 97);
           onUpdateStoryboardItem(shot.id, currentItem => {
              const existingImages = currentItem.generatedImages || [];
              const mergedImages = dedupeGeneratedImages([...existingImages, ...generated]);
              return {
                  generatedImages: mergedImages,
                  selectedImageId: selected.id,
                  generatedImage: selected.url,
              };
          });
          queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', shot.id, 'generated_image'] });
           notifyStoryboardImageChanged(episodeId, shot.id);
           window.dispatchEvent(new CustomEvent('generation-save-trigger'));
           updateShotProgressStage(shot.id, '生成完成', 100);
      } catch (error) {
          console.error(`Generation failed for shot ${shot.id}`, error);
          throw error;
      }
  };

  const generateForShot = (
      shot: StoryboardItem,
      useCurrentState = false,
      model?: GenerationModel,
      currentRefs?: GenerationReference[],
  ): Promise<void> => runSingleFlight(
      generationRequestsRef.current,
      shot.id,
      () => executeGenerationForShot(shot, useCurrentState, model, currentRefs),
  );

  const handleGenerateCurrent = async () => {
      if (!selectedShot) return;

      const shotId = selectedShot.id;
      setGeneratingShotIds(prev => new Set(prev).add(shotId));
      try {
          console.log('🔄 重新生成 - 当前参考图片:', references.map(r => ({ id: r.id, url: r.url.substring(0, 50) + '...' })));
          await generateForShot(selectedShot, true, globalModel, references);
      } catch (e: any) {
          // 不再吞错：暴露真实原因（缺 key / 内容审查 / 参考图取不到 等），便于定位。
          alert(`生成失败：${e?.message || e || '请检查网络或图片大小'}`);
       } finally {
           setGeneratingShotIds(prev => { const next = new Set(prev); next.delete(shotId); return next; });
           clearShotProgress(shotId);
       }
  };

  const handleBatchGenerate = async () => {
      if (!selectedFile?.storyboard || !selectedShot || selectedShotIds.size === 0) return;
      
      setBatchProgress({ current: 0, total: selectedShotIds.size });

      const ids = Array.from(selectedShotIds);
      setGeneratingShotIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.add(id));
          return next;
      });
      let successCount = 0;
      const failures: { label: string; message: string }[] = [];

      for (let i = 0; i < ids.length; i++) {
           const id = ids[i];
           const shot = selectedFile.storyboard?.items.find(item => item.id === id);
           if (shot) {
               setBatchProgress({ current: i, total: ids.length, activeShotId: id });
               const shotLabel = String(shot.shotNumber || `#${String(shot.id).slice(0, 6)}`);
              try {
                  const isCurrent = id === selectedShot.id;
                  const model = shotModels[shot.id] || globalModel;
                  await generateForShot(shot, isCurrent, model);
                  successCount++;
              } catch (e) {
                  // 不能静默吞掉：记录是哪个镜头、为什么失败，结束后明确告知用户需要重试哪些。
                  const message = e instanceof Error ? e.message : String(e);
                  console.error(`镜头 ${shotLabel} 批量生成失败:`, e);
                  failures.push({ label: shotLabel, message });
              }
           }
           setBatchProgress({ current: i + 1, total: ids.length });
           setGeneratingShotIds(prev => { const next = new Set(prev); next.delete(id); return next; });
           clearShotProgress(id);
       }

      setBatchProgress(null);
      if (failures.length === 0) {
          alert(`批量生成完成: ${successCount}/${ids.length} 全部成功`);
      } else {
          const detail = failures
              .map(f => `• 镜头 ${f.label}: ${f.message || '生成失败'}`)
              .join('\n');
          alert(
              `批量生成完成: ${successCount}/${ids.length} 成功，${failures.length} 个失败，请重新生成以下镜头:\n${detail}`,
          );
      }
  };

  const handleDeleteResult = async (imgId: string) => {
      if (!selectedShot || !selectedShotId) return;
      
      const existingImages = selectedShot.generatedImages || [];
      const imgToDelete = existingImages.find(img => img.id === imgId);
      const newImages = existingImages.filter(img => img.id !== imgId);
      
      let newSelectedId = selectedShot.selectedImageId;
      if (newSelectedId === imgId) {
          newSelectedId = newImages.length > 0 ? newImages[0].id : undefined;
      }

      console.log(`🗑️ 删除图片 ${imgId} 从镜头 ${selectedShot.id} (${existingImages.length} → ${newImages.length})`);
      
      removeImageFromCache(selectedShot.id, imgId);

      // 从 DB 删除（如果有 fileId）
      if (imgToDelete?.fileId) {
          try {
              const { deleteEntityFile } = await import('../services/entityFileService');
              await deleteEntityFile(imgToDelete.fileId);
              console.log(`✅ DB 删除成功: ${imgToDelete.fileId}`);
          } catch (err) {
              console.error('DB 删除失败:', err);
          }
      }

      onUpdateStoryboardItem(selectedShot.id, {
          generatedImages: newImages,
          selectedImageId: newSelectedId,
          generatedImage: newImages.length > 0 ? newImages[0].url : undefined
      });
      
      onForceSave();
  };

  const handleSelectResult = (imgId: string) => {
      if (!selectedShot) return;
      const img = (selectedShot.generatedImages || []).find(i => i.id === imgId);
      onUpdateStoryboardItem(selectedShot.id, {
          selectedImageId: imgId,
          generatedImage: img?.url || img?.thumbnail
      });
  };

  const handleViewFullImage = async (shotId: string, imageId: string) => {
      if (!selectedFileId) return;
      
      const currentImg = currentGeneratedImages.find(img => img.id === imageId);
      
      if (!currentImg) {
          console.error(`❌ 未找到图片: shotId=${shotId}, imageId=${imageId}`);
          return;
      }
      
      // 🆕 记录当前预览的镜头和图片ID，用于左右切换导航
      setPreviewShotId(shotId);
      setPreviewImageId(imageId);
      
      // 🔧 优先使用完整URL，其次使用缩略图
      const imageUrl = currentImg.url || currentImg.thumbnail;
      
      if (!imageUrl) {
          console.error('❌ 图片URL为空');
          return;
      }
      
      console.log(`🖼️ 查看大图: ${imageId}, URL类型: ${imageUrl.startsWith('data:') ? 'dataURL' : imageUrl.startsWith('blob:') ? 'blobURL' : 'serverURL'}`);
      
      // 如果已经是 dataURL 或 blobURL，直接显示
      if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
          setIsLoadingFullImage(false);
          setPreviewImage(imageUrl);
          return;
      }
      
      // 需要从服务器加载的情况
      setIsLoadingFullImage(true);
      setPreviewImage(currentImg.thumbnail || imageUrl); // 先显示缩略图
      
      try {
          // 检查缓存
          const cacheKey = `${shotId}:${imageId}`;
          const cachedUrl = getCachedBlobUrl(cacheKey);
          if (cachedUrl) {
              console.log('📦 从缓存加载完整图片');
              setPreviewImage(cachedUrl);
              setIsLoadingFullImage(false);
              return;
          }
          
          // 从服务器加载并转换为 Blob URL
          const blob = await downloadImageBlob(imageUrl, '加载完整图片');
          const blobUrl = URL.createObjectURL(blob);
          
          // 缓存 Blob URL
          setCachedBlobUrl(cacheKey, blobUrl);
          setPreviewImage(blobUrl);
          console.log('✅ 完整图片已加载');
          
      } catch (error) {
          console.error('❌ 加载完整图片失败:', error);
          // 加载失败时保持显示缩略图
      } finally {
          setIsLoadingFullImage(false);
      }
  };

  const getPreviewImageList = () => {
      if (!previewShotId) return [];
      return currentGeneratedImages;
  };

  // 🆕 切换到上一张图片
  const handlePrevImage = () => {
      if (!previewShotId || !previewImageId || isLoadingFullImage) return;
      const imageList = getPreviewImageList();
      const currentIndex = imageList.findIndex(img => img.id === previewImageId);
      if (currentIndex > 0) {
          const prevImage = imageList[currentIndex - 1];
          handleViewFullImage(previewShotId, prevImage.id);
      }
  };

  // 🆕 切换到下一张图片
  const handleNextImage = () => {
      if (!previewShotId || !previewImageId || isLoadingFullImage) return;
      const imageList = getPreviewImageList();
      const currentIndex = imageList.findIndex(img => img.id === previewImageId);
      if (currentIndex < imageList.length - 1) {
          const nextImage = imageList[currentIndex + 1];
          handleViewFullImage(previewShotId, nextImage.id);
      }
  };

  // 🆕 关闭图片预览
  const closePreview = () => {
      setPreviewImage(null);
      setPreviewShotId(null);
      setPreviewImageId(null);
  };

  // --- Camera Angle Adjustment ---
  const randomSeed = () => Math.floor(Math.random() * 900000000000000) + 100000000000000;
  
  const ensureDataUrl = async (url: string): Promise<string> => {
    if (url.startsWith('data:')) return url;
    const blob = await downloadImageBlob(url, '下载图片');
    return blobToDataUrl(blob);
  };

  // 🆕 将图片转换为 PNG 格式的 DataURL（用于 ComfyUI 兼容性）
  const ensureDataUrlAsPng = async (url: string): Promise<string> => {
    return new Promise<string>(async (resolve, reject) => {
        try {
            // 使用 Image 加载并通过 Canvas 转换为 PNG
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('无法创建 Canvas 上下文'));
                        return;
                    }
                    ctx.drawImage(img, 0, 0);
                    const pngDataUrl = canvas.toDataURL('image/png');
                    console.log(`✅ 图片已转换为 PNG 格式 (${img.naturalWidth}x${img.naturalHeight})`);
                    resolve(pngDataUrl);
                } catch (err) {
                    reject(err);
                }
            };
            
            img.onerror = () => {
                reject(new Error('图片加载失败，无法转换为 PNG'));
            };
            
            // 如果是 DataURL，直接使用；否则添加认证头
            if (url.startsWith('data:') || url.startsWith('blob:')) {
                img.src = url;
            } else {
                // 对于服务器 URL，需要先 fetch 再转换为 blob URL
                const blob = await downloadImageBlob(url, '下载图片');
                img.src = URL.createObjectURL(blob);
            }
        } catch (err) {
            reject(err);
        }
    });
  };

  const handleAngleAdjustment = async (imageUrl: string, params: {
    rotate: number;
    move: number;
    vertical: number;
    wideAngle: boolean;
    customPrompt?: string;
    seed: number;
  }) => {
    if (!selectedShot) return;
    // 🔧 不立即关闭模态框，而是显示loading状态
    setIsAngleAdjusting(true);
    try {
        let prompt = '';
        
        // 如果用户自己写了提示词,直接使用
        if (params.customPrompt?.trim()) {
            prompt = params.customPrompt.trim();
        } else {
            // 否则根据滑块参数拼接提示词
            const prompts: string[] = [];
            
            // 水平旋转
            if (params.rotate === -90) {
                prompts.push("将镜头向左旋转90度 Rotate the camera 90 degrees to the left.");
            } else if (params.rotate === -45) {
                prompts.push("将镜头向左旋转45度 Rotate the camera 45 degrees to the left.");
            } else if (params.rotate === 45) {
                prompts.push("将镜头向右旋转45度 Rotate the camera 45 degrees to the right.");
            } else if (params.rotate === 90) {
                prompts.push("将镜头向右旋转90度 Rotate the camera 90 degrees to the right.");
            }
            
            // 推进距离
            if (params.move === 5) {
                prompts.push("将镜头向前移动 Move the camera forward.");
            } else if (params.move === 10) {
                prompts.push("将镜头转为特写镜头 Turn the camera into a close-up shot.");
            }
            
            // 垂直角度
            if (params.vertical === 1) {
                prompts.push("将相机切换到仰视视角 Turn the camera to a worm's-eye view.");
            } else if (params.vertical === -1) {
                prompts.push("将相机转向鸟瞰视角 Turn the camera to a bird's-eye view.");
            }
            
            // 广角镜头
            if (params.wideAngle) {
                prompts.push("将镜头转为广角镜头 Turn the camera to a wide-angle lens.");
            }
            
            prompt = prompts.join(' ');
        }
        
        // 如果既没有自定义提示词,也没有任何滑块设置,使用默认提示
        if (!prompt) {
            prompt = "保持当前画面构图和内容。";
        }
        
        const baseImage = await ensureDataUrl(imageUrl);
        const sourceDimensions = await probeImageDimensions(imageUrl);
        const outputDimensions = fitAngleOutputDimensions(sourceDimensions);
        const routing = await resolveGpuTaskRouting(selectedClusterNodeId);
        const actualNodeId = routing.node?.name || routing.preferredAgentId || routing.preferredNodeId;
        if (actualNodeId && actualNodeId !== selectedClusterNodeId) {
          setSelectedClusterNodeId(actualNodeId);
          setPreferredGpuNodeId(actualNodeId);
        }
        // 🔧 使用队列执行，确保同时只有一个任务
        const resultUrl = await adjustImageAngleQueued(baseImage, prompt, params.seed, {
          entityType: 'storyboard_item',
          entityId: selectedShot?.id,
          fileRole: 'generated_image',
          episodeId,
          preferredAgentId: routing.preferredAgentId,
          preferredNodeId: routing.preferredNodeId,
          outputWidth: outputDimensions.width,
          outputHeight: outputDimensions.height,
        }, buildRegistryMeta(selectedShot, 'angle-adjust', '角度调整'));
        
        const newImage: GeneratedImage = {
            id: uuidv4(),
            url: resultUrl,
            thumbnail: resultUrl,
            timestamp: Date.now()
        };
        
        // 🔧 使用函数式更新，确保并发任务不会互相覆盖
        onUpdateStoryboardItem(selectedShot.id, (currentItem) => {
            const existingImages = currentItem.generatedImages || [];
            const updatedImages = [...existingImages, newImage];
            return {
                generatedImages: updatedImages,
                selectedImageId: newImage.id,
                generatedImage: resultUrl,
            };
        });
        
        // 🆕 生成完成后立即保存
        console.log('💾 角度调整完成，触发立即保存');
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        
        // 🔧 处理完成后关闭模态框
        setCameraModalImage(null);
    } catch (error: any) {
        console.error('Angle adjustment failed', error);
        alert(error?.message || '角度调整失败，请稍后再试。');
    } finally {
        setIsAngleAdjusting(false);
    }
  };

  // 🆕 多角度人物生成处理函数
  const handleHumanMultiAngle = async (imageUrl: string, seed: number) => {
    if (!selectedShot) return;
    
    setIsHumanMultiAngleGenerating(true);
    try {
        // 将图片转换为 dataUrl（如果需要）
        const baseImage = await ensureDataUrl(imageUrl);
        
        // 🔧 使用队列执行多角度生成API，确保同时只有一个任务
        console.log(`🔄 开始多角度生成任务（队列执行）`);
        const resultUrls = await generateHumanMultiAngleQueued(baseImage, seed, {
          entityType: 'storyboard_item',
          entityId: selectedShot?.id,
          fileRole: 'generated_image',
          episodeId,
        }, buildRegistryMeta(selectedShot, 'human-multi-angle', '多角度人物'));
        console.log(`✅ 多角度生成完成，共 ${resultUrls.length} 张图片:`, resultUrls);
        
        const newImages: GeneratedImage[] = (resultUrls as GeneratedImageResult[])
            .filter((r) => r.url)
            .map((r) => ({
                id: r.fileId || uuidv4(),
                url: r.url,
                thumbnail: r.url,
                timestamp: Date.now(),
                fileId: r.fileId || undefined,
            }));
        
        if (newImages.length === 0) {
            throw new Error('没有成功生成任何图片');
        }
        
        onUpdateStoryboardItem(selectedShot.id, {
            generatedImages: newImages,
            selectedImageId: newImages[0]?.id,
            generatedImage: newImages[0]?.url,
        });
        
        console.log('💾 多角度生成完成，触发立即保存');
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        
        setHumanMultiAngleModalImage(null);
    } catch (error: any) {
        console.error('Human multi-angle generation failed', error);
        alert(error?.message || '多角度人物生成失败，请稍后再试。');
    } finally {
        setIsHumanMultiAngleGenerating(false);
    }
  };

  // 🆕 全景角度生成处理函数
  const handleAroundAngle = async (imageUrl: string, prompt: string, seed: number) => {
    if (!selectedShot) return;
    
    setIsAroundAngleGenerating(true);
    try {
        const baseImage = await ensureDataUrl(imageUrl);
        
        // 🔧 使用队列执行全景角度生成，确保同时只有一个任务
        console.log(`🔄 开始全景角度生成任务（队列执行）`);
        const resultUrls = await generateAroundAngleQueued(baseImage, prompt, seed, {
          entityType: 'storyboard_item',
          entityId: selectedShot?.id,
          fileRole: 'generated_image',
          episodeId,
        }, buildRegistryMeta(selectedShot, 'around-angle', '全景角度'));
        console.log(`✅ 全景角度生成完成，共 ${resultUrls.length} 张图片`);
        
        const newImages: GeneratedImage[] = (resultUrls as GeneratedImageResult[])
            .filter((r) => r.url)
            .map((r) => ({
                id: r.fileId || uuidv4(),
                url: r.url,
                thumbnail: r.url,
                timestamp: Date.now(),
                fileId: r.fileId || undefined,
            }));
        
        if (newImages.length === 0) {
            throw new Error('没有成功生成任何图片');
        }
        
        onUpdateStoryboardItem(selectedShot.id, {
            generatedImages: newImages,
            selectedImageId: newImages[0]?.id,
            generatedImage: newImages[0]?.url,
        });
        
        console.log('💾 全景角度生成完成，触发立即保存');
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        
        setAroundAngleModalImage(null);
    } catch (error: any) {
        console.error('Around angle generation failed', error);
        alert(error?.message || '全景角度生成失败，请稍后再试。');
    } finally {
        setIsAroundAngleGenerating(false);
    }
  };

  // 🆕 抠图处理函数（支持返回多张图片）
  const handleMatting = async (mattingType: 'subject' | 'split', seed: number) => {
    if (!selectedShot || !mattingModalImage) return;
    
    setIsMattingProcessing(true);
    try {
        // 🔧 使用 PNG 格式转换，避免 WebP 在 ComfyUI 中报错
        console.log(`🔄 将图片转换为 PNG 格式...`);
        const baseImage = await ensureDataUrlAsPng(mattingModalImage);
        
        console.log(`🔄 开始抠图任务（类型: ${mattingType}）`);
        const resultUrls = await generateMattingQueued(baseImage, mattingType, seed, {
          entityType: 'storyboard_item',
          entityId: selectedShot?.id,
          fileRole: 'generated_image',
          episodeId,
        }, buildRegistryMeta(selectedShot, 'matting', mattingType === 'subject' ? '抠图（主体）' : '抠图（分离）'));
        console.log(`✅ 抠图完成，返回 ${resultUrls.length} 张图片`);
        
        if (!resultUrls || resultUrls.length === 0) {
            throw new Error('抠图失败，没有返回结果');
        }
        
        const newImages: GeneratedImage[] = (resultUrls as GeneratedImageResult[])
            .filter((r) => r.url)
            .map((r) => ({
                id: r.fileId || uuidv4(),
                url: r.url,
                thumbnail: r.url,
                timestamp: Date.now(),
                fileId: r.fileId || undefined,
            }));
        
        console.log(`📸 创建了 ${newImages.length} 张新图片`);
        
        onUpdateStoryboardItem(selectedShot.id, {
            generatedImages: newImages,
            selectedImageId: newImages[0]?.id,
            generatedImage: newImages[0]?.url,
        });
        
        console.log('💾 抠图完成，触发保存');
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        
        setMattingModalImage(null);
    } catch (error: any) {
        console.error('Matting failed', error);
        alert(error?.message || '抠图失败，请稍后再试。');
    } finally {
        setIsMattingProcessing(false);
    }
  };

  // 🆕 融合处理函数
  const handleImageFusion = async (
    fusionType: 'fusion' | 'transfer' | 'imitation' | 'direct',
    params: { imageBk: string; imageHu: string; imageMb?: string; compositeImage?: string; seed?: number }
  ) => {
    if (!selectedShot) return;
    
    setIsFusionProcessing(true);
    try {
        // 直接拼合模式 - 前端已合成，直接使用
        if (fusionType === 'direct') {
            console.log('🔄 直接拼合（前端已合成）');
            
            if (!params.compositeImage) {
                throw new Error('合成图片缺失');
            }
            
            const newImage: GeneratedImage = {
                id: uuidv4(),
                url: params.compositeImage,
                timestamp: Date.now()
            };
            
            onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
                generatedImages: [...(currentItem.generatedImages || []), newImage],
                selectedImageId: newImage.id,
                generatedImage: newImage.url
            }));
            
            console.log('✅ 直接拼合完成');
        } else if (fusionType === 'fusion') {
            // 图像融合模式 - 使用合成图调用ComfyUI
            console.log('🔄 开始图像融合（传送合成图到ComfyUI）');
            
            if (!params.compositeImage) {
                throw new Error('合成图片缺失');
            }
            
            // 图像融合只需要传送合成后的单张图
            const compositeDataUrl = await ensureDataUrl(params.compositeImage);
            
            const resultUrl = await generateImageFusionQueued(
                compositeDataUrl,
                compositeDataUrl, // 合成模式下，底图和人物图用同一张合成图
                'fusion',
                undefined,
                params.seed ?? -1,
                {
                  entityType: 'storyboard_item',
                  entityId: selectedShot?.id,
                  fileRole: 'generated_image',
                  episodeId,
                },
                buildRegistryMeta(selectedShot, 'image-fusion', '图像融合'),
            );
            
            if (!resultUrl) {
                throw new Error('融合失败，没有返回结果');
            }
            
            const newImage: GeneratedImage = {
                id: uuidv4(),
                url: resultUrl,
                thumbnail: resultUrl,
                timestamp: Date.now()
            };
            
            onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
                generatedImages: [...(currentItem.generatedImages || []), newImage],
                selectedImageId: newImage.id,
                generatedImage: newImage.url
            }));
            
            console.log('✅ 图像融合完成');
        } else {
            // 迁移学习/模仿学习 - 调用后端API（传送多张图）
            console.log(`🔄 开始${fusionType}（多图模式）`);
            
            const bkDataUrl = await ensureDataUrl(params.imageBk);
            const huDataUrl = await ensureDataUrl(params.imageHu);
            let mbDataUrl: string | undefined;
            if (params.imageMb) {
                mbDataUrl = await ensureDataUrl(params.imageMb);
            }
            
            const resultUrl = await generateImageFusionQueued(
                bkDataUrl,
                huDataUrl,
                fusionType as 'transfer' | 'imitation',
                mbDataUrl,
                params.seed ?? -1,
                {
                  entityType: 'storyboard_item',
                  entityId: selectedShot?.id,
                  fileRole: 'generated_image',
                  episodeId,
                },
                buildRegistryMeta(selectedShot, 'image-fusion', fusionType === 'transfer' ? '迁移学习' : '模仿学习'),
            );
            
            if (!resultUrl) {
                throw new Error('融合失败，没有返回结果');
            }
            
            const newImage: GeneratedImage = {
                id: uuidv4(),
                url: resultUrl,
                thumbnail: resultUrl,
                timestamp: Date.now()
            };
            
            onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
                generatedImages: [...(currentItem.generatedImages || []), newImage],
                selectedImageId: newImage.id,
                generatedImage: newImage.url
            }));
            
            console.log(`✅ ${fusionType}完成`);
        }
        
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        setShowFusionModal(false);
    } catch (error: any) {
        console.error('Image fusion failed', error);
        alert(error?.message || '融合失败，请稍后再试。');
    } finally {
        setIsFusionProcessing(false);
    }
  };

  // 🆕 分镜工具处理函数
  const handlePanorama360 = async (imageUrl: string, prompt: string, seed: number): Promise<string> => {
    const baseImage = await ensureDataUrl(imageUrl);
    const result = await generatePanorama360Queued(baseImage, prompt, seed, undefined, buildRegistryMeta(selectedShot, 'panorama-360', '360 全景'));
    return result;
  };

  const handlePanoramaFusion = async (
    image1: string, 
    image3: string, 
    prompt: string, 
    image2?: string, 
    seed?: number
  ): Promise<string> => {
    const img1 = await ensureDataUrl(image1);
    const img3 = await ensureDataUrl(image3);
    const img2 = image2 ? await ensureDataUrl(image2) : undefined;
    const result = await generatePanoramaFusionQueued(img1, img3, prompt, img2, seed ?? -1, undefined, buildRegistryMeta(selectedShot, 'panorama-fusion', '全景融合'));
    return result;
  };

  const handleAutoStoryboard = async (imageUrl: string, prompt: string, seed: number): Promise<string> => {
    if (!selectedShot) throw new Error('请先选择镜头');
    
    const baseImage = await ensureDataUrl(imageUrl);
    const result = await generateAutoStoryboardQueued(baseImage, prompt, seed, {
      entityType: 'storyboard_item',
      entityId: selectedShot?.id,
      fileRole: 'generated_image',
      episodeId,
    }, buildRegistryMeta(selectedShot, 'auto-storyboard', '自动分镜'));
    
    const newImage: GeneratedImage = {
        id: uuidv4(),
        url: result,
        thumbnail: result,
        timestamp: Date.now()
    };
    
    onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
        generatedImages: [...(currentItem.generatedImages || []), newImage],
        selectedImageId: newImage.id,
        generatedImage: newImage.url
    }));
    
    onForceSave();
    queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
    notifyStoryboardImageChanged(episodeId, selectedShot?.id);
    return result;
  };

  const handleMultiGridStoryboardSubmit = async (
    mode: 'multi_shot' | 'story', 
    prompt: string,
    referenceImage: string
  ): Promise<{ images?: string[] }> => {
    const result = await generateMultiGridStoryboard(mode, prompt, referenceImage, {
      entityType: 'storyboard_item',
      entityId: selectedShot?.id,
      fileRole: 'generated_image',
      episodeId,
    });
    
    // 如果有结果图片，添加到当前镜头
    if (result.images && result.images.length > 0 && selectedShot) {
        const newImages: GeneratedImage[] = result.images
            .filter(url => url)
            .map(url => ({
                id: uuidv4(),
                url: url,
                thumbnail: url,
                timestamp: Date.now()
            }));
        
        if (newImages.length > 0) {
            onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
                generatedImages: [...(currentItem.generatedImages || []), ...newImages],
                selectedImageId: newImages[0].id,
                generatedImage: newImages[0].url
            }));
            onForceSave();
            queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
            notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        }
    }
    
    return result;
  };

  // 🆕 图片编辑器回调：保存编辑后的图片（更新底图）
  const handleImageEditorSave = (editedImageUrl: string, referenceId: string) => {
    console.log('💾 保存编辑后的图片:', { referenceId, urlLength: editedImageUrl.length });
    updateCurrentShotReferences(prev => prev.map(ref =>
      ref.id === referenceId ? { ...ref, url: editedImageUrl } : ref
    ));
    setImageEditorData(null);
  };

  // 🆕 图片编辑器回调：添加线稿作为新参考图
  const handleAddSketch = (sketchImageUrl: string) => {
    if (references.length >= 6) {
      alert('参考图片已满（最多6张），请先删除一些再添加线稿');
      return;
    }
    console.log('🎨 添加线稿作为新参考图');
    const newRef: GenerationReference = {
      id: uuidv4(),
      url: sketchImageUrl,
      type: 'pose',  // 线稿通常用于姿态参考
      name: '手绘线稿',
      source: 'manual',
    };
    updateCurrentShotReferences(prev => [...prev, newRef]);
    // 不关闭编辑器，用户可以继续编辑或选择保存
  };

  // --- Export Logic ---
  const handleExport = () => {
      if (!selectedFile?.storyboard) {
          console.error('❌ 没有分镜数据');
          return;
      }
      
      console.log('🔍 开始导出流程...');
      console.log('   - 当前选中镜头数:', selectedShotIds.size);
      console.log('   - 总镜头数:', selectedFile.storyboard.items.length);
      
      // 2026-05-20 (Bug #2)：取消「必须有图片才能导出」的硬性限制。
      // - 未勾选时：导出所有分镜（无图镜头作为占位项进入视频页）
      // - 已勾选时：仅导出勾选的镜头（不要求有图）
      // 视频页 handleImportAll 已支持空分镜（占位卡 + isPlaceholder 标记）。
      let itemsToCheck = selectedShotIds.size > 0 
          ? selectedFile.storyboard.items.filter(item => selectedShotIds.has(item.id))
          : [...selectedFile.storyboard.items];
      
      console.log('   - 待导出的镜头数:', itemsToCheck.length);
      
      const itemsToExport = itemsToCheck.map(item => {
          const selectedImg = item.selectedImageId 
              ? item.generatedImages?.find(img => img.id === item.selectedImageId)
              : item.generatedImages?.[0];
          
          console.log(`   📸 镜头 ${item.id}:`, {
              hasImages: !!item.generatedImages,
              imageCount: item.generatedImages?.length || 0,
              selectedImageId: item.selectedImageId,
              hasSelectedImg: !!selectedImg,
              isPlaceholder: !selectedImg,
          });
          
          return {
              shotId: item.id,
              script: item.scriptSegment,
              imagePrompt: item.imagePrompt,
              videoPrompt: item.videoPrompt,
              finalImage: selectedImg?.url || selectedImg?.thumbnail || null,
          };
      });

      console.log('   - 最终导出镜头数:', itemsToExport.length, '（含无图占位项）');

      if (!itemsToExport || itemsToExport.length === 0) {
          alert("还没有分镜数据可导出。\n\n请先生成分镜镜头（剧本 → 分镜），然后再导出到视频生成阶段。");
          return;
      }

      console.log(`📤 准备导出 ${itemsToExport.length} 个镜头到视频生成阶段`);
      console.log('📋 导出的镜头:', itemsToExport.map(i => ({ shotId: i.shotId, hasImage: !!i.finalImage })));
      
      onExportNext({ items: itemsToExport });
  };

  // --- Version Control ---
  const handleSaveClick = () => {
    setIsNamingVersion(true);
    const count = selectedFile?.versions?.length || 0;
    setVersionName(`画面分镜存档 v${count + 1} - ${new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})}`);
  };

  const submitVersionSave = () => {
    if(versionName.trim()) {
        onSaveVersion(versionName);
        setIsNamingVersion(false);
    }
  };

  const categories: { type: ReferenceType; label: string; icon: any }[] = [
      { type: 'character', label: '角色', icon: Users },
      { type: 'scene', label: '场景', icon: MapPin },
      { type: 'pose', label: '姿态', icon: User },
      { type: 'prop', label: '道具', icon: Box },
      { type: 'effect', label: '特效', icon: Zap },
  ];

  // 单一数据源：直接从 parent state 读取图片
  const currentGeneratedImages = [
      ...(selectedShot?.generatedImages || []),
      ...(selectedShot?.generatedImage && !(selectedShot?.generatedImages?.length)
          ? [{ id: 'legacy', url: selectedShot.generatedImage, thumbnail: selectedShot.generatedImage, timestamp: 0 }]
          : [])
  ].filter(img => img.url || img.thumbnail);
  const effectiveSelectedId = selectedShot?.selectedImageId;

  if (selectedShotId) {
    console.log(`🖼️ [GenerationPage render] shotId=${selectedShotId}, generatedImages=${selectedShot?.generatedImages?.length || 0}, currentGeneratedImages=${currentGeneratedImages.length}`);
  }

  return (
      <div className="workflow-stage-layout layout-safe flex-1 flex h-full w-full bg-n20 overflow-hidden relative">
          
          {/* Header Bar */}
          <div className="workflow-stage-toolbar storyboard-generation-toolbar absolute top-0 left-0 right-0 h-[52px] bg-n0 border-b border-n40 z-20 flex items-center justify-between px-4">
              <div className="flex items-center gap-4 min-w-0">
                  <h2 className="text-sm font-bold text-n700 uppercase tracking-wider flex items-center gap-2">
                      <LayoutDashboard className="w-4 h-4 text-primary" />
                      画面分镜列表
                  </h2>
                  <div className="h-4 w-px bg-n40"></div>
                  <div className="flex items-center gap-2">
                      <button 
                        onClick={toggleSelectAll}
                        disabled={isLoadingAllShotsForSelection}
                        className="text-xs text-n300 hover:text-n800 flex items-center gap-1 disabled:opacity-50 disabled:cursor-wait"
                      >
                         {isLoadingAllShotsForSelection ? <CircleDashed className="w-4 h-4 animate-spin" /> : allStoryboardItemsSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                         {isLoadingAllShotsForSelection ? '加载全部...' : '全选'}
                      </button>
                      <span className="text-xs text-n100">
                          已选 {selectedShotIds.size} 项
                      </span>
                  </div>
              </div>

              <div className="flex items-center gap-3 min-w-0">
                  {onAssetScopeModeChange && (
                    <div className="flex items-center gap-1 p-0.5 rounded-md border border-n40 bg-n20" title="素材引用范围">
                      <button
                        type="button"
                        onClick={() => onAssetScopeModeChange('episode')}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                          assetScopeMode === 'episode'
                            ? 'bg-primary text-white'
                            : 'text-n300 hover:text-n800 hover:bg-n0'
                        }`}
                      >
                        <ImageIcon className="w-3 h-3" />
                        本集素材
                      </button>
                      <button
                        type="button"
                        onClick={() => onAssetScopeModeChange('project')}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                          assetScopeMode === 'project'
                            ? 'bg-primary text-white'
                            : 'text-n300 hover:text-n800 hover:bg-n0'
                        }`}
                      >
                        <Layers className="w-3 h-3" />
                        全部素材
                      </button>
                    </div>
                  )}
                  {onBatchDeleteStoryboardItems && selectedShotIds.size > 0 && !batchProgress && (
                      <button
                          onClick={async () => {
                              const ids = Array.from(selectedShotIds);
                              await onBatchDeleteStoryboardItems(ids);
                              setSelectedShotIds(new Set());
                          }}
                          disabled={isGenerating}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-n0 hover:bg-r50 text-danger border border-danger/30 rounded text-xs font-bold transition-colors disabled:opacity-50"
                          title="删除选中的镜头"
                      >
                          <Trash2 className="w-3.5 h-3.5" /> 删除选中 ({selectedShotIds.size})
                      </button>
                  )}
                  {batchProgress ? (
                      <div className="min-w-56 bg-primary-light px-3 py-1.5 rounded text-xs text-primary border border-primary/20">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                           <CircleDashed className="w-3.5 h-3.5 animate-spin" />
                           <span>批量生成中 {batchProgress.current}/{batchProgress.total}</span>
                          </div>
                          <span className="font-mono font-bold">{batchProgressDisplay?.aggregatePercent || 0}%</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-primary/15">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-500"
                            style={{ width: `${batchProgressDisplay?.aggregatePercent || 0}%` }}
                          />
                        </div>
                        <div className="mt-1 whitespace-nowrap text-[9px] text-primary/80">
                          {batchProgressDisplay?.active?.stage || '等待下一个镜头'}
                          {batchProgressDisplay ? ` · ${formatStoryboardGenerationEta(batchProgressDisplay.etaSeconds)}` : ''}
                        </div>
                      </div>
                  ) : (
                      <button 
                          onClick={handleBatchGenerate}
                          disabled={isGenerating || selectedShotIds.size === 0}
                          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                      >
                          <Play className="w-3.5 h-3.5" />
                          批量生成 ({selectedShotIds.size})
                      </button>
                  )}

                  <div className="h-6 w-px bg-n40 mx-1"></div>

                  {/* Fixed Top-Right Buttons */}
                  <button 
                        onClick={handleSaveClick}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-n700 hover:text-n800 bg-n0 hover:bg-n20 rounded border border-n40 transition-colors"
                    >
                        <Save className="w-3.5 h-3.5" />
                        <span>存档</span>
                    </button>

                    <button 
                        onClick={() => setShowHistory(!showHistory)}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                        showHistory 
                            ? 'bg-primary text-white border-primary' 
                            : 'bg-n0 text-n700 hover:text-n800 hover:bg-n20 border-n40'
                        }`}
                    >
                        <History className="w-3.5 h-3.5" />
                        <span>历史</span>
                    </button>

                    <button
                        onClick={() => {
                            const pid = (() => { try { return localStorage.getItem('current_project_id') || ''; } catch { return ''; } })();
                            if (pid && episodeId) navigate(`/projects/${pid}/ep/${episodeId}/workflow/final`);
                            else navigate('final');
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-n700 hover:text-n800 bg-n0 hover:bg-n20 rounded border border-n40 transition-colors"
                        title="去成品页合成完整成片"
                    >
                        <Clapperboard className="w-3.5 h-3.5" />
                        <span>导出到成品</span>
                    </button>

                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-semibold shadow-card ml-2"
                    >
                        一键导出选定
                        <ArrowRight className="w-3.5 h-3.5" />
                    </button>
              </div>
          </div>

          {/* Resizable Sidebar: Shot List */}
          <div 
             style={{ width: sidebarWidth }} 
             className="workflow-stage-sidebar pt-[52px] border-r border-n40 bg-n0 flex flex-col z-10 flex-shrink-0 relative"
          >
               <div className="workflow-stage-scroll flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                   {hasStoryboard && visibleStoryboardItems.map((item, index) => {
                       const isSelected = item.id === selectedShotId;
                       const hasImage = (item.generatedImages && item.generatedImages.length > 0) || !!item.generatedImage;
                       const isChecked = selectedShotIds.has(item.id);
                       const isShotGenerating = generatingShotIds.has(item.id);
                       const shotProgress = generationProgressByShot[item.id];
                       
                       // 🔧 使用 thumbnail 而不是 url（url是懒加载的）
                       const selectedImg = item.selectedImageId 
                            ? item.generatedImages?.find(img => img.id === item.selectedImageId)
                            : item.generatedImages?.[0];
                       
                       const rawThumb = selectedImg?.thumbnail || selectedImg?.url || item.generatedImage;
                       const thumb = rawThumb ? getImageThumbnailUrl(rawThumb, 144, 96) : undefined;

                       return (
                           <div 
                               key={item.id}
                               onClick={() => {
                                   setSelectedShotId(item.id);
                               }}
                               onDragOver={(e) => handleShotImageDragOver(e, item.id)}
                               onDragLeave={(e) => handleShotImageDragLeave(e, item.id)}
                               onDrop={(e) => void handleShotImageDrop(e, item)}
                               className={`p-2 rounded-lg cursor-pointer border transition-all flex gap-2 group ${
                                   imageDropTargetShotId === item.id
                                   ? 'bg-success/10 border-success ring-2 ring-success/30'
                                   : isSelected
                                     ? 'bg-primary-light border-primary'
                                     : 'bg-n0 border-n40 hover:bg-n20'
                               }`}
                           >
                               <div 
                                    onClick={(e) => toggleShotSelection(e, item.id)}
                                    className="flex items-center justify-center w-5 flex-shrink-0 text-n100 hover:text-n800"
                               >
                                   {isChecked ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                               </div>

                               <div className="w-12 h-10 bg-n30 rounded flex-shrink-0 overflow-hidden border border-n40 relative">
                                   {thumb ? (
                                       <img 
                                           src={thumb} 
                                           loading="lazy"
                                           decoding="async"
                                           alt=""
                                           className="w-full h-full object-cover" 
                                       />
                                   ) : (
                                       <div className="w-full h-full flex items-center justify-center">
                                           <ImageIcon className="w-3 h-3 text-n100" />
                                       </div>
                                   )}
                                   {isShotGenerating && (
                                       <div className="absolute inset-0 bg-n900/60 flex flex-col items-center justify-center text-white">
                                           <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                           <span className="mt-0.5 text-[8px] font-mono">{shotProgress?.percent || 0}%</span>
                                       </div>
                                   )}
                                   {copyingImageToShotId === item.id && (
                                       <div className="absolute inset-0 bg-n900/55 flex items-center justify-center text-white">
                                           <CircleDashed className="w-4 h-4 animate-spin" />
                                       </div>
                                   )}
                               </div>
                               <div className="flex-1 min-w-0">
                                   <div className="flex justify-between items-center mb-0.5">
                                       <span className={`text-[10px] font-bold ${isSelected ? 'text-primary' : 'text-n300'}`}>
                                           镜头 {String(index + 1).padStart(2, '0')}
                                       </span>
                                       <div className="flex items-center gap-1">
                                           {/* Model Indicator */}
                                           <div 
                                               className="relative group/model cursor-pointer"
                                               onClick={(e) => {
                                                   e.stopPropagation();
                                                   const currentModel = shotModels[item.id] || globalModel;
                                                   // 2026-05-21：循环顺序覆盖全部 8 个模型，确保 indicator 点击能切到天劫系列
                                                   const models: GenerationModel[] = ['nanobanana', 'qwen', 'qwen_lora', 'kontext', 'qwenN', 'qwenN_lora', 'gpt_image_vip', 'gpt_image_official'];
                                                   const currentIndex = models.indexOf(currentModel);
                                                   const nextModel = models[(currentIndex + 1) % models.length];
                                                   setShotModels(prev => ({ ...prev, [item.id]: nextModel }));
                                               }}
                                           >
                                               <div className={`w-5 h-5 rounded flex items-center justify-center text-[7px] font-bold transition-all ${
                                                   (shotModels[item.id] || globalModel) === 'nanobanana' 
                                                       ? 'bg-yellow-500/20 text-yellow-400' 
                                                       : (shotModels[item.id] || globalModel) === 'qwen'
                                                       ? 'bg-blue-500/20 text-blue-400'
                                                       : (shotModels[item.id] || globalModel) === 'qwen_lora'
                                                       ? 'bg-green-500/20 text-green-400'
                                                       : (shotModels[item.id] || globalModel) === 'qwenN'
                                                       ? 'bg-red-500/20 text-red-400'
                                                       : (shotModels[item.id] || globalModel) === 'gpt_image_vip'
                                                       ? 'bg-fuchsia-500/20 text-fuchsia-300'
                                                       : (shotModels[item.id] || globalModel) === 'gpt_image_official'
                                                       ? 'bg-rose-500/20 text-rose-300'
                                                       : 'bg-primary-light text-primary'
                                               }`}>
                                                   {(shotModels[item.id] || globalModel) === 'nanobanana' ? '化神' : 
                                                    (shotModels[item.id] || globalModel) === 'qwen' ? '练气一阶' : 
                                                    (shotModels[item.id] || globalModel) === 'qwen_lora' ? '筑基一阶' : 
                                                    (shotModels[item.id] || globalModel) === 'qwenN' ? 'K神' : 
                                                    (shotModels[item.id] || globalModel) === 'qwenN_lora' ? '筑基二阶' : 
                                                    (shotModels[item.id] || globalModel) === 'kontext' ? '练气二阶' : 
                                                    (shotModels[item.id] || globalModel) === 'gpt_image_vip' ? '天劫一' : 
                                                    (shotModels[item.id] || globalModel) === 'gpt_image_official' ? '天劫二' : '未知'}
                                               </div>
                                               <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 hidden group-hover/model:block z-10 whitespace-nowrap bg-n0 border border-n40 rounded px-2 py-1 text-[8px] text-n700 shadow-lg">
                                                   点击切换模型
                                               </div>
                                           </div>
                                       {item.isConfigConfirmed && <CheckCircle2 className="w-3 h-3 text-success" />}
                                       {onDeleteStoryboardItem && (
                                           <button
                                               onClick={(e) => { e.stopPropagation(); onDeleteStoryboardItem(item.id); }}
                                               className="opacity-0 group-hover:opacity-100 text-n100 hover:text-danger transition-all p-0.5"
                                               title="删除此镜头"
                                           >
                                               <Trash2 className="w-3 h-3" />
                                           </button>
                                       )}
                                       </div>
                                    </div>
                                    <p className="text-[9px] text-n100 line-clamp-1">{item.scriptSegment}</p>
                                    {isShotGenerating && (
                                      <div className="mt-1">
                                        <div className="flex items-center justify-between gap-1 text-[8px]">
                                          <span className="truncate text-primary">
                                            {shotProgress?.stage || '等待批量队列'}
                                          </span>
                                          <span className="shrink-0 font-mono text-primary">{shotProgress?.percent || 0}%</span>
                                        </div>
                                        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-primary/15">
                                          <div
                                            className="h-full rounded-full bg-primary transition-[width] duration-500"
                                            style={{ width: `${shotProgress?.percent || 0}%` }}
                                          />
                                        </div>
                                        {shotProgress && (
                                          <p className="mt-0.5 whitespace-nowrap text-[8px] text-n300">
                                            {shotProgress.mode === 'live' ? '实时进度' : '预计进度'}
                                            {' · '}
                                            {formatStoryboardGenerationEta(shotProgress.etaSeconds)}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                </div>
                            </div>
                       );
                   })}
                   {/* 分批加载：镜头很多时默认只显示前 N 个，避免卡顿 */}
                   {hasStoryboard && storyboardTotalCount > visibleShotCount && (
                       <button
                           onClick={() => setVisibleShotCount(c => c + SHOT_PAGE_SIZE)}
                           className="w-full py-2 my-1 text-xs font-medium text-primary bg-primary-light/50 hover:bg-primary-light rounded-lg border border-primary/20 transition-colors"
                       >
                           展开更多（还有 {storyboardTotalCount - visibleShotCount} 个镜头）
                       </button>
                   )}
                   {hasStoryboard && visibleShotCount > SHOT_PAGE_SIZE && (
                       <button
                           onClick={() => setVisibleShotCount(SHOT_PAGE_SIZE)}
                           className="w-full py-1.5 text-[11px] text-n300 hover:text-n800 hover:bg-n20 rounded-lg transition-colors"
                       >
                           收起（只看前 {SHOT_PAGE_SIZE} 个）
                       </button>
                   )}
               </div>
               {/* Drag Handle */}
               <div
                    className="absolute top-0 right-0 bottom-0 w-1 bg-transparent hover:bg-primary-hover/50 cursor-col-resize z-50 transition-colors"
                    onMouseDown={startResizing}
                >
                    <div className="absolute top-1/2 -translate-y-1/2 right-0.5">
                        <GripVertical className="w-3 h-3 text-n100 opacity-0 hover:opacity-100" />
                    </div>
                </div>
          </div>

          {/* Main Content */}
          <div className="workflow-stage-canvas storyboard-generation-main min-h-0 flex-1 flex overflow-hidden pt-[52px]">
              
            {/* Configuration Column */}
            <div className="storyboard-config-pane min-h-0 flex flex-col border-r border-n40 bg-n0 px-6 pt-6 pb-24 overflow-y-auto custom-scrollbar">
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-n700 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                      画面分镜配置
                      </h3>
                      <button 
                        onClick={handleConfirmConfig}
                        className={`text-[10px] flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
                          selectedShot?.isConfigConfirmed 
                            ? 'bg-g50 text-success border-g75'
                            : 'bg-n0 text-n300 border-n40 hover:text-n800'
                        }`}
                      >
                          <CheckCircle2 className="w-3 h-3" />
                        {selectedShot?.isConfigConfirmed ? '解除配置锁定' : '确认并锁定配置'}
                      </button>
                  </div>

                {/* Model Selection */}
                <div className="mb-6 p-4 bg-n20 border border-n40 rounded-md">
                    <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-3.5 h-3.5 text-yellow-400" />
                        <span className="text-xs font-bold text-n700">默认生成模型</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            onClick={() => setGlobalModel('qwen')}
                            className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                globalModel === 'qwen'
                                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg'
                                    : 'bg-n0 text-n300 border border-n40 hover:bg-n20'
                            }`}
                            disabled={isGenerating}
                        >
                            练气一阶
                        </button>
                        <button
                            onClick={() => setGlobalModel('qwen_lora')}
                            className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                globalModel === 'qwen_lora'
                                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
                                    : 'bg-n0 text-n300 border border-n40 hover:bg-n20'
                            }`}
                            disabled={isGenerating}
                        >
                            筑基一阶
                        </button>
                        <button
                            onClick={() => setGlobalModel('nanobanana')}
                            className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                globalModel === 'nanobanana'
                                    ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white shadow-lg'
                                    : 'bg-n0 text-n300 border border-n40 hover:bg-n20'
                            }`}
                            disabled={isGenerating}
                        >
                            化神
                        </button>
                        <button
                            onClick={() => setGlobalModel('kontext')}
                            className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                globalModel === 'kontext'
                                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                                    : 'bg-n0 text-n300 border border-n40 hover:bg-n20'
                            }`}
                            disabled={isGenerating}
                        >
                            练气二阶
                        </button>
                        <button
                            onClick={() => setGlobalModel('qwenN_lora')}
                            className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                globalModel === 'qwenN_lora'
                                    ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg'
                                    : 'bg-n0 text-n300 border border-n40 hover:bg-n20'
                            }`}
                            disabled={isGenerating}
                        >
                            筑基二阶
                        </button>
                        <button
                            onClick={() => setGlobalModel('qwenN')}
                            className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                globalModel === 'qwenN'
                                    ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-lg'
                                    : 'bg-n0 text-n300 border border-n40 hover:bg-n20'
                            }`}
                            disabled={isGenerating}
                        >
                            K神
                        </button>
                        <button
                            onClick={() => setGlobalModel('gpt_image_vip')}
                            className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                globalModel === 'gpt_image_vip'
                                    ? 'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white shadow-lg'
                                    : 'bg-n0 text-n300 border border-n40 hover:bg-n20'
                            }`}
                            disabled={isGenerating}
                        >
                            天劫一阶
                        </button>
                        <button
                            onClick={() => setGlobalModel('gpt_image_official')}
                            className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                globalModel === 'gpt_image_official'
                                    ? 'bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow-lg'
                                    : 'bg-n0 text-n300 border border-n40 hover:bg-n20'
                            }`}
                            disabled={isGenerating}
                        >
                            天劫二阶
                        </button>
                    </div>
                    {/* ComfyUI 档位走用户固定选择的 GPU Agent，默认 GPU1。 */}
                    {COMFYUI_MODELS.has(globalModel) && (
                        <div className={`mt-2 rounded border px-2 py-2 text-[10px] leading-relaxed ${
                            usableClusterNodes.length > 0
                                ? 'bg-g50 text-g400 border-g200'
                                : 'bg-y50 text-y400 border-y200'
                        }`}>
                            <div className="flex items-start justify-between gap-2">
                                <span>
                                    {usableClusterNodes.length > 0
                                        ? <>此档走 <b>ComfyUI GPU 集群</b>。默认 GPU1，可手动切换任意在线节点；选择会保留。</>
                                        : <>此档走 <b>ComfyUI GPU 集群</b>。当前未检测到在线节点，请先启动对应 Agent。</>}
                                </span>
                                <button
                                    type="button"
                                    onClick={loadClusterNodeOptions}
                                    disabled={clusterNodesLoading}
                                    className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-current/20 bg-n0/70 hover:bg-n0 disabled:opacity-60"
                                    title="刷新 GPU 集群节点"
                                >
                                    <RefreshCw className={`w-3 h-3 ${clusterNodesLoading ? 'animate-spin' : ''}`} />
                                    刷新
                                </button>
                            </div>
                            <div className="mt-2 grid grid-cols-[48px,1fr] items-center gap-2">
                                <span className="text-n300">处理节点</span>
                                <select
                                    value={selectedClusterNodeId}
                                    onChange={(e) => {
                                        setSelectedClusterNodeId(e.target.value);
                                        setPreferredGpuNodeId(e.target.value);
                                    }}
                                    disabled={clusterNodesLoading || clusterNodes.length === 0 || isGenerating}
                                    className="w-full px-2 py-1 text-[10px] bg-n0 border border-n40 rounded text-n700 focus:border-primary focus:outline-none disabled:bg-n20 disabled:text-n100"
                                >
                                    {clusterNodes.length === 0 && (
                                        <option value={DEFAULT_GPU_NODE_NAME}>{DEFAULT_GPU_NODE_NAME} · offline</option>
                                    )}
                                    {clusterNodes.map((node) => (
                                        <option key={node.id} value={node.name}>
                                            {node.name} · {node.status}{node.tasks != null && node.maxConcurrent != null ? ` · ${node.tasks}/${node.maxConcurrent}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="mt-1 text-[9px] text-n300">
                                当前指定：{selectedClusterNode?.name || selectedClusterNodeId}
                                {selectedClusterNode && !isClusterNodeUsable(selectedClusterNode) ? '（离线，提交时自动回退）' : ''}
                                {clusterNodeMessage ? ` · ${clusterNodeMessage}` : ''}
                            </div>
                        </div>
                    )}
                    <p className="text-[9px] text-n100 mt-2">
                        {globalModel === 'nanobanana' && '化神境界 · 点击分镜列表中的模型标识可单独设置'}
                        {globalModel === 'qwen' && '练气一阶 · 点击分镜列表中的模型标识可单独设置'}
                        {globalModel === 'qwen_lora' && '筑基一阶境界 · 点击分镜列表中的模型标识可单独设置'}
                        {globalModel === 'kontext' && '练气二阶 · 点击分镜列表中的模型标识可单独设置'}
                        {globalModel === 'qwenN' && 'K神境界 · 点击分镜列表中的模型标识可单独设置'}
                        {globalModel === 'qwenN_lora' && '筑基二阶境界 · 点击分镜列表中的模型标识可单独设置'}
                        {selectedGenerationModel === 'gpt_image_vip' && '天劫一阶 · GPT Image VIP 系列，可调整比例 / 分辨率档位'}
                        {selectedGenerationModel === 'gpt_image_official' && '天劫二阶 · GPT Image 官方混合，可调整比例 / 分辨率 / 质量'}
                    </p>

                    <div className="mt-3 pt-3 border-t border-n40">
                        <div className="text-[9px] text-n100 mb-2 flex items-center gap-1">
                          <span className="text-primary">●</span>
                          当前镜头输出参数
                          <span className="text-n100 ml-1">· 默认 16:9 / 1K</span>
                        </div>
                        <div className={`grid ${selectedGenerationModel === 'gpt_image_official' ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                          <div>
                            <label className="text-[9px] text-n100 block mb-1">画面比例</label>
                            <select
                              value={imageRatio}
                              onChange={(e) => setImageRatio(e.target.value as GptImageRatio)}
                              disabled={isGenerating}
                              className="w-full px-2 py-1 text-[10px] bg-n0 border border-n40 rounded text-n700 focus:border-primary focus:outline-none"
                            >
                              {GPT_IMAGE_RATIO_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-n100 block mb-1">分辨率</label>
                            <select
                              value={imageK}
                              onChange={(e) => setImageK(e.target.value as GptImageK)}
                              disabled={isGenerating}
                              className="w-full px-2 py-1 text-[10px] bg-n0 border border-n40 rounded text-n700 focus:border-primary focus:outline-none"
                            >
                              {GPT_IMAGE_K_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          {selectedGenerationModel === 'gpt_image_official' && (
                            <div>
                              <label className="text-[9px] text-n100 block mb-1">质量</label>
                              <select
                                value={imageQuality}
                                onChange={(e) => setImageQuality(e.target.value as GptImageQuality)}
                                disabled={isGenerating}
                                className="w-full px-2 py-1 text-[10px] bg-n0 border border-n40 rounded text-n700 focus:border-rose-500 focus:outline-none"
                              >
                                {GPT_IMAGE_QUALITY_OPTIONS.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="mt-2 rounded border border-n40 bg-n10 px-2 py-1.5 text-[9px] leading-4 text-n300">
                          实际输出：{selectedImageSettings.ratio} · {selectedImageSettings.k}
                          {isLoadingReferenceDimensions
                            ? ' · 正在读取参考素材尺寸'
                            : selectedImageSettings.sourceDimensions
                              ? ` · 最大参考图 ${selectedImageSettings.sourceDimensions.width}×${selectedImageSettings.sourceDimensions.height}`
                              : ' · 无可用尺寸时使用标准 16:9 / 1K'}
                          {(imageRatio === 'auto' || imageK === 'auto') && ' · 按最大参考图和尺寸自动决定档位'}
                        </div>
                      </div>
                  </div>

                  {/* Prompt */}
                  <div className="mb-6">
                      <label className="text-xs font-bold text-n300 mb-2 block">画面提示词 (Image Prompt)</label>
                      <textarea
                          value={prompt}
                          onChange={(e) => {
                            setPrompt(e.target.value);
                            userEditedPromptRef.current = true; // 🆕 标记用户已手动编辑
                          }}
                          onBlur={(e) => {
                            // 🆕 当用户修改完prompt后，同步更新到storyboard
                            if (selectedShot && userEditedPromptRef.current) {
                              console.log('💾 同步prompt到storyboard:', e.target.value.substring(0, 50) + '...');
                              onUpdateStoryboardItem(selectedShot.id, {
                                imagePrompt: e.target.value
                              });
                            }
                          }}
                        disabled={selectedShot?.isConfigConfirmed}
                        className={`w-full h-32 bg-n0 border border-n40 rounded-lg p-3 text-xs text-n700 focus:border-primary focus:outline-none resize-none leading-relaxed ${selectedShot?.isConfigConfirmed ? 'opacity-50 cursor-not-allowed' : ''}`}
                      />
                  </div>

                  {/* Reference Images */}
                  <div 
                      className={`mb-6 transition-all ${isDraggingRef ? 'ring-2 ring-primary ring-inset rounded-lg bg-primary-light' : ''}`}
                      onDragOver={handleRefDragOver}
                      onDragLeave={handleRefDragLeave}
                      onDrop={handleRefDrop}
                  >
                      <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <label className="block text-xs font-bold text-n300">
                                实际提交参考图片 ({referencePlan.references.length}/{referencePlan.maxReferences})
                            </label>
                            <div className="mt-1 text-[11px] font-normal text-n100">可拖拽图片到此</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              onClick={() => { setMaterialPickerFilter('shot'); setShowMaterialPicker(true); }}
                              disabled={references.length >= 6}
                              className="inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border border-primary bg-primary px-3 py-2 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
                            >
                                <Library className="w-3 h-3" />
                                项目素材
                            </button>
                            <button
                              onClick={handleAutoFill}
                              className="inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border border-primary/30 bg-primary-light px-3 py-2 text-xs text-primary hover:bg-primary-light disabled:opacity-50"
                            >
                                <Wand2 className="w-3 h-3" />
                                自动绑定
                            </button>
                          </div>
                      </div>

                      {referencePlan.excluded.length > 0 && (
                        <div className="mb-3 rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[10px] leading-relaxed text-warning">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <div>
                              <div className="font-semibold">{referencePlan.excluded.length} 张参考图未提交</div>
                              <div className="mt-1 text-current/80">
                                未提交：{referencePlan.excluded.map(item => `${item.reference.type === 'character' ? '角色' : item.reference.type === 'scene' ? '场景' : item.reference.type === 'prop' ? '道具' : '补充'}「${item.reference.name || '未命名'}」`).join('、')}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Reference Grid */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                          {references.map((ref) => (
                              <div 
                                key={ref.id} 
                              className="relative group aspect-square bg-n30 rounded-lg border border-n40 overflow-hidden"
                              >
                                <img 
                                  src={ref.url} 
                                  loading="lazy"
                                  decoding="async"
                                  alt=""
                                  className="w-full h-full object-cover cursor-pointer" 
                                  onClick={() => setImageEditorData({ imageUrl: ref.url, referenceId: ref.id })}
                                />
                                  
                                {/* Action Buttons */}
                                <div
                                  className="pointer-events-none absolute right-1 top-1 z-10 grid grid-cols-2 gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                                  data-testid="reference-image-actions"
                                >
                                      <button 
                                          onClick={(e) => { e.stopPropagation(); setImageEditorData({ imageUrl: ref.url, referenceId: ref.id }); }}
                                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-hover"
                                          title="编辑图片"
                                      >
                                          <Pencil className="w-3 h-3" />
                                      </button>
                                      <button 
                                          onClick={(e) => { e.stopPropagation(); setCameraModalImage(ref.url); }}
                                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-hover"
                                          title="角度调整"
                                      >
                                          <Camera className="w-3 h-3" />
                                      </button>
                                      <button 
                                          onClick={(e) => { e.stopPropagation(); setAroundAngleModalImage(ref.url); }}
                                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/80 text-white hover:bg-cyan-600"
                                          title="全景角度生成"
                                      >
                                          <RotateCcw className="w-3 h-3" />
                                      </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteReference(ref);
                                            }}
                                            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-n900/50 text-white hover:bg-danger"
                                            title="从当前镜头删除参考图片"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                </div>

                                  <div className="absolute top-1 left-1 pointer-events-none">
                                      {ref.type === 'character' && <Users className="w-3 h-3 text-primary drop-shadow-md" />}
                                      {ref.type === 'scene' && <MapPin className="w-3 h-3 text-orange-400 drop-shadow-md" />}
                                      {ref.type === 'pose' && <User className="w-3 h-3 text-blue-400 drop-shadow-md" />}
                                      {ref.type === 'prop' && <Box className="w-3 h-3 text-yellow-400 drop-shadow-md" />}
                                      {ref.type === 'effect' && <Zap className="w-3 h-3 text-primary drop-shadow-md" />}
                                  </div>
                                  <div className="absolute bottom-1 left-1 right-1 pointer-events-none">
                                    <span className="max-w-full truncate rounded bg-n900/60 px-1.5 py-0.5 text-[9px] text-white">{ref.name || '参考图'}</span>
                                  </div>
                              </div>
                          ))}
                          
                           {/* 空槽优先从项目素材库补充；外部上传保留在下方。 */}
                          {Array.from({ length: Math.max(0, 6 - references.length) }).map((_, i) => (
                              <div 
                                  key={i} 
                                  onClick={() => {
                                      setMaterialPickerFilter('shot');
                                      setShowMaterialPicker(true);
                                   }}
                                  className="aspect-square rounded-lg border border-dashed flex flex-col items-center justify-center text-xs bg-n30 border-n40 text-n100 hover:bg-n20 hover:border-n40 hover:text-n300 cursor-pointer transition-all"
                              >
                                   <Library className="w-4 h-4 mb-1 opacity-50" />
                                   <span>{i + 1 + references.length}</span>
                               </div>
                           ))}
                       </div>

                       {/* External references are a secondary supplement after project materials. */}
                       <div className="space-y-2 border-t border-n40 pt-3">
                           <div className="flex items-center gap-2 text-[10px] text-n100">
                             <Upload className="w-3 h-3" />
                             外部参考（可选补充）
                           </div>
                           <div className="flex flex-wrap gap-2">
                              {categories.map((cat) => (
                                  <label 
                                    key={cat.type}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-[10px] cursor-pointer transition-colors ${references.length >= 6 ? 'opacity-50 cursor-not-allowed bg-n0 border-n40 text-n100' : 'bg-n0 hover:bg-n20 border-n40 text-n700 hover:text-n800'}`}
                                  >
                                      <cat.icon className="w-3 h-3" />
                                      上传{cat.label}
                                      <input 
                                        type="file" 
                                        className="hidden" 
                                        accept="image/*"
                                      disabled={references.length >= 6}
                                        onChange={(e) => handleFileUpload(e, cat.type)} 
                                      />
                                  </label>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>

            {/* Results Column */}
            <div 
                className={`storyboard-results-pane flex-1 flex flex-col bg-n20 relative overflow-hidden transition-all ${isDraggingResult ? 'ring-2 ring-emerald-500 ring-inset bg-emerald-500/5' : ''}`}
                onDragOver={handleResultDragOver}
                onDragLeave={handleResultDragLeave}
                onDrop={handleResultDrop}
            >
                   <div className="flex-1 overflow-y-auto p-6 custom-scrollbar pb-20">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-bold text-n700 flex items-center gap-2">
                                <ImageIcon className="w-4 h-4 text-success" />
                              画面分镜结果
                              <span className="font-normal text-n100 text-xs">可拖拽图片到此</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowStoryboardToolModal(true)}
                                    disabled={!selectedShot}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-primary-light hover:bg-primary-light border border-primary hover:border-primary rounded-lg text-xs font-medium text-primary hover:text-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="分镜工具（全景融合/自动分镜/多宫格）"
                                >
                                    <Grid3X3 className="w-3.5 h-3.5" />
                                    分镜工具
                                </button>
                            </div>
                            <input
                                type="file"
                                id="upload-result-image"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={async (e) => {
                                    const fileList = e.target.files;
                                    if (!fileList || fileList.length === 0 || !selectedShot) return;
                                    const { uploadEntityFile } = await import('../services/entityFileService');
                                    
                                    for (const file of Array.from(fileList)) {
                                        try {
                                            const saved = await uploadEntityFile(
                                                file, 'storyboard_item', selectedShot.id,
                                                'generated_image', episodeId
                                            );
                                            const newImage: GeneratedImage = {
                                                id: saved.fileId || uuidv4(),
                                                url: saved.fileUrl,
                                                thumbnail: saved.fileUrl,
                                                timestamp: Date.now(),
                                                fileId: saved.fileId || undefined,
                                            };
                                            onUpdateStoryboardItem(selectedShot.id, {
                                                generatedImages: [newImage],
                                                selectedImageId: newImage.id,
                                                generatedImage: saved.fileUrl,
                                            });
                                            queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
                                            notifyStoryboardImageChanged(episodeId, selectedShot?.id);
                                        } catch (err) {
                                            console.error('上传图片失败:', err);
                                        }
                                    }
                                    e.target.value = '';
                                }}
                            />
                            <button
                                onClick={() => document.getElementById('upload-result-image')?.click()}
                                disabled={!selectedShot}
                                className="flex items-center gap-2 px-3 py-1.5 bg-n0 hover:bg-n20 border border-n40 hover:border-emerald-500 rounded-lg text-xs font-medium text-n700 hover:text-success transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                title="从本地上传图片"
                            >
                                <Upload className="w-3.5 h-3.5" />
                                上传图片
                            </button>
                        </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {currentGeneratedImages.map((img) => (
                                <div 
                                    key={img.id} 
                                    draggable
                                    onDragStart={(e) => handleResultImageDragStart(e, img)}
                                    onDragEnd={() => setImageDropTargetShotId(null)}
                                  className={`relative group bg-n0 border rounded-md overflow-hidden shadow-lg transition-all cursor-grab active:cursor-grabbing ${effectiveSelectedId === img.id ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-n40'}`}
                                    onClick={() => handleSelectResult(img.id)}
                                    title="拖到左侧其他镜头可复制为该镜头的实际提交参考图片；拖到参考图区可添加为当前镜头参考图"
                                >
                                    <div 
                                        className="aspect-video bg-n30 relative cursor-zoom-in group" 
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            // 🔧 懒加载：按需加载原图并更新URL
                                            if (selectedShot && selectedFileId) {
                                                handleViewFullImage(selectedShot.id, img.id);
                                            }
                                        }}
                                    >
                                        <img 
                                            src={getImageThumbnailUrl(img.thumbnail || img.url, 360, 220)}
                                            loading="lazy"
                                            decoding="async"
                                            alt=""
                                            className="w-full h-full object-contain transition-opacity duration-300"
                                            style={{ imageRendering: 'auto', opacity: 1 }}
                                            onError={(e) => {
                                                const target = e.target as HTMLImageElement;
                                                target.style.opacity = '0.3';
                                                target.alt = '图片加载失败';
                                            }}
                                        />
                                        {img.thumbnail && (
                                            <div className="absolute inset-0 bg-n900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <span className="text-xs text-white bg-n900/50 px-2 py-1 rounded">点击查看高清原图</span>
                                            </div>
                                        )}
                                      {effectiveSelectedId === img.id && (
                                            <div className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded-full shadow-lg">
                                                <CheckCircle2 className="w-4 h-4" />
                                            </div>
                                        )}
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-end">
                                            <span className="text-[9px] text-n300 font-mono">
                                                {new Date(img.timestamp).toLocaleTimeString()}
                                            </span>
                                          <div className="flex items-center gap-2">
                                              <button 
                                                  onClick={(e) => { 
                                                      e.stopPropagation(); 
                                                      // 🔧 修改：打开多角度生成弹窗
                                                      setHumanMultiAngleModalImage(img.url || img.thumbnail);
                                                  }}
                                                  className="p-1.5 bg-blue-500/80 hover:bg-blue-600 text-white rounded-md transition-colors"
                                                  title="多角度人物生成"
                                              >
                                                  <Users className="w-3.5 h-3.5" />
                                              </button>
                                              <button 
                                                  onClick={(e) => { 
                                                      e.stopPropagation(); 
                                                      // 🆕 打开全景生成弹窗
                                                      setAroundAngleModalImage(img.url || img.thumbnail);
                                                  }}
                                                  className="p-1.5 bg-cyan-500/80 hover:bg-cyan-600 text-white rounded-md transition-colors"
                                                  title="全景角度生成"
                                              >
                                                  <RotateCcw className="w-3.5 h-3.5" />
                                              </button>
                                              <button 
                                                  onClick={(e) => { e.stopPropagation(); setCameraModalImage(img.url || img.thumbnail); }}
                                                  className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded-md transition-colors"
                                                  title="角度调整"
                                              >
                                                  <Camera className="w-3.5 h-3.5" />
                                              </button>
                                              <button 
                                                  onClick={(e) => { e.stopPropagation(); setMattingModalImage(img.url || img.thumbnail); }}
                                                  className="p-1.5 bg-green-500/80 hover:bg-green-600 text-white rounded-md transition-colors"
                                                  title="抠图"
                                              >
                                                  <Scissors className="w-3.5 h-3.5" />
                                              </button>
                                              <button 
                                                  onClick={(e) => { e.stopPropagation(); setShowFusionModal(true); }}
                                                  className="p-1.5 bg-orange-500/80 hover:bg-orange-600 text-white rounded-md transition-colors"
                                                  title="融合"
                                              >
                                                  <Layers className="w-3.5 h-3.5" />
                                              </button>
                                            <button 
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteResult(img.id); }}
                                                    className="p-1.5 bg-danger hover:bg-danger text-white rounded-md transition-colors"
                                                    title="删除"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </div>
                                    </div>
                                    <div className="p-2 bg-n0 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 cursor-pointer hover:bg-n20 transition-colors" onClick={(e) => { e.stopPropagation(); handleSelectResult(img.id); }}>
                                      <span className={`text-xs font-medium ${effectiveSelectedId === img.id ? 'text-success' : 'text-n100'}`}>
                                        {effectiveSelectedId === img.id ? '已选定 (最终结果)' : '点击选定'}
                                      </span>
                                      {(img.generationModel || img.generationAttempt) && (
                                        <span className="text-[9px] text-n100 truncate">
                                          {img.generationModel || ''}
                                        </span>
                                      )}
                                    </div>
                                </div>
                            ))}

                            {isCurrentShotGenerating && (
                                <div className="aspect-video bg-n0 border-2 border-dashed border-primary/50 rounded-md flex flex-col items-center justify-center px-8">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
                                    <span className="text-primary text-sm font-bold">
                                      生成中 {currentGenerationProgress?.percent || 0}%
                                    </span>
                                    <span className="mt-1 text-xs text-n300">
                                      {currentGenerationProgress?.stage || '正在提交生成任务'}
                                    </span>
                                    <div className="mt-3 h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-primary/15">
                                      <div
                                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                                        style={{ width: `${currentGenerationProgress?.percent || 0}%` }}
                                      />
                                    </div>
                                    {currentGenerationProgress && (
                                      <span className="mt-2 whitespace-nowrap text-[10px] text-n300">
                                        {currentGenerationProgress.mode === 'live' ? '实时进度' : '预计进度'}
                                        {' · '}
                                        {formatStoryboardGenerationEta(currentGenerationProgress.etaSeconds)}
                                      </span>
                                    )}
                                </div>
                            )}

                            {!isCurrentShotGenerating && currentGeneratedImages.length === 0 && (
                                <div className="col-span-full py-12 border-2 border-dashed border-n40 rounded-md flex flex-col items-center justify-center text-n100 bg-n0">
                                    <ImageIcon className="w-12 h-12 mb-3 opacity-20" />
                                    <p className="text-sm">暂无生成结果</p>
                                    <p className="text-xs mt-1">请配置提示词并点击生成</p>
                                </div>
                            )}
                      </div>
                        </div>
                   </div>
                   
                   {/* 🆕 生成按钮 - 固定在结果栏底部居中 */}
                   <div className="absolute bottom-0 left-0 right-0 flex justify-center py-3 bg-n20 border-t border-n40 backdrop-blur-sm">
                        <button 
                            onClick={handleGenerateCurrent}
                            disabled={isCurrentShotGenerating || !prompt}
                            className="px-8 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold text-sm shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-transform"
                            title={COMFYUI_MODELS.has(globalModel) && references.length === 0 && currentGeneratedImages.length === 0 ? '本地 GPU 模型需要参考图' : ''}
                        >
                            <Sparkles className={`w-4 h-4 ${isCurrentShotGenerating ? 'animate-spin' : ''}`} />
                            {isCurrentShotGenerating
                              ? `正在生成 ${currentGenerationProgress?.percent || 0}%`
                              : (currentGeneratedImages.length > 0 ? '重新/追加生成' : '开始生成')}
                        </button>
                   </div>

        </div>

          {/* Save Version Modal */}
         {isNamingVersion && (
            <div className="absolute top-14 right-40 z-50 bg-n0 border border-n40 shadow-xl rounded-lg p-3 w-72 animate-in fade-in slide-in-from-top-2">
                <h4 className="text-xs font-bold text-n700 mb-2">保存生成存档</h4>
                <input 
                    type="text" 
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                    className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs text-n800 mb-2 focus:outline-none focus:border-primary"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submitVersionSave();
                        if (e.key === 'Escape') setIsNamingVersion(false);
                    }}
                />
                <div className="flex gap-2">
                    <button onClick={() => setIsNamingVersion(false)} className="flex-1 py-1 bg-n0 text-n700 text-xs rounded hover:bg-n20">取消</button>
                    <button onClick={submitVersionSave} className="flex-1 py-1 bg-primary text-white text-xs rounded hover:bg-primary-hover">确认保存</button>
                </div>
            </div>
        )}

        {/* History Panel */}
        {showHistory && renderHistoryPanel()}

        {/* Image Preview Modal (Lightbox) with Navigation */}
        {previewImage && (
            <div 
                className="fixed inset-0 z-[100] bg-n900/50 flex items-center justify-center p-8 cursor-zoom-out"
                onClick={closePreview}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') handlePrevImage();
                    else if (e.key === 'ArrowRight') handleNextImage();
                    else if (e.key === 'Escape') closePreview();
                }}
                tabIndex={0}
            >
                {/* 🔧 修复：给容器添加固定尺寸，防止loading动画挤到一起 */}
                <div className="relative flex items-center justify-center" style={{ minWidth: '50vw', minHeight: '50vh' }}>
                    {/* 🆕 加载进度指示器 - 独立定位 */}
                    {isLoadingFullImage && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-n900/50 rounded-lg z-10">
                            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4"></div>
                            <p className="text-white text-sm">加载大图中...</p>
                        </div>
                    )}
                    <img 
                        src={previewImage} 
                        decoding="async"
                        alt=""
                        className={`max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl transition-opacity ${isLoadingFullImage ? 'opacity-30' : 'opacity-100'}`}
                        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking image
                        onLoad={() => {
                            console.log('✅ 大图加载完成');
                            setIsLoadingFullImage(false);
                        }}
                        onError={() => {
                            console.error('❌ 大图加载失败');
                            setIsLoadingFullImage(false);
                        }}
                    />
                    
                    {/* 🆕 左右导航按钮 */}
                    {(() => {
                        const imageList = getPreviewImageList();
                        const currentIndex = imageList.findIndex(img => img.id === previewImageId);
                        const hasPrev = currentIndex > 0;
                        const hasNext = currentIndex < imageList.length - 1;
                        const totalImages = imageList.length;
                        
                        return (
                            <>
                                {/* 左箭头 - 上一张 */}
                                {hasPrev && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handlePrevImage(); }}
                                        className="absolute left-4 top-1/2 -translate-y-1/2 bg-n0 hover:bg-n20 text-n800 rounded-full p-3 border border-n40 transition-all hover:scale-110 z-20"
                                        title="上一张 (←)"
                                    >
                                        <ChevronLeft className="w-6 h-6" />
                                    </button>
                                )}
                                
                                {/* 右箭头 - 下一张 */}
                                {hasNext && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleNextImage(); }}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 bg-n0 hover:bg-n20 text-n800 rounded-full p-3 border border-n40 transition-all hover:scale-110 z-20"
                                        title="下一张 (→)"
                                    >
                                        <ChevronRight className="w-6 h-6" />
                                    </button>
                                )}
                                
                                {/* 图片计数器 */}
                                {totalImages > 1 && (
                                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-n0 text-n800 text-sm px-4 py-2 rounded-full border border-n40 z-20">
                                        {currentIndex + 1} / {totalImages}
                                    </div>
                                )}
                            </>
                        );
                    })()}
                    
                    {/* 关闭按钮 */}
                    <button 
                        onClick={closePreview}
                        className="absolute -top-4 -right-4 bg-n0 text-n800 rounded-full p-2 hover:bg-n20 border border-n40 z-20"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>
        )}

        {/* Camera Angle Adjustment Modal */}
        {cameraModalImage && (
            <CameraAngleModal
                imageUrl={cameraModalImage}
                onClose={() => setCameraModalImage(null)}
                onSubmit={handleAngleAdjustment}
                isProcessing={isAngleAdjusting}
                clusterNodes={clusterNodes}
                clusterNodesLoading={clusterNodesLoading}
                selectedClusterNodeId={selectedClusterNodeId}
                clusterNodeMessage={clusterNodeMessage}
                onSelectClusterNode={(nodeId) => {
                    setSelectedClusterNodeId(nodeId);
                    setPreferredGpuNodeId(nodeId);
                }}
                onRefreshClusterNodes={loadClusterNodeOptions}
            />
        )}

        {/* 🆕 Human Multi-Angle Generation Modal */}
        {humanMultiAngleModalImage && (
            <HumanMultiAngleModal
                imageUrl={humanMultiAngleModalImage}
                onClose={() => setHumanMultiAngleModalImage(null)}
                onSubmit={handleHumanMultiAngle}
                isProcessing={isHumanMultiAngleGenerating}
            />
        )}

        {/* 🆕 Around Angle Generation Modal */}
        {aroundAngleModalImage && (
            <AroundAngleModal
                imageUrl={aroundAngleModalImage}
                onClose={() => setAroundAngleModalImage(null)}
                onSubmit={handleAroundAngle}
                isProcessing={isAroundAngleGenerating}
            />
        )}

        {/* 🆕 Image Editor Modal */}
        {imageEditorData && (
            <ImageEditorModal
                imageUrl={imageEditorData.imageUrl}
                referenceId={imageEditorData.referenceId}
                onClose={() => setImageEditorData(null)}
                onSave={handleImageEditorSave}
                onAddSketch={handleAddSketch}
            />
        )}

        {/* 🆕 抠图弹窗 */}
        {mattingModalImage && (
            <React.Suspense fallback={<ModalChunkFallback />}>
                <MattingModal
                    imageUrl={mattingModalImage}
                    onClose={() => setMattingModalImage(null)}
                    onSubmit={handleMatting}
                    isProcessing={isMattingProcessing}
                />
            </React.Suspense>
        )}

        {/* 🆕 融合弹窗 */}
        {showFusionModal && (
            <React.Suspense fallback={<ModalChunkFallback />}>
                <ImageFusionModal
                    generatedImages={currentGeneratedImages}
                    onClose={() => setShowFusionModal(false)}
                    onSubmit={handleImageFusion}
                    isProcessing={isFusionProcessing}
                />
            </React.Suspense>
        )}

        {/* 🆕 分镜工具弹窗 */}
        {showStoryboardToolModal && (
            <React.Suspense fallback={<ModalChunkFallback />}>
                <StoryboardToolModal
                    generatedImages={currentGeneratedImages}
                    materialImages={Object.values(materialLibrary).flat().map(m => ({ url: m.url, name: (m as any).name || m.id }))}
                    onClose={() => setShowStoryboardToolModal(false)}
                    onPanorama360={handlePanorama360}
                    onPanoramaFusion={handlePanoramaFusion}
                    onAutoStoryboard={handleAutoStoryboard}
                    onMultiGridStoryboard={handleMultiGridStoryboardSubmit}
                    isProcessing={isStoryboardToolProcessing}
                />
            </React.Suspense>
        )}

        {showMaterialPicker && (
          <div className="fixed inset-0 z-[140] bg-n900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowMaterialPicker(false)}>
            <div className="w-[min(1024px,calc(100vw-32px))] h-[min(760px,calc(100vh-2rem))] bg-n0 border border-n40 rounded-lg shadow-bottom flex flex-col overflow-hidden" data-testid="material-picker-dialog" onClick={event => event.stopPropagation()}>
              <div className="shrink-0 flex items-start justify-between gap-4 px-5 py-4 border-b border-n40">
                <div>
                  <h3 className="text-sm font-bold text-n800 flex items-center gap-2"><Library className="w-4 h-4 text-primary" />项目素材</h3>
                  <p className="mt-1 text-[11px] text-n300">本镜头相关素材排在最前；可任意添加项目素材或其他分镜图片作为当前镜头参考。</p>
                </div>
                <button onClick={() => setShowMaterialPicker(false)} className="w-8 h-8 inline-flex items-center justify-center text-n300 hover:text-n800" title="关闭">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="shrink-0 px-5 py-3 border-b border-n40 flex flex-wrap items-center gap-2">
                 {([
                   ['shot', '本镜头'],
                   ['other-shot', '其他分镜'],
                   ['character', '人物'],
                   ['scene', '场景'],
                   ['prop', '道具'],
                   ['all', '全部'],
                 ] as const).map(([value, label]) => {
                   const count = materialPickerFilterCounts[value];
                   return (
                     <button
                       key={value}
                       onClick={() => void handleMaterialPickerFilterChange(value)}
                       className={`h-8 px-3 inline-flex items-center gap-1.5 text-xs border rounded ${materialPickerFilter === value ? 'bg-primary text-white border-primary' : 'bg-n0 text-n700 border-n40 hover:bg-n20'}`}
                     >
                       {value === 'other-shot' && <Clapperboard className="w-3.5 h-3.5" />}
                       <span>{label}</span>
                       <span className={`min-w-4 h-4 px-1 inline-flex items-center justify-center rounded text-[9px] ${materialPickerFilter === value ? 'bg-white/20 text-white' : 'bg-n30 text-n500'}`}>
                         {count}
                       </span>
                     </button>
                   );
                 })}
                <label className="ml-auto min-w-[220px] h-8 flex items-center gap-2 px-3 border border-n40 rounded bg-n0">
                  <Search className="w-3.5 h-3.5 text-n100" />
                  <input
                    value={materialPickerSearch}
                    onChange={event => setMaterialPickerSearch(event.target.value)}
                    className="min-w-0 flex-1 text-xs text-n700 outline-none bg-transparent"
                    placeholder="搜索镜头、人物、场景或道具"
                  />
                </label>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-5">
                {isLoadingOtherShotImages && (materialPickerFilter === 'other-shot' || materialPickerFilter === 'all') ? (
                  <div className="h-56 flex flex-col items-center justify-center text-n300">
                    <RefreshCw className="w-6 h-6 mb-3 animate-spin text-primary" />
                    <span className="text-xs">正在加载全部分镜图片...</span>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {(materialPickerFilter === 'other-shot' || materialPickerFilter === 'all') && (
                      <section>
                        {materialPickerFilter === 'all' && (
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-n700">
                            <Clapperboard className="w-3.5 h-3.5 text-primary" />
                            其他分镜图片
                          </div>
                        )}
                        {visibleOtherStoryboardImageItems.length > 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {visibleOtherStoryboardImageItems.map(item => {
                              const alreadyAdded = references.some(reference => reference.url === item.url);
                              const disabled = alreadyAdded || references.length >= 6;
                              return (
                                <button
                                  key={item.key}
                                  onClick={() => !disabled && handleAddOtherStoryboardImage(item)}
                                  disabled={disabled}
                                  className={`relative overflow-hidden rounded-md border text-left transition-colors ${alreadyAdded ? 'border-success bg-success/5' : 'border-n40 bg-n0 hover:border-primary'} disabled:cursor-not-allowed`}
                                  title={alreadyAdded ? '已在当前参考图中' : `添加 ${item.shotLabel} 的${item.imageLabel}`}
                                >
                                  <div className="aspect-video bg-n30 flex items-center justify-center">
                                    <img
                                      src={item.thumbnail || item.url}
                                      alt={`${item.shotLabel} ${item.imageLabel}`}
                                      loading="lazy"
                                      className="w-full h-full object-contain"
                                    />
                                  </div>
                                  <div className="p-2 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="truncate text-xs font-semibold text-n700">{item.shotLabel}</span>
                                      {alreadyAdded && <Check className="w-3.5 h-3.5 shrink-0 text-success" />}
                                    </div>
                                    <div className="mt-1 flex items-center gap-1 text-[9px] text-n100">
                                      <span className={`rounded px-1 py-0.5 ${item.isSelected ? 'bg-success/10 text-success' : 'bg-n30 text-n300'}`}>
                                        {item.imageLabel}
                                      </span>
                                      <span>仅作参考</span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="h-36 flex flex-col items-center justify-center rounded-md border border-dashed border-n40 text-n100">
                            <Clapperboard className="w-7 h-7 mb-2 opacity-40" />
                            <span className="text-xs">其他分镜还没有可用图片</span>
                          </div>
                        )}
                      </section>
                    )}

                    {materialPickerFilter !== 'other-shot' && (
                      <section>
                        {materialPickerFilter === 'all' && (
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-n700">
                            <Library className="w-3.5 h-3.5 text-primary" />
                            项目素材
                          </div>
                        )}
                        {visibleMaterialPickerItems.length > 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {visibleMaterialPickerItems.map(item => {
                              const alreadyAdded = references.some(reference => reference.url === item.material.url);
                              const disabled = alreadyAdded || references.length >= 6;
                              return (
                                <button
                                  key={item.key}
                                  onClick={() => !disabled && handleAddProjectMaterial(item)}
                                  disabled={disabled}
                                  className={`relative overflow-hidden rounded-md border text-left transition-colors ${alreadyAdded ? 'border-success bg-success/5' : 'border-n40 bg-n0 hover:border-primary'} disabled:cursor-not-allowed`}
                                  title={alreadyAdded ? '已在当前参考图中' : `添加 ${item.tagName}`}
                                >
                                  <div className="aspect-square bg-n30">
                                    <img src={item.material.thumbnail || item.material.url} alt={item.tagName} loading="lazy" className="w-full h-full object-cover" />
                                  </div>
                                  <div className="p-2 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="truncate text-xs font-semibold text-n700">{item.tagName || item.material.name || '未命名素材'}</span>
                                      {alreadyAdded && <Check className="w-3.5 h-3.5 shrink-0 text-success" />}
                                    </div>
                                    <div className="mt-1 flex items-center gap-1 text-[9px] text-n100">
                                      <span>{item.type === 'character' ? '人物' : item.type === 'scene' ? '场景' : '道具'}</span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="h-36 flex flex-col items-center justify-center rounded-md border border-dashed border-n40 text-n100">
                            <Library className="w-7 h-7 mb-2 opacity-40" />
                            <span className="text-xs">当前分类没有可用素材</span>
                          </div>
                        )}
                      </section>
                    )}

                    {materialPickerFilter === 'all'
                      && visibleOtherStoryboardImageItems.length === 0
                      && visibleMaterialPickerItems.length === 0
                      && (
                        <div className="h-32 flex flex-col items-center justify-center text-n100">
                          <Search className="w-7 h-7 mb-2 opacity-40" />
                          <span className="text-xs">没有匹配的素材或分镜图片</span>
                        </div>
                      )}
                  </div>
                )}
              </div>
              <div className="shrink-0 px-5 py-3 border-t border-n40 flex items-center justify-between gap-4 text-[11px] text-n300">
                <span>参考图 {references.length}/6；其他分镜图片只建立当前镜头引用，不会修改来源镜头。</span>
                <button onClick={() => setShowMaterialPicker(false)} className="h-8 px-4 rounded bg-primary text-white hover:bg-primary-hover">完成</button>
              </div>
            </div>
          </div>
        )}

      </div>
  );
};

// Camera Angle Adjustment Modal Component
interface CameraAngleModalProps {
    imageUrl: string;
    onClose: () => void;
    onSubmit: (imageUrl: string, params: {
        rotate: number;
        move: number;
        vertical: number;
        wideAngle: boolean;
        customPrompt?: string;
        seed: number;
    }) => void;
    isProcessing: boolean;
    clusterNodes: ClusterNodeOption[];
    clusterNodesLoading: boolean;
    selectedClusterNodeId: string;
    clusterNodeMessage: string;
    onSelectClusterNode: (nodeId: string) => void;
    onRefreshClusterNodes: () => void;
}

const CameraAngleModal: React.FC<CameraAngleModalProps> = ({
    imageUrl,
    onClose,
    onSubmit,
    isProcessing,
    clusterNodes,
    clusterNodesLoading,
    selectedClusterNodeId,
    clusterNodeMessage,
    onSelectClusterNode,
    onRefreshClusterNodes,
}) => {
    const [rotate, setRotate] = useState(0);
    const [move, setMove] = useState(0);
    const [vertical, setVertical] = useState(0);
    const [wideAngle, setWideAngle] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');
    const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000000000000) + 100000000000000);

    const promptExamples = [
        "将镜头向前移动（Move the camera forward.）",
        "将镜头向左移动（Move the camera left.）",
        "将镜头向右移动（Move the camera right.）",
        "将镜头向下移动（Move the camera down.）",
        "将镜头转为俯视（Turn the camera to a top-down view.）",
        "将镜头转为广角镜头（Turn the camera to a wide-angle lens.）",
        "将镜头转为特写镜头（Turn the camera to a close-up.）"
    ];

    const handleSubmit = () => {
        onSubmit(imageUrl, {
            rotate,
            move,
            vertical,
            wideAngle,
            customPrompt: customPrompt.trim() || undefined,
            seed
        });
    };

    const DiscreteSlider: React.FC<{
        label: string;
        values: number[];
        value: number;
        onChange: (val: number) => void;
    }> = ({ label, values, value, onChange }) => {
        const currentIndex = values.indexOf(value);
        const displayIndex = currentIndex === -1 ? 0 : currentIndex;
        
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-n300">
                    <span>{label}</span>
                    <span className="font-semibold text-n800">{value}</span>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="range"
                        min={0}
                        max={values.length - 1}
                        step={1}
                        value={displayIndex}
                        onChange={(e) => onChange(values[Number(e.target.value)])}
                        className="flex-1 accent-primary"
                    />
                </div>
                <div className="flex justify-between text-[9px] text-n100">
                    {values.map((v, i) => (
                        <span key={i} className={value === v ? 'text-primary font-semibold' : ''}>{v}</span>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={isProcessing ? undefined : onClose}>
            <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-4xl space-y-6 overflow-y-auto rounded-2xl border border-n40 bg-n0 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                
                {/* 🆕 Loading覆盖层 - 处理中时显示 */}
                {isProcessing && (
                    <div className="absolute inset-0 bg-n0 backdrop-blur-sm rounded-2xl z-50 flex flex-col items-center justify-center">
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4"></div>
                        </div>
                        <h4 className="text-lg font-bold text-n800 mb-2">正在生成新角度...</h4>
                        <p className="text-sm text-n300 mb-4">请稍候，AI正在重建镜头</p>
                        <div className="flex items-center gap-2 text-xs text-primary">
                            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                            <span>处理中</span>
                        </div>
                    </div>
                )}
                
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-n800">角度调整</h3>
                        <p className="text-xs text-n300 mt-1">基于现有图片重建镜头角度，保持画面一致性。</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800" disabled={isProcessing}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="relative rounded-2xl overflow-hidden border border-n40 h-80 bg-n30 flex items-center justify-center">
                            <img src={imageUrl} loading="lazy" decoding="async" className="w-full h-full object-contain" alt="预览" />
                        </div>
                        <div className="rounded-md border border-n40 bg-n20 p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold text-n700">处理 GPU</span>
                                <button
                                    type="button"
                                    onClick={onRefreshClusterNodes}
                                    disabled={clusterNodesLoading || isProcessing}
                                    className="inline-flex items-center gap-1 text-[10px] text-primary disabled:opacity-50"
                                >
                                    <RefreshCw className={`h-3 w-3 ${clusterNodesLoading ? 'animate-spin' : ''}`} />
                                    刷新
                                </button>
                            </div>
                            <select
                                value={selectedClusterNodeId}
                                onChange={(event) => onSelectClusterNode(event.target.value)}
                                disabled={clusterNodesLoading || clusterNodes.length === 0 || isProcessing}
                                className="h-9 w-full rounded border border-n40 bg-n0 px-2 text-xs text-n700 outline-none focus:border-primary disabled:bg-n20 disabled:text-n100"
                            >
                                {clusterNodes.length === 0 && (
                                    <option value={DEFAULT_GPU_NODE_NAME}>{DEFAULT_GPU_NODE_NAME} · offline</option>
                                )}
                                {clusterNodes.map((node) => (
                                    <option key={node.id} value={node.name} disabled={!isClusterNodeUsable(node)}>
                                        {node.name} · {node.status}
                                        {node.tasks != null && node.maxConcurrent != null ? ` · ${node.tasks}/${node.maxConcurrent}` : ''}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1.5 text-[10px] leading-4 text-n300">
                                输出保持原图比例。所选节点不可用时优先由 GPU1 接管，再由其他在线低负载节点处理。
                                {clusterNodeMessage ? ` ${clusterNodeMessage}` : ''}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-5">
                        <div className="space-y-3 bg-n20 border border-n40 rounded-md p-4">
                            <h4 className="text-xs font-bold text-n300 uppercase">镜头控制</h4>
                            <DiscreteSlider 
                                label="水平旋转 (°)" 
                                values={[-90, -45, 0, 45, 90]} 
                                value={rotate} 
                                onChange={setRotate} 
                            />
                            <DiscreteSlider 
                                label="推进距离" 
                                values={[0, 5, 10]} 
                                value={move} 
                                onChange={setMove} 
                            />
                            <DiscreteSlider 
                                label="垂直角度" 
                                values={[-1, 0, 1]} 
                                value={vertical} 
                                onChange={setVertical} 
                            />
                            <label className="flex items-center gap-2 text-xs text-n700">
                                <input type="checkbox" checked={wideAngle} onChange={(e) => setWideAngle(e.target.checked)} />
                                启用广角透视
                            </label>
                        </div>

                        <div className="space-y-2">
                            <span className="text-[11px] font-bold text-n100 uppercase">自定义提示词 (可覆盖镜头设定)</span>
                            <textarea
                                rows={3}
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                className="w-full bg-n0 border border-n40 rounded-lg text-sm text-n800 p-3 focus:outline-none focus:border-primary resize-none"
                                placeholder="输入更详细的场景描述或留空使用自动提示..."
                            />
                            <div className="flex flex-wrap gap-1 mt-2">
                                {promptExamples.map((example, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setCustomPrompt(example)}
                                        className="text-[10px] px-2 py-1 bg-n0 hover:bg-primary text-n300 hover:text-n800 rounded border border-n40 hover:border-primary transition-colors"
                                    >
                                        {example.split('（')[0]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-n700">
                            <div className="flex items-center gap-2">
                                <span>随机种子</span>
                                <input
                                    type="number"
                                    value={seed}
                                    onChange={(e) => setSeed(Number(e.target.value))}
                                    className="w-32 bg-n0 border border-n40 rounded px-2 py-1 focus:outline-none focus:border-primary"
                                />
                            </div>
                            <button 
                                onClick={() => setSeed(Math.floor(Math.random() * 900000000000000) + 100000000000000)} 
                                className="px-2 py-1 rounded border border-n40 hover:border-primary hover:text-n800 transition-colors"
                            >
                                随机
                            </button>
                        </div>

                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20" disabled={isProcessing}>取消</button>
                    <button 
                        onClick={handleSubmit} 
                        disabled={isProcessing}
                        className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-blue-500 text-xs font-bold text-white shadow-lg shadow-emerald-900/30 hover:shadow-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? '生成中...' : '生成新角度'}
                    </button>
                </div>
            </div>
      </div>
  );
};

// 🆕 Human Multi-Angle Generation Modal Component
interface HumanMultiAngleModalProps {
    imageUrl: string;
    onClose: () => void;
    onSubmit: (imageUrl: string, seed: number) => void;
    isProcessing: boolean;
}

const HumanMultiAngleModal: React.FC<HumanMultiAngleModalProps> = ({ imageUrl, onClose, onSubmit, isProcessing }) => {
    const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000000000000) + 100000000000000);

    const handleSubmit = () => {
        onSubmit(imageUrl, seed);
    };

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={isProcessing ? undefined : onClose}>
            <div className="w-full max-w-2xl bg-n0 border border-n40 rounded-2xl shadow-2xl p-6 space-y-6 relative" onClick={(e) => e.stopPropagation()}>
                
                {/* Loading覆盖层 - 处理中时显示 */}
                {isProcessing && (
                    <div className="absolute inset-0 bg-n0 backdrop-blur-sm rounded-2xl z-50 flex flex-col items-center justify-center">
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4"></div>
                        </div>
                        <h4 className="text-lg font-bold text-n800 mb-2">正在生成多角度人物...</h4>
                        <p className="text-sm text-n300 mb-4">请稍候，AI正在生成多视角图像</p>
                        <div className="flex items-center gap-2 text-xs text-primary">
                            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                            <span>处理中</span>
                        </div>
                    </div>
                )}
                
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-n800">多角度人物生成</h3>
                        <p className="text-xs text-n300 mt-1">基于选中的图片生成多角度人物视图</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800" disabled={isProcessing}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-6">
                    {/* 预览图 */}
                    <div className="relative rounded-2xl overflow-hidden border border-n40 h-64 bg-n30 flex items-center justify-center">
                        <img src={imageUrl} loading="lazy" decoding="async" className="w-full h-full object-contain" alt="选中的图片" />
                    </div>

                    {/* Seed 控制 */}
                    <div className="bg-n20 border border-n40 rounded-md p-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <span className="text-[11px] font-bold text-n300 uppercase">随机种子</span>
                                <input
                                    type="number"
                                    value={seed}
                                    onChange={(e) => setSeed(Number(e.target.value))}
                                    className="w-48 bg-n0 border border-n40 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary text-n800"
                                />
                            </div>
                            <button 
                                onClick={() => setSeed(Math.floor(Math.random() * 900000000000000) + 100000000000000)} 
                                className="px-3 py-1.5 rounded border border-n40 hover:border-primary hover:text-n800 transition-colors text-sm text-n300"
                            >
                                随机
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20" disabled={isProcessing}>取消</button>
                    <button 
                        onClick={handleSubmit} 
                        disabled={isProcessing}
                        className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? '生成中...' : '开始生成'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// 🆕 Around Angle (全景) Generation Modal Component
interface AroundAngleModalProps {
    imageUrl: string;
    onClose: () => void;
    onSubmit: (imageUrl: string, prompt: string, seed: number) => void;
    isProcessing: boolean;
}

const AroundAngleModal: React.FC<AroundAngleModalProps> = ({ imageUrl, onClose, onSubmit, isProcessing }) => {
    const [prompt, setPrompt] = useState('front view, eye level, medium shot');
    const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000000000000) + 100000000000000);
    const [rawValues, setRawValues] = useState({ horizontal: 0, vertical: 0, zoom: 5 });

    // 处理 3D 控制器的更新
    const handleControllerChange = useCallback((newPrompt: string, raw: { horizontal: number; vertical: number; zoom: number }) => {
        setPrompt(newPrompt);
        setRawValues(raw);
    }, []);

    const handleSubmit = () => {
        onSubmit(imageUrl, prompt, seed);
    };

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur-md flex items-center justify-center z-[130] p-6" onClick={isProcessing ? undefined : onClose}>
            <div className="w-full h-full max-w-6xl max-h-[90vh] bg-n0 border border-cyan-500/30 rounded-2xl shadow-2xl flex flex-col relative" onClick={(e) => e.stopPropagation()}>
                
                {/* Loading覆盖层 */}
                {isProcessing && (
                    <div className="absolute inset-0 bg-n0 backdrop-blur-sm rounded-2xl z-50 flex flex-col items-center justify-center">
                        <div className="relative">
                            <div className="w-20 h-20 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mb-4"></div>
                        </div>
                        <h4 className="text-xl font-bold text-n800 mb-2">正在生成全景角度...</h4>
                        <p className="text-sm text-n300 mb-4">请稍候，AI正在生成指定视角图像</p>
                        <div className="flex items-center gap-2 text-sm text-cyan-300">
                            <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div>
                            <span>处理中</span>
                        </div>
                    </div>
                )}
                
                {/* 顶部标题栏 - 包含数值输入 */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-n40 shrink-0">
                    <div className="flex items-center gap-6">
                        <div>
                            <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                                <span className="text-cyan-400">◈</span>
                                全景角度生成
                                <span className="text-xs font-normal text-n100 ml-1">96种组合</span>
                            </h3>
                        </div>
                        
                        {/* 数值输入区域 */}
                        <div className="flex items-center gap-4 ml-4">
                            {/* 水平角度 */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-pink-400 font-medium">水平</span>
                                <input 
                                    type="number" 
                                    value={Math.round(rawValues.horizontal)}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        const clamped = ((val % 360) + 360) % 360;
                                        setRawValues(prev => ({ ...prev, horizontal: clamped }));
                                    }}
                                    className="w-16 px-2 py-1 bg-n0 border border-pink-500/40 rounded text-pink-400 text-sm font-semibold text-center focus:outline-none focus:border-pink-500"
                                    min={0}
                                    max={360}
                                />
                                <span className="text-pink-400 text-xs">°</span>
                            </div>
                            
                            {/* 垂直角度 */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-cyan-400 font-medium">垂直</span>
                                <input 
                                    type="number" 
                                    value={Math.round(rawValues.vertical)}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        const clamped = Math.max(-30, Math.min(90, val));
                                        setRawValues(prev => ({ ...prev, vertical: clamped }));
                                    }}
                                    className="w-16 px-2 py-1 bg-n0 border border-cyan-500/40 rounded text-cyan-400 text-sm font-semibold text-center focus:outline-none focus:border-cyan-500"
                                    min={-30}
                                    max={90}
                                />
                                <span className="text-cyan-400 text-xs">°</span>
                            </div>
                            
                            {/* 缩放 */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-yellow-400 font-medium">距离</span>
                                <input 
                                    type="number" 
                                    value={rawValues.zoom.toFixed(1)}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        const clamped = Math.max(0, Math.min(10, val));
                                        setRawValues(prev => ({ ...prev, zoom: clamped }));
                                    }}
                                    className="w-16 px-2 py-1 bg-n0 border border-yellow-500/40 rounded text-yellow-400 text-sm font-semibold text-center focus:outline-none focus:border-yellow-500"
                                    min={0}
                                    max={10}
                                    step={0.1}
                                />
                            </div>
                            
                            {/* 重置按钮 */}
                            <button 
                                onClick={() => setRawValues({ horizontal: 0, vertical: 0, zoom: 5 })}
                                className="px-2 py-1 text-n300 hover:text-n800 hover:bg-n20 rounded transition-colors text-sm"
                                title="重置角度"
                            >
                                ↺
                            </button>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800 p-2" disabled={isProcessing}>
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* 3D 控制器 - 占据主要空间 */}
                <div className="flex-1 min-h-0 p-4">
                    <React.Suspense fallback={
                        <div className="w-full h-full min-h-[320px] rounded-lg border border-n40 bg-n20 flex items-center justify-center text-sm text-n300">
                            加载 3D 控制器...
                        </div>
                    }>
                        <MultiAngle3DController
                            imageUrl={imageUrl}
                            onChange={handleControllerChange}
                            initialValues={rawValues}
                        />
                    </React.Suspense>
                </div>
                
                {/* 底部工具栏 */}
                <div className="flex items-center gap-4 px-6 py-4 border-t border-n40 bg-n20 shrink-0">
                    {/* 提示词显示 */}
                    <div className="flex-1">
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="w-full bg-n0 border border-n40 rounded-lg px-4 py-3 text-base focus:outline-none focus:border-cyan-500 text-cyan-300 font-mono"
                            placeholder="角度提示词（由上方控制器自动生成）"
                        />
                    </div>
                    
                    {/* 种子 */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-n100">种子:</span>
                        <input
                            type="number"
                            value={seed}
                            onChange={(e) => setSeed(Number(e.target.value))}
                            className="w-40 bg-n0 border border-n40 rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-cyan-500 text-n800"
                        />
                        <button 
                            onClick={() => setSeed(Math.floor(Math.random() * 900000000000000) + 100000000000000)} 
                            className="px-3 py-3 rounded-lg border border-n40 hover:border-cyan-500 hover:bg-n20 transition-colors text-lg"
                            title="随机种子"
                        >
                            🎲
                        </button>
                    </div>
                    
                    {/* 按钮 */}
                    <button onClick={onClose} className="px-6 py-3 rounded-lg border border-n40 text-sm text-n700 hover:bg-n20 transition-colors" disabled={isProcessing}>
                        取消
                    </button>
                    <button 
                        onClick={handleSubmit} 
                        disabled={isProcessing}
                        className="px-8 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-sm font-bold text-white shadow-lg shadow-cyan-900/30 hover:shadow-cyan-900/50 hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? '生成中...' : '🚀 开始生成'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// 🆕 Image Editor Modal Component
interface ImageEditorModalProps {
    imageUrl: string;
    referenceId: string;
    onClose: () => void;
    onSave: (editedImageUrl: string, referenceId: string) => void;
    onAddSketch: (sketchImageUrl: string) => void;
}

type EditorTool = 'brush' | 'text' | 'arrow' | 'eraser';
type EditorMode = 'edit' | 'sketch';

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({ 
    imageUrl, 
    referenceId, 
    onClose, 
    onSave, 
    onAddSketch 
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sketchCanvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tool, setTool] = useState<EditorTool>('brush');
    const [mode, setMode] = useState<EditorMode>('edit');
    const [brushColor, setBrushColor] = useState('#ff0000');
    const [brushSize, setBrushSize] = useState(3);
    const [textInput, setTextInput] = useState('');
    const [textPosition, setTextPosition] = useState<{x: number, y: number} | null>(null);
    const [arrowStart, setArrowStart] = useState<{x: number, y: number} | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const lastPosRef = useRef<{x: number, y: number} | null>(null);

    // 加载图片到画布
    useEffect(() => {
        const canvas = canvasRef.current;
        const sketchCanvas = sketchCanvasRef.current;
        if (!canvas || !sketchCanvas) return;

        const ctx = canvas.getContext('2d');
        const sketchCtx = sketchCanvas.getContext('2d');
        if (!ctx || !sketchCtx) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            // 设置画布大小
            const maxWidth = 800;
            const maxHeight = 600;
            let width = img.width;
            let height = img.height;
            
            if (width > maxWidth) {
                height = (maxWidth / width) * height;
                width = maxWidth;
            }
            if (height > maxHeight) {
                width = (maxHeight / height) * width;
                height = maxHeight;
            }

            canvas.width = width;
            canvas.height = height;
            sketchCanvas.width = width;
            sketchCanvas.height = height;

            // 绘制图片到编辑画布
            ctx.drawImage(img, 0, 0, width, height);
            
            // 线稿画布：白色背景 + 半透明图片参考
            sketchCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            sketchCtx.fillRect(0, 0, width, height);
            sketchCtx.globalAlpha = 0.15;
            sketchCtx.drawImage(img, 0, 0, width, height);
            sketchCtx.globalAlpha = 1.0;

            setImageLoaded(true);
        };
        img.src = imageUrl;
    }, [imageUrl]);

    const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // 🔧 直接使用事件的目标画布，而不是通过 mode 判断
        const canvas = e.currentTarget;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        
        // 🔧 计算画布实际尺寸与显示尺寸的缩放比例
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const coords = getCanvasCoords(e);
        
        if (tool === 'text') {
            setTextPosition(coords);
            return;
        }
        
        if (tool === 'arrow') {
            setArrowStart(coords);
            return;
        }
        
        setIsDrawing(true);
        lastPosRef.current = coords;
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        
        // 🔧 直接使用事件的目标画布
        const canvas = e.currentTarget;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const coords = getCanvasCoords(e);
        const lastPos = lastPosRef.current;
        
        if (!lastPos) {
            lastPosRef.current = coords;
            return;
        }

        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(coords.x, coords.y);
        
        if (tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
            ctx.lineWidth = brushSize * 3;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = mode === 'sketch' ? '#000000' : brushColor;
            ctx.lineWidth = brushSize;
        }
        
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        lastPosRef.current = coords;
    };

    const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (tool === 'arrow' && arrowStart) {
            // 🔧 直接使用事件的目标画布
            const canvas = e.currentTarget;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    const coords = getCanvasCoords(e);
                    drawArrow(ctx, arrowStart.x, arrowStart.y, coords.x, coords.y);
                }
            }
            setArrowStart(null);
        }
        setIsDrawing(false);
        lastPosRef.current = null;
    };

    const drawArrow = (ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number) => {
        const headLen = 15;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const angle = Math.atan2(dy, dx);

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.strokeStyle = mode === 'sketch' ? '#000000' : brushColor;
        ctx.lineWidth = brushSize;
        ctx.stroke();

        // 箭头头部
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    };

    const handleAddText = () => {
        if (!textPosition || !textInput.trim()) return;
        
        const canvas = mode === 'edit' ? canvasRef.current : sketchCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.font = `${brushSize * 6}px Arial`;
        ctx.fillStyle = mode === 'sketch' ? '#000000' : brushColor;
        ctx.fillText(textInput, textPosition.x, textPosition.y);
        
        setTextInput('');
        setTextPosition(null);
    };

    const handleSaveEdit = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dataUrl = canvas.toDataURL('image/png');
        onSave(dataUrl, referenceId);
    };

    const handleAddSketchAsRef = () => {
        const canvas = sketchCanvasRef.current;
        if (!canvas) return;
        
        // 创建纯白底黑线的线稿
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;
        
        // 白色背景
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // 复制线稿（需要提取黑色线条）
        tempCtx.drawImage(canvas, 0, 0);
        
        const dataUrl = tempCanvas.toDataURL('image/png');
        onAddSketch(dataUrl);
    };

    const handleReset = () => {
        const canvas = mode === 'edit' ? canvasRef.current : sketchCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (mode === 'edit') {
            // 重新加载原图
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = imageUrl;
        } else {
            // 重置线稿画布
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = 0.15;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = 1.0;
            };
            img.src = imageUrl;
        }
    };

    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#000000'];

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[140]" onClick={onClose}>
            <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-2xl shadow-2xl p-6 relative" onClick={(e) => e.stopPropagation()}>
                
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-n800">图片编辑器</h3>
                        <p className="text-xs text-n300">画笔涂鸦、添加文字和箭头标注</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Mode Tabs */}
                <div className="flex gap-2 mb-4">
                    <button
                        onClick={() => setMode('edit')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                            mode === 'edit' 
                                ? 'bg-primary text-white' 
                                : 'bg-n0 text-n300 hover:bg-n20'
                        }`}
                    >
                        <Pencil className="w-4 h-4" />
                        编辑底图
                    </button>
                    <button
                        onClick={() => setMode('sketch')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                            mode === 'sketch' 
                                ? 'bg-blue-500 text-white' 
                                : 'bg-n0 text-n300 hover:bg-n20'
                        }`}
                    >
                        <Layers className="w-4 h-4" />
                        绘制线稿
                    </button>
                </div>

                <div className="grid grid-cols-[1fr_200px] gap-4">
                    {/* Canvas Area */}
                    <div className="relative bg-n20 rounded-md overflow-hidden flex items-center justify-center min-h-[400px]">
                        {!imageLoaded && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        )}
                        <canvas
                            ref={canvasRef}
                            className={`max-w-full max-h-[500px] cursor-crosshair ${mode === 'edit' ? 'block' : 'hidden'}`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        />
                        <canvas
                            ref={sketchCanvasRef}
                            className={`max-w-full max-h-[500px] cursor-crosshair ${mode === 'sketch' ? 'block' : 'hidden'}`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        />
                    </div>

                    {/* Tools Panel */}
                    <div className="bg-n20 rounded-md p-4 space-y-4">
                        <div>
                            <span className="text-[10px] font-bold text-n300 uppercase block mb-2">工具</span>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setTool('brush')}
                                    className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${
                                        tool === 'brush' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:bg-n20'
                                    }`}
                                >
                                    <Pencil className="w-4 h-4" />
                                    <span className="text-[9px]">画笔</span>
                                </button>
                                <button
                                    onClick={() => setTool('text')}
                                    className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${
                                        tool === 'text' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:bg-n20'
                                    }`}
                                >
                                    <Type className="w-4 h-4" />
                                    <span className="text-[9px]">文字</span>
                                </button>
                                <button
                                    onClick={() => setTool('arrow')}
                                    className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${
                                        tool === 'arrow' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:bg-n20'
                                    }`}
                                >
                                    <MoveRight className="w-4 h-4" />
                                    <span className="text-[9px]">箭头</span>
                                </button>
                                <button
                                    onClick={() => setTool('eraser')}
                                    className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${
                                        tool === 'eraser' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:bg-n20'
                                    }`}
                                >
                                    <Eraser className="w-4 h-4" />
                                    <span className="text-[9px]">橡皮</span>
                                </button>
                            </div>
                        </div>

                        {mode === 'edit' && (
                            <div>
                                <span className="text-[10px] font-bold text-n300 uppercase block mb-2">颜色</span>
                                <div className="grid grid-cols-4 gap-1">
                                    {colors.map(color => (
                                        <button
                                            key={color}
                                            onClick={() => setBrushColor(color)}
                                            className={`w-8 h-8 rounded-lg border-2 transition-all ${
                                                brushColor === color ? 'border-white scale-110' : 'border-transparent'
                                            }`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <span className="text-[10px] font-bold text-n300 uppercase block mb-2">
                                笔刷大小: {brushSize}px
                            </span>
                            <input
                                type="range"
                                min="1"
                                max="20"
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="w-full accent-primary"
                            />
                        </div>

                        {tool === 'text' && textPosition && (
                            <div>
                                <span className="text-[10px] font-bold text-n300 uppercase block mb-2">输入文字</span>
                                <input
                                    type="text"
                                    value={textInput}
                                    onChange={(e) => setTextInput(e.target.value)}
                                    className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs text-n800 mb-2"
                                    placeholder="输入文字..."
                                    autoFocus
                                />
                                <button
                                    onClick={handleAddText}
                                    className="w-full py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-bold"
                                >
                                    添加文字
                                </button>
                            </div>
                        )}

                        <button
                            onClick={handleReset}
                            className="w-full py-2 bg-n0 hover:bg-n20 text-n700 rounded-lg text-xs font-bold flex items-center justify-center gap-2"
                        >
                            <RotateCcw className="w-3 h-3" />
                            重置
                        </button>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-n40">
                    <p className="text-[10px] text-n100">
                        {mode === 'edit' ? '编辑模式：修改会改变底图' : '线稿模式：在透明层上绘制，生成白底黑线参考图'}
                    </p>
                    <div className="flex gap-3">
                        <button 
                            onClick={onClose} 
                            className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20"
                        >
                            取消
                        </button>
                        {mode === 'sketch' && (
                            <button 
                                onClick={handleAddSketchAsRef}
                                className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-xs font-bold text-white flex items-center gap-2"
                            >
                                <Layers className="w-3 h-3" />
                                添加为参考图
                            </button>
                        )}
                        {mode === 'edit' && (
                            <button 
                                onClick={handleSaveEdit}
                                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white flex items-center gap-2"
                            >
                                <Save className="w-3 h-3" />
                                保存修改
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
