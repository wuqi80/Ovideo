/**
 * API服务层 - 调用后端接口
 */

import { apiJson, getAuthToken, getHeaders, handleResponse } from './httpClient';

const API_BASE = '';  // 使用相对路径，开发时通过vite proxy
export { getAuthToken, getHeaders, handleResponse };

/**
 * 保存项目到后端
 */
export async function saveProject(projectData: any): Promise<{ success: boolean; project_id: string }> {
    const response = await fetch(`${API_BASE}/api/projects/save`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(projectData)
    });
    
    return handleResponse(response, 'saveProject');
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
    const response = await fetch(`${API_BASE}/api/projects/list${suffix}`, {
        method: 'GET',
        headers: getHeaders()
    });

    return handleResponse(response, 'listProjects');
}

/**
 * 获取项目详情
 */
export async function getProject(projectId: string): Promise<{ success: boolean; project: any }> {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: 'GET',
        headers: getHeaders()
    });
    
    return handleResponse(response, 'getProject');
}

/**
 * 删除项目
 */
export async function deleteProject(projectId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    
    return handleResponse(response, 'deleteProject');
}

/**
 * 导出到视频生成阶段
 */
export async function exportToVideo(projectId: string, selectedItems: string[]): Promise<{
    success: boolean;
    exported_count: number;
    video_tasks: any[];
}> {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/export-to-video`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ selected_items: selectedItems })
    });
    
    return handleResponse(response, 'exportToVideo');
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
    
    const response = await fetch(`${API_BASE}/api/comfyui/upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    });
    
    return handleResponse(response);
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
    
    const response = await fetch(`${API_BASE}/api/materials/process`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            image_filename: imageFilename,
            workflow_type: workflowType,
            entity_type: entityOptions?.entityType,
            entity_id: entityOptions?.entityId,
            file_role: entityOptions?.fileRole,
            episode_id: entityOptions?.episodeId,
        })
    });
    
    return handleResponse(response);
}

// ==================== 项目成员管理 API ====================

export async function getProjectMembers(projectId: string) {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/members`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getProjectMembers');
}

export async function addProjectMember(projectId: string, userId: string, role = 'member', responsibility = 'all') {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ user_id: userId, role, responsibility })
    });
    return handleResponse(response, 'addProjectMember');
}

export async function updateProjectMember(projectId: string, memberUserId: string, data: { role?: string; responsibility?: string }) {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/members/${memberUserId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateProjectMember');
}

export async function removeProjectMember(projectId: string, memberUserId: string) {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/members/${memberUserId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'removeProjectMember');
}

// ==================== 项目更新 API ====================

export async function updateProject(projectId: string, data: {
    project_name?: string;
    description?: string;
    cover_url?: string;
    tags?: string[];
}) {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateProject');
}

// ==================== 全局任务 API ====================

export async function getActiveTasks() {
    return apiJson('/api/tasks/active', { method: 'GET' }, 'getActiveTasks');
}

export async function getTaskNotifications(since?: number) {
    const url = since
        ? `/api/tasks/notifications?since=${since}`
        : `/api/tasks/notifications`;
    return apiJson(url, { method: 'GET' }, 'getTaskNotifications');
}

// ==================== 持久化通知 API ====================

export async function getUnreadNotificationCount() {
    return apiJson('/api/notifications/unread-count', { method: 'GET' }, 'getUnreadNotificationCount');
}

export async function getNotifications(status?: string, limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    return apiJson(`/api/notifications?${params}`, { method: 'GET' }, 'getNotifications');
}

export async function markNotificationRead(notificationId: string) {
    return apiJson(`/api/notifications/${notificationId}/read`, { method: 'POST' }, 'markNotificationRead');
}

export async function markAllNotificationsRead() {
    return apiJson('/api/notifications/read-all', { method: 'POST' }, 'markAllNotificationsRead');
}

// 2026-05-20 (M5)：dismiss 单条通知（后端 DELETE /api/notifications/{id}）
export async function dismissNotification(notificationId: string) {
    return apiJson(`/api/notifications/${notificationId}`, { method: 'DELETE' }, 'dismissNotification');
}

// ==================== 集数管理 API ====================

export async function getEpisodes(projectId: string) {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/episodes`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getEpisodes');
}

export async function createEpisode(projectId: string, episodeName = '', description = '') {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/episodes`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ project_id: projectId, episode_name: episodeName, description })
    });
    return handleResponse(response, 'createEpisode');
}

export async function updateEpisode(episodeId: string, data: { episode_name?: string; description?: string; status?: string }) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateEpisode');
}

export async function deleteEpisode(episodeId: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'deleteEpisode');
}

// ==================== 画布 API ====================

export async function createCanvasBoard(projectId: string, name = '未命名画布', description = '') {
    return apiJson('/api/canvas/boards', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, name, description })
    }, 'createCanvasBoard');
}

export async function getCanvasBoards(projectId: string) {
    return apiJson(`/api/canvas/boards?project_id=${projectId}`, { method: 'GET' }, 'getCanvasBoards');
}

export async function getCanvasBoardDetail(boardId: string) {
    return apiJson(`/api/canvas/boards/${boardId}`, { method: 'GET' }, 'getCanvasBoardDetail');
}

export async function updateCanvasBoard(boardId: string, data: any) {
    return apiJson(`/api/canvas/boards/${boardId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateCanvasBoard');
}

export async function deleteCanvasBoard(boardId: string) {
    return apiJson(`/api/canvas/boards/${boardId}`, { method: 'DELETE' }, 'deleteCanvasBoard');
}

export async function createCanvasNode(boardId: string, nodeType: string, x = 0, y = 0, data?: any) {
    return apiJson('/api/canvas/nodes', {
        method: 'POST',
        body: JSON.stringify({ board_id: boardId, node_type: nodeType, x, y, data })
    }, 'createCanvasNode');
}

export async function updateCanvasNode(nodeId: string, data: any) {
    return apiJson(`/api/canvas/nodes/${nodeId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateCanvasNode');
}

export async function deleteCanvasNode(nodeId: string) {
    return apiJson(`/api/canvas/nodes/${nodeId}`, { method: 'DELETE' }, 'deleteCanvasNode');
}

export async function createCanvasConnection(boardId: string, sourceNodeId: string, targetNodeId: string) {
    return apiJson('/api/canvas/connections', {
        method: 'POST',
        body: JSON.stringify({ board_id: boardId, source_node_id: sourceNodeId, target_node_id: targetNodeId })
    }, 'createCanvasConnection');
}

export async function deleteCanvasConnection(connectionId: string) {
    return apiJson(`/api/canvas/connections/${connectionId}`, { method: 'DELETE' }, 'deleteCanvasConnection');
}

// ==================== 管理员API ====================

/**
 * 获取用户列表（仅管理员）
 */
export async function getUsers(): Promise<{
    success: boolean;
    users: any[];
}> {
    const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'GET',
        headers: getHeaders()
    });
    
    return handleResponse(response);
}

/**
 * 创建新用户（仅管理员）
 */
export async function createUser(userData: any): Promise<{
    success: boolean;
    user: any;
}> {
    const response = await fetch(`${API_BASE}/api/admin/users/create`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(userData)
    });
    
    return handleResponse(response);
}

/**
 * 更新用户权限（仅管理员）
 */
export async function updateUserPermissions(userId: string, permissions: any): Promise<{
    success: boolean;
}> {
    const response = await fetch(`${API_BASE}/api/admin/users/${userId}/permissions`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(permissions)
    });
    
    return handleResponse(response);
}

/**
 * 删除用户（仅管理员）
 */
export async function deleteUser(userId: string): Promise<{
    success: boolean;
}> {
    const response = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    
    return handleResponse(response);
}

/**
 * 获取生成日志（仅管理员）
 */
export async function getGenerationLogs(limit: number = 100): Promise<{
    success: boolean;
    logs: any[];
}> {
    const response = await fetch(`${API_BASE}/api/admin/logs?limit=${limit}`, {
        method: 'GET',
        headers: getHeaders()
    });
    
    return handleResponse(response);
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
    const response = await fetch(`${API_BASE}/api/admin/stats${qs}`, {
        method: 'GET',
        headers: getHeaders()
    });
    
    return handleResponse(response);
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
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/assets${qs}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getAssets');
}

export async function createAsset(data: {
    project_id: string; asset_type: string; name: string;
    episode_id?: string; script_id?: string; description?: string;
    reference_images?: string[];
}) {
    const response = await fetch(`${API_BASE}/api/assets`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createAsset');
}

export async function updateAsset(assetId: string, data: Record<string, any>) {
    const response = await fetch(`${API_BASE}/api/assets/${assetId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateAsset');
}

export async function deleteAsset(assetId: string) {
    const response = await fetch(`${API_BASE}/api/assets/${assetId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'deleteAsset');
}

// ===== Storyboard Item APIs =====

export interface StoryboardItemsQueryOptions {
    limit?: number;
    offset?: number;
    includeTotal?: boolean;
    fields?: 'audio' | 'video' | 'audio_stage' | 'materials' | string;
}

export async function getStoryboardItems(
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
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items${qs}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getStoryboardItems');
}

export async function createStoryboardItem(episodeId: string, data: any) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createStoryboardItem');
}

export async function updateStoryboardItem(itemId: string, data: any) {
    const response = await fetch(`${API_BASE}/api/storyboard-items/${itemId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateStoryboardItem');
}

export async function deleteStoryboardItem(itemId: string) {
    const response = await fetch(`${API_BASE}/api/storyboard-items/${itemId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'deleteStoryboardItem');
}

export async function deleteAllStoryboardItems(episodeId: string, scriptId?: string) {
    const params = new URLSearchParams();
    if (scriptId) params.set('script_id', scriptId);
    const qs = params.toString() ? `?${params}` : '';
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items/all${qs}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'deleteAllStoryboardItems');
}

export async function reorderStoryboardItems(episodeId: string, itemIds: string[]) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items/reorder`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ item_ids: itemIds })
    });
    return handleResponse(response, 'reorderStoryboardItems');
}

// ===== Video Segment APIs =====

export async function getVideoSegments(episodeId: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/video-segments`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getVideoSegments');
}

export async function createVideoSegment(episodeId: string, data: any) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/video-segments`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createVideoSegment');
}

export async function updateVideoSegment(segmentId: string, data: any) {
    const response = await fetch(`${API_BASE}/api/video-segments/${segmentId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateVideoSegment');
}

// ===== Audio Track APIs =====

export async function getAudioTracks(episodeId: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/audio-tracks`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getAudioTracks');
}

export async function createAudioTrack(episodeId: string, data: any) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/audio-tracks`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createAudioTrack');
}

export async function deleteAudioTrack(trackId: string) {
    const response = await fetch(`${API_BASE}/api/audio-tracks/${trackId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'deleteAudioTrack');
}

// ===== Video Capabilities =====

// 模块级缓存：所有卡片共享一次查询，避免每个 SeedanceCard 各发一次。
let _seedanceOmniCache: boolean | null = null;
let _seedanceOmniPromise: Promise<boolean> | null = null;

/** Seedance「全能参考」是否可用（后端按实际型号判断：仅 2.0 支持，1.0 Pro 不支持）。 */
export function fetchSeedanceOmni(): Promise<boolean> {
    if (_seedanceOmniCache !== null) return Promise.resolve(_seedanceOmniCache);
    if (!_seedanceOmniPromise) {
        _seedanceOmniPromise = fetch(`${API_BASE}/api/video/capabilities`, { headers: getHeaders() })
            .then(r => (r.ok ? r.json() : { seedance_omni: false }))
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
        _comfyAvailPromise = fetch(`${API_BASE}/api/video/capabilities`, { headers: getHeaders() })
            .then(r => (r.ok ? r.json() : { comfyui_available: false }))
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
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/video-takes`, {
        headers: getHeaders(),
    });
    return handleResponse(response, 'getVideoTakes');
}

// selections: { [item_id]: segment_id } 指定每镜用哪条 take；不传则后端用最新。
export async function startCompose(episodeId: string, selections?: Record<string, string>): Promise<ComposeStatus> {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/compose`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(selections ? { selections } : {}),
    });
    return handleResponse(response, 'startCompose');
}

export async function getComposeStatus(episodeId: string): Promise<ComposeStatus> {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/compose/status`, {
        headers: getHeaders(),
    });
    return handleResponse(response, 'getComposeStatus');
}

// ===== Audio Generation APIs =====

export async function generateSpeech(data: {
    text: string; persona?: string; emotion?: string;
    entity_type?: string; entity_id?: string; file_role?: string; episode_id?: string;
}) {
    const response = await fetch(`${API_BASE}/api/audio/generate-speech`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'generateSpeech');
}

export async function generateSFX(data: { description: string }) {
    const response = await fetch(`${API_BASE}/api/audio/generate-sfx`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'generateSFX');
}

export async function generateMusic(data: { description: string; duration_ms?: number }) {
    const response = await fetch(`${API_BASE}/api/audio/generate-music`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'generateMusic');
}

// ===== Episode Script APIs =====

export async function getEpisodeScript(episodeId: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/script`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getEpisodeScript');
}

export async function updateEpisodeScript(episodeId: string, data: any) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/script`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateEpisodeScript');
}

// ===== 多文件剧本 APIs =====

export async function listEpisodeScripts(episodeId: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/scripts`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'listEpisodeScripts');
}

export async function createEpisodeScript(episodeId: string, data: {
    file_name?: string;
    original_content?: string;
    adapted_script?: string;
    sort_order?: number;
    metadata?: any;
}) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/scripts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createEpisodeScript');
}

export async function updateEpisodeScriptById(episodeId: string, scriptId: string, data: {
    file_name?: string;
    original_content?: string;
    adapted_script?: string;
    metadata?: any;
}) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/scripts/${scriptId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateEpisodeScriptById');
}

export async function deleteEpisodeScript(episodeId: string, scriptId: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/scripts/${scriptId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'deleteEpisodeScript');
}

// ===== 剧本分段 APIs（2026-05-29 三步生成 Stage 1）=====

export async function listEpisodeScriptSegments(episodeId: string, scriptId?: string) {
    const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/script-segments${qs}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'listEpisodeScriptSegments');
}

export async function batchSaveScriptSegments(episodeId: string, scriptId: string | null, segments: any[]) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/script-segments/batch`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ script_id: scriptId, segments })
    });
    return handleResponse(response, 'batchSaveScriptSegments');
}

export async function deleteScriptSegments(episodeId: string, scriptId?: string) {
    const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/script-segments${qs}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'deleteScriptSegments');
}

// ===== Timeline Track APIs =====

export async function getTimelineTracks(episodeId: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/timeline-tracks`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getTimelineTracks');
}

export async function createTimelineTrack(episodeId: string, data: any) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/timeline-tracks`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createTimelineTrack');
}

export async function updateTimelineTrack(trackId: string, data: any) {
    const response = await fetch(`${API_BASE}/api/timeline-tracks/${trackId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateTimelineTrack');
}

// ===== Character Voice APIs =====

export async function getCharacterVoices(projectId: string) {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/character-voices`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getCharacterVoices');
}

export async function createCharacterVoice(data: {
    project_id: string; character_name: string;
    asset_id?: string; voice_provider?: string;
    voice_model_id?: string; voice_name?: string;
    voice_params?: Record<string, any>; sample_audio_url?: string;
}) {
    const response = await fetch(`${API_BASE}/api/character-voices`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createCharacterVoice');
}

export async function updateCharacterVoice(voiceId: string, data: Record<string, any>) {
    const response = await fetch(`${API_BASE}/api/character-voices/${voiceId}`, {
        method: 'PUT', headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateCharacterVoice');
}

export async function deleteCharacterVoice(voiceId: string) {
    const response = await fetch(`${API_BASE}/api/character-voices/${voiceId}`, {
        method: 'DELETE', headers: getHeaders()
    });
    return handleResponse(response, 'deleteCharacterVoice');
}

// ===== Batch Operations =====

export async function batchCreateStoryboardItems(episodeId: string, items: any[], scriptId?: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items/batch`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ items, script_id: scriptId })
    });
    return handleResponse(response, 'batchCreateStoryboardItems');
}

export async function extractToAssets(episodeId: string, characters: any[], scenes: any[], scriptId?: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/extract-to-assets`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ characters, scenes, script_id: scriptId })
    });
    return handleResponse(response, 'extractToAssets');
}

export async function shareAsset(assetId: string, targetEpisodeId: string, targetScriptId: string) {
    const response = await fetch(`${API_BASE}/api/assets/${assetId}/share`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ target_episode_id: targetEpisodeId, target_script_id: targetScriptId })
    });
    return handleResponse(response, 'shareAsset');
}

// ===== MiniMax Audio APIs =====

export async function minimaxVoiceDesign(prompt: string, previewText: string, voiceId?: string) {
    const response = await fetch(`${API_BASE}/api/minimax/voice-design`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ prompt, preview_text: previewText, voice_id: voiceId })
    });
    return handleResponse(response, 'minimaxVoiceDesign');
}

export async function minimaxVoiceClone(
    fileId: string,
    voiceId?: string,
    demoText = '你好，这是一段测试语音。',
    voiceIdPrefix = 'clone',
) {
    const response = await fetch(`${API_BASE}/api/minimax/voice-clone`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({
            file_id: fileId,
            voice_id: voiceId,
            demo_text: demoText,
            voice_id_prefix: voiceIdPrefix,
        })
    });
    return handleResponse(response, 'minimaxVoiceClone');
}

export async function minimaxListVoices(voiceType = 'all') {
    const response = await fetch(`${API_BASE}/api/minimax/voices?voice_type=${encodeURIComponent(voiceType)}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'minimaxListVoices');
}

export async function minimaxGetVoice(voiceId: string) {
    const response = await fetch(`${API_BASE}/api/minimax/voices/${voiceId}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'minimaxGetVoice');
}

export async function minimaxDeleteVoice(voiceId: string, voiceType = 'voice_cloning') {
    const response = await fetch(`${API_BASE}/api/minimax/voices/${voiceId}?voice_type=${encodeURIComponent(voiceType)}`, {
        method: 'DELETE', headers: getHeaders()
    });
    return handleResponse(response, 'minimaxDeleteVoice');
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
    const response = await fetch(`${API_BASE}/api/minimax/tts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
        signal,
    });
    return handleResponse(response, 'minimaxTTS');
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
    const response = await fetch(`${API_BASE}/api/minimax/tts/sync`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
        signal,
    });
    return handleResponse(response, 'minimaxTTSSync');
}

// 注意：legacy minimaxTTSQuery 已删除。
// 用 getTaskStatus(task_id) 通过数据库 task_id 查询，不再直查 MiniMax 端。

export async function minimaxMusic(lyrics = '', referVoice = '', referInstrumental = '') {
    const response = await fetch(`${API_BASE}/api/minimax/music`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ lyrics, refer_voice: referVoice, refer_instrumental: referInstrumental })
    });
    return handleResponse(response, 'minimaxMusic');
}

export async function minimaxLyrics(text: string, language = 'zh') {
    const response = await fetch(`${API_BASE}/api/minimax/lyrics`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ text, language })
    });
    return handleResponse(response, 'minimaxLyrics');
}

export async function minimaxFileUpload(file: File, purpose = 'voice_clone') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', purpose);
    const token = localStorage.getItem('auth_token') || '';
    const response = await fetch(`${API_BASE}/api/minimax/files/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
    return handleResponse(response, 'minimaxFileUpload');
}

export async function minimaxFileRetrieve(fileId: string) {
    const response = await fetch(`${API_BASE}/api/minimax/files/${fileId}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'minimaxFileRetrieve');
}

export async function minimaxFileDelete(fileId: string) {
    const response = await fetch(`${API_BASE}/api/minimax/files/${fileId}`, {
        method: 'DELETE', headers: getHeaders()
    });
    return handleResponse(response, 'minimaxFileDelete');
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
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/export-script`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(response, 'exportScript');
}
