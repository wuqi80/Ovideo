

import React, { useEffect, useRef, useState } from 'react';
import { ProjectFile, StoryboardItem, FileVersion } from '../types';
import { LayoutDashboard, Film, Image as ImageIcon, Copy, Users, MapPin, Download, RefreshCw, Lock, Unlock, Trash2, PlusCircle, AlertOctagon, MessageSquare, Edit2, Check, X, Undo2, Redo2, ArrowRight, Save, History, Clock, Plus, FolderInput, Sparkles, CheckCircle } from 'lucide-react';

interface StoryboardColumnProps {
  selectedFile: ProjectFile | undefined;
  onGenerateStoryboard: (fileId: string) => Promise<void>;
  isProcessing: boolean;
  
  // 🆕 新增props
  generationProgress: { current: number; total: number } | null;
  processingType?: 'rewrite' | 'generate-shots' | null; // 🆕 区分处理类型
  aiModel?: any;  // 用于批量操作
  
  isExpanded: boolean;
  onToggleExpand: () => void;
  onHighlightScript: (selectedIds: Set<string>) => void;
  highlightedItemIds: Set<string>;
  onLockItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onRegenerateItem: (id: string, instruction?: string) => void;
  onUpdateItem: (id: string, updates: Partial<StoryboardItem>) => void;
  onExport: () => void;
  isExporting?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSaveVersion: (name: string) => void;
  onRestoreStoryboard: (version: FileVersion) => void;
  onDeleteVersion: (versionId: string) => void;  // 🆕 删除版本
  onImportProject: () => void;
  onInsertShot: (position: number, shotData: Omit<StoryboardItem, 'id'>) => Promise<void>;
  onInsertShotWithAI: (position: number, originalText: string) => Promise<void>;
  // 🔧 已移除 userRequirements - 新流程中镜头详情由规则自动解析生成
}

export const StoryboardColumn: React.FC<StoryboardColumnProps> = ({ 
  selectedFile,
  processingType, // 🆕 接收处理类型
  onGenerateStoryboard,
  onHighlightScript,
  highlightedItemIds,
  onLockItem,
  onDeleteItem,
  onRegenerateItem,
  onUpdateItem,
  onExport,
  isExporting,
  isProcessing,
  
  // 🆕 新增props
  generationProgress,
  aiModel,
  
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSaveVersion,
  onRestoreStoryboard,
  onDeleteVersion,  // 🆕 删除版本
  onImportProject,
  onInsertShot,
  onInsertShotWithAI
}) => {
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [regenInputId, setRegenInputId] = useState<string | null>(null);
  const [regenInstruction, setRegenInstruction] = useState('');
  
  const [showHistory, setShowHistory] = useState(false);
  const [isNamingVersion, setIsNamingVersion] = useState(false);
  const [versionName, setVersionName] = useState('');
  
  
  // 🆕 配置模板系统
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<Array<{
    id: string;
    name: string;
    config: {
      userRequirements?: string;
      defaultStyle?: string;
      aspectRatio?: string;
      imageSize?: string;
    };
    timestamp: number;
  }>>([]);
  const [currentTemplate, setCurrentTemplate] = useState<string>('');
  
  // 加载保存的模板
  useEffect(() => {
    const saved = localStorage.getItem('storyboard_templates');
    if (saved) {
      try {
        setSavedTemplates(JSON.parse(saved));
      } catch (e) {
        console.error('加载模板失败:', e);
      }
    }
  }, []);
  
  // 保存模板
  const saveTemplate = (name: string, config: any) => {
    const newTemplate = {
      id: Date.now().toString(),
      name,
      config,
      timestamp: Date.now()
    };
    const updated = [...savedTemplates, newTemplate];
    setSavedTemplates(updated);
    localStorage.setItem('storyboard_templates', JSON.stringify(updated));
    console.log('✅ 模板已保存:', name);
  };

  // Tag Adding State
  const [addingTagToItem, setAddingTagToItem] = useState<string | null>(null);
  const [tagInputType, setTagInputType] = useState<'character' | 'scene'>('character');
  const [tagInputValue, setTagInputValue] = useState('');

  // ✨ 插入新分镜状态
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [insertPosition, setInsertPosition] = useState<number>(-1); // 插入位置（索引）
  const [insertMode, setInsertMode] = useState<'manual' | 'ai'>('manual'); // 手动填写 or AI生成
  const [showScriptSelector, setShowScriptSelector] = useState(false); // 显示脚本选择器
  const [newShotData, setNewShotData] = useState({
    originalText: '',
    scriptSegment: '',
    imagePrompt: '',
    videoPrompt: '',
    dialogue: '',
    characters: '',
    scene: ''
  });

  // 🎬 Loading动画文字循环
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const loadingSteps = [
    'AI正在分析剧本结构',
    '正在做文本映射',
    '正在提取场景信息',
    '正在提取人物角色',
    '正在生成视频提示词',
    '正在生成图像提示词',
    '正在优化镜头衔接',
    '正在完善分镜细节'
  ];

  // 🎬 Loading文字动画效果
  useEffect(() => {
    if (isProcessing) {
      setLoadingStepIndex(0);
      const interval = setInterval(() => {
        setLoadingStepIndex(prev => (prev + 1) % loadingSteps.length);
      }, 2000); // 每2秒切换一次
      return () => clearInterval(interval);
    }
  }, [isProcessing]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };
  
  // 🔧 恢复自动滚动：无论是点击卡片还是框选脚本，都滚动到第一个高亮项
  useEffect(() => {
    if (highlightedItemIds.size > 0) {
      const firstId = Array.from(highlightedItemIds)[0];
      const element = itemRefs.current.get(firstId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightedItemIds]);

  // 🔧 恢复自动滚动功能 - 框选脚本和点击卡片都需要滚动
  useEffect(() => {
    if (highlightedItemIds.size > 0) {
      const firstId = Array.from(highlightedItemIds)[0];
      const element = itemRefs.current.get(firstId);
      if (element) {
        // 使用 setTimeout 避免与其他 DOM 操作冲突
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    }
  }, [highlightedItemIds]);

  const handleCardClick = (e: React.MouseEvent, id: string) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;

    e.stopPropagation();
    
    const newSet = new Set(highlightedItemIds);
    if (e.metaKey || e.ctrlKey) {
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
    } else {
        if (newSet.has(id) && newSet.size === 1) {
             // 点击已选中的卡片 - 保持选中
        } else {
            newSet.clear();
            newSet.add(id);
        }
    }
    
    onHighlightScript(newSet);
    // 🔧 滚动由 useEffect 自动处理
  };

  // ✨ 打开插入分镜模态框
  const handleOpenInsertModal = (position: number) => {
    setInsertPosition(position);
    setShowInsertModal(true);
    setInsertMode('manual');
    setNewShotData({
      originalText: '',
      scriptSegment: '',
      imagePrompt: '',
      videoPrompt: '',
      dialogue: '',
      characters: '',
      scene: ''
    });
  };

  // ✨ 处理插入分镜
  const handleInsertShot = async () => {
    if (!newShotData.originalText.trim()) {
      alert('请填写对应的原文段落');
      return;
    }

    if (insertMode === 'manual') {
      // 手动模式：需要填写所有字段
      if (!newShotData.scriptSegment.trim()) {
        alert('请填写场景描述');
        return;
      }
      
      await onInsertShot(insertPosition, {
        originalText: newShotData.originalText.trim(),
        scriptSegment: newShotData.scriptSegment.trim(),
        imagePrompt: newShotData.imagePrompt.trim(),
        videoPrompt: newShotData.videoPrompt.trim(),
        dialogue: newShotData.dialogue.trim(),
        characters: newShotData.characters.split(',').map(c => c.trim()).filter(c => c),
        scene: newShotData.scene.trim()
      });
    } else {
      // AI模式：只需要原文段落
      await onInsertShotWithAI(insertPosition, newShotData.originalText.trim());
    }

    setShowInsertModal(false);
  };

  const handleStartRegen = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setRegenInputId(id);
      setRegenInstruction('');
  };

  const handleConfirmRegen = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onRegenerateItem(id, regenInstruction);
      setRegenInputId(null);
  };

  const handleCancelRegen = (e: React.MouseEvent) => {
      e.stopPropagation();
      setRegenInputId(null);
  };
  
  const handleSaveClick = () => {
      setIsNamingVersion(true);
      const count = selectedFile?.versions?.length || 0;
      setVersionName(`项目存档 v${count + 1} - ${new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})}`);
  };

  const submitVersionSave = () => {
      if(versionName.trim()) {
          onSaveVersion(versionName);
          setIsNamingVersion(false);
      }
  };

  // Tag Management
  const handleAddTagClick = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setAddingTagToItem(id);
      setTagInputType('character');
      setTagInputValue('');
  };

  const submitAddTag = (item: StoryboardItem) => {
      if (!tagInputValue.trim()) {
          setAddingTagToItem(null);
          return;
      }
      
      if (tagInputType === 'character') {
          // Prevent duplicates
          if (!item.characters.includes(tagInputValue.trim())) {
             onUpdateItem(item.id, { characters: [...item.characters, tagInputValue.trim()] });
          }
      } else {
          onUpdateItem(item.id, { scene: tagInputValue.trim() });
      }
      setAddingTagToItem(null);
      setTagInputValue('');
  };

  const handleRemoveCharacter = (e: React.MouseEvent, item: StoryboardItem, charName: string) => {
      e.stopPropagation();
      if (confirm(`确定删除角色标签 "${charName}" 吗？`)) {
          onUpdateItem(item.id, { characters: item.characters.filter(c => c !== charName) });
      }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 relative">
       <div className="h-[52px] px-4 border-b border-gray-800 bg-gray-850 flex-shrink-0 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                4. 镜头设计
            </h2>
             <div className="flex items-center gap-2">
                 {/* 🔧 分镜详情由解析器自动填入，无需单独按钮 */}
                 
                 {/* Version Controls - Always visible if file selected */}
                 <div className="flex items-center gap-2 border-r border-gray-700 pr-2 mr-1">
                     <button 
                         onClick={handleSaveClick}
                         disabled={!selectedFile}
                         className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-300 hover:text-white bg-gray-800 hover:bg-indigo-600 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                         title="保存当前分镜版本"
                     >
                         <Save className="w-3.5 h-3.5" />
                         <span>保存</span>
                     </button>

                     <button 
                         onClick={() => setShowHistory(!showHistory)}
                         disabled={!selectedFile}
                         className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                            ${showHistory ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'}`}
                         title="查看历史版本"
                     >
                         <History className="w-3.5 h-3.5" />
                         <span>历史版本</span>
                     </button>
                 </div>

                 {/* Undo/Redo */}
                 <div className="flex items-center gap-1 border-r border-gray-700 pr-2">
                     <button onClick={onUndo} disabled={!canUndo} className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 rounded hover:bg-gray-800">
                         <Undo2 className="w-4 h-4" />
                     </button>
                     <button onClick={onRedo} disabled={!canRedo} className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 rounded hover:bg-gray-800">
                         <Redo2 className="w-4 h-4" />
                     </button>
                 </div>
                 
                {selectedFile?.storyboard && (
                    <>
                    <button 
                        onClick={onExport}
                        disabled={isExporting}
                        className={`flex items-center gap-1 text-[10px] text-white px-3 py-1.5 rounded shadow-sm transition-colors font-bold ${isExporting ? 'bg-gray-500 cursor-wait' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                    >
                        {isExporting ? '导出中...' : '全部导出'}
                        {!isExporting && <ArrowRight className="w-3 h-3" />}
                      </button>
                    </>
                )}
            </div>
      </div>
      
      {/* Toolbar - 固定高度52px，与其他栏目对齐 */}
      <div className="h-[52px] px-3 border-b border-gray-800 bg-gray-900/50 flex items-center">
        {selectedFile?.storyboard ? (
          <div className="w-full flex items-center gap-2 px-3 py-2 bg-indigo-900/20 border border-indigo-500/30 rounded-lg text-xs text-indigo-400">
            <Film className="w-4 h-4" />
            <span>共 {selectedFile.storyboard.items.filter(i => !i.isPlaceholder).length} 个镜头</span>
          </div>
        ) : (
          <div className="w-full text-center text-xs text-gray-600">等待分镜生成...</div>
        )}
      </div>

      {/* Save Version Modal/Popover */}
      {isNamingVersion && (
          <div className="absolute top-14 right-4 z-50 bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-3 w-64 animate-in fade-in slide-in-from-top-2">
              <h4 className="text-xs font-bold text-gray-300 mb-1">保存当前版本</h4>
              <p className="text-[10px] text-gray-500 mb-2">包含剧本、分镜、提示词等所有内容</p>
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

      {/* History List Panel */}
      {showHistory && selectedFile && (
          <div className="absolute top-[52px] right-0 bottom-0 w-80 bg-gray-900 border-l border-gray-800 z-40 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
               <div className="p-3 border-b border-gray-800 flex flex-col gap-1 bg-gray-850">
                   <div className="flex items-center justify-between">
                   <h3 className="text-xs font-bold text-gray-300 flex items-center gap-2">
                       <Clock className="w-4 h-4 text-indigo-400" />
                           历史版本
                   </h3>
                   <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-white">
                       <X className="w-4 h-4" />
                   </button>
                   </div>
                   <p className="text-[10px] text-gray-500">包含剧本、分镜、提示词等所有内容</p>
               </div>
               <div className="flex-1 overflow-y-auto p-2 space-y-2">
                   {selectedFile.versions && selectedFile.versions.length > 0 ? (
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
                                          if(confirm(`确定要加载存档 "${ver.name}" 吗？\n当前未保存的修改将丢失。`)) {
                                              onRestoreStoryboard(ver);
                                              setShowHistory(false);
                                          }
                                      }}
                                      disabled={!ver.data.storyboard}
                                      className="flex-1 py-1.5 bg-indigo-900/50 hover:bg-indigo-600 border border-indigo-500/30 rounded text-[10px] text-indigo-200 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 group-hover:border-indigo-500"
                                   >
                                       <RefreshCw className="w-3 h-3" />
                                       {ver.data.storyboard ? '恢复此版本' : '无数据'}
                                   </button>
                                   {/* 🆕 删除按钮 */}
                                   <button 
                                      onClick={() => {
                                          if(confirm(`确定要删除存档 "${ver.name}" 吗？\n此操作不可恢复。`)) {
                                              onDeleteVersion(ver.id);
                                          }
                                      }}
                                      className="p-1.5 bg-red-900/30 hover:bg-red-600 border border-red-500/30 rounded text-red-400 hover:text-white transition-colors flex items-center justify-center"
                                      title="删除此版本"
                                   >
                                       <Trash2 className="w-3 h-3" />
                                   </button>
                               </div>
                           </div>
                       ))
                   ) : (
                       <div className="flex flex-col items-center justify-center py-10 text-gray-500 gap-2">
                           <History className="w-8 h-8 opacity-20" />
                           <div className="text-center text-xs">
                               暂无保存的历史记录<br/>
                               请点击上方 <span className="text-indigo-400 font-bold">保存</span> 按钮创建存档
                           </div>
                       </div>
                   )}
               </div>
          </div>
      )}

      {selectedFile?.storyboard && selectedFile.storyboard.items.length > 0 ? (
        /* 有分镜数据 - 显示卡片列表（生成中也显示） */
        <div className="flex-1 overflow-y-auto p-4 bg-gray-950/50 custom-scrollbar space-y-4 relative">
          
          {/* 🆕 顶部进度条（生成中时显示） */}
          {isProcessing && generationProgress && (
            <div className="sticky top-0 z-40 -mx-4 -mt-4 mb-4 p-4 bg-gray-900/95 backdrop-blur-sm border-b border-gray-700 shadow-lg">
              <div className="flex items-center gap-4">
                <Film className="w-5 h-5 text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white">
                      正在生成分镜详情...
                    </span>
                    <span className="text-xs text-gray-400">
                      {generationProgress.current} / {generationProgress.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-300"
                      style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-lg font-bold text-indigo-400">
                  {Math.round((generationProgress.current / generationProgress.total) * 100)}%
                </span>
              </div>
            </div>
          )}
          
          {/* 在第一个卡片前添加插入按钮 */}
          <button
            onClick={() => handleOpenInsertModal(0)}
            className="w-full py-2 border border-dashed border-gray-700 hover:border-indigo-500 rounded-lg text-gray-500 hover:text-indigo-400 transition-all flex items-center justify-center gap-2 text-xs bg-gray-900/30 hover:bg-gray-800"
          >
            <Plus className="w-3 h-3" />
            在此插入新分镜
          </button>
          
          {selectedFile.storyboard.items.map((item, idx) => {
            const isHighlighted = highlightedItemIds.has(item.id);
            const isGenerating = isProcessing && generationProgress && idx >= generationProgress.current;
            const hasDetails = !!item.imagePrompt;

            // 🆕 正在生成中的卡片（Loading占位符）
            if (isGenerating && !hasDetails) {
              return (
                <React.Fragment key={item.id}>
                  <div className="border-2 border-dashed border-indigo-500/30 rounded-xl p-6 flex flex-col items-center justify-center bg-gray-900/50 gap-3 animate-pulse">
                    <div className="relative">
                      <div className="absolute inset-0 bg-indigo-500 rounded-full blur-md opacity-20 animate-pulse" />
                      <Sparkles className="w-8 h-8 text-indigo-400 relative animate-spin" style={{ animationDuration: '2s' }} />
                    </div>
                    <span className="text-sm font-medium text-gray-400">
                      镜头 #{idx + 1} 生成中...
                    </span>
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-1.5 h-1.5 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                  </div>
                  
                  {/* 插入按钮 */}
                  <button
                    onClick={() => handleOpenInsertModal(idx + 1)}
                    className="w-full py-2 border border-dashed border-gray-700 hover:border-indigo-500 rounded-lg text-gray-500 hover:text-indigo-400 transition-all flex items-center justify-center gap-2 text-xs bg-gray-900/30 hover:bg-gray-800"
                  >
                    <Plus className="w-3 h-3" />
                    在此插入新分镜
                  </button>
                </React.Fragment>
              );
            }

            // Placeholder Render
            if (item.isPlaceholder) {
                return (
                    <div 
                        key={item.id}
                        className="border-2 border-dashed border-gray-800 rounded-xl p-4 flex flex-col items-center justify-center text-gray-600 bg-gray-900/50 gap-2 hover:border-gray-700 transition-colors"
                    >
                         <AlertOctagon className="w-6 h-6 text-gray-700" />
                         <span className="text-xs font-mono">缺失分镜 (Placeholder)</span>
                         <p className="text-[10px] text-gray-500 text-center line-clamp-2 max-w-[80%]">"{item.scriptSegment}"</p>
                         {/* 🔧 已移除"重新生成此镜头"按钮 - 新流程中镜头由规则自动解析生成 */}
                    </div>
                );
            }

            return (
              <React.Fragment key={item.id}>
              <div 
                  ref={(el) => { if (el) itemRefs.current.set(item.id, el); }}
                  className={`group relative bg-gray-900 border rounded-xl overflow-hidden transition-all duration-300 shadow-sm
                    ${isHighlighted 
                        ? 'border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)] ring-1 ring-indigo-500/50 scale-[1.02]' 
                        : 'border-gray-800 hover:border-indigo-500/30 hover:shadow-lg'
                    }
                  `}
                  onClick={(e) => handleCardClick(e, item.id)}
              >
                  {/* Shot Header */}
                  <div className={`px-3 py-2 border-b flex justify-between items-center
                      ${isHighlighted ? 'bg-indigo-900/20 border-indigo-500/30' : 'bg-gray-850 border-gray-800'}
                  `}>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold transition-colors ${isHighlighted ? 'text-indigo-300' : 'text-gray-400 group-hover:text-indigo-400'}`}>
                            镜头 {String(idx + 1).padStart(2, '0')}
                        </span>
                        {item.isLocked && <Lock className="w-3 h-3 text-yellow-500" />}
                      </div>
                      
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button 
                            onClick={(e) => { e.stopPropagation(); onLockItem(item.id); }}
                            className={`p-1 rounded hover:bg-gray-700 ${item.isLocked ? 'text-yellow-500' : 'text-gray-500 hover:text-yellow-400'}`}
                            title={item.isLocked ? "解锁" : "锁定 (防止修改)"}
                         >
                             {item.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                         </button>
                         {/* 🔧 已移除"重新生成提示词"按钮 - 新流程中提示词由规则自动解析生成 */}
                         <button 
                            onClick={(e) => { e.stopPropagation(); onDeleteItem(item.id); }}
                            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
                            title="删除 (保留剧本占位)"
                         >
                             <Trash2 className="w-3 h-3" />
                         </button>
                      </div>
                  </div>

                  <div className="p-3 space-y-3">
                      
                      {/* Tags Section */}
                      <div className="flex flex-wrap gap-2 mb-2 items-center">
                          {item.characters && item.characters.map((char, i) => (
                              <div 
                                key={`c-${i}`} 
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-950 border border-indigo-500/20 text-[9px] text-indigo-300 hover:bg-red-900/50 hover:border-red-500/30 hover:text-red-300 cursor-pointer transition-colors group/tag"
                                onClick={(e) => handleRemoveCharacter(e, item, char)}
                                title="点击删除角色"
                              >
                                  <Users className="w-2.5 h-2.5" />
                                  {char}
                                  <X className="w-2 h-2 opacity-0 group-hover/tag:opacity-100" />
                              </div>
                          ))}
                          {item.scene && (
                              <div 
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-950 border border-orange-500/20 text-[9px] text-orange-300 cursor-pointer hover:bg-orange-900/50"
                                onClick={(e) => { e.stopPropagation(); setAddingTagToItem(item.id); setTagInputType('scene'); setTagInputValue(item.scene); }}
                                title="点击修改场景"
                              >
                                  <MapPin className="w-2.5 h-2.5" />
                                  {item.scene}
                              </div>
                          )}

                          {/* Add Tag Button */}
                          <button 
                            onClick={(e) => handleAddTagClick(e, item.id)}
                            className="p-0.5 rounded bg-gray-800 text-gray-500 hover:text-white hover:bg-gray-700 transition-colors"
                            title="手动添加标签"
                          >
                             <Plus className="w-3 h-3" />
                          </button>
                      </div>

                       {/* Tag Adding Input */}
                      {addingTagToItem === item.id && (
                          <div className="mb-2 p-2 bg-gray-800 rounded border border-indigo-500/50 flex flex-col gap-2 animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
                              <div className="flex gap-2">
                                  <button 
                                    onClick={() => setTagInputType('character')}
                                    className={`flex-1 text-[9px] py-1 rounded border ${tagInputType === 'character' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-gray-700 text-gray-400 border-gray-600'}`}
                                  >
                                      角色 (Character)
                                  </button>
                                  <button 
                                    onClick={() => setTagInputType('scene')}
                                    className={`flex-1 text-[9px] py-1 rounded border ${tagInputType === 'scene' ? 'bg-orange-600 text-white border-orange-500' : 'bg-gray-700 text-gray-400 border-gray-600'}`}
                                  >
                                      场景 (Scene)
                                  </button>
                              </div>
                              <div className="flex gap-1">
                                <input 
                                    type="text" 
                                    autoFocus
                                    value={tagInputValue}
                                    onChange={(e) => setTagInputValue(e.target.value)}
                                    placeholder={tagInputType === 'character' ? "输入角色名..." : "输入场景名..."}
                                    className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitAddTag(item);
                                        if (e.key === 'Escape') setAddingTagToItem(null);
                                    }}
                                />
                                <button onClick={() => submitAddTag(item)} className="px-2 bg-green-600 hover:bg-green-500 text-white rounded"><Check className="w-3 h-3" /></button>
                                <button onClick={() => setAddingTagToItem(null)} className="px-2 bg-gray-600 hover:bg-gray-500 text-white rounded"><X className="w-3 h-3" /></button>
                              </div>
                          </div>
                      )}

                      {/* Editable Dialogue */}
                      <div className="space-y-1">
                          <div className="flex items-center justify-between">
                               <span className="text-[10px] font-bold text-green-500 flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" />
                                  人物台词
                               </span>
                          </div>
                          <textarea
                              className="w-full text-xs text-gray-300 bg-gray-800/50 p-2 rounded border border-gray-700/50 resize-none focus:outline-none focus:border-green-500/50 focus:bg-gray-800"
                              rows={2}
                              value={item.dialogue || ''}
                              onChange={(e) => onUpdateItem(item.id, { dialogue: e.target.value })}
                              placeholder="无对白..."
                              disabled={item.isLocked}
                          />
                      </div>

                      {/* Editable Image Prompt */}
                      <div className="space-y-1">
                          <div className="flex items-center justify-between">
                               <span className="text-[10px] font-bold text-cyan-500 flex items-center gap-1">
                                  <ImageIcon className="w-3 h-3" />
                                  生图 Prompt
                               </span>
                               <button onClick={(e) => { e.stopPropagation(); copyToClipboard(item.imagePrompt); }} className="text-gray-500 hover:text-white">
                                  <Copy className="w-3 h-3" />
                               </button>
                          </div>
                          <textarea
                              className="w-full text-xs text-gray-300 bg-gray-800/50 p-2 rounded border border-gray-700/50 resize-none focus:outline-none focus:border-cyan-500/50 focus:bg-gray-800"
                              rows={3}
                              value={item.imagePrompt}
                              onChange={(e) => onUpdateItem(item.id, { imagePrompt: e.target.value })}
                              disabled={item.isLocked}
                          />
                      </div>

                      {/* Editable Video Prompt */}
                      <div className="space-y-1">
                           <div className="flex items-center justify-between">
                               <span className="text-[10px] font-bold text-purple-500 flex items-center gap-1">
                                  <Film className="w-3 h-3" />
                                  视频 Prompt
                               </span>
                               <button onClick={(e) => { e.stopPropagation(); copyToClipboard(item.videoPrompt); }} className="text-gray-500 hover:text-white">
                                  <Copy className="w-3 h-3" />
                               </button>
                          </div>
                          <textarea
                              className="w-full text-xs text-gray-300 bg-gray-800/50 p-2 rounded border border-gray-700/50 resize-none focus:outline-none focus:border-purple-500/50 focus:bg-gray-800"
                              rows={2}
                              value={item.videoPrompt}
                              onChange={(e) => onUpdateItem(item.id, { videoPrompt: e.target.value })}
                              disabled={item.isLocked}
                          />
                      </div>

                      {/* Inline Regeneration Input */}
                      {regenInputId === item.id && (
                          <div className="mt-2 p-2 bg-gray-800 rounded border border-indigo-500/50 animate-in fade-in slide-in-from-top-2">
                              <span className="text-[10px] text-gray-400 block mb-1">重绘修改要求:</span>
                              <input 
                                type="text" 
                                autoFocus
                                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white mb-2 focus:outline-none focus:border-indigo-500"
                                placeholder="例: 将镜头改为仰视，增加下雨效果..."
                                value={regenInstruction}
                                onChange={(e) => setRegenInstruction(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="flex gap-2">
                                  <button onClick={(e) => handleCancelRegen(e)} className="flex-1 py-1 text-[10px] bg-gray-700 hover:bg-gray-600 rounded text-gray-300">取消</button>
                                  <button onClick={(e) => handleConfirmRegen(e, item.id)} className="flex-1 py-1 text-[10px] bg-indigo-600 hover:bg-indigo-500 rounded text-white font-bold">确认重绘</button>
                              </div>
                          </div>
                      )}
                  </div>
              </div>
              
              {/* 在每个卡片后添加插入按钮 */}
              <button
                key={`insert-after-${item.id}`}
                onClick={() => handleOpenInsertModal(idx + 1)}
                className="w-full py-2 border border-dashed border-gray-700 hover:border-indigo-500 rounded-lg text-gray-500 hover:text-indigo-400 transition-all flex items-center justify-center gap-2 text-xs bg-gray-900/30 hover:bg-gray-800"
              >
                <Plus className="w-3 h-3" />
                在此插入新分镜
              </button>
            </React.Fragment>
            );
          })}

        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-600 p-6 text-center bg-gray-950">
             
             {isProcessing && processingType === 'rewrite' ? (
                /* 🆕 AI改写时的全屏Loading动画 */
                <div className="flex flex-col items-center justify-center gap-6">
                    {/* 旋转的镜头图标 */}
                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full blur-xl opacity-30 animate-pulse" />
                        <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-full border-2 border-indigo-500/30 shadow-2xl">
                            <Film className="w-12 h-12 text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
                        </div>
                    </div>
                    
                    {/* Loading文字 */}
                    <div className="space-y-2">
                        <p className="text-lg font-medium text-white">正在改写剧本...</p>
                        <p className="text-xs text-gray-500">AI正在优化剧本结构</p>
                    </div>
                    
                    {/* 进度点 */}
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
                        <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                        <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                </div>
             ) : selectedFile?.storyboard?.items?.length > 0 ? (
                // 🔧 新流程：镜头详情已由规则自动解析生成，无需手动触发
                // 这个分支不应该再出现，因为解析时已经填充了所有字段
                null
             ) : selectedFile?.scriptContent ? (
                // 有剧本但没有分镜
                <>
                <LayoutDashboard className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm text-gray-400 mb-4">剧本已就绪，请先在左侧"分镜脚本"栏提取分镜</p>
                <p className="text-xs text-gray-500 mb-4">或从历史版本恢复</p>
                     <button 
                        onClick={() => setShowHistory(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-900/30 hover:bg-indigo-600 border border-indigo-500/30 rounded-lg text-indigo-200 hover:text-white transition-all"
                     >
                         <History className="w-4 h-4" />
                  从历史版本恢复
                     </button>
                </>
            ) : (
                <>
                <LayoutDashboard className="w-12 h-12 mb-4 opacity-20" />
                <p className="mb-4">请先选择一个文件</p>
                </>
            )}
        </div>
      )}

      {/* ✨ 插入新分镜模态框 */}
      {showInsertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowInsertModal(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto flex flex-col shadow-2xl m-4" onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" />
                插入新分镜 {insertPosition === 0 ? '(开头)' : `(位置 ${insertPosition})`}
              </h3>
              <button onClick={() => setShowInsertModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* 模式切换 */}
            <div className="p-4 border-b border-gray-700 bg-gray-950/50">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setInsertMode('manual')}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                    insertMode === 'manual'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  ✍️ 手动填写
                </button>
                <button
                  onClick={() => setInsertMode('ai')}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                    insertMode === 'ai'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  🤖 AI生成
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {insertMode === 'manual' ? '手动填写所有字段' : '只需填写原文段落，AI将自动生成其他内容'}
              </p>
            </div>

            {/* 表单内容 */}
            <div className="p-4 space-y-4">
              {/* 原文段落 (必填) */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center justify-between">
                  <span>对应的原文段落 <span className="text-red-400">*</span></span>
                  <button
                    type="button"
                    onClick={() => setShowScriptSelector(!showScriptSelector)}
                    className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-all flex items-center gap-1"
                  >
                    <FolderInput className="w-3 h-3" />
                    {showScriptSelector ? '关闭选择器' : '从脚本中选择'}
                  </button>
                </label>
                
                {showScriptSelector && (
                  <div className="mb-3 p-3 bg-gray-950 border border-indigo-500/30 rounded max-h-48 overflow-y-auto">
                    <p className="text-xs text-gray-500 mb-2">点击选择段落：</p>
                    {selectedFile?.storyboard?.items.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setNewShotData({...newShotData, originalText: item.originalText || item.scriptSegment});
                          setShowScriptSelector(false);
                        }}
                        className="w-full text-left p-2 mb-2 bg-gray-900 hover:bg-indigo-900/30 border border-gray-700 hover:border-indigo-500 rounded transition-all text-xs text-gray-400 hover:text-white"
                      >
                        <span className="text-indigo-400 font-mono">镜头 {String(idx + 1).padStart(2, '0')}</span>
                        <span className="ml-2 line-clamp-2">{(item.originalText || item.scriptSegment).substring(0, 100)}...</span>
                      </button>
                    ))}
                  </div>
                )}
                
                <textarea
                  value={newShotData.originalText}
                  onChange={(e) => setNewShotData({...newShotData, originalText: e.target.value})}
                  className="w-full h-24 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-indigo-500 resize-none"
                  placeholder="点击上方按钮从脚本中选择，或手动输入..."
                />
              </div>

              {insertMode === 'manual' && (
                <>
                  {/* 场景描述 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      场景描述 <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={newShotData.scriptSegment}
                      onChange={(e) => setNewShotData({...newShotData, scriptSegment: e.target.value})}
                      className="w-full h-20 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-indigo-500 resize-none"
                      placeholder="简洁的场景和动作描述..."
                    />
                  </div>

                  {/* 图像提示词 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      图像提示词 (imagePrompt)
                    </label>
                    <textarea
                      value={newShotData.imagePrompt}
                      onChange={(e) => setNewShotData({...newShotData, imagePrompt: e.target.value})}
                      className="w-full h-20 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-indigo-500 resize-none font-mono"
                      placeholder="英文图像生成提示词..."
                    />
                  </div>

                  {/* 视频提示词 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      视频提示词 (videoPrompt)
                    </label>
                    <textarea
                      value={newShotData.videoPrompt}
                      onChange={(e) => setNewShotData({...newShotData, videoPrompt: e.target.value})}
                      className="w-full h-20 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-indigo-500 resize-none"
                      placeholder="中文视频生成提示词..."
                    />
                  </div>

                  {/* 对话 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      人物台词 (dialogue)
                    </label>
                    <textarea
                      value={newShotData.dialogue}
                      onChange={(e) => setNewShotData({...newShotData, dialogue: e.target.value})}
                      className="w-full h-16 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-indigo-500 resize-none"
                      placeholder="角色对话..."
                    />
                  </div>

                  {/* 角色和场景 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        角色 (逗号分隔)
                      </label>
                      <input
                        type="text"
                        value={newShotData.characters}
                        onChange={(e) => setNewShotData({...newShotData, characters: e.target.value})}
                        className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-indigo-500"
                        placeholder="角色1, 角色2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        场景位置
                      </label>
                      <input
                        type="text"
                        value={newShotData.scene}
                        onChange={(e) => setNewShotData({...newShotData, scene: e.target.value})}
                        className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-indigo-500"
                        placeholder="场景名称"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="p-4 border-t border-gray-700 flex items-center justify-end gap-3 sticky bottom-0 bg-gray-900">
              <button
                onClick={() => setShowInsertModal(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-all"
              >
                取消
              </button>
              <button
                onClick={handleInsertShot}
                disabled={isProcessing}
                className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {insertMode === 'manual' ? '✅ 插入分镜' : '🤖 AI生成并插入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};