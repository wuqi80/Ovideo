/**
 * API服务层 - 调用后端接口
 */

import { apiJson, getAuthToken, getHeaders, handleResponse } from './httpClient';

export { getAuthToken, getHeaders, handleResponse };

/**
 * 保存项目到后端
 */
export async function saveProject(projectData: any): Promise<{ success: boolean; project_id: string }> {
    return apiJson<any>('/api/projects/save', {
        method: 'POST',
        body: JSON.stringify(projectData)
    }, 'saveProject');
}

/**
 * 获取项目列表
 */
export async function listProjects(
    limit: number = 100,
    orgId?: string,
): Promise<{ success: boolean; projects: any[] }> {
    // 2026-05-26 组织管理 MVP — 可选 org_id（个人 workspace 不传）
    const qs = new URLSearchParams();
    if (limit !== 100) qs.set('limit', String(limit));
    if (orgId) qs.set('org_id', orgId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiJson<any>(`/api/projects/list${suffix}`, { method: 'GET' }, 'listProjects');
}

/**
 * 获取项目详情
 */
export async function getProject(projectId: string): Promise<{ success: boolean; project: any }> {
    return apiJson<any>(`/api/projects/${projectId}`, { method: 'GET' }, 'getProject');
}

/**
 * 删除项目
 */
export async function deleteProject(projectId: string): Promise<{ success: boolean }> {
    return apiJson<any>(`/api/projects/${projectId}`, { method: 'DELETE' }, 'deleteProject');
}

/**
 * 导出到视频生成阶段
 */
export async function exportToVideo(projectId: string, selectedItems: string[]): Promise<{
    success: boolean;
    exported_count: number;
    video_tasks: any[];
}> {
    return apiJson<any>(`/api/projects/${projectId}/export-to-video`, {
        method: 'POST',
        body: JSON.stringify({ selected_items: selectedItems })
    }, 'exportToVideo');
}

/**
 * 上传图片到ComfyUI
 * @param dataUrl Base64格式的图片
 * @returns 上传后的文件名和URL
 */
export async function uploadImageToComfyUI(imageUrlOrDataUrl: string): Promise<{
    success: boolean;
    filename: string;
    storage_url: string;
}> {
    // 🔧 检查URL是否有效
    if (!imageUrlOrDataUrl || imageUrlOrDataUrl.trim() === '') {
        throw new Error('图片URL为空，无法上传');
    }
    
    let blob: Blob;
    
    // 🔧 智能处理：支持DataURL、Blob URL和普通URL
    if (imageUrlOrDataUrl.startsWith('data:')) {
        // DataURL格式：直接解码Base64
        const base64Data = imageUrlOrDataUrl.includes(',') ? imageUrlOrDataUrl.split(',')[1] : imageUrlOrDataUrl;
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        blob = new Blob([byteArray], { type: 'image/png' });
    } else if (imageUrlOrDataUrl.startsWith('blob:')) {
        // Blob URL格式：直接fetch
        console.log(`🔄 下载Blob图片: ${imageUrlOrDataUrl}`);
        const response = await fetch(imageUrlOrDataUrl);
        
        if (!response.ok) {
            throw new Error(`无法下载Blob图片 (${response.status})`);
        }
        
        blob = await response.blob();
    } else {
        // 普通URL格式：先下载图片
        const token = getAuthToken();
        
        // 🔧 确保URL以斜杠开头（修复相对路径问题）
        let normalizedUrl = imageUrlOrDataUrl;
        if (!imageUrlOrDataUrl.startsWith('http') && !imageUrlOrDataUrl.startsWith('/')) {
            normalizedUrl = '/' + imageUrlOrDataUrl;
        }
        
        const absolute = normalizedUrl.startsWith('http') 
            ? normalizedUrl 
            : `${window.location.origin}${normalizedUrl}`;
        const secured = token ? `${absolute}${absolute.includes('?') ? '&' : '?'}token=${token}` : absolute;
        
        console.log(`🔄 下载图片: ${imageUrlOrDataUrl} -> ${absolute}`);
        
        const response = await fetch(secured, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : undefined
        });
        
        if (!response.ok) {
            throw new Error(`无法下载图片: ${imageUrlOrDataUrl} (${response.status})`);
        }
        
        blob = await response.blob();
    }
    
    // 创建FormData
    const formData = new FormData();
    formData.append('image', blob, `image_${Date.now()}.png`);
    // 🔧 修复：指定 node_type='image'，确保图片上传到图像处理节点
    formData.append('node_type', 'image');
    
    const token = getAuthToken();
    if (!token) {
        throw new Error('未登录');
    }
    
    return apiJson<any>('/api/comfyui/upload', {
        method: 'POST',
        body: formData
    }, 'uploadImageToComfyUI', { includeContentType: false });
}

/**
 * 素材处理（高清放大、去水印、三视图）
 * @param imageFilename ComfyUI中的图片文件名
 * @param workflowType 工作流类型
 * @returns 任务ID
 */
export async function processMaterial(
    imageFilename: string,
    workflowType: 'upscale_hd' | 'remove_watermark' | 'three_view',
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; episodeId?: string }
): Promise<{
    success: boolean;
    task_id: string;
    message: string;
}> {
    const token = getAuthToken();
    if (!token) {
        throw new Error('未登录');
    }
    
    return apiJson<any>('/api/materials/process', {
        method: 'POST',
        body: JSON.stringify({
            image_filename: imageFilename,
            workflow_type: workflowType,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        })
    }, 'processMaterial');
}

// ==================== 项目成员管理 API ====================

export async function getProjectMembers(projectId: string) {
    return apiJson<any>(`/api/projects/${projectId}/members`, { method: 'GET' }, 'getProjectMembers');
}

export async function addProjectMember(projectId: string, userId: string, role = 'member', responsibility = 'all') {
    return apiJson<any>(`/api/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, role, responsibility })
    }, 'addProjectMember');
}

export async function updateProjectMember(projectId: string, memberUserId: string, data: { role?: string; responsibility?: string }) {
    return apiJson<any>(`/api/projects/${projectId}/members/${memberUserId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateProjectMember');
}

export async function removeProjectMember(projectId: string, memberUserId: string) {
    return apiJson<any>(`/api/projects/${projectId}/members/${memberUserId}`, { method: 'DELETE' }, 'removeProjectMember');
}

// ==================== 项目更新 API ====================

export async function updateProject(projectId: string, data: {
    project_name?: string;
    description?: string;
    cover_url?: string;
    tags?: string[];
}) {
    return apiJson<any>(`/api/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateProject');
}

// ==================== 全局任务 API ====================

export async function getActiveTasks() {
    return apiJson<any>('/api/tasks/active', { method: 'GET' }, 'getActiveTasks');
}

export async function getTaskNotifications(since?: number) {
    const url = since
        ? `/api/tasks/notifications?since=${since}`
        : `/api/tasks/notifications`;
    return apiJson<any>(url, { method: 'GET' }, 'getTaskNotifications');
}

// ==================== 持久化通知 API ====================

export async function getUnreadNotificationCount() {
    return apiJson<any>('/api/notifications/unread-count', { method: 'GET' }, 'getUnreadNotificationCount');
}

export async function getNotifications(status?: string, limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    return apiJson<any>(`/api/notifications?${params}`, { method: 'GET' }, 'getNotifications');
}

export async function markNotificationRead(notificationId: string) {
    return apiJson<any>(`/api/notifications/${notificationId}/read`, { method: 'POST' }, 'markNotificationRead');
}

export async function markAllNotificationsRead() {
    return apiJson<any>('/api/notifications/read-all', { method: 'POST' }, 'markAllNotificationsRead');
}

// 2026-05-20 (M5)：dismiss 单条通知（后端 DELETE /api/notifications/{id}）
export async function dismissNotification(notificationId: string) {
    return apiJson<any>(`/api/notifications/${notificationId}`, { method: 'DELETE' }, 'dismissNotification');
}

// ==================== 集数管理 API ====================

export async function getEpisodes(projectId: string) {
    return apiJson<any>(`/api/projects/${projectId}/episodes`, { method: 'GET' }, 'getEpisodes');
}

export async function createEpisode(projectId: string, episodeName = '', description = '') {
    return apiJson<any>(`/api/projects/${projectId}/episodes`, {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, episode_name: episodeName, description })
    }, 'createEpisode');
}

export async function updateEpisode(episodeId: string, data: { episode_name?: string; description?: string; status?: string }) {
    return apiJson<any>(`/api/episodes/${episodeId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateEpisode');
}

export async function deleteEpisode(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}`, { method: 'DELETE' }, 'deleteEpisode');
}

// ==================== 画布 API ====================

export async function createCanvasBoard(projectId: string, name = '未命名画布', description = '') {
    return apiJson<any>('/api/canvas/boards', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, name, description })
    }, 'createCanvasBoard');
}

export async function getCanvasBoards(projectId: string) {
    return apiJson<any>(`/api/canvas/boards?project_id=${projectId}`, { method: 'GET' }, 'getCanvasBoards');
}

export async function getCanvasBoardDetail(boardId: string) {
    return apiJson<any>(`/api/canvas/boards/${boardId}`, { method: 'GET' }, 'getCanvasBoardDetail');
}

export async function updateCanvasBoard(boardId: string, data: any) {
    return apiJson<any>(`/api/canvas/boards/${boardId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateCanvasBoard');
}

export async function deleteCanvasBoard(boardId: string) {
    return apiJson<any>(`/api/canvas/boards/${boardId}`, { method: 'DELETE' }, 'deleteCanvasBoard');
}

export async function createCanvasNode(boardId: string, nodeType: string, x = 0, y = 0, data?: any) {
    return apiJson<any>('/api/canvas/nodes', {
        method: 'POST',
        body: JSON.stringify({ board_id: boardId, node_type: nodeType, x, y, data })
    }, 'createCanvasNode');
}

export async function updateCanvasNode(nodeId: string, data: any) {
    return apiJson<any>(`/api/canvas/nodes/${nodeId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateCanvasNode');
}

export async function deleteCanvasNode(nodeId: string) {
    return apiJson<any>(`/api/canvas/nodes/${nodeId}`, { method: 'DELETE' }, 'deleteCanvasNode');
}

export async function createCanvasConnection(boardId: string, sourceNodeId: string, targetNodeId: string) {
    return apiJson<any>('/api/canvas/connections', {
        method: 'POST',
        body: JSON.stringify({ board_id: boardId, source_node_id: sourceNodeId, target_node_id: targetNodeId })
    }, 'createCanvasConnection');
}

export async function deleteCanvasConnection(connectionId: string) {
    return apiJson<any>(`/api/canvas/connections/${connectionId}`, { method: 'DELETE' }, 'deleteCanvasConnection');
}

// ==================== 管理员API ====================

/**
 * 获取用户列表（仅管理员）
 */
export async function getUsers(): Promise<{
    success: boolean;
    users: any[];
}> {
    return apiJson<any>('/api/admin/users', { method: 'GET' }, 'getUsers');
}

/**
 * 创建新用户（仅管理员）
 */
export async function createUser(userData: any): Promise<{
    success: boolean;
    user: any;
}> {
    return apiJson<any>('/api/admin/users/create', {
        method: 'POST',
        body: JSON.stringify(userData)
    }, 'createUser');
}

/**
 * 更新用户权限（仅管理员）
 */
export async function updateUserPermissions(userId: string, permissions: any): Promise<{
    success: boolean;
}> {
    return apiJson<any>(`/api/admin/users/${userId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify(permissions)
    }, 'updateUserPermissions');
}

/**
 * 删除用户（仅管理员）
 */
export async function deleteUser(userId: string): Promise<{
    success: boolean;
}> {
    return apiJson<any>(`/api/admin/users/${userId}`, { method: 'DELETE' }, 'deleteUser');
}

/**
 * 获取生成日志（仅管理员）
 */
export async function getGenerationLogs(limit: number = 100): Promise<{
    success: boolean;
    logs: any[];
}> {
    return apiJson<any>(`/api/admin/logs?limit=${limit}`, { method: 'GET' }, 'getGenerationLogs');
}

/**
 * 获取系统统计（仅管理员）
 */
// 2026-05-26 组织管理 MVP — Slice 6: 加 group_by ('user' | 'org')
export async function getSystemStats(groupBy?: 'user' | 'org'): Promise<{
    success: boolean;
    stats: any;
    group_by?: 'none' | 'user' | 'org';
    breakdown?: any[];
}> {
    const qs = groupBy ? `?group_by=${groupBy}` : '';
    return apiJson<any>(`/api/admin/stats${qs}`, { method: 'GET' }, 'getSystemStats');
}

// =============================================
// UI 重构新增 API
// =============================================

// ===== Asset APIs =====

export async function getAssets(projectId: string, episodeId?: string, assetType?: string, scriptId?: string) {
    const params = new URLSearchParams();
    if (episodeId) params.set('episode_id', episodeId);
    if (assetType) params.set('asset_type', assetType);
    if (scriptId) params.set('script_id', scriptId);
    const qs = params.toString() ? `?${params}` : '';
    return apiJson<any>(`/api/projects/${projectId}/assets${qs}`, { method: 'GET' }, 'getAssets');
}

export async function createAsset(data: {
    project_id: string; asset_type: string; name: string;
    episode_id?: string; script_id?: string; description?: string;
    reference_images?: string[];
}) {
    return apiJson<any>('/api/assets', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createAsset');
}

export async function updateAsset(assetId: string, data: Record<string, any>) {
    return apiJson<any>(`/api/assets/${assetId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateAsset');
}

export async function deleteAsset(assetId: string) {
    return apiJson<any>(`/api/assets/${assetId}`, { method: 'DELETE' }, 'deleteAsset');
}

// ===== Storyboard Item APIs =====

export interface StoryboardItemsQueryOptions {
    limit?: number;
    offset?: number;
    includeTotal?: boolean;
    fields?: 'audio' | 'video' | 'audio_stage' | 'materials' | string;
    fallbackToEpisode?: boolean;
}

async function getStoryboardItemsRaw(
    episodeId: string,
    scriptId?: string,
    options: StoryboardItemsQueryOptions = {},
) {
    const params = new URLSearchParams();
    if (scriptId) params.set('script_id', scriptId);
    if (typeof options.limit === 'number') params.set('limit', String(options.limit));
    if (typeof options.offset === 'number') params.set('offset', String(options.offset));
    if (options.includeTotal) params.set('include_total', 'true');
    if (options.fields) params.set('fields', options.fields);
    const qs = params.toString() ? `?${params}` : '';
    return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items${qs}`, { method: 'GET' }, 'getStoryboardItems');
}

export async function getStoryboardItems(
    episodeId: string,
    scriptId?: string,
    options: StoryboardItemsQueryOptions = {},
) {
    const result = await getStoryboardItemsRaw(episodeId, scriptId, options);
    const shouldFallback =
        !!scriptId &&
        options.fallbackToEpisode !== false &&
        result?.success &&
        Array.isArray(result.items) &&
        result.items.length === 0 &&
        (typeof result.total !== 'number' || result.total === 0);

    if (!shouldFallback) return result;

    const fallback = await getStoryboardItemsRaw(episodeId, undefined, {
        ...options,
        fallbackToEpisode: false,
    });
    if (fallback?.success && Array.isArray(fallback.items) && fallback.items.length > 0) {
        return {
            ...fallback,
            fallbackScriptId: scriptId,
            fallbackReason: 'empty_script_storyboard',
        };
    }
    return result;
}

export async function createStoryboardItem(episodeId: string, data: any) {
    return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items`, {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createStoryboardItem');
}

export async function updateStoryboardItem(itemId: string, data: any) {
    return apiJson<any>(`/api/storyboard-items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateStoryboardItem');
}

export async function deleteStoryboardItem(itemId: string) {
    return apiJson<any>(`/api/storyboard-items/${itemId}`, { method: 'DELETE' }, 'deleteStoryboardItem');
}

export async function deleteAllStoryboardItems(episodeId: string, scriptId?: string) {
    const params = new URLSearchParams();
    if (scriptId) params.set('script_id', scriptId);
    const qs = params.toString() ? `?${params}` : '';
    return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/all${qs}`, { method: 'DELETE' }, 'deleteAllStoryboardItems');
}

export async function reorderStoryboardItems(episodeId: string, itemIds: string[]) {
    return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/reorder`, {
        method: 'POST',
        body: JSON.stringify({ item_ids: itemIds })
    }, 'reorderStoryboardItems');
}

// ===== Video Segment APIs =====

export async function getVideoSegments(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/video-segments`, { method: 'GET' }, 'getVideoSegments');
}

export async function createVideoSegment(episodeId: string, data: any) {
    return apiJson<any>(`/api/episodes/${episodeId}/video-segments`, {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createVideoSegment');
}

export async function updateVideoSegment(segmentId: string, data: any) {
    return apiJson<any>(`/api/video-segments/${segmentId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateVideoSegment');
}

// ===== Audio Track APIs =====

export async function getAudioTracks(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/audio-tracks`, { method: 'GET' }, 'getAudioTracks');
}

export async function createAudioTrack(episodeId: string, data: any) {
    return apiJson<any>(`/api/episodes/${episodeId}/audio-tracks`, {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createAudioTrack');
}

export async function deleteAudioTrack(trackId: string) {
    return apiJson<any>(`/api/audio-tracks/${trackId}`, { method: 'DELETE' }, 'deleteAudioTrack');
}

// ===== Video Capabilities =====

// 模块级缓存：所有卡片共享一次查询，避免每个 SeedanceCard 各发一次。
let _seedanceOmniCache: boolean | null = null;
let _seedanceOmniPromise: Promise<boolean> | null = null;

/** Seedance「全能参考」是否可用（后端按实际型号判断：仅 2.0 支持，1.0 Pro 不支持）。 */
export function fetchSeedanceOmni(): Promise<boolean> {
    if (_seedanceOmniCache !== null) return Promise.resolve(_seedanceOmniCache);
    if (!_seedanceOmniPromise) {
        _seedanceOmniPromise = apiJson<any>('/api/video/capabilities', { method: 'GET' }, 'fetchSeedanceOmni')
            .then(j => { _seedanceOmniCache = !!j.seedance_omni; return _seedanceOmniCache; })
            .catch(() => { _seedanceOmniCache = false; return false; });
    }
    return _seedanceOmniPromise;
}

// ComfyUI agent 是否在线（GPU 节点类任务如 upscale 放大需要它；无则前端禁用相关按钮）。
let _comfyAvailCache: boolean | null = null;
let _comfyAvailPromise: Promise<boolean> | null = null;
export function fetchComfyuiAvailable(): Promise<boolean> {
    if (_comfyAvailCache !== null) return Promise.resolve(_comfyAvailCache);
    if (!_comfyAvailPromise) {
        _comfyAvailPromise = apiJson<any>('/api/video/capabilities', { method: 'GET' }, 'fetchComfyuiAvailable')
            .then(j => { _comfyAvailCache = !!j.comfyui_available; return _comfyAvailCache; })
            .catch(() => { _comfyAvailCache = false; return false; });
    }
    return _comfyAvailPromise;
}

// ===== 一键合成成片 =====
// 后台把本集视频段+配音拼成完整 mp4 存入成品页；耗时较长，前端轮询 status。
export interface ComposeStatus {
    success?: boolean;
    status: 'idle' | 'running' | 'done' | 'failed';
    total: number;
    done: number;
    url?: string | null;
    duration?: number;
    error?: string | null;
}

export interface VideoTake {
    segment_id: string;
    video_url: string;
    thumbnail_url?: string | null;
    created_at?: string | null;
}
export interface VideoShot {
    item_id: string;
    sort_order: number;
    scene?: string;
    dialogue?: string;
    takes: VideoTake[];
}

export async function getVideoTakes(episodeId: string): Promise<{ success: boolean; shots: VideoShot[] }> {
    return apiJson<any>(`/api/episodes/${episodeId}/video-takes`, { method: 'GET' }, 'getVideoTakes');
}

// selections: { [item_id]: segment_id } 指定每镜用哪条 take；不传则后端用最新。
export async function startCompose(episodeId: string, selections?: Record<string, string>): Promise<ComposeStatus> {
    return apiJson<any>(`/api/episodes/${episodeId}/compose`, {
        method: 'POST',
        body: JSON.stringify(selections ? { selections } : {}),
    }, 'startCompose');
}

export async function getComposeStatus(episodeId: string): Promise<ComposeStatus> {
    return apiJson<any>(`/api/episodes/${episodeId}/compose/status`, { method: 'GET' }, 'getComposeStatus');
}

// ===== Audio Generation APIs =====

export async function generateSpeech(data: {
    text: string; persona?: string; emotion?: string;
    entity_type?: string; entity_id?: string; file_role?: string; episode_id?: string;
}) {
    return apiJson<any>('/api/audio/generate-speech', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'generateSpeech');
}

export async function generateSFX(data: { description: string }) {
    return apiJson<any>('/api/audio/generate-sfx', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'generateSFX');
}

export async function generateMusic(data: { description: string; duration_ms?: number }) {
    return apiJson<any>('/api/audio/generate-music', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'generateMusic');
}

// ===== Episode Script APIs =====

export async function getEpisodeScript(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/script`, { method: 'GET' }, 'getEpisodeScript');
}

export async function updateEpisodeScript(episodeId: string, data: any) {
    return apiJson<any>(`/api/episodes/${episodeId}/script`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateEpisodeScript');
}

// ===== 多文件剧本 APIs =====

export async function listEpisodeScripts(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/scripts`, { method: 'GET' }, 'listEpisodeScripts');
}

export async function createEpisodeScript(episodeId: string, data: {
    file_name?: string;
    original_content?: string;
    adapted_script?: string;
    sort_order?: number;
    metadata?: any;
}) {
    return apiJson<any>(`/api/episodes/${episodeId}/scripts`, {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createEpisodeScript');
}

export async function updateEpisodeScriptById(episodeId: string, scriptId: string, data: {
    file_name?: string;
    original_content?: string;
    adapted_script?: string;
    metadata?: any;
}) {
    return apiJson<any>(`/api/episodes/${episodeId}/scripts/${scriptId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateEpisodeScriptById');
}

export async function deleteEpisodeScript(episodeId: string, scriptId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/scripts/${scriptId}`, { method: 'DELETE' }, 'deleteEpisodeScript');
}

// ===== 剧本分段 APIs（2026-05-29 三步生成 Stage 1）=====

export async function listEpisodeScriptSegments(episodeId: string, scriptId?: string) {
    const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
    return apiJson<any>(`/api/episodes/${episodeId}/script-segments${qs}`, { method: 'GET' }, 'listEpisodeScriptSegments');
}

export async function batchSaveScriptSegments(episodeId: string, scriptId: string | null, segments: any[]) {
    return apiJson<any>(`/api/episodes/${episodeId}/script-segments/batch`, {
        method: 'PUT',
        body: JSON.stringify({ script_id: scriptId, segments })
    }, 'batchSaveScriptSegments');
}

export async function deleteScriptSegments(episodeId: string, scriptId?: string) {
    const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
    return apiJson<any>(`/api/episodes/${episodeId}/script-segments${qs}`, { method: 'DELETE' }, 'deleteScriptSegments');
}

// ===== Timeline Track APIs =====

export async function getTimelineTracks(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/timeline-tracks`, { method: 'GET' }, 'getTimelineTracks');
}

export async function createTimelineTrack(episodeId: string, data: any) {
    return apiJson<any>(`/api/episodes/${episodeId}/timeline-tracks`, {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createTimelineTrack');
}

export async function updateTimelineTrack(trackId: string, data: any) {
    return apiJson<any>(`/api/timeline-tracks/${trackId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateTimelineTrack');
}

// ===== Character Voice APIs =====

export async function getCharacterVoices(projectId: string) {
    return apiJson<any>(`/api/projects/${projectId}/character-voices`, { method: 'GET' }, 'getCharacterVoices');
}

export async function createCharacterVoice(data: {
    project_id: string; character_name: string;
    asset_id?: string; voice_provider?: string;
    voice_model_id?: string; voice_name?: string;
    voice_params?: Record<string, any>; sample_audio_url?: string;
}) {
    return apiJson<any>('/api/character-voices', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createCharacterVoice');
}

export async function updateCharacterVoice(voiceId: string, data: Record<string, any>) {
    return apiJson<any>(`/api/character-voices/${voiceId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateCharacterVoice');
}

export async function deleteCharacterVoice(voiceId: string) {
    return apiJson<any>(`/api/character-voices/${voiceId}`, { method: 'DELETE' }, 'deleteCharacterVoice');
}

// ===== Batch Operations =====

export async function batchCreateStoryboardItems(episodeId: string, items: any[], scriptId?: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/batch`, {
        method: 'POST',
        body: JSON.stringify({ items, script_id: scriptId })
    }, 'batchCreateStoryboardItems');
}

export async function extractToAssets(episodeId: string, characters: any[], scenes: any[], scriptId?: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/extract-to-assets`, {
        method: 'POST',
        body: JSON.stringify({ characters, scenes, script_id: scriptId })
    }, 'extractToAssets');
}

export async function shareAsset(assetId: string, targetEpisodeId: string, targetScriptId: string) {
    return apiJson<any>(`/api/assets/${assetId}/share`, {
        method: 'POST',
        body: JSON.stringify({ target_episode_id: targetEpisodeId, target_script_id: targetScriptId })
    }, 'shareAsset');
}

// ===== MiniMax Audio APIs =====

export async function minimaxVoiceDesign(prompt: string, previewText: string, voiceId?: string) {
    return apiJson<any>('/api/minimax/voice-design', {
        method: 'POST',
        body: JSON.stringify({ prompt, preview_text: previewText, voice_id: voiceId })
    }, 'minimaxVoiceDesign');
}

export async function minimaxVoiceClone(
    fileId: string,
    voiceId?: string,
    demoText = '你好，这是一段测试语音。',
    voiceIdPrefix = 'clone',
) {
    return apiJson<any>('/api/minimax/voice-clone', {
        method: 'POST',
        body: JSON.stringify({
            file_id: fileId,
            voice_id: voiceId,
            demo_text: demoText,
            voice_id_prefix: voiceIdPrefix,
        })
    }, 'minimaxVoiceClone');
}

export async function minimaxListVoices(voiceType = 'all') {
    return apiJson<any>(`/api/minimax/voices?voice_type=${encodeURIComponent(voiceType)}`, { method: 'GET' }, 'minimaxListVoices');
}

export async function minimaxGetVoice(voiceId: string) {
    return apiJson<any>(`/api/minimax/voices/${voiceId}`, { method: 'GET' }, 'minimaxGetVoice');
}

export async function minimaxDeleteVoice(voiceId: string, voiceType = 'voice_cloning') {
    return apiJson<any>(`/api/minimax/voices/${voiceId}?voice_type=${encodeURIComponent(voiceType)}`, { method: 'DELETE' }, 'minimaxDeleteVoice');
}

/**
 * 提交 MiniMax TTS 任务（异步）。
 *
 * 2026-05-24 改造：从"同步阻塞等 audio_url"改为"立即入队拿 task_id"。
 * 调用方需要用 getTaskStatus(task_id) 轮询，或用 ttsTaskPoller。
 *
 * @returns { success: true, task_id: <数据库 task_id> }
 */
export async function minimaxTTS(data: {
    text: string; voice_id: string; model?: string;
    speed?: number; pitch?: number; emotion?: string;
    entity_type?: string; entity_id?: string; file_role?: string; episode_id?: string;
    bind_to_character_voice_id?: string;  // 2026-05-24 新增：worker 完成后回写 sample_audio_url
}, signal?: AbortSignal): Promise<{ success: true; task_id: string }> {
    return apiJson<any>('/api/minimax/tts', {
        method: 'POST',
        body: JSON.stringify(data),
        signal,
    }, 'minimaxTTS');
}

/**
 * Synchronous MiniMax TTS — fast-path for short-text preview (≤1000 chars).
 *
 * 2026-05-25 引入：原 minimaxTTS 走 worker 异步（入队 + 轮询），对试听场景太重。
 * 这个 fast-path 在后端 handler 内同步调 /v1/t2a_v2（典型 1-15s）拿到音频
 * → 入库 → 直接返回 audio_url。试听几乎无感等待。
 *
 * 何时用：
 *   - VoiceSidebar 试听（≤1000 字符的对白片段）
 *   - 单条对白「立即生成并播放」场景
 *
 * 何时不用（保留 minimaxTTS 走 worker 异步）：
 *   - 批量生成全集（一集 200 条对白）
 *   - text > 1000 字符（后端返回 413，调用方应 fallback 到 minimaxTTS）
 *   - 需要 worker 级 retry / 并发限流
 *
 * Plan: docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md
 */
export async function minimaxTTSSync(data: {
    text: string;
    voice_id: string;
    model?: string;
    speed?: number;
    pitch?: number;
    emotion?: string;
    entity_type?: string;
    entity_id?: string;
    file_role?: string;
    episode_id?: string;
    bind_to_character_voice_id?: string;
}, signal?: AbortSignal): Promise<{
    success: true;
    audio_url: string;
    file_id: string;
    file_url: string;
    duration_ms?: number;
    minimax_trace_id?: string;
}> {
    return apiJson<any>('/api/minimax/tts/sync', {
        method: 'POST',
        body: JSON.stringify(data),
        signal,
    }, 'minimaxTTSSync');
}

// 注意：legacy minimaxTTSQuery 已删除。
// 用 getTaskStatus(task_id) 通过数据库 task_id 查询，不再直查 MiniMax 端。

export async function minimaxMusic(lyrics = '', referVoice = '', referInstrumental = '') {
    return apiJson<any>('/api/minimax/music', {
        method: 'POST',
        body: JSON.stringify({ lyrics, refer_voice: referVoice, refer_instrumental: referInstrumental })
    }, 'minimaxMusic');
}

export async function minimaxLyrics(text: string, language = 'zh') {
    return apiJson<any>('/api/minimax/lyrics', {
        method: 'POST',
        body: JSON.stringify({ text, language })
    }, 'minimaxLyrics');
}

export async function minimaxFileUpload(file: File, purpose = 'voice_clone') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', purpose);
    return apiJson<any>('/api/minimax/files/upload', {
        method: 'POST',
        body: formData
    }, 'minimaxFileUpload', { includeContentType: false });
}

export async function minimaxFileRetrieve(fileId: string) {
    return apiJson<any>(`/api/minimax/files/${fileId}`, { method: 'GET' }, 'minimaxFileRetrieve');
}

export async function minimaxFileDelete(fileId: string) {
    return apiJson<any>(`/api/minimax/files/${fileId}`, { method: 'DELETE' }, 'minimaxFileDelete');
}

export async function exportScript(episodeId: string, data: {
    project_id: string;
    original_content: string;
    script_content: string;
    storyboard_items: any[];
    characters: { name: string; description: string }[];
    scenes: { name: string; description: string }[];
    script_id?: string | null;
}) {
    return apiJson<any>(`/api/episodes/${episodeId}/export-script`, {
        method: 'POST',
        body: JSON.stringify(data),
    }, 'exportScript');
}
