

export enum FileStatus {
  Idle = 'Idle',
  Processing = 'Processing',
  Completed = 'Completed',
  Error = 'Error'
}

export interface GeneratedImage {
  id: string;
  url: string; // Base64 原图
  thumbnail?: string; // Base64 缩略图（200x200，质量0.7）
  timestamp: number;
  isLocal?: boolean; // 是否为本地上传
  /** 统一文件服务返回的实体文件 ID（ComfyUI 等异步任务） */
  fileId?: string | null;
  isSelected?: boolean;
}

export interface StoryboardItem {
  id: string;
  shotNumber?: string | number; // 镜头编号（如 "镜头01" 或 1）
  duration?: string; // 🆕 时长（如 "4秒"）
  
  // 🔧 第一阶段：提取分镜（必需）
  originalText: string; // 对应的原文段落（从剧本中直接复制，用于高亮匹配）
  scriptSegment: string; // AI提炼的场景描述（简洁的场景和动作描述）
  
  // 🎨 第二阶段：生成镜头详情（可选，后续AI补充）
  imagePrompt?: string; // 图像生成提示词（中文，适合图像镜头语言）
  videoPrompt?: string; // 视频生成提示词（中文，描述镜头运动和画面）
  dialogue?: string; // 人物台词（如果有）
  characters?: string[]; // 出现的角色列表
  scene?: string; // 场景位置
  props?: string[]; // 道具列表（手持物、武器、关键陈设等；服装归人物）
  cameraMovement?: string; // 运镜/景别/角度组合描述（保存路径读取，写入 camera_movement）
  plannedDurationMs?: number | null; // 计划时长（毫秒），写入 planned_duration_ms
  
  // 🔒 控制字段
  isLocked?: boolean; // 防止重新生成
  isPlaceholder?: boolean; // 占位符（删除但脚本存在）
  
  // 🎭 素材绑定
  boundCharNames?: string[];
  boundSceneName?: string;
  boundPropNames?: string[];
  materialSelections?: Record<string, string>; // 标签名 → 素材ID映射
  
  // 📸 生成数据
  generatedImages?: GeneratedImage[]; // 多个生成结果
  selectedImageId?: string; // 选中用于导出的结果ID
  isConfigConfirmed?: boolean; // 用户确认了提示词/参考
  configuredReferences?: GenerationReference[]; // 🆕 确认配置时保存的参考图片
  
  // ⏱️ 元数据
  timestamp?: number; // 生成时间戳
  
  // 🆕 追加来源信息
  sourceFileId?: string; // 追加来源文件ID（如果是从其他文件追加的）
  sourceFileName?: string; // 追加来源文件名
  
  // 🆕 2026-05-29 三步生成链路字段
  scriptSegmentId?: string;     // 来自哪个剧本分段 → storyboard_items.script_segment_id
  sourceVideoShotNo?: string;   // Stage 2 镜头号 → source_video_shot_no
  videoScriptBlock?: string;    // Stage 2 单镜头完整视频脚本块 → video_script_block
  shotSize?: string;            // Stage 3 景别 → shot_size
  cameraAngle?: string;         // Stage 3 拍摄角度 → camera_angle

  // 🔙 向后兼容（废弃）
  generatedImage?: string; 
}

export interface StoryboardData {
  items: StoryboardItem[];
}

// 🆕 2026-05-29 三步生成相关类型

export type ScriptStageStatus = 'idle' | 'running' | 'done' | 'error';

export interface ScriptGenerationStageState {
  status: ScriptStageStatus;
  total?: number;
  completed?: number;
  errorMessage?: string;
  updatedAt?: number;
}

export interface ScriptSegment {
  id: string;
  order: number;
  sourceText: string;
  estimatedDurationSec: number | null;
  videoScript?: string;
  status?: 'pending' | 'running' | 'done' | 'error';
  errorMessage?: string;
}

/** parseVideoScriptBlocks 输出：Stage 2 视频脚本里的单个镜头块 */
export interface VideoScriptBlock {
  shotNo: string;            // 规范化为 "镜头1"
  durationSec: number | null;
  rawBlock: string;          // 该镜头完整文本块
}

/** parseStoryboardPromptExtractions 输出元素：Stage 3 单个「镜头号」块的提取结果 */
export interface ExtractedStoryboardPrompt {
  shotNo: string;            // "镜头1"
  shotSize: string;          // 景别
  sceneDescription: string;  // 画面描述
  characters: string[];      // 人物（按 、，/ 切分；"无" → []）
  scene: string;             // 场景（"无" → ''）
  props: string[];           // 道具（按 、，/ 切分；"无" → []）
  imagePrompt: string;       // 分镜生成提示词
  cameraAngle: string;       // 拍摄角度
  cameraMove: string;        // 运镜方式
  dialogue: string;          // 台词（"无" → ''）
  durationSec: number | null;
}

export interface FileVersion {
  id: string;
  timestamp: number;
  name: string;
  data: Omit<ProjectFile, 'id' | 'versions' | 'status'>; // Store content snapshot
}

export interface ProjectFile {
  id: string;
  name: string;
  originalContent: string;
  scriptContent: string | null;
  storyboard: StoryboardData | null;
  extractedCharacters: string[];
  extractedScenes: string[];
  extractedProps?: string[];
  status: FileStatus;
  lastUpdated: number;
  versions: FileVersion[];
  // 🆕 2026-05-29 三步生成运行态（持久化以 API segments/storyboard rows 为准）
  scriptSegments?: ScriptSegment[];
  generationStages?: {
    split?: ScriptGenerationStageState;
    videoScript?: ScriptGenerationStageState;
    storyboardPrompt?: ScriptGenerationStageState;
  };
}

export interface GeminiResponse<T> {
  data: T | null;
  error?: string;
}

export interface RestructureResponse {
  newScriptSegment: string;
  newStoryboardItems: Omit<StoryboardItem, 'id'>[];
}

// --- New Types for Material Binding ---

export enum AppView {
  ProjectHub = 'ProjectHub',
  EpisodeHub = 'EpisodeHub',
  Editor = 'Editor',
  Design = 'Design',
  Materials = 'Materials',
  AudioStage = 'AudioStage',
  Generation = 'Generation',
  Video = 'Video',
  Enhance = 'Enhance',
  PostProcess = 'PostProcess',
  History = 'History',
  Canvas = 'Canvas',
  Admin = 'Admin'
}

export enum AiModel {
  Gemini = 'gemini',
  Deepseek = 'deepseek',
  DeepseekChat = 'deepseek-chat'
}

export interface Material {
  id: string;
  url: string; // Blob URL or Base64
  thumbnail?: string; // 缩略图
  type: 'image';
  source: 'upload' | 'ai';
  timestamp: number;
}

// Key is the tag name (e.g., "Main Character", "Living Room")
export type MaterialLibrary = Record<string, Material[]>;

export type ReferenceType = 'character' | 'scene' | 'pose' | 'prop' | 'effect';

export interface GenerationReference {
  id: string;
  url: string;
  type: ReferenceType;
  name?: string; // Optional tag name
}

// --- Admin Types ---

export interface UserPermissions {
  allowedModels: string[];
  priority: 'low' | 'normal' | 'high';
  canExport: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  isOnline: boolean;
  lastLogin: number;
  permissions: UserPermissions;
  stats: {
    todayCount: number;
    totalCount: number;
    byModel: Record<string, number>;
  };
}

export interface GenerationLog {
  id: string;
  userId: string;
  username: string;
  timestamp: number;
  type: 'text' | 'image' | 'video';
  model: string;
  status: 'success' | 'failed';
  prompt: string;
  params: string;
  executionTimeMs: number;
  queueTimeMs: number;
  resultPreview?: string;   // 图片预览URL
  resultVideo?: string;     // 视频URL
  resultText?: string;      // 文本生成结果
}

export interface ServerNode {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'maintenance';
  ip: string;
  storageUsed: number;
  storageTotal: number;
  gpuUsage: number;
  sshConfig?: {
    host: string;
    port: number;
    user: string;
    keyPath: string;
    password?: string;
  };
}

// =============================================
// 项目管理相关类型
// =============================================

export type ProjectRole = 'owner' | 'admin' | 'member' | 'readonly';

export type Responsibility = 'text' | 'materials' | 'generation' | 'video' | 'all';

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  role: ProjectRole;
  responsibility: Responsibility;
  joinedAt: number;
}

export interface ProjectInfo {
  projectId: string;
  projectName: string;
  description: string;
  coverUrl?: string;
  tags: string[];
  ownerId: string;
  ownerName: string;
  memberCount: number;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt?: number;
  episodeCount?: number;
  /** 2026-05-26 组织管理 MVP */
  memberRole?: string;
  visibility?: 'private' | 'org-default' | string;
  groupId?: string | null;
}

export interface Episode {
  episodeId: string;
  projectId: string;
  episodeNumber: number;
  episodeName: string;
  description: string;
  status: 'draft' | 'in_progress' | 'completed' | 'published';
  settings: Record<string, any>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// =============================================
// 全局任务管理相关类型
// =============================================

export type TaskCategory = 'api_text' | 'api_image' | 'api_video' | 'comfyui';

export type GlobalTaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

// 2026-05-20 (Task System Overhaul M0)：扩展枚举覆盖 workflow 7 个页面 + 兼容旧值。
// 'pending' 状态新增（注册了但未提交后端时；提交后转 queued/running）。
export type SourcePage =
  | 'editor'        // 旧 WorkspaceApp 剧本视图
  | 'script'        // 新 workflow 剧本页
  | 'design'        // 新 workflow 设计页（人物/场景/道具）
  | 'materials'     // 素材绑定页
  | 'audio'         // 配音页
  | 'storyboard'    // 分镜画面页（新 workflow GenerationPage）
  | 'generation'    // 旧 WorkspaceApp 画面分镜视图（保留）
  | 'video'         // 视频生成页
  | 'enhance'       // 视频增强页
  | 'postprocess'   // 后处理页
  | 'canvas'        // 无限画布页
  | 'history'       // 历史页
  | 'media-library' // 2026-05-26 Slice 1：通用素材库
  | 'final'         // 2026-06-14：成品页（汇总展示合成好的整片）
  | 'video-reverse' // 2026-05-26 Slice 3：视频反推工作台
  | 'global';       // 跨页/未指定

// 2026-05-20 (Task System Overhaul M0)：细粒度任务类型，用于 UI 显示 + 路由 + 图标选择。
// 与 TaskCategory 互补：Category 是后端粗分类，Kind 是前端展示分类。
export type TaskKind =
  // 视频生成
  | 'seedance' | 'seedance-fast'
  | 'wan2' | 'wan2-fast'
  | 'kling' | 'vidu' | 'happyhorse'
  | 'sora2' | 'veo'
  | 'video-i2v' | 'video-comfy'
  // 图片生成
  | 'comfyui-image'
  | 'gemini-image' | 'doubao-image'
  | 'nanobanana' | 'qwen-image' | 'qwen-lora' | 'kontext'
  // 图片加工
  | 'matting' | 'angle-adjust'
  | 'human-multi-angle' | 'around-angle'
  | 'image-fusion' | 'panorama-360' | 'panorama-fusion'
  | 'auto-storyboard' | 'multi-grid-storyboard'
  // 音频
  | 'minimax-tts' | 'gemini-tts' | 'audio-mix'
  // 视频后处理
  | 'video-enhance' | 'video-upscale'
  | 'video-voice' | 'video-edit' | 'video-crop'
  // 文本
  | 'prompt-rewrite' | 'script-segment'
  | 'other';

/**
 * 2026-05-20 (Task System Overhaul M0)：上层任务注册项。
 *
 * 由 services/taskRegistry.ts 管理，所有页面提交生成请求时调用 register；
 * page 卸载后任务仍在 store 内继续被全局 poller 推进；完成时 onComplete callback
 * 触发 + UI 通知中心更新。
 */
export interface RegisteredTask {
  /** 后端任务 id（comfyui taskId / seedance taskId / 等） */
  taskId: string;
  /** 细粒度类型，用于 UI 图标 + 显示 */
  kind: TaskKind;
  /** 用户可读的标题，例如 "视频生成 镜头3 (Seedance)" */
  title: string;
  status: GlobalTaskStatus;
  /** 0-1 区间，未知则缺省 */
  progress?: number;
  /** 排队中前面还有 N 个（M6 显示用） */
  queuePosition?: number;
  /** 注册时刻（ms epoch） */
  createdAt: number;
  /** 后端实际开始执行时刻 */
  startedAt?: number;
  /** 完成/失败时刻 */
  completedAt?: number;
  /** 完成后跳转到哪个页面（点 Toast/铃铛时使用） */
  targetPage: SourcePage;
  /** 业务实体类型（'storyboard_item' | 'asset' | 'video_segment' | ...） */
  targetEntityType?: string;
  /** 业务实体 id */
  targetEntityId?: string;
  /** 用于回页面定位 + 高亮（通常 = storyboard item id） */
  targetItemId?: string;
  /** 项目 id */
  targetProjectId?: string;
  /** 剧集 id（用于 navigation 拼 URL） */
  episodeId?: string;
  /** 文件角色（'generated_image' | 'narration_audio' | 'dialogue_audio' | ...） */
  fileRole?: string;
  /** 错误消息（status === 'failed' 时填充） */
  error?: string;
  /** 完成时的产物 URL 数组（图/视频/音频） */
  resultUrls?: string[];
  /**
   * 2026-05-20 (Task System Overhaul Phase 8)：运行时辅助元数据。
   * SSE / 轮询推送的非业务字段都塞这里 — 阶段名 (stage)、step/totalSteps、etaSeconds、
   * workerNodeId、modelName 等。UI 仅做富展示，不进入业务判定。
   * **`taskRegistry.update` 收到此字段时做浅合并**（不覆盖已有 key），由 registry 内部处理。
   */
  metadata?: Record<string, unknown>;
}

export interface GlobalTask {
  id: string;
  category: TaskCategory;
  status: GlobalTaskStatus;
  displayName: string;
  projectId: string;
  sourcePage: SourcePage;
  sourceItemId?: string;
  progress: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
}

// 🆕 全局任务通知
export interface TaskNotification {
  id: string;
  type: 'video' | 'image' | 'material' | 'text';
  status: 'running' | 'completed' | 'failed';
  message: string;
  targetView: AppView;
  targetProjectId?: string;
  targetPage?: SourcePage;
  targetItemId?: string;
  timestamp: number;
  taskId?: string;
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  episodeId?: string;
}

// =============================================
// 无限画布相关类型
// =============================================

export type CanvasNodeType = 'text' | 'image' | 'video' | 'storyboard' | 'prompt' | 'group';

export interface CanvasNode {
  id: string;
  boardId: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Record<string, any>;
  zIndex: number;
  isLocked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasConnection {
  id: string;
  boardId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string;
  targetPort?: string;
  label?: string;
}

export interface CanvasBoard {
  id: string;
  projectId: string;
  episodeId?: string;
  name: string;
  description?: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  createdAt: number;
  updatedAt: number;
}

// =============================================
// UI 重构新增类型
// =============================================

export interface AssetItem {
  assetId: string;
  projectId: string;
  episodeId: string | null;
  scriptId?: string | null;
  assetType: 'character' | 'scene' | 'prop';
  name: string;
  description: string;
  thumbnailUrl: string | null;
  referenceImages: string[];
  styleParams: Record<string, any>;
  tags: string[];
  createdBy: string;
  createdAt: string;
  entityFiles?: Array<{
    fileId: string;
    fileUrl: string;
    fileType: string;
    fileRole: string;
    isSelected: boolean;
    createdAt: string;
  }>;
}

export interface StoryboardItemDB {
  itemId: string;
  episodeId: string;
  sortOrder: number;
  sceneHeading: string;
  actionText: string;
  dialogue: string;
  cameraMovement: string;
  imagePrompt: string;
  videoPrompt: string;
  generatedImageUrl: string | null;
  boundAssets: string[];
  status: string;
  dialogueAudioUrl: string | null;
  narrationAudioUrl: string | null;
  sfxAudioUrl: string | null;
  mixedAudioUrl?: string | null;
  audioDurationMs: number | null;
  plannedDurationMs: number | null;
}

export interface VideoSegment {
  segmentId: string;
  episodeId: string;
  storyboardItemId: string | null;
  sortOrder: number;
  generationMode: string;
  model: string;
  inputParams: Record<string, any>;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  taskId: string | null;
  status: string;
}

export interface AudioTrack {
  trackId: string;
  episodeId: string;
  trackType: 'bgm' | 'sfx_global' | 'narration_global';
  name: string;
  audioUrl: string | null;
  durationMs: number | null;
  startItemId: string | null;
  endItemId: string | null;
  generationParams: Record<string, any>;
}

export interface EpisodeScript {
  scriptId: string;
  episodeId: string;
  originalContent: string;
  adaptedScript: string;
  metadata: Record<string, any>;
}

export interface TimelineTrack {
  trackId: string;
  episodeId: string;
  trackType: 'video' | 'audio' | 'subtitle';
  trackName: string;
  sortOrder: number;
  items: any[];
}

export interface CharacterVoice {
  voiceId: string;
  projectId: string;
  assetId: string | null;
  characterName: string;
  voiceProvider: string | null;
  voiceModelId: string | null;
  voiceName: string | null;
  voiceParams: Record<string, any>;
  sampleAudioUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoVoiceReference {
  referenceId: string;
  projectId: string;
  episodeId: string | null;
  storyboardItemId: string | null;
  videoSegmentId: string | null;
  characterName: string;
  sourceVideoUrl: string;
  referenceAudioUrl: string;
  videoModel: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

// MiniMax Audio types

export type VoiceSourceType = 'system' | 'clone' | 'design';

export interface VoiceDesignSetting {
  voice_type: 'male' | 'female';
  emotion: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
  speed: number;
  pitch: number;
}

export interface AudioClipInfo {
  itemId: string;
  sortOrder: number;
  type: 'narration' | 'dialogue';
  text: string;
  characterName: string;
  audioUrl: string | null;
  durationMs: number | null;
  voiceId: string | null;
}

export interface ClipOverride {
  emotion?: string;
  speed?: number;
  pitch?: number;
  text?: string;
  speaker?: string;
}

export interface TimelineItem {
  id: string;
  sortOrder: number;
  label: string;
  type: 'narration' | 'dialogue' | 'bgm';
  audioUrl: string | null;
  durationMs: number;
  imageUrl?: string | null;
  characterName?: string;
}
