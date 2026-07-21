

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';
import { ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from './components/Header';
import { SkeletonScreen } from './components/SkeletonScreen';
import { ProjectFile, FileStatus, StoryboardItem, FileVersion, AppView, MaterialLibrary, Material, AiModel, TaskNotification, ScriptSegment, ScriptGenerationStageState, VideoScriptBlock, ScriptConversation, ScriptStoryboardVersion } from './types';
import { parseVideoScriptBlocks } from './utils/scriptPipelineParsers';
import { parseStreamingBlocks, convertToStoryboardItem, removeControlCharacters, segmentInputContent, countShots } from './utils/storyboardParser';
import { deriveScriptStagesFromPersisted } from './utils/scriptStageDerivation';
import { listEpisodeScripts, createEpisodeScript, updateEpisodeScriptById, deleteEpisodeScript, listEpisodeScriptSegments, batchSaveScriptSegments, getScriptConversation, createScriptMessage, updateScriptMessage, createScriptVersion, selectScriptVersion } from './services/scriptTimelineService';
import { exportScript, deleteStoryboardItem } from './services/storyboardMutationService';
import { batchCreateStoryboardItems, getEpisodeScript, updateEpisodeScript, getStoryboardItems, updateStoryboardItem } from './services/episodeDataService';
import { getAuthToken } from './services/httpClient';
import { storyboardItemToDbUpdate } from './utils/episodeAdapters';
import { ensureStoryboardCutSeparators, validateStoryboardIterationCount } from './utils/scriptIteration';

const loadAiModelService = () => import('./services/aiModelService');

const WORKSPACE_INITIAL_STORYBOARD_COUNT = 10;
const BACKUP_STORYBOARD_PAGE_SIZE = 200;
const WORKING_HISTORY_SCOPE = 'working';

function buildVersionHistoryScopeKey(fileId: string, versionId?: string): string {
  return `${fileId}::${versionId || WORKING_HISTORY_SCOPE}`;
}

type ProjectFileHistory = {
  past: ProjectFile[];
  future: ProjectFile[];
};

type HistoryUpdateOptions = {
  recordHistory?: boolean;
  resetHistory?: boolean;
  versionId?: string;
};

const FileColumn = React.lazy(() => import('./components/FileColumn').then(m => ({ default: m.FileColumn })));
const ScriptConversationPane = React.lazy(() => import('./components/ScriptConversationPane').then(m => ({ default: m.ScriptConversationPane })));
const StoryboardColumn = React.lazy(() => import('./components/StoryboardColumn').then(m => ({ default: m.StoryboardColumn })));
const LegacyMaterialPage = React.lazy(() => import('./components/MaterialPage').then(m => ({ default: m.MaterialPage })));
const LegacyGenerationPage = React.lazy(() => import('./components/GenerationPage').then(m => ({ default: m.GenerationPage })));
const LegacyVideoPage = React.lazy(() => import('./components/VideoPage').then(m => ({ default: m.VideoPage })));
const LegacyAdminPage = React.lazy(() => import('./components/AdminPage').then(m => ({ default: m.AdminPage })));

function summarizePipelineError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '未知错误');
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '未知错误';
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function buildScriptSegmentPayload(segments: ScriptSegment[]) {
  return segments.map((s, idx) => ({
    segment_id: s.id && !s.id.startsWith('seg_local_') ? s.id : undefined,
    segment_order: idx,
    source_text: s.sourceText || '',
    estimated_duration_sec: s.estimatedDurationSec,
    video_script: s.videoScript || '',
    status: s.status || 'pending',
    error_message: s.errorMessage || '',
  }));
}
const LegacyHistoryPage = React.lazy(() => import('./components/HistoryPage').then(m => ({ default: m.HistoryPage })));

function buildBoundAssetTags(item: Partial<StoryboardItem>): string[] {
  return [
    ...((item.characters || []).map((c: string) => `char:${c}`)),
    ...(item.scene ? [`scene:${item.scene}`] : []),
    ...((item.props || []).map((p: string) => `prop:${p}`)),
  ];
}

const LegacyViewFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-full w-full flex items-center justify-center text-sm text-n300">
    Loading {label}...
  </div>
);

const LegacyColumnFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-full w-full flex items-center justify-center bg-n10 text-xs text-n300">
    Loading {label}...
  </div>
);

function mapWorkspaceStoryboardRowsToItems(rows: any[]): StoryboardItem[] {
  return rows.map((r: any, idx: number) => {
    const boundAssets: string[] = Array.isArray(r.bound_assets ?? r.boundAssets)
      ? (r.bound_assets ?? r.boundAssets)
      : [];
    const imageUrl = r.generated_image_url ?? r.generatedImageUrl ?? null;
    const imageId = `img_${r.item_id ?? r.itemId ?? idx}`;
    return {
      id: r.item_id ?? r.itemId ?? uuidv4(),
      shotNumber: idx + 1,
      originalText: r.scene_heading ?? r.sceneHeading ?? '',
      scriptSegment: r.action_text ?? r.actionText ?? '',
      dialogue: r.dialogue ?? '',
      cameraMovement: r.camera_movement ?? r.cameraMovement ?? '',
      imagePrompt: r.image_prompt ?? r.imagePrompt ?? '',
      videoPrompt: r.video_prompt ?? r.videoPrompt ?? '',
      generatedImageUrl: imageUrl,
      generatedImage: imageUrl ?? undefined,
      generatedImages: imageUrl ? [{ id: imageId, url: imageUrl, thumbnail: imageUrl, timestamp: Date.now() }] : [],
      selectedImageId: imageUrl ? imageId : undefined,
      configuredReferences: Array.isArray(r.configured_references ?? r.configuredReferences)
        ? (r.configured_references ?? r.configuredReferences)
        : [],
      characters: boundAssets.filter((a: string) => a.startsWith('char:')).map((a: string) => a.replace('char:', '')),
      scene: boundAssets.find((a: string) => a.startsWith('scene:'))?.replace('scene:', '') || '',
      props: boundAssets.filter((a: string) => a.startsWith('prop:')).map((a: string) => a.replace('prop:', '')),
      plannedDurationMs: r.planned_duration_ms ?? r.plannedDurationMs ?? null,
      scriptSegmentId: r.script_segment_id ?? r.scriptSegmentId ?? undefined,
      sourceVideoShotNo: r.source_video_shot_no ?? r.sourceVideoShotNo ?? '',
      videoScriptBlock: r.video_script_block ?? r.videoScriptBlock ?? '',
      shotSize: r.shot_size ?? r.shotSize ?? '',
      cameraAngle: r.camera_angle ?? r.cameraAngle ?? '',
      timestamp: Date.now(),
    };
  });
}

function normalizeVersionStoryboardItems(rows: any[]): StoryboardItem[] {
  return (rows || []).map((row: any, index: number) => {
    if (row?.originalText !== undefined || row?.scriptSegment !== undefined) {
      return { ...row, id: row.id || uuidv4(), shotNumber: row.shotNumber ?? index + 1 } as StoryboardItem;
    }
    return mapWorkspaceStoryboardRowsToItems([row])[0];
  });
}

function parseStoryboardVersionContent(content: string): StoryboardItem[] {
  if (!content.trim()) return [];
  const separated = ensureStoryboardCutSeparators(content);
  const normalized = separated.endsWith('---CUT---') ? separated : `${separated}\n---CUT---`;
  const parsed = parseStreamingBlocks(normalized);
  return parsed.completedBlocks.map((block, index) => {
    const item = convertToStoryboardItem(block);
    return { ...item, shotNumber: item.shotNumber || `镜头${String(index + 1).padStart(2, '0')}` };
  });
}

function exportStoryboardVersionCsv(file: ProjectFile, version: ScriptStoryboardVersion): void {
  const headers = ['镜头', '时长', '画面描述', '人物', '场景', '道具', '生图 Prompt', '视频 Prompt', '人物台词'];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = version.storyboardItems.map((item, index) => [
    item.shotNumber || index + 1,
    item.duration || '',
    item.scriptSegment || item.originalText || '',
    (item.characters || []).join('、'),
    item.scene || '',
    (item.props || []).join('、'),
    item.imagePrompt || '',
    item.videoPrompt || '',
    item.dialogue || '',
  ].map(escape).join(','));
  const blob = new Blob([`\ufeff${[headers.map(escape).join(','), ...rows].join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${file.name.replace(/\.[^.]+$/, '')}-分镜脚本-V${version.versionNo}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getScriptModelInfo(model: AiModel) {
  if (model === AiModel.Gemini) return { alias: '化神', provider: 'google', runtime: 'gemini-2.5-flash' };
  if (model === AiModel.Deepseek) return { alias: '筑基', provider: 'deepseek', runtime: 'deepseek-reasoner' };
  return { alias: '金丹', provider: 'deepseek', runtime: 'deepseek-chat' };
}

function resolveScriptAiModel(modelName?: string): AiModel | null {
  const normalized = String(modelName || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('gemini')) return AiModel.Gemini;
  if (normalized.includes('reasoner')) return AiModel.Deepseek;
  if (normalized.includes('deepseek')) return AiModel.DeepseekChat;
  return null;
}

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
  activeScriptId?: string | null;
  onActivateScript?: (scriptId: string) => Promise<void> | void;
  onAfterExport?: () => Promise<void> | void;
}

const WorkspaceApp: React.FC<WorkspaceAppProps> = ({
  hideHeader = false,
  episodeId: propEpisodeId,
  initialScriptId,
  activeScriptId,
  onActivateScript,
  onAfterExport,
}) => {

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [storyboardTotalsByFileId, setStoryboardTotalsByFileId] = useState<Record<string, number>>({});
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
  const savedScriptSignaturesRef = useRef<Record<string, string>>({});
  
  // 🔧 每次状态更新时同步到 ref
  useEffect(() => {
    filesRef.current = files;
    materialLibraryRef.current = materialLibrary;
  }, [files, materialLibrary]);

  const getScriptPersistenceSignature = useCallback((file: ProjectFile) => JSON.stringify([
    file.name,
    file.originalContent,
    file.scriptContent ?? null,
  ]), []);

  const activateWorkflowScript = useCallback(async (scriptId: string) => {
    if (!onActivateScript || scriptId === activeScriptId) return;
    await onActivateScript(scriptId);
  }, [activeScriptId, onActivateScript]);

  // Undo/Redo history is isolated by file and storyboard version.
  const [fileHistory, setFileHistory] = useState<Record<string, ProjectFileHistory>>({});

  // Highlighting State
  const [highlightedScriptSegments, setHighlightedScriptSegments] = useState<Set<string>>(new Set());
  const [highlightedStoryboardItemIds, setHighlightedStoryboardItemIds] = useState<Set<string>>(new Set());

  // Layout State
  const [colWidths, setColWidths] = useState<number[]>([15, 25, 30, 30]); // 文件列表10%, 文字脚本20%, 分镜脚本30%, 镜头设计40%
  const [visibleColumns, setVisibleColumns] = useState<boolean[]>([true, true, true, true]);  // ✅ 强制所有列始终显示
  const [aiModel, setAiModel] = useState<AiModel>(AiModel.DeepseekChat);  // 🔧 默认改为DK金丹
  const [scriptConversations, setScriptConversations] = useState<Record<string, ScriptConversation>>({});
  const [conversationLoadingId, setConversationLoadingId] = useState<string | null>(null);
  const [conversationSendingId, setConversationSendingId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [storyboardDrawerOpen, setStoryboardDrawerOpen] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef<number | null>(null);

  const selectedFile = files.find(f => f.id === selectedFileId);
  const selectedConversation = selectedFileId ? scriptConversations[selectedFileId] : undefined;
  const selectedConversationVersion = selectedConversation?.versions.find(
    version => version.id === selectedConversation.currentVersionId,
  ) || selectedConversation?.versions[selectedConversation.versions.length - 1];
  const selectedHistoryScopeKey = selectedFileId
    ? buildVersionHistoryScopeKey(selectedFileId, selectedConversationVersion?.id)
    : null;
  const selectedStoryboardItemCount = (
    selectedConversationVersion?.storyboardItems
    || selectedFile?.storyboard?.items
    || []
  ).filter(item => !item.isPlaceholder).length;

  useEffect(() => {
    if (!selectedFileId || selectedFileId.startsWith('local_')) return;
    let cancelled = false;
    setConversationLoadingId(selectedFileId);
    setConversationError(null);
    getScriptConversation(propEpisodeId, selectedFileId)
      .then(conversation => {
        if (cancelled) return;
        setScriptConversations(prev => ({ ...prev, [selectedFileId]: conversation }));
        const matchingModel = resolveScriptAiModel(conversation.defaultModel);
        if (matchingModel) setAiModel(matchingModel);
      })
      .catch(error => {
        if (cancelled) return;
        console.error('加载剧本对话失败:', error);
        const file = filesRef.current.find(item => item.id === selectedFileId);
        if (file) {
          const now = Date.now();
          const fallbackVersion: ScriptStoryboardVersion | undefined = file.scriptContent ? {
            id: `legacy_${file.id}`,
            scriptId: file.id,
            versionNo: 1,
            content: file.scriptContent,
            storyboardItems: file.storyboard?.items || [],
            source: 'legacy',
            status: 'ready',
            modelAlias: '历史版本',
            provider: 'legacy',
            modelName: 'legacy',
            createdAt: file.lastUpdated || now,
            updatedAt: file.lastUpdated || now,
          } : undefined;
          if (fallbackVersion) fallbackVersion.messageId = `legacy_assistant_${file.id}`;
          setScriptConversations(prev => ({
            ...prev,
            [file.id]: {
              scriptId: file.id,
              currentVersionId: fallbackVersion?.id,
              messages: [
                ...(file.originalContent ? [{
                  id: `legacy_user_${file.id}`,
                  role: 'user' as const,
                  content: file.originalContent,
                  status: 'completed' as const,
                  createdAt: file.lastUpdated || now,
                  updatedAt: file.lastUpdated || now,
                }] : []),
                ...(fallbackVersion ? [{
                  id: fallbackVersion.messageId!,
                  role: 'assistant' as const,
                  content: fallbackVersion.content,
                  status: 'completed' as const,
                  modelAlias: '历史版本',
                  modelName: 'legacy',
                  createdAt: file.lastUpdated || now,
                  updatedAt: file.lastUpdated || now,
                }] : []),
              ],
              versions: fallbackVersion ? [fallbackVersion] : [],
            },
          }));
        }
        setConversationError('对话历史暂时无法从服务器加载，已显示当前剧本内容。');
      })
      .finally(() => {
        if (!cancelled) setConversationLoadingId(null);
      });
    return () => { cancelled = true; };
  }, [propEpisodeId, selectedFileId]);
  
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
      const [scriptsRes, segRes] = await Promise.all([
        listEpisodeScripts(propEpisodeId).catch(() => ({ success: false, scripts: [] })),
        listEpisodeScriptSegments(propEpisodeId).catch(() => ({ success: false, segments: [] })),
      ]);

      const scripts: any[] = scriptsRes.success ? (scriptsRes.scripts || []) : [];
      const initialStoryboardScriptId = (
        initialScriptId && scripts.some((script: any) => (script.script_id ?? script.scriptId) === initialScriptId)
      )
        ? initialScriptId
        : (scripts[0]?.script_id ?? scripts[0]?.scriptId ?? undefined);
      const sbRes = await getStoryboardItems(propEpisodeId, initialStoryboardScriptId, {
        limit: WORKSPACE_INITIAL_STORYBOARD_COUNT,
        includeTotal: true,
      }).catch(() => ({ success: false, items: [] }));
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

      let projectFiles: ProjectFile[];

      if (scripts.length > 0) {
        projectFiles = scripts.map((script: any, idx: number) => {
          const sid = script.script_id ?? script.scriptId;
          const matchedRows = itemsByScript.get(sid) || [];
          const orphanRows = idx === 0 ? (itemsByScript.get(null) || []) : [];
          const fileItems = mapWorkspaceStoryboardRowsToItems([...matchedRows, ...orphanRows]);
          const fileSegments = segsByScript.get(sid) || (idx === 0 ? (segsByScript.get(null) || []) : []);
          const adaptedScript = script.adapted_script ?? script.adaptedScript ?? null;
          const file: ProjectFile = {
            id: sid,
            name: script.file_name ?? script.fileName ?? `文件${idx + 1}`,
            originalContent: script.original_content ?? script.originalContent ?? '',
            scriptContent: adaptedScript,
            storyboard: fileItems.length > 0 ? { items: fileItems } : null,
            extractedCharacters: [],
            extractedScenes: [],
            extractedProps: [],
            status: FileStatus.Idle,
            lastUpdated: Date.now(),
            versions: [],
            scriptSegments: fileSegments,
            // 重进剧本时按持久化数据重建三步生成阶段态，避免阶段徽章全显「未开始」（A.2-2）。
            generationStages: deriveScriptStagesFromPersisted(fileSegments, adaptedScript, fileItems),
          };
          if (fileItems.length > 0) {
            const chars = new Set<string>();
            const scenes = new Set<string>();
            const props = new Set<string>();
            fileItems.forEach(item => {
              (item.characters || []).forEach((c: string) => { if (c) chars.add(c); });
              if (item.scene) scenes.add(item.scene);
              (item.props || []).forEach((p: string) => { if (p) props.add(p); });
            });
            file.extractedCharacters = Array.from(chars);
            file.extractedScenes = Array.from(scenes);
            file.extractedProps = Array.from(props);
          }
          return file;
        });
      } else {
        const created = await createEpisodeScript(propEpisodeId, { file_name: '分集剧本' }).catch(() => null);
        const newId = created?.script?.script_id || `local_${uuidv4()}`;
        const allItems = mapWorkspaceStoryboardRowsToItems(dbItems);
        projectFiles = [{
          id: newId,
          name: '分集剧本',
          originalContent: '',
          scriptContent: null,
          storyboard: allItems.length > 0 ? { items: allItems } : null,
          extractedCharacters: [],
          extractedScenes: [],
          extractedProps: [],
          status: FileStatus.Idle,
          lastUpdated: Date.now(),
          versions: [],
          scriptSegments: segsByScript.get(newId) || segsByScript.get(null) || [],
        }];
      }

      const restoreId = initialScriptId && projectFiles.some(f => f.id === initialScriptId)
        ? initialScriptId
        : projectFiles[0]?.id || null;
      const storyboardTotal = typeof (sbRes as any).total === 'number'
        ? (sbRes as any).total
        : dbItems.length;
      setStoryboardTotalsByFileId(restoreId ? { [restoreId]: storyboardTotal } : {});
      savedScriptSignaturesRef.current = Object.fromEntries(
        projectFiles
          .filter(file => !file.id.startsWith('local_'))
          .map(file => [file.id, getScriptPersistenceSignature(file)]),
      );
      filesRef.current = projectFiles;
      setFiles(projectFiles);
      setSelectedFileId(restoreId);
      if (!activeScriptId && restoreId) {
        void activateWorkflowScript(restoreId).catch(err => {
          console.error('设置本集采用剧本失败:', err);
        });
      }
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
    const token = getAuthToken();
    if (!token) return;

    try {
      for (const file of currentFiles) {
        if (file.id.startsWith('local_')) continue;
        const signature = getScriptPersistenceSignature(file);
        if (savedScriptSignaturesRef.current[file.id] === signature) continue;
        try {
          await updateEpisodeScriptById(propEpisodeId, file.id, {
            file_name: file.name,
            original_content: file.originalContent,
            adapted_script: file.scriptContent,
          });
          savedScriptSignaturesRef.current[file.id] = signature;
        } catch (err) {
          console.error(`保存文件 ${file.name} 失败:`, err);
        }
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
        const newItems = realItems.filter(i => !i.id || !i.id.startsWith('sb_'));
        if (newItems.length === 0) continue;
        const persistedItemCount = Math.max(
          storyboardTotalsByFileId[file.id] ?? 0,
          realItems.length - newItems.length,
        );

        const dbItems = newItems.map((item: StoryboardItem, idx: number) => {
          // 持久化已生成的画面 URL（仅持久化协议，过滤 blob:/data:），避免"删旧建新"丢图。
          const rawImg = ((item as any).generatedImage || (item as any).generated_image_url || '').toString();
          const cleanImg = rawImg.split('?')[0];
          const persistImg = (cleanImg.startsWith('http') || cleanImg.startsWith('/')) ? cleanImg : '';
          return ({
          sort_order: persistedItemCount + idx,
          scene_heading: item.originalText || item.scene || '',
          action_text: item.scriptSegment || '',
          dialogue: item.dialogue || '',
          camera_movement: item.cameraMovement || '',
          image_prompt: item.imagePrompt || '',
          video_prompt: item.videoPrompt || '',
          generated_image_url: persistImg,
          planned_duration_ms: item.plannedDurationMs || null,
          bound_assets: buildBoundAssetTags(item),
          script_segment_id: item.scriptSegmentId || null,
          source_video_shot_no: item.sourceVideoShotNo || '',
          video_script_block: item.videoScriptBlock || '',
          shot_size: item.shotSize || '',
          camera_angle: item.cameraAngle || '',
        });
        });

        const result: any = await batchCreateStoryboardItems(propEpisodeId, dbItems, file.id);
        if (result?.success && Array.isArray(result.items)) {
          const newIds: string[] = result.items.map((r: any) => r.item_id ?? r.itemId);
          const applyCreatedIds = (sourceFiles: ProjectFile[]) => sourceFiles.map(f => {
            if (f.id !== file.id || !f.storyboard) return f;
            let realIdx = 0;
            const updatedItems = f.storyboard.items.map(it => {
              if (it.isPlaceholder || (it.id && it.id.startsWith('sb_'))) return it;
              const newId = newIds[realIdx++];
              return newId ? { ...it, id: newId } : it;
            });
            return { ...f, storyboard: { ...f.storyboard, items: updatedItems } };
          });
          setFiles(applyCreatedIds);
          filesRef.current = applyCreatedIds(filesRef.current);
          setStoryboardTotalsByFileId(prev => ({
            ...prev,
            [file.id]: Math.max(prev[file.id] ?? 0, persistedItemCount) + newIds.length,
          }));
        }
      }
    } catch (error) {
      console.error('❌ 保存分集数据失败:', error);
    }
  }, [propEpisodeId, isLoadingProjects, getScriptPersistenceSignature, storyboardTotalsByFileId]);

  const handleExportProject = async () => {
    try {
      await saveEpisodeToBackend();
      const exportedAt = new Date();
      const currentFiles = filesRef.current;
      const storyboardRows: any[] = [];
      let storyboardTotal: number | null = null;

      do {
        const response = await getStoryboardItems(propEpisodeId, undefined, {
          limit: BACKUP_STORYBOARD_PAGE_SIZE,
          offset: storyboardRows.length,
          includeTotal: storyboardRows.length === 0,
        });
        if (!response?.success || !Array.isArray(response.items)) {
          throw new Error('无法读取完整镜头数据');
        }
        storyboardRows.push(...response.items);
        if (typeof response.total === 'number') storyboardTotal = response.total;
        if (response.items.length < BACKUP_STORYBOARD_PAGE_SIZE) break;
      } while (storyboardTotal === null || storyboardRows.length < storyboardTotal);

      const rowsByScriptId = new Map<string | null, any[]>();
      storyboardRows.forEach(row => {
        const scriptId = row.script_id ?? row.scriptId ?? null;
        const rows = rowsByScriptId.get(scriptId) || [];
        rows.push(row);
        rowsByScriptId.set(scriptId, rows);
      });
      const firstPersistedFileIndex = currentFiles.findIndex(file => !file.id.startsWith('local_'));
      const exportedFiles = currentFiles.map((file, fileIndex) => {
        if (file.id.startsWith('local_')) return file;
        const persistedRows = [
          ...(rowsByScriptId.get(file.id) || []),
          ...(fileIndex === firstPersistedFileIndex ? (rowsByScriptId.get(null) || []) : []),
        ];
        const persistedItems = mapWorkspaceStoryboardRowsToItems(persistedRows);
        const currentItems = (file.storyboard?.items || []).filter(item => !item.isPlaceholder);
        const currentItemsById = new Map(currentItems.map(item => [item.id, item]));
        const persistedIds = new Set(persistedItems.map(item => item.id));
        const mergedItems = [
          ...persistedItems.map(item => currentItemsById.get(item.id) || item),
          ...currentItems.filter(item => !persistedIds.has(item.id)),
        ].map((item, index) => ({ ...item, shotNumber: index + 1 }));
        return {
          ...file,
          storyboard: mergedItems.length > 0
            ? { ...(file.storyboard || {}), items: mergedItems }
            : file.storyboard,
        };
      });

      const exportedConversations: Record<string, ScriptConversation> = { ...scriptConversations };
      await Promise.all(currentFiles
        .filter(file => !file.id.startsWith('local_'))
        .map(async file => {
          try {
            exportedConversations[file.id] = await getScriptConversation(propEpisodeId, file.id);
          } catch (error) {
            console.warn(`无法刷新剧本“${file.name}”的对话记录，使用当前已加载内容。`, error);
          }
        }));

      const payload = {
        format: 'mecha-project-backup',
        version: 1,
        exported_at: exportedAt.toISOString(),
        project_id: urlProjectId,
        episode_id: propEpisodeId,
        workflow: {
          active_script_id: activeScriptId || null,
          selected_file_id: selectedFileId,
        },
        files: exportedFiles,
        material_library: materialLibraryRef.current,
        script_conversations: exportedConversations,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
      link.href = objectUrl;
      link.download = `mecha-project-${urlProjectId || 'unknown'}-episode-${propEpisodeId}-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      console.error('下载项目备份失败:', error);
      window.alert(`下载项目备份失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

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
    if (initialScriptId && files.some(file => file.id === initialScriptId)) {
      setSelectedFileId(initialScriptId);
    }
  }, [initialScriptId, files.length]);

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
  
  const resolveHistoryScopeKey = (fileId: string, versionId?: string) => {
      if (versionId) return buildVersionHistoryScopeKey(fileId, versionId);
      const conversation = scriptConversations[fileId];
      const currentVersion = conversation?.versions.find(item => item.id === conversation.currentVersionId)
          || conversation?.versions[conversation.versions.length - 1];
      return buildVersionHistoryScopeKey(fileId, currentVersion?.id);
  };

  const pushToHistory = (historyScopeKey: string, currentFile: ProjectFile) => {
      setFileHistory(prev => {
          const history = prev[historyScopeKey] || { past: [], future: [] };
          // Keep max 10 steps
          const newPast = [...history.past, currentFile].slice(-10);
          return {
              ...prev,
              [historyScopeKey]: { past: newPast, future: [] }
          };
      });
  };

  const resetHistory = (historyScopeKey: string) => {
      setFileHistory(prev => {
          if (!prev[historyScopeKey]) return prev;
          const next = { ...prev };
          delete next[historyScopeKey];
          return next;
      });
  };

  const handleUndo = () => {
      if (!selectedFileId || !selectedHistoryScopeKey) return;
      const history = fileHistory[selectedHistoryScopeKey];
      if (!history || history.past.length === 0) return;

      const previous = history.past[history.past.length - 1];
      const current = files.find(f => f.id === selectedFileId);
      
      if (current && previous) {
          setFileHistory(prev => ({
              ...prev,
              [selectedHistoryScopeKey]: {
                  past: history.past.slice(0, -1),
                  future: [current, ...history.future].slice(0, 10)
              }
          }));
          setFiles(prev => prev.map(f => f.id === selectedFileId ? previous : f));
      }
  };

  const handleRedo = () => {
      if (!selectedFileId || !selectedHistoryScopeKey) return;
      const history = fileHistory[selectedHistoryScopeKey];
      if (!history || history.future.length === 0) return;

      const next = history.future[0];
      const current = files.find(f => f.id === selectedFileId);

      if (current && next) {
          setFileHistory(prev => ({
              ...prev,
              [selectedHistoryScopeKey]: {
                  past: [...history.past, current].slice(-10),
                  future: history.future.slice(1)
              }
          }));
          setFiles(prev => prev.map(f => f.id === selectedFileId ? next : f));
      }
  };

  const canUndo = !!(selectedHistoryScopeKey && fileHistory[selectedHistoryScopeKey]?.past.length > 0);
  const canRedo = !!(selectedHistoryScopeKey && fileHistory[selectedHistoryScopeKey]?.future.length > 0);

  // Helper to update file with history tracking
  const updateFileWithHistory = (
      fileId: string,
      updateFn: (file: ProjectFile) => ProjectFile,
      options: HistoryUpdateOptions = {},
  ) => {
      const historyScopeKey = resolveHistoryScopeKey(fileId, options.versionId);
      setFiles(prev => {
          const fileIndex = prev.findIndex(f => f.id === fileId);
          if (fileIndex === -1) return prev;
          
          const currentFile = prev[fileIndex];
          if (options.resetHistory) {
              resetHistory(historyScopeKey);
          } else if (options.recordHistory !== false) {
              pushToHistory(historyScopeKey, currentFile);
          }

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
                  extractedProps: f.extractedProps,
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
      }), { recordHistory: false, resetHistory: true });
  };

  const handleRestoreStoryboard = (fileId: string, version: FileVersion) => {
      if (!version.data.storyboard) {
          alert("该版本没有分镜数据");
          return;
      }
      updateFileWithHistory(fileId, (f) => ({
          ...f,
          storyboard: version.data.storyboard
      }), { recordHistory: false, resetHistory: true });
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



  const loadWorkspaceStoryboardPage = useCallback((fileId: string, count: number) => {
    if (!propEpisodeId || !fileId) return;
    const targetCount = Math.max(WORKSPACE_INITIAL_STORYBOARD_COUNT, count || WORKSPACE_INITIAL_STORYBOARD_COUNT);
    const currentFile = filesRef.current.find(f => f.id === fileId);
    const currentCount = currentFile?.storyboard?.items?.length || 0;
    if (targetCount <= currentCount) return;

    const scriptId = fileId.startsWith('local_') ? undefined : fileId;
    getStoryboardItems(propEpisodeId, scriptId, {
      limit: targetCount,
      includeTotal: true,
    })
      .then((res: any) => {
        if (!res?.success) return;
        const items = mapWorkspaceStoryboardRowsToItems(res.items || []);
        setFiles(prev => prev.map(f => (
          f.id === fileId
            ? { ...f, storyboard: items.length > 0 ? { items } : null }
            : f
        )));
        const total = typeof res.total === 'number' ? res.total : items.length;
        setStoryboardTotalsByFileId(prev => ({ ...prev, [fileId]: total }));
      })
      .catch(err => {
        console.warn('Workspace storyboard page load failed:', err);
      });
  }, [propEpisodeId]);

  const handleWorkspaceVisibleShotCountChange = useCallback((count: number) => {
    if (!selectedFileId) return;
    loadWorkspaceStoryboardPage(selectedFileId, count);
  }, [loadWorkspaceStoryboardPage, selectedFileId]);

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
      
      const { exportToVideo } = await import('./services/projectWorkflowService');
      
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
              extractedProps: [],
              status: FileStatus.Idle,
              lastUpdated: Date.now(),
              versions: [],
            };
            savedScriptSignaturesRef.current[newFile.id] = getScriptPersistenceSignature(newFile);
            setFiles(prev => {
              const next = [...prev, newFile];
              filesRef.current = next;
              return next;
            });
            setSelectedFileId(newFile.id);
            if (!activeScriptId) {
              void activateWorkflowScript(newFile.id).catch(err => {
                console.error('设置本集采用剧本失败:', err);
              });
            }
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
          extractedProps: [],
          status: FileStatus.Idle,
          lastUpdated: Date.now(),
          versions: [],
        };
        savedScriptSignaturesRef.current[newFile.id] = getScriptPersistenceSignature(newFile);
        setFiles(prev => {
          const next = [...prev, newFile];
          filesRef.current = next;
          return next;
        });
        setSelectedFileId(newFile.id);
        if (!activeScriptId) {
          void activateWorkflowScript(newFile.id).catch(err => {
            console.error('设置本集采用剧本失败:', err);
          });
        }
      }
    } catch (err) {
      console.error('创建空白文件失败:', err);
    }
  };

  const handleUpdateContent = (id: string, newContent: string) => {
      updateFileWithHistory(id, (f) => ({ ...f, originalContent: newContent }));
  };

  const handleIterateScript = useCallback(async (
    currentScript: string,
    instruction: string,
    conversationContext: string,
  ): Promise<string> => {
    if (!currentScript.trim()) throw new Error('当前文件没有可修改的剧本内容');
    if (!instruction.trim()) throw new Error('请输入本轮修改意见');
    const { aiIterateFullScript } = await loadAiModelService();
    return await aiIterateFullScript(
      aiModel,
      currentScript,
      instruction,
      conversationContext,
    );
  }, [aiModel]);

  const handleConversationSend = useCallback(async (content: string) => {
    const fileId = selectedFileId;
    const file = filesRef.current.find(item => item.id === fileId);
    if (!fileId || !file) throw new Error('请先选择剧本任务');
    if (fileId.startsWith('local_')) throw new Error('剧本任务尚未保存，请稍后重试');

    const conversation = scriptConversations[fileId] || {
      scriptId: fileId,
      messages: [],
      versions: [],
    };
    const modelInfo = getScriptModelInfo(aiModel);
    const requestId = `script_turn_${uuidv4()}`;
    setConversationSendingId(fileId);
    setConversationError(null);

    let assistantMessageId: string | null = null;
    let streamedContent = '';
    try {
      const userMessage = await createScriptMessage(propEpisodeId, fileId, {
        role: 'user',
        content,
        status: 'completed',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.runtime,
        requestId: `${requestId}_user`,
      });
      setScriptConversations(prev => ({
        ...prev,
        [fileId]: {
          ...(prev[fileId] || conversation),
          messages: [...(prev[fileId]?.messages || conversation.messages), userMessage],
        },
      }));

      const isFirstTurn = conversation.versions.length === 0;
      const currentVersion = conversation.versions.find(version => version.id === conversation.currentVersionId)
        || conversation.versions[conversation.versions.length - 1];
      if (isFirstTurn) {
        updateFileWithHistory(fileId, current => ({ ...current, originalContent: content }));
        await updateEpisodeScriptById(propEpisodeId, fileId, { original_content: content });
      }

      const assistantMessage = await createScriptMessage(propEpisodeId, fileId, {
        role: 'assistant',
        content: '',
        status: 'streaming',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.runtime,
        replyToMessageId: userMessage.id,
        requestId: `${requestId}_assistant`,
      });
      assistantMessageId = assistantMessage.id;
      setScriptConversations(prev => ({
        ...prev,
        [fileId]: {
          ...(prev[fileId] || conversation),
          messages: [...(prev[fileId]?.messages || [...conversation.messages, userMessage]), assistantMessage],
        },
      }));

      const aiService = await loadAiModelService();
      let result = '';
      if (isFirstTurn) {
        result = await aiService.aiGenerateStoryboardScript(aiModel, content, '', chunk => {
          streamedContent += chunk;
          setScriptConversations(prev => {
            const current = prev[fileId];
            if (!current) return prev;
            return {
              ...prev,
              [fileId]: {
                ...current,
                messages: current.messages.map(message => message.id === assistantMessage.id
                  ? { ...message, content: streamedContent, status: 'streaming', updatedAt: Date.now() }
                  : message),
              },
            };
          });
        });
      } else {
        const context = conversation.messages.slice(-10)
          .map(message => `${message.role === 'user' ? '用户' : '系统'}：${message.content.replace(/\s+/g, ' ').slice(0, 500)}`)
          .join('\n');
        result = await aiService.aiIterateFullScript(
          aiModel,
          currentVersion?.content || file.scriptContent || file.originalContent,
          content,
          context || '（首次修改，无历史意见）',
        );
      }

      const finalContent = ensureStoryboardCutSeparators(result || streamedContent);
      const parsedItems = parseStoryboardVersionContent(finalContent);
      if (!finalContent || parsedItems.length === 0) {
        throw new Error('模型返回内容无法识别为分镜脚本，请重新描述要求后再试');
      }
      if (!isFirstTurn && currentVersion) {
        const previousCount = normalizeVersionStoryboardItems(currentVersion.storyboardItems).filter(item => !item.isPlaceholder).length;
        const validation = validateStoryboardIterationCount(previousCount, parsedItems.length, content);
        if (!validation.valid) {
          throw new Error(`${validation.message || '模型返回的镜头数量不符合本轮要求'} 已阻止保存此异常版本，请重试。`);
        }
      }
      const completedMessage = await updateScriptMessage(
        propEpisodeId,
        fileId,
        assistantMessage.id,
        { content: finalContent, status: 'completed' },
      );
      const version = await createScriptVersion(propEpisodeId, fileId, {
        messageId: assistantMessage.id,
        content: finalContent,
        storyboardItems: parsedItems,
        source: 'ai',
        status: 'ready',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.runtime,
        metadata: { requestId },
        setCurrent: true,
      });
      setScriptConversations(prev => {
        const current = prev[fileId] || conversation;
        return {
          ...prev,
          [fileId]: {
            ...current,
            currentVersionId: version.id,
            defaultModel: modelInfo.runtime,
            messages: current.messages.map(message => message.id === assistantMessage.id ? completedMessage : message),
            versions: [...current.versions.filter(item => item.id !== version.id), version],
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成分镜脚本失败';
      setConversationError(message);
      if (assistantMessageId) {
        void updateScriptMessage(propEpisodeId, fileId, assistantMessageId, {
          content: streamedContent,
          status: 'failed',
          metadata: { error: message },
        }).catch(() => undefined);
        setScriptConversations(prev => {
          const current = prev[fileId];
          if (!current) return prev;
          return {
            ...prev,
            [fileId]: {
              ...current,
              messages: current.messages.map(item => item.id === assistantMessageId
                ? { ...item, content: streamedContent, status: 'failed', metadata: { error: message }, updatedAt: Date.now() }
                : item),
            },
          };
        });
      }
      throw error;
    } finally {
      setConversationSendingId(null);
    }
  }, [aiModel, propEpisodeId, scriptConversations, selectedFileId, updateFileWithHistory]);

  const handleConversationEditVersion = useCallback(async (
    sourceVersion: ScriptStoryboardVersion,
    content: string,
  ) => {
    const fileId = selectedFileId;
    if (!fileId) return;
    const parsedItems = parseStoryboardVersionContent(content);
    const storyboardItems = parsedItems.length > 0 ? parsedItems : normalizeVersionStoryboardItems(sourceVersion.storyboardItems);
    const message = await createScriptMessage(propEpisodeId, fileId, {
      role: 'assistant',
      content,
      status: 'completed',
      modelAlias: '手动编辑',
      provider: 'manual',
      modelName: 'manual',
      requestId: `manual_${uuidv4()}`,
      metadata: { sourceVersionId: sourceVersion.id },
    });
    const version = await createScriptVersion(propEpisodeId, fileId, {
      messageId: message.id,
      content,
      storyboardItems,
      source: 'manual',
      status: 'ready',
      modelAlias: '手动编辑',
      provider: 'manual',
      modelName: 'manual',
      metadata: { sourceVersionId: sourceVersion.id },
      setCurrent: true,
    });
    setScriptConversations(prev => {
      const current = prev[fileId] || { scriptId: fileId, messages: [], versions: [] };
      return {
        ...prev,
        [fileId]: {
          ...current,
          currentVersionId: version.id,
          messages: [...current.messages, message],
          versions: [...current.versions, version],
        },
      };
    });
  }, [propEpisodeId, selectedFileId]);

  const handleConversationGenerateDesign = useCallback(async (version: ScriptStoryboardVersion) => {
    const fileId = selectedFileId;
    if (!fileId) return;
    setConversationError(null);
    const selectedVersion = version.source === 'legacy' && version.id.startsWith('legacy_')
      ? version
      : await selectScriptVersion(propEpisodeId, fileId, version.id);
    const items = normalizeVersionStoryboardItems(selectedVersion.storyboardItems);
    if (items.length === 0) {
      setConversationError('当前分镜版本没有可展示的镜头内容，请先生成分镜脚本。');
      return;
    }
    flushSync(() => {
      updateFileWithHistory(fileId, current => ({
        ...current,
        scriptContent: selectedVersion.content,
        storyboard: { items },
        status: FileStatus.Completed,
        lastUpdated: Date.now(),
      }), {
        recordHistory: false,
        resetHistory: true,
        versionId: selectedVersion.id,
      });
      setScriptConversations(prev => prev[fileId] ? ({
        ...prev,
        [fileId]: { ...prev[fileId], currentVersionId: selectedVersion.id },
      }) : prev);
      setHighlightedScriptSegments(new Set());
      setHighlightedStoryboardItemIds(new Set());
      setStoryboardDrawerOpen(true);
    });
  }, [propEpisodeId, selectedFileId, updateFileWithHistory]);

  const handleOpenStoryboardDrawer = useCallback(() => {
    if (!selectedFileId) return;
    const file = filesRef.current.find(item => item.id === selectedFileId);
    const existingItems = (file?.storyboard?.items || []).filter(item => !item.isPlaceholder);
    if (existingItems.length > 0) {
      setConversationError(null);
      setStoryboardDrawerOpen(true);
      return;
    }
    const conversation = scriptConversations[selectedFileId];
    const version = conversation?.versions.find(item => item.id === conversation.currentVersionId)
      || conversation?.versions[conversation.versions.length - 1];
    if (version) {
      void handleConversationGenerateDesign(version);
      return;
    }
    setConversationError('当前还没有可展示的镜头设计。');
  }, [handleConversationGenerateDesign, scriptConversations, selectedFileId]);

  const handleConversationExportVersion = useCallback((version: ScriptStoryboardVersion) => {
    const file = filesRef.current.find(item => item.id === selectedFileId);
    if (!file) return;
    exportStoryboardVersionCsv(file, {
      ...version,
      storyboardItems: normalizeVersionStoryboardItems(version.storyboardItems),
    });
  }, [selectedFileId]);

  const handleFileSelect = (id: string) => {
      setSelectedFileId(id);
      setStoryboardDrawerOpen(false);
    const file = filesRef.current.find(f => f.id === id);
    if (!file?.storyboard?.items?.length && storyboardTotalsByFileId[id] !== 0) {
      loadWorkspaceStoryboardPage(id, WORKSPACE_INITIAL_STORYBOARD_COUNT);
    }
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
        extractedProps: [],
        lastUpdated: Date.now(),
      }));
      return;
    }
    try {
      await deleteEpisodeScript(propEpisodeId, id);
      delete savedScriptSignaturesRef.current[id];
      const remainingFiles = files.filter(file => file.id !== id);
      if (activeScriptId === id && remainingFiles.length > 0) {
        await activateWorkflowScript(remainingFiles[0].id);
      }
      setFiles(prev => {
        const newFiles = prev.filter(f => f.id !== id);
        filesRef.current = newFiles;
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
          const dbUpdates = storyboardItemToDbUpdate(actualUpdates);
          if ('characters' in actualUpdates || 'scene' in actualUpdates || 'props' in actualUpdates) {
              const updatedItem = { ...currentItem, ...actualUpdates };
              dbUpdates.bound_assets = buildBoundAssetTags(updatedItem);
          }
          if (Object.keys(dbUpdates).length > 0) {
              updateStoryboardItem(itemId, dbUpdates).catch(err => {
                  console.error('❌ 保存分镜更新失败:', err);
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
        // If this shot contains the tag (Character, Scene or Prop)
        if ((item.characters || []).includes(tagName) || item.scene === tagName || (item.props || []).includes(tagName)) {
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
        if ((item.characters || []).includes(tagName) || item.scene === tagName || (item.props || []).includes(tagName)) {
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
    
    // 合并所有源文件的人物、场景和道具
    const allCharacters = sortedSourceFiles.flatMap(f => f.extractedCharacters || []);
    const allScenes = sortedSourceFiles.flatMap(f => f.extractedScenes || []);
    const allProps = sortedSourceFiles.flatMap(f => f.extractedProps || []);
    
    if (allCharacters.length || allScenes.length || allProps.length) {
      setFiles(prev => prev.map(f => {
        if (f.id === selectedFileId) {
          const newCharacters = [...new Set([...(f.extractedCharacters || []), ...allCharacters])];
          const newScenes = [...new Set([...(f.extractedScenes || []), ...allScenes])];
          const newProps = [...new Set([...(f.extractedProps || []), ...allProps])];
          return {
            ...f,
            extractedCharacters: newCharacters,
            extractedScenes: newScenes,
            extractedProps: newProps
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
        const { aiRegenerateSingleShot } = await loadAiModelService();
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

      const { aiRegenerateSingleShot } = await loadAiModelService();
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
        const workflowFile = filesRef.current.find(file => file.id === activeScriptId);
        if (pid && eid && workflowFile) {
          if (selectedFileId !== activeScriptId) {
            alert('当前浏览的不是本集后续采用剧本，请先在文件列表中设为后续采用。');
            return;
          }
          await saveEpisodeToBackend();
          const charSet = new Set<string>(workflowFile.extractedCharacters || []);
          const sceneSet = new Set<string>(workflowFile.extractedScenes || []);
          const propSet = new Set<string>(workflowFile.extractedProps || []);
          if (workflowFile.storyboard?.items) {
            for (const item of workflowFile.storyboard.items) {
              if (item.characters) item.characters.forEach(c => { if (c) charSet.add(c); });
              if (item.scene) sceneSet.add(item.scene);
              if (item.props) item.props.forEach(p => { if (p) propSet.add(p); });
            }
          }
          const charNames = Array.from(charSet);
          const sceneNames = Array.from(sceneSet);
          const propNames = Array.from(propSet);

          try {
            await exportScript(eid, {
              project_id: pid,
              original_content: workflowFile.originalContent || '',
              script_content: workflowFile.scriptContent || '',
              storyboard_items: [],
              characters: charNames.map(n => ({ name: n, description: '' })),
              scenes: sceneNames.map(n => ({ name: n, description: '' })),
              props: propNames.map(n => ({ name: n, description: '' })),
              script_id: workflowFile.id,
              preserve_existing_storyboards: true,
            });
            console.log(`✅ 本集采用剧本导出完成: ${workflowFile.storyboard?.items?.length || 0} 个分镜`);
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
            const { aiGenerateStoryboardScript, aiContinueStoryboardScript } = await loadAiModelService();

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
      const { aiExtractShotsFromScript } = await loadAiModelService();
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
      const { aiSplitScriptIntoSegments } = await loadAiModelService();
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
    if (segs.length === 0) { alert('请先拆分剧本'); return false; }

    setStage(file.id, 'videoScript', { status: 'running', total: segs.length, completed: 0, errorMessage: '' });
    const ordered = [...segs].sort((a, b) => a.order - b.order);
    const updated: ScriptSegment[] = [...ordered];
    let completed = 0;
    try {
      for (let i = 0; i < ordered.length; i++) {
        const seg = ordered[i];
        if (seg.status === 'done' && seg.videoScript) { completed++; continue; } // 跳过已完成（失败恢复）
        try {
          const { aiGenerateVideoScriptFromSegment } = await loadAiModelService();
          const text = await aiGenerateVideoScriptFromSegment(aiModel, seg);
          updated[i] = { ...seg, videoScript: text, status: 'done', errorMessage: '' };
          completed++;
          setStage(file.id, 'videoScript', { status: 'running', completed });
        } catch (segErr) {
          const errorSummary = summarizePipelineError(segErr);
          updated[i] = { ...seg, status: 'error', errorMessage: errorSummary };
          const partialScript = updated.map(s => s.videoScript || '').filter(Boolean).join('\n\n');
          const applyErr = (arr: ProjectFile[]) => arr.map(f => f.id === file.id
            ? { ...f, scriptSegments: updated, scriptContent: partialScript }
            : f);
          setFiles(applyErr);
          filesRef.current = applyErr(filesRef.current);
          setStage(file.id, 'videoScript', { status: 'error', completed, errorMessage: `第 ${i + 1} 段失败：${errorSummary}` });
          await updateEpisodeScriptById(propEpisodeId, file.id, { adapted_script: partialScript }).catch(() => {});
          await batchSaveScriptSegments(propEpisodeId, file.id, buildScriptSegmentPayload(updated)).catch(() => {});
          return false; // 保留已完成，下次从失败段继续
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
      await batchSaveScriptSegments(propEpisodeId, file.id, buildScriptSegmentPayload(updated)).catch(() => {});
      return true;
    } catch (e) {
      setStage(file.id, 'videoScript', { status: 'error', errorMessage: summarizePipelineError(e) });
      return false;
    }
  }, [selectedFileId, aiModel, propEpisodeId, setStage]);

  /** Stage 3：对每个视频镜头块提取分镜提示词 → StoryboardItem[] */
  const handleExtractStoryboardPrompts = useCallback(async (targetFileId?: string) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return false;
    const segs = (file.scriptSegments || []).filter(s => s.videoScript);
    if (segs.length === 0) { alert('请先生成视频脚本'); return false; }

    // 收集所有镜头块（带 segmentId 关联）
    const shots: Array<{ segmentId: string; block: VideoScriptBlock }> = [];
    for (const seg of segs) {
      for (const block of parseVideoScriptBlocks(seg.videoScript!)) {
        shots.push({ segmentId: seg.id, block });
      }
    }
    if (shots.length === 0) { alert('未能从视频脚本解析出镜头'); return false; }

    // total = 视频镜头数（AI 调用次数）；一个视频镜头可拆成多个分镜 item
    setStage(file.id, 'storyboardPrompt', { status: 'running', total: shots.length, completed: 0, errorMessage: '' });
    // 重跑只追加新的镜头设计；已生成镜头及其下游素材由用户自行删除。
    const items: StoryboardItem[] = (file.storyboard?.items || []).filter(item => !item.isPlaceholder);
    // 把当前 items 写入 React state + filesRef（同步），供 Stage3 末尾的 saveEpisodeToBackend 立即看到
    const applyItems = (arr: ProjectFile[]) => arr.map(f => f.id === file.id ? { ...f, storyboard: { items } } : f);
    for (let i = 0; i < shots.length; i++) {
      const { segmentId, block } = shots[i];
      try {
        // 单个视频镜头 → 一个或多个更细的分镜
        const { aiExtractStoryboardPromptFromVideoShot } = await loadAiModelService();
        const exList = await aiExtractStoryboardPromptFromVideoShot(aiModel, block.rawBlock);
        if (exList.length === 0) {
          throw new Error('AI 返回内容未解析出分镜提示词');
        }
        for (const ex of exList) {
          items.push({
            id: uuidv4(),
            shotNumber: items.length + 1,
            originalText: ex.sceneDescription || block.rawBlock.slice(0, 80),
            scriptSegment: ex.sceneDescription || '',
            characters: ex.characters || [],           // 人物 → bound_assets char:
            scene: ex.scene || '',                     // 场景 → bound_assets scene:
            props: ex.props || [],                     // 道具 → bound_assets prop:
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
        const errorSummary = summarizePipelineError(shotErr);
        setFiles(applyItems);
        filesRef.current = applyItems(filesRef.current);
        setStage(file.id, 'storyboardPrompt', { status: 'error', completed: i, errorMessage: `第 ${i + 1} 个镜头失败：${errorSummary}` });
        if (items.length > 0) {
          await saveEpisodeToBackend().catch(() => {});
        }
        return false; // 保留已提取
      }
    }
    setFiles(applyItems);
    filesRef.current = applyItems(filesRef.current); // 关键：保证下面的 save 读到刚生成的 items
    setStage(file.id, 'storyboardPrompt', { status: 'done', completed: shots.length });
    await saveEpisodeToBackend();
    return true;
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
    const videoScriptOk = await handleGenerateVideoScript(file.id);
    if (!videoScriptOk) return;
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
          const { aiGenerateShotDetails } = await loadAiModelService();
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
             const { aiExtractScriptMetadata } = await loadAiModelService();
             const metadata = await aiExtractScriptMetadata(aiModel, currentFile.scriptContent);
             
             updateFileWithHistory(id, (f) => ({
                 ...f,
                 extractedCharacters: metadata.characters,
                 extractedScenes: metadata.scenes,
                 extractedProps: metadata.props || [],
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
        const { aiRefineScriptSegment } = await loadAiModelService();
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

          const { aiRestructureShot } = await loadAiModelService();
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
              props: item.props || [],
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
                  const { aiRewriteNovelToScript } = await loadAiModelService();
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
              const { aiExtractShotsFromScript } = await loadAiModelService();
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
                      const { aiGenerateShotDetails } = await loadAiModelService();
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
                <div className="relative h-full w-[280px] flex-shrink-0 overflow-hidden border-r border-n40">
                    <React.Suspense fallback={<LegacyColumnFallback label="files" />}>
                    <FileColumn 
                    files={files} 
                    selectedFileId={selectedFileId} 
                    activeFileId={activeScriptId || null}
                    checkedFileIds={checkedFileIds}
                    onFileSelect={handleFileSelect} 
                    onActivateFile={activateWorkflowScript}
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
                    isExpanded={false}
                    onToggleExpand={() => {}}
                    onReorderFiles={handleReorderFiles}
                    onExportProject={handleExportProject}
                    />
                    </React.Suspense>
                </div>

                <div className="relative flex h-full min-w-0 flex-1 overflow-hidden">
                    <React.Suspense fallback={<LegacyColumnFallback label="conversation" />}>
                    <ScriptConversationPane
                        selectedFile={selectedFile}
                        conversation={selectedConversation}
                        aiModel={aiModel}
                        onChangeModel={setAiModel}
                        isWorkflowScript={selectedFileId === activeScriptId}
                        isLoading={conversationLoadingId === selectedFileId}
                        isSending={conversationSendingId === selectedFileId}
                        error={conversationError}
                        onSend={handleConversationSend}
                        onGenerateDesign={handleConversationGenerateDesign}
                        onEditVersion={handleConversationEditVersion}
                        onExportVersion={handleConversationExportVersion}
                        onOpenStoryboard={handleOpenStoryboardDrawer}
                        storyboardItemCount={Math.max(
                          selectedStoryboardItemCount,
                          selectedFileId ? (storyboardTotalsByFileId[selectedFileId] ?? 0) : 0,
                        )}
                    />
                    </React.Suspense>

                    {storyboardDrawerOpen && (
                      <button
                        type="button"
                        className="absolute inset-0 z-30 bg-n900/20 lg:hidden"
                        onClick={() => setStoryboardDrawerOpen(false)}
                        aria-label="关闭镜头设计"
                      />
                    )}
                    <aside className={`absolute inset-y-0 right-0 z-40 w-full border-l border-n40 bg-n0 shadow-bottom transition-transform duration-200 sm:w-[min(720px,72vw)] ${storyboardDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                    <React.Suspense fallback={<LegacyColumnFallback label="storyboard" />}>
                    <StoryboardColumn 
                        selectedFile={selectedFile}
                        onGenerateStoryboard={handleGenerateStoryboard}
                        isProcessing={isProcessing}
                        generationProgress={shotGenerationProgress}
                        processingType={processingType}
                        aiModel={aiModel}
                        isExpanded={false}
                        onToggleExpand={() => {}}
                        onClose={() => setStoryboardDrawerOpen(false)}
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
                        isWorkflowScript={selectedFileId === activeScriptId}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        canUndo={canUndo}
                        canRedo={canRedo}
                        onSaveVersion={(name) => selectedFileId && handleSaveVersion(selectedFileId, name)}
                        onRestoreStoryboard={(version) => selectedFileId && handleRestoreStoryboard(selectedFileId, version)}
                        onDeleteVersion={(versionId) => selectedFileId && handleDeleteVersion(selectedFileId, versionId)}
                        scriptVersions={selectedConversation?.versions || []}
                        currentScriptVersionId={selectedConversation?.currentVersionId}
                        onRestoreScriptVersion={handleConversationGenerateDesign}
                    />
                    </React.Suspense>
                    </aside>
                </div>
            </div>
          )}

          {/* Materials */}
          {mountedViews.has(AppView.Materials) && (
            <div style={{ display: currentView === AppView.Materials ? 'contents' : 'none' }}>
              {!isDataLoaded ? <SkeletonScreen message="正在加载素材库..." /> : (
                <React.Suspense fallback={<LegacyViewFallback label="materials" />}>
                <LegacyMaterialPage
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
                </React.Suspense>
              )}
            </div>
          )}

          {/* Generation - 保活核心：生成任务不再因页面切换中断 */}
          {mountedViews.has(AppView.Generation) && (
            <div style={{ display: currentView === AppView.Generation ? 'contents' : 'none' }}>
              {!isDataLoaded ? <SkeletonScreen message="正在加载分镜数据..." /> : (
                  <React.Suspense fallback={<LegacyViewFallback label="generation" />}>
                  <LegacyGenerationPage
                      files={files}
                      selectedFileId={selectedFileId}
                      episodeId={propEpisodeId}
                      materialLibrary={materialLibrary}
                      shotPageSize={WORKSPACE_INITIAL_STORYBOARD_COUNT}
                      totalShotCount={selectedFileId ? (storyboardTotalsByFileId[selectedFileId] ?? selectedFile?.storyboard?.items?.length ?? 0) : 0}
                      onVisibleShotCountChange={handleWorkspaceVisibleShotCountChange}
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
                  </React.Suspense>
              )}
            </div>
          )}

          {/* Video */}
          {mountedViews.has(AppView.Video) && (
            <div style={{ display: currentView === AppView.Video ? 'contents' : 'none' }}>
                <React.Suspense fallback={<LegacyViewFallback label="video" />}>
                <LegacyVideoPage
                  onAddNotification={addTaskNotification}
                  onUpdateNotification={updateTaskNotification}
                  isActive={currentView === AppView.Video}
                  sessionScope={propEpisodeId || ''}
                />
                </React.Suspense>
            </div>
          )}

          {/* History */}
          {mountedViews.has(AppView.History) && (
            <div style={{ display: currentView === AppView.History ? 'contents' : 'none' }}>
                <React.Suspense fallback={<LegacyViewFallback label="history" />}>
                <LegacyHistoryPage />
                </React.Suspense>
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
                  <React.Suspense fallback={<LegacyViewFallback label="admin" />}>
                  <LegacyAdminPage
                      files={files}
                      materialLibrary={materialLibrary}
                  />
                  </React.Suspense>
              )}
            </div>
          )}
        </>
      );
  }

  return (
    <div className={`layout-safe flex flex-col ${hideHeader ? 'h-full' : 'h-screen'} bg-n20 text-n800 font-sans`}>
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
      
      <main className={`workspace-main flex-1 ${currentView === AppView.Admin ? 'flex' : 'flex'} relative`} ref={containerRef}>
         <div className="workspace-view-frame w-full h-full flex">
         {renderAllViews()}
         </div>
      </main>
    </div>
  );
};

export default WorkspaceApp;
