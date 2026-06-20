/**
 * API服务层 - 调用后端接口
 */

import { apiJson } from './httpClient';

export { getAuthToken, getHeaders, handleResponse } from './httpClient';
export {
    dismissNotification,
    getActiveTasks,
    getNotifications,
    getTaskNotifications,
    getUnreadNotificationCount,
    markAllNotificationsRead,
    markNotificationRead,
} from './taskNotificationService';
export {
    batchCreateStoryboardItems,
    extractToAssets,
    getAssets,
    getAudioTracks,
    getCharacterVoices,
    getEpisodeScript,
    getStoryboardItems,
    getVideoSegments,
    updateEpisodeScript,
    updateStoryboardItem,
    type StoryboardItemsQueryOptions,
} from './episodeDataService';
export {
    createAudioTrack,
    deleteAudioTrack,
    generateSpeech,
    generateSFX,
    generateMusic,
    createCharacterVoice,
    updateCharacterVoice,
    deleteCharacterVoice,
    minimaxVoiceDesign,
    minimaxVoiceClone,
    minimaxListVoices,
    minimaxGetVoice,
    minimaxDeleteVoice,
    minimaxTTS,
    minimaxTTSSync,
    minimaxMusic,
    minimaxLyrics,
    minimaxFileUpload,
    minimaxFileRetrieve,
    minimaxFileDelete,
} from './audioGenerationService';
export {
    createVideoSegment,
    updateVideoSegment,
    fetchSeedanceOmni,
    fetchComfyuiAvailable,
    getVideoTakes,
    startCompose,
    getComposeStatus,
    type ComposeStatus,
    type VideoTake,
    type VideoShot,
} from './videoWorkflowService';
export {
    createAsset,
    updateAsset,
    deleteAsset,
    shareAsset,
    type CreateAssetPayload,
} from './assetMutationService';
export {
    createStoryboardItem,
    deleteStoryboardItem,
    deleteAllStoryboardItems,
    reorderStoryboardItems,
    exportScript,
} from './storyboardMutationService';
export {
    listEpisodeScripts,
    createEpisodeScript,
    updateEpisodeScriptById,
    deleteEpisodeScript,
    listEpisodeScriptSegments,
    batchSaveScriptSegments,
    deleteScriptSegments,
    getTimelineTracks,
    createTimelineTrack,
    updateTimelineTrack,
    type CreateEpisodeScriptPayload,
    type UpdateEpisodeScriptPayload,
} from './scriptTimelineService';
export {
    getUsers,
    createUser,
    updateUserPermissions,
    deleteUser,
    getGenerationLogs,
    getSystemStats,
} from './adminCompatService';
export {
    uploadImageToComfyUI,
    processMaterial,
    type MaterialEntityOptions,
    type MaterialWorkflowType,
} from './comfyuiBridgeService';

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

// =============================================
// UI 重构新增 API
// =============================================
