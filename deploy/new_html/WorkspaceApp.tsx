

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';
import { ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from './components/Header';
import { FileColumn } from './components/FileColumn';
import { ViewerColumn } from './components/ViewerColumn';
import { ScriptColumn } from './components/ScriptColumn';
import { StoryboardColumn } from './components/StoryboardColumn';
import { MaterialPage } from './components/MaterialPage';
import { GenerationPage } from './components/GenerationPage';
import { VideoPage } from './components/VideoPage';
import { AdminPage } from './components/AdminPage';
import { HistoryPage } from './components/HistoryPage';
import { LoadingOverlay } from './components/LoadingOverlay';
import { SkeletonScreen } from './components/SkeletonScreen';
import { ProjectFile, FileStatus, StoryboardItem, FileVersion, AppView, MaterialLibrary, Material, AiModel, TaskNotification, ScriptSegment, ScriptGenerationStageState, VideoScriptBlock } from './types';
import { aiRewriteNovelToScript, aiGenerateStoryboards, aiExtractScriptMetadata, aiRefineScriptSegment, aiRestructureShot, aiRegenerateSingleShot, aiGenerateStoryboardScript, aiContinueStoryboardScript, aiSplitScriptIntoSegments, aiGenerateVideoScriptFromSegment, aiExtractStoryboardPromptFromVideoShot } from './services/aiModelService';
import { parseVideoScriptBlocks } from './utils/scriptPipelineParsers';
import { parseStreamingBlocks, convertToStoryboardItem, removeControlCharacters, segmentInputContent, countShots } from './utils/storyboardParser';
import { estimateDurationMs } from './utils/durationMapping';
import { extractToAssets, batchCreateStoryboardItems, deleteAllStoryboardItems, exportScript, getEpisodeScript, updateEpisodeScript, getStoryboardItems, listEpisodeScripts, createEpisodeScript, updateEpisodeScriptById, deleteEpisodeScript, updateStoryboardItem, deleteStoryboardItem, listEpisodeScriptSegments, batchSaveScriptSegments } from './services/apiService';

/**
 * ✅ localStorage使用说明：
 * 
 * 业务数据（已迁移到数据库）：
 * - 项目数据 (files, storyboard) → PostgreSQL
 * - 素材库 (materialLibrary) → PostgreSQL
 * - 会话数据 → PostgreSQL
 * 
 * 仍使用localStorage的内容（合理使用）：
 * 1. 认证信息 (auth_token, username) - Web标准实践
 * 2. UI状态 (last_view) - 记住用户上次访问的视图
 * 3. 临时传递 (anime-current-project-id-*) - 跨页面通信
 */

interface WorkspaceAppProps {
  hideHeader?: boolean;
  episodeId: string;
  initialScriptId?: string | null;
  onScriptSelect?: (scriptId: string | null) => void;
  onAfterExport?: () => Promise<void> | void;
}

const WorkspaceApp: React.FC<WorkspaceAppProps> = ({ hideHeader = false, episodeId: propEpisodeId, initialScriptId, onScriptSelect, onAfterExport }) => {

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [checkedFileIds, setCheckedFileIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const urlProjectId = (() => {
    const segs = window.location.pathname.split('/');
    const idx = segs.indexOf('projects');
    return idx >= 0 && segs[idx + 1] ? segs[idx + 1] : null;
  })();
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  
  // 🆕 新增状态管理
  const [isShotExtracting, setIsShotExtracting] = useState(false); // 提取分镜loading
  const [shotGenerationProgress, setShotGenerationProgress] = useState<{current: number; total: number} | null>(null); // 生成进度
  const [processingType, setProcessingType] = useState<'rewrite' | 'generate-shots' | null>(null); // 🆕 区分处理类型
  
  // 🆕 全局任务通知状态
  const [taskNotifications, setTaskNotifications] = useState<TaskNotification[]>([]);

  // 🔧 已移除 rewriteUserRequirements 和 storyboardUserRequirements - 新流程中不需要用户输入额外要求
  
  // 🆕 停止标志
  const stopProcessingRef = useRef<boolean>(false);
  
  // 🆕 添加任务通知
  const addTaskNotification = useCallback((notification: Omit<TaskNotification, 'id' | 'timestamp'>) => {
    const newNotification: TaskNotification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };
    setTaskNotifications(prev => [newNotification, ...prev]);
    return newNotification.id;
  }, []);
  
  // 🆕 更新任务通知状态
  const updateTaskNotification = useCallback((id: string, updates: Partial<TaskNotification>) => {
    setTaskNotifications(prev => prev.map(n => 
      n.id === id ? { ...n, ...updates } : n
    ));
  }, []);
  
  // 🆕 删除任务通知
  const dismissTaskNotification = useCallback((id: string) => {
    setTaskNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // 从 URL 路径推断当前视图
  const location = useLocation();
  const routerNavigate = useNavigate();

  const getViewFromPath = (): AppView => {
    const segments = location.pathname.split('/');
    const page = segments[segments.length - 1]?.toLowerCase();
    const viewMap: Record<string, AppView> = {
      'editor': AppView.Editor,
      'materials': AppView.Materials,
      'generation': AppView.Generation,
      'video': AppView.Video,
      'history': AppView.History,
      'admin': AppView.Admin
    };
    return viewMap[page] || AppView.Editor;
  };

  const [currentView, setCurrentView] = useState<AppView>(getViewFromPath());

  // 视图保活：已访问过的视图保持挂载，用 display:none 切换可见性
  const [mountedViews, setMountedViews] = useState<Set<AppView>>(new Set([getViewFromPath()]));

  // URL 变化时同步 currentView
  useEffect(() => {
    const newView = getViewFromPath();
    if (newView !== currentView) {
      setCurrentView(newView);
    }
  }, [location.pathname]);

  useEffect(() => {
    setMountedViews(prev => {
      if (prev.has(currentView)) return prev;
      return new Set(prev).add(currentView);
    });
  }, [currentView]);

  const [isViewLoading, setIsViewLoading] = useState(false);
  
  // 懒加载状态管理
  const [loadedViews, setLoadedViews] = useState<Set<AppView>>(new Set());
  const [isPreloading, setIsPreloading] = useState(false);
  
  // 🆕 数据加载状态（用于显示骨架屏）
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // Material Library State (Global)
  const [materialLibrary, setMaterialLibrary] = useState<MaterialLibrary>({});

  // 🔧 使用 ref 存储最新状态，避免闭包问题
  const filesRef = useRef<ProjectFile[]>(files);
  const materialLibraryRef = useRef<MaterialLibrary>(materialLibrary);
  
  // 🔧 每次状态更新时同步到 ref
  useEffect(() => {
    filesRef.current = files;
    materialLibraryRef.current = materialLibrary;
  }, [files, materialLibrary]);

  // Undo/Redo History State: Map<FileID, { past, future }>
  const [fileHistory, setFileHistory] = useState<Record<string, { past: ProjectFile[], future: ProjectFile[] }>>({});

  // Highlighting State
  const [highlightedScriptSegments, setHighlightedScriptSegments] = useState<Set<string>>(new Set());
  const [highlightedStoryboardItemIds, setHighlightedStoryboardItemIds] = useState<Set<string>>(new Set());

  // Layout State
  const [colWidths, setColWidths] = useState<number[]>([15, 25, 30, 30]); // 文件列表10%, 文字脚本20%, 分镜脚本30%, 镜头设计40%
  const [visibleColumns, setVisibleColumns] = useState<boolean[]>([true, true, true, true]);  // ✅ 强制所有列始终显示
  const [aiModel, setAiModel] = useState<AiModel>(AiModel.DeepseekChat);  // 🔧 默认改为DK金丹
  
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef<number | null>(null);

  const selectedFile = files.find(f => f.id === selectedFileId);
  
  // 保存定时器引用
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // --- 后端数据持久化 ---

  /**
   * 分集模式：加载当前分集的所有文件（多文件支持）
   */
  const loadEpisodeData = async () => {
    if (!propEpisodeId) return;
    setIsLoadingProjects(true);
    try {
      const [scriptsRes, sbRes, segRes] = await Promise.all([
        listEpisodeScripts(propEpisodeId).catch(() => ({ success: false, scripts: [] })),
        getStoryboardItems(propEpisodeId).catch(() => ({ success: false, items: [] })),
        listEpisodeScriptSegments(propEpisodeId).catch(() => ({ success: false, segments: [] })),
      ]);

      const scripts: any[] = scriptsRes.success ? (scriptsRes.scripts || []) : [];
      const dbItems: any[] = sbRes.success ? (sbRes.items || []) : [];

      const itemsByScript = new Map<string | null, any[]>();
      for (const r of dbItems) {
        const sid = r.script_id ?? r.scriptId ?? null;
        if (!itemsByScript.has(sid)) itemsByScript.set(sid, []);
        itemsByScript.get(sid)!.push(r);
      }

      // 2026-05-29 三步生成：按 script_id 分组剧本分段
      const allSegments: any[] = segRes.success ? ((segRes as any).segments || []) : [];
      const segsByScript = new Map<string | null, ScriptSegment[]>();
      for (const r of allSegments) {
        const sid = r.script_id ?? r.scriptId ?? null;
        if (!segsByScript.has(sid)) segsByScript.set(sid, []);
        segsByScript.get(sid)!.push({
          id: r.segment_id ?? r.segmentId,
          order: r.segment_order ?? r.segmentOrder ?? 0,
          sourceText: r.source_text ?? r.sourceText ?? '',
          estimatedDurationSec: r.estimated_duration_sec ?? r.estimatedDurationSec ?? null,
          videoScript: r.video_script ?? r.videoScript ?? '',
          status: r.status ?? 'done',
          errorMessage: r.error_message ?? r.errorMessage ?? '',
        });
      }
      for (const list of segsByScript.values()) {
        list.sort((a, b) => a.order - b.order);
      }

      const buildUiItems = (rows: any[]): StoryboardItem[] => rows.map((r: any, idx: number) => {
        const boundAssets: string[] = Array.isArray(r.bound_assets ?? r.boundAssets)
          ? (r.bound_assets ?? r.boundAssets)
          : [];
        return {
          id: r.item_id ?? r.itemId ?? uuidv4(),
          shotNumber: idx + 1,
          originalText: r.scene_heading ?? r.sceneHeading ?? '',
          scriptSegment: r.action_text ?? r.actionText ?? '',
          dialogue: r.dialogue ?? '',
          cameraMovement: r.camera_movement ?? r.cameraMovement ?? '',
          imagePrompt: r.image_prompt ?? r.imagePrompt ?? '',
          videoPrompt: r.video_prompt ?? r.videoPrompt ?? '',
          generatedImageUrl: r.generated_image_url ?? r.generatedImageUrl ?? null,
          characters: boundAssets.filter((a: string) => a.startsWith('char:')).map((a: string) => a.replace('char:', '')),
          scene: boundAssets.find((a: string) => a.startsWith('scene:'))?.replace('scene:', '') || '',
          plannedDurationMs: r.planned_duration_ms ?? r.plannedDurationMs ?? null,
          // 三阶段字段：精确框选/高亮依赖 videoScriptBlock 定位（否则刷新后镜头号重复，框选只命中第一个）
          scriptSegmentId: r.script_segment_id ?? r.scriptSegmentId ?? undefined,
          sourceVideoShotNo: r.source_video_shot_no ?? r.sourceVideoShotNo ?? '',
          videoScriptBlock: r.video_script_block ?? r.videoScriptBlock ?? '',
          shotSize: r.shot_size ?? r.shotSize ?? '',
          cameraAngle: r.camera_angle ?? r.cameraAngle ?? '',
          timestamp: Date.now(),
        };
      });

      let projectFiles: ProjectFile[];

      if (scripts.length > 0) {
        projectFiles = scripts.map((script: any, idx: number) => {
          const sid = script.script_id ?? script.scriptId;
          const matchedRows = itemsByScript.get(sid) || [];
          const orphanRows = idx === 0 ? (itemsByScript.get(null) || []) : [];
          const fileItems = buildUiItems([...matchedRows, ...orphanRows]);
          const file: ProjectFile = {
            id: sid,
            name: script.file_name ?? script.fileName ?? `文件${idx + 1}`,
            originalContent: script.original_content ?? script.originalContent ?? '',
            scriptContent: script.adapted_script ?? script.adaptedScript ?? null,
            storyboard: fileItems.length > 0 ? { items: fileItems } : null,
            extractedCharacters: [],
            extractedScenes: [],
            status: FileStatus.Idle,
            lastUpdated: Date.now(),
            versions: [],
            scriptSegments: segsByScript.get(sid) || (idx === 0 ? (segsByScript.get(null) || []) : []),
          };
          if (fileItems.length > 0) {
            const chars = new Set<string>();
            const scenes = new Set<string>();
            fileItems.forEach(item => {
              (item.characters || []).forEach((c: string) => { if (c) chars.add(c); });
              if (item.scene) scenes.add(item.scene);
            });
            file.extractedCharacters = Array.from(chars);
            file.extractedScenes = Array.from(scenes);
          }
          return file;
        });
      } else {
        const created = await createEpisodeScript(propEpisodeId, { file_name: '分集剧本' }).catch(() => null);
        const newId = created?.script?.script_id || `local_${uuidv4()}`;
        const allItems = buildUiItems(dbItems);
        projectFiles = [{
          id: newId,
          name: '分集剧本',
          originalContent: '',
          scriptContent: null,
          storyboard: allItems.length > 0 ? { items: allItems } : null,
          extractedCharacters: [],
          extractedScenes: [],
          status: FileStatus.Idle,
          lastUpdated: Date.now(),
          versions: [],
          scriptSegments: segsByScript.get(newId) || segsByScript.get(null) || [],
        }];
      }

      setFiles(projectFiles);
      const restoreId = initialScriptId && projectFiles.some(f => f.id === initialScriptId)
        ? initialScriptId
        : projectFiles[0]?.id || null;
      setSelectedFileId(restoreId);
      setLoadedViews(new Set([AppView.Editor, AppView.Materials, AppView.Generation]));
      setIsDataLoaded(true);
    } catch (error) {
      console.error('❌ 加载分集数据失败:', error);
      setIsDataLoaded(true);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  /**
   * 分集模式：保存所有文件到后端（多文件支持）
   */
  const saveEpisodeToBackend = useCallback(async () => {
    // 🔧 通过 filesRef 读取最新文件，避免闭包内 files 过期（链式 pipeline 同一异步内 Stage3 保存丢失刚生成的 items）
    const currentFiles = filesRef.current;
    if (!propEpisodeId || currentFiles.length === 0 || isLoadingProjects) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    try {
      for (const file of currentFiles) {
        if (file.id.startsWith('local_')) continue;
        await updateEpisodeScriptById(propEpisodeId, file.id, {
          file_name: file.name,
          original_content: file.originalContent,
          adapted_script: file.scriptContent,
        }).catch(err => console.error(`保存文件 ${file.name} 失败:`, err));
      }

      // 2026-05-29 保存剧本分段（Stage 1 产物）
      for (const file of currentFiles) {
        if (!file.id || file.id.startsWith('local_')) continue;
        if (!file.scriptSegments || file.scriptSegments.length === 0) continue;
        const segPayload = file.scriptSegments.map((s, idx) => ({
          segment_id: s.id && !s.id.startsWith('seg_local_') ? s.id : undefined,
          segment_order: idx,
          source_text: s.sourceText || '',
          estimated_duration_sec: s.estimatedDurationSec ?? null,
          video_script: s.videoScript || '',
          status: s.status || 'done',
          error_message: s.errorMessage || '',
        }));
        await batchSaveScriptSegments(propEpisodeId, file.id, segPayload).catch(err =>
          console.warn(`保存分段失败 (${file.id}):`, err)
        );
      }

      for (const file of currentFiles) {
        if (!file.id || file.id.startsWith('local_')) continue;
        if (!file.storyboard?.items?.length) continue;

        const realItems = file.storyboard.items.filter(i => !i.isPlaceholder);
        const hasNewItems = realItems.some(i => !i.id || !i.id.startsWith('sb_'));
        if (!hasNewItems) continue;

        const dbItems = realItems.map((item: StoryboardItem, idx: number) => ({
          sort_order: idx,
          scene_heading: item.originalText || item.scene || '',
          action_text: item.scriptSegment || '',
          dialogue: item.dialogue || '',
          camera_movement: item.cameraMovement || '',
          image_prompt: item.imagePrompt || '',
          video_prompt: item.videoPrompt || '',
          planned_duration_ms: item.plannedDurationMs || null,
          bound_assets: [
            ...(item.characters || []).map((c: string) => `char:${c}`),
            ...(item.scene ? [`scene:${item.scene}`] : []),
          ],
          script_segment_id: item.scriptSegmentId || null,
          source_video_shot_no: item.sourceVideoShotNo || '',
          video_script_block: item.videoScriptBlock || '',
          shot_size: item.shotSize || '',
          camera_angle: item.cameraAngle || '',
        }));

        await deleteAllStoryboardItems(propEpisodeId, file.id).catch(err =>
          console.warn(`清理旧分镜失败 (${file.id}):`, err)
        );
        const result: any = await batchCreateStoryboardItems(propEpisodeId, dbItems, file.id);
        if (result?.success && Array.isArray(result.items)) {
          const newIds: string[] = result.items.map((r: any) => r.item_id ?? r.itemId);
          setFiles(prev => prev.map(f => {
            if (f.id !== file.id || !f.storyboard) return f;
            let realIdx = 0;
            const updatedItems = f.storyboard.items.map(it => {
              if (it.isPlaceholder) return it;
              const newId = newIds[realIdx++];
              return newId ? { ...it, id: newId } : it;
            });
            return { ...f, storyboard: { ...f.storyboard, items: updatedItems } };
          }));
        }
      }
    } catch (error) {
      console.error('❌ 保存分集数据失败:', error);
    }
  }, [propEpisodeId, isLoadingProjects]);

  /**
   * 初始化：加载分集数据
   */
  useEffect(() => {
    loadEpisodeData().catch(err => {
      console.error('❌ 分集初始化失败:', err);
      setIsDataLoaded(true);
    });
  }, []);
  
  useEffect(() => {
    if (onScriptSelect) {
      onScriptSelect(selectedFileId);
    }
  }, [selectedFileId, onScriptSelect]);

  /**
   * 🚀 懒加载优化：根据当前视图按需加载数据
   */
  useEffect(() => {
    // 💾 保存当前视图到localStorage（静默）
    try {
      localStorage.setItem('last_view', currentView);
    } catch (e) {
      console.warn('保存当前视图失败:', e);
    }
    
    // 如果当前视图已加载，跳过
    if (loadedViews.has(currentView)) {
      return;
    }
    
    // 🎯 立即标记为已加载，避免重复加载
    setLoadedViews(prev => new Set(prev).add(currentView));
    
    // 📦 后台异步加载数据（不阻塞UI）
    loadViewData(currentView).catch(err => {
      console.error(`❌ 加载视图失败:`, err);
    });
    
    // 🔮 后台预加载下一个视图（智能预测）
    schedulePreloadNextView(currentView);
  }, [currentView]);



  /**
   * 保存到后端
   */
  /**
   * 🚀 防抖保存：避免频繁保存
   */
  const debouncedSaveToBackend = useCallback(() => {
    // 清除之前的定时器
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    
    // 设置新的定时器（5秒后保存）
    saveTimerRef.current = setTimeout(() => {
      console.log('💾 自动保存触发（防抖5秒）');
      saveToBackend();
    }, 5000);
  }, []);
  
  const saveToBackend = useCallback(async () => {
    return saveEpisodeToBackend();
  }, [saveEpisodeToBackend]);

  /**
   * 自动保存：文件或素材库变化时保存（跳过初始加载）
   */
  const hasUserEditedRef = useRef(false);
  useEffect(() => {
    if (files.length > 0 && !isLoadingProjects) {
      if (!hasUserEditedRef.current) {
        hasUserEditedRef.current = true;
        return;
      }
      const timer = setTimeout(() => {
        saveToBackend();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [files, materialLibrary, saveToBackend, isLoadingProjects]);

  /**
   * 安全网：监听 generation-save-trigger 事件，仅触发强制保存
   * 主通道 (onUpdateStoryboardItem + flushSync) 已完成状态更新，这里只确保持久化
   */
  const selectedFileIdRef = useRef(selectedFileId);
  selectedFileIdRef.current = selectedFileId;

  useEffect(() => {
    const handler = () => {
      saveToBackend();
    };
    window.addEventListener('generation-save-trigger', handler);
    return () => window.removeEventListener('generation-save-trigger', handler);
  }, [saveToBackend]);

  /**
   * 页面关闭/切后台时可靠保存
   */
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (files.length > 0 && !isLoadingProjects) {
        saveToBackend().catch(() => {});
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && files.length > 0 && !isLoadingProjects) {
        saveToBackend().catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [files, isLoadingProjects, saveToBackend]);

  // --- 本地存储备份（兼容模式） ---

  // --- History Management (Undo/Redo) ---
  
  const pushToHistory = (fileId: string, currentFile: ProjectFile) => {
      setFileHistory(prev => {
          const history = prev[fileId] || { past: [], future: [] };
          // Keep max 10 steps
          const newPast = [...history.past, currentFile].slice(-10);
          return {
              ...prev,
              [fileId]: { past: newPast, future: [] }
          };
      });
  };

  const handleUndo = () => {
      if (!selectedFileId) return;
      const history = fileHistory[selectedFileId];
      if (!history || history.past.length === 0) return;

      const previous = history.past[history.past.length - 1];
      const current = files.find(f => f.id === selectedFileId);
      
      if (current && previous) {
          setFileHistory(prev => ({
              ...prev,
              [selectedFileId]: {
                  past: history.past.slice(0, -1),
                  future: [current, ...history.future].slice(0, 10)
              }
          }));
          setFiles(prev => prev.map(f => f.id === selectedFileId ? previous : f));
      }
  };

  const handleRedo = () => {
      if (!selectedFileId) return;
      const history = fileHistory[selectedFileId];
      if (!history || history.future.length === 0) return;

      const next = history.future[0];
      const current = files.find(f => f.id === selectedFileId);

      if (current && next) {
          setFileHistory(prev => ({
              ...prev,
              [selectedFileId]: {
                  past: [...history.past, current].slice(-10),
                  future: history.future.slice(1)
              }
          }));
          setFiles(prev => prev.map(f => f.id === selectedFileId ? next : f));
      }
  };

  const canUndo = !!(selectedFileId && fileHistory[selectedFileId]?.past.length > 0);
  const canRedo = !!(selectedFileId && fileHistory[selectedFileId]?.future.length > 0);

  // Helper to update file with history tracking
  const updateFileWithHistory = (fileId: string, updateFn: (file: ProjectFile) => ProjectFile) => {
      setFiles(prev => {
          const fileIndex = prev.findIndex(f => f.id === fileId);
          if (fileIndex === -1) return prev;
          
          const currentFile = prev[fileIndex];
          pushToHistory(fileId, currentFile); // Save state before update

          const newFile = updateFn(currentFile);
          const newFiles = [...prev];
          newFiles[fileIndex] = newFile;
          
          // 🔧 立即同步到 ref，确保 onForceSave 能获取到最新数据
          filesRef.current = newFiles;
          
          return newFiles;
      });
  };

  // --- Version Control ---

  const handleSaveVersion = (id: string, customName?: string) => {
      setFiles(prev => prev.map(f => {
          if (f.id !== id) return f;
          const newVersion: FileVersion = {
              id: uuidv4(),
              timestamp: Date.now(),
              name: customName || `版本 ${f.versions ? f.versions.length + 1 : 1}`,
              data: {
                  name: f.name,
                  originalContent: f.originalContent,
                  scriptContent: f.scriptContent,
                  storyboard: f.storyboard,
                  extractedCharacters: f.extractedCharacters,
                  extractedScenes: f.extractedScenes,
                  lastUpdated: f.lastUpdated,
              }
          };
          return { ...f, versions: [...(f.versions || []), newVersion] };
      }));
  };

  const handleRestoreVersion = (fileId: string, version: FileVersion) => {
      updateFileWithHistory(fileId, (f) => ({
          ...f,
          ...version.data,
          // Keep existing versions list
          versions: f.versions
      }));
  };

  const handleRestoreStoryboard = (fileId: string, version: FileVersion) => {
      if (!version.data.storyboard) {
          alert("该版本没有分镜数据");
          return;
      }
      updateFileWithHistory(fileId, (f) => ({
          ...f,
          storyboard: version.data.storyboard
      }));
  };

  const handleDeleteVersion = (fileId: string, versionId: string) => {
      setFiles(prev => prev.map(f => {
          if (f.id !== fileId) return f;
          return {
              ...f,
              versions: (f.versions || []).filter(v => v.id !== versionId)
          };
      }));
      console.log(`🗑️ 已删除版本 ${versionId}`);
  };



  const handleExportNext = async (data: any) => {
    try {
      const selectedItems: string[] = data.items.map((item: any) => item.shotId);
      
      if (selectedItems.length === 0) {
        alert('没有可导出的分镜');
        return;
      }
      
      const projectId = urlProjectId;
      if (!projectId) {
        alert('未找到项目ID，无法导出。');
        return;
      }
      
      const username = localStorage.getItem('username') || 'guest';
      const storageKey = `anime-current-project-id-${username}`;
      localStorage.setItem(storageKey, projectId);
      
      const { exportToVideo } = await import('./services/apiService');
      
      try {
        const result = await exportToVideo(projectId, selectedItems);
        console.log(`✅ 导出成功: ${result.exported_count} 个镜头`);
        setCurrentView(AppView.Video);
      } catch (err) {
        console.error('❌ 导出失败:', err);
        alert('导出失败: ' + (err as Error).message + '\n\n请重试或联系管理员');
      }
      
    } catch (error) {
      console.error('❌ 导出失败:', error);
      alert('导出失败: ' + (error as Error).message);
    }
  };

  // --- Layout Logic ---
  
  const toggleColumnVisibility = (index: number) => {
    setVisibleColumns(prev => {
      const newVis = [...prev];
      newVis[index] = !newVis[index];
      // 防止所有列都被隐藏
      if (newVis.every(v => !v)) return prev;
      return newVis;
    });
  };

  const startResizing = (index: number) => {
    isResizing.current = index;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const stopResizing = useCallback(() => {
    isResizing.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResize = useCallback((e: MouseEvent) => {
    if (isResizing.current === null || !containerRef.current) return;
    if (visibleColumns.some(v => !v)) return;

    const containerWidth = containerRef.current.clientWidth;
    const deltaPx = e.movementX;
    const deltaPercent = (deltaPx / containerWidth) * 100;
    const index = isResizing.current;
    
    setColWidths(prev => {
      const newWidths = [...prev];
      const newCurrent = newWidths[index] + deltaPercent;
      const newNext = newWidths[index + 1] - deltaPercent;
      if (newCurrent > 5 && newNext > 5) {
        newWidths[index] = newCurrent;
        newWidths[index + 1] = newNext;
        return newWidths;
      }
      return prev;
    });
  }, [visibleColumns]);

  useEffect(() => {
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [handleResize, stopResizing]);

  // --- File Management ---

  /**
   * 上传文件：为每个上传的文件创建新的后端记录
   */
  const handleFileUpload = (fileList: FileList) => {
    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target?.result as string;
        try {
          const res = await createEpisodeScript(propEpisodeId, {
            file_name: file.name,
            original_content: text,
          });
          if (res?.success && res.script) {
            const newFile: ProjectFile = {
              id: res.script.script_id,
              name: file.name,
              originalContent: text,
              scriptContent: null,
              storyboard: null,
              extractedCharacters: [],
              extractedScenes: [],
              status: FileStatus.Idle,
              lastUpdated: Date.now(),
              versions: [],
            };
            setFiles(prev => [...prev, newFile]);
            setSelectedFileId(newFile.id);
          }
        } catch (err) {
          console.error('上传文件失败:', err);
        }
      };
      reader.readAsText(file);
    });
  };

  /**
   * 新建空白文件：在后端创建新记录并添加到文件列表
   */
  const handleCreateBlankFile = async () => {
    try {
      const res = await createEpisodeScript(propEpisodeId, {
        file_name: `新文件 ${files.length + 1}`,
      });
      if (res?.success && res.script) {
        const newFile: ProjectFile = {
          id: res.script.script_id,
          name: res.script.file_name || `新文件 ${files.length + 1}`,
          originalContent: '',
          scriptContent: null,
          storyboard: null,
          extractedCharacters: [],
          extractedScenes: [],
          status: FileStatus.Idle,
          lastUpdated: Date.now(),
          versions: [],
        };
        setFiles(prev => [...prev, newFile]);
        setSelectedFileId(newFile.id);
      }
    } catch (err) {
      console.error('创建空白文件失败:', err);
    }
  };

  const handleUpdateContent = (id: string, newContent: string) => {
      updateFileWithHistory(id, (f) => ({ ...f, originalContent: newContent }));
  };

  const handleFileSelect = (id: string) => {
    setSelectedFileId(id);
    setHighlightedScriptSegments(new Set());
    setHighlightedStoryboardItemIds(new Set());
  };

  const handleFileCheck = (id: string, checked: boolean) => {
    setCheckedFileIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleCheckAll = (checked: boolean) => {
    if (checked) {
      setCheckedFileIds(new Set(files.map(f => f.id)));
    } else {
      setCheckedFileIds(new Set());
    }
  };

  const handleRenameFile = (id: string, newName: string) => {
    updateFileWithHistory(id, (f) => ({ ...f, name: newName }));
  };

  const handleDownloadFile = (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;
    
    const blob = new Blob([file.originalContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteFile = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (files.length <= 1) {
      updateFileWithHistory(id, (f) => ({
        ...f,
        originalContent: '',
        scriptContent: null,
        storyboard: null,
        extractedCharacters: [],
        extractedScenes: [],
        lastUpdated: Date.now(),
      }));
      return;
    }
    try {
      await deleteEpisodeScript(propEpisodeId, id);
      setFiles(prev => {
        const newFiles = prev.filter(f => f.id !== id);
        if (selectedFileId === id && newFiles.length > 0) {
          setSelectedFileId(newFiles[0].id);
        }
        return newFiles;
      });
    } catch (err) {
      console.error('删除文件失败:', err);
    }
  };

  const handleMoveFile = (e: React.MouseEvent, id: string, direction: 'up' | 'down') => {
    setFiles(prev => {
      const index = prev.findIndex(f => f.id === id);
      if (index === -1) return prev;
      const newFiles = [...prev];
      if (direction === 'up' && index > 0) {
        [newFiles[index], newFiles[index - 1]] = [newFiles[index - 1], newFiles[index]];
      } else if (direction === 'down' && index < newFiles.length - 1) {
        [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
      }
      return newFiles;
    });
  };
  
  // 🆕 拖拽排序文件
  const handleReorderFiles = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    
    setFiles(prev => {
      const newFiles = [...prev];
      const [movedFile] = newFiles.splice(fromIndex, 1);
      newFiles.splice(toIndex, 0, movedFile);
      console.log(`📎 文件排序: ${movedFile.name} 从位置 ${fromIndex + 1} 移动到 ${toIndex + 1}`);
      return newFiles;
    });
  }, []);

  const updateFileStatus = (id: string, status: FileStatus) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status } : f));
  };

  const getTargetIds = (targetFileId?: string) => {
      if (targetFileId) return [targetFileId];
      if (checkedFileIds.size > 0) return Array.from(checkedFileIds);
      if (selectedFileId) return [selectedFileId];
      return [];
  };

  // --- Highlighting Logic ---

  const handleScriptSelectionChange = (selection: string | null) => {
    if (!selection || !selectedFile?.storyboard) {
        setHighlightedStoryboardItemIds(new Set());
        setHighlightedScriptSegments(new Set());
        return;
    }

    const matchedIds = new Set<string>();
    const matchedSegments = new Set<string>();
    
    // 🆕 Bug 5 修复：StoryboardItem.shotNumber 可能是 number（来自 loadEpisodeData / aiExtractShots 路径），
    // 直接 .match 会抛 TypeError。统一安全转 string。
    const safeShotNumStr = (sn: string | number | undefined | null): string => {
        if (sn === undefined || sn === null) return '';
        return typeof sn === 'string' ? sn : String(sn);
    };

    // 🔧 策略0（三阶段精确匹配）：按 videoScriptBlock 子串定位所属镜头。
    // 三阶段里 scriptContent = 各段视频脚本拼接，镜头号全局重复（每段都从镜头1重排），
    // 仅靠镜头号会永远命中第一个。videoScriptBlock 是段内唯一的原文块，能精确锁定。
    const seln = selection.trim();
    if (seln.length >= 3) {
        selectedFile.storyboard.items.forEach(item => {
            const blk = item.videoScriptBlock;
            if (blk && blk.trim() && (blk.includes(seln) || seln.includes(blk.trim()))) {
                matchedIds.add(item.id);
                matchedSegments.add(blk);
            }
        });
    }

    // 🔧 策略1：如果 selection 包含镜头号（如 "镜头01"），直接匹配（仅在策略0未命中时）
    const shotMatch = selection.match(/镜头\s*(\d+)/);
    if (matchedIds.size === 0 && shotMatch) {
        const shotNum = parseInt(shotMatch[1]);
        selectedFile.storyboard.items.forEach(item => {
            const itemNum = safeShotNumStr(item.shotNumber).match(/\d+/)?.[0];
            if (itemNum && parseInt(itemNum) === shotNum) {
                matchedIds.add(item.id);
                matchedSegments.add(safeShotNumStr(item.shotNumber) || item.scriptSegment);
            }
        });
    }
    
    // 🔧 策略2：如果没有匹配到，尝试在 scriptContent 中定位所属镜头
    if (matchedIds.size === 0 && selectedFile.scriptContent) {
        const content = selectedFile.scriptContent;
        const selectionIndex = content.indexOf(selection);
        if (selectionIndex !== -1) {
            // 往前查找最近的镜头标识
            const beforeText = content.substring(0, selectionIndex);
            const shotMatches = [...beforeText.matchAll(/镜头\s*(\d+)/g)];
            if (shotMatches.length > 0) {
                const lastMatch = shotMatches[shotMatches.length - 1];
                const shotNum = parseInt(lastMatch[1]);
                selectedFile.storyboard.items.forEach(item => {
                    const itemNum = safeShotNumStr(item.shotNumber).match(/\d+/)?.[0];
                    if (itemNum && parseInt(itemNum) === shotNum) {
                        matchedIds.add(item.id);
                        matchedSegments.add(safeShotNumStr(item.shotNumber) || item.scriptSegment);
                    }
                });
            }
        }
    }
    
    // 🔧 策略3：降级到原来的匹配逻辑（兼容旧数据）
    if (matchedIds.size === 0) {
        selectedFile.storyboard.items.forEach(item => {
            const originalText = item.originalText || item.scriptSegment;
            if (originalText && originalText.includes(selection)) {
                matchedIds.add(item.id);
                matchedSegments.add(originalText);
            }
        });
    }

    setHighlightedStoryboardItemIds(matchedIds);
    setHighlightedScriptSegments(matchedSegments);
  };

  const handleStoryboardSelectionChange = (selectedIds: Set<string>) => {
      setHighlightedStoryboardItemIds(selectedIds);
      
      if (!selectedFile?.storyboard) return;

      const segments = new Set<string>();
      selectedFile.storyboard.items.forEach(item => {
          if (selectedIds.has(item.id)) {
              // 添加脚本片段
              segments.add(item.scriptSegment);
              
              // 🔧 同时添加人物台词（如果有）
              if (item.dialogue && item.dialogue.trim()) {
                  segments.add(item.dialogue.trim());
              }
          }
      });
      setHighlightedScriptSegments(segments);
      // 🔧 点击卡片时，StoryboardColumn会手动滚动
      // 框选脚本时，不会触发滚动（因为移除了useEffect的自动滚动）
  };

  // --- Manual Update Handlers (Script & Storyboard) ---

  const handleUpdateScript = (newContent: string) => {
      if (!selectedFileId) return;
      updateFileWithHistory(selectedFileId, (f) => ({ ...f, scriptContent: newContent }));
  };

  // 🆕 更新整个分镜列表（用于拆分、润色等操作）
  const handleUpdateStoryboardItems = (items: StoryboardItem[]) => {
      if (!selectedFileId) return;
      updateFileWithHistory(selectedFileId, (f) => ({ 
        ...f, 
        storyboard: { ...f.storyboard, items }
      }));
  };

  const updateStoryboardItemRef = useRef<
    (itemId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => void
  >();

  updateStoryboardItemRef.current = (itemId, updates) => {
      if (!selectedFileId) return;
      const currentFile = files.find(f => f.id === selectedFileId);
      const currentItem = currentFile?.storyboard?.items.find(i => i.id === itemId);

      updateFileWithHistory(selectedFileId, (f) => {
          if (!f.storyboard) return f;
          const newItems = f.storyboard.items.map(item => {
              if (item.id !== itemId) return item;
              const actualUpdates = typeof updates === 'function' ? updates(item) : updates;
              return { ...item, ...actualUpdates };
          });
          return { ...f, storyboard: { ...f.storyboard, items: newItems } };
      });

      if (currentItem) {
          const actualUpdates = typeof updates === 'function' ? updates(currentItem) : updates;
          if ('characters' in actualUpdates || 'scene' in actualUpdates) {
              const updatedItem = { ...currentItem, ...actualUpdates };
              const bound_assets = [
                  ...(updatedItem.characters || []).map((c: string) => `char:${c}`),
                  ...(updatedItem.scene ? [`scene:${updatedItem.scene}`] : []),
              ];
              updateStoryboardItem(itemId, { bound_assets }).catch(err => {
                  console.error('❌ 保存分镜标签失败:', err);
              });
          }
      }
  };

  const handleUpdateStoryboardItem = useCallback(
      (itemId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => {
          flushSync(() => {
              updateStoryboardItemRef.current?.(itemId, updates);
          });
      },
      []
  );

  // --- Material Binding Logic (Propagate Forward) ---

  const handleBindMaterial = (shotId: string, tagName: string, materialId: string) => {
    if (!selectedFileId || !selectedFile?.storyboard) return;

    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard) return f;

      const currentShotIndex = f.storyboard.items.findIndex(i => i.id === shotId);
      if (currentShotIndex === -1) return f;

      const newItems = [...f.storyboard.items];
      
      // Propagate forward: from current shot to end
      for (let i = currentShotIndex; i < newItems.length; i++) {
        const item = newItems[i];
        // If this shot contains the tag (Character or Scene)
        if (item.characters.includes(tagName) || item.scene === tagName) {
           newItems[i] = {
             ...item,
             materialSelections: {
               ...(item.materialSelections || {}),
               [tagName]: materialId
             }
           };
        }
      }

      return {
        ...f,
        storyboard: { items: newItems }
      };
    });
  };

  const handleUnbindMaterial = (shotId: string, tagName: string) => {
    if (!selectedFileId || !selectedFile?.storyboard) return;

    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard) return f;

      const currentShotIndex = f.storyboard.items.findIndex(i => i.id === shotId);
      if (currentShotIndex === -1) return f;

      const newItems = [...f.storyboard.items];
      
      // Delete forward: from current shot to end
      for (let i = currentShotIndex; i < newItems.length; i++) {
        const item = newItems[i];
        if (item.characters.includes(tagName) || item.scene === tagName) {
           const newSelections = { ...(item.materialSelections || {}) };
           delete newSelections[tagName];

           newItems[i] = {
             ...item,
             materialSelections: newSelections
           };
        }
      }

      return {
        ...f,
        storyboard: { items: newItems }
      };
    });
  };

  // 🆕 追加其他文件的分镜到当前文件（支持多文件，根据文件顺序决定追加位置）
  const handleAppendStoryboard = useCallback((sourceFileIds: string[]) => {
    if (!selectedFileId || sourceFileIds.length === 0) return;
    
    const targetFileIndex = files.findIndex(f => f.id === selectedFileId);
    const targetFile = files[targetFileIndex];
    
    if (!targetFile) {
      console.warn('目标文件不存在');
      return;
    }
    
    // 按文件在列表中的位置排序源文件
    const sortedSourceFiles = sourceFileIds
      .map(id => ({ id, index: files.findIndex(f => f.id === id) }))
      .filter(({ index }) => index !== -1)
      .sort((a, b) => a.index - b.index)
      .map(({ id }) => files.find(f => f.id === id)!)
      .filter(f => f.storyboard?.items?.length);  // 过滤掉没有镜头的文件
    
    if (sortedSourceFiles.length === 0) {
      console.warn('没有可追加的镜头');
      return;
    }
    
    console.log(`📎 批量追加分镜: ${sortedSourceFiles.map(f => f.name).join(', ')} → ${targetFile.name}`);
    
    // 分离在目标文件上方和下方的源文件
    const frontFiles = sortedSourceFiles.filter(f => files.findIndex(sf => sf.id === f.id) < targetFileIndex);
    const backFiles = sortedSourceFiles.filter(f => files.findIndex(sf => sf.id === f.id) > targetFileIndex);
    
    // 构建前置镜头（按文件顺序）
    const frontItems: StoryboardItem[] = frontFiles.flatMap(sourceFile => 
      sourceFile.storyboard!.items.map(item => ({
        ...item,
        id: uuidv4(),
        sourceFileId: sourceFile.id,  // 🆕 标记来源文件
        sourceFileName: sourceFile.name,
        materialSelections: item.materialSelections ? { ...item.materialSelections } : undefined
      }))
    );
    
    // 构建追加镜头（按文件顺序）
    const backItems: StoryboardItem[] = backFiles.flatMap(sourceFile => 
      sourceFile.storyboard!.items.map(item => ({
        ...item,
        id: uuidv4(),
        sourceFileId: sourceFile.id,  // 🆕 标记来源文件
        sourceFileName: sourceFile.name,
        materialSelections: item.materialSelections ? { ...item.materialSelections } : undefined
      }))
    );
    
    console.log(`   前置镜头数: ${frontItems.length}, 追加镜头数: ${backItems.length}`);
    console.log(`   目标文件原镜头数: ${targetFile.storyboard?.items?.length || 0}`);
    
    updateFileWithHistory(selectedFileId, (f) => {
      const existingItems = f.storyboard?.items || [];
      const combinedItems = [...frontItems, ...existingItems, ...backItems];
      
      console.log(`   合并后镜头数: ${combinedItems.length}`);
      
      return {
        ...f,
        storyboard: { items: combinedItems },
        lastUpdated: Date.now()
      };
    });
    
    // 合并所有源文件的角色和场景
    const allCharacters = sortedSourceFiles.flatMap(f => f.extractedCharacters || []);
    const allScenes = sortedSourceFiles.flatMap(f => f.extractedScenes || []);
    
    if (allCharacters.length || allScenes.length) {
      setFiles(prev => prev.map(f => {
        if (f.id === selectedFileId) {
          const newCharacters = [...new Set([...(f.extractedCharacters || []), ...allCharacters])];
          const newScenes = [...new Set([...(f.extractedScenes || []), ...allScenes])];
          return {
            ...f,
            extractedCharacters: newCharacters,
            extractedScenes: newScenes
          };
        }
        return f;
      }));
    }
    
    console.log(`✅ 批量追加完成: ${sortedSourceFiles.length} 个文件的镜头已追加到 ${targetFile.name}`);
  }, [selectedFileId, files, updateFileWithHistory]);
  
  // 🆕 移除追加的镜头（按来源文件）
  const handleRemoveAppendedStoryboard = useCallback((sourceFileId?: string) => {
    if (!selectedFileId) return;
    
    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard?.items) return f;
      
      let newItems: StoryboardItem[];
      
      if (sourceFileId) {
        // 移除指定来源文件的镜头
        newItems = f.storyboard.items.filter(item => item.sourceFileId !== sourceFileId);
        console.log(`🗑️ 移除来自 ${sourceFileId} 的追加镜头`);
      } else {
        // 移除所有追加的镜头（保留没有 sourceFileId 的原始镜头）
        newItems = f.storyboard.items.filter(item => !item.sourceFileId);
        console.log(`🗑️ 移除所有追加的镜头`);
      }
      
      return {
        ...f,
        storyboard: { items: newItems },
        lastUpdated: Date.now()
      };
    });
  }, [selectedFileId, updateFileWithHistory]);

  // --- Storyboard Actions (Lock, Delete, Regenerate, Export) ---

  const handleLockItem = (id: string) => {
      if (!selectedFileId) return;
      updateFileWithHistory(selectedFileId, (f) => {
          if (!f.storyboard) return f;
          return {
              ...f,
              storyboard: {
                  items: f.storyboard.items.map(item => item.id === id ? { ...item, isLocked: !item.isLocked } : item)
              }
          };
      });
  };

  const handleDeleteStoryboardItem = (id: string) => {
      if (!selectedFileId || !selectedFile?.storyboard) return;
      
      // 找到要删除的 item
      const itemToDelete = selectedFile.storyboard.items.find(item => item.id === id);
      if (!itemToDelete) return;
      
      const originalText = itemToDelete.originalText || itemToDelete.scriptSegment;
      
      // 检查同一个 originalText 是否还有其他非 placeholder 的 items
      const sameTextItems = selectedFile.storyboard.items.filter(item => {
          const itemOriginalText = item.originalText || item.scriptSegment;
          return itemOriginalText === originalText && item.id !== id && !item.isPlaceholder;
      });

      const isPersistedId = typeof id === 'string' && id.startsWith('sb_');
      const willHardDelete = sameTextItems.length > 0;

      updateFileWithHistory(selectedFileId, (f) => {
          if (!f.storyboard) return f;
          
          if (willHardDelete) {
          return {
              ...f,
              storyboard: {
                      items: f.storyboard.items.filter(item => item.id !== id)
                  }
              };
          }
          
          return {
              ...f,
              storyboard: {
                  items: f.storyboard.items.map(item => 
                      item.id === id ? { ...item, isPlaceholder: true } : item
                  )
              }
          };
      });

      if (isPersistedId) {
          deleteStoryboardItem(id).catch(err => {
              console.error('❌ 删除分镜失败:', err);
          });
      }
  };

  const handleRegenerateItem = async (id: string, instruction?: string) => {
      if (!selectedFileId || !selectedFile?.storyboard) return;
      
      const itemToRegen = selectedFile.storyboard.items.find(i => i.id === id);
      if (!itemToRegen || itemToRegen.isLocked) return;

      setIsProcessing(true);
      try {
        const newData = await aiRegenerateSingleShot(aiModel, itemToRegen.scriptSegment, instruction);
          
          updateFileWithHistory(selectedFileId, (f) => {
              if (!f.storyboard) return f;
              return {
                  ...f,
                  storyboard: {
                      items: f.storyboard.items.map(item => 
                          item.id === id ? { ...item, ...newData, isPlaceholder: false } : item
                      )
                  }
              };
          });
      } catch (e) {
          console.error("Single Regen Failed", e);
          alert("单镜头重绘失败: 可能是网络繁忙，请稍后再试。");
      } finally {
          setIsProcessing(false);
      }
  };

  // ✨ 手动插入新分镜
  const handleInsertShot = async (position: number, shotData: Omit<StoryboardItem, 'id'>) => {
    if (!selectedFileId || !selectedFile?.storyboard) return;

    const newItem: StoryboardItem = {
      ...shotData,
      id: uuidv4()
    };

    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard) return f;
      const newItems = [...f.storyboard.items];
      newItems.splice(position, 0, newItem);
      return {
        ...f,
        storyboard: {
          items: newItems
        }
      };
    });
  };

  // ✨ AI生成并插入新分镜
  const handleInsertShotWithAI = async (position: number, originalText: string) => {
    if (!selectedFileId || !selectedFile?.storyboard) return;

    setIsProcessing(true);
    try {
      // 获取上下文（前后各一个镜头）
      const items = selectedFile.storyboard.items;
      const prevItem = position > 0 ? items[position - 1] : null;
      const nextItem = position < items.length ? items[position] : null;
      
      let contextPrompt = `请基于以下原文段落生成分镜信息：\n\n原文：${originalText}\n\n`;
      if (prevItem) {
        contextPrompt += `前一个镜头场景描述：${prevItem.scriptSegment}\n`;
      }
      if (nextItem) {
        contextPrompt += `后一个镜头场景描述：${nextItem.scriptSegment}\n`;
      }
      contextPrompt += '\n请返回新镜头的 scriptSegment, imagePrompt, videoPrompt, dialogue, characters, scene';

      const newData = await aiRegenerateSingleShot(aiModel, originalText, contextPrompt);
      
      const newItem: StoryboardItem = {
        ...newData,
        originalText,
        id: uuidv4()
      };

      updateFileWithHistory(selectedFileId, (f) => {
        if (!f.storyboard) return f;
        const newItems = [...f.storyboard.items];
        newItems.splice(position, 0, newItem);
        return {
          ...f,
          storyboard: {
            items: newItems
          }
        };
      });
    } catch (e) {
      console.error("AI Insert Shot Failed", e);
      alert("AI生成分镜失败: 可能是网络繁忙，请稍后再试。");
      } finally {
          setIsProcessing(false);
      }
  };

  /**
   * 🚀 按需加载视图数据（非阻塞）
   * 由于所有视图共享项目数据，这个函数主要用于记录和扩展
   */
  const loadViewData = useCallback(async (view: AppView) => {
    // 静默加载，不打印日志（提升性能）
  }, []);
  
  /**
   * 🔮 智能预加载下一个视图（静默模式）
   */
  const schedulePreloadNextView = useCallback((currentView: AppView) => {
  }, []);
  
  /**
   * 🚀 优化：即点即显示的视图切换（无阻塞loading）
   */
  const handleViewSwitch = useCallback((targetView: AppView) => {
    setCurrentView(targetView);
    // 同步更新 URL（从当前路径提取 projectId）
    const segments = location.pathname.split('/');
    const projIdx = segments.indexOf('projects');
    if (projIdx >= 0 && segments[projIdx + 1]) {
      const pid = segments[projIdx + 1];
      const pageMap: Record<string, string> = {
        [AppView.Editor]: 'editor',
        [AppView.Materials]: 'materials',
        [AppView.Generation]: 'generation',
        [AppView.Video]: 'video',
        [AppView.History]: 'history',
        [AppView.Admin]: 'admin',
        [AppView.PostProcess]: 'postprocess',
      };
      const page = pageMap[targetView] || 'editor';
      routerNavigate(`/projects/${pid}/${page}`, { replace: true });
    }
  }, [location.pathname, routerNavigate]);

  const handleExportStoryboards = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const pathSegments = location.pathname.split('/');
      const epIdx = pathSegments.indexOf('ep');
      if (epIdx >= 0 && pathSegments[epIdx + 1]) {
        const projIdx = pathSegments.indexOf('projects');
        const pid = projIdx >= 0 ? pathSegments[projIdx + 1] : '';
        const eid = pathSegments[epIdx + 1];
        if (pid && eid && selectedFile) {
          const charSet = new Set<string>(selectedFile.extractedCharacters || []);
          const sceneSet = new Set<string>(selectedFile.extractedScenes || []);
          if (selectedFile.storyboard?.items) {
            for (const item of selectedFile.storyboard.items) {
              if (item.characters) item.characters.forEach(c => { if (c) charSet.add(c); });
              if (item.scene) sceneSet.add(item.scene);
            }
          }
          const charNames = Array.from(charSet);
          const sceneNames = Array.from(sceneSet);

          // 2026-05-20 (Bug 3)：导出时永远写入非 NULL 的 planned_duration_ms。
          // 优先 LLM 解析的「时间：N秒」字段，失败回退按台词字数估算（4 字/秒），
          // 最低 2 秒。这样视频页 fallback 不会再回到 5 秒默认值。
          const dbItems = (selectedFile.storyboard?.items || []).map((item, idx) => ({
            sort_order: idx,
            scene_heading: item.originalText || item.scene || '',
            action_text: item.scriptSegment || '',
            dialogue: item.dialogue || '',
            camera_movement: item.cameraMovement || '',
            image_prompt: item.imagePrompt || '',
            video_prompt: item.videoPrompt || '',
            planned_duration_ms: estimateDurationMs({
              durationStr: item.duration,
              dialogueText: item.dialogue,
            }),
            bound_assets: [
              ...(item.characters || []).map((c: string) => `char:${c}`),
              ...(item.scene ? [`scene:${item.scene}`] : []),
            ],
          }));

          try {
            await exportScript(eid, {
              project_id: pid,
              original_content: selectedFile.originalContent || '',
              script_content: selectedFile.scriptContent || '',
              storyboard_items: dbItems,
              characters: charNames.map(n => ({ name: n, description: '' })),
              scenes: sceneNames.map(n => ({ name: n, description: '' })),
              script_id: selectedFile.id,
            });
            console.log(`✅ 原子导出完成: ${dbItems.length} 个分镜`);
          } catch (e) {
            console.error('导出失败:', e);
            alert('导出失败: ' + (e instanceof Error ? e.message : '未知错误'));
            return;
          }
          try { await onAfterExport?.(); } catch (e) { console.warn('export 后置刷新失败:', e); }
          routerNavigate(`/projects/${pid}/ep/${eid}/workflow/design`);
          return;
        }
      }
      handleViewSwitch(AppView.Materials);
    } finally {
      setIsExporting(false);
    }
  };

  // --- AI Operations ---

  /**
   * 🔧 新版AI改写：直接生成分镜脚本格式并自动解析镜头卡片
   * 流程：2 → 3 → 4 一步完成
   * 🆕 支持分段处理：超过10个镜头时，分段调用API，结果追加到前端
   *
   * 重要：每段独立调用 AI，AI 在每段内都从 镜头01 开始编号（因为每段最多 10 个镜头）。
   * 因此必须基于全局位置重新编号，否则跨段去重会误删第 2/3/... 段的所有镜头
   * （详见 docs/faq.md - "AI 改写后只生成 10 个镜头" 词条）。
   */
  const handleRewrite = useCallback(async (targetFileId?: string) => {
    setIsProcessing(true);
    setProcessingType('rewrite'); // 标记为AI改写
    const idsToProcess = getTargetIds(targetFileId);

    // 🆕 helper: 按全局位置重新编号镜头（shotNumber + originalText 首行）
    const renumberItem = (item: StoryboardItem, seqNum: number): StoryboardItem => {
        const newShotId = `镜头${String(seqNum).padStart(2, '0')}`;
        const rewrittenOriginal = (item.originalText || '').replace(/^镜头\s*\d+/, newShotId);
        return {
            ...item,
            shotNumber: newShotId,
            originalText: rewrittenOriginal || newShotId,
        };
    };

    // 🆕 helper: 构造已生成镜头的简要摘要传给续写 AI（让它能在原文里定位接续点）
    // 仅取最近 10 条 + 每条截断到 80 字，token 占用可控。修复 Bug 3：
    // 此前续写时把同一段全文当"剩余文本"传入，AI 没有任何上下文知道
    // "已经覆盖到原文哪里"，导致续写无效，最终只剩第一次的 10 个镜头。
    const buildPreviousShotsSummary = (items: StoryboardItem[]): string => {
        if (items.length === 0) return '';
        const recent = items.slice(-10);
        return recent.map(item => {
            const desc = (item.scriptSegment || item.imagePrompt || item.videoPrompt || '')
                .replace(/\s+/g, ' ')
                .trim();
            const snippet = desc.length > 80 ? desc.substring(0, 80) + '…' : desc;
            return `${item.shotNumber}：${snippet}`;
        }).join('\n');
    };

    for (const id of idsToProcess) {
        updateFileStatus(id, FileStatus.Processing);
        try {
            const currentFile = files.find(f => f.id === id);
            if (!currentFile) continue;

            // 🆕 分段处理：将长输入分成多个部分
            const totalShots = countShots(currentFile.originalContent);
            console.log(`📊 输入内容包含 ${totalShots} 个镜头标识`);

            // 🔧 分段（每10个镜头一段，不再重叠，避免重复生成）
            const segments = segmentInputContent(currentFile.originalContent, 10, 0);
            console.log(`📎 分成 ${segments.length} 段进行处理`);

            // 全局累积的结果
            let allParsedItems: StoryboardItem[] = [];
            let allDisplayText = '';

            // 🆕 处理每一段
            for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
                const segment = segments[segmentIndex];
                console.log(`🎬 处理第 ${segmentIndex + 1}/${segments.length} 段...`);

                // 每段的临时变量
                let streamBuffer = '';
                let displayText = '';
                let parsedItems: StoryboardItem[] = [];
                let fullAccumulatedScript = '';

                // 🆕 内部函数：处理流式输出
                const handleStreamChunk = (chunk: string) => {
                    streamBuffer += chunk;
                    fullAccumulatedScript += chunk;

                    // 实时解析已完成的镜头块
                    const { completedBlocks, displayText: newDisplayText, remainingBuffer } =
                        parseStreamingBlocks(streamBuffer);

                    // 将完成的块转换为 StoryboardItem，并按全局位置重新编号
                    if (completedBlocks.length > 0) {
                        const baseIdx = allParsedItems.length + parsedItems.length;
                        const newItems = completedBlocks.map((block, idx) =>
                            renumberItem(convertToStoryboardItem(block), baseIdx + idx + 1)
                        );
                        parsedItems = [...parsedItems, ...newItems];
                        streamBuffer = remainingBuffer;

                        // 更新显示文本（移除控制符）
                        displayText += newDisplayText + '\n\n';
                    }

                    // 🆕 实时更新UI：显示当前段+已完成的所有段
                    const currentDisplay = allDisplayText + removeControlCharacters(displayText + remainingBuffer);
                    const currentItems = [...allParsedItems, ...parsedItems];
                    setFiles(prevFiles => prevFiles.map(f =>
                        f.id === id ? {
                            ...f,
                            scriptContent: currentDisplay,
                            storyboard: { items: currentItems }
                        } : f
                    ));
                };

                // 🆕 内部函数：完成最后一个块的解析
                const finalizeCurrentBuffer = () => {
                    if (streamBuffer.trim()) {
                        const { completedBlocks, displayText: finalDisplayText } =
                            parseStreamingBlocks(streamBuffer + '---CUT---');

                        if (completedBlocks.length > 0) {
                            const baseIdx = allParsedItems.length + parsedItems.length;
                            const finalItems = completedBlocks.map((block, idx) =>
                                renumberItem(convertToStoryboardItem(block), baseIdx + idx + 1)
                            );
                            parsedItems = [...parsedItems, ...finalItems];
                            displayText += finalDisplayText;
                        }
                        streamBuffer = '';
                    }
                };

                // 生成当前段
                await aiGenerateStoryboardScript(
                    aiModel,
                    segment,
                    '',  // 不再需要 userRequirements
                    handleStreamChunk
                );

                // 最终解析当前段
                finalizeCurrentBuffer();

                // 🆕 自动续写：当 AI 在单段内输出 <<<CONTINUE_FROM 镜头XX>>> 时继续生成。
                // 必要场景：
                //   - 输入是无 镜头N 标记的叙事文本（segmentByParagraphs 可能产出 1 段）
                //   - 输入有 < 10 个 镜头N 标记（segmentInputContent 直接返回 [content]）
                //   - 单段内容很长，AI 命中"本次最多 10 个镜头块"硬上限
                // 不做续写时第二半内容会被永久丢失。全局重编号已保证不会因为续写产生
                // shotNumber 冲突，最坏情况是 AI 偶尔重复，被空过滤+全局重编号兜住。
                const detectContinueMarker = (text: string): string | null => {
                    const m = text.match(/<<<CONTINUE_FROM\s+(镜头\d+)>>>/);
                    return m ? m[1] : null;
                };
                // 🔧 Bug 6 修复：续写循环失控会导致 92 个镜头被生成成 450 个（4-5x 重复）。
                // 三层硬约束（不依赖 AI 自觉判断"已完成"）：
                // 1) 段内已知镜头数硬上限：当段内有 镜头N 标记时（场景 B/C），用 countShots
                //    直接知道这段最多应该几个镜头，达到就强制 break，不再调 AI
                // 2) 续写零产出 break：本轮续写没产出任何新有效镜头 → AI 在重复或没东西可写 → break
                // 3) MAX 从 8 调到 3：纯叙事文本场景兜底，避免 8 轮 × 10 镜头 = 80 镜头/段的爆炸
                const expectedShotsInSegment = countShots(segment); // 0 表示叙事文本（无标记）
                const MAX_CONTINUATIONS_PER_SEGMENT = 3;
                let continuationCount = 0;
                let nextShotId = detectContinueMarker(fullAccumulatedScript);
                while (nextShotId && continuationCount < MAX_CONTINUATIONS_PER_SEGMENT) {
                    // 硬约束 1：段内已知镜头数已被覆盖 → 不再续写（AI 输出的 CONTINUE_FROM 是错觉）
                    if (expectedShotsInSegment > 0 && parsedItems.length >= expectedShotsInSegment) {
                        console.log(`✋ 第 ${segmentIndex + 1} 段已生成 ${parsedItems.length} 个镜头（段内标记数 ${expectedShotsInSegment}），跳过续写`);
                        break;
                    }

                    continuationCount++;
                    console.log(`🔄 第 ${segmentIndex + 1} 段第 ${continuationCount} 次续写：从 ${nextShotId} 开始`);
                    const beforeContinue = parsedItems.length;
                    streamBuffer = '';
                    fullAccumulatedScript = '';
                    try {
                        // 🔧 Bug 3 修复：把"已生成镜头的简要摘要"传给续写 AI
                        // 让它能在原文里定位接续点，而不是面对同样输入两眼一抹黑
                        const previousContext = buildPreviousShotsSummary([...allParsedItems, ...parsedItems]);
                        await aiContinueStoryboardScript(aiModel, nextShotId, segment, previousContext, handleStreamChunk);
                        finalizeCurrentBuffer();
                    } catch (err) {
                        console.error(`❌ 续写失败 (第 ${segmentIndex + 1} 段第 ${continuationCount} 次):`, err);
                        break;
                    }

                    // 硬约束 2：本轮续写没产出新镜头 → AI 没东西可写 → 立即停
                    const newCount = parsedItems.length - beforeContinue;
                    if (newCount === 0) {
                        console.log(`✋ 第 ${segmentIndex + 1} 段第 ${continuationCount} 次续写零产出，停止续写循环`);
                        break;
                    }

                    nextShotId = detectContinueMarker(fullAccumulatedScript);
                }
                if (continuationCount >= MAX_CONTINUATIONS_PER_SEGMENT && nextShotId) {
                    console.warn(`⚠️ 第 ${segmentIndex + 1} 段达到最大续写次数 ${MAX_CONTINUATIONS_PER_SEGMENT}，仍有未生成内容（${nextShotId}）`);
                }

                // 🆕 过滤空镜头（没有 imagePrompt 和 videoPrompt 的镜头）
                parsedItems = parsedItems.filter(item => {
                    const hasContent = (item.imagePrompt && item.imagePrompt.trim()) ||
                                       (item.videoPrompt && item.videoPrompt.trim()) ||
                                       (item.scriptSegment && item.scriptSegment.trim());
                    if (!hasContent) {
                        console.log(`🗑️ 过滤空镜头: ${item.shotNumber}`);
                    }
                    return hasContent;
                });

                // 🔧 过滤后可能有编号空洞，重新连续编号（基于全局位置）
                const segmentBaseIdx = allParsedItems.length;
                parsedItems = parsedItems.map((item, idx) =>
                    renumberItem(item, segmentBaseIdx + idx + 1)
                );

                // 🚫 不再做基于 shotNumber 的跨段去重 ——
                // 原逻辑会误判：每段 AI 都从 镜头01 开始编号，导致第 2/3/... 段被全部清空。
                // 现在通过全局重编号已彻底避免编号冲突，无需去重。

                // 追加到全局结果
                allParsedItems = [...allParsedItems, ...parsedItems];
                allDisplayText += displayText + '\n\n';

                console.log(`✅ 第 ${segmentIndex + 1} 段完成: ${parsedItems.length} 个镜头，累计: ${allParsedItems.length} 个`);
            }

            // 🆕 限制镜头数量
            // - 输入有 镜头N 标识时（totalShots > 0）：截到 totalShots（输入即真理）
            // - 叙事文本（totalShots = 0）：按段数兜底，每段最多保留 MAX_CONTINUATIONS_PER_SEGMENT+1
            //   即首次 10 + 续写 N 段；防止极端情况下还是产出过多重复
            //   （Bug 6 续写硬约束生效后这里几乎不会触发，仅作最后兜底）
            if (totalShots > 0 && allParsedItems.length > totalShots) {
                console.log(`⚠️ 生成了 ${allParsedItems.length} 个镜头，限制为输入的 ${totalShots} 个`);
                allParsedItems = allParsedItems.slice(0, totalShots);
            } else if (totalShots === 0) {
                const narrativeMax = Math.max(50, segments.length * 40);
                if (allParsedItems.length > narrativeMax) {
                    console.warn(`⚠️ 叙事文本生成了 ${allParsedItems.length} 个镜头，按兜底上限截到 ${narrativeMax} 个`);
                    allParsedItems = allParsedItems.slice(0, narrativeMax);
                }
            }

            // 最终更新（记录历史）
            const finalDisplayText = removeControlCharacters(allDisplayText);
            updateFileWithHistory(id, (f) => ({
                ...f,
                scriptContent: finalDisplayText,
                storyboard: { items: allParsedItems },
                status: FileStatus.Idle
            }));

            console.log(`✅ 生成完成：${allParsedItems.length} 个镜头（${segments.length} 段）`);

        } catch (error) {
            console.error(`Error processing file ${id}:`, error);
            updateFileStatus(id, FileStatus.Error);
        }
    }
    setIsProcessing(false);
    setProcessingType(null);
  }, [files, checkedFileIds, selectedFileId, aiModel]);

  /**
   * 🆕 从剧本中提取分镜和场景描述
   */
  const handleExtractShots = useCallback(async () => {
    if (!selectedFile?.scriptContent) {
      alert('请先生成剧本内容');
      return;
    }

    setIsShotExtracting(true);
    try {
      console.log('📤 开始提取分镜...');
      
      // 调用AI提取分镜
      const { aiExtractShotsFromScript } = await import('./services/aiModelService');
      const result = await aiExtractShotsFromScript(aiModel, selectedFile.scriptContent);
      
      console.log('✅ 提取成功，分镜数量:', result.items.length);
      
      // 转换为StoryboardItem数组
      const storyboardItems: StoryboardItem[] = result.items.map((item, index) => ({
        id: uuidv4(),
        shotNumber: index + 1,
        originalText: item.originalText,
        scriptSegment: item.scriptSegment,
        timestamp: Date.now(),
        // 其他字段为空，等待后续生成
        imagePrompt: undefined,
        videoPrompt: undefined,
        dialogue: undefined,
        characters: undefined,
        scene: undefined
      }));
      
      // 更新到文件的storyboard
      updateFileWithHistory(selectedFile.id, (f) => ({
        ...f,
        storyboard: { items: storyboardItems }
      }));
      
      console.log('✅ 分镜已保存到状态');
      
    } catch (error) {
      console.error('❌ 提取分镜失败:', error);
      alert(`提取分镜失败: ${(error as Error).message}`);
    } finally {
      setIsShotExtracting(false);
    }
  }, [selectedFile, aiModel, updateFileWithHistory]);

  // ===== 2026-05-29 三步生成链路 =====

  const setStage = useCallback((
    fileId: string,
    stage: 'split' | 'videoScript' | 'storyboardPrompt',
    patch: Partial<ScriptGenerationStageState>,
  ) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f;
      const stages = { ...(f.generationStages || {}) };
      stages[stage] = { status: 'idle', ...(stages[stage] || {}), ...patch, updatedAt: Date.now() };
      return { ...f, generationStages: stages };
    }));
  }, []);

  /** Stage 1：拆分剧本 */
  const handleSplitScript = useCallback(async (targetFileId?: string) => {
    // 🔧 通过 filesRef 读取，链式 pipeline 同一异步内可见上一阶段 setFiles 的结果
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    if (!file.originalContent?.trim()) { alert('请先在左栏粘贴原文文案'); return; }

    setStage(file.id, 'split', { status: 'running', errorMessage: '' });
    try {
      const segments = await aiSplitScriptIntoSegments(aiModel, file.originalContent);
      const applySegs = (arr: ProjectFile[]) => arr.map(f => f.id === file.id ? { ...f, scriptSegments: segments } : f);
      setFiles(applySegs);
      filesRef.current = applySegs(filesRef.current); // 同步镜像，供下一阶段立即读取
      setStage(file.id, 'split', { status: 'done', total: segments.length, completed: segments.length });
      await batchSaveScriptSegments(propEpisodeId, file.id, segments.map((s, idx) => ({
        segment_order: idx, source_text: s.sourceText,
        estimated_duration_sec: s.estimatedDurationSec, status: 'done',
      }))).catch(e => console.warn('保存分段失败:', e));
    } catch (e) {
      setStage(file.id, 'split', { status: 'error', errorMessage: (e as Error).message });
      alert(`拆分剧本失败: ${(e as Error).message}`);
    }
  }, [selectedFileId, aiModel, propEpisodeId, setStage]);

  /** Stage 2：逐段生成视频脚本，按 order 追加到 scriptContent */
  const handleGenerateVideoScript = useCallback(async (targetFileId?: string) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    const segs = file.scriptSegments || [];
    if (segs.length === 0) { alert('请先拆分剧本'); return; }

    setStage(file.id, 'videoScript', { status: 'running', total: segs.length, completed: 0, errorMessage: '' });
    const ordered = [...segs].sort((a, b) => a.order - b.order);
    const updated: ScriptSegment[] = [...ordered];
    let completed = 0;
    try {
      for (let i = 0; i < ordered.length; i++) {
        const seg = ordered[i];
        if (seg.status === 'done' && seg.videoScript) { completed++; continue; } // 跳过已完成（失败恢复）
        try {
          const text = await aiGenerateVideoScriptFromSegment(aiModel, seg);
          updated[i] = { ...seg, videoScript: text, status: 'done', errorMessage: '' };
          completed++;
          setStage(file.id, 'videoScript', { status: 'running', completed });
        } catch (segErr) {
          updated[i] = { ...seg, status: 'error', errorMessage: (segErr as Error).message };
          const applyErr = (arr: ProjectFile[]) => arr.map(f => f.id === file.id ? { ...f, scriptSegments: updated } : f);
          setFiles(applyErr);
          filesRef.current = applyErr(filesRef.current);
          setStage(file.id, 'videoScript', { status: 'error', completed, errorMessage: `第 ${i + 1} 段失败` });
          return; // 保留已完成，下次从失败段继续
        }
      }
      const fullScript = updated.map(s => s.videoScript || '').filter(Boolean).join('\n\n');
      const applyDone = (arr: ProjectFile[]) => arr.map(f => f.id === file.id
        ? { ...f, scriptSegments: updated, scriptContent: fullScript }
        : f);
      setFiles(applyDone);
      filesRef.current = applyDone(filesRef.current); // 同步镜像，供 Stage3 立即读取
      setStage(file.id, 'videoScript', { status: 'done', completed });
      await updateEpisodeScriptById(propEpisodeId, file.id, { adapted_script: fullScript }).catch(() => {});
      await batchSaveScriptSegments(propEpisodeId, file.id, updated.map((s, idx) => ({
        segment_order: idx, source_text: s.sourceText,
        estimated_duration_sec: s.estimatedDurationSec,
        video_script: s.videoScript || '', status: s.status || 'done',
      }))).catch(() => {});
    } catch (e) {
      setStage(file.id, 'videoScript', { status: 'error', errorMessage: (e as Error).message });
    }
  }, [selectedFileId, aiModel, propEpisodeId, setStage]);

  /** Stage 3：对每个视频镜头块提取分镜提示词 → StoryboardItem[] */
  const handleExtractStoryboardPrompts = useCallback(async (targetFileId?: string) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    const segs = (file.scriptSegments || []).filter(s => s.videoScript);
    if (segs.length === 0) { alert('请先生成视频脚本'); return; }

    // 收集所有镜头块（带 segmentId 关联）
    const shots: Array<{ segmentId: string; block: VideoScriptBlock }> = [];
    for (const seg of segs) {
      for (const block of parseVideoScriptBlocks(seg.videoScript!)) {
        shots.push({ segmentId: seg.id, block });
      }
    }
    if (shots.length === 0) { alert('未能从视频脚本解析出镜头'); return; }

    // total = 视频镜头数（AI 调用次数）；一个视频镜头可拆成多个分镜 item
    setStage(file.id, 'storyboardPrompt', { status: 'running', total: shots.length, completed: 0, errorMessage: '' });
    const items: StoryboardItem[] = [];
    // 把当前 items 写入 React state + filesRef（同步），供 Stage3 末尾的 saveEpisodeToBackend 立即看到
    const applyItems = (arr: ProjectFile[]) => arr.map(f => f.id === file.id ? { ...f, storyboard: { items } } : f);
    for (let i = 0; i < shots.length; i++) {
      const { segmentId, block } = shots[i];
      try {
        // 单个视频镜头 → 一个或多个更细的分镜
        const exList = await aiExtractStoryboardPromptFromVideoShot(aiModel, block.rawBlock);
        for (const ex of exList) {
          items.push({
            id: uuidv4(),
            shotNumber: items.length + 1,
            originalText: ex.sceneDescription || block.rawBlock.slice(0, 80),
            scriptSegment: ex.sceneDescription || '',
            characters: ex.characters || [],           // 人物 → bound_assets char:
            scene: ex.scene || '',                     // 场景 → bound_assets scene:
            imagePrompt: ex.imagePrompt || '',
            // Stage 2 单镜头块原文 → video_prompt（视频页消费）
            videoPrompt: block.rawBlock,
            dialogue: ex.dialogue || '',
            cameraMovement: [ex.shotSize, ex.cameraAngle, ex.cameraMove].filter(Boolean).join(' / '),
            plannedDurationMs: (ex.durationSec ?? block.durationSec) != null
              ? (ex.durationSec ?? block.durationSec)! * 1000 : null,
            scriptSegmentId: segmentId,
            sourceVideoShotNo: ex.shotNo || block.shotNo,
            videoScriptBlock: block.rawBlock,
            shotSize: ex.shotSize || '',
            cameraAngle: ex.cameraAngle || '',
            timestamp: Date.now(),
          });
        }
        setStage(file.id, 'storyboardPrompt', { status: 'running', completed: i + 1 });
      } catch (shotErr) {
        setFiles(applyItems);
        filesRef.current = applyItems(filesRef.current);
        setStage(file.id, 'storyboardPrompt', { status: 'error', completed: i, errorMessage: `第 ${i + 1} 个镜头失败` });
        return; // 保留已提取
      }
    }
    setFiles(applyItems);
    filesRef.current = applyItems(filesRef.current); // 关键：保证下面的 save 读到刚生成的 items
    setStage(file.id, 'storyboardPrompt', { status: 'done', completed: shots.length });
    await saveEpisodeToBackend();
  }, [selectedFileId, aiModel, propEpisodeId, setStage, saveEpisodeToBackend]);

  /** 主按钮：按三步顺序执行，从未完成的阶段开始 */
  const handleRunThreeStagePipeline = useCallback(async (targetFileId?: string) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    const hasSegments = (file.scriptSegments?.length || 0) > 0;
    const hasVideoScript = !!file.scriptContent && (file.scriptSegments || []).some(s => s.videoScript);
    const hasStoryboard = (file.storyboard?.items?.length || 0) > 0;

    if (hasSegments && hasVideoScript && hasStoryboard) {
      if (!confirm('三步均已完成，确定要全量重跑吗？')) return;
    }
    // 各阶段内部已改为读取 filesRef.current，并在 setFiles 后同步镜像，
    // 因此同一异步运行内 Stage1→2→3 能看到上一阶段写入的 scriptSegments / videoScript。
    if (!hasSegments) await handleSplitScript(file.id);
    await handleGenerateVideoScript(file.id);
    await handleExtractStoryboardPrompts(file.id);
  }, [selectedFileId, handleSplitScript, handleGenerateVideoScript, handleExtractStoryboardPrompts]);

  /**
   * 🔧 修改为循环模式：逐个生成分镜详情
   */
  const handleGenerateStoryboard = useCallback(async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    
    if (!file?.storyboard?.items || file.storyboard.items.length === 0) {
      alert('请先提取分镜和场景描述');
      return;
    }

    setIsProcessing(true);
    setProcessingType('generate-shots'); // 🆕 标记为生成详细分镜
    setShotGenerationProgress({ current: 0, total: file.storyboard.items.length });

    try {
      const updatedItems: StoryboardItem[] = [];
      
      // 🔄 for循环逐个生成
      for (let i = 0; i < file.storyboard.items.length; i++) {
        const item = file.storyboard.items[i];
        
        console.log(`🎬 正在生成第 ${i + 1}/${file.storyboard.items.length} 个分镜...`);
        
        try {
          // 调用AI生成详细信息
          const { aiGenerateShotDetails } = await import('./services/aiModelService');
          const details = await aiGenerateShotDetails(
            aiModel,
            item.originalText,
            item.scriptSegment
            // 🔧 已移除 storyboardUserRequirements - 新流程使用规则生成
          );
          
          // 拼接到当前分镜
          const completeItem: StoryboardItem = {
            ...item,
            ...details,
            timestamp: Date.now()
          };
          
          updatedItems.push(completeItem);
          
          // ✅ 立即更新状态，渲染当前分镜
          updateFileWithHistory(fileId, (f) => ({
                 ...f, 
            storyboard: { items: updatedItems }
          }));
          
          // 更新进度
          setShotGenerationProgress({ current: i + 1, total: file.storyboard.items.length });
          
          console.log(`✅ 第 ${i + 1} 个分镜生成完成`);
          
        } catch (error) {
          console.error(`❌ 第 ${i + 1} 个分镜生成失败:`, error);
          // 失败时保留原始数据，继续下一个
          updatedItems.push(item);
        }
      }
      
      console.log('🎉 所有分镜生成完成！');
      
    } catch (error) {
      console.error('❌ 批量生成失败:', error);
      alert(`生成失败: ${(error as Error).message}`);
    } finally {
      setIsProcessing(false);
      setProcessingType(null); // 🆕 清空处理类型
      setShotGenerationProgress(null);
    }
  }, [files, aiModel, updateFileWithHistory]);

  const handleExtractMetadata = useCallback(async (targetFileId?: string) => {
    setIsProcessing(true);
    const idsToProcess = getTargetIds(targetFileId);
    for (const id of idsToProcess) {
        updateFileStatus(id, FileStatus.Processing);
        try {
             const currentFile = files.find(f => f.id === id);
             if (!currentFile || !currentFile.scriptContent) continue;
             const metadata = await aiExtractScriptMetadata(aiModel, currentFile.scriptContent);
             
             updateFileWithHistory(id, (f) => ({
                 ...f,
                 extractedCharacters: metadata.characters,
                 extractedScenes: metadata.scenes,
                 status: FileStatus.Idle
             }));
        } catch (error) {
            console.error(error);
            updateFileStatus(id, FileStatus.Error);
        }
    }
    setIsProcessing(false);
  }, [files, checkedFileIds, selectedFileId, aiModel]);

  // Simple Refine (Text Only)
  const handleRefineScript = useCallback(async (selection: string, instruction: string) => {
    if (!selectedFileId || !selectedFile?.scriptContent) return;
    setIsProcessing(true);
    try {
        const newSegment = await aiRefineScriptSegment(aiModel, selection, instruction, selectedFile.scriptContent);
        const newScriptContent = selectedFile.scriptContent.replace(selection, newSegment);
        
        updateFileWithHistory(selectedFileId, (f) => ({ ...f, scriptContent: newScriptContent }));
    } catch (error) {
        console.error("Script refinement failed", error);
        alert("AI润色失败，请重试。");
    } finally {
        setIsProcessing(false);
    }
  }, [selectedFileId, selectedFile, aiModel]);

  // Complex Restructure (Split/Merge Storyboards + Text)
  // 🔧 改进匹配逻辑，同时检查 originalText 和 scriptSegment
  const handleRestructure = useCallback(async (selection: string, instruction: string, type: 'split' | 'merge') => {
      if (!selectedFileId || !selectedFile?.scriptContent || !selectedFile.storyboard) return;
      
      setIsProcessing(true);
      try {
          const items = selectedFile.storyboard.items;
          const matchedIndices: number[] = [];
          
          const cleanSelection = selection.trim();

          items.forEach((item, index) => {
              const cleanItemSegment = (item.scriptSegment || '').trim();
              const cleanOriginalText = (item.originalText || '').trim();
              
              // 🔧 同时检查 scriptSegment 和 originalText
              if (cleanSelection && (
                 // 匹配 scriptSegment
                 (cleanItemSegment && (cleanSelection.includes(cleanItemSegment) || cleanItemSegment.includes(cleanSelection))) ||
                 // 匹配 originalText
                 (cleanOriginalText && (cleanSelection.includes(cleanOriginalText) || cleanOriginalText.includes(cleanSelection)))
              )) {
                  matchedIndices.push(index);
              }
          });

          if (matchedIndices.length === 0) {
              const confirmRefine = window.confirm("未找到完全匹配的现有分镜。是否仅对剧本文字进行修改？\n(如果不关联分镜，可能导致剧本与现有分镜不一致)");
              if (confirmRefine) {
                  await handleRefineScript(selection, instruction);
              }
              return;
          }

          const startIndex = Math.min(...matchedIndices);
          const endIndex = Math.max(...matchedIndices);
          const count = endIndex - startIndex + 1;

          const result = await aiRestructureShot(aiModel, selection, instruction, type);

          // 🔧 确保新生成的分镜包含必需字段
          const newItems = result.newStoryboardItems.map((item: any) => ({
              id: uuidv4(),
              shotNumber: item.shotNumber || item.shotId,
              originalText: item.originalText || selection, // 确保有 originalText
              scriptSegment: item.scriptSegment || '',      // 确保有 scriptSegment
              imagePrompt: item.imagePrompt,
              videoPrompt: item.videoPrompt,
              dialogue: item.dialogue,
              characters: item.characters,
              scene: item.scene,
              timestamp: Date.now()
          }));

          // Strict Logic: If Split, DO NOT modify script content.
          let newScriptContent = selectedFile.scriptContent;
          if (type !== 'split') {
              newScriptContent = selectedFile.scriptContent.replace(selection, result.newScriptSegment);
          }

          const newStoryboardList = [...items];
          // Replace 'count' items starting from 'startIndex' with the new items
          newStoryboardList.splice(startIndex, count, ...newItems);

          updateFileWithHistory(selectedFileId, (f) => ({
              ...f,
              scriptContent: newScriptContent,
              storyboard: { items: newStoryboardList }
          }));

      } catch (error) {
          console.error("Restructure failed", error);
          alert("AI拆分/合并失败: 可能是模型繁忙，请稍后重试。");
      } finally {
          setIsProcessing(false);
      }
  }, [selectedFileId, selectedFile, handleRefineScript, aiModel]);

  const handleGlobalBatchProcess = useCallback(async () => {
      stopProcessingRef.current = false; // 重置停止标志
      setIsProcessing(true);
      setProcessingType('generate-shots'); // 🆕 标记为生成分镜流程
      const idsToProcess = checkedFileIds.size > 0 ? Array.from(checkedFileIds) : files.map(f => f.id);
      
      for (const id of idsToProcess) {
          // 🆕 检查停止标志
          if (stopProcessingRef.current) {
              console.log('⏸️ 用户手动停止处理');
              break;
          }
          
          try {
              updateFileStatus(id, FileStatus.Processing);
              let currentFile = files.find(f => f.id === id);
              if (!currentFile) continue;

              console.log(`🎬 开始处理文件: ${currentFile.title || id}`);

              // 步骤1: 如果没有剧本，先改写
              let script = currentFile.scriptContent;
              if (!script) {
                  console.log('📝 步骤1: 改写小说为剧本...');
                  let streamedContent = '';
                  script = await aiRewriteNovelToScript(
                      aiModel, 
                      currentFile.originalContent, 
                      '', // 🔧 已移除 rewriteUserRequirements
                      (chunk) => {
                      streamedContent += chunk;
                      setFiles(prevFiles => prevFiles.map(f => 
                          f.id === id ? { ...f, scriptContent: streamedContent } : f
                      ));
                      }
                  );
                  updateFileWithHistory(id, (f) => ({ ...f, scriptContent: script }));
                  currentFile = { ...currentFile, scriptContent: script };
                  console.log('✅ 步骤1完成: 剧本改写完成');
              }
              
              const contentToUse = script || currentFile.scriptContent!;
              if (!contentToUse) continue;

              // 步骤2: 提取分镜段落
              console.log('🎬 步骤2: 提取分镜段落...');
              const { aiExtractShotsFromScript } = await import('./services/aiModelService');
              const shotsResult = await aiExtractShotsFromScript(aiModel, contentToUse);
              
              const storyboardItems: StoryboardItem[] = shotsResult.items.map((item, index) => ({
                  id: `${Date.now()}_${index}`,
                  shotNumber: index + 1,
                  originalText: item.originalText,
                  scriptSegment: item.scriptSegment,
                  timestamp: Date.now(),
                  imagePrompt: '',
                  videoPrompt: '',
                  dialogue: '',
                  characters: [],
                  scene: ''
              }));
              
              console.log(`✅ 步骤2完成: 提取了 ${storyboardItems.length} 个分镜段落`);
              
              // 先保存分镜段落
              updateFileWithHistory(id, (f) => ({
                  ...f,
                  storyboard: { items: storyboardItems }
              }));

              // 步骤3: 逐个生成镜头设计
              console.log('🎨 步骤3: 开始生成镜头设计...');
              setShotGenerationProgress({ current: 0, total: storyboardItems.length });
              
              const updatedItems: StoryboardItem[] = [];
              
              for (let i = 0; i < storyboardItems.length; i++) {
                  const item = storyboardItems[i];
                  console.log(`🎬 生成第 ${i + 1}/${storyboardItems.length} 个分镜...`);
                  
                  try {
                      const { aiGenerateShotDetails } = await import('./services/aiModelService');
                      const details = await aiGenerateShotDetails(
                          aiModel,
                          item.originalText,
                          item.scriptSegment
                          // 🔧 已移除 storyboardUserRequirements - 新流程使用规则生成
                      );
                      
                      const completeItem: StoryboardItem = {
                          ...item,
                          ...details,
                          timestamp: Date.now()
                      };
                      
                      updatedItems.push(completeItem);
                      
                      // 实时更新进度
                      updateFileWithHistory(id, (f) => ({
                          ...f,
                          storyboard: { items: updatedItems }
                      }));
                      
                      setShotGenerationProgress({ current: i + 1, total: storyboardItems.length });
                      console.log(`✅ 第 ${i + 1} 个分镜生成完成`);
                      
                  } catch (error) {
                      console.error(`❌ 第 ${i + 1} 个分镜生成失败:`, error);
                      updatedItems.push(item);  // 失败时保留原始数据
                  }
              }
              
              console.log('✅ 步骤3完成: 所有分镜设计已生成');

              // 最终更新状态
              updateFileWithHistory(id, (f) => ({
                  ...f,
                  storyboard: { items: updatedItems },
                  status: FileStatus.Completed
              }));

              console.log(`🎉 文件处理完成: ${currentFile.title || id}`);

          } catch (error) {
              console.error(`❌ 全流程处理失败: ${id}`, error);
              updateFileStatus(id, FileStatus.Error);
              alert(`处理失败: ${(error as Error).message}`);
          }
      }
      
      setIsProcessing(false);
      setProcessingType(null);
      setShotGenerationProgress(null);
      stopProcessingRef.current = false; // 重置停止标志
      console.log('🎉 全部文件处理完成！');
  }, [files, checkedFileIds, aiModel, updateFileWithHistory]);
  
  // 🆕 停止处理函数
  const handleStopProcessing = useCallback(() => {
    stopProcessingRef.current = true;
    console.log('🛑 设置停止标志');
  }, []);

  const isFullView = visibleColumns.every(v => v);

  const renderAllViews = () => {
      const adminUsername = localStorage.getItem('username') || '';
      const isAdmin = adminUsername === 'admin' || adminUsername === 'lllsdhr';
      return (
        <>
          {/* Editor - 懒挂载 + display 切换，永不卸载 */}
          {mountedViews.has(AppView.Editor) && (
            <div style={{ display: currentView === AppView.Editor ? 'contents' : 'none' }}>
                {visibleColumns[0] && (
                <div 
                    style={{ width: isFullView ? `${colWidths[0]}%` : undefined }} 
                    className={`${isFullView ? 'flex-shrink-0' : 'flex-1'} h-full overflow-hidden relative transition-all duration-300`}
                >
                    <FileColumn 
                    files={files} 
                    selectedFileId={selectedFileId} 
                    checkedFileIds={checkedFileIds}
                    onFileSelect={handleFileSelect} 
                    onFileCheck={handleFileCheck}
                    onCheckAll={handleCheckAll}
                    onFileUpload={handleFileUpload}
                    onCreateBlankFile={handleCreateBlankFile}
                    onRenameFile={handleRenameFile}
                    onDeleteFile={handleDeleteFile}
                    onDownloadFile={handleDownloadFile}
                    onMoveFile={handleMoveFile}
                    onSaveVersion={handleSaveVersion}
                    onRestoreVersion={handleRestoreVersion}
                    isExpanded={!isFullView && visibleColumns[0]}
                    onToggleExpand={() => {}}
                    onReorderFiles={handleReorderFiles}
                    />
                </div>
                )}

                {isFullView && (
                    <div onMouseDown={() => startResizing(0)} className="w-1 bg-n0 hover:bg-primary cursor-col-resize z-20 flex-shrink-0 transition-colors" />
                )}

                {visibleColumns[1] && (
                <div 
                    style={{ width: isFullView ? `${colWidths[1]}%` : undefined }}
                    className={`${isFullView ? 'flex-shrink-0' : 'flex-1'} h-full overflow-hidden relative transition-all duration-300 flex flex-col`}
                >
                    <div className="flex-1 min-h-0 overflow-hidden relative">
                    <ViewerColumn 
                        selectedFile={selectedFile}
                        files={files}
                        checkedCount={checkedFileIds.size}
                        onRewrite={handleRewrite}
                        onUpdateContent={handleUpdateContent}
                        isProcessing={isProcessing}
                        isExpanded={!isFullView && visibleColumns[1]}
                        onToggleExpand={() => {}}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        canUndo={canUndo}
                        canRedo={canRedo}
                        aiModel={aiModel}
                        onChangeModel={setAiModel}
                    />
                    </div>
                    {selectedFile && (
                      <div className="flex-shrink-0 m-2 rounded-md border border-n40 bg-n0 p-3 text-sm shadow-card">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-n700">三步生成</span>
                          <button
                            className="px-3 py-1.5 rounded bg-primary hover:bg-primary-hover text-white text-xs font-bold disabled:opacity-50"
                            disabled={!selectedFile.originalContent?.trim()}
                            onClick={() => handleRunThreeStagePipeline(selectedFile.id)}
                          >按三步生成</button>
                        </div>

                        {([
                          { key: 'split', label: '1. 拆分剧本', action: () => handleSplitScript(selectedFile.id),
                            metric: `分段数: ${selectedFile.scriptSegments?.length ?? 0}` },
                          { key: 'videoScript', label: '2. 生成视频脚本', action: () => handleGenerateVideoScript(selectedFile.id),
                            metric: `已生成: ${(selectedFile.scriptSegments || []).filter(s => s.videoScript).length}/${selectedFile.scriptSegments?.length ?? 0}` },
                          { key: 'storyboardPrompt', label: '3. 提取分镜提示词', action: () => handleExtractStoryboardPrompts(selectedFile.id),
                            metric: `分镜提示词: ${(selectedFile.storyboard?.items || []).filter(i => i.imagePrompt).length}` },
                        ] as const).map(row => {
                          const st = selectedFile.generationStages?.[row.key];
                          const statusText = st?.status === 'running'
                            ? `进行中 ${st.completed ?? 0}/${st.total ?? '?'}`
                            : st?.status === 'done' ? '完成'
                            : st?.status === 'error' ? `失败: ${st.errorMessage || ''}` : '未开始';
                          const statusColor = st?.status === 'done' ? 'text-success'
                            : st?.status === 'error' ? 'text-danger'
                            : st?.status === 'running' ? 'text-warning' : 'text-n300';
                          return (
                            <div key={row.key} className="flex items-center justify-between py-1.5 border-t border-n40">
                              <div className="flex items-center gap-2">
                                <button
                                  className="px-2 py-1 rounded bg-n0 hover:bg-n20 text-n700 text-xs disabled:opacity-50"
                                  disabled={st?.status === 'running'}
                                  onClick={row.action}
                                >{row.label.replace(/^\d+\.\s*/, '')}</button>
                                <span className="text-xs text-n300">{row.metric}</span>
                              </div>
                              <span className={`text-xs ${statusColor}`}>{statusText}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                </div>
                )}

                {isFullView && (
                    <div onMouseDown={() => startResizing(1)} className="w-1 bg-n0 hover:bg-primary cursor-col-resize z-20 flex-shrink-0 transition-colors" />
                )}

                {visibleColumns[2] && (
                <div 
                    style={{ width: isFullView ? `${colWidths[2]}%` : undefined }}
                    className={`${isFullView ? 'flex-shrink-0' : 'flex-1'} h-full overflow-hidden relative transition-all duration-300`}
                >
                    <ScriptColumn 
                        selectedFile={selectedFile}
                        checkedCount={checkedFileIds.size}
                        onGenerateStoryboard={handleGenerateStoryboard}
                        onExtractMetadata={handleExtractMetadata}
                        onRefineScript={handleRefineScript}
                        onRestructure={handleRestructure}
                        onUpdateScript={handleUpdateScript}
                        onUpdateStoryboardItems={handleUpdateStoryboardItems}
                        isProcessing={isProcessing}
                        onExtractShots={handleExtractShots}
                        isShotExtracting={isShotExtracting}
                        aiModel={aiModel}
                        isExpanded={!isFullView && visibleColumns[2]}
                        onToggleExpand={() => {}}
                        highlightedTextSegments={highlightedScriptSegments}
                        highlightedItemIds={highlightedStoryboardItemIds}
                        onSelectionChange={handleScriptSelectionChange}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        canUndo={canUndo}
                        canRedo={canRedo}
                    />
                </div>
                )}

                {isFullView && (
                    <div onMouseDown={() => startResizing(2)} className="w-1 bg-n0 hover:bg-primary cursor-col-resize z-20 flex-shrink-0 transition-colors" />
                )}

                {visibleColumns[3] && (
                <div 
                    style={{ width: isFullView ? `${colWidths[3]}%` : undefined }}
                    className={`${isFullView ? 'flex-shrink-0' : 'flex-1'} h-full overflow-hidden relative transition-all duration-300`}
                >
                    <StoryboardColumn 
                        selectedFile={selectedFile}
                        onGenerateStoryboard={handleGenerateStoryboard}
                        isProcessing={isProcessing}
                        generationProgress={shotGenerationProgress}
                        processingType={processingType}
                        aiModel={aiModel}
                        isExpanded={!isFullView && visibleColumns[3]}
                        onToggleExpand={() => {}}
                        onHighlightScript={handleStoryboardSelectionChange}
                        highlightedItemIds={highlightedStoryboardItemIds}
                        onLockItem={handleLockItem}
                        onDeleteItem={handleDeleteStoryboardItem}
                        onRegenerateItem={handleRegenerateItem}
                        onUpdateItem={handleUpdateStoryboardItem}
                        onInsertShot={handleInsertShot}
                        onInsertShotWithAI={handleInsertShotWithAI}
                        onExport={handleExportStoryboards}
                        isExporting={isExporting}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        canUndo={canUndo}
                        canRedo={canRedo}
                        onSaveVersion={(name) => selectedFileId && handleSaveVersion(selectedFileId, name)}
                        onRestoreStoryboard={(version) => selectedFileId && handleRestoreStoryboard(selectedFileId, version)}
                        onDeleteVersion={(versionId) => selectedFileId && handleDeleteVersion(selectedFileId, versionId)}
                    />
                </div>
                )}
            </div>
          )}

          {/* Materials */}
          {mountedViews.has(AppView.Materials) && (
            <div style={{ display: currentView === AppView.Materials ? 'contents' : 'none' }}>
              {!isDataLoaded ? <SkeletonScreen message="正在加载素材库..." /> : (
                <MaterialPage 
                    files={files}
                    selectedFileId={selectedFileId}
                    materialLibrary={materialLibrary}
                    onUpdateLibrary={setMaterialLibrary}
                    onBindMaterial={handleBindMaterial}
                    onUnbindMaterial={handleUnbindMaterial}
                    onNextStep={() => handleViewSwitch(AppView.Generation)}
                    onSaveVersion={(name) => selectedFileId && handleSaveVersion(selectedFileId, name)}
                    onRestoreVersion={(version) => selectedFileId && handleRestoreVersion(selectedFileId, version)}
                    onDeleteVersion={(versionId) => selectedFileId && handleDeleteVersion(selectedFileId, versionId)}
                    onAppendStoryboard={handleAppendStoryboard}
                    onRemoveAppendedStoryboard={handleRemoveAppendedStoryboard}
                />
              )}
            </div>
          )}

          {/* Generation - 保活核心：生成任务不再因页面切换中断 */}
          {mountedViews.has(AppView.Generation) && (
            <div style={{ display: currentView === AppView.Generation ? 'contents' : 'none' }}>
              {!isDataLoaded ? <SkeletonScreen message="正在加载分镜数据..." /> : (
                  <GenerationPage 
                      files={files}
                      selectedFileId={selectedFileId}
                      materialLibrary={materialLibrary}
                      onUpdateStoryboardItem={handleUpdateStoryboardItem}
                      onSaveVersion={(name) => selectedFileId && handleSaveVersion(selectedFileId, name)}
                      onRestoreVersion={(version) => selectedFileId && handleRestoreVersion(selectedFileId, version)}
                      onDeleteVersion={(versionId) => selectedFileId && handleDeleteVersion(selectedFileId, versionId)}
                      onForceSave={() => {
                          console.log('🚀 强制立即保存');
                          saveToBackend();
                      }}
                      onExportNext={handleExportNext}
                  />
              )}
            </div>
          )}

          {/* Video */}
          {mountedViews.has(AppView.Video) && (
            <div style={{ display: currentView === AppView.Video ? 'contents' : 'none' }}>
                <VideoPage 
                  onAddNotification={addTaskNotification}
                  onUpdateNotification={updateTaskNotification}
                  isActive={currentView === AppView.Video}
                  sessionScope={selectedFileId ? `${propEpisodeId}:${selectedFileId}` : propEpisodeId || ''}
                />
            </div>
          )}

          {/* History */}
          {mountedViews.has(AppView.History) && (
            <div style={{ display: currentView === AppView.History ? 'contents' : 'none' }}>
                <HistoryPage />
            </div>
          )}

          {/* Admin */}
          {mountedViews.has(AppView.Admin) && (
            <div style={{ display: currentView === AppView.Admin ? 'contents' : 'none' }}>
              {!isAdmin ? (
                  <div className="flex items-center justify-center h-full text-n100 w-full">
                      <div className="text-center">
                          <ShieldCheck className="w-16 h-16 mx-auto mb-4 opacity-20" />
                          <p className="text-xl font-bold mb-2">权限不足</p>
                          <p className="text-sm">此页面仅限管理员访问</p>
                      </div>
                  </div>
              ) : (
                  <AdminPage 
                      files={files}
                      materialLibrary={materialLibrary}
                  />
              )}
            </div>
          )}
        </>
      );
  }

  return (
    <div className={`flex flex-col ${hideHeader ? 'h-full' : 'h-screen'} bg-n20 text-n800 font-sans`}>
      {!hideHeader && (
        <Header 
          visibleColumns={visibleColumns} 
          onToggleColumn={toggleColumnVisibility}
          onGlobalBatchProcess={handleGlobalBatchProcess}
          onStopProcessing={handleStopProcessing}
          isProcessing={isProcessing}
          fileCount={files.length}
          currentView={currentView}
          onChangeView={handleViewSwitch}
          aiModel={aiModel}
          onChangeModel={setAiModel}
          notifications={taskNotifications}
          onDismissNotification={dismissTaskNotification}
        />
      )}
      
      <main className={`flex-1 overflow-hidden ${currentView === AppView.Admin ? 'flex' : 'flex'} relative`} ref={containerRef}>
         <div className="w-full h-full flex">
         {renderAllViews()}
         </div>
         {/* 🚀 优化：仅在初次加载项目列表时显示Loading，视图切换不阻塞 */}
         {isLoadingProjects && <LoadingOverlay />}
      </main>
    </div>
  );
};

export default WorkspaceApp;
