/**
 * API服务层 - 调用后端接口
 */

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
    syncStoryboardItems,
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
export {
    createCanvasBoard,
    getCanvasBoards,
    getCanvasBoardDetail,
    updateCanvasBoard,
    deleteCanvasBoard,
    createCanvasNode,
    updateCanvasNode,
    deleteCanvasNode,
    createCanvasConnection,
    deleteCanvasConnection,
    type CanvasBoardPayload,
    type CanvasNodePayload,
} from './canvasService';
