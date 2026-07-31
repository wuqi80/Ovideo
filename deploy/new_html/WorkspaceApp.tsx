

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';
import { FileText, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from './components/Header';
import { SkeletonScreen } from './components/SkeletonScreen';
import { ProjectFile, FileStatus, StoryboardItem, FileVersion, AppView, MaterialLibrary, Material, AiModel, TaskNotification, ScriptSegment, ScriptGenerationStageState, ScriptConversation, ScriptStoryboardVersion } from './types';
import {
  combineVideoScriptOutputs,
  ensureVideoScriptPromptLengths,
  formatHierarchicalShotNumber,
  normalizeGeneratedVideoScript,
  parseHierarchicalShotNumber,
  parseVideoScriptGroups,
} from './utils/scriptPipelineParsers';
import { parseStreamingBlocks, convertToStoryboardItem, removeControlCharacters, segmentInputContent, countShots } from './utils/storyboardParser';
import { deriveScriptStagesFromPersisted } from './utils/scriptStageDerivation';
import { listEpisodeScripts, createEpisodeScript, updateEpisodeScriptById, deleteEpisodeScript, listEpisodeScriptSegments, batchSaveScriptSegments, getScriptConversation, createScriptMessage, updateScriptMessage, createScriptVersion, selectScriptVersion, updateScriptVersionMetadata } from './services/scriptTimelineService';
import { assertEnoughCredits, consumeCredits, estimateTextTokens } from './services/creditService';
import { exportScript, deleteStoryboardItem } from './services/storyboardMutationService';
import { batchCreateStoryboardItems, getEpisodeScript, updateEpisodeScript, getStoryboardItems, updateStoryboardItem } from './services/episodeDataService';
import { getAuthToken } from './services/httpClient';
import { useScriptModelOptions } from './hooks/useScriptModelOptions';
import {
  formatScriptModelDisplay,
  getScriptModelBillingKey,
  getScriptModelOption,
  type ScriptModelOption,
} from './services/scriptModelCatalogService';
import { storyboardItemToDbUpdate } from './utils/episodeAdapters';
import {
  ensureStoryboardCutSeparators,
} from './utils/scriptIteration';
import {
  buildStoryboardSegmentGroups,
  normalizePositiveIntegerSeconds,
  normalizeStoryboardItemsForWorkflow,
  serializeStoryboardItemsWithSegments,
  synchronizeStoryboardSegmentVideoPrompts,
} from './utils/storyboardSegments';
import {
  STORYBOARD_SNAPSHOTS_METADATA_KEY,
  cloneStoryboardSnapshot,
  collectConversationStoryboardSnapshots,
  createStoryboardSnapshot,
  getVersionStoryboardSnapshots,
  mergeStoryboardSnapshots,
} from './utils/storyboardSnapshots';
import {
  readScriptWorkspaceMode,
  writeScriptWorkspaceMode,
  type ScriptWorkspaceMode,
} from './utils/scriptWorkspaceMode';
import { ScriptWorkspaceModeSwitch } from './components/ScriptWorkspaceModeSwitch';

const loadAiModelService = () => import('./services/aiModelService');
const loadScriptThreeStageService = () => import('./services/scriptThreeStageService');

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
const QuickScriptSourceColumn = React.lazy(() => import('./components/QuickScriptSourceColumn').then(m => ({ default: m.QuickScriptSourceColumn })));
const QuickScriptVersionColumn = React.lazy(() => import('./components/QuickScriptVersionColumn').then(m => ({ default: m.QuickScriptVersionColumn })));
const VideoReversePage = React.lazy(() => import('./pages/VideoReversePage').then(m => ({ default: m.VideoReversePage })));
const StoryboardScriptColumn = React.lazy(() => import('./components/StoryboardScriptColumn').then(m => ({ default: m.StoryboardScriptColumn })));
const StoryboardColumn = React.lazy(() => import('./components/StoryboardColumn').then(m => ({ default: m.StoryboardColumn })));
const LegacyMaterialPage = React.lazy(() => import('./components/MaterialPage').then(m => ({ default: m.MaterialPage })));
const LegacyGenerationPage = React.lazy(() => import('./components/GenerationPage').then(m => ({ default: m.GenerationPage })));
const LegacyVideoPage = React.lazy(() => import('./components/VideoPage').then(m => ({ default: m.VideoPage })));
const LegacyAdminPage = React.lazy(() => import('./components/AdminPage').then(m => ({ default: m.AdminPage })));

function summarizePipelineError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '未知错误');
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '未知错误';
  if (/存在缺失或非正整数镜头时长|累计\d+(?:\.\d+)?秒，超过15秒上限/.test(normalized)) {
    return '当前分镜脚本时长未通过校验，请重新生成视频脚本后再生成镜头设计';
  }
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

function buildStoryboardDbPayload(items: StoryboardItem[]): any[] {
  return items
    .filter(item => !item.isPlaceholder)
    .map((item, index) => {
      const rawImage = ((item as any).generatedImage || (item as any).generated_image_url || '').toString();
      const cleanImage = rawImage.split('?')[0];
      const persistedImage = cleanImage.startsWith('http') || cleanImage.startsWith('/') ? cleanImage : '';
      return {
        sort_order: index,
        scene_heading: item.originalText || item.scene || '',
        action_text: item.scriptSegment || '',
        dialogue: item.dialogue || '',
        camera_movement: item.cameraMovement || '',
        image_prompt: item.imagePrompt || '',
        video_prompt: item.videoPrompt || '',
        generated_image_url: persistedImage,
        planned_duration_ms: item.plannedDurationMs || null,
        bound_assets: buildBoundAssetTags(item),
        configured_references: item.configuredReferences || [],
        reference_config_initialized: Boolean(
          item.referenceConfigInitialized || item.configuredReferences?.length
        ),
        script_segment_id: item.scriptSegmentId || null,
        source_video_shot_no: item.sourceVideoShotNo || '',
        video_script_block: item.videoScriptBlock || '',
        shot_size: item.shotSize || '',
        camera_angle: item.cameraAngle || '',
      };
    });
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
    const rawPlannedDurationMs = r.planned_duration_ms ?? r.plannedDurationMs ?? null;
    const plannedDurationSeconds = normalizePositiveIntegerSeconds(
      rawPlannedDurationMs ? rawPlannedDurationMs / 1000 : null,
    );
    return {
      id: r.item_id ?? r.itemId ?? uuidv4(),
      shotNumber: r.source_video_shot_no ?? r.sourceVideoShotNo ?? idx + 1,
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
      referenceConfigInitialized: Boolean(
        r.reference_config_initialized
        ?? r.referenceConfigInitialized
        ?? (Array.isArray(r.configured_references ?? r.configuredReferences)
          && (r.configured_references ?? r.configuredReferences).length > 0)
      ),
      characters: boundAssets.filter((a: string) => a.startsWith('char:')).map((a: string) => a.replace('char:', '')),
      scene: boundAssets.find((a: string) => a.startsWith('scene:'))?.replace('scene:', '') || '',
      props: boundAssets.filter((a: string) => a.startsWith('prop:')).map((a: string) => a.replace('prop:', '')),
      plannedDurationMs: plannedDurationSeconds ? plannedDurationSeconds * 1000 : null,
      duration: plannedDurationSeconds ? `${plannedDurationSeconds}秒` : undefined,
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
  const normalized = (rows || []).map((row: any, index: number) => {
    if (row?.originalText !== undefined || row?.scriptSegment !== undefined) {
      return { ...row, id: row.id || uuidv4(), shotNumber: row.shotNumber ?? index + 1 } as StoryboardItem;
    }
    return mapWorkspaceStoryboardRowsToItems([row])[0];
  });
  return normalizeStoryboardItemsForWorkflow(normalized);
}

function buildLocalScriptVersionStoryboardItems(file: ProjectFile): StoryboardItem[] {
  if (file.scriptContent?.trim()) {
    const parsedItems = parseStoryboardVersionContent(file.scriptContent);
    if (parsedItems.length > 0) return parsedItems;
  }
  return file.storyboard?.items || [];
}

function buildLocalScriptConversation(file: ProjectFile): ScriptConversation {
  const now = Date.now();
  const fallbackVersion: ScriptStoryboardVersion | undefined = file.scriptContent ? {
    id: `legacy_${file.id}`,
    scriptId: file.id,
    versionNo: 1,
    content: file.scriptContent,
    storyboardItems: buildLocalScriptVersionStoryboardItems(file),
    source: 'legacy',
    status: 'ready',
    modelAlias: '历史版本',
    provider: 'legacy',
    modelName: 'legacy',
    createdAt: file.lastUpdated || now,
    updatedAt: file.lastUpdated || now,
    messageId: `legacy_assistant_${file.id}`,
  } : undefined;
  return {
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
  };
}

function normalizeScriptContentForCompare(content?: string | null): string {
  return (content || '').trim().replace(/\r\n/g, '\n');
}

function mergeScriptConversationWithLocalFile(
  file: ProjectFile | undefined,
  conversation?: ScriptConversation,
): ScriptConversation | undefined {
  const localContent = normalizeScriptContentForCompare(file?.scriptContent);
  if (!file || !localContent) return conversation;

  const localConversation = buildLocalScriptConversation(file);
  const localVersion = localConversation.versions[0];
  if (!localVersion) return conversation;
  if (!conversation) return localConversation;

  const existingVersions = conversation.versions || [];
  const matchingVersion = [...existingVersions].reverse().find(
    version => normalizeScriptContentForCompare(version.content) === localContent,
  );

  if (matchingVersion && !matchingVersion.id.startsWith('legacy_')) {
    return {
      ...conversation,
      currentVersionId: matchingVersion.id,
    };
  }

  const maxVersionNo = existingVersions.reduce(
    (max, version) => Math.max(max, Number(version.versionNo) || 0),
    0,
  );
  const localVersionNo = matchingVersion?.versionNo
    || Math.max(localVersion.versionNo || 1, maxVersionNo + 1);
  const mergedLocalVersion: ScriptStoryboardVersion = {
    ...localVersion,
    versionNo: localVersionNo,
    createdAt: matchingVersion?.createdAt || localVersion.createdAt,
    updatedAt: Math.max(matchingVersion?.updatedAt || 0, localVersion.updatedAt || 0),
  };
  const localAssistantMessage = localConversation.messages.find(
    message => message.id === localVersion.messageId,
  );
  const localUserMessage = localConversation.messages.find(
    message => message.id === `legacy_user_${file.id}`,
  );
  const hasUserMessage = conversation.messages.some(message => message.role === 'user');
  const messagesWithoutLocal = conversation.messages.filter(
    message => message.id !== localVersion.messageId && message.id !== `legacy_user_${file.id}`,
  );

  return {
    ...conversation,
    currentVersionId: localVersion.id,
    messages: [
      ...(localUserMessage && !hasUserMessage ? [localUserMessage] : []),
      ...messagesWithoutLocal,
      ...(localAssistantMessage
        ? [{
            ...localAssistantMessage,
            content: mergedLocalVersion.content,
            createdAt: mergedLocalVersion.createdAt,
            updatedAt: mergedLocalVersion.updatedAt,
          }]
        : []),
    ],
    versions: [
      ...existingVersions.filter(version => version.id !== localVersion.id),
      mergedLocalVersion,
    ],
  };
}

function parseStoryboardVersionContent(content: string): StoryboardItem[] {
  if (!content.trim()) return [];
  const separated = ensureStoryboardCutSeparators(content);
  const normalized = separated.endsWith('---CUT---') ? separated : `${separated}\n---CUT---`;
  const parsed = parseStreamingBlocks(normalized);
  const groupPrompts = new Map(
    parseVideoScriptGroups(content).map(group => [group.groupNo, group.sharedVideoPrompt]),
  );
  const items = parsed.completedBlocks.map(convertToStoryboardItem).map((item) => {
    const parsedShotNumber = parseHierarchicalShotNumber(item.shotNumber);
    const segmentNo = parsedShotNumber?.segmentNo
      || Number.parseInt(String(item.scriptSegmentId || '').match(/(\d+)$/)?.[1] || '', 10)
      || 1;
    const videoPrompt = groupPrompts.get(segmentNo) || item.videoPrompt;
    return videoPrompt ? { ...item, videoPrompt } : item;
  });
  return synchronizeStoryboardSegmentVideoPrompts(
    normalizeStoryboardItemsForWorkflow(items),
  );
}

function exportStoryboardVersionCsv(file: ProjectFile, version: ScriptStoryboardVersion): void {
  const normalizedItems = normalizeVersionStoryboardItems(version.storyboardItems);
  const segmentGroups = buildStoryboardSegmentGroups(normalizedItems);
  const segmentByItemId = new Map(segmentGroups.flatMap(group => group.entries.map(entry => [entry.item.id, {
    segmentNo: group.segmentNo,
    localShotNo: entry.localShotNo,
  }] as const)));
  const headers = ['分段', '段内镜头', '全局序号', '时长', '画面描述', '人物', '场景', '道具', '生图 Prompt', '视频 Prompt', '人物台词'];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = normalizedItems.map((item, index) => [
    segmentByItemId.get(item.id)?.segmentNo || 1,
    segmentByItemId.get(item.id)?.localShotNo || index + 1,
    index + 1,
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

function getScriptModelInfo(model: AiModel, options: readonly ScriptModelOption[]) {
  const option = getScriptModelOption(model, options);
  return {
    alias: formatScriptModelDisplay(option),
    provider: 'script-writing',
    runtime: option.runtime,
    billingModel: getScriptModelBillingKey(option),
  };
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
  const scriptModelOptions = useScriptModelOptions();
  const scriptWorkspaceUsername = localStorage.getItem('username');
  const [scriptWorkspaceMode, setScriptWorkspaceMode] = useState<ScriptWorkspaceMode>(
    () => readScriptWorkspaceMode(localStorage, scriptWorkspaceUsername),
  );

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
  const [aiModel, setAiModel] = useState<AiModel>(AiModel.MinimaxM3);
  const [scriptConversations, setScriptConversations] = useState<Record<string, ScriptConversation>>({});
  const [quickSelectedVersionIds, setQuickSelectedVersionIds] = useState<Record<string, string>>({});
  const [conversationLoadingId, setConversationLoadingId] = useState<string | null>(null);
  const [conversationSendingId, setConversationSendingId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [storyboardDrawerOpen, setStoryboardDrawerOpen] = useState(false);
  const [videoReverseOpen, setVideoReverseOpen] = useState(false);
  const loadedConversationKeysRef = useRef<Set<string>>(new Set());
  const conversationRequestsRef = useRef<Map<string, Promise<ScriptConversation>>>(new Map());
  const appliedConversationModelRef = useRef<string>('');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef<number | null>(null);

  const handleScriptWorkspaceModeChange = useCallback((mode: ScriptWorkspaceMode) => {
    writeScriptWorkspaceMode(localStorage, scriptWorkspaceUsername, mode);
    setScriptWorkspaceMode(mode);
    if (mode === 'quick') setStoryboardDrawerOpen(false);
  }, [scriptWorkspaceUsername]);

  const selectedFile = files.find(f => f.id === selectedFileId);
  const rawSelectedConversation = selectedFileId ? scriptConversations[selectedFileId] : undefined;
  const selectedConversation = useMemo(
    () => mergeScriptConversationWithLocalFile(selectedFile, rawSelectedConversation),
    [rawSelectedConversation, selectedFile],
  );
  const selectedConversationVersion = selectedConversation?.versions.find(
    version => version.id === selectedConversation.currentVersionId,
  ) || selectedConversation?.versions[selectedConversation.versions.length - 1];
  const fallbackQuickVersion = selectedFile?.scriptContent ? buildLocalScriptConversation(selectedFile).versions[0] : undefined;
  const quickAvailableVersions = selectedConversation?.versions?.length
    ? selectedConversation.versions
    : (fallbackQuickVersion ? [fallbackQuickVersion] : []);
  const quickSelectedVersionId = selectedFileId ? quickSelectedVersionIds[selectedFileId] : undefined;
  const quickPipelineVersion = quickAvailableVersions.find(version => version.id === quickSelectedVersionId)
    || selectedConversationVersion
    || fallbackQuickVersion;
  const selectedHistoryScopeKey = selectedFileId
    ? buildVersionHistoryScopeKey(selectedFileId, selectedConversationVersion?.id)
    : null;
  const selectedStoryboardItemCount = (selectedFile?.storyboard?.items || [])
    .filter(item => !item.isPlaceholder).length;
  const handleQuickSelectVersion = useCallback((versionId: string) => {
    if (!selectedFileId) return;
    setQuickSelectedVersionIds(prev => ({ ...prev, [selectedFileId]: versionId }));
  }, [selectedFileId]);

  const syncScriptConversationFromFile = useCallback((fileId: string) => {
    const file = filesRef.current.find(item => item.id === fileId);
    if (!file) return;
    setScriptConversations(prev => {
      const merged = mergeScriptConversationWithLocalFile(file, prev[fileId]);
      if (!merged) return prev;
      return { ...prev, [fileId]: merged };
    });
  }, []);
  useEffect(() => {
    if (!selectedFileId || selectedFileId.startsWith('local_')) return;
    const cacheKey = `${propEpisodeId}:${selectedFileId}`;
    if (loadedConversationKeysRef.current.has(cacheKey)) {
      setConversationLoadingId(current => current === selectedFileId ? null : current);
      return;
    }
    let cancelled = false;
    const localFile = filesRef.current.find(item => item.id === selectedFileId);
    if (!scriptConversations[selectedFileId] && localFile) {
      const fallbackConversation = buildLocalScriptConversation(localFile);
      setScriptConversations(prev => prev[selectedFileId]
        ? prev
        : { ...prev, [selectedFileId]: fallbackConversation });
    }
    setConversationLoadingId(selectedFileId);
    setConversationError(null);
    let request = conversationRequestsRef.current.get(cacheKey);
    if (!request) {
      request = getScriptConversation(propEpisodeId, selectedFileId);
      conversationRequestsRef.current.set(cacheKey, request);
    }
    request
      .then(conversation => {
        if (cancelled) return;
        loadedConversationKeysRef.current.add(cacheKey);
        const latestFile = filesRef.current.find(item => item.id === selectedFileId);
        const mergedConversation = mergeScriptConversationWithLocalFile(latestFile, conversation) || conversation;
        setScriptConversations(prev => ({ ...prev, [selectedFileId]: mergedConversation }));
        const persistedSnapshots = collectConversationStoryboardSnapshots(mergedConversation);
        setFiles(prev => {
          const next = prev.map(file => (
            file.id === selectedFileId
              ? { ...file, versions: persistedSnapshots }
              : file
          ));
          filesRef.current = next;
          return next;
        });
      })
      .catch(error => {
        if (cancelled) return;
        console.error('加载剧本对话失败:', error);
        const file = filesRef.current.find(item => item.id === selectedFileId);
        if (file) {
          setScriptConversations(prev => ({
            ...prev,
            [file.id]: prev[file.id] || buildLocalScriptConversation(file),
          }));
        }
        setConversationError('对话历史暂时无法从服务器加载，已显示当前剧本内容。');
      })
      .finally(() => {
        if (conversationRequestsRef.current.get(cacheKey) === request) {
          conversationRequestsRef.current.delete(cacheKey);
        }
        if (!cancelled) setConversationLoadingId(null);
      });
    return () => { cancelled = true; };
  }, [propEpisodeId, selectedFileId]);

  useEffect(() => {
    const selectionKey = selectedFileId || '';
    if (!selectedFileId || appliedConversationModelRef.current === selectionKey) return;
    appliedConversationModelRef.current = selectionKey;
    setAiModel(AiModel.MinimaxM3);
  }, [selectedFileId]);
  
  // 保存定时器引用
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // --- 后端数据持久化 ---

  /**
   * 分集模式：加载当前分集的所有文件（多文件支持）
   */
  const loadEpisodeData = async (preferredScriptId?: string) => {
    if (!propEpisodeId) return;
    setIsLoadingProjects(true);
    try {
      const [scriptsRes, segRes] = await Promise.all([
        listEpisodeScripts(propEpisodeId).catch(() => ({ success: false, scripts: [] })),
        listEpisodeScriptSegments(propEpisodeId).catch(() => ({ success: false, segments: [] })),
      ]);

      const scripts: any[] = scriptsRes.success ? (scriptsRes.scripts || []) : [];
      const requestedScriptId = preferredScriptId || initialScriptId;
      const initialStoryboardScriptId = (
        requestedScriptId && scripts.some((script: any) => (script.script_id ?? script.scriptId) === requestedScriptId)
      )
        ? requestedScriptId
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

      const restoreId = requestedScriptId && projectFiles.some(f => f.id === requestedScriptId)
        ? requestedScriptId
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
        const mergedItems = normalizeStoryboardItemsForWorkflow([
          ...persistedItems.map(item => currentItemsById.get(item.id) || item),
          ...currentItems.filter(item => !persistedIds.has(item.id)),
        ], file.scriptSegments || []);
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

  const persistStoryboardSnapshot = useCallback(async (
    fileId: string,
    options: {
      name?: string;
      source: 'auto' | 'manual';
      version?: ScriptStoryboardVersion;
    },
  ): Promise<FileVersion> => {
    const file = filesRef.current.find(item => item.id === fileId);
    if (!file?.storyboard?.items?.some(item => !item.isPlaceholder)) {
      throw new Error('当前没有可保存的镜头设计');
    }

    const conversation = scriptConversations[fileId];
    const targetVersion = options.version
      || conversation?.versions.find(version => version.id === conversation.currentVersionId)
      || conversation?.versions[conversation.versions.length - 1];
    const timestamp = Date.now();
    const snapshot = createStoryboardSnapshot(file, {
      id: uuidv4(),
      timestamp,
      name: options.name || `${options.source === 'auto' ? '自动存档' : '镜头存档'} · ${new Date(timestamp).toLocaleString('zh-CN')}`,
      source: options.source,
      scriptVersionId: targetVersion?.id,
    });

    if (targetVersion && !targetVersion.id.startsWith('legacy_') && !fileId.startsWith('local_')) {
      const snapshots = mergeStoryboardSnapshots(
        getVersionStoryboardSnapshots(targetVersion),
        [snapshot],
      );
      const updatedVersion = await updateScriptVersionMetadata(
        propEpisodeId,
        fileId,
        targetVersion.id,
        { [STORYBOARD_SNAPSHOTS_METADATA_KEY]: snapshots },
      );
      setScriptConversations(prev => prev[fileId] ? ({
        ...prev,
        [fileId]: {
          ...prev[fileId],
          versions: prev[fileId].versions.map(version => (
            version.id === updatedVersion.id ? updatedVersion : version
          )),
        },
      }) : prev);
    }

    setFiles(prev => {
      const next = prev.map(item => (
        item.id === fileId
          ? { ...item, versions: mergeStoryboardSnapshots(item.versions || [], [snapshot]) }
          : item
      ));
      filesRef.current = next;
      return next;
    });
    return snapshot;
  }, [propEpisodeId, scriptConversations]);

  const handleSaveVersion = useCallback(async (id: string, customName?: string) => {
    await persistStoryboardSnapshot(id, {
      name: customName,
      source: 'manual',
    });
  }, [persistStoryboardSnapshot]);

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
      const restoredVersion = cloneStoryboardSnapshot(version);
      updateFileWithHistory(fileId, (f) => ({
          ...f,
          storyboard: restoredVersion.data.storyboard
      }), { recordHistory: false, resetHistory: true });
  };

  const handleDeleteVersion = useCallback(async (fileId: string, versionId: string) => {
    const file = filesRef.current.find(item => item.id === fileId);
    const snapshot = file?.versions?.find(version => version.id === versionId);
    if (!snapshot) return;

    const conversation = scriptConversations[fileId];
    const targetVersion = conversation?.versions.find(version => (
      version.id === snapshot.scriptVersionId
      || getVersionStoryboardSnapshots(version).some(item => item.id === versionId)
    ));
    if (targetVersion && !targetVersion.id.startsWith('legacy_') && !fileId.startsWith('local_')) {
      const remaining = getVersionStoryboardSnapshots(targetVersion)
        .filter(version => version.id !== versionId);
      const updatedVersion = await updateScriptVersionMetadata(
        propEpisodeId,
        fileId,
        targetVersion.id,
        { [STORYBOARD_SNAPSHOTS_METADATA_KEY]: remaining },
      );
      setScriptConversations(prev => prev[fileId] ? ({
        ...prev,
        [fileId]: {
          ...prev[fileId],
          versions: prev[fileId].versions.map(version => (
            version.id === updatedVersion.id ? updatedVersion : version
          )),
        },
      }) : prev);
    }

    setFiles(prev => {
      const next = prev.map(item => item.id === fileId ? {
        ...item,
        versions: (item.versions || []).filter(version => version.id !== versionId),
      } : item);
      filesRef.current = next;
      return next;
    });
  }, [propEpisodeId, scriptConversations]);



  const loadWorkspaceStoryboardPage = useCallback(async (
    fileId: string,
    count: number,
  ): Promise<StoryboardItem[]> => {
    if (!propEpisodeId || !fileId) return [];
    const targetCount = Math.max(WORKSPACE_INITIAL_STORYBOARD_COUNT, count || WORKSPACE_INITIAL_STORYBOARD_COUNT);
    const currentFile = filesRef.current.find(f => f.id === fileId);
    const currentItems = (currentFile?.storyboard?.items || []).filter(item => !item.isPlaceholder);
    if (fileId.startsWith('local_') || targetCount <= currentItems.length) return currentItems;

    const res: any = await getStoryboardItems(propEpisodeId, fileId, {
      limit: targetCount,
      includeTotal: true,
    });
    if (!res?.success) {
      throw new Error(res?.error || '镜头设计数据加载失败');
    }
    const items = normalizeStoryboardItemsForWorkflow(
      mapWorkspaceStoryboardRowsToItems(res.items || []),
    );
    setFiles(prev => {
      const next = prev.map(f => (
        f.id === fileId
          ? { ...f, storyboard: items.length > 0 ? { items } : null }
          : f
      ));
      filesRef.current = next;
      return next;
    });
    const total = typeof res.total === 'number' ? res.total : items.length;
    setStoryboardTotalsByFileId(prev => ({ ...prev, [fileId]: total }));
    return items;
  }, [propEpisodeId]);

  const handleWorkspaceVisibleShotCountChange = useCallback((count: number) => {
    if (!selectedFileId) return;
    void loadWorkspaceStoryboardPage(selectedFileId, count).catch(err => {
      console.warn('Workspace storyboard page load failed:', err);
    });
  }, [loadWorkspaceStoryboardPage, selectedFileId]);

  const ensureActiveStoryboardItemsLoaded = useCallback(async (fileId: string): Promise<StoryboardItem[]> => {
    const currentFile = filesRef.current.find(file => file.id === fileId);
    const currentItems = (currentFile?.storyboard?.items || []).filter(item => !item.isPlaceholder);
    const knownTotal = Math.max(storyboardTotalsByFileId[fileId] ?? 0, currentItems.length);
    if (!fileId.startsWith('local_') && knownTotal > currentItems.length) {
      const loadedItems = await loadWorkspaceStoryboardPage(fileId, knownTotal);
      return loadedItems.filter(item => !item.isPlaceholder);
    }
    return currentItems;
  }, [loadWorkspaceStoryboardPage, storyboardTotalsByFileId]);

  const archiveActiveStoryboardIfPresent = useCallback(async (
    fileId: string,
    options: {
      name?: string;
      source?: 'auto' | 'manual';
      version?: ScriptStoryboardVersion;
    } = {},
  ): Promise<FileVersion | null> => {
    const activeItems = await ensureActiveStoryboardItemsLoaded(fileId);
    if (activeItems.length === 0) return null;
    return persistStoryboardSnapshot(fileId, {
      source: options.source || 'auto',
      version: options.version,
      name: options.name || `自动历史 · 当前镜头设计 · ${new Date().toLocaleString('zh-CN')}`,
    });
  }, [ensureActiveStoryboardItemsLoaded, persistStoryboardSnapshot]);

  const replaceActiveStoryboardDesign = useCallback(async (
    fileId: string,
    items: StoryboardItem[],
    options: {
      archiveName?: string;
      versionId?: string;
      openDrawer?: boolean;
    } = {},
  ): Promise<StoryboardItem[]> => {
    const normalizedItems = normalizeStoryboardItemsForWorkflow(items);
    if (normalizedItems.filter(item => !item.isPlaceholder).length === 0) {
      throw new Error('镜头设计生成成功，但没有可保存的镜头');
    }
    await archiveActiveStoryboardIfPresent(fileId, { name: options.archiveName });
    const persisted = await batchCreateStoryboardItems(
      propEpisodeId,
      buildStoryboardDbPayload(normalizedItems),
      fileId,
    );
    if (!persisted?.success || !Array.isArray(persisted.items) || persisted.items.length === 0) {
      throw new Error('镜头设计生成成功，但正式镜头链路保存失败');
    }
    const persistedItems = normalizeStoryboardItemsForWorkflow(
      mapWorkspaceStoryboardRowsToItems(persisted.items),
    );
    flushSync(() => {
      updateFileWithHistory(fileId, current => ({
        ...current,
        storyboard: { items: persistedItems },
        status: FileStatus.Completed,
        lastUpdated: Date.now(),
      }), {
        recordHistory: false,
        resetHistory: true,
        versionId: options.versionId,
      });
      setStoryboardTotalsByFileId(prev => ({ ...prev, [fileId]: persistedItems.length }));
      setHighlightedScriptSegments(new Set());
      setHighlightedStoryboardItemIds(new Set());
      if (options.openDrawer) setStoryboardDrawerOpen(true);
    });
    return persistedItems;
  }, [archiveActiveStoryboardIfPresent, propEpisodeId, updateFileWithHistory]);

  const clearActiveStoryboardDesign = useCallback(async (
    fileId: string,
    options: { archiveName?: string; versionId?: string } = {},
  ): Promise<void> => {
    await archiveActiveStoryboardIfPresent(fileId, { name: options.archiveName });
    await batchCreateStoryboardItems(propEpisodeId, [], fileId);
    flushSync(() => {
      updateFileWithHistory(fileId, current => ({
        ...current,
        storyboard: null,
        lastUpdated: Date.now(),
      }), {
        recordHistory: false,
        resetHistory: true,
        versionId: options.versionId,
      });
      setStoryboardTotalsByFileId(prev => ({ ...prev, [fileId]: 0 }));
      setHighlightedScriptSegments(new Set());
      setHighlightedStoryboardItemIds(new Set());
    });
  }, [archiveActiveStoryboardIfPresent, propEpisodeId, updateFileWithHistory]);

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
      undefined,
      {
        operation: 'script_rewrite',
        displayName: '剧本修改',
        projectId: urlProjectId,
        episodeId: propEpisodeId,
        sourcePage: 'script',
        sourceItemId: selectedFileId || undefined,
        entityType: 'episode_script',
        entityId: selectedFileId || undefined,
      },
    );
  }, [aiModel, propEpisodeId, selectedFileId, urlProjectId]);

  const handleConversationSend = useCallback(async (content: string) => {
    const fileId = selectedFileId;
    const file = filesRef.current.find(item => item.id === fileId);
    if (!fileId || !file) throw new Error('请先选择剧本任务');
    if (fileId.startsWith('local_')) throw new Error('剧本任务尚未保存，请稍后重试');

    const conversation = mergeScriptConversationWithLocalFile(file, scriptConversations[fileId]) || {
      scriptId: fileId,
      messages: [],
      versions: [],
    };
    const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
    const requestId = `script_turn_${uuidv4()}`;
    const isFirstTurn = conversation.versions.length === 0;
    const currentVersion = conversation.versions.find(version => version.id === conversation.currentVersionId)
      || conversation.versions[conversation.versions.length - 1];
    const conversationContext = conversation.messages.slice(-10)
      .map(message => `${message.role === 'user' ? '用户' : '系统'}：${message.content.replace(/\s+/g, ' ').slice(0, 500)}`)
      .join('\n');
    const billingInput = isFirstTurn
      ? content
      : [currentVersion?.content || file.scriptContent || file.originalContent, content, conversationContext].join('\n');
    const forecastOutputTokens = Math.max(
      1000,
      estimateTextTokens(currentVersion?.content || file.scriptContent || content) * (isFirstTurn ? 3 : 1),
    );
    setConversationSendingId(fileId);
    setConversationError(null);

    let assistantMessageId: string | null = null;
    let streamedContent = '';
    let estimatedCreditCost = 0;
    let chargedCreditCost = 0;
    let pipelineInputTexts: string[] = [];
    let pipelineOutputTexts: string[] = [];
    try {
      const creditQuote = await assertEnoughCredits('script_model_call', {
        input_tokens: estimateTextTokens(billingInput),
        output_tokens: forecastOutputTokens,
        model: modelInfo.billingModel,
      });
      estimatedCreditCost = Number(creditQuote.estimated_cost || 0);
      const userMessage = await createScriptMessage(propEpisodeId, fileId, {
        role: 'user',
        content,
        status: 'completed',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        requestId: `${requestId}_user`,
      });
      setScriptConversations(prev => ({
        ...prev,
        [fileId]: {
          ...(prev[fileId] || conversation),
          messages: [...(prev[fileId]?.messages || conversation.messages), userMessage],
        },
      }));

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
        modelName: modelInfo.billingModel,
        replyToMessageId: userMessage.id,
        requestId: `${requestId}_assistant`,
        metadata: {
          requestId,
          estimatedCreditCost,
          creditCharged: false,
        },
      });
      assistantMessageId = assistantMessage.id;
      setScriptConversations(prev => ({
        ...prev,
        [fileId]: {
          ...(prev[fileId] || conversation),
          messages: [...(prev[fileId]?.messages || [...conversation.messages, userMessage]), assistantMessage],
        },
      }));

      let result = '';
      const replaceStreamContent = (nextContent: string) => {
        streamedContent = nextContent;
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
      };
      const appendStreamChunk = (chunk: string) => replaceStreamContent(`${streamedContent}${chunk}`);
      const taskContext = {
        projectId: urlProjectId,
        episodeId: propEpisodeId,
        sourcePage: 'script',
        sourceItemId: fileId,
        entityType: 'episode_script',
        entityId: fileId,
      };
      const generationSource = isFirstTurn
        ? content
        : currentVersion?.content || file.scriptContent || file.originalContent;
      const generationRequirements = isFirstTurn ? '' : content;
      const { aiGenerateStoryboardScript } = await loadAiModelService();
      result = await aiGenerateStoryboardScript(
        aiModel,
        generationSource,
        generationRequirements,
        appendStreamChunk,
        taskContext,
      );
      pipelineInputTexts = [generationSource, generationRequirements].filter(Boolean);
      pipelineOutputTexts = [result];

      const rawFinalContent = (result || streamedContent).trim();
      if (!rawFinalContent) throw new Error('模型未返回内容，请稍后重试');
      const finalContent = normalizeGeneratedVideoScript(rawFinalContent);
      const parsedItems = parseStoryboardVersionContent(finalContent);
      replaceStreamContent(finalContent);
      const billingParams = {
        input_tokens: estimateTextTokens(pipelineInputTexts.join('\n')),
        output_tokens: estimateTextTokens(pipelineOutputTexts.join('\n') || finalContent),
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'script_model_call',
        taskId: requestId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: { episode_id: propEpisodeId, script_id: fileId, operation: isFirstTurn ? 'create' : 'iterate' },
      });
      chargedCreditCost = Number(credit.charged_credits || 0);
      const billingMetadata = {
        requestId,
        estimatedCreditCost,
        creditCharged: true,
        creditCost: chargedCreditCost,
        creditTransactionId: credit.transaction_id,
        creditFeatureKey: credit.feature_key,
        creditUsage: billingParams,
      };
      const versionMetadata = {
        ...billingMetadata,
        scriptPipeline: {
          version: 3,
          stage: 'directStoryboardScript',
          shotNumberFormat: 'segment-local',
          sourceVersionId: isFirstTurn ? undefined : currentVersion?.id,
        },
      };
      const completedMessage = await updateScriptMessage(
        propEpisodeId,
        fileId,
        assistantMessage.id,
        { content: finalContent, status: 'completed', metadata: billingMetadata },
      );
      const version = await createScriptVersion(propEpisodeId, fileId, {
        messageId: assistantMessage.id,
        content: finalContent,
        storyboardItems: parsedItems,
        source: 'ai',
        status: 'ready',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        metadata: versionMetadata,
        setCurrent: true,
      });
      await updateEpisodeScriptById(propEpisodeId, fileId, {
        adapted_script: finalContent,
      });
      updateFileWithHistory(fileId, current => ({
        ...current,
        originalContent: isFirstTurn ? content : current.originalContent,
        scriptContent: finalContent,
        status: FileStatus.Completed,
        lastUpdated: Date.now(),
      }), { recordHistory: false });
      setScriptConversations(prev => {
        const current = prev[fileId] || conversation;
        return {
          ...prev,
          [fileId]: {
            ...current,
            currentVersionId: version.id,
            defaultModel: modelInfo.billingModel,
            messages: current.messages.map(message => message.id === assistantMessage.id ? completedMessage : message),
            versions: [...current.versions.filter(item => item.id !== version.id), version],
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成分镜脚本失败';
      setConversationError(assistantMessageId ? null : message);
      if (assistantMessageId) {
        const failedMetadata = {
          requestId,
          error: message,
          estimatedCreditCost,
          creditCharged: chargedCreditCost > 0,
          creditCost: chargedCreditCost,
        };
        await updateScriptMessage(propEpisodeId, fileId, assistantMessageId, {
          content: streamedContent,
          status: 'failed',
          metadata: failedMetadata,
        }).catch(() => undefined);
        setScriptConversations(prev => {
          const current = prev[fileId];
          if (!current) return prev;
          return {
            ...prev,
            [fileId]: {
              ...current,
              messages: current.messages.map(item => item.id === assistantMessageId
                ? { ...item, content: streamedContent, status: 'failed', metadata: failedMetadata, updatedAt: Date.now() }
                : item),
            },
          };
        });
      }
      throw error;
    } finally {
      setConversationSendingId(null);
    }
  }, [aiModel, propEpisodeId, scriptConversations, scriptModelOptions, selectedFileId, updateFileWithHistory, urlProjectId]);

  const handleConversationEditVersion = useCallback(async (
    sourceVersion: ScriptStoryboardVersion,
    content: string,
  ) => {
    const fileId = selectedFileId;
    if (!fileId) return;
    const normalizedContent = content.trim();
    if (!normalizedContent) throw new Error('分镜脚本内容不能为空');
    const parsedItems = parseStoryboardVersionContent(normalizedContent);
    const storyboardItems = parsedItems.length > 0 ? parsedItems : normalizeVersionStoryboardItems(sourceVersion.storyboardItems);
    const metadata = {
      sourceVersionId: sourceVersion.id,
      scriptPipeline: {
        ...(sourceVersion.metadata?.scriptPipeline || {}),
        version: 3,
        stage: 'videoScript',
        shotNumberFormat: 'segment-local',
        sourceVersionId: sourceVersion.id,
      },
    };
    const message = await createScriptMessage(propEpisodeId, fileId, {
      role: 'assistant',
      content: normalizedContent,
      status: 'completed',
      modelAlias: '手动编辑',
      provider: 'manual',
      modelName: 'manual',
      requestId: `manual_${uuidv4()}`,
      metadata,
    });
    const version = await createScriptVersion(propEpisodeId, fileId, {
      messageId: message.id,
      content: normalizedContent,
      storyboardItems,
      source: 'manual',
      status: 'ready',
      modelAlias: '手动编辑',
      provider: 'manual',
      modelName: 'manual',
      metadata,
      setCurrent: true,
    });
    await updateEpisodeScriptById(propEpisodeId, fileId, { adapted_script: normalizedContent });
    updateFileWithHistory(fileId, current => ({
      ...current,
      scriptContent: normalizedContent,
      status: FileStatus.Completed,
      lastUpdated: Date.now(),
    }), { recordHistory: false });
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
  }, [propEpisodeId, selectedFileId, updateFileWithHistory]);

  const handleConversationGenerateDesign = useCallback(async (
    version: ScriptStoryboardVersion,
    options: { autoSnapshot?: boolean; openDrawer?: boolean } = {},
  ) => {
    const fileId = selectedFileId;
    if (!fileId) return;
    setConversationError(null);
    setConversationSendingId(fileId);
    try {
      const selectedVersion = version.source === 'legacy' && version.id.startsWith('legacy_')
        ? version
        : await selectScriptVersion(propEpisodeId, fileId, version.id);

      // 历史区的“恢复此版本”只恢复该脚本版本最近一次镜头设计，不再次调用 AI、扣积分或生成新卡。
      if (options.autoSnapshot === false) {
        const localSnapshots = filesRef.current
          .find(item => item.id === fileId)
          ?.versions.filter(snapshot => snapshot.scriptVersionId === selectedVersion.id) || [];
        const snapshots = mergeStoryboardSnapshots(
          getVersionStoryboardSnapshots(selectedVersion),
          localSnapshots,
        );
        const latestSnapshot = snapshots[snapshots.length - 1];
        const items = latestSnapshot?.data.storyboard?.items
          ? normalizeVersionStoryboardItems(latestSnapshot.data.storyboard.items)
          : [];
        if (items.length === 0) {
          throw new Error(`分镜脚本 V${selectedVersion.versionNo} 尚无镜头设计历史，请在对话中点击“生成镜头设计”`);
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
          if (options.openDrawer !== false) setStoryboardDrawerOpen(true);
        });
        await updateEpisodeScriptById(propEpisodeId, fileId, { adapted_script: selectedVersion.content });
        return;
      }

      const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
      const sourceItems = parseStoryboardVersionContent(selectedVersion.content);
      if (sourceItems.length === 0) {
        throw new Error('当前分镜脚本版本没有可生成的镜头内容');
      }
      const billingTaskId = `storyboard_design_${uuidv4()}`;
      await assertEnoughCredits('storyboard_design_generation', {
        shot_count: sourceItems.length,
        input_tokens: estimateTextTokens(selectedVersion.content),
        output_tokens: Math.max(500, sourceItems.length * 500),
        model: modelInfo.billingModel,
      });

      const pipelineService = await loadScriptThreeStageService();
      const designResult = await pipelineService.generateStoryboardDesignForVersion(
        aiModel,
        selectedVersion.content,
        {
          taskContext: {
            projectId: urlProjectId,
            episodeId: propEpisodeId,
            sourcePage: 'script',
            sourceItemId: fileId,
            entityType: 'episode_script_version',
            entityId: selectedVersion.id,
          },
          onProgress: progress => {
            setShotGenerationProgress({ current: progress.completed, total: progress.total });
          },
        },
      );
      const persistedItems = await replaceActiveStoryboardDesign(
        fileId,
        designResult.items,
        {
          archiveName: `自动历史 · 生成分镜脚本 V${selectedVersion.versionNo} 镜头设计前 · ${new Date().toLocaleString('zh-CN')}`,
          versionId: selectedVersion.id,
          openDrawer: options.openDrawer !== false,
        },
      );
      await updateEpisodeScriptById(propEpisodeId, fileId, { adapted_script: selectedVersion.content });

      flushSync(() => {
        updateFileWithHistory(fileId, current => ({
          ...current,
          scriptContent: selectedVersion.content,
          status: FileStatus.Completed,
          lastUpdated: Date.now(),
        }), {
          recordHistory: false,
          versionId: selectedVersion.id,
        });
        setScriptConversations(prev => prev[fileId] ? ({
          ...prev,
          [fileId]: { ...prev[fileId], currentVersionId: selectedVersion.id },
        }) : prev);
      });

      await persistStoryboardSnapshot(fileId, {
        source: 'auto',
        version: selectedVersion,
        name: `自动存档 · 分镜脚本 V${selectedVersion.versionNo} · ${new Date().toLocaleString('zh-CN')}`,
      });

      const billingParams = {
        shot_count: persistedItems.length,
        input_tokens: estimateTextTokens(designResult.inputTexts.join('\n')),
        output_tokens: estimateTextTokens(designResult.outputTexts.join('\n')),
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'storyboard_design_generation',
        taskId: billingTaskId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: {
          episode_id: propEpisodeId,
          script_id: fileId,
          script_version_id: selectedVersion.id,
          operation: 'extract_storyboard_design',
        },
      });
      if (!selectedVersion.id.startsWith('legacy_')) {
        const previousBillings = Array.isArray(selectedVersion.metadata?.storyboardDesignBillings)
          ? selectedVersion.metadata.storyboardDesignBillings
          : [];
        const updatedVersion = await updateScriptVersionMetadata(propEpisodeId, fileId, selectedVersion.id, {
          storyboardDesignCreditCost: credit.charged_credits,
          storyboardDesignCreditTransactionId: credit.transaction_id,
          storyboardDesignCreditTaskId: billingTaskId,
          storyboardDesignUsage: billingParams,
          storyboardDesignGeneratedAt: Date.now(),
          storyboardDesignBillings: [
            ...previousBillings,
            {
              taskId: billingTaskId,
              cost: credit.charged_credits,
              usage: billingParams,
              createdAt: Date.now(),
            },
          ].slice(-20),
        });
        setScriptConversations(prev => prev[fileId] ? ({
          ...prev,
          [fileId]: {
            ...prev[fileId],
            versions: prev[fileId].versions.map(item => item.id === updatedVersion.id ? updatedVersion : item),
          },
        }) : prev);
      }
      window.alert(`生成镜头设计完成，已拆为 ${persistedItems.length} 个镜头`);
    } catch (error) {
      const message = summarizePipelineError(error);
      console.error('生成镜头设计失败:', error);
      setConversationError(`生成镜头设计失败：${message}`);
    } finally {
      setConversationSendingId(null);
      setShotGenerationProgress(null);
    }
  }, [
    aiModel,
    persistStoryboardSnapshot,
    propEpisodeId,
    replaceActiveStoryboardDesign,
    scriptModelOptions,
    selectedFileId,
    updateFileWithHistory,
    urlProjectId,
  ]);

  const handleOpenStoryboardDrawer = useCallback(async () => {
    if (!selectedFileId) return;
    setConversationError(null);
    const file = filesRef.current.find(item => item.id === selectedFileId);
    const existingItems = (file?.storyboard?.items || []).filter(item => !item.isPlaceholder);
    if (existingItems.length > 0) {
      setStoryboardDrawerOpen(true);
      return;
    }
    try {
      const knownTotal = storyboardTotalsByFileId[selectedFileId] ?? WORKSPACE_INITIAL_STORYBOARD_COUNT;
      const loadedItems = await loadWorkspaceStoryboardPage(selectedFileId, knownTotal);
      if (loadedItems.some(item => !item.isPlaceholder)) {
        setStoryboardDrawerOpen(true);
        return;
      }
      setConversationError('当前还没有可展示的镜头设计，请先生成镜头设计。');
    } catch (error) {
      console.warn('Workspace storyboard drawer load failed:', error);
      setConversationError(`镜头设计加载失败：${summarizePipelineError(error)}`);
    }
  }, [
    loadWorkspaceStoryboardPage,
    selectedFileId,
    storyboardTotalsByFileId,
  ]);

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
      void loadWorkspaceStoryboardPage(id, WORKSPACE_INITIAL_STORYBOARD_COUNT).catch(err => {
        console.warn('Workspace storyboard page load failed:', err);
      });
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

    // 策略0（三阶段精确匹配）：按 videoScriptBlock 子串定位所属镜头。
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
    const shotMatch = selection.match(/镜头\s*\d+(?:\s*[-－—]\s*\d+)?/);
    if (matchedIds.size === 0 && shotMatch) {
        const selectedShotNo = parseHierarchicalShotNumber(shotMatch[0]);
        selectedFile.storyboard.items.forEach(item => {
            const itemShotNo = parseHierarchicalShotNumber(safeShotNumStr(item.shotNumber));
            const matches = selectedShotNo && itemShotNo
              && selectedShotNo.localShotNo === itemShotNo.localShotNo
              && (
                selectedShotNo.segmentNo === null
                || itemShotNo.segmentNo === null
                || selectedShotNo.segmentNo === itemShotNo.segmentNo
              );
            if (matches) {
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
            const shotMatches = [...beforeText.matchAll(/镜头\s*\d+(?:\s*[-－—]\s*\d+)?/g)];
            if (shotMatches.length > 0) {
                const lastMatch = shotMatches[shotMatches.length - 1];
                const selectedShotNo = parseHierarchicalShotNumber(lastMatch[0]);
                selectedFile.storyboard.items.forEach(item => {
                    const itemShotNo = parseHierarchicalShotNumber(safeShotNumStr(item.shotNumber));
                    const matches = selectedShotNo && itemShotNo
                      && selectedShotNo.localShotNo === itemShotNo.localShotNo
                      && (
                        selectedShotNo.segmentNo === null
                        || itemShotNo.segmentNo === null
                        || selectedShotNo.segmentNo === itemShotNo.segmentNo
                      );
                    if (matches) {
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
      // 双栏共用选中 ID；脚本栏和镜头栏分别监听它并滚动到对应位置。
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

    const adjacentItem = position > 0
      ? selectedFile.storyboard.items[position - 1]
      : selectedFile.storyboard.items[position];
    const newItem: StoryboardItem = {
      ...shotData,
      scriptSegmentId: shotData.scriptSegmentId || adjacentItem?.scriptSegmentId,
      id: uuidv4()
    };

    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard) return f;
      const newItems = [...f.storyboard.items];
      newItems.splice(position, 0, newItem);
      return {
        ...f,
        storyboard: {
          items: normalizeStoryboardItemsForWorkflow(newItems, f.scriptSegments || [])
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
        scriptSegmentId: prevItem?.scriptSegmentId || nextItem?.scriptSegmentId,
        id: uuidv4()
      };

      updateFileWithHistory(selectedFileId, (f) => {
        if (!f.storyboard) return f;
        const newItems = [...f.storyboard.items];
        newItems.splice(position, 0, newItem);
        return {
          ...f,
          storyboard: {
            items: normalizeStoryboardItemsForWorkflow(newItems, f.scriptSegments || [])
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

    // 兼容入口也统一使用“分段号-段内镜头号”。
    const renumberItem = (item: StoryboardItem, segmentNo: number, localShotNo: number): StoryboardItem => {
        const newShotId = formatHierarchicalShotNumber(segmentNo, localShotNo);
        const rewrittenOriginal = (item.originalText || '').replace(/^镜头\s*\d+(?:\s*[-－—]\s*\d+)?/, newShotId);
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
                        const baseIdx = parsedItems.length;
                        const newItems = completedBlocks.map((block, idx) =>
                            renumberItem(convertToStoryboardItem(block), segmentIndex + 1, baseIdx + idx + 1)
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
                            const baseIdx = parsedItems.length;
                            const finalItems = completedBlocks.map((block, idx) =>
                                renumberItem(convertToStoryboardItem(block), segmentIndex + 1, baseIdx + idx + 1)
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
                    const m = text.match(/<<<CONTINUE_FROM\s+(镜头\d+(?:-\d+)?)>>>/);
                    return m ? m[1] : null;
                };
                // 🔧 Bug 6 修复：续写循环失控会导致 92 个镜头被生成成 450 个（4-5x 重复）。
                // 三层硬约束（不依赖 AI 自觉判断"已完成"）：
                // 1) 续写零产出 break：本轮续写没产出任何新有效镜头 → AI 在重复或没东西可写 → break
                // 2) MAX 为 3：避免错误的 CONTINUE_FROM 造成无限续写。
                // 镜头数量由本轮模型结果决定，不再用输入或上一版镜头数截断。
                const MAX_CONTINUATIONS_PER_SEGMENT = 3;
                let continuationCount = 0;
                let nextShotId = detectContinueMarker(fullAccumulatedScript);
                while (nextShotId && continuationCount < MAX_CONTINUATIONS_PER_SEGMENT) {
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

                    // 本轮续写没产出新镜头 → AI 没东西可写 → 立即停
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

                // 过滤后可能有编号空洞，按当前分段重新连续编号。
                parsedItems = parsedItems.map((item, idx) =>
                    renumberItem(item, segmentIndex + 1, idx + 1)
                );

                // 🚫 不再做基于 shotNumber 的跨段去重 ——
                // 原逻辑会误判：每段 AI 都从 镜头01 开始编号，导致第 2/3/... 段被全部清空。
                // 现在通过全局重编号已彻底避免编号冲突，无需去重。

                // 追加到全局结果
                allParsedItems = [...allParsedItems, ...parsedItems];
                allDisplayText += displayText + '\n\n';

                console.log(`✅ 第 ${segmentIndex + 1} 段完成: ${parsedItems.length} 个镜头，累计: ${allParsedItems.length} 个`);
            }

            // 只保留防御无限续写的异常上限，不按输入或上一版镜头数量截断正常结果。
            if (totalShots === 0) {
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
    setFiles(prev => {
      const next = prev.map(f => {
        if (f.id !== fileId) return f;
        const stages = { ...(f.generationStages || {}) };
        stages[stage] = { status: 'idle', ...(stages[stage] || {}), ...patch, updatedAt: Date.now() };
        return { ...f, generationStages: stages };
      });
      filesRef.current = next;
      return next;
    });
  }, []);

  /** Stage 1：拆分剧本 */
  const handleSplitScript = useCallback(async (targetFileId?: string) => {
    // 🔧 通过 filesRef 读取，链式 pipeline 同一异步内可见上一阶段 setFiles 的结果
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return false;
    if (!file.originalContent?.trim()) { alert('请先在左栏粘贴原文文案'); return false; }

    setStage(file.id, 'split', { status: 'running', errorMessage: '' });
    try {
      const pipelineService = await loadScriptThreeStageService();
      const segments = await pipelineService.splitScriptIntoValidatedSegments(aiModel, file.originalContent, {
        taskContext: {
          projectId: urlProjectId,
          episodeId: propEpisodeId,
          sourcePage: 'script',
          sourceItemId: file.id,
          entityType: 'episode_script',
          entityId: file.id,
        },
        onProgress: progress => {
          if (progress.stage === 'split') {
            setStage(file.id, 'split', {
              status: 'running',
              total: progress.total,
              completed: progress.completed,
              errorMessage: '',
            });
          }
        },
      });
      if (segments.length === 0) {
        throw new Error('模型未返回可用的剧本分段');
      }
      const now = Date.now();
      const applySegs = (arr: ProjectFile[]) => arr.map(f => {
        if (f.id !== file.id) return f;
        return {
          ...f,
          scriptSegments: segments.map(segment => ({
            ...segment,
            videoScript: '',
            status: 'done' as const,
            errorMessage: '',
          })),
          generationStages: {
            ...(f.generationStages || {}),
            split: { status: 'done', total: segments.length, completed: segments.length, updatedAt: now },
            videoScript: { status: 'idle', total: segments.length, completed: 0, errorMessage: '', updatedAt: now },
            storyboardPrompt: { status: 'idle', total: 0, completed: 0, errorMessage: '', updatedAt: now },
          },
        };
      });
      setFiles(applySegs);
      filesRef.current = applySegs(filesRef.current); // 同步镜像，供下一阶段立即读取
      setStage(file.id, 'split', { status: 'done', total: segments.length, completed: segments.length });
      await batchSaveScriptSegments(propEpisodeId, file.id, segments.map((s, idx) => ({
        segment_order: idx, source_text: s.sourceText,
        estimated_duration_sec: s.estimatedDurationSec, status: 'done',
      }))).catch(e => console.warn('保存分段失败:', e));
      return true;
    } catch (e) {
      setStage(file.id, 'split', { status: 'error', errorMessage: (e as Error).message });
      throw e;
    }
  }, [selectedFileId, aiModel, propEpisodeId, setStage, urlProjectId]);

  /** Stage 2：基于当前拆分结果生成正式分镜脚本版本 */
  const handleGenerateVideoScript = useCallback(async (targetFileId?: string) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return false;
    const segs = file.scriptSegments || [];
    if (segs.length === 0) { alert('请先拆分剧本'); return false; }

    const ordered = [...segs].sort((a, b) => a.order - b.order);
    const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
    const requestId = `quick_video_script_${uuidv4()}`;
    const forecastInputText = [
      file.originalContent,
      ordered.map(segment => [
        segment.sourceText,
        segment.estimatedDurationSec === null ? '' : `时长：${segment.estimatedDurationSec}秒`,
      ].filter(Boolean).join('\n')).join('\n---\n'),
    ].join('\n\n');
    let estimatedCreditCost = 0;
    try {
      const creditQuote = await assertEnoughCredits('script_model_call', {
        input_tokens: estimateTextTokens(forecastInputText),
        output_tokens: Math.max(1000, estimateTextTokens(file.originalContent) * 3, ordered.length * 700),
        model: modelInfo.billingModel,
      });
      estimatedCreditCost = Number(creditQuote.estimated_cost || 0);
    } catch (error) {
      alert(error instanceof Error ? error.message : '积分校验失败');
      return false;
    }

    setStage(file.id, 'videoScript', { status: 'running', total: segs.length, completed: 0, errorMessage: '' });
    try {
      const pipelineService = await loadScriptThreeStageService();
      const result = await pipelineService.generateVideoScriptForSegments(
        aiModel,
        file.originalContent,
        ordered,
        {
          taskContext: {
            projectId: urlProjectId,
            episodeId: propEpisodeId,
            sourcePage: 'script',
            sourceItemId: file.id,
            entityType: 'episode_script',
            entityId: file.id,
          },
          onProgress: progress => {
            if (progress.stage === 'videoScript') {
              setStage(file.id, 'videoScript', { status: 'running', total: progress.total, completed: progress.completed });
            }
          },
        },
      );
      const fullScript = normalizeGeneratedVideoScript(result.content);
      const parsedItems = parseStoryboardVersionContent(fullScript);
      const billingParams = {
        input_tokens: estimateTextTokens(result.inputTexts.join('\n')),
        output_tokens: estimateTextTokens(result.outputTexts.join('\n') || fullScript),
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'script_model_call',
        taskId: requestId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: {
          episode_id: propEpisodeId,
          script_id: file.id,
          operation: 'quick_video_script',
        },
      });
      const metadata = {
        requestId,
        estimatedCreditCost,
        creditCharged: true,
        creditCost: Number(credit.charged_credits || 0),
        creditTransactionId: credit.transaction_id,
        creditFeatureKey: credit.feature_key,
        creditUsage: billingParams,
        scriptPipeline: {
          version: 3,
          mode: 'quick',
          stage: 'videoScript',
          shotNumberFormat: 'segment-local',
          sourceSegmentCount: ordered.length,
        },
      };
      const message = await createScriptMessage(propEpisodeId, file.id, {
        role: 'assistant',
        content: fullScript,
        status: 'completed',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        requestId,
        metadata,
      });
      const draftVersion = await createScriptVersion(propEpisodeId, file.id, {
        messageId: message.id,
        content: fullScript,
        storyboardItems: parsedItems,
        source: 'ai',
        status: 'ready',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        metadata,
        setCurrent: false,
      });
      await clearActiveStoryboardDesign(file.id, {
        archiveName: `自动历史 · 生成分镜脚本 V${draftVersion.versionNo} 前 · ${new Date().toLocaleString('zh-CN')}`,
        versionId: draftVersion.id,
      });
      const selectedVersion = await selectScriptVersion(propEpisodeId, file.id, draftVersion.id);
      const updated = result.segments.map(segment => ({
        ...segment,
        status: 'done' as const,
        errorMessage: '',
      }));
      const applyDone = (arr: ProjectFile[]) => arr.map(f => f.id === file.id
        ? {
            ...f,
            scriptSegments: updated,
            scriptContent: fullScript,
            storyboard: null,
            status: FileStatus.Completed,
            lastUpdated: Date.now(),
          }
        : f);
      setFiles(applyDone);
      filesRef.current = applyDone(filesRef.current); // 同步镜像，供 Stage3 立即读取
      setScriptConversations(prev => {
        const current = prev[file.id] || { scriptId: file.id, messages: [], versions: [] };
        return {
          ...prev,
          [file.id]: {
            ...current,
            currentVersionId: selectedVersion.id,
            defaultModel: modelInfo.billingModel,
            messages: [...current.messages.filter(item => item.id !== message.id), message],
            versions: [...current.versions.filter(item => item.id !== selectedVersion.id), selectedVersion],
          },
        };
      });
      setQuickSelectedVersionIds(prev => ({ ...prev, [file.id]: selectedVersion.id }));
      setStage(file.id, 'videoScript', { status: 'done', total: updated.length, completed: updated.length });
      await updateEpisodeScriptById(propEpisodeId, file.id, { adapted_script: fullScript }).catch(() => {});
      await batchSaveScriptSegments(propEpisodeId, file.id, buildScriptSegmentPayload(updated)).catch(() => {});
      return selectedVersion;
    } catch (e) {
      const errorSummary = summarizePipelineError(e);
      setStage(file.id, 'videoScript', { status: 'error', errorMessage: errorSummary });
      throw new Error(errorSummary);
    }
  }, [
    aiModel,
    clearActiveStoryboardDesign,
    propEpisodeId,
    scriptModelOptions,
    selectedFileId,
    setStage,
    urlProjectId,
  ]);

  /** Stage 3：基于当前分镜脚本版本生成镜头设计 */
  const handleExtractStoryboardPrompts = useCallback(async (
    targetFileId?: string,
    options: { sourceVersion?: ScriptStoryboardVersion } = {},
  ) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return false;
    const segs = (file.scriptSegments || []).filter(s => s.videoScript);
    if (segs.length === 0) { alert('请先生成视频脚本'); return false; }
    const conversation = mergeScriptConversationWithLocalFile(file, scriptConversations[file.id]);
    const sourceVersion = options.sourceVersion
      || conversation?.versions.find(version => version.id === conversation.currentVersionId)
      || conversation?.versions[conversation.versions.length - 1];
    const videoScript = sourceVersion?.content || file.scriptContent || combineVideoScriptOutputs(segs.map(segment => segment.videoScript || ''));
    if (!videoScript.trim()) { alert('请先生成视频脚本'); return false; }

    const groups = parseVideoScriptGroups(videoScript);
    const sourceShotCount = groups.reduce((total, group) => total + group.blocks.length, 0);
    if (sourceShotCount === 0) { alert('未能从视频脚本解析出分镜'); return false; }

    const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
    const billingTaskId = `storyboard_design_${uuidv4()}`;
    try {
      await assertEnoughCredits('storyboard_design_generation', {
        shot_count: sourceShotCount,
        input_tokens: estimateTextTokens(videoScript),
        output_tokens: Math.max(500, sourceShotCount * 500),
        model: modelInfo.billingModel,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : '积分校验失败');
      return false;
    }

    setStage(file.id, 'storyboardPrompt', { status: 'running', total: sourceShotCount, completed: 0, errorMessage: '' });
    try {
      const pipelineService = await loadScriptThreeStageService();
      const designResult = await pipelineService.generateStoryboardDesignForVersion(
        aiModel,
        videoScript,
        {
          taskContext: {
            projectId: urlProjectId,
            episodeId: propEpisodeId,
            sourcePage: 'script',
            sourceItemId: file.id,
            entityType: sourceVersion ? 'episode_script_version' : 'episode_script',
            entityId: sourceVersion?.id || file.id,
          },
          onProgress: progress => {
            setStage(file.id, 'storyboardPrompt', {
              status: 'running',
              total: progress.total,
              completed: progress.completed,
            });
          },
        },
      );
      const persistedItems = await replaceActiveStoryboardDesign(
        file.id,
        designResult.items,
        {
          archiveName: sourceVersion
            ? `自动历史 · 生成分镜脚本 V${sourceVersion.versionNo} 镜头设计前 · ${new Date().toLocaleString('zh-CN')}`
            : `自动历史 · 生成镜头设计前 · ${new Date().toLocaleString('zh-CN')}`,
          versionId: sourceVersion?.id,
          openDrawer: false,
        },
      );
      if (sourceVersion && !sourceVersion.id.startsWith('legacy_')) {
        setScriptConversations(prev => prev[file.id] ? ({
          ...prev,
          [file.id]: { ...prev[file.id], currentVersionId: sourceVersion.id },
        }) : prev);
        setQuickSelectedVersionIds(prev => ({ ...prev, [file.id]: sourceVersion.id }));
      }
      try {
        await persistStoryboardSnapshot(file.id, {
          source: 'auto',
          version: sourceVersion,
          name: sourceVersion
            ? `自动存档 · 分镜脚本 V${sourceVersion.versionNo} · ${new Date().toLocaleString('zh-CN')}`
            : `自动存档 · 快速版镜头设计 · ${new Date().toLocaleString('zh-CN')}`,
        });
      } catch (snapshotError) {
        console.error('自动保存镜头设计失败:', snapshotError);
        throw new Error(`镜头设计已生成，但自动存档失败：${summarizePipelineError(snapshotError)}`);
      }

      const billingParams = {
        shot_count: persistedItems.length,
        input_tokens: estimateTextTokens(designResult.inputTexts.join('\n')),
        output_tokens: estimateTextTokens(designResult.outputTexts.join('\n')),
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'storyboard_design_generation',
        taskId: billingTaskId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: {
          episode_id: propEpisodeId,
          script_id: file.id,
          script_version_id: sourceVersion?.id,
          operation: 'quick_extract_storyboard_design',
        },
      });
      if (sourceVersion && !sourceVersion.id.startsWith('legacy_')) {
        const previousBillings = Array.isArray(sourceVersion.metadata?.storyboardDesignBillings)
          ? sourceVersion.metadata.storyboardDesignBillings
          : [];
        const updatedVersion = await updateScriptVersionMetadata(propEpisodeId, file.id, sourceVersion.id, {
          storyboardDesignCreditCost: credit.charged_credits,
          storyboardDesignCreditTransactionId: credit.transaction_id,
          storyboardDesignCreditTaskId: billingTaskId,
          storyboardDesignUsage: billingParams,
          storyboardDesignGeneratedAt: Date.now(),
          storyboardDesignBillings: [
            ...previousBillings,
            { taskId: billingTaskId, cost: credit.charged_credits, usage: billingParams, createdAt: Date.now() },
          ].slice(-20),
        });
        setScriptConversations(prev => prev[file.id] ? ({
          ...prev,
          [file.id]: {
            ...prev[file.id],
            versions: prev[file.id].versions.map(version => version.id === updatedVersion.id ? updatedVersion : version),
          },
        }) : prev);
      }
      setStage(file.id, 'storyboardPrompt', { status: 'done', total: sourceShotCount, completed: sourceShotCount });
      window.alert(`生成镜头设计完成，已拆为 ${persistedItems.length} 个镜头`);
      return true;
    } catch (shotErr) {
      const errorSummary = summarizePipelineError(shotErr);
      setStage(file.id, 'storyboardPrompt', { status: 'error', errorMessage: errorSummary });
      setConversationError(`生成镜头设计失败：${errorSummary}`);
      throw new Error(errorSummary);
    }
  }, [
    aiModel,
    persistStoryboardSnapshot,
    propEpisodeId,
    replaceActiveStoryboardDesign,
    scriptConversations,
    scriptModelOptions,
    selectedFileId,
    setStage,
    urlProjectId,
  ]);

  /** 主按钮：按三步顺序全量执行；再次点击会完整循环并归档旧版本 */
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
    const splitOk = await handleSplitScript(file.id);
    if (!splitOk) return;
    const videoScriptVersion = await handleGenerateVideoScript(file.id);
    if (!videoScriptVersion) return;
    await handleExtractStoryboardPrompts(file.id, { sourceVersion: videoScriptVersion });
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

    const billingTaskId = `storyboard_design_${uuidv4()}`;
    const forecastInputTokens = file.storyboard.items.reduce(
      (total, item) => total + estimateTextTokens(`${item.originalText || ''}\n${item.scriptSegment || ''}`),
      0,
    );
    const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
    try {
      await assertEnoughCredits('storyboard_design_generation', {
        shot_count: file.storyboard.items.length,
        input_tokens: forecastInputTokens,
        output_tokens: Math.max(500, file.storyboard.items.length * 500),
        model: modelInfo.billingModel,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : '积分校验失败');
      return;
    }

    setIsProcessing(true);
    setProcessingType('generate-shots'); // 🆕 标记为生成详细分镜
    setShotGenerationProgress({ current: 0, total: file.storyboard.items.length });

    try {
      const updatedItems: StoryboardItem[] = [];
      let billingSuccessfulShots = 0;
      let billingInputTokens = 0;
      let billingOutputTokens = 0;
      
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
          billingSuccessfulShots += 1;
          billingInputTokens += estimateTextTokens(`${item.originalText || ''}\n${item.scriptSegment || ''}`);
          billingOutputTokens += estimateTextTokens(JSON.stringify(details));
          
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
      if (billingSuccessfulShots === 0) {
        throw new Error('所有镜头详情均生成失败，本次未扣除积分');
      }
      const billingParams = {
        shot_count: billingSuccessfulShots,
        input_tokens: billingInputTokens,
        output_tokens: billingOutputTokens,
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'storyboard_design_generation',
        taskId: billingTaskId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: { episode_id: propEpisodeId, script_id: fileId, operation: 'generate_shot_details' },
      });
      const conversation = scriptConversations[fileId];
      const currentVersion = conversation?.versions.find(version => version.id === conversation.currentVersionId)
        || conversation?.versions[conversation.versions.length - 1];
      let snapshotVersion = currentVersion;
      if (currentVersion && !currentVersion.id.startsWith('legacy_')) {
        const previousBillings = Array.isArray(currentVersion.metadata?.storyboardDesignBillings)
          ? currentVersion.metadata.storyboardDesignBillings
          : [];
        const updatedVersion = await updateScriptVersionMetadata(propEpisodeId, fileId, currentVersion.id, {
          storyboardDesignCreditCost: credit.charged_credits,
          storyboardDesignCreditTransactionId: credit.transaction_id,
          storyboardDesignCreditTaskId: billingTaskId,
          storyboardDesignUsage: billingParams,
          storyboardDesignGeneratedAt: Date.now(),
          storyboardDesignBillings: [
            ...previousBillings,
            { taskId: billingTaskId, cost: credit.charged_credits, usage: billingParams, createdAt: Date.now() },
          ].slice(-20),
        });
        snapshotVersion = updatedVersion;
        setScriptConversations(prev => prev[fileId] ? ({
          ...prev,
          [fileId]: {
            ...prev[fileId],
            versions: prev[fileId].versions.map(version => version.id === updatedVersion.id ? updatedVersion : version),
          },
        }) : prev);
      }
      try {
        await persistStoryboardSnapshot(fileId, {
          source: 'auto',
          version: snapshotVersion,
          name: `自动存档 · 镜头详情 · ${new Date().toLocaleString('zh-CN')}`,
        });
      } catch (error) {
        console.error('自动保存镜头详情失败:', error);
        alert(`镜头详情已生成，但自动存档失败：${summarizePipelineError(error)}`);
      }
      
    } catch (error) {
      console.error('❌ 批量生成失败:', error);
      alert(`生成失败: ${(error as Error).message}`);
    } finally {
      setIsProcessing(false);
      setProcessingType(null); // 🆕 清空处理类型
      setShotGenerationProgress(null);
    }
  }, [aiModel, files, persistStoryboardSnapshot, propEpisodeId, scriptConversations, scriptModelOptions, updateFileWithHistory, urlProjectId]);

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
  const videoReverseToolDialog = videoReverseOpen ? (
    <div className="absolute inset-0 z-[90] bg-n900/45 p-3 sm:p-5" data-testid="video-reverse-tool-dialog">
      <div className="h-full w-full overflow-hidden rounded-md border border-n40 bg-n0 shadow-bottom">
        <React.Suspense fallback={<LegacyViewFallback label="video-reverse" />}>
          <VideoReversePage
            embedded
            onClose={() => setVideoReverseOpen(false)}
            onCandidateCreated={async (scriptId) => {
              setVideoReverseOpen(false);
              loadedConversationKeysRef.current.delete(`${propEpisodeId}:${scriptId}`);
              await loadEpisodeData(scriptId);
            }}
          />
        </React.Suspense>
      </div>
    </div>
  ) : null;

  const renderAllViews = () => {
      const adminUsername = localStorage.getItem('username') || '';
      const isAdmin = adminUsername === 'admin' || adminUsername === 'lllsdhr';
      return (
        <>
          {/* Editor - 懒挂载 + display 切换，永不卸载 */}
          {mountedViews.has(AppView.Editor) && (
            <div style={{ display: currentView === AppView.Editor ? 'contents' : 'none' }}>
              {scriptWorkspaceMode === 'writing' ? (
                <>
                <div className="workflow-stage-sidebar relative h-full w-[280px] flex-shrink-0 overflow-hidden border-r border-n40">
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

                <div className="workflow-stage-canvas relative flex h-full min-w-0 flex-1 overflow-hidden">
                    <React.Suspense fallback={<LegacyColumnFallback label="conversation" />}>
                    <ScriptConversationPane
                        selectedFile={selectedFile}
                        conversation={selectedConversation}
                        aiModel={aiModel}
                        modelOptions={scriptModelOptions}
                        onChangeModel={setAiModel}
                        isWorkflowScript={selectedFileId === activeScriptId}
                        isLoading={conversationLoadingId === selectedFileId}
                        isSending={conversationSendingId === selectedFileId}
                        error={conversationError}
                        onDismissError={() => setConversationError(null)}
                        onSend={handleConversationSend}
                        onGenerateDesign={handleConversationGenerateDesign}
                        onEditVersion={handleConversationEditVersion}
                        onExportVersion={handleConversationExportVersion}
                        onOpenStoryboard={handleOpenStoryboardDrawer}
                        onOpenVideoReverse={() => setVideoReverseOpen(true)}
                        storyboardItemCount={Math.max(
                          selectedStoryboardItemCount,
                          selectedFileId ? (storyboardTotalsByFileId[selectedFileId] ?? 0) : 0,
                        )}
                        workspaceMode={scriptWorkspaceMode}
                        onWorkspaceModeChange={handleScriptWorkspaceModeChange}
                    />
                    </React.Suspense>

                    <aside
                      className={`absolute inset-0 z-40 w-full overflow-x-auto overflow-y-hidden border-l border-n40 bg-n0 shadow-bottom transition-transform duration-200 ${storyboardDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
                      data-testid="storyboard-workspace-drawer"
                      aria-hidden={!storyboardDrawerOpen}
                    >
                    <div className="grid h-full min-h-0 min-w-[860px] grid-cols-[minmax(360px,1.2fr)_minmax(420px,1fr)] overflow-hidden">
                      <React.Suspense fallback={<LegacyColumnFallback label="storyboard-script" />}>
                        <StoryboardScriptColumn
                          selectedFile={selectedFile}
                          highlightedItemIds={highlightedStoryboardItemIds}
                          onSelectItemIds={handleStoryboardSelectionChange}
                        />
                      </React.Suspense>
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
                        generationCreditCost={Number(selectedConversationVersion?.metadata?.storyboardDesignCreditCost || 0)}
                        onRestoreScriptVersion={(version) => handleConversationGenerateDesign(version, { autoSnapshot: false })}
                      />
                      </React.Suspense>
                    </div>
                    </aside>

                    {videoReverseToolDialog}
                </div>
                </>
              ) : (
                <div
                  className="workflow-stage-layout relative flex h-full min-h-0 w-full min-w-0 overflow-hidden"
                  data-testid="quick-script-workspace"
                >
                  <div className="workflow-stage-sidebar relative h-full w-[280px] flex-shrink-0 overflow-hidden border-r border-n40">
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

                  <div
                    className="workflow-stage-canvas flex min-h-0 min-w-0 max-w-none flex-col overflow-hidden"
                    data-testid="quick-script-canvas"
                    style={{ width: 0, flex: '1 1 0%' }}
                  >
                    <header className="workflow-stage-toolbar flex h-11 flex-shrink-0 items-center gap-3 border-b border-n40 bg-n0 px-4">
                      <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
                      <div className="truncate text-sm font-semibold text-n800">
                        {selectedFile?.name || '请选择剧本任务'}
                      </div>
                      <ScriptWorkspaceModeSwitch
                        mode={scriptWorkspaceMode}
                        onChange={handleScriptWorkspaceModeChange}
                      />
                      <span className="ml-auto text-[10px] text-n200">
                        四列使用同一生成、版本、积分与镜头数据
                      </span>
                    </header>

                    <div className="min-h-0 w-full min-w-0 max-w-none flex-1 overflow-x-auto overflow-y-hidden">
                      <div
                        className="flex h-full w-full min-w-[900px] max-w-none overflow-hidden"
                        data-testid="quick-script-columns"
                      >

                      <div
                        style={{ flex: `${colWidths[1]} 0 0%` }}
                        className="relative h-full min-w-0 overflow-hidden"
                      >
                        <React.Suspense fallback={<LegacyColumnFallback label="source-script" />}>
                          <QuickScriptSourceColumn
                            selectedFile={selectedFile}
                            aiModel={aiModel}
                            modelOptions={scriptModelOptions}
                            isLoading={conversationLoadingId === selectedFileId}
                            isSending={conversationSendingId === selectedFileId}
                            error={conversationError}
                            onDismissError={() => setConversationError(null)}
                            onChangeModel={setAiModel}
                            onUpdateSource={handleUpdateContent}
                            onSplitScript={handleSplitScript}
                            onGenerateVideoScript={handleGenerateVideoScript}
                            onExtractStoryboardPrompts={handleExtractStoryboardPrompts}
                            onRunThreeStage={handleRunThreeStagePipeline}
                            onOpenVideoReverse={() => setVideoReverseOpen(true)}
                          />
                        </React.Suspense>
                      </div>

                      {isFullView && (
                        <div
                          onMouseDown={() => startResizing(1)}
                          className="z-20 w-1 flex-shrink-0 cursor-col-resize bg-n40 transition-colors hover:bg-primary"
                        />
                      )}

                      <div
                        style={{ flex: `${colWidths[2]} 0 0%` }}
                        className="relative h-full min-w-0 overflow-hidden"
                      >
                        <React.Suspense fallback={<LegacyColumnFallback label="video-script" />}>
                          <QuickScriptVersionColumn
                            selectedFile={selectedFile}
                            version={quickPipelineVersion}
                            versions={quickAvailableVersions}
                            currentVersionId={quickPipelineVersion?.id}
                            designItems={selectedFile?.storyboard?.items || []}
                            isSending={conversationSendingId === selectedFileId}
                            error={conversationError}
                            highlightedItemIds={highlightedStoryboardItemIds}
                            onDismissError={() => setConversationError(null)}
                            onSelectItemIds={handleStoryboardSelectionChange}
                            onSelectVersion={handleQuickSelectVersion}
                            onEditVersion={handleConversationEditVersion}
                            onGenerateDesign={(version) => handleConversationGenerateDesign(version, { openDrawer: false })}
                            onExportVersion={handleConversationExportVersion}
                          />
                        </React.Suspense>
                      </div>

                      {isFullView && (
                        <div
                          onMouseDown={() => startResizing(2)}
                          className="z-20 w-1 flex-shrink-0 cursor-col-resize bg-n40 transition-colors hover:bg-primary"
                        />
                      )}

                      <div
                        style={{ flex: `${colWidths[3]} 0 0%` }}
                        className="relative h-full min-w-0 overflow-hidden"
                      >
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
                            generationCreditCost={Number(selectedConversationVersion?.metadata?.storyboardDesignCreditCost || 0)}
                            onRestoreScriptVersion={(version) => handleConversationGenerateDesign(
                              version,
                              { autoSnapshot: false, openDrawer: false },
                            )}
                          />
                        </React.Suspense>
                      </div>
                    </div>
                  </div>
                  </div>
                  {videoReverseToolDialog}
                </div>
              )}
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
    <div className={`layout-safe flex w-full min-w-0 flex-col ${hideHeader ? 'h-full flex-1' : 'h-screen'} overflow-hidden bg-n20 text-n800 font-sans`}>
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
          modelOptions={scriptModelOptions}
          onChangeModel={setAiModel}
          notifications={taskNotifications}
          onDismissNotification={dismissTaskNotification}
        />
      )}
      
      <main className={`workspace-main relative flex-1 min-w-0 overflow-hidden ${currentView === AppView.Admin ? 'flex' : 'flex'}`} ref={containerRef}>
         <div className="workspace-view-frame flex h-full w-full min-w-0 flex-1 overflow-hidden">
         {renderAllViews()}
         </div>
      </main>
    </div>
  );
};

export default WorkspaceApp;
