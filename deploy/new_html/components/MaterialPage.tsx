

import React, { useState, useCallback, useEffect } from 'react';
import { ProjectFile, StoryboardItem, MaterialLibrary, Material, FileVersion } from '../types';
import { LayoutDashboard, Users, MapPin, Plus, Image as ImageIcon, Sparkles, Trash2, ChevronRight, Upload, AlertCircle, Film, Check, Lock, CheckCircle, Save, History, RefreshCw, X, Clock, Database, GripVertical, Camera, ZoomIn } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { generateGeminiImageVariant, adjustImageAngle, waitForComfyUITask } from '../services/geminiService';
import { generateDoubaoImages, GeneratedFileResult } from '../services/doubaoService';
import { generateThumbnail } from '../utils/imageOptimization';
import { getAuthToken } from '../services/apiService';

type MaterialAIEngine = 'nanobanana' | 'doubao';

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
  type: 'character' | 'scene';
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
};

type CameraModalConfig = {
  tagName: string;
  type: 'character' | 'scene';
  materials: Material[];
  selectedMaterialId: string;
};

type ProcessModalConfig = {
  tagName: string;
  type: 'character' | 'scene';
  materials: Material[];
  selectedMaterialId: string;
  workflow: 'upscale_hd' | 'remove_watermark';
};

type ThreeViewModalConfig = {
  tagName: string;
  type: 'character' | 'scene';
  materials: Material[];
  selectedMaterialId: string;
};

const randomSeed = () => Math.floor(Math.random() * 900000000000000) + 100000000000000;

async function downloadImageAsDataUrl(url: string): Promise<string> {
  // 🔧 支持 Blob URL（本地素材库可能使用）
  if (url.startsWith('blob:')) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('无法下载Blob图片');
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  // 处理普通 HTTP URL
  const token = localStorage.getItem('auth_token');
  const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
  const secured = token ? `${absolute}${absolute.includes('?') ? '&' : '?'}token=${token}` : absolute;
  const response = await fetch(secured, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined
  });
  if (!response.ok) {
      throw new Error('无法下载生成的图片');
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
  });
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
  onUpdateLibrary: (newLibrary: MaterialLibrary) => void;
  onBindMaterial: (shotId: string, tagName: string, materialId: string) => void;
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
}

export const MaterialPage: React.FC<MaterialPageProps> = ({
  files,
  selectedFileId,
  materialLibrary,
  onUpdateLibrary,
  onBindMaterial,
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
}) => {
  const selectedFile = files.find(f => f.id === selectedFileId);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
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
    <div className="absolute top-[52px] right-0 bottom-0 w-80 bg-gray-900 border-l border-gray-800 z-40 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-gray-850">
            <h3 className="text-xs font-bold text-gray-300 flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                内部历史版本存档
            </h3>
            <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
            </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {selectedFile?.versions && selectedFile.versions.length > 0 ? (
                [...selectedFile.versions].reverse().map(ver => (
                    <div key={ver.id} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 hover:bg-gray-800 transition-colors group">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <div className="text-xs font-bold text-gray-200">{ver.name}</div>
                                <div className="text-[10px] text-gray-500 font-mono mt-0.5">
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
                                className="flex-1 py-1.5 bg-indigo-900/50 hover:bg-indigo-600 border border-indigo-500/30 rounded text-[10px] text-indigo-200 hover:text-white transition-colors flex items-center justify-center gap-1 group-hover:border-indigo-500"
                            >
                                <RefreshCw className="w-3 h-3" />
                                恢复此版本
                            </button>
                        </div>
                    </div>
                ))
            ) : (
                <div className="flex flex-col items-center justify-center py-10 text-gray-500 gap-2">
                    <History className="w-8 h-8 opacity-20" />
                    <div className="text-center text-xs">
                        暂无内部存档记录<br/>
                        请点击上方 <span className="text-indigo-400 font-bold">保存</span> 按钮创建存档
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, tagName: string, type: 'character' | 'scene') => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const { uploadEntityFile } = await import('../services/entityFileService');
        const shotId = selectedShot?.id || 'temp';
        const saved = await uploadEntityFile(file, 'material', shotId, type === 'character' ? 'character_ref' : 'scene_ref', '');
        const newId = saved.fileId || uuidv4();
        const newMaterial: Material = {
          id: newId,
          url: saved.fileUrl,
          thumbnail: saved.fileUrl,
          type: 'image',
          source: 'upload',
          timestamp: Date.now()
        };
        const existing = materialLibrary[tagName] || [];
        onUpdateLibrary({
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

  const openAIGenerator = (tagName: string, type: 'character' | 'scene') => {
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
                size: payload.resolution,
                sequential: payload.sequential,
                count: payload.count,
                ...entityOpts,
            });
        }

        if (!results.length) throw new Error('未返回图片');
        
        const existing = materialLibrary[payload.tagName] || [];
        const newMaterials: Material[] = results.map((r) => ({
            id: uuidv4(),
            url: r.url,
            type: 'image',
            source: 'ai',
            timestamp: Date.now()
        }));

        onUpdateLibrary({
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

  const openProcessModal = (tagName: string, type: 'character' | 'scene', workflow: 'upscale_hd' | 'remove_watermark' | 'three_view') => {
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

  const openCameraModal = (tagName: string, type: 'character' | 'scene') => {
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

  const handleProcessMaterial = async (materialId: string) => {
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
        
        const { processMaterialImage, waitForComfyUITask } = await import('../services/geminiService');
        const { taskId } = await processMaterialImage(targetMaterial.url, workflow);
        const resultUrl = await waitForComfyUITask(taskId);

        const existing = materialLibrary[tagName] || [];
        const newMaterial: Material = {
            id: `${Date.now()}_processed`,
            url: resultUrl,
            timestamp: Date.now()
        };

        onUpdateLibrary({
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
    
    const { tagName, materials } = threeViewModalConfig;
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
        const { generateGeminiImageVariant } = await import('../services/geminiService');
        const results = await generateGeminiImageVariant({
            prompt: prompt,
            references: [targetMaterial.url],
            model: 'gemini-2.5-flash-image',
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
        const newMaterial: Material = {
            id: `${Date.now()}_threeview`,
            url: imageUrl,
            type: 'image',
            source: 'ai',
            timestamp: Date.now()
        };

        onUpdateLibrary({
            ...materialLibrary,
            [tagName]: [...existing, newMaterial]
        });

        alert('三视图生成完成！');
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
            }
        );
        const resultUrl = await waitForComfyUITask(taskId);

        const newMaterial: Material = {
            id: uuidv4(),
            url: resultUrl,
            type: 'image',
            source: 'ai',
            timestamp: Date.now()
        };

        const existing = materialLibrary[payload.tagName] || [];
        onUpdateLibrary({
            ...materialLibrary,
            [payload.tagName]: [...existing, newMaterial]
        });
        onBindMaterial(selectedShot.id, payload.tagName, newMaterial.id);

    } catch (error:any) {
        console.error('Camera adjust failed', error);
        alert(error?.message || '角度调整失败，请重试。');
    } finally {
        setCameraGeneratingTag(null);
    }
  };

  const removeMaterialFromLibrary = (tagName: string, materialId: string) => {
      const existing = materialLibrary[tagName] || [];
      const updated = existing.filter(m => m.id !== materialId);
      onUpdateLibrary({
          ...materialLibrary,
          [tagName]: updated
      });
      if (selectedShot.materialSelections?.[tagName] === materialId) {
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
    <div className="flex-1 flex h-full w-full bg-gray-950 overflow-hidden relative">
      {/* Resizable Sidebar: Shot List */}
      <div 
        style={{ width: sidebarWidth }} 
        className="flex-shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col relative"
      >
        <div className="h-[52px] px-4 border-b border-gray-800 bg-gray-850 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
              <LayoutDashboard className="w-4 h-4 text-indigo-400" />
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
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
                title="追加其他文件的分镜"
              >
                <Plus className="w-3 h-3" />
                追加
              </button>
            )}
            {/* 🆕 移除追加镜头按钮 */}
            {onRemoveAppendedStoryboard && selectedFile?.storyboard?.items?.some(item => item.sourceFileId) && (
              <button
                onClick={() => {
                  if (confirm('确定要移除所有追加的镜头吗？')) {
                    onRemoveAppendedStoryboard();
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                title="移除所有追加的镜头"
              >
                <Trash2 className="w-3 h-3" />
                清除追加
              </button>
            )}
            <span className="text-xs text-gray-500 truncate max-w-[100px]">{selectedFile?.name || '未命名'}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
          {/* 🆕 显示追加来源文件列表 */}
          {(() => {
            const appendedSources = new Map<string, string>();
            selectedFile?.storyboard?.items.forEach(item => {
              if (item.sourceFileId && item.sourceFileName) {
                appendedSources.set(item.sourceFileId, item.sourceFileName);
              }
            });
            if (appendedSources.size > 0) {
              return (
                <div className="mb-2 p-2 bg-amber-900/20 border border-amber-500/30 rounded-lg">
                  <div className="text-[10px] text-amber-400 font-bold mb-1.5">📎 已追加的文件镜头：</div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(appendedSources.entries()).map(([fileId, fileName]) => (
                      <div key={fileId} className="flex items-center gap-1 px-2 py-0.5 bg-amber-900/30 border border-amber-500/20 rounded text-[9px] text-amber-300">
                        <span>{fileName}</span>
                        {onRemoveAppendedStoryboard && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`确定要移除来自"${fileName}"的追加镜头吗？`)) {
                                onRemoveAppendedStoryboard(fileId);
                              }
                            }}
                            className="p-0.5 hover:bg-red-600 rounded transition-colors"
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
          
          {selectedFile?.storyboard?.items.map((item, index) => {
            const isSelected = item.id === selectedShot?.id;
            const tags = [...item.characters, item.scene].filter(t => t);
            const isBound = tags.length > 0 && tags.every(t => item.materialSelections?.[t]);
            const hasTags = tags.length > 0;
            const isAppended = !!item.sourceFileId;  // 🆕 是否为追加的镜头

            return (
              <div 
                key={item.id}
                onClick={() => setSelectedShotId(item.id)}
                className={`p-3 rounded-lg cursor-pointer border transition-all relative ${
                  isSelected 
                    ? 'bg-indigo-900/30 border-indigo-500 ring-1 ring-indigo-500/50' 
                    : isAppended
                      ? 'bg-amber-900/20 border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-900/30'  // 🆕 追加镜头的颜色
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600 hover:bg-gray-800/80'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${isSelected ? 'text-indigo-400' : isAppended ? 'text-amber-400' : 'text-gray-400'}`}>
                      镜头 {String(index + 1).padStart(2, '0')}
                    </span>
                    {/* 🆕 追加来源标记 */}
                    {isAppended && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-amber-600/30 border border-amber-500/30 text-amber-300 rounded" title={`来自: ${item.sourceFileName}`}>
                        📎 {item.sourceFileName}
                      </span>
                    )}
                  </div>
                  {hasTags && (
                    isBound ? (
                        <div className="flex items-center gap-1 text-[9px] text-green-400 bg-green-950/30 px-1.5 py-0.5 rounded-full border border-green-500/20">
                            <Check className="w-2.5 h-2.5" />
                            已完成
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 text-[9px] text-yellow-400 bg-yellow-950/30 px-1.5 py-0.5 rounded-full border border-yellow-500/20">
                            <AlertCircle className="w-2.5 h-2.5" />
                            待绑定
                        </div>
                    )
                  )}
                </div>
                <p className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed opacity-80 mb-2">"{item.scriptSegment}"</p>
                <div className="flex gap-1 overflow-hidden flex-wrap">
                   {item.characters.map(c => (
                     <span key={c} className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${item.materialSelections?.[c] ? 'bg-indigo-900/40 border-indigo-500/30 text-indigo-300' : 'bg-gray-700/50 border-gray-600 text-gray-500'}`}>
                         {c}
                     </span>
                   ))}
                   {item.scene && (
                     <span className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${item.materialSelections?.[item.scene] ? 'bg-orange-900/40 border-orange-500/30 text-orange-300' : 'bg-gray-700/50 border-gray-600 text-gray-500'}`}>
                         {item.scene}
                     </span>
                   )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Drag Handle */}
        <div
            className="absolute top-0 right-0 bottom-0 w-1 bg-transparent hover:bg-indigo-500/50 cursor-col-resize z-50 transition-colors"
            onMouseDown={startResizing}
        >
             <div className="absolute top-1/2 -translate-y-1/2 right-0.5">
                 <GripVertical className="w-3 h-3 text-gray-600 opacity-0 hover:opacity-100" />
             </div>
        </div>
      </div>

      {/* Right Content: Workspace */}
      <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden relative">
         {/* Top Bar */}
         <div className="h-[52px] border-b border-gray-800 bg-gray-850 px-6 flex items-center justify-between flex-shrink-0 shadow-sm z-20">
             <div className="flex items-center gap-4">
                <h3 className="font-bold text-gray-200 text-sm flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-indigo-500 rounded-full"></span>
                    {hasStoryboard && selectedFile && selectedShot 
                      ? `镜头 ${String(selectedFile.storyboard!.items.findIndex(i => i.id === selectedShot.id) + 1).padStart(2, '0')}` 
                      : '素材绑定工作区'}
                </h3>
             </div>

             <div className="flex items-center gap-4">
                 <div className="flex items-center gap-2 text-[10px] text-green-400/80 bg-green-950/20 px-2 py-1 rounded border border-green-500/20">
                     <Database className="w-3 h-3" />
                     <span>素材绑定数据已自动保存</span>
                 </div>
                 
                 {!hideVersionArchive && (
                   <>
                 <div className="h-6 w-px bg-gray-700"></div>

                 <div className="flex items-center gap-2">
                    <button 
                        onClick={handleSaveClick}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white bg-gray-800 hover:bg-indigo-600 rounded transition-colors border border-gray-700 hover:border-indigo-500"
                    >
                        <Save className="w-3.5 h-3.5" />
                        <span>保存</span>
                    </button>

                    <button 
                        onClick={() => setShowHistory(!showHistory)}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded transition-colors border ${
                        showHistory 
                            ? 'bg-indigo-600 text-white border-indigo-500' 
                            : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 border-gray-700'
                        }`}
                    >
                        <History className="w-3.5 h-3.5" />
                        <span>历史记录</span>
                    </button>
                 </div>
                   </>
                 )}

                 <div className="h-6 w-px bg-gray-700"></div>
                 
                 <button 
                onClick={onNextStep}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-900/20 transition-all hover:scale-105"
                >
                    下一步
                    <ChevronRight className="w-3.5 h-3.5" />
                </button>
             </div>
         </div>

         {/* Save Version Modal */}
         {!hideVersionArchive && isNamingVersion && (
            <div className="absolute top-14 right-40 z-50 bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-3 w-72 animate-in fade-in slide-in-from-top-2">
                <h4 className="text-xs font-bold text-gray-300 mb-2">保存当前绑定状态</h4>
                <input 
                    type="text" 
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white mb-2 focus:outline-none focus:border-indigo-500"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submitVersionSave();
                        if (e.key === 'Escape') setIsNamingVersion(false);
                    }}
                />
                <div className="flex gap-2">
                    <button onClick={() => setIsNamingVersion(false)} className="flex-1 py-1 bg-gray-700 text-gray-300 text-xs rounded hover:bg-gray-600">取消</button>
                    <button onClick={submitVersionSave} className="flex-1 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-500">确认保存</button>
                </div>
            </div>
        )}

        {/* History Panel */}
        {!hideVersionArchive && showHistory && renderHistoryPanel()}

         <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
             {!selectedShot ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <LayoutDashboard className="w-16 h-16 mb-4 opacity-20" />
                  <p className="text-sm mb-2">当前无分镜数据</p>
                  <p className="text-xs text-gray-600">
                    {hideVersionArchive ? '请先在阶段1生成分镜' : '请先在阶段1生成分镜，或从历史版本恢复'}
                  </p>
                </div>
             ) : (
               <div className="w-full">
             {/* Context Section - 3 Column Layout */}
             <div className="bg-gray-900 rounded-xl p-1 border border-gray-800 mb-8 shadow-sm">
                 <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-800">
                    {/* Script */}
                    <div className="p-4 flex flex-col h-full min-h-[140px]">
                        <span className="text-[10px] font-bold text-gray-500 uppercase block mb-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                            剧本描述
                        </span>
                        <div className="flex-1 overflow-y-auto max-h-[100px] custom-scrollbar pr-2">
                             <p className="text-sm text-gray-300 leading-relaxed font-serif whitespace-pre-wrap break-words">
                                 {selectedShot.originalText || '无'}
                             </p>
                        </div>
                    </div>
                    
                    {/* Image Prompt */}
                    <div className="p-4 flex flex-col h-full min-h-[140px]">
                        <span className="text-[10px] font-bold text-cyan-500 uppercase block mb-3 flex items-center gap-2">
                             <ImageIcon className="w-3.5 h-3.5" />
                             画面提示词 (Image)
                        </span>
                        <div className="flex-1 overflow-y-auto max-h-[100px] custom-scrollbar pr-2">
                            <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap break-words">
                                {selectedShot.imagePrompt || '无'}
                            </p>
                        </div>
                    </div>

                    {/* Video Prompt */}
                    <div className="p-4 flex flex-col h-full min-h-[140px]">
                         <span className="text-[10px] font-bold text-purple-500 uppercase block mb-3 flex items-center gap-2">
                             <Film className="w-3.5 h-3.5" />
                             视频提示词 (Video)
                         </span>
                         <div className="flex-1 overflow-y-auto max-h-[100px] custom-scrollbar pr-2">
                            <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap break-words">
                                {selectedShot.videoPrompt || '无'}
                            </p>
                        </div>
                    </div>
                 </div>
             </div>

             <h4 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2 px-1">
                 <Users className="w-4 h-4 text-indigo-400" />
                 角色素材 (Characters)
                 <span className="text-[10px] font-normal text-gray-500 ml-2">绑定后将自动应用于后续同名角色</span>
             </h4>
             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-10">
                 {!selectedShot || selectedShot.characters.length === 0 ? (
                     <div className="col-span-full py-8 border-2 border-dashed border-gray-800 rounded-xl flex items-center justify-center text-gray-600 bg-gray-900/30">
                        <span className="text-xs">本镜头无登场角色</span>
                     </div>
                 ) : (
                  selectedShot.characters.map(charName => (
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
                        onUnbind={() => onUnbindMaterial(selectedShot.id, charName)}
                       onViewImage={(url) => setLightboxImage(url)}
                     />
                  ))
                 )}
             </div>

             <h4 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2 px-1">
                 <MapPin className="w-4 h-4 text-orange-400" />
                 场景素材 (Scene)
                 <span className="text-[10px] font-normal text-gray-500 ml-2">为该场景绑定背景参考</span>
             </h4>
             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
                 {!selectedShot.scene ? (
                     <div className="col-span-full py-8 border-2 border-dashed border-gray-800 rounded-xl flex items-center justify-center text-gray-600 bg-gray-900/30">
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
                        onUnbind={() => onUnbindMaterial(selectedShot.id, selectedShot.scene)}
                       onViewImage={(url) => setLightboxImage(url)}
                     />
                 )}
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
          <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-[130]" onClick={() => setShowAppendModal(false)}>
            <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Plus className="w-5 h-5 text-indigo-400" />
                    追加文件分镜
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">支持多选，根据文件顺序决定追加位置</p>
                </div>
                <button onClick={() => setShowAppendModal(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg">
                <p className="text-xs text-indigo-200">
                  💡 <strong>提示：</strong>文件顺序决定追加位置。可多选后一次性追加：
                </p>
                <ul className="text-[10px] text-indigo-300 mt-2 space-y-1 ml-4">
                  <li>• 上方文件的镜头 → 追加到<strong className="text-green-400">前面</strong></li>
                  <li>• 下方文件的镜头 → 追加到<strong className="text-orange-400">后面</strong></li>
                </ul>
              </div>
              
              {/* 快捷操作 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  disabled={filesWithStoryboard.length === 0}
                  className="px-3 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 disabled:opacity-50"
                >
                  全选
                </button>
                <button
                  onClick={clearSelection}
                  disabled={selectedAppendFileIds.size === 0}
                  className="px-3 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 disabled:opacity-50"
                >
                  清除选择
                </button>
                {selectedAppendFileIds.size > 0 && (
                  <span className="text-[10px] text-indigo-400">
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
                        className={`flex items-center justify-between p-4 rounded-xl transition-all cursor-pointer ${
                          isSelected 
                            ? 'bg-indigo-900/40 border-2 border-indigo-500 ring-2 ring-indigo-500/30' 
                            : 'bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {/* 选择框 */}
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            appendToFront ? 'bg-green-600/20' : 'bg-orange-600/20'
                          }`}>
                            <Film className={`w-5 h-5 ${appendToFront ? 'text-green-400' : 'text-orange-400'}`} />
                          </div>
                          <div className="text-left">
                            <div className="text-sm font-medium text-gray-200 flex items-center gap-2">
                              <span className="text-[10px] text-gray-500 font-mono">[{fileIndex + 1}]</span>
                              {file.name}
                            </div>
                            <div className="text-[10px] text-gray-500">
                              {file.storyboard?.items?.length || 0} 个镜头
                            </div>
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-1 rounded ${
                          appendToFront 
                            ? 'text-green-400 bg-green-900/30' 
                            : 'text-orange-400 bg-orange-900/30'
                        }`}>
                          {appendToFront ? '← 前置' : '追加 →'}
                        </span>
                      </div>
                    );
                  })}
                
                {/* 显示没有镜头的文件 */}
                {filesWithoutStoryboard.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <p className="text-[10px] text-gray-500 mb-2">以下文件暂无分镜：</p>
                    {filesWithoutStoryboard.map(file => {
                      const fileIndex = files.findIndex(f => f.id === file.id);
                      return (
                        <div
                          key={file.id}
                          className="flex items-center gap-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-lg opacity-50 cursor-not-allowed"
                        >
                          <div className="w-5 h-5 rounded border-2 border-gray-700"></div>
                          <div className="w-10 h-10 rounded-lg bg-gray-700/50 flex items-center justify-center">
                            <Film className="w-5 h-5 text-gray-600" />
                          </div>
                          <div className="text-left">
                            <div className="text-sm text-gray-500 flex items-center gap-2">
                              <span className="text-[10px] font-mono">[{fileIndex + 1}]</span>
                              {file.name}
                            </div>
                            <div className="text-[10px] text-gray-600">无镜头</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {availableFiles.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Film className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">没有其他文件</p>
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-gray-800">
                <div className="text-[10px] text-gray-500">
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
                    className="px-4 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800"
                  >
                    取消
                  </button>
                  <button 
                    onClick={handleConfirmAppend}
                    disabled={selectedAppendFileIds.size === 0}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
          // 合并角色和场景的所有素材
          const allTags = [...(selectedShot.characters || []), ...(selectedShot.scene ? [selectedShot.scene] : [])];
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
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[150]" onClick={() => setLightboxImage(null)}>
            <button 
              onClick={() => setLightboxImage(null)} 
              className="absolute top-6 right-6 text-white hover:text-gray-300 bg-black/50 rounded-full p-2 z-10"
            >
              <X className="w-6 h-6" />
            </button>
            
            {hasPrev && (
              <button
                onClick={(e) => { e.stopPropagation(); showPrev(); }}
                className="absolute left-6 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black/50 rounded-full p-3 z-10"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            
            {hasNext && (
              <button
                onClick={(e) => { e.stopPropagation(); showNext(); }}
                className="absolute right-6 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black/50 rounded-full p-3 z-10"
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
    type: 'character' | 'scene';
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
    onUnbind: () => void;
    onViewImage: (url: string) => void;
}> = ({ name, type, materials, selectedMaterialId, aiGenerating, cameraGenerating, onUpload, onOpenAI, onOpenCamera, onProcessMaterial, onDeleteFromLibrary, onBind, onUnbind, onViewImage }) => {
    
    const boundMaterial = materials.find(m => m.id === selectedMaterialId);
    const hasMaterials = materials.length > 0;

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[520px] shadow-sm hover:shadow-lg hover:border-gray-700 transition-all group">
            <div className={`px-4 py-3 border-b border-gray-800 flex justify-between items-center ${type === 'character' ? 'bg-indigo-950/20' : 'bg-orange-950/20'}`}>
                <div className="flex items-center gap-2">
                    <div className="font-bold text-sm text-gray-100">{name}</div>
                    {selectedMaterialId && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                </div>
                <div className={`text-[9px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider ${type === 'character' ? 'text-indigo-300 border-indigo-500/20 bg-indigo-500/10' : 'text-orange-300 border-orange-500/20 bg-orange-500/10'}`}>
                    {type === 'character' ? 'Character' : 'Scene'}
                </div>
            </div>
            
            {/* Selected Area */}
            <div className="p-4 border-b border-gray-800 bg-gray-950/50 h-[160px] flex gap-4">
                 <div className="w-[120px] flex-shrink-0 bg-black/40 rounded-lg overflow-hidden border border-gray-700/50 relative flex items-center justify-center group-hover:border-gray-600 transition-colors">
                     {boundMaterial ? (
                         <>
                            <img 
                                src={boundMaterial.thumbnail || boundMaterial.url} 
                                alt="Bound" 
                                loading="lazy" 
                                className="w-full h-full object-cover" 
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-60" />
                            <div className="absolute bottom-2 right-2 bg-green-500 text-white p-1 rounded-full shadow-lg">
                                <Lock className="w-3 h-3" />
                            </div>
                         </>
                     ) : (
                         <div className="text-[10px] text-gray-600 text-center px-2 flex flex-col items-center gap-2">
                             <div className="p-2 rounded-full bg-gray-800/50">
                                 <Plus className="w-4 h-4" />
                             </div>
                             未绑定
                         </div>
                     )}
                 </div>
                 <div className="flex-1 flex flex-col justify-center gap-3">
                     <div>
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide block mb-1">当前状态</span>
                        <p className={`text-xs leading-relaxed ${boundMaterial ? 'text-green-400' : 'text-gray-400'}`}>
                            {boundMaterial 
                                ? "已锁定当前及后续镜头。"
                                : "请选择素材。绑定后将自动填充后续所有同名标签。"}
                        </p>
                     </div>
                     {boundMaterial && (
                         <button 
                            onClick={onUnbind}
                            className="text-[10px] bg-red-950/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 px-3 py-1.5 rounded-md self-start flex items-center gap-1.5 transition-all"
                         >
                             <Trash2 className="w-3 h-3" />
                             解除锁定 (及后续)
                         </button>
                     )}
                 </div>
            </div>

            {/* Library Grid */}
            <div className="flex-1 bg-gray-950/30 p-3 overflow-y-auto custom-scrollbar">
                {materials.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600 border-2 border-dashed border-gray-800/50 rounded-lg m-1">
                        <AlertCircle className="w-5 h-5 mb-2 opacity-40" />
                        <span className="text-[10px]">暂无素材，请上传或生成</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-2 pb-2">
                        {materials.map(m => {
                            const isCurrent = m.id === selectedMaterialId;
                            return (
                                <div 
                                    key={m.id} 
                                    className={`relative group/item aspect-square rounded-lg overflow-hidden border cursor-pointer transition-all ${isCurrent ? 'border-green-500 ring-2 ring-green-500/30' : 'border-gray-800 hover:border-indigo-400'}`}
                                    onClick={() => onBind(m.id)}
                                >
                                    <img 
                                        src={m.thumbnail || m.url} 
                                        alt="material" 
                                        loading="lazy" 
                                        className="w-full h-full object-cover transition-transform group-hover/item:scale-110 duration-500"
                                    />
                                    
                                    {/* Hover Actions */}
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/item:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                        {!isCurrent && (
                                            <span className="text-[9px] font-bold text-white uppercase tracking-wider">点击使用</span>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); onViewImage(m.url); }} 
                                                className="p-1.5 bg-indigo-500/80 rounded-full text-white hover:bg-indigo-600 transform hover:scale-110 transition-transform"
                                                title="查看大图"
                                            >
                                                <ZoomIn className="w-3 h-3" />
                                            </button>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onDeleteFromLibrary(m.id); }} 
                                            className="p-1.5 bg-red-500/80 rounded-full text-white hover:bg-red-600 transform hover:scale-110 transition-transform"
                                            title="删除素材"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                        </div>
                                    </div>

                                    {m.source === 'ai' && <div className="absolute top-1 right-1 text-[8px] bg-indigo-600/90 text-white px-1 rounded shadow-sm">AI</div>}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Action Footer */}
            <div className="p-3 border-t border-gray-800 bg-gray-900 grid grid-cols-2 gap-3">
                <label className="flex items-center justify-center gap-2 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg cursor-pointer transition-colors text-xs text-gray-300 font-medium group/btn">
                    <Upload className="w-3.5 h-3.5 group-hover/btn:-translate-y-0.5 transition-transform" />
                    <span>本地上传</span>
                    <input type="file" className="hidden" accept="image/*" onChange={onUpload} />
                </label>
                <button 
                    onClick={onOpenAI}
                    disabled={aiGenerating}
                    className="flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-indigo-900/30 hover:shadow-indigo-900/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group/btn"
                >
                    {aiGenerating ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"></span>
                    ) : (
                        <Sparkles className="w-3.5 h-3.5 group-hover/btn:rotate-12 transition-transform" />
                    )}
                    <span>AI 生成</span>
                </button>
                <button
                    onClick={onOpenCamera}
                    disabled={!hasMaterials || cameraGenerating}
                    className="flex items-center justify-center gap-2 py-2 mt-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold border border-gray-700 hover:border-gray-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {cameraGenerating ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"></span>
                    ) : (
                        <Camera className="w-3.5 h-3.5" />
                    )}
                    <span>角度调整</span>
                </button>
                <button
                    onClick={() => onProcessMaterial('upscale_hd')}
                    disabled={!hasMaterials || cameraGenerating}
                    className="flex items-center justify-center gap-2 py-2 mt-2 bg-blue-900 hover:bg-blue-800 text-blue-200 rounded-lg text-xs font-semibold border border-blue-700 hover:border-blue-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {cameraGenerating ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"></span>
                    ) : (
                        <ZoomIn className="w-3.5 h-3.5" />
                    )}
                    <span>高清放大</span>
                </button>
                <button
                    onClick={() => onProcessMaterial('remove_watermark')}
                    disabled={!hasMaterials || cameraGenerating}
                    className="flex items-center justify-center gap-2 py-2 bg-purple-900 hover:bg-purple-800 text-purple-200 rounded-lg text-xs font-semibold border border-purple-700 hover:border-purple-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {cameraGenerating ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"></span>
                    ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>去水印</span>
                </button>
                {/* 三视图仅对角色启用 */}
                {type === 'character' && (
                    <button
                        onClick={() => onProcessMaterial('three_view')}
                        disabled={!hasMaterials}
                        className="flex items-center justify-center gap-2 py-2 bg-green-900 hover:bg-green-800 text-green-200 rounded-lg text-xs font-semibold border border-green-700 hover:border-green-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <span>三视图</span>
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

    const maxRefs = engine === 'nanobanana' ? 6 : 10;

    useEffect(() => {
        setPrompt(config.defaultPrompt);
        setSelectedRefs(new Set());
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
            prompt: prompt.trim(),
            references,
            geminiModel,
            aspectRatio,
            resolution,
            sequential,
            count
        });
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[120]" onClick={onClose}>
            <div className="w-full max-w-4xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 space-y-6 relative" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">AI 生成素材 - {config.tagName}</h3>
                        <p className="text-xs text-gray-400 mt-1">选择模型与参考图，自定义提示词快速生成角色/场景素材。</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="col-span-1 space-y-3 border border-gray-800 rounded-xl p-4">
                        <span className="text-[11px] font-bold text-gray-500 uppercase">引擎选择</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setEngine('nanobanana')}
                                className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${engine === 'nanobanana' ? 'bg-indigo-600 text-white border-indigo-500' : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'}`}
                            >
                                化神进阶
                            </button>
                            <button
                                onClick={() => setEngine('doubao')}
                                className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${engine === 'doubao' ? 'bg-purple-600 text-white border-purple-500' : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'}`}
                            >
                                筑基境界
                            </button>
                        </div>
                        {engine === 'nanobanana' && (
                            <div className="space-y-2">
                                <span className="text-[11px] font-bold text-gray-500 uppercase">图像模型</span>
                                <div className="flex flex-col gap-2">
                                    {[
                                        { id: 'gemini-2.5-flash-image', label: '化神1阶（快速）', desc: '快速生成，效率优先' },
                                        { id: 'gemini-3-pro-image-preview', label: '化神2阶（高质量）', desc: '高质量生成，效果优先' }
                                    ].map(model => (
                                        <label key={model.id} className={`flex flex-col gap-1 text-xs p-2 rounded border cursor-pointer ${geminiModel === model.id ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-600'}`}>
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
                                                <span className="text-[10px] text-gray-500 ml-5">{model.desc}</span>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <span className="text-[11px] font-bold text-gray-500 uppercase">输出规格</span>
                            <div className="grid grid-cols-2 gap-2">
                                {['1:1', '3:4', '4:3', '9:16', '16:9'].map(ratio => (
                                    <button
                                        key={ratio}
                                        onClick={() => setAspectRatio(ratio)}
                                        className={`py-1.5 rounded text-[11px] border ${aspectRatio === ratio ? 'bg-gray-100 text-gray-900 font-semibold' : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'}`}
                                    >
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                            <select
                                value={resolution}
                                onChange={(e) => setResolution(e.target.value as '1K' | '2K' | '4K')}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg text-xs text-white px-2 py-1.5 focus:outline-none focus:border-indigo-500"
                            >
                                <option value="1K">1K 输出</option>
                                <option value="2K">2K 输出</option>
                                <option value="4K">4K 输出</option>
                            </select>
                        </div>

                        {engine === 'doubao' && (
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-xs text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={sequential === 'auto'}
                                        onChange={(e) => setSequential(e.target.checked ? 'auto' : 'disabled')}
                                    />
                                    生成关联组图
                                </label>
                                {sequential === 'auto' && (
                                    <div className="flex items-center gap-2 text-xs text-gray-300">
                                        <span>张数</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={5}
                                            value={count}
                                            onChange={(e) => setCount(Math.min(5, Math.max(1, Number(e.target.value))))}
                                            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-purple-500"
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="col-span-2 space-y-4">
                        <div>
                            <span className="text-[11px] font-bold text-gray-500 uppercase block mb-1">提示词</span>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                rows={5}
                                className="w-full bg-gray-900 border border-gray-700 rounded-xl text-sm text-white p-3 focus:outline-none focus:border-indigo-500 resize-none"
                                placeholder={selectedRefs.size > 0 ? "描述你想要的变化，例如：换一个姿势、改变背景、添加道具等。AI会参考你选择的图片风格。" : "描述你想要生成的内容"}
                            />
                            {selectedRefs.size > 0 && (
                                <div className="mt-2 flex items-start gap-2 p-2 bg-indigo-900/20 border border-indigo-700/30 rounded-lg">
                                    <div className="text-indigo-400 mt-0.5">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div className="flex-1 text-xs text-indigo-200 leading-relaxed">
                                        <strong>💡 提示：</strong>你已选择 {selectedRefs.size} 张参考图，AI会严格遵循参考图的画风、构图和角色设计。建议在提示词中描述你想要的<strong>改变或变化</strong>，而不是重复描述参考图中已有的元素。
                                    </div>
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2">
                                <span className="font-bold uppercase">参考图 (可多选，最多 {maxRefs} 张)</span>
                                <span className={selectedRefs.size > 0 ? "text-emerald-400 font-semibold" : ""}>{selectedRefs.size}/{maxRefs}</span>
                            </div>
                            {config.materials.length === 0 ? (
                                <div className="border border-dashed border-gray-700 rounded-xl text-center py-6 text-xs text-gray-500">
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
                                                className={`relative aspect-square rounded-lg overflow-hidden border ${active ? 'border-emerald-400 ring-2 ring-emerald-500/40' : 'border-gray-700'}`}
                                                type="button"
                                            >
                                                <img src={material.thumbnail || material.url} loading="lazy" className="w-full h-full object-cover" />
                                                {active && <div className="absolute inset-0 bg-emerald-600/30"></div>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800">取消</button>
                    <button onClick={handleSubmit} className="px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-xs font-bold text-white shadow-lg shadow-indigo-900/30 hover:shadow-indigo-900/50">开始生成</button>
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
        if (!currentMaterial) {
            alert('请选择一张素材图片');
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
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span>{label}</span>
                    <span className="font-semibold text-white">{value}</span>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="range"
                        min={0}
                        max={values.length - 1}
                        step={1}
                        value={displayIndex}
                        onChange={(e) => onChange(values[Number(e.target.value)])}
                        className="flex-1 accent-indigo-500"
                    />
                </div>
                <div className="flex justify-between text-[9px] text-gray-500">
                    {values.map((v, i) => (
                        <span key={i} className={value === v ? 'text-indigo-400 font-semibold' : ''}>{v}</span>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
            <div className="w-full max-w-5xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">角度调整 - {config.tagName}</h3>
                        <p className="text-xs text-gray-400 mt-1">基于现有素材重建镜头角度，保持角色/场景一致性。</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="relative rounded-2xl overflow-hidden border border-gray-800 h-72 bg-black/30 flex items-center justify-center">
                            {currentMaterial ? (
                                <img src={currentMaterial.url} loading="lazy" className="w-full h-full object-contain" />
                            ) : (
                                <span className="text-xs text-gray-500">暂无素材</span>
                            )}
                        </div>
                        <div className="grid grid-cols-5 gap-2 max-h-32 overflow-y-auto pr-1">
                            {config.materials.map(material => (
                                <button
                                    key={material.id}
                                    onClick={() => setSelectedMaterialId(material.id)}
                                    className={`relative aspect-square rounded-lg overflow-hidden border ${selectedMaterialId === material.id ? 'border-emerald-400 ring-2 ring-emerald-500/40' : 'border-gray-700'}`}
                                >
                                    <img src={material.thumbnail || material.url} loading="lazy" className="w-full h-full object-cover" />
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-5">
                        <div className="space-y-3 bg-gray-950/30 border border-gray-800 rounded-xl p-4">
                            <h4 className="text-xs font-bold text-gray-400 uppercase">镜头控制</h4>
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
                            <label className="flex items-center gap-2 text-xs text-gray-300">
                                <input type="checkbox" checked={wideAngle} onChange={(e) => setWideAngle(e.target.checked)} />
                                启用广角透视
                            </label>
                        </div>

                        <div className="space-y-2">
                            <span className="text-[11px] font-bold text-gray-500 uppercase">自定义提示词 (可覆盖镜头设定)</span>
                            <textarea
                                rows={3}
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg text-sm text-white p-3 focus:outline-none focus:border-indigo-500 resize-none"
                                placeholder="输入更详细的场景描述或留空使用自动提示..."
                            />
                            <div className="flex flex-wrap gap-1 mt-2">
                                {promptExamples.map((example, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setCustomPrompt(example)}
                                        className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-indigo-600 text-gray-400 hover:text-white rounded border border-gray-700 hover:border-indigo-500 transition-colors"
                                    >
                                        {example.split('（')[0]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-gray-300">
                            <div className="flex items-center gap-2">
                                <span>随机种子</span>
                                <input
                                    type="number"
                                    value={seed}
                                    onChange={(e) => setSeed(Number(e.target.value))}
                                    className="w-32 bg-gray-900 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
                                />
                            </div>
                            <button onClick={() => setSeed(randomSeed())} className="px-2 py-1 rounded border border-gray-700 hover:border-indigo-500 hover:text-white transition-colors">
                                随机
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800">取消</button>
                    <button onClick={handleSubmit} className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-blue-500 text-xs font-bold text-white shadow-lg shadow-emerald-900/30 hover:shadow-emerald-900/50">生成新角度</button>
                </div>
            </div>
        </div>
    );
};

const ProcessModal: React.FC<{
    config: ProcessModalConfig;
    onClose: () => void;
    onSubmit: (materialId: string) => void;
}> = ({ config, onClose, onSubmit }) => {
    const [selectedMaterialId, setSelectedMaterialId] = useState<string>(config.selectedMaterialId);

    const currentMaterial = config.materials.find(m => m.id === selectedMaterialId) || config.materials[0];

    useEffect(() => {
        setSelectedMaterialId(config.selectedMaterialId || config.materials[0]?.id);
    }, [config]);

    const handleSubmit = () => {
        if (!currentMaterial) {
            alert('请选择一张素材图片');
            return;
        }
        onSubmit(selectedMaterialId);
    };

    const workflowNames = {
        'upscale_hd': { title: '高清放大', desc: '使用AI放大图片到4K分辨率，保持清晰度' },
        'remove_watermark': { title: '去水印', desc: '智能移除图片水印，保持画面完整性' }
    };

    const workflowInfo = workflowNames[config.workflow];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
            <div className="w-full max-w-3xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">{workflowInfo.title} - {config.tagName}</h3>
                        <p className="text-xs text-gray-400 mt-1">{workflowInfo.desc}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 左侧：当前素材预览 */}
                    <div className="space-y-4">
                        <div className="relative rounded-2xl overflow-hidden border border-gray-800 h-72 bg-black/30 flex items-center justify-center">
                            {currentMaterial ? (
                                <img src={currentMaterial.url} loading="lazy" className="w-full h-full object-contain" alt="素材预览" />
                            ) : (
                                <span className="text-xs text-gray-500">暂无素材</span>
                            )}
                        </div>
                        <div className="text-center text-xs text-gray-400">
                            当前选中的素材
                        </div>
                    </div>

                    {/* 右侧：素材选择 */}
                    <div className="space-y-4">
                        <div>
                            <span className="text-[11px] font-bold text-gray-500 uppercase mb-2 block">选择要处理的素材</span>
                            <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto p-2 bg-gray-950 rounded-lg border border-gray-800">
                                {config.materials.map((mat) => (
                                    <button
                                        key={mat.id}
                                        onClick={() => setSelectedMaterialId(mat.id)}
                                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                                            selectedMaterialId === mat.id
                                                ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                                                : 'border-transparent hover:border-gray-600'
                                        }`}
                                    >
                                        <img src={mat.thumbnail || mat.url} loading="lazy" className="w-full h-full object-cover" alt="素材" />
                                        {selectedMaterialId === mat.id && (
                                            <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                                                <Check className="w-6 h-6 text-white" />
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 底部按钮 */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800">取消</button>
                    <button onClick={handleSubmit} className={`px-5 py-2 rounded-lg text-xs font-bold text-white shadow-lg ${
                        config.workflow === 'upscale_hd' 
                            ? 'bg-gradient-to-r from-blue-500 to-cyan-500 shadow-blue-900/30 hover:shadow-blue-900/50'
                            : 'bg-gradient-to-r from-purple-500 to-pink-500 shadow-purple-900/30 hover:shadow-purple-900/50'
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
    const [prompt, setPrompt] = useState<string>('Create a four-panel turnaround for this figure to show frontal, right side, left side and back, in a white background.');

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
        <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
            <div className="w-full max-w-3xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">三视图生成 - {config.tagName}</h3>
                        <p className="text-xs text-gray-400 mt-1">为角色生成正面、侧面、背面的四视图参考</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 左侧：当前素材预览 */}
                    <div className="space-y-4">
                        <div className="relative rounded-2xl overflow-hidden border border-gray-800 h-72 bg-black/30 flex items-center justify-center">
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
                                <span className="text-xs text-gray-500">
                                    {currentMaterial ? '素材URL无效' : '暂无素材'}
                                </span>
                            )}
                        </div>
                        <div className="text-center text-xs text-gray-400">
                            当前选中的素材
                        </div>
                    </div>

                    {/* 右侧：素材选择 */}
                    <div className="space-y-4">
                        <div>
                            <span className="text-[11px] font-bold text-gray-500 uppercase mb-2 block">选择要处理的素材</span>
                            <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto p-2 bg-gray-950 rounded-lg border border-gray-800">
                                {config.materials.map((mat) => (
                                    <button
                                        key={mat.id}
                                        onClick={() => setSelectedMaterialId(mat.id)}
                                        className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                                            selectedMaterialId === mat.id
                                                ? 'border-green-500 shadow-lg shadow-green-900/50'
                                                : 'border-transparent hover:border-gray-600'
                                        }`}
                                    >
                                        {mat.url ? (
                                            <img 
                                                src={mat.url} 
                                                loading="lazy" 
                                                className="w-full h-20 object-cover" 
                                                alt="素材"
                                                onError={(e) => {
                                                    e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
                                                    console.error('❌ 缩略图加载失败:', mat.id, mat.url);
                                                }}
                                            />
                                        ) : (
                                            <div className="w-full h-20 flex items-center justify-center bg-gray-800">
                                                <span className="text-xs text-gray-500">无效</span>
                                            </div>
                                        )}
                                        {selectedMaterialId === mat.id && (
                                            <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                                                <CheckCircle className="w-5 h-5 text-green-400" />
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 提示词输入 */}
                <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">生成提示词</label>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="输入生成提示词..."
                        className="w-full h-24 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 resize-none focus:outline-none focus:border-green-500 transition-colors"
                        spellCheck={false}
                    />
                    <p className="text-[10px] text-gray-500">
                        💡 提示：描述需要生成的视图角度和背景要求
                    </p>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800">取消</button>
                    <button onClick={handleSubmit} className="px-5 py-2 rounded-lg text-xs font-bold text-white shadow-lg bg-gradient-to-r from-green-500 to-emerald-500 shadow-green-900/30 hover:shadow-green-900/50">
                        开始生成
                    </button>
                </div>
            </div>
        </div>
    );
};