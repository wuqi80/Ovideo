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
export {
    saveProject,
    listProjects,
    getProject,
    updateProject,
    deleteProject,
    exportToVideo,
    getProjectMembers,
    addProjectMember,
    updateProjectMember,
    removeProjectMember,
    getEpisodes,
    createEpisode,
    updateEpisode,
    deleteEpisode,
    type UpdateEpisodePayload,
    type UpdateProjectMemberPayload,
    type UpdateProjectPayload,
} from './projectWorkflowService';

/**
 * 保存项目到后端
 */
/**
 * 获取项目列表
 */
/**
 * 获取项目详情
 */
/**
 * 删除项目
 */
/**
 * 导出到视频生成阶段
 */
// ==================== 项目成员管理 API ====================

// ==================== 项目更新 API ====================

// ==================== 集数管理 API ====================

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
