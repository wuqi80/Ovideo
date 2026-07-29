

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { ProjectFile, StoryboardItem, MaterialLibrary, Material, FileVersion } from '../types';
import { LayoutDashboard, Users, MapPin, Plus, Image as ImageIcon, Sparkles, Trash2, ChevronRight, ChevronDown, ChevronUp, Upload, AlertCircle, Film, Check, Lock, CheckCircle, Save, History, RefreshCw, X, Clock, Database, GripVertical, Camera, ZoomIn, Layers, Box, ShieldCheck, Maximize, Scissors } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { generateGeminiImageVariant } from '../services/geminiImageGenerationService';
import { adjustImageAngle } from '../services/comfyuiGenerationService';
import { waitForComfyUITaskAllImages } from '../services/comfyuiTaskWaitService';
import { generateDoubaoImages, GeneratedFileResult } from '../services/doubaoService';
import { generateThumbnail } from '../utils/imageOptimization';
import { apiBlob, secureApiUrl } from '../services/httpClient';
import { GpuNodeSelector, type GpuNodeSelection } from './GpuNodeSelector';
import {
  standardTurnaroundAspectRatio,
  standardTurnaroundLabel,
  supportsStandardTurnaround,
  withStandardTurnaround,
} from '../utils/assetGenerationStandards';
import { recommendDoubaoImageSize } from '../utils/doubaoImageSize';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
import { deleteEntityFile, uploadEntityFile } from '../services/entityFileService';

type MaterialAIEngine = 'nanobanana' | 'doubao';
type BindingAssetType = 'character' | 'scene' | 'prop';

type MaterialAIGenerationPayload = {
  tagName: string;
  engine: MaterialAIEngine;
  geminiModel: string;
  prompt: string;
  references: string[];
  aspectRatio: string;
  resolution: '1K' | '2K' | '4K';
  sequential: 'disabled' | 'auto';
  count: number;
};

type MaterialAIModalConfig = {
  tagName: string;
  type: BindingAssetType;
  defaultPrompt: string;
  materials: Material[];
};

type CameraGenerationPayload = {
  tagName: string;
  imageUrl: string;
  rotate: number;
  move: number;
  vertical: number;
  wideAngle: boolean;
  customPrompt?: string;
  seed: number;
  gpu: GpuNodeSelection;
};

type CameraModalConfig = {
  tagName: string;
  type: BindingAssetType;
  materials: Material[];
  selectedMaterialId: string;
};

type ProcessModalConfig = {
  tagName: string;
  type: BindingAssetType;
  materials: Material[];
  selectedMaterialId: string;
  workflow: 'upscale_hd' | 'remove_watermark';
};

type ThreeViewModalConfig = {
  tagName: string;
  type: BindingAssetType;
  materials: Material[];
  selectedMaterialId: string;
};

const randomSeed = () => Math.floor(Math.random() * 900000000000000) + 100000000000000;
const MATERIAL_INITIAL_SHOT_COUNT = 20;
const MATERIAL_SHOT_PAGE_SIZE = 20;

function normalizeDownloadUrl(url: string): string {
  if (url.startsWith('blob:')) return url;
  const normalized = url.startsWith('http') ? url : (url.startsWith('/') ? url : `/${url}`);
  return secureApiUrl(normalized, { absolute: true });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function downloadImageAsDataUrl(url: string): Promise<string> {
  const downloadUrl = normalizeDownloadUrl(url);
  const blob = await apiBlob(downloadUrl, { method: 'GET' }, '下载生成的图片', {
    requireAuth: false,
    includeContentType: false,
  });
  return blobToDataUrl(blob);
}

async function ensureDataUrl(input: string | undefined | null): Promise<string> {
  // 🔧 参数验证
  if (!input || typeof input !== 'string') {
    throw new Error('图片URL无效');
  }
  
  if (input.startsWith('data:')) {
    return input;
  }
  return downloadImageAsDataUrl(input);
}

async function prepareReferenceData(refs: string[]): Promise<string[]> {
  return refs.filter(r => r && r.trim() !== '');
}

function buildCameraPrompt(payload: CameraGenerationPayload, shot: StoryboardItem, tagName: string) {
  // 如果用户自己写了提示词,直接使用
  if (payload.customPrompt?.trim()) {
      return payload.customPrompt.trim();
  }
  
  // 否则根据滑块参数拼接提示词
  const prompts: string[] = [];
  
  // 水平旋转
  if (payload.rotate === -90) {
      prompts.push("将镜头向左旋转90度 Rotate the camera 90 degrees to the left.");
  } else if (payload.rotate === -45) {
      prompts.push("将镜头向左旋转45度 Rotate the camera 45 degrees to the left.");
  } else if (payload.rotate === 45) {
      prompts.push("将镜头向右旋转45度 Rotate the camera 45 degrees to the right.");
  } else if (payload.rotate === 90) {
      prompts.push("将镜头向右旋转90度 Rotate the camera 90 degrees to the right.");
  }
  
  // 推进距离
  if (payload.move === 5) {
      prompts.push("将镜头向前移动 Move the camera forward.");
  } else if (payload.move === 10) {
      prompts.push("将镜头转为特写镜头 Turn the camera into a close-up shot.");
  }
  
  // 垂直角度
  if (payload.vertical === 1) {
      prompts.push("将相机切换到仰视视角 Turn the camera to a worm's-eye view.");
  } else if (payload.vertical === -1) {
      prompts.push("将相机转向鸟瞰视角 Turn the camera to a bird's-eye view.");
  }
  
  // 广角镜头
  if (payload.wideAngle) {
      prompts.push("将镜头转为广角镜头 Turn the camera to a wide-angle lens.");
  }
  
  const result = prompts.join(' ');
  return result || "保持当前画面构图和内容。";
}

interface MaterialPageProps {
  files: ProjectFile[];
  selectedFileId: string | null;
  materialLibrary: MaterialLibrary;
  onUpdateLibrary: (newLibrary: MaterialLibrary) => void | Promise<void>;
  onBindMaterial: (shotId: string, tagName: string, materialId: string) => void;
  isMaterialFullySynced?: (shotId: string, tagName: string, materialId: string) => boolean;
  onUnbindMaterial: (shotId: string, tagName: string) => void;
  onNextStep: () => void;
  onSaveVersion: (name: string) => void;
  onRestoreVersion: (version: FileVersion) => void;
  onDeleteVersion: (versionId: string) => void;
  onImportProject: () => void;
  /** 为 true 时隐藏本地版本存档（保存/历史/恢复等） */
  hideVersionArchive?: boolean;
  onAppendStoryboard?: (sourceFileIds: string[]) => void;  // 🆕 追加其他文件的分镜（支持多选）
  onRemoveAppendedStoryboard?: (sourceFileId?: string) => void;  // 🆕 移除追加的分镜
  /** tagName → assetId lookup for entity-aware AI generation */
  assetNameToId?: Record<string, string>;
  assetScopeMode?: 'episode' | 'project';
  onAssetScopeModeChange?: (mode: 'episode' | 'project') => void;
}

export const MaterialPage: React.FC<MaterialPageProps> = ({
  files,
  selectedFileId,
  materialLibrary,
  onUpdateLibrary,
  onBindMaterial,
  isMaterialFullySynced,
  onUnbindMaterial,
  onNextStep,
  onSaveVersion,
  onRestoreVersion,
  onDeleteVersion,
  onImportProject,
  hideVersionArchive = false,
  onAppendStoryboard,
  onRemoveAppendedStoryboard,
  assetNameToId,
  assetScopeMode = 'episode',
  onAssetScopeModeChange,
}) => {
  const selectedFile = files.find(f => f.id === selectedFileId);
  const storyboardItems = selectedFile?.storyboard?.items || [];
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [visibleShotCount, setVisibleShotCount] = useState(MATERIAL_INITIAL_SHOT_COUNT);
  const [aiGeneratingTag, setAIGeneratingTag] = useState<string | null>(null);
  const [cameraGeneratingTag, setCameraGeneratingTag] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  
  // 🆕 追加分镜弹窗状态
  const [showAppendModal, setShowAppendModal] = useState(false);
  const [selectedAppendFileIds, setSelectedAppendFileIds] = useState<Set<string>>(new Set());

  // Version Control State
  const [showHistory, setShowHistory] = useState(false);
  const [isNamingVersion, setIsNamingVersion] = useState(false);
  const [versionName, setVersionName] = useState('');

  // Resizable Sidebar State
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [isContextExpanded, setIsContextExpanded] = usePersistedPageState<boolean>({
    page: 'MaterialPage:shotContext',
    episodeId: selectedFileId,
    version: 1,
    defaultValue: false,
  });

  const storyboardIdSignature = useMemo(
    () => storyboardItems.map(item => item.id).join('|'),
    [storyboardItems],
  );
  const visibleStoryboardItems = useMemo(
    () => storyboardItems.slice(0, visibleShotCount),
    [storyboardItems, visibleShotCount],
  );
  const hasMoreStoryboardItems = visibleShotCount < storyboardItems.length;

  useEffect(() => {
    setVisibleShotCount(MATERIAL_INITIAL_SHOT_COUNT);
  }, [storyboardIdSignature]);

  useEffect(() => {
    setSelectedShotId(currentId => {
      if (currentId && storyboardItems.some(item => item.id === currentId)) {
        return currentId;
      }
      return storyboardItems[0]?.id ?? null;
    });
  }, [selectedFile?.id, storyboardIdSignature]);

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

  // 🆕 自动为素材库中的图片生成缩略图
  const [materialThumbnailProcessed, setMaterialThumbnailProcessed] = useState<Set<string>>(new Set());
  
  useEffect(() => {
    if (!materialLibrary) return;
    
    Object.entries(materialLibrary).forEach(([tagName, materials]) => {
      materials.forEach(async (material) => {
        // 跳过已处理的素材
        if (materialThumbnailProcessed.has(material.id)) return;
        
        // 如果已经有缩略图，跳过
        if (material.thumbnail) {
          setMaterialThumbnailProcessed(prev => new Set(prev).add(material.id));
          return;
        }
        
        // 生成缩略图
        try {
          console.log(`🔄 素材 ${tagName}/${material.id}: 生成缩略图...`);
          setMaterialThumbnailProcessed(prev => new Set(prev).add(material.id));
          
          const thumbnail = await generateThumbnail(material.url, 1024, 0.8);
          
          // 更新素材库
          onUpdateLibrary({
            ...materialLibrary,
            [tagName]: materials.map(m => 
              m.id === material.id ? { ...m, thumbnail } : m
            )
          });
          
          console.log(`✅ 素材 ${tagName}/${material.id}: 缩略图已生成并保存`);
        } catch (error) {
          console.error('生成素材缩略图失败:', error);
        }
      });
    });
  }, [materialLibrary, onUpdateLibrary]);

  const [aiModalConfig, setAiModalConfig] = useState<MaterialAIModalConfig | null>(null);
  const [cameraModalConfig, setCameraModalConfig] = useState<CameraModalConfig | null>(null);
  const [processModalConfig, setProcessModalConfig] = useState<ProcessModalConfig | null>(null);
  const [threeViewModalConfig, setThreeViewModalConfig] = useState<ThreeViewModalConfig | null>(null);

  // Helper to render History Panel
  const renderHistoryPanel = () => (
    <div className="absolute top-[52px] right-0 bottom-0 w-80 bg-n0 border-l border-n40 z-40 flex flex-col shadow-bottom animate-in slide-in-from-right duration-200">
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
                                className="flex-1 py-1.5 bg-primary-light hover:bg-primary border border-primary/30 rounded text-[10px] text-primary hover:text-white transition-colors flex items-center justify-center gap-1 group-hover:border-primary"
                            >
                                <RefreshCw className="w-3 h-3" />
                                恢复此版本
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

  // Ensure selectedShotId is valid
  const effectiveSelectedShotId = hasStoryboard 
    ? (selectedShotId || selectedFile!.storyboard!.items[0]?.id)
    : null;
  const selectedShot = hasStoryboard && selectedFile
    ? (selectedFile.storyboard!.items.find(i => i.id === effectiveSelectedShotId) || selectedFile.storyboard!.items[0])
    : null;

  const getNextMaterialId = (tagName: string, offset = 0, fallback?: string | null) => {
    const targetAssetId = assetNameToId?.[tagName];
    const existing = materialLibrary[tagName] || [];
    return targetAssetId ? `${targetAssetId}_${existing.length + offset}` : (fallback || uuidv4());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, tagName: string, type: BindingAssetType) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const targetAssetId = assetNameToId?.[tagName];
        const saved = await uploadEntityFile(
          file,
          targetAssetId ? 'asset' : 'storyboard_item',
          targetAssetId || selectedShot?.id || 'temp',
          'material_image',
          selectedFileId || undefined,
        );
        const newId = getNextMaterialId(tagName, 0, saved.fileId);
        const newMaterial: Material = {
          id: newId,
          url: saved.fileUrl,
          thumbnail: saved.fileUrl,
          type: 'image',
          source: 'upload',
          timestamp: Date.now(),
          fileId: saved.fileId,
        };
        const existing = materialLibrary[tagName] || [];
        await onUpdateLibrary({
          ...materialLibrary,
          [tagName]: [...existing, newMaterial]
        });
        if (selectedShot) {
          onBindMaterial(selectedShot.id, tagName, newId);
        }
      } catch (err) {
        console.error('素材上传失败:', err);
      }
    }
  };

  const openAIGenerator = (tagName: string, type: BindingAssetType) => {
    if (!selectedShot) return;
    const context = selectedShot.imagePrompt || selectedShot.scriptSegment || '';
    setAiModalConfig({
        tagName,
        type,
        defaultPrompt: context ? `${tagName}。${context}` : tagName,
        materials: materialLibrary[tagName] || []
    });
  };

  const handleMaterialAIGeneration = async (payload: MaterialAIGenerationPayload) => {
    if (!selectedShot) return;
    setAiModalConfig(null);
    setAIGeneratingTag(payload.tagName);
    try {
        const references = await prepareReferenceData(payload.references);
        const targetAssetId = assetNameToId?.[payload.tagName];
        const entityOpts = {
            entityType: 'asset' as const,
            entityId: targetAssetId,
            fileRole: 'material_image' as const,
            episodeId: selectedFileId || undefined,
        };
        let results: GeneratedFileResult[] = [];
        if (payload.engine === 'nanobanana') {
            results = await generateGeminiImageVariant({
                model: payload.geminiModel,
                prompt: payload.prompt,
                references,
                aspectRatio: payload.aspectRatio,
                imageSize: payload.resolution,
                ...entityOpts,
            });
        } else {
            results = await generateDoubaoImages({
                prompt: payload.prompt,
                references,
                size: recommendDoubaoImageSize(payload.aspectRatio, payload.resolution),
                sequential: payload.sequential,
                count: payload.count,
                ...entityOpts,
            });
        }

        if (!results.length) throw new Error('未返回图片');
        
        const existing = materialLibrary[payload.tagName] || [];
        const newMaterials: Material[] = results.map((r, index) => ({
            id: getNextMaterialId(payload.tagName, index, r.fileId),
            url: r.url,
            type: 'image',
            source: 'ai',
            timestamp: Date.now(),
            fileId: r.fileId,
        }));

        await onUpdateLibrary({
            ...materialLibrary,
            [payload.tagName]: [...existing, ...newMaterials]
        });

        onBindMaterial(selectedShot.id, payload.tagName, newMaterials[0].id);
    } catch (error: any) {
        console.error('Material AI generation failed', error);
        alert(error?.message || '生成失败，请稍后再试。');
    } finally {
        setAIGeneratingTag(null);
    }
  };

  const openProcessModal = (tagName: string, type: BindingAssetType, workflow: 'upscale_hd' | 'remove_watermark' | 'three_view') => {
    const library = materialLibrary[tagName] || [];
    if (library.length === 0) {
      alert('请先上传或生成至少一张素材。');
      return;
    }

    const boundId = selectedShot?.materialSelections?.[tagName];
    const selectedMaterialId = boundId && library.find(m => m.id === boundId) 
      ? boundId 
      : library[0]?.id || '';

    // 如果是三视图，打开专门的三视图Modal
    if (workflow === 'three_view') {
      setThreeViewModalConfig({
        tagName,
        type,
        materials: library,
        selectedMaterialId
      });
      return;
    }

    setProcessModalConfig({
      tagName,
      type,
      materials: library,
      selectedMaterialId,
      workflow: workflow as 'upscale_hd' | 'remove_watermark'
    });
  };

  const openCameraModal = (tagName: string, type: BindingAssetType) => {
    if (!selectedShot) return;
    const library = materialLibrary[tagName] || [];
    if (library.length === 0) {
        alert('请先上传或生成至少一张素材再进行角度调整。');
        return;
    }
    const boundId = selectedShot?.materialSelections?.[tagName];
    const defaultId = boundId && library.find(m => m.id === boundId) ? boundId : library[0].id;
    setCameraModalConfig({
        tagName,
        type,
        materials: library,
        selectedMaterialId: defaultId
    });
  };

  const handleProcessMaterial = async (materialId: string, gpu: GpuNodeSelection) => {
    if (!processModalConfig) return;
    
    const { tagName, materials, workflow } = processModalConfig;
    const targetMaterial = materials.find(m => m.id === materialId);

    if (!targetMaterial) {
        alert('未找到可处理的素材。');
        return;
    }

    setProcessModalConfig(null); // 关闭弹窗

    try {
        setCameraGeneratingTag(tagName);
        
        const targetAssetId = assetNameToId?.[tagName];
        const { processMaterialImage } = await import('../services/comfyuiGenerationService');
        const { taskId } = await processMaterialImage(
            targetMaterial.url,
            workflow,
            {
                entityType: targetAssetId ? 'asset' : undefined,
                entityId: targetAssetId,
                fileRole: targetAssetId ? 'material_image' : undefined,
                episodeId: selectedFileId || undefined,
                preferredAgentId: gpu.preferredAgentId,
                preferredNodeId: gpu.preferredNodeId,
            },
        );
        const results = await waitForComfyUITaskAllImages(taskId, undefined, {
            title: `${workflow === 'upscale_hd' ? '高清放大' : '去水印'} · ${tagName}`,
            kind: workflow === 'upscale_hd' ? 'video-upscale' : 'matting',
            targetPage: 'materials',
            targetEntityType: targetAssetId ? 'asset' : undefined,
            targetEntityId: targetAssetId,
            targetItemId: targetAssetId,
            episodeId: selectedFileId || undefined,
            fileRole: targetAssetId ? 'material_image' : undefined,
        });
        const resultUrl = results[0]?.url;
        if (!resultUrl) {
            throw new Error('处理完成但未返回图片');
        }

        const existing = materialLibrary[tagName] || [];
        const newMaterialId = getNextMaterialId(tagName, 0, results[0]?.fileId);
        const newMaterial: Material = {
            id: newMaterialId,
            url: resultUrl,
            type: 'image',
            source: 'ai',
            timestamp: Date.now(),
            fileId: results[0]?.fileId,
        };

        await onUpdateLibrary({
            ...materialLibrary,
            [tagName]: [...existing, newMaterial]
        });

        const workflowNames = {
            'upscale_hd': '高清放大',
            'remove_watermark': '去水印'
        };
        
        alert(`${workflowNames[workflow]}完成！`);
    } catch (error: any) {
        console.error('Material processing failed', error);
        alert(error?.message || '处理失败，请稍后再试。');
    } finally {
        setCameraGeneratingTag(null);
    }
  };

  const handleThreeViewGenerate = async (materialId: string, prompt: string) => {
    if (!threeViewModalConfig) return;
    
    const { tagName, materials, type } = threeViewModalConfig;
    const targetMaterial = materials.find(m => m.id === materialId);

    if (!targetMaterial) {
        alert('未找到可处理的素材。');
        return;
    }
    
    // 🔧 调试日志：检查素材数据
    console.log('🔍 三视图生成 - 目标素材:', {
        id: targetMaterial.id,
        url: targetMaterial.url,
        urlType: typeof targetMaterial.url,
        urlLength: targetMaterial.url?.length
    });
    
    // 🔧 验证 URL 有效性
    if (!targetMaterial.url || typeof targetMaterial.url !== 'string' || targetMaterial.url.trim() === '') {
        alert(`素材URL无效，请重新上传图片。\n素材ID: ${targetMaterial.id}`);
        return;
    }

    setThreeViewModalConfig(null); // 关闭弹窗

    try {
        setAIGeneratingTag(tagName);
        
        const targetAssetId = assetNameToId?.[tagName];
        const { generateGeminiImageVariant } = await import('../services/geminiImageGenerationService');
        const results = await generateGeminiImageVariant({
            prompt: withStandardTurnaround(prompt, type),
            references: [targetMaterial.url],
            model: 'gemini-2.5-flash-image',
            aspectRatio: '16:9',
            entityType: 'asset',
            entityId: targetAssetId,
            fileRole: 'material_image',
            episodeId: selectedFileId || undefined,
        });
        
        if (!results || results.length === 0) {
            throw new Error('未生成图片');
        }
        
        const imageUrl = results[0].url;

        const existing = materialLibrary[tagName] || [];
        const newMaterialId = getNextMaterialId(tagName, 0, results[0].fileId);
        const newMaterial: Material = {
            id: newMaterialId,
            url: imageUrl,
            type: 'image',
            source: 'ai',
            timestamp: Date.now(),
            fileId: results[0].fileId,
        };

        await onUpdateLibrary({
            ...materialLibrary,
            [tagName]: [...existing, newMaterial]
        });

        alert(`${standardTurnaroundLabel(type)}生成完成！`);
    } catch (error: any) {
        console.error('Three-view generation failed', error);
        alert(error?.message || '生成失败，请稍后再试。');
    } finally {
        setAIGeneratingTag(null);
    }
  };

  const handleCameraGenerate = async (payload: CameraGenerationPayload) => {
    if (!selectedShot) return;
    setCameraModalConfig(null);
    setCameraGeneratingTag(payload.tagName);
    try {
        const prompt = payload.customPrompt?.trim().length
            ? payload.customPrompt.trim()
            : buildCameraPrompt(payload, selectedShot, payload.tagName);

        const targetAssetId = assetNameToId?.[payload.tagName];
        const { taskId } = await adjustImageAngle(
            payload.imageUrl,
            prompt,
            payload.seed,
            {
                entityType: 'asset',
                entityId: targetAssetId,
                fileRole: 'material_image',
                episodeId: selectedFileId || undefined,
                preferredAgentId: payload.gpu.preferredAgentId,
                preferredNodeId: payload.gpu.preferredNodeId,
            }
        );
        const results = await waitForComfyUITaskAllImages(taskId, undefined, {
            title: `角度调整 · ${payload.tagName}`,
            kind: 'angle-adjust',
            targetPage: 'materials',
            targetEntityType: 'asset',
            targetEntityId: targetAssetId,
            targetItemId: targetAssetId,
            episodeId: selectedFileId || undefined,
            fileRole: 'material_image',
        });
        const resultUrl = results[0]?.url;
        if (!resultUrl) {
            throw new Error('角度调整未返回图片');
        }

        const existing = materialLibrary[payload.tagName] || [];
        const newMaterialId = getNextMaterialId(payload.tagName, 0, results[0]?.fileId);
        const newMaterial: Material = {
            id: newMaterialId,
            url: resultUrl,
            type: 'image',
            source: 'ai',
            timestamp: Date.now(),
            fileId: results[0]?.fileId,
        };

        await onUpdateLibrary({
            ...materialLibrary,
            [payload.tagName]: [...existing, newMaterial]
        });
        onBindMaterial(selectedShot.id, payload.tagName, newMaterialId);

    } catch (error:any) {
        console.error('Camera adjust failed', error);
        alert(error?.message || '角度调整失败，请重试。');
    } finally {
        setCameraGeneratingTag(null);
    }
  };

  const removeMaterialFromLibrary = async (tagName: string, materialId: string) => {
      const existing = materialLibrary[tagName] || [];
      const targetMaterial = existing.find(material => material.id === materialId);
      if (!targetMaterial) return;

      const isMaterialStageImage = (
        targetMaterial.source === 'entity_file:material_image'
        || targetMaterial.source === 'ai'
        || targetMaterial.source === 'upload'
      );
      if (!isMaterialStageImage) {
        alert('\u8bbe\u8ba1\u9636\u6bb5\u7684\u539f\u59cb\u56fe\u7247\u8bf7\u5728\u8bbe\u8ba1\u9875\u7ba1\u7406\uff0c\u7d20\u6750\u9875\u53ea\u5220\u9664\u672c\u9636\u6bb5\u65b0\u589e\u7684\u56fe\u7247\u3002');
        return;
      }
      if (!targetMaterial.fileId) {
        alert('\u8be5\u56fe\u7247\u5c1a\u672a\u5b8c\u6210\u6301\u4e45\u5316\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002');
        return;
      }

      try {
        await deleteEntityFile(targetMaterial.fileId);
      } catch (error) {
        console.error('Failed to delete material-stage image:', error);
        alert('\u5220\u9664\u7d20\u6750\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002');
        return;
      }

      const updated = existing.filter(m => m.id !== materialId);
      await onUpdateLibrary({
          ...materialLibrary,
          [tagName]: updated
      });
      if (selectedShot?.materialSelections?.[tagName] === materialId) {
          onUnbindMaterial(selectedShot.id, tagName);
      }
  };

  const handleSaveClick = () => {
    setIsNamingVersion(true);
    const count = selectedFile?.versions?.length || 0;
    setVersionName(`素材绑定存档 v${count + 1} - ${new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})}`);
  };

  const submitVersionSave = () => {
    if(versionName.trim()) {
        onSaveVersion(versionName);
        setIsNamingVersion(false);
    }
  };

  return (
    <div className="workflow-stage-layout layout-safe responsive-split flex-1 flex h-full w-full bg-n20 overflow-hidden relative">
      {/* Resizable Sidebar: Shot List */}
      <div
        style={{ width: sidebarWidth }}
        className="workflow-stage-sidebar responsive-pane flex-shrink-0 border-r border-n40 bg-n0 flex flex-col relative"
      >
        <div className="workflow-stage-toolbar h-[52px] px-4 border-b border-n40 bg-n0 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-bold text-n700 uppercase tracking-wider flex items-center gap-2">
              <LayoutDashboard className="w-4 h-4 text-primary" />
              分镜列表
          </h2>
          <div className="flex items-center gap-2">
            {/* 🆕 追加其他文件分镜按钮 */}
            {onAppendStoryboard && files.filter(f => f.id !== selectedFileId && f.storyboard?.items?.length).length > 0 && (
              <button
                onClick={() => {
                  setSelectedAppendFileIds(new Set());
                  setShowAppendModal(true);
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                title="追加其他文件的分镜"
              >
                <Plus className="w-3 h-3" />
                追加
              </button>
            )}
            {/* 🆕 移除追加镜头按钮 */}
            {onRemoveAppendedStoryboard && storyboardItems.some(item => item.sourceFileId) && (
              <button
                onClick={() => {
                  if (confirm('确定要移除所有追加的镜头吗？')) {
                    onRemoveAppendedStoryboard();
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-danger hover:bg-danger text-white rounded transition-colors"
                title="移除所有追加的镜头"
              >
                <Trash2 className="w-3 h-3" />
                清除追加
              </button>
            )}
            <span className="text-xs text-n100 truncate max-w-[100px]">{selectedFile?.name || '未命名'}</span>
          </div>
        </div>
        <div className="workflow-stage-scroll flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
          {/* 🆕 显示追加来源文件列表 */}
          {(() => {
            const appendedSources = new Map<string, string>();
            storyboardItems.forEach(item => {
              if (item.sourceFileId && item.sourceFileName) {
                appendedSources.set(item.sourceFileId, item.sourceFileName);
              }
            });
            if (appendedSources.size > 0) {
              return (
                <div className="mb-2 p-2 bg-y50 border border-y75 rounded-lg">
                  <div className="text-[10px] text-warning font-bold mb-1.5">📎 已追加的文件镜头：</div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(appendedSources.entries()).map(([fileId, fileName]) => (
                      <div key={fileId} className="flex items-center gap-1 px-2 py-0.5 bg-y50 border border-y75 rounded text-[9px] text-warning">
                        <span>{fileName}</span>
                        {onRemoveAppendedStoryboard && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`确定要移除来自"${fileName}"的追加镜头吗？`)) {
                                onRemoveAppendedStoryboard(fileId);
                              }
                            }}
                            className="p-0.5 hover:bg-r50 rounded transition-colors"
                            title={`移除来自"${fileName}"的镜头`}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          })()}
          
          {visibleStoryboardItems.map((item, index) => {
            const isSelected = item.id === selectedShot?.id;
            const tags = [...(item.characters || []), ...(item.scene ? [item.scene] : []), ...(item.props || [])].filter(t => t);
            const isBound = tags.length > 0 && tags.every(t => item.materialSelections?.[t]);
            const hasTags = tags.length > 0;
            const isAppended = !!item.sourceFileId;  // 🆕 是否为追加的镜头
            const displayIndex = storyboardItems.indexOf(item);

            return (
              <div 
                key={item.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                data-storyboard-item-id={item.id}
                onClick={() => setSelectedShotId(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedShotId(item.id);
                  }
                }}
                className={`p-3 rounded-lg cursor-pointer border transition-all relative ${
                  isSelected
                    ? 'bg-primary-light border-primary ring-1 ring-primary/50'
                    : isAppended
                      ? 'bg-y50 border-y75 hover:border-warning hover:bg-y75'  // 追加镜头
                      : 'bg-n0 border-n40 hover:border-n40 hover:bg-n20'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${isSelected ? 'text-primary' : isAppended ? 'text-warning' : 'text-n300'}`}>
                      镜头 {String((displayIndex >= 0 ? displayIndex : index) + 1).padStart(2, '0')}
                    </span>
                    {/* 🆕 追加来源标记 */}
                    {isAppended && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-amber-600/30 border border-amber-500/30 text-warning rounded" title={`来自: ${item.sourceFileName}`}>
                        📎 {item.sourceFileName}
                      </span>
                    )}
                  </div>
                  {hasTags && (
                    isBound ? (
                        <div className="flex items-center gap-1 text-[9px] text-success bg-g50 px-1.5 py-0.5 rounded-full border border-g75">
                            <Check className="w-2.5 h-2.5" />
                            已完成
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 text-[9px] text-warning bg-y50 px-1.5 py-0.5 rounded-full border border-y75">
                            <AlertCircle className="w-2.5 h-2.5" />
                            待绑定
                        </div>
                    )
                  )}
                </div>
                <p className="text-[10px] text-n300 line-clamp-2 leading-relaxed opacity-80 mb-2">"{item.scriptSegment}"</p>
                <div className="flex gap-1 overflow-hidden flex-wrap">
                   {(item.characters || []).map(c => (
                     <span key={c} className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${item.materialSelections?.[c] ? 'bg-primary-light border-primary/30 text-primary' : 'bg-n30 border-n40 text-n100'}`}>
                         {c}
                     </span>
                   ))}
                   {item.scene && (
                     <span className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${item.materialSelections?.[item.scene] ? 'bg-orange-50 border-orange-200 text-orange-600' : 'bg-n30 border-n40 text-n100'}`}>
                         {item.scene}
                     </span>
                   )}
                   {(item.props || []).map(p => (
                     <span key={`p-${p}`} className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${item.materialSelections?.[p] ? 'bg-y50 border-y75 text-warning' : 'bg-n30 border-n40 text-n100'}`}>
                         {p}
                     </span>
                   ))}
                </div>
              </div>
            );
          })}
          {hasMoreStoryboardItems && (
            <button
              type="button"
              onClick={() => setVisibleShotCount(count => Math.min(count + MATERIAL_SHOT_PAGE_SIZE, storyboardItems.length))}
              className="w-full px-3 py-2 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/15 border border-primary/20 rounded-lg transition-colors"
            >
              加载更多镜头（{Math.min(visibleShotCount, storyboardItems.length)} / {storyboardItems.length}）
            </button>
          )}
        </div>

        {/* Drag Handle */}
        <div
            className="absolute top-0 right-0 bottom-0 w-1 bg-transparent hover:bg-primary/50 cursor-col-resize z-50 transition-colors"
            onMouseDown={startResizing}
        >
             <div className="absolute top-1/2 -translate-y-1/2 right-0.5">
                 <GripVertical className="w-3 h-3 text-n100 opacity-0 hover:opacity-100" />
             </div>
        </div>
      </div>

      {/* Right Content: Workspace */}
      <div className="workflow-stage-canvas responsive-pane layout-safe flex-1 flex flex-col bg-n20 overflow-hidden relative">
         {/* Top Bar */}
         <div className="workflow-stage-toolbar h-[52px] border-b border-n40 bg-n0 px-6 flex items-center justify-between flex-shrink-0 shadow-sm z-20">
             <div className="flex items-center gap-4">
                <h3 className="font-bold text-n700 text-sm flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-primary rounded-full"></span>
                    {hasStoryboard && selectedFile && selectedShot 
                      ? `镜头 ${String(storyboardItems.findIndex(i => i.id === selectedShot.id) + 1).padStart(2, '0')}` 
                      : '素材绑定工作区'}
                </h3>
             </div>

             <div className="flex items-center gap-2">
                 <button
                   type="button"
                   onClick={() => setIsContextExpanded(expanded => !expanded)}
                   aria-expanded={isContextExpanded}
                   aria-controls="material-shot-context"
                   className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded border border-primary bg-primary-light px-3 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white"
                   title={isContextExpanded ? '收起剧本描述和提示词' : '展开剧本描述和提示词'}
                 >
                   {isContextExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                   {isContextExpanded ? '收起提示词' : '展开提示词'}
                 </button>
                 {onAssetScopeModeChange && (
                   <div className="flex items-center gap-1 p-0.5 rounded-md border border-n40 bg-n20" title="素材可见范围">
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
                 <div className="flex items-center gap-2 text-[10px] text-success bg-g50 px-2 py-1 rounded border border-g75">
                     <Database className="w-3 h-3" />
                     <span>素材绑定数据已自动保存</span>
                 </div>
                 
                 {!hideVersionArchive && (
                   <>
                 <div className="h-6 w-px bg-n40"></div>

                 <div className="flex items-center gap-2">
                    <button
                        onClick={handleSaveClick}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-n700 hover:text-white bg-n0 hover:bg-primary rounded transition-colors border border-n40 hover:border-primary"
                    >
                        <Save className="w-3.5 h-3.5" />
                        <span>保存</span>
                    </button>

                    <button 
                        onClick={() => setShowHistory(!showHistory)}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded transition-colors border ${
                        showHistory
                            ? 'bg-primary text-white border-primary'
                            : 'bg-n0 text-n700 hover:text-white hover:bg-n20 border-n40'
                        }`}
                    >
                        <History className="w-3.5 h-3.5" />
                        <span>历史记录</span>
                    </button>
                 </div>
                   </>
                 )}

                 <div className="h-6 w-px bg-n40"></div>

                 <button
                onClick={onNextStep}
                className="bg-primary hover:bg-primary-hover text-white px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-900/20 transition-all hover:scale-105"
                >
                    下一步
                    <ChevronRight className="w-3.5 h-3.5" />
                </button>
             </div>
         </div>

         {/* Save Version Modal */}
         {!hideVersionArchive && isNamingVersion && (
            <div className="absolute top-14 right-40 z-50 bg-n0 border border-n40 shadow-bottom rounded-lg p-3 w-72 animate-in fade-in slide-in-from-top-2">
                <h4 className="text-xs font-bold text-n700 mb-2">保存当前绑定状态</h4>
                <input
                    type="text"
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                    className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs text-n800 mb-2 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
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
        {!hideVersionArchive && showHistory && renderHistoryPanel()}

         <div className="flex-1 overflow-y-auto custom-scrollbar p-4 xl:p-6">
             {!selectedShot ? (
                <div className="flex flex-col items-center justify-center h-full text-n100">
                  <LayoutDashboard className="w-16 h-16 mb-4 opacity-20" />
                  <p className="text-sm mb-2">当前无分镜数据</p>
                  <p className="text-xs text-n100">
                    {hideVersionArchive ? '请先在阶段1生成分镜' : '请先在阶段1生成分镜，或从历史版本恢复'}
                  </p>
                </div>
             ) : (
               <div className="w-full">
             {/* Context Section - 3 Column Layout */}
             {isContextExpanded && (
             <div id="material-shot-context" className="bg-n0 rounded-md p-1 border border-n40 mb-6 shadow-card">
                 <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-n40">
                    {/* Script */}
                    <div className="p-4 flex flex-col min-h-[140px]">
                        <span className="text-[10px] font-bold text-n100 uppercase block mb-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-n100"></span>
                            剧本描述
                        </span>
                        <div className="flex-1 pr-2">
                             <p className="text-sm text-n700 leading-relaxed font-serif whitespace-pre-wrap break-words">
                                 {selectedShot.originalText || '无'}
                             </p>
                        </div>
                    </div>
                    
                    {/* Image Prompt */}
                    <div className="p-4 flex flex-col min-h-[140px]">
                        <span className="text-[10px] font-bold text-cyan-500 uppercase block mb-3 flex items-center gap-2">
                             <ImageIcon className="w-3.5 h-3.5" />
                             画面提示词 (Image)
                        </span>
                        <div className="flex-1 pr-2">
                            <p className="text-xs text-n300 leading-relaxed whitespace-pre-wrap break-words">
                                {selectedShot.imagePrompt || '无'}
                            </p>
                        </div>
                    </div>

                    {/* Video Prompt */}
                    <div className="p-4 flex flex-col min-h-[140px]">
                         <span className="text-[10px] font-bold text-primary uppercase block mb-3 flex items-center gap-2">
                             <Film className="w-3.5 h-3.5" />
                             视频提示词 (Video)
                         </span>
                         <div className="flex-1 pr-2">
                            <p className="text-xs text-n300 leading-relaxed whitespace-pre-wrap break-words">
                                {selectedShot.videoPrompt || '无'}
                            </p>
                        </div>
                    </div>
                 </div>
             </div>
             )}

             <div className="space-y-6 pb-20" data-testid="material-category-grid">
             <section className="min-w-0" aria-labelledby="material-characters-heading">
             <h4 id="material-characters-heading" className="text-sm font-bold text-n700 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
                 <Users className="w-4 h-4 text-primary" />
                 角色素材 (Characters)
                 <span className="text-[10px] font-normal text-n100">绑定后将自动应用于后续同名角色</span>
             </h4>
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch" data-testid="material-character-cards">
                 {!selectedShot || (selectedShot.characters || []).length === 0 ? (
                     <div className="col-span-full py-8 border-2 border-dashed border-n40 rounded-md flex items-center justify-center text-n100 bg-n0">
                        <span className="text-xs">本镜头无登场角色</span>
                     </div>
                 ) : (
                  (selectedShot.characters || []).map(charName => (
                     <MaterialCard 
                        key={charName}
                        name={charName}
                        type="character"
                        materials={materialLibrary[charName] || []}
                        selectedMaterialId={selectedShot.materialSelections?.[charName]}
                       aiGenerating={aiGeneratingTag === charName}
                       cameraGenerating={cameraGeneratingTag === charName}
                        onUpload={(e) => handleFileUpload(e, charName, 'character')}
                       onOpenAI={() => openAIGenerator(charName, 'character')}
                       onOpenCamera={() => openCameraModal(charName, 'character')}
                       onProcessMaterial={(workflow) => openProcessModal(charName, 'character', workflow as 'upscale_hd' | 'remove_watermark')}
                        onDeleteFromLibrary={(id) => removeMaterialFromLibrary(charName, id)}
                        onBind={(id) => onBindMaterial(selectedShot.id, charName, id)}
                        isSyncedToFollowing={(id) => (
                          isMaterialFullySynced?.(selectedShot.id, charName, id) ?? false
                        )}
                        onUnbind={() => onUnbindMaterial(selectedShot.id, charName)}
                       onViewImage={(url) => setLightboxImage(url)}
                     />
                  ))
                 )}
             </div>
             </section>

             <section className="min-w-0" aria-labelledby="material-scene-heading">
             <h4 id="material-scene-heading" className="text-sm font-bold text-n700 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
                 <MapPin className="w-4 h-4 text-orange-400" />
                 场景素材 (Scene)
                 <span className="text-[10px] font-normal text-n100">为该场景绑定背景参考</span>
             </h4>
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch" data-testid="material-scene-cards">
                 {!selectedShot.scene ? (
                     <div className="col-span-full py-8 border-2 border-dashed border-n40 rounded-md flex items-center justify-center text-n100 bg-n0">
                         <span className="text-xs">本镜头无特定场景描述</span>
                     </div>
                 ) : (
                    <MaterialCard 
                        name={selectedShot.scene}
                        type="scene"
                        materials={materialLibrary[selectedShot.scene] || []}
                        selectedMaterialId={selectedShot.materialSelections?.[selectedShot.scene]}
                       aiGenerating={aiGeneratingTag === selectedShot.scene}
                       cameraGenerating={cameraGeneratingTag === selectedShot.scene}
                        onUpload={(e) => handleFileUpload(e, selectedShot.scene, 'scene')}
                       onOpenAI={() => openAIGenerator(selectedShot.scene, 'scene')}
                       onOpenCamera={() => openCameraModal(selectedShot.scene, 'scene')}
                       onProcessMaterial={(workflow) => openProcessModal(selectedShot.scene, 'scene', workflow as 'upscale_hd' | 'remove_watermark')}
                        onDeleteFromLibrary={(id) => removeMaterialFromLibrary(selectedShot.scene, id)}
                        onBind={(id) => onBindMaterial(selectedShot.id, selectedShot.scene, id)}
                        isSyncedToFollowing={(id) => (
                          isMaterialFullySynced?.(selectedShot.id, selectedShot.scene, id) ?? false
                        )}
                        onUnbind={() => onUnbindMaterial(selectedShot.id, selectedShot.scene)}
                       onViewImage={(url) => setLightboxImage(url)}
                     />
                  )}
             </div>
             </section>

             <section className="min-w-0" aria-labelledby="material-props-heading">
             <h4 id="material-props-heading" className="text-sm font-bold text-n700 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
                 <Box className="w-4 h-4 text-yellow-500" />
                 道具素材 (Props)
                 <span className="text-[10px] font-normal text-n100">手持物、武器、关键陈设等独立参考</span>
             </h4>
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch" data-testid="material-prop-cards">
                 {!selectedShot || (selectedShot.props || []).length === 0 ? (
                     <div className="col-span-full py-8 border-2 border-dashed border-n40 rounded-md flex items-center justify-center text-n100 bg-n0">
                         <span className="text-xs">本镜头无特定道具</span>
                     </div>
                 ) : (
                    (selectedShot.props || []).map(propName => (
                       <MaterialCard
                          key={propName}
                          name={propName}
                          type="prop"
                          materials={materialLibrary[propName] || []}
                          selectedMaterialId={selectedShot.materialSelections?.[propName]}
                          aiGenerating={aiGeneratingTag === propName}
                          cameraGenerating={cameraGeneratingTag === propName}
                          onUpload={(e) => handleFileUpload(e, propName, 'prop')}
                          onOpenAI={() => openAIGenerator(propName, 'prop')}
                          onOpenCamera={() => openCameraModal(propName, 'prop')}
                          onProcessMaterial={(workflow) => openProcessModal(propName, 'prop', workflow as 'upscale_hd' | 'remove_watermark')}
                          onDeleteFromLibrary={(id) => removeMaterialFromLibrary(propName, id)}
                          onBind={(id) => onBindMaterial(selectedShot.id, propName, id)}
                          isSyncedToFollowing={(id) => (
                            isMaterialFullySynced?.(selectedShot.id, propName, id) ?? false
                          )}
                          onUnbind={() => onUnbindMaterial(selectedShot.id, propName)}
                          onViewImage={(url) => setLightboxImage(url)}
                       />
                    ))
                  )}
             </div>
             </section>
             </div>
                      </div>
                 )}
             </div>
      </div>
      {aiModalConfig && (
        <MaterialAIModal
            config={aiModalConfig}
            onClose={() => setAiModalConfig(null)}
            onSubmit={handleMaterialAIGeneration}
        />
      )}
      {cameraModalConfig && selectedShot && (
        <CameraModal
            config={cameraModalConfig}
            onClose={() => setCameraModalConfig(null)}
            onSubmit={handleCameraGenerate}
        />
      )}
      {processModalConfig && (
        <ProcessModal
            config={processModalConfig}
            onClose={() => setProcessModalConfig(null)}
            onSubmit={handleProcessMaterial}
        />
      )}
      {threeViewModalConfig && (
        <ThreeViewModal
            config={threeViewModalConfig}
            onClose={() => setThreeViewModalConfig(null)}
            onSubmit={handleThreeViewGenerate}
        />
      )}
      
      {/* 🆕 追加分镜弹窗（支持多选） */}
      {showAppendModal && (() => {
        const currentFileIndex = files.findIndex(f => f.id === selectedFileId);
        const availableFiles = files.filter(f => f.id !== selectedFileId);
        const filesWithStoryboard = availableFiles.filter(f => f.storyboard?.items?.length);
        const filesWithoutStoryboard = availableFiles.filter(f => !f.storyboard?.items?.length);
        
        const toggleFileSelection = (fileId: string) => {
          setSelectedAppendFileIds(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) {
              next.delete(fileId);
            } else {
              next.add(fileId);
            }
            return next;
          });
        };
        
        const selectAll = () => {
          setSelectedAppendFileIds(new Set(filesWithStoryboard.map(f => f.id)));
        };
        
        const clearSelection = () => {
          setSelectedAppendFileIds(new Set());
        };
        
        const handleConfirmAppend = () => {
          if (onAppendStoryboard && selectedAppendFileIds.size > 0) {
            onAppendStoryboard(Array.from(selectedAppendFileIds));
            setShowAppendModal(false);
            setSelectedAppendFileIds(new Set());
          }
        };
        
        return (
          <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={() => setShowAppendModal(false)}>
            <div className="w-full max-w-lg bg-n0 border border-n40 rounded-md shadow-bottom p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                    <Plus className="w-5 h-5 text-primary" />
                    追加文件分镜
                  </h3>
                  <p className="text-xs text-n300 mt-1">支持多选，根据文件顺序决定追加位置</p>
                </div>
                <button onClick={() => setShowAppendModal(false)} className="text-n300 hover:text-n800">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-3 bg-primary-light border border-primary/30 rounded-lg">
                <p className="text-xs text-primary">
                  💡 <strong>提示：</strong>文件顺序决定追加位置。可多选后一次性追加：
                </p>
                <ul className="text-[10px] text-primary mt-2 space-y-1 ml-4">
                  <li>• 上方文件的镜头 → 追加到<strong className="text-success">前面</strong></li>
                  <li>• 下方文件的镜头 → 追加到<strong className="text-orange-400">后面</strong></li>
                </ul>
              </div>
              
              {/* 快捷操作 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  disabled={filesWithStoryboard.length === 0}
                  className="px-3 py-1 text-[10px] bg-n0 hover:bg-n20 text-n700 rounded border border-n40 disabled:opacity-50"
                >
                  全选
                </button>
                <button
                  onClick={clearSelection}
                  disabled={selectedAppendFileIds.size === 0}
                  className="px-3 py-1 text-[10px] bg-n0 hover:bg-n20 text-n700 rounded border border-n40 disabled:opacity-50"
                >
                  清除选择
                </button>
                {selectedAppendFileIds.size > 0 && (
                  <span className="text-[10px] text-primary">
                    已选择 {selectedAppendFileIds.size} 个文件
                  </span>
                )}
              </div>
              
              <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar">
                {filesWithStoryboard.map(file => {
                    const fileIndex = files.findIndex(f => f.id === file.id);
                    const appendToFront = fileIndex < currentFileIndex;
                    const isSelected = selectedAppendFileIds.has(file.id);
                    
                    return (
                      <div
                        key={file.id}
                        onClick={() => toggleFileSelection(file.id)}
                        className={`flex items-center justify-between p-4 rounded-md transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-primary-light border-2 border-primary ring-2 ring-primary/30'
                            : 'bg-n0 hover:bg-n20 border border-n40 hover:border-n40'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {/* 选择框 */}
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-primary border-primary' : 'border-n40'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            appendToFront ? 'bg-green-600/20' : 'bg-orange-600/20'
                          }`}>
                            <Film className={`w-5 h-5 ${appendToFront ? 'text-success' : 'text-orange-400'}`} />
                          </div>
                          <div className="text-left">
                            <div className="text-sm font-medium text-n700 flex items-center gap-2">
                              <span className="text-[10px] text-n100 font-mono">[{fileIndex + 1}]</span>
                              {file.name}
                            </div>
                            <div className="text-[10px] text-n100">
                              {file.storyboard?.items?.length || 0} 个镜头
                            </div>
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-1 rounded ${
                          appendToFront
                            ? 'text-success bg-g50'
                            : 'text-orange-600 bg-orange-50'
                        }`}>
                          {appendToFront ? '← 前置' : '追加 →'}
                        </span>
                      </div>
                    );
                  })}
                
                {/* 显示没有镜头的文件 */}
                {filesWithoutStoryboard.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-n40">
                    <p className="text-[10px] text-n100 mb-2">以下文件暂无分镜：</p>
                    {filesWithoutStoryboard.map(file => {
                      const fileIndex = files.findIndex(f => f.id === file.id);
                      return (
                        <div
                          key={file.id}
                          className="flex items-center gap-3 p-3 bg-n30 border border-n40 rounded-lg opacity-50 cursor-not-allowed"
                        >
                          <div className="w-5 h-5 rounded border-2 border-n40"></div>
                          <div className="w-10 h-10 rounded-lg bg-n30 flex items-center justify-center">
                            <Film className="w-5 h-5 text-n100" />
                          </div>
                          <div className="text-left">
                            <div className="text-sm text-n100 flex items-center gap-2">
                              <span className="text-[10px] font-mono">[{fileIndex + 1}]</span>
                              {file.name}
                            </div>
                            <div className="text-[10px] text-n100">无镜头</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {availableFiles.length === 0 && (
                  <div className="text-center py-8 text-n100">
                    <Film className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">没有其他文件</p>
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-n40">
                <div className="text-[10px] text-n100">
                  {selectedAppendFileIds.size > 0 && (
                    <>
                      将追加 {Array.from(selectedAppendFileIds).reduce((sum, id) => {
                        const file = files.find(f => f.id === id);
                        return sum + (file?.storyboard?.items?.length || 0);
                      }, 0)} 个镜头
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowAppendModal(false)} 
                    className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmAppend}
                    disabled={selectedAppendFileIds.size === 0}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    确认追加 ({selectedAppendFileIds.size})
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      
      {lightboxImage && (() => {
        // 找到当前查看的素材所属的标签和所有素材
        let allMaterials: Material[] = [];
        let currentIndex = -1;
        
        if (selectedShot) {
          // 合并人物、场景和道具的所有素材
          const allTags = [...(selectedShot.characters || []), ...(selectedShot.scene ? [selectedShot.scene] : []), ...(selectedShot.props || [])];
          allTags.forEach(tag => {
            const tagMaterials = materialLibrary[tag] || [];
            tagMaterials.forEach(m => {
              if (m.url === lightboxImage) {
                currentIndex = allMaterials.length;
              }
              allMaterials.push(m);
            });
          });
        }

        const hasPrev = currentIndex > 0;
        const hasNext = currentIndex >= 0 && currentIndex < allMaterials.length - 1;
        
        const showPrev = () => {
          if (hasPrev) {
            setLightboxImage(allMaterials[currentIndex - 1].url);
          }
        };
        
        const showNext = () => {
          if (hasNext) {
            setLightboxImage(allMaterials[currentIndex + 1].url);
          }
        };

        return (
          <div className="fixed inset-0 bg-n900/50 backdrop-blur-sm flex items-center justify-center z-[150]" onClick={() => setLightboxImage(null)}>
            <button 
              onClick={() => setLightboxImage(null)} 
              className="absolute top-6 right-6 text-white hover:text-n50 bg-black/50 rounded-full p-2 z-10"
            >
              <X className="w-6 h-6" />
            </button>
            
            {hasPrev && (
              <button
                onClick={(e) => { e.stopPropagation(); showPrev(); }}
                className="absolute left-6 top-1/2 -translate-y-1/2 text-white hover:text-n50 bg-black/50 rounded-full p-3 z-10"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            
            {hasNext && (
              <button
                onClick={(e) => { e.stopPropagation(); showNext(); }}
                className="absolute right-6 top-1/2 -translate-y-1/2 text-white hover:text-n50 bg-black/50 rounded-full p-3 z-10"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            
            <img 
              src={lightboxImage}
              loading="lazy" 
              alt="预览" 
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
         </div>
        );
      })()}
    </div>
  );
};

// Sub-component for individual tag card
const MaterialCard: React.FC<{
    name: string;
    type: BindingAssetType;
    materials: Material[];
    selectedMaterialId?: string;
    aiGenerating: boolean;
    cameraGenerating: boolean;
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onOpenAI: () => void;
    onOpenCamera: () => void;
    onProcessMaterial: (workflow: 'upscale_hd' | 'remove_watermark' | 'three_view') => void;
    onDeleteFromLibrary: (id: string) => void;
    onBind: (id: string) => void;
    isSyncedToFollowing: (id: string) => boolean;
    onUnbind: () => void;
    onViewImage: (url: string) => void;
}> = ({ name, type, materials, selectedMaterialId, aiGenerating, cameraGenerating, onUpload, onOpenAI, onOpenCamera, onProcessMaterial, onDeleteFromLibrary, onBind, isSyncedToFollowing, onUnbind, onViewImage }) => {
    
    const boundMaterial = materials.find(m => m.id === selectedMaterialId);
    const hasMaterials = materials.length > 0;
    const typeStyles: Record<BindingAssetType, { header: string; badge: string; label: string }> = {
        character: { header: 'bg-primary-light', badge: 'text-primary border-primary/20 bg-primary-light', label: 'Character' },
        scene: { header: 'bg-orange-50', badge: 'text-orange-600 border-orange-200 bg-orange-50', label: 'Scene' },
        prop: { header: 'bg-y50', badge: 'text-warning border-y75 bg-y50', label: 'Prop' },
    };
    const style = typeStyles[type];

    return (
        <div className="bg-n0 border border-n40 rounded-md overflow-hidden flex min-w-0 flex-col h-full shadow-card hover:shadow-atlas hover:border-n40 transition-all group">
            <div className={`px-3 py-2.5 border-b border-n40 flex justify-between items-center ${style.header}`}>
                <div className="flex items-center gap-2">
                    <div className="font-bold text-sm text-n800">{name}</div>
                    {selectedMaterialId && <CheckCircle className="w-3.5 h-3.5 text-success" />}
                </div>
                <div className={`text-[9px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider ${style.badge}`}>
                    {style.label}
                </div>
            </div>
            
            {/* Selected Area */}
            <div className="p-3 border-b border-n40 bg-n20 min-h-[148px] flex gap-3">
                 <div className="w-24 h-28 flex-shrink-0 bg-n0 rounded-lg overflow-hidden border border-n40 relative flex items-center justify-center group-hover:border-n40 transition-colors">
                     {boundMaterial ? (
                         <>
                            <img 
                                src={boundMaterial.thumbnail || boundMaterial.url} 
                                alt="Bound" 
                                loading="lazy" 
                                className="w-full h-full object-contain p-1"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-60" />
                            <div className="absolute bottom-2 right-2 bg-success text-white p-1 rounded-full shadow-lg">
                                <Lock className="w-3 h-3" />
                            </div>
                         </>
                     ) : (
                         <div className="text-[10px] text-n100 text-center px-2 flex flex-col items-center gap-2">
                             <div className="p-2 rounded-full bg-n30">
                                 <Plus className="w-4 h-4" />
                             </div>
                             未绑定
                         </div>
                     )}
                 </div>
                 <div className="min-w-0 flex-1 flex flex-col justify-center gap-2">
                     <div>
                        <span className="text-[10px] font-bold text-n100 uppercase tracking-wide block mb-1">当前状态</span>
                        <p className={`text-xs leading-relaxed ${boundMaterial ? 'text-success' : 'text-n300'}`}>
                            {boundMaterial 
                                ? type === 'character'
                                  ? "已设为角色身份参考，锁定当前及后续镜头。"
                                  : "已锁定当前及后续镜头。"
                                : "请选择素材。绑定后将自动填充后续所有同名标签。"}
                        </p>
                        {boundMaterial && type === 'character' && (
                          <div className="mt-2 text-[10px] text-n300">
                            <span className="inline-flex items-center gap-1 font-semibold text-primary"><ShieldCheck className="w-3 h-3" /> 角色身份参考</span>
                            {boundMaterial.description && <p className="mt-1 line-clamp-2" title={boundMaterial.description}>{boundMaterial.description}</p>}
                          </div>
                        )}
                     </div>
                     {boundMaterial && (
                         <button 
                            onClick={onUnbind}
                            className="text-[10px] bg-r50 hover:bg-r50 text-danger hover:text-danger border border-danger/20 hover:border-danger/40 px-2.5 py-1 rounded-md self-start flex items-center gap-1.5 transition-all"
                         >
                             <Trash2 className="w-3 h-3" />
                             解除锁定 (及后续)
                         </button>
                     )}
                 </div>
            </div>

            {/* Library Grid */}
            <div className={`bg-n20 p-3 ${materials.length > 3 ? 'max-h-[128px] overflow-y-auto custom-scrollbar' : 'overflow-hidden'}`}>
                {materials.length === 0 ? (
                    <div className="h-20 flex flex-col items-center justify-center text-n100 border-2 border-dashed border-n40 rounded-lg m-1">
                        <AlertCircle className="w-5 h-5 mb-2 opacity-40" />
                        <span className="text-[10px]">暂无素材，请上传或生成</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-2 pb-2">
                        {materials.map(m => {
                            const isCurrent = m.id === selectedMaterialId;
                            const isSynced = isSyncedToFollowing(m.id);
                            return (
                                <div 
                                    key={m.id} 
                                    role="button"
                                    tabIndex={isSynced ? -1 : 0}
                                    aria-disabled={isSynced}
                                    title={isSynced ? '已同步到当前及后续同名镜头' : '绑定此素材'}
                                    className={`relative group/item h-24 rounded-lg overflow-hidden border transition-all ${
                                      isCurrent ? 'border-success ring-2 ring-green-500/30' : 'border-n40 hover:border-primary'
                                    } ${isSynced ? 'cursor-not-allowed bg-n30 opacity-60' : 'cursor-pointer bg-n0'}`}
                                    onClick={() => {
                                      if (!isSynced) onBind(m.id);
                                    }}
                                    onKeyDown={(event) => {
                                      if (!isSynced && (event.key === 'Enter' || event.key === ' ')) {
                                        event.preventDefault();
                                        onBind(m.id);
                                      }
                                    }}
                                >
                                    <img 
                                        src={m.thumbnail || m.url} 
                                        alt="material" 
                                        loading="lazy" 
                                        className={`w-full h-full object-contain p-1 transition-transform duration-300 ${
                                          isSynced ? '' : 'group-hover/item:scale-105'
                                        }`}
                                    />
                                    {isSynced && (
                                      <span className="absolute left-1 bottom-1 text-[8px] bg-n100/85 text-white px-1.5 py-0.5 rounded">
                                        已同步
                                      </span>
                                    )}
                                    
                                    {/* Hover Actions */}
                                    <div className="absolute inset-0 bg-n900/50 opacity-0 group-hover/item:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                        {!isCurrent && (
                                            <span className="text-[9px] font-bold text-white uppercase tracking-wider">点击使用</span>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onViewImage(m.url); }}
                                                className="p-1.5 bg-primary rounded-full text-white hover:bg-primary-hover transform hover:scale-110 transition-transform"
                                                title="查看大图"
                                            >
                                                <ZoomIn className="w-3 h-3" />
                                            </button>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onDeleteFromLibrary(m.id); }} 
                                            className="p-1.5 bg-danger rounded-full text-white hover:bg-danger transform hover:scale-110 transition-transform"
                                            title="删除素材"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                        </div>
                                    </div>

                                    {m.source === 'ai' && <div className="absolute top-1 right-1 text-[8px] bg-primary text-white px-1 rounded shadow-sm">AI</div>}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Action Footer */}
            <div className="p-3 border-t border-n40 bg-n0 flex flex-wrap gap-1.5">
                <button
                    onClick={onOpenAI}
                    disabled={aiGenerating}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-primary-light border border-primary text-primary rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {aiGenerating ? (
                        <span className="animate-spin w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full"></span>
                    ) : (
                        <Sparkles className="w-3 h-3" />
                    )}
                    <span>AI 生图</span>
                </button>
                <label className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-n0 hover:bg-n20 border border-n40 rounded-lg cursor-pointer transition-colors text-[11px] text-n300 font-medium">
                    <Upload className="w-3 h-3" />
                    <span>上传</span>
                    <input type="file" className="hidden" accept="image/*" onChange={onUpload} />
                </label>
                <button
                    onClick={onOpenCamera}
                    disabled={!hasMaterials || cameraGenerating}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-n0 hover:bg-n20 text-n300 rounded-lg text-[11px] font-medium border border-n40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {cameraGenerating ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"></span>
                    ) : (
                        <Camera className="w-3 h-3" />
                    )}
                    <span>角度</span>
                </button>
                <button
                    onClick={() => onProcessMaterial('upscale_hd')}
                    disabled={!hasMaterials || cameraGenerating}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-n0 hover:bg-n20 text-n300 rounded-lg text-[11px] font-medium border border-n40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {cameraGenerating ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"></span>
                    ) : (
                        <Maximize className="w-3 h-3" />
                    )}
                    <span>高清放大</span>
                </button>
                <button
                    onClick={() => onProcessMaterial('remove_watermark')}
                    disabled={!hasMaterials || cameraGenerating}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-n0 hover:bg-n20 text-n300 rounded-lg text-[11px] font-medium border border-n40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {cameraGenerating ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"></span>
                    ) : (
                        <Scissors className="w-3 h-3" />
                    )}
                    <span>去水印</span>
                </button>
                {supportsStandardTurnaround(type) && (
                    <button
                        onClick={() => onProcessMaterial('three_view')}
                        disabled={!hasMaterials}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-n0 hover:bg-n20 text-n300 rounded-lg text-[11px] font-medium border border-n40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Layers className="w-3 h-3" />
                        <span>四视图</span>
                    </button>
                )}
            </div>
        </div>
    );
};


const MaterialAIModal: React.FC<{
    config: MaterialAIModalConfig;
    onClose: () => void;
    onSubmit: (payload: MaterialAIGenerationPayload) => void;
}> = ({ config, onClose, onSubmit }) => {
    const [engine, setEngine] = useState<MaterialAIEngine>('nanobanana');
    const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash-image');  // ✅ 默认使用Gemini 2.5 Flash图像模型
    const [prompt, setPrompt] = useState(config.defaultPrompt);
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('1K');
    const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
    const [sequential, setSequential] = useState<'disabled' | 'auto'>('disabled');
    const [count, setCount] = useState(1);
    const [standardTurnaround, setStandardTurnaround] = useState(
        supportsStandardTurnaround(config.type),
    );

    const maxRefs = engine === 'nanobanana' ? 6 : 10;

    useEffect(() => {
        setPrompt(config.defaultPrompt);
        setSelectedRefs(new Set());
        setStandardTurnaround(supportsStandardTurnaround(config.type));
    }, [config]);

    useEffect(() => {
        if (engine === 'nanobanana') {
            setSequential('disabled');
            setCount(1);
        }
    }, [engine]);

    const toggleSelection = (id: string) => {
        setSelectedRefs(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
                return next;
            }
            if (next.size >= maxRefs) {
                alert(`参考图最多选择 ${maxRefs} 张`);
                return next;
            }
            next.add(id);
            return next;
        });
    };

    const handleSubmit = () => {
        if (!prompt.trim()) {
            alert('请输入提示词');
            return;
        }
        const references = config.materials
            .filter(m => selectedRefs.has(m.id))
            .map(m => m.url);
        onSubmit({
            tagName: config.tagName,
            engine,
            prompt: withStandardTurnaround(prompt, config.type, standardTurnaround),
            references,
            geminiModel,
            aspectRatio: standardTurnaroundAspectRatio(config.type, aspectRatio, standardTurnaround),
            resolution,
            sequential,
            count
        });
    };

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur-sm flex items-center justify-center z-[120]" onClick={onClose}>
            <div className="w-full max-w-4xl bg-n0 border border-n40 rounded-md shadow-bottom p-6 space-y-6 relative" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-n800">AI 生成素材 - {config.tagName}</h3>
                        <p className="text-xs text-n300 mt-1">选择模型与参考图，自定义提示词快速生成角色/场景/道具素材。</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="col-span-1 space-y-3 border border-n40 rounded-md p-4">
                        <span className="text-[11px] font-bold text-n100 uppercase">引擎选择</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setEngine('nanobanana')}
                                className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${engine === 'nanobanana' ? 'bg-primary text-white border-primary' : 'border-n40 text-n300 hover:text-n800 hover:border-n40'}`}
                            >
                                化神进阶
                            </button>
                            <button
                                onClick={() => setEngine('doubao')}
                                className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${engine === 'doubao' ? 'bg-primary text-white border-primary' : 'border-n40 text-n300 hover:text-n800 hover:border-n40'}`}
                            >
                                筑基境界
                            </button>
                        </div>
                        {engine === 'nanobanana' && (
                            <div className="space-y-2">
                                <span className="text-[11px] font-bold text-n100 uppercase">图像模型</span>
                                <div className="flex flex-col gap-2">
                                    {[
                                        { id: 'gemini-2.5-flash-image', label: '化神1阶（快速）', desc: '快速生成，效率优先' },
                                        { id: 'gemini-3-pro-image-preview', label: '化神2阶（高质量）', desc: '高质量生成，效果优先' }
                                    ].map(model => (
                                        <label key={model.id} className={`flex flex-col gap-1 text-xs p-2 rounded border cursor-pointer ${geminiModel === model.id ? 'bg-primary-light border-primary text-primary' : 'border-n40 text-n300 hover:border-n40'}`}>
                                            <div className="flex items-center gap-2">
                                            <input
                                                type="radio"
                                                name="geminiModel"
                                                value={model.id}
                                                checked={geminiModel === model.id}
                                                onChange={() => setGeminiModel(model.id)}
                                            />
                                                <span className="font-semibold">{model.label}</span>
                                            </div>
                                            {model.desc && (
                                                <span className="text-[10px] text-n100 ml-5">{model.desc}</span>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <span className="text-[11px] font-bold text-n100 uppercase">输出规格</span>
                            <div className="grid grid-cols-2 gap-2">
                                {['1:1', '3:4', '4:3', '9:16', '16:9'].map(ratio => (
                                    <button
                                        key={ratio}
                                        onClick={() => setAspectRatio(ratio)}
                                        className={`py-1.5 rounded text-[11px] border ${aspectRatio === ratio ? 'bg-primary text-white font-semibold border-primary' : 'border-n40 text-n300 hover:text-n800 hover:border-n40'}`}
                                    >
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                            <select
                                value={resolution}
                                onChange={(e) => setResolution(e.target.value as '1K' | '2K' | '4K')}
                                className="w-full bg-n0 border border-n40 rounded-lg text-xs text-n800 px-2 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                            >
                                <option value="1K">1K 输出</option>
                                <option value="2K">2K 输出</option>
                                <option value="4K">4K 输出</option>
                            </select>
                        </div>

                        {supportsStandardTurnaround(config.type) && (
                            <label className="flex items-center gap-2 text-xs text-n700">
                                <input
                                    type="checkbox"
                                    checked={standardTurnaround}
                                    onChange={(e) => setStandardTurnaround(e.target.checked)}
                                    className="accent-indigo-500"
                                />
                                {standardTurnaroundLabel(config.type)}
                            </label>
                        )}

                        {engine === 'doubao' && (
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-xs text-n700">
                                    <input
                                        type="checkbox"
                                        checked={sequential === 'auto'}
                                        onChange={(e) => setSequential(e.target.checked ? 'auto' : 'disabled')}
                                    />
                                    生成关联组图
                                </label>
                                {sequential === 'auto' && (
                                    <div className="flex items-center gap-2 text-xs text-n700">
                                        <span>张数</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={5}
                                            value={count}
                                            onChange={(e) => setCount(Math.min(5, Math.max(1, Number(e.target.value))))}
                                            className="w-16 bg-n0 border border-n40 rounded px-2 py-1 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="col-span-2 space-y-4">
                        <div>
                            <span className="text-[11px] font-bold text-n100 uppercase block mb-1">提示词</span>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                rows={5}
                                className="w-full bg-n0 border border-n40 rounded-md text-sm text-n800 p-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                                placeholder={selectedRefs.size > 0 ? "描述你想要的变化，例如：换一个姿势、改变背景、添加道具等。AI会参考你选择的图片风格。" : "描述你想要生成的内容"}
                            />
                            {selectedRefs.size > 0 && (
                                <div className="mt-2 flex items-start gap-2 p-2 bg-primary-light border border-primary/30 rounded-lg">
                                    <div className="text-primary mt-0.5">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div className="flex-1 text-xs text-primary leading-relaxed">
                                        <strong>💡 提示：</strong>你已选择 {selectedRefs.size} 张参考图，AI会严格遵循参考图的画风、构图和角色设计。建议在提示词中描述你想要的<strong>改变或变化</strong>，而不是重复描述参考图中已有的元素。
                                    </div>
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="flex items-center justify-between text-[11px] text-n100 mb-2">
                                <span className="font-bold uppercase">参考图 (可多选，最多 {maxRefs} 张)</span>
                                <span className={selectedRefs.size > 0 ? "text-success font-semibold" : ""}>{selectedRefs.size}/{maxRefs}</span>
                            </div>
                            {config.materials.length === 0 ? (
                                <div className="border border-dashed border-n40 rounded-md text-center py-6 text-xs text-n100">
                                    暂无素材，可先上传或生成后再选作参考。
                                </div>
                            ) : (
                                <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto pr-1">
                                    {config.materials.map(material => {
                                        const active = selectedRefs.has(material.id);
                                        return (
                                            <button
                                                key={material.id}
                                                onClick={() => toggleSelection(material.id)}
                                                className={`relative aspect-square rounded-lg overflow-hidden border ${active ? 'border-success ring-2 ring-success/40' : 'border-n40'}`}
                                                type="button"
                                            >
                                                <img src={material.thumbnail || material.url} loading="lazy" className="w-full h-full object-cover" />
                                                {active && <div className="absolute inset-0 bg-success/30"></div>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
                    <button onClick={handleSubmit} className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg shadow-indigo-900/30 hover:shadow-indigo-900/50">开始生成</button>
                </div>
            </div>
        </div>
    );
};

const CameraModal: React.FC<{
    config: CameraModalConfig;
    onClose: () => void;
    onSubmit: (payload: CameraGenerationPayload) => void;
}> = ({ config, onClose, onSubmit }) => {
    const [selectedMaterialId, setSelectedMaterialId] = useState<string | undefined>(config.selectedMaterialId);
    const [rotate, setRotate] = useState(0);
    const [move, setMove] = useState(0);
    const [vertical, setVertical] = useState(0);
    const [wideAngle, setWideAngle] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');
    const [seed, setSeed] = useState(randomSeed());
    const [gpuSelection, setGpuSelection] = useState<GpuNodeSelection | null>(null);

    const promptExamples = [
        "将镜头向前移动（Move the camera forward.）",
        "将镜头向左移动（Move the camera left.）",
        "将镜头向右移动（Move the camera right.）",
        "将镜头向下移动（Move the camera down.）",
        "将镜头转为俯视（Turn the camera to a top-down view.）",
        "将镜头转为广角镜头（Turn the camera to a wide-angle lens.）",
        "将镜头转为特写镜头（Turn the camera to a close-up.）"
    ];

    const currentMaterial = config.materials.find(m => m.id === selectedMaterialId) || config.materials[0];

    useEffect(() => {
        setSelectedMaterialId(config.selectedMaterialId || config.materials[0]?.id);
    }, [config]);

    const handleSubmit = () => {
        if (!currentMaterial || !gpuSelection?.usable) {
            alert(currentMaterial ? '请选择一个可用 GPU 节点' : '请选择一张素材图片');
            return;
        }
        onSubmit({
            tagName: config.tagName,
            imageUrl: currentMaterial.url,
            rotate,
            move,
            vertical,
            wideAngle,
            customPrompt: customPrompt.trim() || undefined,
            seed,
            gpu: gpuSelection,
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
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-5xl space-y-6 overflow-y-auto rounded-md border border-n40 bg-n0 p-6 shadow-bottom" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-n800">角度调整 - {config.tagName}</h3>
                        <p className="text-xs text-n300 mt-1">基于现有素材重建镜头角度，保持角色/场景/道具一致性。</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="relative rounded-md overflow-hidden border border-n40 h-72 bg-n20 flex items-center justify-center">
                            {currentMaterial ? (
                                <img src={currentMaterial.url} loading="lazy" className="w-full h-full object-contain" />
                            ) : (
                                <span className="text-xs text-n100">暂无素材</span>
                            )}
                        </div>
                        <div className="grid grid-cols-5 gap-2 max-h-32 overflow-y-auto pr-1">
                            {config.materials.map(material => (
                                <button
                                    key={material.id}
                                    onClick={() => setSelectedMaterialId(material.id)}
                                    className={`relative aspect-square rounded-lg overflow-hidden border ${selectedMaterialId === material.id ? 'border-success ring-2 ring-success/40' : 'border-n40'}`}
                                >
                                    <img src={material.thumbnail || material.url} loading="lazy" className="w-full h-full object-cover" />
                                </button>
                            ))}
                        </div>
                        <GpuNodeSelector onSelectionChange={setGpuSelection} />
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
                                className="w-full bg-n0 border border-n40 rounded-lg text-sm text-n800 p-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                                placeholder="输入更详细的场景描述或留空使用自动提示..."
                            />
                            <div className="flex flex-wrap gap-1 mt-2">
                                {promptExamples.map((example, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setCustomPrompt(example)}
                                        className="text-[10px] px-2 py-1 bg-n0 hover:bg-primary text-n300 hover:text-white rounded border border-n40 hover:border-primary transition-colors"
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
                                    className="w-32 bg-n0 border border-n40 rounded px-2 py-1 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                />
                            </div>
                            <button onClick={() => setSeed(randomSeed())} className="px-2 py-1 rounded border border-n40 hover:border-primary hover:text-n800 transition-colors">
                                随机
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
                    <button
                        onClick={handleSubmit}
                        disabled={!currentMaterial || !gpuSelection?.usable}
                        title={!gpuSelection?.usable ? '请先选择一个可用 GPU 节点' : undefined}
                        className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg shadow-emerald-900/30 hover:shadow-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >生成新角度</button>
                </div>
            </div>
        </div>
    );
};

const ProcessModal: React.FC<{
    config: ProcessModalConfig;
    onClose: () => void;
    onSubmit: (materialId: string, gpu: GpuNodeSelection) => void;
}> = ({ config, onClose, onSubmit }) => {
    const [selectedMaterialId, setSelectedMaterialId] = useState<string>(config.selectedMaterialId);
    const [gpuSelection, setGpuSelection] = useState<GpuNodeSelection | null>(null);

    const currentMaterial = config.materials.find(m => m.id === selectedMaterialId) || config.materials[0];

    useEffect(() => {
        setSelectedMaterialId(config.selectedMaterialId || config.materials[0]?.id);
    }, [config]);

    const handleSubmit = () => {
        if (!currentMaterial || !gpuSelection?.usable) {
            alert(currentMaterial ? '请选择一个可用 GPU 节点' : '请选择一张素材图片');
            return;
        }
        onSubmit(selectedMaterialId, gpuSelection);
    };

    const workflowNames = {
        'upscale_hd': { title: '高清放大', desc: '使用AI放大图片到4K分辨率，保持清晰度' },
        'remove_watermark': { title: '去水印', desc: '智能移除图片水印，保持画面完整性' }
    };

    const workflowInfo = workflowNames[config.workflow];

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
            <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-md shadow-bottom p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-n800">{workflowInfo.title} - {config.tagName}</h3>
                        <p className="text-xs text-n300 mt-1">{workflowInfo.desc}</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 左侧：当前素材预览与统一缩略图选择 */}
                    <div className="space-y-4">
                        <div className="relative rounded-md overflow-hidden border border-n40 h-72 bg-n20 flex items-center justify-center">
                            {currentMaterial ? (
                                <img src={currentMaterial.url} loading="lazy" className="w-full h-full object-contain" alt="素材预览" />
                            ) : (
                                <span className="text-xs text-n100">暂无素材</span>
                            )}
                        </div>
                        <div className="text-center text-xs text-n300">
                            当前选中的素材
                        </div>
                    </div>

                    {/* 右侧：素材选择 */}
                    <div className="space-y-4">
                        <div>
                            <span className="text-[11px] font-bold text-n100 uppercase mb-2 block">选择要处理的素材</span>
                            <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto p-2 bg-n20 rounded-lg border border-n40">
                                {config.materials.map((mat) => (
                                    <button
                                        key={mat.id}
                                        onClick={() => setSelectedMaterialId(mat.id)}
                                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                                            selectedMaterialId === mat.id
                                                ? 'border-primary ring-2 ring-primary/30'
                                                : 'border-transparent hover:border-n40'
                                        }`}
                                    >
                                        <img src={mat.thumbnail || mat.url} loading="lazy" className="w-full h-full object-cover" alt="素材" />
                                        {selectedMaterialId === mat.id && (
                                            <div className="absolute inset-0 bg-primary-light flex items-center justify-center">
                                                <Check className="w-6 h-6 text-white" />
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <GpuNodeSelector onSelectionChange={setGpuSelection} />

                {/* 底部按钮 */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
                    <button
                      onClick={handleSubmit}
                      disabled={!currentMaterial || !gpuSelection?.usable}
                      title={!gpuSelection?.usable ? '请先选择一个可用 GPU 节点' : undefined}
                      className={`px-5 py-2 rounded-lg text-xs font-bold text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                        config.workflow === 'upscale_hd'
                            ? 'bg-b400 hover:bg-b500 shadow-blue-900/30 hover:shadow-blue-900/50'
                            : 'bg-primary hover:bg-primary-hover shadow-purple-900/30 hover:shadow-purple-900/50'
                    }`}>
                        开始处理
                    </button>
                </div>
            </div>
        </div>
    );
};

const ThreeViewModal: React.FC<{
    config: ThreeViewModalConfig;
    onClose: () => void;
    onSubmit: (materialId: string, prompt: string) => void;
}> = ({ config, onClose, onSubmit }) => {
    const [selectedMaterialId, setSelectedMaterialId] = useState<string>(config.selectedMaterialId);
    const [prompt, setPrompt] = useState<string>(
        withStandardTurnaround(config.tagName, config.type),
    );

    const currentMaterial = config.materials.find(m => m.id === selectedMaterialId) || config.materials[0];
    
    // 🔧 调试：检查所有素材的URL
    useEffect(() => {
        console.log('🔍 三视图弹窗 - 素材列表:', config.materials.map(m => ({
            id: m.id,
            url: m.url,
            urlType: typeof m.url,
            urlValid: m.url && typeof m.url === 'string' && m.url.length > 0
        })));
        console.log('🔍 当前选中素材:', {
            id: selectedMaterialId,
            material: currentMaterial,
            url: currentMaterial?.url
        });
    }, [config.materials, selectedMaterialId, currentMaterial]);

    useEffect(() => {
        setSelectedMaterialId(config.selectedMaterialId || config.materials[0]?.id);
        setPrompt(withStandardTurnaround(config.tagName, config.type));
    }, [config]);

    const handleSubmit = () => {
        if (!selectedMaterialId) {
            alert('请选择一张素材图片');
            return;
        }
        if (!prompt.trim()) {
            alert('请输入生成提示词');
            return;
        }
        
        // 🔧 额外验证：确保选中的素材存在且有效
        const selectedMat = config.materials.find(m => m.id === selectedMaterialId);
        if (!selectedMat) {
            alert('选中的素材不存在');
            return;
        }
        if (!selectedMat.url || typeof selectedMat.url !== 'string') {
            alert(`选中的素材URL无效\n素材ID: ${selectedMaterialId}\nURL: ${selectedMat.url}`);
            return;
        }
        
        onSubmit(selectedMaterialId, prompt.trim());
    };

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
            <div className="w-full max-w-3xl bg-n0 border border-n40 rounded-md shadow-bottom p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-n800">{standardTurnaroundLabel(config.type)} - {config.tagName}</h3>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 左侧：当前素材预览 */}
                    <div className="space-y-4">
                        <div className="relative rounded-md overflow-hidden border border-n40 h-72 bg-n20 flex items-center justify-center">
                            {currentMaterial && currentMaterial.url ? (
                                <img 
                                    src={currentMaterial.url} 
                                    loading="lazy" 
                                    className="w-full h-full object-contain" 
                                    alt="素材预览"
                                    onError={(e) => {
                                        console.error('❌ 图片加载失败:', currentMaterial.url);
                                        e.currentTarget.style.display = 'none';
                                    }}
                                />
                            ) : (
                                <span className="text-xs text-n100">
                                    {currentMaterial ? '素材URL无效' : '暂无素材'}
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-5 gap-2 max-h-32 overflow-y-auto pr-1">
                            {config.materials.map((mat) => (
                                <button
                                    key={mat.id}
                                    onClick={() => setSelectedMaterialId(mat.id)}
                                    className={`relative h-20 rounded-lg overflow-hidden border-2 transition-all ${
                                        selectedMaterialId === mat.id
                                            ? 'border-success ring-2 ring-success/30'
                                            : 'border-n40 hover:border-primary'
                                    }`}
                                    aria-label={`选择素材 ${mat.id}`}
                                >
                                    {mat.url ? (
                                        <img
                                            src={mat.thumbnail || mat.url}
                                            loading="lazy"
                                            className="w-full h-full object-cover"
                                            alt="素材"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-n30">
                                            <span className="text-xs text-n100">无效</span>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 右侧：提示词编辑 */}
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-n300 uppercase">生成提示词</label>
                        {config.type === 'character' && (
                            <div
                                data-testid="character-turnaround-explanation"
                                className="flex gap-3 rounded-md border border-success/30 bg-success-light px-3 py-3"
                            >
                                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-n700">人物四视图生成说明</p>
                                    <p className="mt-1 text-xs leading-5 text-n400">
                                        会生成三张不同角度的全身图（正面、侧面、背面）和一张放大的正面半身图，四张横向并排，统一使用白底。
                                    </p>
                                </div>
                            </div>
                        )}
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="输入生成提示词..."
                            className="w-full h-72 bg-n0 border border-n40 rounded-lg px-3 py-2 text-sm text-n800 placeholder:text-n100 resize-none focus:outline-none focus:border-success transition-colors"
                            spellCheck={false}
                        />
                        <p className="text-[10px] text-n100">
                            提示：人物和道具会按白底四视图标准生成，选中素材仅以绿色边框标识。
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
                    <button onClick={handleSubmit} className="px-5 py-2 rounded-lg text-xs font-bold text-white shadow-lg bg-success hover:bg-success shadow-green-900/30 hover:shadow-green-900/50">
                        开始生成
                    </button>
                </div>
            </div>
        </div>
    );
};
