// ==================== 工作台主逻辑 ====================

// 🔐 按用户隔离的存储Key生成函数
const getStorageKey = (baseKey) => {
    const username = localStorage.getItem('username') || 'guest';
    return `${baseKey}-${username}`;
};

const Workspace = {
    // 状态变量
    viewMode: 'card',
    expandedPrompts: {},
    imageAudios: {},
    dragSrcIndex: null,
    isDragging: false,
    selectedVideoIndex: 0,
    pendingModelChange: null,
    pendingRedoTaskUuid: null,
    currentVoiceAudioFile: null,
    currentVoiceTaskUuid: null,
    currentVoiceAudioFile: null,
    currentUpscaleTaskUuid: null,
    currentEditTaskUuid: null,
    currentEditVideoUrl: null,
    currentEditVideoIndex: 0,
    isBatchAutoUpscale: false,
    
    // 缓存标志
    _historyLoaded: false,
    _isLoadingHistory: false,
    
    // 初始化
    init() {
        console.log('🚀 初始化工作台...');
        
        // 初始化Lucide图标
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        } else {
            const checkLucide = setInterval(() => {
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                    clearInterval(checkLucide);
                }
            }, 100);
        }
        
        // 绑定粘贴事件
        document.addEventListener('paste', (e) => this.handlePaste(e));
        
        // 拖拽上传功能
        if (typeof FileUpload !== 'undefined') {
            FileUpload.setupDragAndDrop();
        }
        
        // 滚动同步功能
        if (typeof UI !== 'undefined') {
            UI.setupScrollSync();
        }
        
        // 启动全局计时器更新器 - 每秒更新所有正在运行任务的计时器
        setInterval(() => {
            Object.keys(TaskManager.tasksStatus).forEach(uuid => {
                const status = TaskManager.tasksStatus[uuid];
                if (status && status.state === 'running' && TaskManager.taskStartTimes[uuid]) {
                    // 更新右上角的计时器显示
                    const timeStr = TaskManager.getElapsedTimeStr(uuid);
                    const timerElements = document.querySelectorAll(`.progress-text[data-uuid="${uuid}"]`);
                    timerElements.forEach(el => {
                        el.textContent = timeStr;
                    });
                }
            });
        }, 1000);  // 每秒更新一次
        
        // 只在首次加载时加载历史任务（使用缓存）
        if (Auth.isLoggedIn() && !this._historyLoaded) {
            // ✅ 优化：先检查导入数据（用户从阶段3跳转过来最关心这个）
            (async () => {
                // 🚀 优先检查是否有从阶段3导出的数据（最快响应）
                const hasImportData = await this.checkAndLoadExportedData();
                
                // 如果没有导入数据，继续正常加载流程
                if (!hasImportData) {
                    // 1. 加载workspace会话数据（上传的图片、任务组、提示词）
                    await TaskManager.loadSession();
                    
                    // 2. 加载后端历史任务（Redis中正在进行/已完成的任务）
                    await this.loadHistoryTasks();
                    
                    // 3. 恢复处理中的任务状态（页面刷新时的进度恢复）
                    this.loadProcessingTasksFromLocal();
                    
                    // ✅ 正常加载完成，隐藏loading
                    this.hideLoadingOverlay();
                }
                // 如果有导入数据，已经在checkAndLoadExportedData中处理了loading隐藏
            })();
        } else {
            // 未登录或已加载过，直接隐藏loading
            setTimeout(() => {
                this.hideLoadingOverlay();
            }, 500);
        }
        
        // 更新用户显示
        this.updateUserDisplay();
        
        console.log('✅ 工作台初始化完成');
    },
    
    /**
     * 隐藏Loading覆盖层（在所有数据加载完成后调用）
     */
    hideLoadingOverlay() {
        // 🔧 支持多种可能的 ID
        const overlayIds = ['workspaceLoadingOverlay', 'globalSpaceLoadingOverlay', 'page-loading'];
        let loadingOverlay = null;
        
        for (const id of overlayIds) {
            const el = document.getElementById(id);
            if (el) {
                loadingOverlay = el;
                break;
            }
        }
        
        if (!loadingOverlay) {
            console.log('⚠️ 未找到loading覆盖层，可能已被移除');
            return;
        }
        
        console.log('🎬 准备隐藏加载动画:', loadingOverlay.id);
        
        // 淡出动画
        loadingOverlay.style.opacity = '0';
        loadingOverlay.style.transition = 'opacity 0.5s ease-out';
        
        // 500ms后完全隐藏
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
            loadingOverlay.remove();  // 🆕 完全移除元素
            console.log('✅ 加载动画已隐藏并移除');
        }, 500);
    },
    
    // ==================== 视频抽帧功能 ====================
    
    /**
     * 从视频抽取第一帧/最后一帧作为缩略图（并上传到服务器）
     * @returns {Promise} 返回Promise，在所有抽帧完成后resolve
     */
    async extractFramesFromVideos() {
        const imagesToExtract = TaskManager.uploadedImages.filter(img => 
            img.needsFrameExtraction && img.extractFromVideo
        );
        
        if (imagesToExtract.length === 0) {
            console.log('✅ 无需抽帧');
            return Promise.resolve();
        }
        
        console.log(`🎬 开始从 ${imagesToExtract.length} 个视频抽取帧...`);
        
        for (const img of imagesToExtract) {
            try {
                const taskUuid = img.extractFromVideo;
                const status = TaskManager.tasksStatus[taskUuid];
                
                if (!status || !status.videos || status.videos.length === 0) {
                    console.warn(`⚠️ 任务 ${taskUuid} 没有视频，跳过抽帧`);
                    img.needsFrameExtraction = false;
                    continue;
                }
                
                const videoUrl = status.videos[0];
                
                // 检查视频URL是否有效
                if (!videoUrl || typeof videoUrl !== 'string') {
                    console.warn(`⚠️ 任务 ${taskUuid} 的视频URL无效:`, videoUrl);
                    img.needsFrameExtraction = false;
                    continue;
                }
                
                const extractLastFrame = img.extractLastFrame || false;
                
                console.log(`🎬 从视频抽帧: ${taskUuid}, 最后一帧: ${extractLastFrame}, URL: ${videoUrl.substring(0, 80)}...`);
                
                // 创建video元素
                const video = document.createElement('video');
                video.crossOrigin = 'anonymous';
                video.preload = 'metadata';
                video.muted = true;
                video.src = videoUrl;
                
                await new Promise((resolve, reject) => {
                    video.onloadeddata = resolve;
                    video.onerror = reject;
                    setTimeout(reject, 10000);  // 10秒超时
                });
                
                // 跳到目标帧
                if (extractLastFrame) {
                    video.currentTime = Math.max(0, video.duration - 0.1);  // 最后一帧
                } else {
                    video.currentTime = 0;  // 第一帧
                }
                
                await new Promise(resolve => {
                    video.onseeked = resolve;
                    setTimeout(resolve, 2000);  // 2秒超时
                });
                
                // 抽取帧
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                // 转换为Blob
                const blob = await new Promise(resolve => {
                    canvas.toBlob(resolve, 'image/jpeg', 0.9);
                });
                
                // 创建File对象（生成唯一文件名）
                const uniqueFileName = `frame_${Date.now()}_${taskUuid.substring(0, 8)}.jpg`;
                const frameFile = new File([blob], uniqueFileName, { type: 'image/jpeg' });
                
                // 上传到服务器
                console.log(`📤 上传抽帧图片到服务器: ${uniqueFileName}`);
                const uploadResult = await API.uploadImage(frameFile);
                
                if (uploadResult && uploadResult.storage_url) {
                    // 使用持久化URL
                    img.url = `${API.baseURL}${uploadResult.storage_url}`;
                    img.storageUrl = uploadResult.storage_url;
                    img.fileId = uploadResult.file_id;  // 保存file_id
                    img.filename = uploadResult.filename || img.filename;
                    img.needsFrameExtraction = false;
                    delete img.extractFromVideo;
                    delete img.extractLastFrame;
                    console.log(`✅ 抽帧并上传成功: ${taskUuid} -> ${uploadResult.storage_url}`);
                    
                    // ✅ 保存到后端数据库，持久化存储
                    // 注意：不再使用localStorage，所有数据都保存到后端
                } else {
                    // 上传失败，使用DataURL
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    img.url = dataUrl;
                    img.needsFrameExtraction = false;
                    delete img.extractFromVideo;
                    delete img.extractLastFrame;
                    console.warn(`⚠️ 抽帧上传失败，使用临时DataURL: ${taskUuid}`);
                }
                
            } catch (error) {
                console.error(`❌ 抽帧失败 (任务: ${taskUuid}):`, error);
                console.error('抽帧失败详情:', {
                    taskUuid,
                    videoUrl: status?.videos?.[0],
                    extractLastFrame: img.extractLastFrame,
                    errorMessage: error?.message || '未知错误',
                    errorStack: error?.stack
                });
                
                // 🔄 尝试使用视频URL作为占位图（如果是图片任务）
                if (status && status.videos && status.videos.length > 0) {
                    const videoUrl = status.videos[0];
                    // 检查是否实际是图片URL（有些任务可能存储为videos但实际是图片）
                    if (videoUrl.includes('.jpg') || videoUrl.includes('.png') || videoUrl.includes('.jpeg')) {
                        console.log(`💡 检测到视频URL实际是图片，直接使用: ${videoUrl}`);
                        img.url = videoUrl;
                        img.needsFrameExtraction = false;
                        delete img.extractFromVideo;
                        delete img.extractLastFrame;
                    } else {
                        // 使用默认占位图
                        img.url = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23334155" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" fill="%23cbd5e1" font-size="16"%3E视频缩略图%3C/text%3E%3C/svg%3E';
                        img.needsFrameExtraction = false;
                    }
                } else {
                    // 使用默认占位图
                    img.url = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23334155" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" fill="%23cbd5e1" font-size="16"%3E视频缩略图%3C/text%3E%3C/svg%3E';
                    img.needsFrameExtraction = false;
                }
            }
        }
        
        // 抽帧完成后刷新UI
        if (imagesToExtract.length > 0) {
            UI.refreshUI();
            console.log(`✅ 完成 ${imagesToExtract.length} 个视频抽帧并上传`);
        }
        
        // 返回Promise，确保调用方可以等待抽帧完成
        return Promise.resolve();
    },
    
    // ==================== 从阶段3导入数据 ====================
    
    /**
     * ✨ 快速检查并加载导出数据（优先级最高）
     * @returns {Promise<boolean>} 是否有导入数据
     */
    async checkAndLoadExportedData() {
        try {
            // 快速检查localStorage中是否有项目ID
            const username = localStorage.getItem('username') || 'guest';
            const storageKey = getStorageKey('anime-current-project-id');
            const projectId = localStorage.getItem(storageKey);
            
            if (!projectId) {
                console.log('📭 没有找到待导入的项目ID');
                return false;
            }
            
            console.log(`🚀 快速检查导入数据: ${projectId}`);
            
            // 快速获取项目数据
            const response = await fetch(`/api/projects/${projectId}`, {
                headers: {
                    'Authorization': `Bearer ${Auth.getToken()}`
                }
            });
            
            if (!response.ok) {
                console.log(`⚠️ 项目不存在，清除ID`);
                localStorage.removeItem(storageKey);
                return false;
            }
            
            const data = await response.json();
            
            if (!data.success || !data.project || !data.project.video_tasks || data.project.video_tasks.length === 0) {
                console.log(`📭 项目中没有待导入的分镜`);
                return false;
            }
            
            // ✅ 发现导入数据，直接自动导入（不需要确认）
            console.log(`✅ 发现 ${data.project.video_tasks.length} 个待导入的分镜，开始自动导入...`);
            
            // 显示简单的提示消息（替代模态框）
            UI.showToast(`📥 正在导入 ${data.project.video_tasks.length} 个分镜...`);
            
            // 直接导入
            await this.importVideoTasksFromStage3(data.project.video_tasks);
            
            return true;
        } catch (error) {
            console.error('检查导入数据失败:', error);
            return false;
        }
    },
    
    /**
     * 加载从阶段3导出的数据（已废弃，使用checkAndLoadExportedData代替）
     */
    async loadExportedDataFromStage3() {
        try {
            // 从localStorage获取当前项目ID（按用户隔离）
            const username = localStorage.getItem('username') || 'guest';
            const storageKey = getStorageKey('anime-current-project-id');
            const projectId = localStorage.getItem(storageKey);
            
            console.log(`🔍 检查导出数据: username=${username}, storageKey=${storageKey}, projectId=${projectId}`);
            
            if (!projectId) {
                console.log('📭 没有找到阶段3项目ID，跳过导入');
                return;
            }
            
            console.log(`📡 尝试加载阶段3项目: ${projectId}`);
            
            // 调用后端API获取项目数据
            const response = await fetch(`/api/projects/${projectId}`, {
                headers: {
                    'Authorization': `Bearer ${Auth.getToken()}`
                }
            });
            
            if (!response.ok) {
                console.log(`⚠️ 项目 ${projectId} 不存在或已删除（404），跳过导入`);
                // 清除无效的项目ID
                localStorage.removeItem(getStorageKey('anime-current-project-id'));
                return;
            }
            
            const data = await response.json();
            console.log(`📦 获取到项目数据:`, data);
            
            if (!data.success || !data.project) {
                console.log(`❌ 项目数据无效: success=${data.success}, hasProject=${!!data.project}`);
                return;
            }
            
            const project = data.project;
            console.log(`📋 项目详情: stage=${project.stage}, video_tasks=${project.video_tasks?.length || 0}`);
            
            // 检查是否有待导入的视频任务
            if (project.video_tasks && project.video_tasks.length > 0) {
                console.log(`✅ 发现 ${project.video_tasks.length} 个待导入的分镜`);

                // ✅ 使用漂亮的自定义模态框代替原生confirm
                await this.showImportConfirmModal(project.video_tasks);
            }
        } catch (error) {
            console.error('加载阶段3数据失败:', error);
        }
    },
    
    /**
     * 导入视频任务数据
     */
    async importVideoTasksFromStage3(videoTasks) {
        console.log('📥 开始导入视频任务...', videoTasks);
        
        for (const task of videoTasks) {
            try {
                let imageUrl = task.image_url;
                
                // 如果是Base64数据，先上传到ComfyUI获取URL
                if (imageUrl && imageUrl.startsWith('data:image')) {
                    console.log('🔄 检测到Base64图片，正在上传...');
                    try {
                        // 将Base64转为Blob
                        const base64Data = imageUrl.split(',')[1];
                        const byteCharacters = atob(base64Data);
                        const byteNumbers = new Array(byteCharacters.length);
                        for (let i = 0; i < byteCharacters.length; i++) {
                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                        }
                        const byteArray = new Uint8Array(byteNumbers);
                        const blob = new Blob([byteArray], { type: 'image/png' });
                        const file = new File([blob], `imported_${Date.now()}.png`, { type: 'image/png' });
                        
                        // 上传到服务器
                        const uploadResult = await API.uploadImage(file);
                        if (uploadResult.storage_url) {
                            imageUrl = uploadResult.storage_url;
                            // 保存file_id用于后续任务提交
                            if (uploadResult.file_id) {
                                window._lastUploadedFileId = uploadResult.file_id;
                            }
                            console.log('✅ Base64图片已上传，URL:', imageUrl, 'file_id:', uploadResult.file_id);
                        }
                    } catch (uploadError) {
                        console.error('❌ Base64图片上传失败:', uploadError);
                        // 使用Base64作为fallback
                    }
                }
                
                // 创建图片对象（只有当有URL时才添加）
                const imageId = `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // 🔧 只有当imageUrl有效时才添加到uploadedImages
                if (imageUrl && imageUrl.trim()) {
                const imageObj = {
                    id: imageId,
                    url: imageUrl,
                    storageUrl: imageUrl,  // ✅ 添加storageUrl字段
                    fileId: window._lastUploadedFileId || null,  // ✅ 添加file_id字段
                    filename: `imported_${Date.now()}.png`,  // ✅ 添加filename字段
                    uploadTime: Date.now(),
                    file: null  // 导入的任务没有原始文件
                };
                TaskManager.uploadedImages.push(imageObj);
                    console.log(`📸 添加图片到uploadedImages: ${imageId}, URL: ${imageUrl.substring(0, 50)}...`);
                } else {
                    console.warn(`⚠️ 跳过添加空URL图片: ${imageId}`);
                }
                
                // 创建任务组（使用图片ID）
                const groupUuid = `group_${imageId}`;
                TaskManager.taskGroups.push({
                    uuid: groupUuid,
                    ids: [imageId],  // 单图任务
                    model: 'Wan2',
                    type: 'imported',
                    timestamp: Date.now()
                });
                
                // 初始化任务状态（导入的任务作为已有图片的状态）
                TaskManager.tasksStatus[groupUuid] = {
                    state: 'idle',
                    progress: 0,
                    // 🔧 导入的图片应该存储在images数组中，而不是result字段
                    images: imageUrl ? [{ url: imageUrl, id: imageId }] : [], // 存储为图片数组
                    result: null, // 清空result字段，避免与视频混淆
                    videos: [],
                    videoGenerateTimes: [],
                    totalGenerationTime: 0,
                    selected: false,
                    isExpired: false,
                    isUpscaled: false
                };
                
                // 🔧 添加提示词（从导出数据中获取）
                TaskManager.imagePrompts[imageId] = task.video_prompt || task.dialogue || '';
                
                console.log(`📝 导入提示词: ${TaskManager.imagePrompts[imageId]?.substring(0, 50) || '(空)'}...`);
                
                console.log(`✅ 导入任务:`, {
                    imageId,
                    groupUuid,
                    hasImage: !!imageUrl,
                    imageUrl: imageUrl?.substring(0, 50) + '...',
                    prompt: task.video_prompt || '(无提示词)'
                });
                
            } catch (error) {
                console.error('导入单个任务失败:', error);
            }
        }
        
        // ✅ 已废弃：导入的任务现在通过数据库会话管理
        // 导入后会自动调用 TaskManager.saveSession()
        
        // ✅ 刷新UI（同时更新分镜区和执行队列）
        console.log('🔄 刷新UI，当前任务数:', TaskManager.taskGroups.length);
        UI.refreshUI();  // 使用refreshUI而不是renderStoryboard，确保执行队列也更新
        
        // ✅ 隐藏加载动画（导入完成）
        this.hideLoadingOverlay();
        
        // ✅ 显示成功提示
        UI.showToast(`✅ 成功导入 ${videoTasks.length} 个分镜到工作台`);
        
        console.log(`✅ 成功导入 ${videoTasks.length} 个分镜到工作台`);
        
        // 清除项目中的video_tasks，避免重复导入
        try {
            const projectId = localStorage.getItem('anime-current-project-id');
            if (projectId) {
                const response = await fetch(`/api/projects/${projectId}/clear-video-tasks`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${Auth.getToken()}`,
                        'Content-Type': 'application/json'
                    }
                });
                if (response.ok) {
                    console.log('✅ 已清除项目中的video_tasks，避免重复导入');
                }
            }
        } catch (error) {
            console.error('清除video_tasks失败:', error);
        }
        
        // 🆕 保存会话到后端
        console.log('💾 开始保存导入的任务到后端...');
        await TaskManager.saveSession();
        console.log('✅ 导入的任务已保存到后端');
    },
    
    /**
     * ✅ 已废弃：处理中的任务现在通过数据库会话管理
     * 保留此占位函数以避免兼容性问题
     */
    saveProcessingTasksToLocal() {
        // 已废弃：现在使用 TaskManager.saveSession()
        console.log('ℹ️ saveProcessingTasksToLocal() 已废弃，所有数据通过数据库管理');
    },
    
    /**
     * ✅ 已废弃：处理中的任务现在通过数据库会话管理
     */
    loadProcessingTasksFromLocal() {
        // 已废弃：现在使用 TaskManager.loadSession()
        console.log('ℹ️ loadProcessingTasksFromLocal() 已废弃，所有数据通过数据库管理');
    },
    
    /**
     * ✅ 已废弃：上传的任务现在通过数据库会话管理
     * 保留此占位函数以避免兼容性问题
     */
    saveUploadedTasksToLocal() {
        // 已废弃：现在使用 TaskManager.saveSession()
        console.log('ℹ️ saveUploadedTasksToLocal() 已废弃，所有数据通过数据库管理');
    },
    
    /**
     * ✅ 已废弃：上传的任务现在通过数据库会话管理
     */
    loadUploadedTasksFromLocal() {
        // 已废弃：现在使用 TaskManager.loadSession()
        console.log('ℹ️ loadUploadedTasksFromLocal() 已废弃，所有数据通过数据库管理');
        return; // 直接返回，不做任何操作
        
        // 以下代码已废弃，保留仅供参考
        try {
            const uploadedTasks = [];
            if (uploadedTasks.length === 0) return;
            
            console.log(`🔄 尝试恢复 ${uploadedTasks.length} 个上传任务`);
            
            const validTasks = [];
            
            uploadedTasks.forEach(task => {
                // 检查是否已存在（避免重复）
                const existing = TaskManager.taskGroups.find(g => g.uuid === task.uuid);
                if (existing) {
                    console.log(`⚠️ 任务已存在，跳过: ${task.uuid}`);
                    return;
                }
                
                // 验证URL有效性（过滤掉Blob URL）
                let hasValidImages = true;
                task.images.forEach(img => {
                    if (!img.url || img.url.startsWith('blob:')) {
                        console.warn(`⚠️ 无效的图片URL（Blob URL），跳过任务: ${task.uuid}`);
                        hasValidImages = false;
                    }
                });
                
                if (!hasValidImages) return;
                
                // 验证视频URL有效性
                if (task.status && task.status.result) {
                    if (task.status.result.startsWith('blob:')) {
                        console.warn(`⚠️ 无效的视频URL（Blob URL），跳过任务: ${task.uuid}`);
                        return;
                    }
                }
                
                // 恢复图片
                task.images.forEach(img => {
                    const existingImg = TaskManager.uploadedImages.find(i => i.id === img.id);
                    if (!existingImg) {
                        TaskManager.uploadedImages.push({
                            id: img.id,
                            url: img.url,
                            filename: img.filename,
                            storageUrl: img.storageUrl,
                            uploadTime: img.uploadTime,
                            file: null
                        });
                    }
                });
                
                // 恢复任务组
                TaskManager.taskGroups.push({
                    uuid: task.uuid,
                    ids: task.ids,
                    model: task.model
                });
                
                // 恢复提示词
                TaskManager.imagePrompts[task.ids[0]] = task.prompt;
                
                // 恢复状态
                TaskManager.tasksStatus[task.uuid] = {
                    state: task.status.state,
                    result: task.status.result,
                    videos: task.status.videos || [],
                    videoStoragePath: task.status.videoStoragePath,
                    isUpscaled: task.status.isUpscaled,
                    originalResult: task.status.originalResult
                };
                
                validTasks.push(task);
            });
            
            console.log(`✅ 成功恢复 ${validTasks.length} 个有效任务，跳过 ${uploadedTasks.length - validTasks.length} 个无效任务`);
            
            // ✅ 已废弃：数据库会话自动管理无效任务
            if (validTasks.length < uploadedTasks.length) {
                const invalidCount = uploadedTasks.length - validTasks.length;
                console.log(`🧹 发现 ${invalidCount} 个无效任务（Blob URL或已失效）`);
                console.log(`💾 数据库会话自动管理，无需手动清理`);
            }
            
            if (validTasks.length > 0) {
                UI.refreshUI();
            }
        } catch (error) {
            console.error('恢复上传任务失败:', error);
        }
    },
    
    /**
     * ✅ 已废弃：导入的任务现在通过数据库会话管理
     */
    loadImportedTasksFromLocalStorage() {
        // 已废弃：现在使用 TaskManager.loadSession()
        console.log('ℹ️ loadImportedTasksFromLocalStorage() 已废弃，所有数据通过数据库管理');
    },
    
    // 更新用户显示
    updateUserDisplay() {
        const username = Auth.getUsername();
        const userDisplay = document.getElementById('userDisplay');
        const userAvatar = document.getElementById('userAvatar');
        if (userDisplay) userDisplay.textContent = username || 'User';
        if (userAvatar) userAvatar.textContent = (username || 'U').charAt(0).toUpperCase();
    },
    
    // ==================== 文件处理 ====================
    
    // 处理粘贴事件（支持图片、视频、音频）
    handlePaste(event) {
        if (!Auth.isLoggedIn()) return; // 只有登录后才能粘贴上传
        
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;
        const imageFiles = [];
        const videoFiles = [];
        const audioFiles = [];
        
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file.type.startsWith('image/')) {
                    imageFiles.push(file);
                } else if (file.type.startsWith('video/')) {
                    videoFiles.push(file);
                } else if (file.type.startsWith('audio/')) {
                    audioFiles.push(file);
                }
            }
        }
        
        // 处理图片
        if (imageFiles.length > 0) {
            this.handleFiles(imageFiles);
            UI.showToast(`📋 粘贴了 ${imageFiles.length} 张图片`);
        }
        
        // 处理视频
        if (videoFiles.length > 0) {
            videoFiles.forEach(file => {
                this.handleVideoUpload({ target: { files: [file] } });
            });
            UI.showToast(`📋 粘贴了 ${videoFiles.length} 个视频`);
        }
        
        // 处理音频（如果配音模态框打开）
        if (audioFiles.length > 0) {
            const voiceModal = document.getElementById('voiceModal');
            if (voiceModal && !voiceModal.classList.contains('hidden')) {
                if (typeof Modals !== 'undefined' && Modals.handleVoiceAudioFile) {
                    Modals.handleVoiceAudioFile(audioFiles[0]);
                    UI.showToast(`📋 粘贴了音频: ${audioFiles[0].name}`);
                }
            }
        }
    },
    
    // 处理批量上传
    handleBatchUpload(event) {
        this.handleFiles(event.target.files);
    },
    
    // 处理视频上传（完整版：抽帧+上传服务器）
    async handleVideoUpload(event) {
        const file = event.target.files[0];
        if (!file || !file.type.startsWith('video/')) {
            UI.showToast('请选择有效的视频文件');
            if (event.target) event.target.value = '';
            return;
        }
        
        UI.showToast('正在处理视频...');
        
        try {
            // 创建视频元素用于抽帧
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            
            const videoUrl = URL.createObjectURL(file);
            video.src = videoUrl;
            
            // 等待视频加载
            await new Promise((resolve, reject) => {
                video.onloadeddata = resolve;
                video.onerror = reject;
            });
            
            // 跳到第一帧
            video.currentTime = 0;
            await new Promise(resolve => {
                video.onseeked = resolve;
            });
            
            // 创建canvas抽取第一帧
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // 转换为Blob
            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/jpeg', 0.95);
            });
            
            // 创建File对象
            const imageFile = new File([blob], `${file.name}_frame0.jpg`, { type: 'image/jpeg' });
            
            // 生成唯一ID
            const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const uuid = UI.generateUUID();
            
            // 先上传抽帧图片到服务器
            UI.showToast('正在上传抽帧图片...');
            const imageFormData = new FormData();
            imageFormData.append('file', imageFile);
            
            const imageUploadResponse = await fetch(`${API.baseURL}/api/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: imageFormData
            });
            
            let frameImageUrl = '';
            let frameImageStorageUrl = '';
            
            if (imageUploadResponse.ok) {
                const imageUploadResult = await imageUploadResponse.json();
                frameImageUrl = `${API.baseURL}${imageUploadResult.storage_url}`;
                frameImageStorageUrl = imageUploadResult.storage_url;
                console.log(`✅ 抽帧图片已上传: ${frameImageUrl}`);
            } else {
                // 失败则使用临时Blob URL
                frameImageUrl = URL.createObjectURL(imageFile);
                console.warn('⚠️ 抽帧图片上传失败，使用临时URL');
            }
            
            // 添加到图片列表
            TaskManager.uploadedImages.push({ 
                id, 
                file: null,  // 已上传，不需要保存File对象
                url: frameImageUrl,
                filename: imageFile.name,
                storageUrl: frameImageStorageUrl,
                sourceVideo: file,  // 保存源视频文件
                uploadTime: Date.now(),  // 上传时间戳
                sourceVideoFilename: file.name
            });
            
            TaskManager.imagePrompts[id] = `视频: ${file.name}`;
            TaskManager.taskGroups.push({ uuid: uuid, ids: [id], model: 'Wan2' });
            
            // 上传源视频到持久化存储
            UI.showToast('正在上传源视频到服务器...');
            const videoFormData = new FormData();
            videoFormData.append('file', file);  // 字段名改为'file'
            
            const videoUploadResponse = await fetch(`${API.baseURL}/api/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: videoFormData
            });
            
            if (videoUploadResponse.ok) {
                const videoUploadResult = await videoUploadResponse.json();
                console.log('📦 视频上传结果:', videoUploadResult);
                
                // 使用持久化存储URL
                const uploadedVideoUrl = `${API.baseURL}${videoUploadResult.storage_url || videoUploadResult.url}`;
                console.log(`📹 视频已上传到持久化存储: ${uploadedVideoUrl}`);
                console.log(`📁 视频存储路径: ${videoUploadResult.storage_url}`);
                
                // 在右侧显示视频
                TaskManager.tasksStatus[uuid] = {
                    state: 'done',
                    progress: 100,
                    result: uploadedVideoUrl,
                    videos: [uploadedVideoUrl],  // 保存到videos数组
                    videoGenerateTimes: [],  // 上传的视频没有生成时间
                    selected: false,
                    uploadedVideo: true,  // 标记为上传的视频
                    videoStoragePath: videoUploadResult.storage_url,  // 保存路径用于放大
                    sourceVideoFilename: videoUploadResult.filename,
                    storageUrl: videoUploadResult.storage_url  // 保存存储URL
                };
                
                console.log(`📹 源视频已上传: ${videoUploadResult.filename}`);
                console.log('✅ TaskManager状态已设置:', TaskManager.tasksStatus[uuid]);
            } else {
                // 上传失败
                const errorText = await videoUploadResponse.text();
                console.error('❌ 视频上传失败:', videoUploadResponse.status, errorText);
                UI.showToast(`视频上传失败: ${videoUploadResponse.status}`);
                
                // 仍然显示抽帧图片，但没有视频
                console.warn('⚠️ 视频上传失败，仅保留抽帧图片');
            }
            
            // 清理
            URL.revokeObjectURL(videoUrl);
            
            // ✅ 保存会话到后端
            await TaskManager.saveSession();
            
            UI.refreshUI();
            UI.showToast(`✅ 视频已上传，第一帧已提取，源视频显示在右侧`);
            console.log(`📹 视频上传: ${file.name}, 抽帧ID: ${id}, UUID: ${uuid}`);
            
        } catch (error) {
            console.error('视频处理失败:', error);
            UI.showToast('视频处理失败: ' + error.message);
        }
        
        if (event.target) event.target.value = '';
    },
    
    // 处理文件
    async handleFiles(files) {
        if (files.length === 0) return;
        
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        
        if (imageFiles.length === 0) return;
        
        UI.showToast(`正在上传 ${imageFiles.length} 张图片...`);
        
        // 🔧 使用 TaskManager.addImage() 上传图片
        for (const file of imageFiles) {
            await TaskManager.addImage(file);
            }
        
        UI.refreshUI();
        UI.showToast(`✅ 已添加 ${imageFiles.length} 张分镜`);
    },
    
    // ==================== 音频处理 ====================
    
    // 处理音频上传
    handleAudioUpload(imgId, event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('audio/')) {
            UI.showToast('请选择音频文件');
            return;
        }
        
        const audioUrl = URL.createObjectURL(file);
        this.imageAudios[imgId] = {
            file: file,
            url: audioUrl,
            name: file.name
        };
        
        UI.showToast(`音频 ${file.name} 已上传`);
        UI.refreshUI();
    },
    
    // 移除音频
    removeAudio(imgId) {
        if (this.imageAudios[imgId]) {
            if (this.imageAudios[imgId].url) {
                URL.revokeObjectURL(this.imageAudios[imgId].url);
            }
            this.imageAudios[imgId] = null;
            UI.showToast('音频已移除');
            UI.refreshUI();
        }
    },
    
    // ==================== 任务执行 ====================
    
    // 执行任务
    async runTask(uuid) {
        console.log('🚀 runTask 被调用:', uuid);
        
        if (!TaskManager.tasksStatus[uuid]) {
            TaskManager.tasksStatus[uuid] = { state: 'idle', progress: 0, videos: [], videoGenerateTimes: [] };
        }
        
        const group = TaskManager.taskGroups.find(g => g.uuid === uuid);
        if (!group) {
            console.error('❌ 找不到任务组:', uuid);
            UI.showToast('任务未找到');
            return;
        }
        
        const isPair = group.ids.length === 2;
        
        // 记录开始时间
        TaskManager.startTimer(uuid);
        console.log('⏰ 记录任务开始时间:', new Date(TaskManager.taskStartTimes[uuid]));
        
        // 保存现有的视频（用于重做时显示）
        const currentStatus = TaskManager.tasksStatus[uuid] || {};
        const existingVideos = currentStatus.videos || [];
        const existingTimes = currentStatus.videoGenerateTimes || [];
        const existingResult = currentStatus.result || '';
        const keepResult = currentStatus.keepResult || false;
        
        console.log('📦 runTask 开始 - 当前状态:', {
            uuid,
            keepResult,
            existingVideos: existingVideos.length,
            existingVideoUrls: existingVideos.map(v => v?.substring(0, 50) + '...'),
            existingTimes: existingTimes.length,
            existingResult: existingResult ? '有' : '无'
        });
        
        // 设置为运行中，同时保留旧视频用于显示
        TaskManager.tasksStatus[uuid] = {
            state: 'running',
            progress: 0,
            message: '正在提交任务...',
            keepResult: keepResult,
            result: existingResult,
            videos: existingVideos,
            videoGenerateTimes: existingTimes
        };
        
        console.log('✅ 状态已设置为running，旧视频已保留:', {
            videos: TaskManager.tasksStatus[uuid].videos.length,
            videoUrls: TaskManager.tasksStatus[uuid].videos.map(v => v?.substring(0, 50) + '...')
        });
        UI.refreshUI();
        
        try {
            // 检查图片是否可用
            const img1 = TaskManager.uploadedImages.find(i => i.id === group.ids[0]);
            if (!img1) {
                throw new Error('找不到图片，请重新上传');
            }
            
            // 🔧 判断是否需要上传到ComfyUI
            // 外部API模型（Sora2、Veo、MINI、大能）不需要上传到ComfyUI
            const isExternalAPI = ['Sora2', 'Veo', 'MINI', '大能'].includes(group.model);
            
            // 🐛 调试：输出图片对象信息
            console.log('📋 图片对象信息:', {
                id: img1.id,
                filename: img1.filename,
                fileId: img1.fileId,
                hasFile: !!img1.file,
                url: img1.url?.substring(0, 100),
                storageUrl: img1.storageUrl?.substring(0, 100),
                model: group.model,
                isExternalAPI
            });
            
            // 🆕 上传图片到ComfyUI（仅Wan2工作流需要）
            let imageFilename = '';
            
            if (isExternalAPI) {
                // 外部API模型：上传文件，后端转Base64
                if (img1.fileId) {
                    // 已上传，使用file_id标识
                    imageFilename = img1.fileId;
                    console.log('🌐 外部API使用已上传图片 file_id:', imageFilename);
                } else if (img1.file) {
                    // 新上传的图片，先上传到服务器（后端会转Base64）
                    TaskManager.tasksStatus[uuid].message = '正在上传图片到服务器...';
                    UI.refreshUI();
                    const uploadResult = await API.uploadImage(img1.file);
                    img1.fileId = uploadResult.file_id;  // 保存file_id
                    img1.filename = uploadResult.filename;  // 保存原始文件名（用于显示）
                    img1.storageUrl = uploadResult.storage_url;
                    imageFilename = img1.fileId;  // 传递file_id
                    console.log('✅ 图片已上传，file_id:', imageFilename, '原始文件名:', img1.filename);
                } else if (img1.url || img1.storageUrl) {
                    // 从URL中提取file_id（历史记录或导入的任务）
                    const url = img1.storageUrl || img1.url || '';
                    const match = url.match(/\/api\/files\/(file_[a-f0-9]+)/);
                    if (match) {
                        imageFilename = match[1];  // 提取file_id
                        img1.fileId = imageFilename;  // 保存file_id
                        console.log('🌐 从URL提取file_id:', imageFilename);
                    } else {
                        // URL格式不匹配，需要下载并重新上传
                        console.warn('⚠️ 旧格式URL，需要重新上传:', url.substring(0, 100));
                        TaskManager.tasksStatus[uuid].message = '正在准备图片（重新上传）...';
                        UI.refreshUI();
                        
                        try {
                            // 构建完整URL
                            let imageUrl = url;
                            if (!imageUrl.startsWith('http')) {
                                imageUrl = `${API.baseURL}${imageUrl}`;
                            }
                            if (!imageUrl.includes('token=')) {
                                imageUrl += (imageUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                            }
                            
                            // 下载图片
                            const response = await fetch(imageUrl);
                            if (!response.ok) {
                                throw new Error(`图片下载失败: ${response.status}`);
                            }
                            
                            const blob = await response.blob();
                            const filename = img1.filename || `image_${Date.now()}.png`;
                            const file = new File([blob], filename, { type: blob.type || 'image/png' });
                            
                            // 重新上传到服务器
                            const uploadResult = await API.uploadImage(file);
                            img1.fileId = uploadResult.file_id;
                            img1.filename = uploadResult.filename;
                            img1.storageUrl = uploadResult.storage_url;
                            img1.url = `${API.baseURL}${uploadResult.storage_url}`;
                            imageFilename = img1.fileId;
                            
                            console.log('✅ 图片已重新上传，file_id:', imageFilename);
                        } catch (error) {
                            console.error('❌ 图片重新上传失败:', error);
                            throw new Error(`图片处理失败: ${error.message}`);
                        }
                    }
                } else {
                    throw new Error('图片文件不可用：缺少fileId、file或url');
                }
            } else if (!img1.file && img1.comfyuiFilename) {
                // 历史记录，已经上传过ComfyUI
                imageFilename = img1.comfyuiFilename;
                console.log('📜 使用历史ComfyUI文件名:', imageFilename);
            } else if (img1.file) {
                TaskManager.tasksStatus[uuid].message = '正在上传图片到ComfyUI...';
                UI.refreshUI();
                
                // 上传到持久化存储和ComfyUI（指定video节点）
                const uploadResult = await API.uploadImageToComfyUI(img1.file, 'video');
                console.log('图片上传成功:', uploadResult);
                
                // 保存ComfyUI文件名和节点信息
                img1.comfyuiFilename = uploadResult.filename;  // ComfyUI文件名
                img1.comfyuiNodeId = uploadResult.comfyui_node_id;  // 上传到的节点ID
                imageFilename = uploadResult.filename;
                
                // 更新持久化存储URL
                if (uploadResult.storage_url) {
                    img1.storageUrl = uploadResult.storage_url;
                    img1.url = `${API.baseURL}${uploadResult.storage_url}?token=${Auth.getToken()}`;
                    console.log('✅ 图片已保存到持久化存储和ComfyUI video节点');
                }
            } else if (img1.url || img1.storageUrl) {
                // 从URL重新下载并上传到ComfyUI（导入任务的情况）
                TaskManager.tasksStatus[uuid].message = '正在准备图片...';
                UI.refreshUI();
                
                console.log('🔄 从URL下载图片并上传到ComfyUI');
                console.log('  - img1.url:', img1.url);
                console.log('  - img1.storageUrl:', img1.storageUrl);
                
                try {
                    // 构建完整的图片URL
                    let imageUrl;
                    if (img1.url && img1.url.startsWith('http')) {
                        // 完整URL（包含token）
                        imageUrl = img1.url;
                    } else if (img1.url && img1.url.startsWith('/api/files/')) {
                        // 相对URL（数据库文件API）
                        imageUrl = `${API.baseURL}${img1.url}?token=${Auth.getToken()}`;
                    } else if (img1.storageUrl && img1.storageUrl.startsWith('/api/files/')) {
                        // storageUrl也可能是/api/files格式
                        imageUrl = `${API.baseURL}${img1.storageUrl}?token=${Auth.getToken()}`;
                    } else if (img1.storageUrl) {
                        // 旧格式的storage URL
                        imageUrl = `${API.baseURL}${img1.storageUrl}?token=${Auth.getToken()}`;
                    } else {
                        throw new Error('无法构建图片URL');
                    }
                    
                    console.log('  → 最终URL:', imageUrl);
                    
                    const response = await fetch(imageUrl);
                    if (!response.ok) {
                        throw new Error(`图片下载失败: ${response.status} ${response.statusText}`);
                    }
                    
                    const blob = await response.blob();
                    console.log('  ✅ 图片下载成功, 大小:', blob.size, 'bytes');
                    
                    // 生成文件名
                    let filename;
                    if (img1.url && img1.url.includes('/api/files/')) {
                        // 从file_id提取，格式如 /api/files/file_xxx/download
                        const match = img1.url.match(/file_([a-f0-9]+)/);
                        filename = match ? `${match[1]}.webp` : `image_${Date.now()}.png`;
                    } else {
                        filename = img1.storageUrl 
                            ? img1.storageUrl.split('/').pop().split('?')[0]
                            : `image_${Date.now()}.png`;
                    }
                    
                    const file = new File([blob], filename, { type: blob.type || 'image/png' });
                    console.log('  → 创建File对象:', filename);
                    
                    // 上传到ComfyUI（video节点）
                    TaskManager.tasksStatus[uuid].message = '正在上传图片到ComfyUI...';
                    UI.refreshUI();
                    
                    const uploadResult = await API.uploadImageToComfyUI(file, 'video');
                    console.log('  ✅ 图片重新上传成功:', uploadResult);
                    
                    // 保存ComfyUI文件名和节点信息
                    img1.comfyuiFilename = uploadResult.filename;
                    img1.comfyuiNodeId = uploadResult.comfyui_node_id;
                    imageFilename = uploadResult.filename;
                    
                } catch (downloadError) {
                    console.error('❌ 图片处理失败:', downloadError);
                    throw new Error(`无法准备图片文件: ${downloadError.message}`);
                }
            } else {
                console.error('❌ 图片对象无可用数据:', img1);
                throw new Error('图片文件不可用，请重新上传');
            }
            
            // 处理第二张图片（如果是首尾帧）
            let imageFilenameEnd = null;
            if (isPair) {
                const img2 = TaskManager.uploadedImages.find(i => i.id === group.ids[1]);
                if (!img2) {
                    throw new Error('找不到第二张图片，请重新上传');
                }
                
                if (isExternalAPI) {
                    // 外部API模型：使用Base64编码
                    if (img2.base64) {
                        imageFilenameEnd = img2.base64;
                        console.log('🌐 外部API使用第二张Base64，长度:', imageFilenameEnd.length);
                    } else if (img2.file) {
                        TaskManager.tasksStatus[uuid].message = '正在处理第二张图片...';
                        UI.refreshUI();
                        
                        const reader = new FileReader();
                        const base64Promise = new Promise((resolve, reject) => {
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(img2.file);
                        });
                        
                        const base64Data = await base64Promise;
                        img2.base64 = base64Data;
                        imageFilenameEnd = base64Data;
                        console.log('✅ 第二张图片已转换为Base64，长度:', imageFilenameEnd.length);
                    } else if (img2.url) {
                        TaskManager.tasksStatus[uuid].message = '正在下载第二张图片...';
                        UI.refreshUI();
                        
                        const response = await fetch(img2.url);
                        const blob = await response.blob();
                        const reader = new FileReader();
                        const base64Promise = new Promise((resolve, reject) => {
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        
                        const base64Data = await base64Promise;
                        img2.base64 = base64Data;
                        imageFilenameEnd = base64Data;
                        console.log('✅ 第二张图片已下载并转换为Base64，长度:', imageFilenameEnd.length);
                    } else {
                        throw new Error('第二张图片文件不可用');
                    }
                } else if (!img2.file && img2.comfyuiFilename) {
                    // 历史记录，已经上传过ComfyUI
                    imageFilenameEnd = img2.comfyuiFilename;
                    console.log('📜 使用历史ComfyUI文件名2:', imageFilenameEnd);
                } else if (img2.file) {
                    TaskManager.tasksStatus[uuid].message = '正在上传第二张图片到ComfyUI...';
                    UI.refreshUI();
                    
                    // 上传到持久化存储和ComfyUI（video节点）
                    const uploadResult2 = await API.uploadImageToComfyUI(img2.file, 'video');
                    console.log('第二张图片上传成功:', uploadResult2);
                    
                    // 保存ComfyUI文件名和节点信息
                    img2.comfyuiFilename = uploadResult2.filename;  // ComfyUI文件名
                    img2.comfyuiNodeId = uploadResult2.comfyui_node_id;  // 节点ID
                    imageFilenameEnd = uploadResult2.filename;
                    
                    // 更新持久化存储URL
                    if (uploadResult2.storage_url) {
                        img2.storageUrl = uploadResult2.storage_url;
                        img2.url = `${API.baseURL}${uploadResult2.storage_url}?token=${Auth.getToken()}`;
                        console.log('✅ 第二张图片已保存到持久化存储和ComfyUI video节点');
                    }
                } else if (img2.url || img2.storageUrl) {
                    // 从URL重新下载并上传到ComfyUI
                    TaskManager.tasksStatus[uuid].message = '正在准备第二张图片...';
                    UI.refreshUI();
                    
                    console.log('🔄 从URL下载第二张图片并上传到ComfyUI');
                    console.log('  - img2.url:', img2.url);
                    console.log('  - img2.storageUrl:', img2.storageUrl);
                    
                    try {
                        // 构建完整的图片URL
                        let imageUrl;
                        if (img2.url && img2.url.startsWith('http')) {
                            imageUrl = img2.url;
                        } else if (img2.url && img2.url.startsWith('/api/files/')) {
                            imageUrl = `${API.baseURL}${img2.url}?token=${Auth.getToken()}`;
                        } else if (img2.storageUrl && img2.storageUrl.startsWith('/api/files/')) {
                            imageUrl = `${API.baseURL}${img2.storageUrl}?token=${Auth.getToken()}`;
                        } else if (img2.storageUrl) {
                            imageUrl = `${API.baseURL}${img2.storageUrl}?token=${Auth.getToken()}`;
                        } else {
                            throw new Error('无法构建第二张图片URL');
                        }
                        
                        console.log('  → 最终URL:', imageUrl);
                        
                        const response = await fetch(imageUrl);
                        if (!response.ok) {
                            throw new Error(`第二张图片下载失败: ${response.status}`);
                        }
                        
                        const blob = await response.blob();
                        console.log('  ✅ 第二张图片下载成功, 大小:', blob.size, 'bytes');
                        
                        // 生成文件名
                        let filename;
                        if (img2.url && img2.url.includes('/api/files/')) {
                            const match = img2.url.match(/file_([a-f0-9]+)/);
                            filename = match ? `${match[1]}_2.webp` : `image_${Date.now()}_2.png`;
                        } else {
                            filename = img2.storageUrl 
                                ? img2.storageUrl.split('/').pop().split('?')[0]
                                : `image_${Date.now()}_2.png`;
                        }
                        
                        const file = new File([blob], filename, { type: blob.type || 'image/png' });
                        console.log('  → 创建File对象:', filename);
                        
                        // 上传到ComfyUI（video节点）
                        TaskManager.tasksStatus[uuid].message = '正在上传第二张图片到ComfyUI...';
                        UI.refreshUI();
                        
                        const uploadResult2 = await API.uploadImageToComfyUI(file, 'video');
                        console.log('  ✅ 第二张图片重新上传成功:', uploadResult2);
                        
                        img2.comfyuiFilename = uploadResult2.filename;
                        img2.comfyuiNodeId = uploadResult2.comfyui_node_id;
                        imageFilenameEnd = uploadResult2.filename;
                        
                    } catch (downloadError) {
                        console.error('❌ 第二张图片处理失败:', downloadError);
                        throw new Error(`无法准备第二张图片: ${downloadError.message}`);
                    }
                } else {
                    console.error('❌ 第二张图片对象无可用数据:', img2);
                    throw new Error('第二张图片文件不可用');
                }
            }
            
            const prompt = TaskManager.imagePrompts[group.ids[0]] || '';
            
            // 提交生成任务
            TaskManager.tasksStatus[uuid].message = '正在提交任务...';
            UI.refreshUI();
            
            const workflowName = isPair ? 'wan2_morph' : 'wan2_i2v';
            const response = await API.submitTask(workflowName, imageFilename, imageFilenameEnd, prompt, group.model, null, null, group.shotType);
            
            console.log('任务提交成功:', response);
            TaskManager.tasksStatus[uuid].message = '正在生成中...';
            TaskManager.tasksStatus[uuid].taskId = response.task_id;
            UI.refreshUI();
            
            // 开始轮询任务状态
            await this.pollTask(uuid, response.task_id);
            
        } catch (error) {
            console.error('任务执行失败:', error);
            TaskManager.clearTimer(uuid);
            
            const errorMsg = error.message || '未知错误';
            
            TaskManager.tasksStatus[uuid] = { 
                ...TaskManager.tasksStatus[uuid], 
                state: 'idle', 
                progress: 0, 
                error: errorMsg,
                message: `失败: ${errorMsg}`
            };
            UI.refreshUI();
            
            // 🔧 使用弹窗显示详细错误信息（如果不是用户主动取消）
            if (!errorMsg.includes('取消')) {
                alert(`❌ 任务执行失败\n\n错误详情：\n${errorMsg}\n\n可能的原因：\n- 图片上传失败\n- ComfyUI节点不可用\n- 网络连接问题\n- 文件格式或大小不符合要求`);
            }
            
            UI.showToast(`任务失败: ${errorMsg}`);
        }
    },
    
    // 轮询任务状态（完整版：带模拟进度动画）
    async pollTask(uuid, taskId) {
        const pollInterval = 2000;
        let lastProgress = 0;
        let simulatedProgress = 0;
        let simulationInterval = null;
        let timerUpdateInterval = null;
        let noProgressCounter = 0;
        let hasStartedSimulation = false; // 标记是否已启动模拟
        
        // 启动计时器更新（独立于进度，确保每秒更新）
        timerUpdateInterval = setInterval(() => {
            if (!TaskManager.tasksStatus[uuid]) {
                clearInterval(timerUpdateInterval);
                return;
            }
            this.updateProgressBar(uuid, TaskManager.tasksStatus[uuid].progress || 0);
        }, 1000);
        
        // 启动模拟进度动画（4秒走1%）
        const startSimulation = (currentProgress) => {
            if (simulationInterval) clearInterval(simulationInterval);
            simulatedProgress = currentProgress;
            hasStartedSimulation = true;
            
            simulationInterval = setInterval(() => {
                // 检查任务是否被删除
                if (!TaskManager.tasksStatus[uuid]) {
                    console.warn('⚠️ 任务已被删除，停止模拟进度:', uuid);
                    clearInterval(simulationInterval);
                    simulationInterval = null;
                    return;
                }
                
                // 模拟进度最多比真实进度高2%，且不超过95%
                const maxSimulated = Math.min(lastProgress + 2, 95);
                if (simulatedProgress < maxSimulated) {
                    // 每秒增加0.25%（4秒走1%）
                    simulatedProgress += 0.25;
                    TaskManager.tasksStatus[uuid].progress = simulatedProgress;
                }
            }, 1000);  // 每1秒更新一次
        };
        
        // 停止模拟进度动画
        const stopSimulation = () => {
            if (simulationInterval) {
                clearInterval(simulationInterval);
                simulationInterval = null;
            }
            if (timerUpdateInterval) {
                clearInterval(timerUpdateInterval);
                timerUpdateInterval = null;
            }
        };
        
        const poll = async () => {
            try {
                // 检查任务是否被删除
                if (!TaskManager.tasksStatus[uuid]) {
                    console.warn('⚠️ 任务已被删除，停止轮询:', uuid);
                    stopSimulation();
                    return;
                }
                
                const status = await API.getTaskStatus(taskId);
                const currentProgress = parseFloat(status.progress) || 0;
                
                console.log('📊 任务状态更新:', { 
                    taskId, 
                    status: status.status, 
                    progress: currentProgress,
                    noProgressCounter
                });
                
                // 检查任务是否失败
                if (status.status === 'failed') {
                    stopSimulation();
                    TaskManager.clearTimer(uuid);
                    const errorMsg = status.error || '生成失败（未知错误）';
                    console.error('❌ 任务失败:', errorMsg);
                    
                    // 🔧 使用弹窗显示详细错误信息
                    alert(`❌ 任务失败\n\n错误详情：\n${errorMsg}\n\n请检查：\n- ComfyUI节点是否在线\n- 图片文件大小是否超限\n- 网络连接是否正常`);
                    
                    throw new Error(errorMsg);
                }
                
                // 如果任务还没开始（进度为0且状态是queued），不启动模拟
                if (!hasStartedSimulation && currentProgress === 0 && status.status === 'queued') {
                    console.log('⏳ 任务排队中，暂不启动模拟进度');
                    setTimeout(poll, pollInterval);
                    return;
                }
                
                // 如果任务开始有进度了，启动模拟
                if (!hasStartedSimulation && currentProgress > 0) {
                    console.log('🚀 任务开始执行，启动模拟进度');
                    startSimulation(currentProgress);
                }
                
                if (status.status === 'completed') {
                    stopSimulation();
                    TaskManager.clearTimer(uuid);
                    console.log('✅ 任务完成:', status);
                    console.log('📊 任务结果详情:', JSON.stringify(status.result, null, 2));
                    
                    // 计算生成时间
                    const generateTime = TaskManager.getElapsedTime(uuid);
                    
                    // 提取视频 URL
                    let videoUrl = '';
                    if (status.result && status.result.videos && status.result.videos.length > 0) {
                        console.log('🎬 检测到视频结果，原始URL:', status.result.videos[0].url);
                        let relativeUrl = status.result.videos[0].url;
                        // 🔧 直接使用后端返回的URL，不做转换
                        const fullUrl = relativeUrl.startsWith('http') ? relativeUrl : `${API.baseURL}${relativeUrl}`;
                        videoUrl = fullUrl + (fullUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                        console.log('✅ 获取到视频 URL:', videoUrl);
                    } else if (status.result && status.result.images && status.result.images.length > 0) {
                        let relativeUrl = status.result.images[0].url;
                        // 🔧 直接使用后端返回的URL，不做转换
                        const fullUrl = relativeUrl.startsWith('http') ? relativeUrl : `${API.baseURL}${relativeUrl}`;
                        videoUrl = fullUrl + (fullUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                        console.log('✅ 获取到图片 URL:', videoUrl);
                    } else {
                        console.warn('⚠️ 没有找到视频或图片结果', status.result);
                    }
                    
                    // 获取现有视频数组和生成时间数组
                    const existingVideos = TaskManager.tasksStatus[uuid]?.videos || [];
                    const existingTimes = TaskManager.tasksStatus[uuid]?.videoGenerateTimes || [];
                    
                    // 🔍 调试日志：检查现有视频数组
                    console.log('📦 任务完成前的状态:', {
                        uuid,
                        taskId,
                        existingVideos: existingVideos.length,
                        existingVideoUrls: existingVideos.map(v => v?.substring(0, 50) + '...'),
                        newVideoUrl: videoUrl?.substring(0, 50) + '...'
                    });
                    
                    // 添加新视频到数组（最多保留5个）
                    const updatedVideos = [...existingVideos, videoUrl];
                    const updatedTimes = [...existingTimes, generateTime];
                    
                    console.log('✅ 视频数组已更新:', {
                        oldCount: existingVideos.length,
                        newCount: updatedVideos.length,
                        allVideos: updatedVideos.map(v => v?.substring(0, 50) + '...')
                    });
                    
                    if (updatedVideos.length > 5) {
                        updatedVideos.shift();
                        updatedTimes.shift();
                        UI.showToast('卡片已满（最多5个视频），已移除最早的视频');
                    }
                    
                    TaskManager.tasksStatus[uuid] = { 
                        ...TaskManager.tasksStatus[uuid], 
                        state: 'done', 
                        result: videoUrl,
                        videos: updatedVideos,
                        videoGenerateTimes: updatedTimes,  // 每个视频的生成时间
                        totalGenerationTime: generateTime,  // 总生成时间
                        progress: 100,
                        redoInProgress: false
                    };
                    
                    // 如果是放大任务完成，标记为已放大
                    const group = TaskManager.taskGroups.find(g => g.uuid === uuid);
                    if (group && group.isUpscaled) {
                        TaskManager.tasksStatus[uuid].isUpscaled = true;
                    }
                    
                    console.log('📹 视频数组更新:', updatedVideos.length, '个视频');
                    console.log('⏱️ 生成时间数组:', updatedTimes);
                    console.log('⏱️ 当前视频生成时间:', generateTime, '秒');
                    UI.refreshUI();
                    UI.showToast(`任务完成 (${generateTime}秒) - 当前${updatedVideos.length}个视频`);
                    
                    // 🆕 保存任务到数据库
                    const taskGroup = TaskManager.taskGroups.find(g => g.uuid === uuid);
                    await TaskManager.saveTaskToDatabase(uuid, {
                        task_id: status.task_id || task_id,
                        task_type: status.result?.task_type || taskGroup?.model || 'wan2_i2v',
                        prompt: TaskManager.imagePrompts[taskGroup?.ids[0]] || '',
                        videos: updatedVideos.map((url, idx) => ({
                            url: url.split('?')[0],  // 移除token参数
                            filename: url.split('/').pop().split('?')[0],
                            generateTime: updatedTimes[idx]
                        })),
                        generate_time: generateTime
                    });
                    
                    // 🆕 保存整个workspace会话
                    await TaskManager.saveSession();
                    
                } else {
                    // 如果后端进度有更新
                    if (currentProgress > lastProgress) {
                        noProgressCounter = 0;
                        stopSimulation();
                        TaskManager.tasksStatus[uuid].progress = currentProgress;
                        lastProgress = currentProgress;
                        UI.refreshUI();
                        
                        // 只有在任务真正开始（有进度）时才启动模拟
                        if (hasStartedSimulation || currentProgress > 0) {
                            startSimulation(currentProgress);
                        }
                    } else {
                        noProgressCounter++;
                        
                        // 超时检测：如果连续240次（480秒）没有进度更新，认为任务卡住或失败
                        if (noProgressCounter >= 240) {
                            console.error('❌ 任务超时：480秒无进度更新，停止轮询');
                            stopSimulation();
                            TaskManager.clearTimer(uuid);
                            throw new Error('任务超时或卡住（480秒无进度）');
                        }
                        
                        // 只有已经启动模拟的任务才进行强制推进
                        if (hasStartedSimulation) {
                            // 如果连续5次（10秒）没有进度，强制推进（仅在进度<50%时）
                            if (noProgressCounter >= 5 && lastProgress < 50) {
                                console.warn('⚠️ 长时间无进度更新，强制推进模拟进度');
                                const forcedProgress = Math.min(lastProgress + 10, 50);
                                lastProgress = forcedProgress;
                                stopSimulation();
                                startSimulation(forcedProgress);
                                noProgressCounter = 0;
                            }
                            
                            if (!simulationInterval) {
                                startSimulation(currentProgress);
                            }
                        }
                    }
                    
                    // 继续轮询
                    setTimeout(poll, pollInterval);
                }
            } catch (error) {
                console.error('轮询错误:', error);
                stopSimulation();
                TaskManager.clearTimer(uuid);
                
                // 如果任务不存在，可能是被清理或取消
                if (error.message === 'TASK_NOT_FOUND') {
                    console.warn('⚠️ 任务不存在（可能已被清理）:', taskId);
                    TaskManager.tasksStatus[uuid] = { 
                        ...TaskManager.tasksStatus[uuid], 
                        state: 'idle', 
                        progress: 0, 
                        error: '任务不存在或已被清理'
                    };
                    UI.refreshUI();
                    UI.showToast('任务不存在或已被清理');
                } else {
                    const errorMsg = error.message || '未知错误';
                    
                    TaskManager.tasksStatus[uuid] = { 
                        ...TaskManager.tasksStatus[uuid], 
                        state: 'idle', 
                        progress: 0, 
                        error: errorMsg
                    };
                    UI.refreshUI();
                    
                    // 🔧 使用弹窗显示详细错误信息
                    alert(`❌ 任务轮询失败\n\n错误详情：\n${errorMsg}\n\n建议：\n- 检查网络连接\n- 刷新页面重试\n- 查看浏览器控制台获取更多信息`);
                    
                    UI.showToast(`任务失败: ${errorMsg}`);
                }
            }
        };
        
        poll();
    },
    
    // 更新单个进度条（避免全局刷新）
    updateProgressBar(uuid, progress) {
        const timeStr = TaskManager.getElapsedTimeStr(uuid);
        
        // 更新标题栏的计时器（带图标）
        const headerTimers = document.querySelectorAll(`[data-uuid-header="${uuid}"]`);
        headerTimers.forEach(el => {
            el.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 loader-spin"></i> ${timeStr}`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
        
        // 更新视频卡片右上角的计时器（如果有）
        const timerElements = document.querySelectorAll(`.progress-text[data-uuid="${uuid}"]`);
        timerElements.forEach(el => {
            el.textContent = timeStr;
        });
        
        // 更新框内的进度百分比
        const progressPercentElements = document.querySelectorAll(`[data-task-uuid="${uuid}"] .progress-percent`);
        progressPercentElements.forEach(el => {
            el.textContent = `${Math.round(progress)}%`;
        });
        
        // 更新进度条宽度
        const progressBars = document.querySelectorAll(`[data-task-uuid="${uuid}"] .progress-bar`);
        progressBars.forEach(bar => {
            bar.style.width = `${progress}%`;
        });
    },
    
    // 加载历史任务（完整版本）
    async loadHistoryTasks() {
        // 防止重复加载
        if (this._isLoadingHistory) {
            console.log('⏳ 正在加载历史任务，跳过重复请求');
            return;
        }
        
        // 如果已加载过，直接返回
        if (this._historyLoaded && TaskManager.taskGroups.length > 0) {
            console.log('✅ 历史任务已缓存，无需重新加载');
            return;
        }
        
        this._isLoadingHistory = true;
        
        // ✅ 先保存原始前端任务（在try块外部，确保catch块可以访问）
        const originalTaskGroups = [...TaskManager.taskGroups];
        const originalUploadedImages = [...TaskManager.uploadedImages];
        const originalTasksStatus = {...TaskManager.tasksStatus};
        const originalImagePrompts = {...TaskManager.imagePrompts};
        
        try {
            console.log('🔄 正在加载历史任务...');
            
            const result = await API.getTasks(50);
            const tasks = result.tasks || [];
            
            console.log(`从后端加载了 ${tasks.length} 个历史任务`);
            
            // 🆕 调试：输出第一个任务的数据结构
            if (tasks.length > 0) {
                console.log('📋 示例任务数据:', tasks[0]);
                console.log('  - task_type:', tasks[0].task_type);
                console.log('  - status:', tasks[0].status);
                console.log('  - result:', tasks[0].result);
                console.log('  - data:', tasks[0].data);
            }
            
            // 如果后端没有任务，且前端也没有任务，显示空状态
            if (tasks.length === 0 && TaskManager.taskGroups.length === 0) {
                console.log('✅ 后端和前端都没有任务，显示空状态');
                this._historyLoaded = true;
                return;
            }
            
            // 如果后端有任务，清空前端任务准备加载后端数据
            if (tasks.length > 0) {
                if (TaskManager.taskGroups.length > 0) {
                    console.warn(`⚠️ 任务数据冲突：后端有 ${tasks.length} 个任务，前端有 ${TaskManager.taskGroups.length} 个任务`);
                    console.warn(`⚠️ 将清空前端任务，加载后端数据（后端数据优先级更高）`);
                    console.warn(`⚠️ 前端任务来源：数据库会话或导入的任务`);
                }
                // 清空前端任务
                TaskManager.taskGroups = [];
                TaskManager.uploadedImages = [];
                TaskManager.tasksStatus = {};
                TaskManager.imagePrompts = {};
            } else if (tasks.length === 0 && TaskManager.taskGroups.length > 0) {
                // 🔧 后端没有任务，但前端有任务（来自数据库会话）
                console.warn(`⚠️ 后端无任务，但前端有 ${TaskManager.taskGroups.length} 个任务（来自数据库会话）`);
                console.warn(`⚠️ 可能原因：后端Redis数据丢失、后端重启、或任务被删除`);
                console.warn(`⚠️ 保留前端任务，不清空`);
            }
            
            // 重建任务组和状态（🔴 只加载视频任务，纯图片任务不显示在工作台）
            let videoTaskCount = 0;
            let skippedImageTaskCount = 0;
            
            for (const task of tasks) {
                // 🔴 检查任务类型：只加载视频相关任务（i2v, morph, upscale, voice, 以及新模型）
                const videoTaskTypes = ['i2v', 'morph', 'upscale', 'voice', 'minimax_i2v', 'minimax_morph', 
                                       'sora2_i2v', 'sora2_morph', 'veo_i2v', 'veo_morph', 'wan2_i2v', 'wan2_morph', 'wan26_i2v'];
                
                // 🆕 修复：task_type 是顶层字段，不是 task.data.task_type
                const isVideoTask = videoTaskTypes.some(type => task.task_type && task.task_type.includes(type));
                
                if (!isVideoTask) {
                    // 跳过纯图片任务（如ComfyUI图片生成）
                    skippedImageTaskCount++;
                    continue;
                }
                
                // 🔴 对于视频任务，即使没完成或没结果，也显示（但标记状态）
                // const hasVideo = task.status === 'completed' && task.result && 
                //                 (task.result.videos && task.result.videos.length > 0);
                
                // if (!hasVideo) {
                //     // 跳过纯图片任务或未完成任务
                //     skippedImageTaskCount++;
                //     continue;
                // }
                
                const uuid = UI.generateUUID();
                
                // 从任务数据中提取图片信息
                const imageFilename = task.data.image_path || task.data.uploaded_image;
                const imageFilenameEnd = task.data.image_path_end || task.data.uploaded_image_end;
                
                // 🔴 允许没有图片信息的视频任务（稍后从视频抽帧）
                // if (!imageFilename) {
                //     console.warn('任务没有图片信息，跳过:', task.task_id);
                //     continue;
                // }
                
                videoTaskCount++;
                
                // 🔴 重建图片数据 - 如果没有图片信息，从视频抽帧
                let imgId1 = null;
                
                if (imageFilename) {
                    // 有图片文件名（可能是file_id或旧的filename）
                    // 优先用fileId查找，然后用filename查找（兼容旧数据）
                    const existingImg = TaskManager.uploadedImages.find(img => 
                        img.fileId === imageFilename || img.filename === imageFilename
                    );
                    if (existingImg) {
                        imgId1 = existingImg.id;
                    } else {
                        imgId1 = UI.generateUUID();
                        // 优先尝试从持久化存储读取
                        let storageImageUrl = '';
                        let needsExtraction = false;
                        
                        // 检查是否是file_id格式（如file_abc123）
                        if (imageFilename.startsWith('file_')) {
                            // 新格式：file_id，使用文件下载API
                            storageImageUrl = `${API.baseURL}/api/files/${imageFilename}/download?token=${Auth.getToken()}`;
                        } else if (imageFilename.startsWith('/storage/')) {
                            // 持久化存储路径
                            storageImageUrl = `${API.baseURL}${imageFilename}`;
                            // 异步检查文件是否存在
                            fetch(storageImageUrl, { method: 'HEAD' }).then(response => {
                                if (!response.ok) {
                                    console.warn(`⚠️ 图片不存在: ${imageFilename}，将从视频抽帧`);
                                    const img = TaskManager.uploadedImages.find(i => i.id === imgId1);
                                    if (img && !img.needsFrameExtraction) {
                                        img.needsFrameExtraction = true;
                                        img.extractFromVideo = uuid;
                                        // 延迟抽帧以便UI先渲染
                                        setTimeout(() => {
                                            Workspace.extractFramesFromVideos();
                                        }, 500);
                                    }
                                }
                            }).catch(() => {});
                        } else if (imageFilename.includes('_image_') || imageFilename.includes('_frame_')) {
                            // 看起来像持久化文件名，尝试持久化路径
                            storageImageUrl = `${API.baseURL}/storage/image/admin/${imageFilename}`;
                        } else {
                            // ComfyUI临时文件，直接标记为需要抽帧
                            storageImageUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23334155" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" fill="%23cbd5e1" font-size="16"%3E等待抽帧...%3C/text%3E%3C/svg%3E';
                            needsExtraction = true;
                        }
                        
                        TaskManager.uploadedImages.push({
                            id: imgId1,
                            fileId: imageFilename.startsWith('file_') ? imageFilename : null,  // 保存file_id
                            filename: imageFilename,  // 兼容旧数据
                            url: storageImageUrl,
                            storageUrl: imageFilename.startsWith('/storage/') ? imageFilename : undefined,  // 保存storageUrl用于任务提交
                            uploadTime: Date.now(),
                            needsFrameExtraction: needsExtraction,
                            extractFromVideo: needsExtraction ? uuid : undefined
                        });
                    }
                } else {
                    // 🔴 没有图片信息，使用占位符，稍后从视频抽帧
                    imgId1 = UI.generateUUID();
                    TaskManager.uploadedImages.push({
                        id: imgId1,
                        filename: `video_frame_${uuid}`,
                        url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23334155" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" fill="%23cbd5e1" font-size="16"%3E等待抽帧...%3C/text%3E%3C/svg%3E',
                        uploadTime: Date.now(),
                        needsFrameExtraction: true,
                        extractFromVideo: uuid  // 关联到任务UUID，稍后从视频抽帧
                    });
                }
                
                // 创建任务组（使用图片ID）
                const group = {
                    uuid: uuid,
                    ids: [imgId1],
                    model: task.data.model || 'Wan2'
                };
                
                // 🔴 处理结束帧（如果是Morph任务）
                const isMorphTask = group.ids.length === 0;  // 如果当前没有添加ID，说明可能是Morph
                
                if (imageFilenameEnd) {
                    let imgId2 = null;
                    // 优先用fileId查找，然后用filename查找（兼容旧数据）
                    const existingImg2 = TaskManager.uploadedImages.find(img => 
                        img.fileId === imageFilenameEnd || img.filename === imageFilenameEnd
                    );
                    if (existingImg2) {
                        imgId2 = existingImg2.id;
                    } else {
                        imgId2 = UI.generateUUID();
                        // 优先尝试从持久化存储读取
                        let storageImageUrl = '';
                        let needsExtraction = false;
                        
                        // 检查是否是file_id格式（如file_abc123）
                        if (imageFilenameEnd.startsWith('file_')) {
                            // 新格式：file_id，使用文件下载API
                            storageImageUrl = `${API.baseURL}/api/files/${imageFilenameEnd}/download?token=${Auth.getToken()}`;
                        } else if (imageFilenameEnd.startsWith('/storage/')) {
                            // 持久化存储路径
                            storageImageUrl = `${API.baseURL}${imageFilenameEnd}`;
                            // 异步检查文件是否存在
                            fetch(storageImageUrl, { method: 'HEAD' }).then(response => {
                                if (!response.ok) {
                                    console.warn(`⚠️ 结束帧图片不存在: ${imageFilenameEnd}，将从视频抽帧`);
                                    const img = TaskManager.uploadedImages.find(i => i.id === imgId2);
                                    if (img && !img.needsFrameExtraction) {
                                        img.needsFrameExtraction = true;
                                        img.extractFromVideo = uuid;
                                        img.extractLastFrame = true;  // 抽取最后一帧
                                        setTimeout(() => {
                                            Workspace.extractFramesFromVideos();
                                        }, 500);
                                    }
                                }
                            }).catch(() => {});
                        } else if (imageFilenameEnd.includes('_image_') || imageFilenameEnd.includes('_frame_')) {
                            // 看起来像持久化文件名
                            storageImageUrl = `${API.baseURL}/storage/image/admin/${imageFilenameEnd}`;
                        } else {
                            // ComfyUI临时文件，标记为需要抽帧
                            storageImageUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23334155" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" fill="%23cbd5e1" font-size="16"%3E等待抽帧...%3C/text%3E%3C/svg%3E';
                            needsExtraction = true;
                        }
                        
                        TaskManager.uploadedImages.push({
                            id: imgId2,
                            fileId: imageFilenameEnd.startsWith('file_') ? imageFilenameEnd : null,  // 保存file_id
                            filename: imageFilenameEnd,  // 兼容旧数据
                            url: storageImageUrl,
                            storageUrl: imageFilenameEnd.startsWith('/storage/') ? imageFilenameEnd : undefined,  // 保存storageUrl用于任务提交
                            uploadTime: Date.now(),
                            needsFrameExtraction: needsExtraction,
                            extractFromVideo: needsExtraction ? uuid : undefined,
                            extractLastFrame: needsExtraction ? true : undefined  // 标记抽取最后一帧
                        });
                    }
                    group.ids.push(imgId2);
                } else if (isMorphTask && group.ids.length === 1) {
                    // Morph任务但没有结束帧，使用占位符
                    const imgId2 = UI.generateUUID();
                    TaskManager.uploadedImages.push({
                        id: imgId2,
                        filename: `video_frame_end_${uuid}`,
                        url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23334155" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" fill="%23cbd5e1" font-size="16"%3E等待抽帧...%3C/text%3E%3C/svg%3E',
                        uploadTime: Date.now(),
                        needsFrameExtraction: true,
                        extractFromVideo: uuid,
                        extractLastFrame: true  // 标记抽取最后一帧
                    });
                    group.ids.push(imgId2);
                }
                
                TaskManager.taskGroups.push(group);
                
                // 设置提示词（使用图片ID）
                TaskManager.imagePrompts[imgId1] = task.data.prompt || '';
                
                // 设置任务状态
                if (task.status === 'completed' && task.result) {
                    // 提取视频 URL
                    let videoUrl = '';
                    if (task.result.videos && task.result.videos.length > 0) {
                        let relativeUrl = task.result.videos[0].url;
                        // 兼容两种格式：自动转换单数为复数（用于符号链接）
                        if (relativeUrl.startsWith('/storage/video/')) {
                            relativeUrl = relativeUrl.replace('/storage/video/', '/storage/videos/');
                        } else if (relativeUrl.startsWith('/storage/image/')) {
                            relativeUrl = relativeUrl.replace('/storage/image/', '/storage/images/');
                        }
                        const fullUrl = relativeUrl.startsWith('http') ? relativeUrl : `${API.baseURL}${relativeUrl}`;
                        // 添加token参数
                        videoUrl = fullUrl + (fullUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                    } else if (task.result.images && task.result.images.length > 0) {
                        let relativeUrl = task.result.images[0].url;
                        // 兼容两种格式：自动转换单数为复数（用于符号链接）
                        if (relativeUrl.startsWith('/storage/video/')) {
                            relativeUrl = relativeUrl.replace('/storage/video/', '/storage/videos/');
                        } else if (relativeUrl.startsWith('/storage/image/')) {
                            relativeUrl = relativeUrl.replace('/storage/image/', '/storage/images/');
                        }
                        const fullUrl = relativeUrl.startsWith('http') ? relativeUrl : `${API.baseURL}${relativeUrl}`;
                        // 添加token参数
                        videoUrl = fullUrl + (fullUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                    }
                    
                    // 检查URL类型（静默处理，减少日志输出）
                    const isStorageUrl = videoUrl.includes('/storage/');
                    const isProxyUrl = videoUrl.includes('/api/proxy/');
                    
                    // 如果是临时URL，标记为可能过期
                    const isExpired = isProxyUrl;
                    
                    TaskManager.tasksStatus[uuid] = {
                        state: 'done',
                        progress: 100,
                        result: videoUrl,
                        videos: videoUrl ? [videoUrl] : [],  // 初始化videos数组
                        videoGenerateTimes: [],  // 历史任务没有生成时间数据
                        selected: false,
                        taskId: task.task_id,
                        isExpired: isExpired,  // 标记是否使用临时URL
                        redoInProgress: false
                    };
                    
                    // ComfyUI代理URL可以正常使用，不需要警告
                    // if (isExpired) {
                    //     console.warn(`⚠️ 任务 ${uuid} 使用临时URL，服务器重启后可能失效`);
                    // }
                } else if (task.status === 'processing' || task.status === 'queued') {
                    // 检查任务是否超时（创建时间超过10分钟）
                    const taskAge = task.created_at ? (Date.now() - new Date(task.created_at).getTime()) / 1000 : 0;
                    const isTaskStale = taskAge > 600; // 10分钟
                    
                    if (isTaskStale) {
                        console.warn(`⚠️ 任务创建时间过久（${Math.floor(taskAge/60)}分钟），不启动轮询:`, task.task_id);
                        TaskManager.tasksStatus[uuid] = {
                            state: 'idle',
                            progress: 0,
                            result: '',
                            error: '任务超时（超过10分钟未完成）',
                            selected: false,
                            taskId: task.task_id
                        };
                    } else {
                        TaskManager.tasksStatus[uuid] = {
                            state: 'running',
                            progress: task.progress || 0,
                            result: '',
                            selected: false,
                            taskId: task.task_id
                        };
                        
                        // 先验证任务是否真的存在，再决定是否轮询
                        (async () => {
                            try {
                                await API.getTaskStatus(task.task_id);
                                // 任务存在，继续轮询
                                this.pollTask(uuid, task.task_id);
                            } catch (error) {
                                if (error.message === 'TASK_NOT_FOUND') {
                                    console.warn('⚠️ 历史任务已不存在，标记为失败:', task.task_id);
                                    TaskManager.tasksStatus[uuid] = {
                                        state: 'idle',
                                        progress: 0,
                                        result: '',
                                        error: '任务已被清理',
                                        selected: false,
                                        taskId: task.task_id
                                    };
                                    UI.refreshUI();
                                } else {
                                    console.error('验证任务失败:', error);
                                    // 其他错误，仍尝试轮询
                                    this.pollTask(uuid, task.task_id);
                                }
                            }
                        })();
                    }
                } else if (task.status === 'failed') {
                    TaskManager.tasksStatus[uuid] = {
                        state: 'idle',
                        progress: 0,
                        result: '',
                        error: task.error || '生成失败',
                        selected: false,
                        taskId: task.task_id
                    };
                } else {
                    TaskManager.tasksStatus[uuid] = {
                        state: 'idle',
                        progress: 0,
                        result: '',
                        selected: false,
                        taskId: task.task_id
                    };
                }
            }
            
            console.log(`✅ 历史任务加载完成: 加载 ${videoTaskCount} 个视频任务，跳过 ${skippedImageTaskCount} 个图片任务`);
            console.log('💡 提示：纯图片任务只在"历史记录"中显示，工作台只显示视频任务');
            
            // ✅ 已废弃：抽帧图片信息现在通过数据库会话管理
            // 所有图片信息已在 TaskManager.loadSession() 中加载
            const uploadedTasks = [];  // 废弃localStorage
            if (uploadedTasks.length > 0) {
                console.log(`🔄 尝试从数据库会话恢复 ${uploadedTasks.length} 个任务的抽帧图片`);
                
                let restoredCount = 0;
                
                // 为每个已保存的抽帧图片创建一个映射
                const frameImageMap = new Map(); // key: 视频URL（无token）, value: 抽帧图片信息
                
                // 🔧 辅助函数：去除URL中的token参数
                const removeToken = (url) => {
                    if (!url) return '';
                    return url.split('?')[0]; // 只保留?之前的部分
                };
                
                uploadedTasks.forEach(savedTask => {
                    if (savedTask.status && savedTask.status.videos && savedTask.status.videos.length > 0) {
                        const videoUrl = removeToken(savedTask.status.videos[0]);
                        if (videoUrl && savedTask.images && savedTask.images.length > 0) {
                            // 保存这个视频对应的抽帧图片信息
                            frameImageMap.set(videoUrl, savedTask.images);
                            console.log(`💾 数据库会话映射: ${videoUrl} -> ${savedTask.images.length} 张图片`);
                        }
                    }
                });
                
                console.log(`💾 数据库会话映射完成，共 ${frameImageMap.size} 个视频`);
                
                // 遍历当前任务，匹配视频URL，恢复抽帧图片
                TaskManager.taskGroups.forEach(group => {
                    const status = TaskManager.tasksStatus[group.uuid];
                    if (status && status.videos && status.videos.length > 0) {
                        const videoUrl = removeToken(status.videos[0]);
                        const savedImages = frameImageMap.get(videoUrl);
                        
                        console.log(`🔍 尝试匹配: ${videoUrl} -> ${savedImages ? '✅ 找到缓存' : '❌ 无缓存'}`);
                        
                        if (savedImages) {
                            // 找到匹配的抽帧图片，恢复到当前任务
                            group.ids.forEach((imgId, index) => {
                                const img = TaskManager.uploadedImages.find(i => i.id === imgId);
                                const savedImg = savedImages[index];
                                
                                if (img && savedImg && savedImg.storageUrl) {
                                    // 使用数据库会话中的抽帧图片URL
                                    img.url = savedImg.url;
                                    img.storageUrl = savedImg.storageUrl;
                                    img.filename = savedImg.filename;
                                    img.needsFrameExtraction = false;
                                    delete img.extractFromVideo;
                                    delete img.extractLastFrame;
                                    restoredCount++;
                                    console.log(`✅ 恢复抽帧图片: ${savedImg.storageUrl}`);
                                }
                            });
                        }
                    }
                });
                
                console.log(`✅ 成功恢复 ${restoredCount} 个抽帧图片`);
                
                // ✅ 清理localStorage中多余的任务（没有匹配到后端任务的）
                // 🔧 修复：不自动清理，保留所有任务（避免后端数据丢失时误删本地任务）
                if (restoredCount < uploadedTasks.length) {
                    const unusedCount = uploadedTasks.length - restoredCount;
                    console.warn(`⚠️ 检测到 ${unusedCount} 个任务未匹配到后端数据`);
                    console.warn(`⚠️ 可能原因：后端Redis数据丢失、任务被删除`);
                    
                    // ✅ 数据库会话自动管理，无需手动清理
                    console.log(`💾 数据库会话自动管理，无需手动清理`);
                    
                    // 只更新已匹配任务的抽帧图片，不删除未匹配的任务
                }
            }
            
            UI.refreshUI();
            
            // 🔴 检查图片URL是否有效，对于404的图片，标记为需要抽帧
            setTimeout(() => {
                TaskManager.uploadedImages.forEach(img => {
                    // 检查图片URL是否看起来无效（缺少日期目录）
                    if (img.url && !img.url.includes('data:image') && !img.url.includes('/202')) {
                        // 看起来像旧的文件名（没有日期目录），可能会404
                        console.warn(`⚠️ 检测到可能无效的图片URL: ${img.url}`);
                        // 查找关联的任务
                        const group = TaskManager.taskGroups.find(g => g.ids.includes(img.id));
                        if (group) {
                            const status = TaskManager.tasksStatus[group.uuid];
                            if (status && status.videos && status.videos.length > 0) {
                                // 标记为需要抽帧
                                img.needsFrameExtraction = true;
                                img.extractFromVideo = group.uuid;
                                // 判断是否是结束帧（第二张图片）
                                img.extractLastFrame = (group.ids.indexOf(img.id) === 1);
                                console.log(`🔄 标记图片需要重新抽帧: ${img.id}, 最后一帧: ${img.extractLastFrame}`);
                            }
                        }
                    }
                });
                
                // 执行抽帧（如果需要）
                const needsExtraction = TaskManager.uploadedImages.some(img => img.needsFrameExtraction);
                if (needsExtraction) {
                    // 有图片需要抽帧，抽帧完成后隐藏loading
                    this.extractFramesFromVideos().then(() => {
                        // 再等待1秒确保图片渲染完成
                        setTimeout(() => {
                            this.hideLoadingOverlay();
                        }, 1000);
                    });
                } else {
                    // 不需要抽帧，直接隐藏loading
                    setTimeout(() => {
                        this.hideLoadingOverlay();
                    }, 1000);
                }
            }, 1000);  // 延迟1秒，让UI先渲染
            
            // 标记为已加载
            this._historyLoaded = true;
            
            // 🆕 先加载workspace会话（任务组、图片）
            const sessionLoaded = await TaskManager.loadSession();
            
            // 🆕 然后加载视频任务结果
            await TaskManager.loadTasksFromDatabase();
            
            if (TaskManager.taskGroups.length > 0) {
                const message = sessionLoaded 
                    ? `✅ 已恢复会话: ${TaskManager.taskGroups.length} 个任务` 
                    : `✅ 已加载 ${TaskManager.taskGroups.length} 个历史任务`;
                UI.showToast(message);
            }
        } catch (error) {
            console.error('❌ 加载历史任务失败:', error);
            
            // 🔧 恢复原始前端任务（避免数据丢失）
            if (typeof originalTaskGroups !== 'undefined') {
                console.log('🔄 恢复原始前端任务（后端加载失败）');
                TaskManager.taskGroups = originalTaskGroups;
                TaskManager.uploadedImages = originalUploadedImages;
                TaskManager.tasksStatus = originalTasksStatus;
                TaskManager.imagePrompts = originalImagePrompts;
                UI.refreshUI();
            }
            
            // 检查是否是401错误（token失效）
            if (error.message && error.message.includes('401')) {
                console.error('❌ Token已失效，请重新登录');
                UI.showToast('登录已过期，请重新登录');
                // 3秒后跳转到登录页
                setTimeout(() => {
                    localStorage.removeItem('auth_token');
                    localStorage.removeItem('username');
                    window.location.href = '/login.html';
                }, 3000);
            } else {
                UI.showToast('加载历史任务失败: ' + error.message);
            }
        } finally {
            this._isLoadingHistory = false;
        }
    },
    
    // 强制重新加载历史任务
    async reloadHistoryTasks() {
        console.log('🔄 强制重新加载历史任务...');
        
        // 清除缓存标志，强制重新加载
        this._historyLoaded = false;
        this._isLoadingHistory = false;
        
        // 询问用户确认
        if (TaskManager.taskGroups.length > 0) {
            if (!confirm(`当前有 ${TaskManager.taskGroups.length} 个任务，重新加载会清空所有任务并从后端重新获取历史记录。\n\n确定要继续吗？`)) {
                return;
            }
        }
        
        // 先清空所有任务
        TaskManager.clearAll();
        UI.refreshUI();
        
        // 重新加载
        try {
            const result = await API.getTasks(50);
            const tasks = result.tasks || [];
            
            console.log(`重新加载了 ${tasks.length} 个历史任务`);
            
            // 重建任务组和状态（复用loadHistoryTasks的逻辑）
            for (const task of tasks) {
                const uuid = UI.generateUUID();
                
                const imageFilename = task.data.image_path || task.data.uploaded_image;
                const imageFilenameEnd = task.data.image_path_end || task.data.uploaded_image_end;
                
                if (!imageFilename) {
                    console.warn('任务没有图片信息，跳过:', task.task_id);
                    continue;
                }
                
                // 重建图片
                let imgId1 = UI.generateUUID();
                const imageUrl = `${API.baseURL}/api/proxy/comfyui/view?filename=${encodeURIComponent(imageFilename)}&subfolder=&type=input&token=${Auth.getToken()}`;
                TaskManager.uploadedImages.push({
                    id: imgId1,
                    filename: imageFilename,
                    url: imageUrl,
                    uploadTime: Date.now()
                });
                
                const group = {
                    uuid: uuid,
                    ids: [imgId1],
                    model: task.data.model || 'Wan2'
                };
                
                if (imageFilenameEnd) {
                    let imgId2 = UI.generateUUID();
                    const imageUrl2 = `${API.baseURL}/api/proxy/comfyui/view?filename=${encodeURIComponent(imageFilenameEnd)}&subfolder=&type=input&token=${Auth.getToken()}`;
                    TaskManager.uploadedImages.push({
                        id: imgId2,
                        filename: imageFilenameEnd,
                        url: imageUrl2,
                        uploadTime: Date.now()
                    });
                    group.ids.push(imgId2);
                }
                
                TaskManager.taskGroups.push(group);
                TaskManager.imagePrompts[imgId1] = task.data.prompt || '';
                
                // 只加载已完成的任务
                if (task.status === 'completed' && task.result) {
                    let videoUrl = '';
                    if (task.result.videos && task.result.videos.length > 0) {
                        let relativeUrl = task.result.videos[0].url;
                        if (relativeUrl.startsWith('/storage/video/')) {
                            relativeUrl = relativeUrl.replace('/storage/video/', '/storage/videos/');
                        } else if (relativeUrl.startsWith('/storage/image/')) {
                            relativeUrl = relativeUrl.replace('/storage/image/', '/storage/images/');
                        }
                        const fullUrl = relativeUrl.startsWith('http') ? relativeUrl : `${API.baseURL}${relativeUrl}`;
                        videoUrl = fullUrl + (fullUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                    }
                    
                    TaskManager.tasksStatus[uuid] = {
                        state: 'done',
                        progress: 100,
                        result: videoUrl,
                        videos: videoUrl ? [videoUrl] : [],
                        videoGenerateTimes: [],  // 历史任务没有生成时间数据
                        selected: false,
                        taskId: task.task_id
                    };
                }
            }
            
            UI.refreshUI();
            UI.showToast(`✅ 重新加载完成，共 ${TaskManager.taskGroups.length} 个任务`);
            console.log('✅ 历史任务重新加载完成');
        } catch (error) {
            console.error('重新加载历史任务失败:', error);
            UI.showToast('重新加载失败: ' + error.message);
        }
    },
    
    // ✅ 已废弃：从数据库强制重新加载会话
    async forceRestoreFromLocalStorage() {
        console.log('🔄 重新加载数据库会话...');
        
        try {
            // 清空当前任务
            TaskManager.taskGroups = [];
            TaskManager.uploadedImages = [];
            TaskManager.tasksStatus = {};
            TaskManager.imagePrompts = {};
            
            // 从数据库重新加载
            await TaskManager.loadSession();
            
            UI.refreshUI();
            UI.showToast(`✅ 已从数据库重新加载会话`);
            
            console.log(`✅ 重新加载完成: ${TaskManager.taskGroups.length} 个任务组, ${TaskManager.uploadedImages.length} 张图片`);
        } catch (error) {
            console.error('重新加载会话失败:', error);
            UI.showToast('重新加载失败: ' + error.message);
        }
    },
    
    // 显示任务来源信息
    showTaskSource() {
        const totalTasks = TaskManager.taskGroups.length;
        const completedTasks = TaskManager.taskGroups.filter(g => 
            TaskManager.tasksStatus[g.uuid]?.state === 'done'
        ).length;
        const runningTasks = TaskManager.taskGroups.filter(g => 
            TaskManager.tasksStatus[g.uuid]?.state === 'running'
        ).length;
        const pendingTasks = totalTasks - completedTasks - runningTasks;
        
        const hasHistoryTasks = TaskManager.taskGroups.some(g => 
            TaskManager.tasksStatus[g.uuid]?.taskId
        );
        
        let message = `📊 当前任务状态：\n\n`;
        message += `总任务数：${totalTasks}\n`;
        message += `已完成：${completedTasks}\n`;
        message += `进行中：${runningTasks}\n`;
        message += `待执行：${pendingTasks}\n\n`;
        
        if (hasHistoryTasks) {
            message += `📜 包含历史任务（从后端加载）\n\n`;
        } else {
            message += `📁 当前为新上传任务\n\n`;
        }
        
        message += `💡 提示：\n`;
        message += `- 蓝色刷新按钮：清空当前任务并重新加载历史记录\n`;
        message += `- 历史记录页面：查看后端保存的所有任务\n`;
        message += `- 工作台：当前操作的任务（可能包含未保存的新任务）`;
        
        alert(message);
    },
    
    // 批量执行（修改版：检查待处理任务）
    generateAll() {
        if (TaskManager.taskGroups.length === 0) return;
        
        // 检查是否有未完成的任务
        const hasPending = TaskManager.taskGroups.some(g => 
            !TaskManager.tasksStatus[g.uuid] || TaskManager.tasksStatus[g.uuid].state !== 'done'
        );
        
        if (hasPending) {
            // 弹出确认框
            this.openBatchExecuteModal();
        } else {
            // 如果都完成了，直接提示
            UI.showToast('所有任务已完成');
        }
    },
    
    // 执行选中
    generateSelected() {
        let selectedUuids = [];
        TaskManager.taskGroups.forEach((group) => {
            if (TaskManager.tasksStatus[group.uuid] && TaskManager.tasksStatus[group.uuid].selected) {
                selectedUuids.push(group.uuid);
            }
        });
        
        if (selectedUuids.length === 0) {
            UI.showToast('请先勾选任务');
            return;
        }
        
        selectedUuids.forEach(uuid => this.runTask(uuid));
        UI.showToast(`开始执行 ${selectedUuids.length} 个任务`);
    },
    
    // ==================== 模态框 ====================
    
    // 批量执行模态框
    openBatchExecuteModal() {
        const modal = document.getElementById('batchExecuteModal');
        const modalContent = document.getElementById('batchExecuteModalContent');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modalContent.classList.remove('scale-95');
            modalContent.classList.add('scale-100');
        }, 10);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    closeBatchExecuteModal(autoUpscale) {
        this.isBatchAutoUpscale = autoUpscale;
        
        // 关闭模态框
        const modal = document.getElementById('batchExecuteModal');
        const modalContent = document.getElementById('batchExecuteModalContent');
        modal.classList.add('opacity-0');
        modalContent.classList.remove('scale-100');
        modalContent.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
        
        // 开始执行
        this.startBatchExecution();
    },
    
    async startBatchExecution() {
        UI.showToast('已开始批量执行');
        
        // 找出所有需要执行的任务（非 done 状态）
        const pendingUuids = TaskManager.taskGroups
            .filter(g => !TaskManager.tasksStatus[g.uuid] || TaskManager.tasksStatus[g.uuid].state !== 'done')
            .map(g => g.uuid);
        
        // 并行执行生成任务
        const promises = pendingUuids.map(uuid => this.runTask(uuid));
        await Promise.all(promises);
        
        // 如果需要自动放大
        if (this.isBatchAutoUpscale) {
            UI.showToast('生成完成，开始自动放大...');
            await this.batchUpscale();
        }
    },
    
    // 批量放大
    async batchUpscale() {
        const uuids = [];
        // 优先处理选中的已完成且未放大的任务
        TaskManager.taskGroups.forEach((group) => {
            const status = TaskManager.tasksStatus[group.uuid];
            if (status && status.selected && status.state === 'done' && !status.isUpscaled) {
                uuids.push(group.uuid);
            }
        });
        
        // 如果没有选中的，则处理所有已完成且未放大的任务
        if (uuids.length === 0) {
            TaskManager.taskGroups.forEach((group) => {
                const status = TaskManager.tasksStatus[group.uuid];
                if (status && status.state === 'done' && !status.isUpscaled) {
                    uuids.push(group.uuid);
                }
            });
        }
        
        if (uuids.length === 0) {
            UI.showToast('没有可放大的视频（未放大的已完成任务）');
            return;
        }
        
        UI.showToast(`开始批量放大 ${uuids.length} 个视频`);
        
        // 顺序执行
        for (const uuid of uuids) {
            await this.handleUpscale(uuid);
            // 简单的延时，避免请求过快
            await new Promise(r => setTimeout(r, 1000));
        }
    },
    
    // 清空过期任务
    clearExpiredTasks() {
        const result = TaskManager.clearExpiredTasks();
        if (result.count === 0) {
            UI.showToast(result.message);
            return;
        }
        
        if (!confirm(`确定要删除 ${result.count} 个临时文件任务吗？\n\n这些任务使用临时URL，服务器重启后会失效。\n建议删除后重新生成，新视频会自动保存到持久化存储。`)) {
            return;
        }
        
        const actualResult = TaskManager.clearExpiredTasks();
        UI.refreshUI();
        UI.showToast(actualResult.message);
    },
    
    // 删除视频
    deleteVideo(uuid, videoIndex) {
        const status = TaskManager.tasksStatus[uuid];
        if (!status || !status.videos || videoIndex >= status.videos.length) {
            console.error('❌ 视频不存在:', uuid, videoIndex);
            return;
        }
        
        if (!confirm('确定要删除此视频吗？')) return;
        
        // 删除视频
        status.videos.splice(videoIndex, 1);
        
        // 同步删除对应的生成时间
        if (status.videoGenerateTimes && status.videoGenerateTimes.length > videoIndex) {
            status.videoGenerateTimes.splice(videoIndex, 1);
        }
        
        // 如果删除后没有视频了，完全删除该任务
        if (status.videos.length === 0) {
            console.log(`🗑️ 删除所有视频，移除任务: ${uuid}`);
            
            // 1. 删除任务状态
            delete TaskManager.tasksStatus[uuid];
            
            // 2. 删除任务组
            const groupIndex = TaskManager.taskGroups.findIndex(g => g.uuid === uuid);
            if (groupIndex !== -1) {
                const group = TaskManager.taskGroups[groupIndex];
                
                // 3. 删除关联的图片
                group.ids.forEach(id => {
                    const imgIndex = TaskManager.uploadedImages.findIndex(i => i.id === id);
                    if (imgIndex !== -1) {
                        TaskManager.uploadedImages.splice(imgIndex, 1);
                    }
                    // 4. 删除提示词
                    delete TaskManager.imagePrompts[id];
                });
                
                // 5. 移除任务组
                TaskManager.taskGroups.splice(groupIndex, 1);
            }
            
            // 6. 后端数据会通过 TaskManager.saveSession() 自动更新
            
            UI.showToast('任务已完全删除');
            console.log(`✅ 任务 ${uuid} 已完全删除`);
        } else {
            // 还有其他视频，只更新状态
            status.result = status.videos[0];
            UI.showToast('视频已删除');
            console.log(`🗑️ 删除视频: ${uuid}[${videoIndex}]`);
        }
        
        UI.refreshUI();
        
        // 🆕 保存会话到后端
        TaskManager.saveSession();
    },
    
    // 处理视频放大（带视频选择）
    async handleUpscale(uuid) {
        const status = TaskManager.tasksStatus[uuid];
        if (!status || !status.result) {
            UI.showToast('没有可放大的视频');
            return;
        }
        
        if (status.isUpscaled) {
            UI.showToast('此视频已经放大过了');
            return;
        }
        
        // 如果有多个视频，显示选择弹窗
        if (status.videos && status.videos.length > 1) {
            Modals.openUpscaleModal(uuid);
            return;
        }
        
        // 只有一个视频，直接放大
        await this.handleUpscaleWithIndex(uuid, 0);
    },
    
    // 处理视频放大（指定视频索引）
    async handleUpscaleWithIndex(uuid, videoIndex) {
        const status = TaskManager.tasksStatus[uuid];
        if (!status || !status.result) {
            UI.showToast('没有可放大的视频');
            return;
        }
        
        if (status.isUpscaled) {
            UI.showToast('此视频已经放大过了');
            return;
        }
        
        try {
            UI.showToast('正在准备视频放大...');
            
            // 获取要放大的视频URL
            let videoUrl;
            if (status.videos && status.videos.length > videoIndex) {
                videoUrl = status.videos[videoIndex];
                console.log(`📹 选择视频 #${videoIndex + 1}:`, videoUrl);
            } else if (status.result) {
                videoUrl = status.result;
                console.log(`📹 使用默认视频:`, videoUrl);
            } else {
                throw new Error('没有可用的视频');
            }
            
            // 优先使用videoStoragePath，否则尝试从URL提取
            let videoPath = status.videoStoragePath;
            
            if (!videoPath) {
                // 使用通用解析函数
                try {
                    const parsed = this.parseVideoUrl(videoUrl);
                    videoPath = parsed.identifier;
                    console.log(`📁 从URL解析路径:`, parsed);
                } catch (error) {
                    console.error('URL解析失败:', error);
                    throw new Error('无法获取视频路径');
                }
            }
            
            if (!videoPath) {
                throw new Error('无法获取视频文件路径');
            }
            
            console.log(`📹 视频路径: ${videoPath}`);
            
            // 提交放大任务
            const taskData = {
                task_type: 'upscale',
                video_filename: videoPath,  // 使用存储路径
                seed: -1,
                priority: 2
            };
            
            const result = await API.submitSimpleTask(taskData);
            const taskId = result.task_id;
            
            // 立即更新状态为处理中
            status.state = 'processing';
            status.progress = 0;
            status.originalResult = status.result;
            status.isUpscaled = true;
            status.upscaleTaskId = taskId;
            status.taskType = 'upscale';  // 标记任务类型
            
            // ✅ 保存到localStorage - 刷新后可恢复
            this.saveProcessingTasksToLocal();
            
            // 刷新UI显示loading
            UI.refreshUI();
            
            UI.showToast(`放大任务已提交: ${taskId}`);
            console.log('🔍 视频放大任务:', taskId, videoPath);
            
            // 开始轮询放大任务
            this.pollUpscaleTask(uuid, taskId);
            
        } catch (error) {
            console.error('视频放大失败:', error);
            UI.showToast('视频放大失败: ' + error.message);
        }
    },
    
    // 轮询放大任务状态
    async pollUpscaleTask(uuid, taskId) {
        let lastProgress = -1;  // 记录上次进度，避免重复刷新
        
        const pollInterval = setInterval(async () => {
            try {
                const result = await API.getTaskStatus(taskId);
                const status = TaskManager.tasksStatus[uuid];
                
                if (!status) {
                    clearInterval(pollInterval);
                    return;
                }
                
                // 更新进度（仅当进度变化时刷新UI）
                if (result.status === 'processing' || result.status === 'queued') {
                    status.state = 'processing';
                    const newProgress = result.progress || 50;
                    
                    // 仅当进度有变化时才刷新UI
                    if (newProgress !== lastProgress) {
                        status.progress = newProgress;
                        lastProgress = newProgress;
                        UI.refreshUI();
                    }
                } else if (result.status === 'completed') {
                    clearInterval(pollInterval);
                    
                    let videoUrl = '';
                    if (result.result && result.result.videos && result.result.videos.length > 0) {
                        const relativeUrl = result.result.videos[0].url;
                        const fullUrl = relativeUrl.startsWith('http') 
                            ? relativeUrl 
                            : `${API.baseURL}${relativeUrl}`;
                        videoUrl = fullUrl + (fullUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                    }
                    
                    // 更新为放大后的视频
                    status.state = 'done';
                    status.progress = 100;
                    status.result = videoUrl;
                    status.videos = [videoUrl];
                    status.videoStoragePath = result.result.videos[0].url;  // 保存存储路径
                    delete status.upscaleTaskId;  // 清除任务ID
                    
                    // ✅ 保存完成状态到后端（通过 TaskManager.saveSession 自动保存）
                    this.saveProcessingTasksToLocal();
                    
                    UI.refreshUI();
                    UI.showToast('✅ 视频放大完成！');
                    console.log('✅ 放大完成:', uuid, videoUrl);
                    
                } else if (result.status === 'failed') {
                    clearInterval(pollInterval);
                    status.state = 'done';
                    status.isUpscaled = false;
                    delete status.upscaleTaskId;  // 清除任务ID
                    
                    // ✅ 保存到localStorage
                    this.saveProcessingTasksToLocal();
                    
                    const errorMsg = result.error || '未知错误';
                    
                    // 🔧 使用弹窗显示详细错误信息
                    alert(`❌ 视频放大失败\n\n错误详情：\n${errorMsg}\n\n请检查：\n- ComfyUI节点是否在线\n- 视频文件是否完整\n- 磁盘空间是否充足`);
                    
                    UI.refreshUI();
                    UI.showToast(`放大失败: ${errorMsg}`);
                }
            } catch (error) {
                console.error('查询放大任务失败:', error);
                clearInterval(pollInterval);
                
                // 🔧 恢复任务状态，避免卡在loading
                const status = TaskManager.tasksStatus[uuid];
                if (status) {
                    status.state = 'done';
                    status.progress = 0;
                    status.isUpscaled = false;
                    delete status.upscaleTaskId;
                    UI.refreshUI();
                    UI.showToast(`任务查询失败: ${error.message}`);
                }
            }
        }, 2000);
    },
    
    // 提交配音任务（完整版）
    async submitVoiceTask() {
        const uuid = this.currentVoiceTaskUuid;
        if (!uuid) {
            UI.showToast('任务ID丢失');
            return;
        }
        
        if (!this.currentVoiceAudioFile) {
            UI.showToast('请先上传音频文件');
            return;
        }
        
        const status = TaskManager.tasksStatus[uuid];
        if (!status || status.state !== 'done') {
            UI.showToast('视频未完成，无法配音');
            return;
        }
        
        const startTime = parseFloat(document.getElementById('voiceStartTime').value) || 0;
        const voicePrompt = document.getElementById('voicePrompt').value.trim() || '生动的表情、自然的口型同步';
        
        try {
            UI.showToast('正在上传音频...');
            
            // 上传音频文件
            const audioUploadResult = await API.uploadAudio(this.currentVoiceAudioFile, startTime, 5);
            const audioFilename = audioUploadResult.filename;
            console.log('音频上传成功:', audioFilename);
            
            // 获取任务组
            const group = TaskManager.taskGroups.find(g => g.uuid === uuid);
            let videoFilename = '';
            
            // 检查是否是从视频抽帧的（有sourceVideo）
            if (group && group.ids.length > 0) {
                const img = TaskManager.uploadedImages.find(i => i.id === group.ids[0]);
                if (img && img.sourceVideo) {
                    // 使用源视频
                    console.log('使用源视频:', img.sourceVideoFilename);
                    UI.showToast('正在上传源视频...');
                    
                    // 上传视频到ComfyUI
                    const videoFormData = new FormData();
                    videoFormData.append('video', img.sourceVideo);
                    
                    const videoUploadResponse = await fetch(`${API.baseURL}/api/comfyui/upload/video`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${Auth.getToken()}`
                        },
                        body: videoFormData
                    });
                    
                    if (!videoUploadResponse.ok) {
                        throw new Error('源视频上传失败');
                    }
                    
                    const videoUploadResult = await videoUploadResponse.json();
                    videoFilename = videoUploadResult.filename;
                    console.log('源视频上传成功:', videoFilename);
                }
            }
            
            // 如果没有源视频，使用选中的视频（需要重新上传）
            if (!videoFilename) {
                const status = TaskManager.tasksStatus[uuid];
                if (!status) {
                    throw new Error('任务状态不存在');
                }
                
                // 获取用户选择的视频索引
                const videoSelect = document.getElementById('voiceVideoSelect');
                const selectedVideoIndex = parseInt(videoSelect.value) || 0;
                
                // 获取选中的视频URL
                const videos = status.videos || [status.result];
                let videoUrl = videos[selectedVideoIndex];
                
                if (!videoUrl) {
                    throw new Error('未找到选中的视频');
                }
                
                console.log('🎬 配音视频选择:', {
                    selectedIndex: selectedVideoIndex,
                    totalVideos: videos.length,
                    selectedUrl: videoUrl
                });
                
                // 使用通用解析函数
                let originalFilename = '';
                let fileType = 'output';
                
                try {
                    const parsed = this.parseVideoUrl(videoUrl);
                    originalFilename = parsed.identifier;
                    fileType = parsed.fileType || 'output';
                    console.log('📝 URL解析结果:', parsed);
                } catch (error) {
                    console.error('❌ URL解析失败:', error);
                    throw new Error('无法解析视频URL');
                }
                
                if (!originalFilename) {
                    throw new Error('无法获取视频文件名');
                }
                
                // 重新上传视频，获得带UUID的新文件名
                UI.showToast('正在准备视频文件...');
                const reuploadResponse = await API.reuploadVideo(originalFilename, fileType);
                videoFilename = reuploadResponse.new_filename;
                console.log('✅ 视频重新上传:', originalFilename, '->', videoFilename);
            }
            
            console.log('✅ 最终使用视频文件:', videoFilename);
            
            // 提交配音任务
            const response = await API.submitTask(
                'video_infinitetalk',
                null,
                null,
                voicePrompt,
                'Wan2',
                videoFilename,
                audioFilename
            );
            
            console.log('🎤 配音任务提交成功:', response);
            
            // 保留现有视频数组，更新任务状态
            const currentStatus = TaskManager.tasksStatus[uuid] || {};
            const existingVideos = currentStatus.videos || [];
            
            console.log('💾 保存现有视频数组:', {
                uuid: uuid,
                existingCount: existingVideos.length
            });
            
            TaskManager.tasksStatus[uuid] = {
                ...currentStatus,
                state: 'running',
                progress: 0,
                message: '正在配音中...',
                videos: existingVideos
            };
            TaskManager.startTimer(uuid);
            UI.refreshUI();
            
            // 轮询状态
            await this.pollTask(uuid, response.task_id);
            
        } catch (error) {
            console.error('配音失败:', error);
            UI.showToast(`配音失败: ${error.message}`);
        }
    },
    
    // 重做任务（保留已有视频）
    redoTask(uuid) {
        console.log('🔄 开始重做任务:', uuid);
        
        const currentStatus = TaskManager.tasksStatus[uuid];
        if (!currentStatus) {
            UI.showToast('任务不存在');
            return;
        }
        
        // 标记为keepResult模式，保留旧视频
        TaskManager.tasksStatus[uuid].keepResult = true;
        
        console.log('✅ 已标记keepResult，保留现有视频:', currentStatus.videos?.length || 0, '个');
        
        // 直接执行任务
        this.runTask(uuid);
    },
    
    // ==================== 通用视频URL解析函数 ====================
    /**
     * 从视频URL中提取文件标识符（file_id或路径）
     * @param {string} videoUrl - 视频URL
     * @returns {object} - {identifier: string, type: 'file_id'|'path'|'filename', urlFormat: string}
     */
    parseVideoUrl(videoUrl) {
        const urlWithoutToken = videoUrl.split('?token=')[0].split('&token=')[0];
        
        // 1. 数据库文件格式 /api/files/{file_id}/download
        if (urlWithoutToken.includes('/api/files/') && urlWithoutToken.includes('/download')) {
            const match = urlWithoutToken.match(/\/api\/files\/([^\/]+)\/download/);
            if (match && match[1]) {
                return {
                    identifier: match[1],
                    type: 'file_id',
                    urlFormat: 'database'
                };
            }
        }
        
        // 2. 旧的uploads格式 /uploads/video/{username}/{date}/{filename}
        if (urlWithoutToken.includes('/uploads/video/')) {
            const pathParts = urlWithoutToken.split('/uploads/video/')[1];
            return {
                identifier: 'video/' + pathParts,  // 转换为 video/username/date/filename
                type: 'path',
                urlFormat: 'uploads'
            };
        }
        
        // 3. ComfyUI代理URL格式
        if (urlWithoutToken.includes('/api/proxy/comfyui/view')) {
            const url = new URL(videoUrl, window.location.origin);
            const filename = url.searchParams.get('filename');
            const fileType = url.searchParams.get('type') || 'output';
            return {
                identifier: filename,
                type: 'filename',
                urlFormat: 'comfyui_proxy',
                fileType: fileType
            };
        }
        
        // 4. 存储URL格式 /storage/{file_type}/{user_id}/{year_month}/{filename}
        if (urlWithoutToken.includes('/storage/')) {
            const pathParts = urlWithoutToken.split('/storage/')[1];
            return {
                identifier: pathParts,
                type: 'path',
                urlFormat: 'storage'
            };
        }
        
        // 5. API存储格式 /api/storage/...
        if (urlWithoutToken.includes('/api/storage/')) {
            const pathParts = urlWithoutToken.split('/api/storage/')[1];
            return {
                identifier: pathParts,
                type: 'path',
                urlFormat: 'api_storage'
            };
        }
        
        // 6. ComfyUI outputs目录格式
        if (urlWithoutToken.includes('/outputs/')) {
            const pathParts = urlWithoutToken.split('/outputs/')[1];
            return {
                identifier: pathParts,
                type: 'filename',
                urlFormat: 'outputs'
            };
        }
        
        // 7. Blob URL (不支持)
        if (videoUrl.startsWith('blob:')) {
            throw new Error('Blob URL暂不支持，请使用持久化存储的视频');
        }
        
        // 8. 尝试从URL末尾提取文件名
        const urlPath = urlWithoutToken.split('?')[0];
        const pathSegments = urlPath.split('/').filter(s => s);
        if (pathSegments.length > 0) {
            const lastSegment = pathSegments[pathSegments.length - 1];
            if (lastSegment && (lastSegment.endsWith('.mp4') || lastSegment.endsWith('.webm') || lastSegment.endsWith('.avi'))) {
                return {
                    identifier: lastSegment,
                    type: 'filename',
                    urlFormat: 'unknown'
                };
            }
        }
        
        throw new Error(`无法解析视频URL格式: ${urlWithoutToken}`);
    },
    
    // 裁剪视频片段（完整版）
    async cropVideoSegment(startTime, endTime) {
        const uuid = this.currentEditTaskUuid;
        const videoUrl = this.currentEditVideoUrl;
        
        if (!uuid || !videoUrl) {
            UI.showToast('无法获取视频信息');
            return;
        }
        
        try {
            UI.showToast('正在裁剪视频...');
            
            console.log('🎬 开始裁剪视频，URL:', videoUrl);
            
            // 使用通用解析函数
            const parsed = this.parseVideoUrl(videoUrl);
            console.log('📁 解析结果:', parsed);
            
            // 调用后端API裁剪视频
            const result = await API.cropVideo(parsed.identifier, startTime, endTime);
            
            // 构建剪辑后的视频URL
            let croppedVideoUrl = '';
            if (result.url) {
                // 🆕 优先使用数据库URL格式（/api/files/{file_id}/download）
                const fullUrl = result.url.startsWith('http') ? result.url : `${API.baseURL}${result.url}`;
                croppedVideoUrl = fullUrl + (fullUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                console.log('✅ 使用数据库URL格式:', croppedVideoUrl);
            } else if (result.filename) {
                // 回退到ComfyUI代理URL
                croppedVideoUrl = `${API.baseURL}/api/proxy/comfyui/view?filename=${result.filename}&subfolder=&type=output&token=${Auth.getToken()}`;
                console.log('⚠️ 使用ComfyUI代理URL (fallback):', croppedVideoUrl);
            } else {
                throw new Error('服务器未返回有效的视频URL');
            }
            
            console.log('✅ 剪辑后的视频URL:', croppedVideoUrl);
            
            // 添加到当前任务的视频列表
            const status = TaskManager.tasksStatus[uuid];
            if (!status.videos) {
                status.videos = [status.result]; // 保存原视频
            }
            
            // 添加新视频（最多5个）
            if (status.videos.length < 5) {
                status.videos.push(croppedVideoUrl);
                UI.showToast(`✅ 视频裁剪成功 (${status.videos.length}/5)`);
            } else {
                UI.showToast('⚠️ 已达到最多5个视频限制');
            }
            
            // 🆕 保存任务到数据库（持久化剪裁后的视频）
            const taskGroup = TaskManager.taskGroups.find(g => g.uuid === uuid);
            if (taskGroup) {
                await TaskManager.saveTaskToDatabase(uuid, {
                    task_id: status.task_id,
                    task_type: taskGroup.model || 'video_crop',
                    prompt: TaskManager.imagePrompts[taskGroup.ids[0]] || '',
                    videos: status.videos.map((url, idx) => ({
                        url: url.split('?')[0],  // 移除token参数
                        index: idx
                    })),
                    status: 'completed'
                });
                console.log('💾 任务已保存到数据库，包含裁剪后的视频');
            }
            
            UI.refreshUI();
            Modals.closeVideoEditModal();
            
            console.log(`✂️ 视频裁剪成功:`, result);
            
        } catch (error) {
            console.error('视频裁剪失败:', error);
            UI.showToast(`裁剪失败: ${error.message}`);
        }
    },
    
    // 执行选中的任务
    generateSelected() {
        let selectedUuids = [];
        TaskManager.taskGroups.forEach((group) => {
            if (TaskManager.tasksStatus[group.uuid] && TaskManager.tasksStatus[group.uuid].selected) {
                selectedUuids.push(group.uuid);
            }
        });
        
        if (selectedUuids.length === 0) {
            UI.showToast('请先勾选任务');
            return;
        }
        
        selectedUuids.forEach(uuid => this.runTask(uuid));
        UI.showToast(`开始执行 ${selectedUuids.length} 个任务`);
    },
    
    // 切换用户菜单
    toggleUserMenu() {
        const menu = document.getElementById('userMenu');
        menu.classList.toggle('hidden');
        if(typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    // 图片排序功能
    sortImages(sortType) {
        console.log('🔄 排序图片:', sortType);
        
        if (sortType === 'time-desc') {
            // 时间倒序（最新在前）
            const sortedGroups = [...TaskManager.taskGroups].sort((a, b) => {
                const imgA = TaskManager.uploadedImages.find(i => i.id === a.ids[0]);
                const imgB = TaskManager.uploadedImages.find(i => i.id === b.ids[0]);
                const timeA = imgA?.uploadTime || 0;
                const timeB = imgB?.uploadTime || 0;
                return timeB - timeA;
            });
            TaskManager.taskGroups = sortedGroups;
            UI.showToast('✅ 已按时间倒序排列（最新在前）');
        } else if (sortType === 'time-asc') {
            // 时间正序（最早在前）
            const sortedGroups = [...TaskManager.taskGroups].sort((a, b) => {
                const imgA = TaskManager.uploadedImages.find(i => i.id === a.ids[0]);
                const imgB = TaskManager.uploadedImages.find(i => i.id === b.ids[0]);
                const timeA = imgA?.uploadTime || 0;
                const timeB = imgB?.uploadTime || 0;
                return timeA - timeB;
            });
            TaskManager.taskGroups = sortedGroups;
            UI.showToast('✅ 已按时间正序排列（最早在前）');
        }
        
        UI.refreshUI();
    },
    
    // 退出登录
    async handleLogout() {
        // 关闭菜单
        const menu = document.getElementById('userMenu');
        if (menu) menu.classList.add('hidden');
        
        try {
            // 调用后端登出API
            await Auth.logout();
        } catch (error) {
            console.error('登出失败:', error);
        }
        
        // 清空数据
        TaskManager.uploadedImages = [];
        TaskManager.taskGroups = [];
        TaskManager.tasksStatus = {};
        TaskManager.imagePrompts = {};
        TaskManager.taskStartTimes = {};
        
        // 跳转到登录页
        window.location.href = '/';
    }
};

// ✅ 清空所有任务（同时清空数据库会话）
Workspace.clearAllTasks = async function() {
    if (!confirm('确定要清空所有任务吗？\n\n这将删除当前工作台的所有任务。')) {
        return;
    }
    
    // 清空内存中的任务
    TaskManager.taskGroups = [];
    TaskManager.uploadedImages = [];
    TaskManager.tasksStatus = {};
    TaskManager.taskStartTimes = {};
    TaskManager.imagePrompts = {};
    
    // ✅ 清空数据库会话
    await TaskManager.saveSession();
    
    console.log('🧹 已清空所有任务');
    UI.showToast('✅ 已清空所有任务');
    UI.refreshUI();
};

// 导出到全局
window.Workspace = Workspace;

// 全局便捷函数
window.generateSelected = () => Workspace.generateSelected();
window.toggleUserMenu = () => Workspace.toggleUserMenu();
window.handleLogout = () => Workspace.handleLogout();
window.deleteVideo = (uuid, videoIndex) => Workspace.deleteVideo(uuid, videoIndex);
window.redoTask = (uuid) => Workspace.redoTask(uuid);
window.clearAllTasks = () => Workspace.clearAllTasks(); // 清空所有任务

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    Workspace.init();
});

