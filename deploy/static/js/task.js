// ==================== 任务管理 ====================

const TaskManager = {
    taskGroups: [],
    tasksStatus: {},
    taskStartTimes: {},
    uploadedImages: [],
    imagePrompts: {},
    globalModel: 'Wan2',  // 全局默认模型: Wan2, Sora2, MINI
    
    // 添加图片（异步上传到服务器）
    async addImage(file) {
        const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const tempUrl = URL.createObjectURL(file);  // 临时预览URL
        
        // 先添加临时URL用于预览
        const imageObj = { 
            id, 
            file, 
            url: tempUrl,
            filename: file.name,
            uploadTime: Date.now(),
            isUploading: true  // 标记为上传中
        };
        
        this.uploadedImages.push(imageObj);
        
        this.imagePrompts[id] = "";
        this.taskGroups.push({ 
            uuid: UI.generateUUID(), 
            ids: [id], 
            model: this.globalModel,  // 使用全局模型设置
            shotType: 'multi'  // 🆕 大能模型的镜头类型（multi/single）
        });
        
        // 异步上传到服务器
        try {
            console.log(`📤 开始上传图片到服务器: ${file.name}`);
            const uploadResult = await API.uploadImage(file);
            
            console.log(`📦 上传结果:`, uploadResult);  // 🔍 调试日志
            
            if (uploadResult && uploadResult.url) {
                // 上传成功，替换为永久URL
                const img = this.uploadedImages.find(i => i.id === id);
                if (img) {
                    const oldUrl = img.url;
                    URL.revokeObjectURL(tempUrl);  // 释放临时URL
                    img.url = uploadResult.url;  // 使用服务器URL
                    img.storageUrl = uploadResult.storage_url || uploadResult.url;  // 统一使用storageUrl
                    img.filename = uploadResult.filename || img.filename || file.name;  // 确保有filename
                    img.isUploading = false;
                    delete img.file;  // 删除File对象，避免序列化问题
                    console.log(`✅ 图片上传成功: ${img.filename}`);
                    console.log(`   旧URL: ${oldUrl}`);
                    console.log(`   新URL: ${img.url}`);
                    console.log(`   storageUrl: ${img.storageUrl}`);
                    
                    // 🆕 图片上传完成后保存会话
                    await this.saveSession();
                }
            } else {
                console.error(`❌ 上传返回数据无效:`, uploadResult);
                const img = this.uploadedImages.find(i => i.id === id);
                if (img) {
                    img.isUploading = false;
                    img.uploadFailed = true;
                }
            }
        } catch (error) {
            console.error(`❌ 图片上传失败: ${error}`);
            console.error(`   错误详情:`, error.message, error.stack);
            // 上传失败仍使用临时URL，但标记失败状态
            const img = this.uploadedImages.find(i => i.id === id);
            if (img) {
                img.isUploading = false;
                img.uploadFailed = true;
            }
        }
        
        return id;
    },
    
    // 移除任务
    removeTask(uuid) {
        const index = this.taskGroups.findIndex(g => g.uuid === uuid);
        if (index === -1) {
            console.error(`❌ 找不到任务: uuid=${uuid}`);
            return;
        }
        
        const group = this.taskGroups[index];
        console.log(`🗑️ 删除任务: index=${index}, uuid=${uuid}, ids=${group.ids}`);
        
        // 释放图片的 Blob URL，防止内存泄漏
        group.ids.forEach(imgId => {
            const img = this.uploadedImages.find(i => i.id === imgId);
            if (img && img.url && img.url.startsWith('blob:')) {
                URL.revokeObjectURL(img.url);
            }
            this.uploadedImages = this.uploadedImages.filter(i => i.id !== imgId);
            delete this.imagePrompts[imgId];
        });
        
        // 清理任务状态和计时器
        this.clearTimer(uuid);
        delete this.tasksStatus[uuid];
        delete this.taskStartTimes[uuid];
        this.taskGroups.splice(index, 1);
        console.log(`✅ 删除完成，剩余: ${this.uploadedImages.length} 张图片, ${this.taskGroups.length} 个任务`);
        
        // ✅ 删除后立即保存会话到数据库（不延迟）
        this.saveSession().then(() => {
            console.log('💾 删除操作已同步到数据库');
        }).catch(err => {
            console.error('❌ 保存删除操作失败:', err);
        });
    },
    
    // 更新提示词
    updatePrompt(imgId, value) {
        this.imagePrompts[imgId] = value;
    },
    
    // 更新任务模型
    updateTaskModel(index, model) {
        if (this.taskGroups[index]) {
            this.taskGroups[index].model = model;
        }
    },
    
    // 设置默认模型（用于新上传的卡片）
    switchGlobalModel(model) {
        const validModels = ['Wan2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', 'Sora2', 'MINI', 'Veo', '大能'];
        if (validModels.includes(model)) {
            this.globalModel = model;
            console.log(`✅ 设置新卡片默认模型: ${model}`);
            
            // 顶部全局模型按钮已移除，现在每个卡片独立选择模型
            // 此函数仅用于设置新上传卡片的默认模型
        }
    },
    
    // 合并任务组（首尾帧）
    linkGroups(index) {
        if (index >= this.taskGroups.length - 1) return;
        
        const groupA = this.taskGroups[index];
        const groupB = this.taskGroups[index + 1];
        
        // 保存旧的任务状态
        const statusA = this.tasksStatus[groupA.uuid];
        const statusB = this.tasksStatus[groupB.uuid];
        
        const newGroup = { 
            uuid: UI.generateUUID(), 
            ids: [groupA.ids[0], groupB.ids[0]], 
            model: groupA.model 
        };
        
        // 清理旧的任务状态
        delete this.tasksStatus[groupA.uuid];
        delete this.tasksStatus[groupB.uuid];
        delete this.taskStartTimes[groupA.uuid];
        delete this.taskStartTimes[groupB.uuid];
        
        // 如果任意一个任务有结果，保留第一个任务的状态
        if (statusA && (statusA.state === 'done' || statusA.state === 'running')) {
            this.tasksStatus[newGroup.uuid] = statusA;
            console.log('✅ 合并任务时保留了任务A的状态');
        } else if (statusB && (statusB.state === 'done' || statusB.state === 'running')) {
            this.tasksStatus[newGroup.uuid] = statusB;
            console.log('✅ 合并任务时保留了任务B的状态');
        }
        
        this.taskGroups.splice(index, 2, newGroup);
    },
    
    // 拆分任务组
    unlinkGroup(index) {
        const group = this.taskGroups[index];
        if (group.ids.length !== 2) return;
        
        // 保存旧的任务状态
        const oldStatus = this.tasksStatus[group.uuid];
        
        const newA = { uuid: UI.generateUUID(), ids: [group.ids[0]], model: group.model };
        const newB = { uuid: UI.generateUUID(), ids: [group.ids[1]], model: group.model };
        
        // 清理旧的任务状态
        delete this.tasksStatus[group.uuid];
        delete this.taskStartTimes[group.uuid];
        
        // 如果原任务有结果，复制到第一个拆分任务（A）
        if (oldStatus && (oldStatus.state === 'done' || oldStatus.state === 'running')) {
            this.tasksStatus[newA.uuid] = { ...oldStatus };
            console.log('✅ 拆分任务时保留了原任务的状态到任务A');
        }
        
        this.taskGroups.splice(index, 1, newA, newB);
    },
    
    // 复制任务
    duplicateTask(uuid) {
        const index = this.taskGroups.findIndex(g => g.uuid === uuid);
        if (index === -1) return;
        
        const group = this.taskGroups[index];
        const newIds = [];
        
        for (const oldId of group.ids) {
            const oldImg = this.uploadedImages.find(i => i.id === oldId);
            if (!oldImg) continue;
            
            const newId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            this.uploadedImages.push({
                id: newId,
                file: oldImg.file,
                url: oldImg.url,
                filename: oldImg.filename,
                uploadTime: Date.now()  // 复制时使用新时间
            });
            
            newIds.push(newId);
            this.imagePrompts[newId] = this.imagePrompts[oldId] || '';
        }
        
        const newGroup = {
            uuid: UI.generateUUID(),
            ids: newIds,
            model: group.model
        };
        
        this.taskGroups.splice(index + 1, 0, newGroup);
    },
    
    // 清空所有
    clearAll() {
        console.log(`🧹 清空所有: ${this.uploadedImages.length} 张图片, ${this.taskGroups.length} 个任务`);
        
        // 释放所有 Blob URL，防止内存泄漏
        this.uploadedImages.forEach(img => {
            if (img.url && img.url.startsWith('blob:')) {
                URL.revokeObjectURL(img.url);
            }
        });
        
        this.uploadedImages = [];
        this.imagePrompts = {};
        this.taskGroups = [];
        this.tasksStatus = {};
        this.taskStartTimes = {};
        console.log(`✅ 清空完成`);
        
        // 🆕 清空后立即保存会话到数据库
        this.saveSession().then(() => {
            console.log('💾 清空操作已同步到数据库');
        }).catch(err => {
            console.error('❌ 保存清空操作失败:', err);
        });
    },
    
    // 切换任务选择
    toggleTaskSelection(uuid) {
        if (!this.tasksStatus[uuid]) {
            this.tasksStatus[uuid] = { state: 'idle' };
        }
        this.tasksStatus[uuid].selected = !this.tasksStatus[uuid].selected;
    },
    
    // 全选/取消全选
    toggleSelectAll(isChecked) {
        this.taskGroups.forEach((group) => {
            if (!this.tasksStatus[group.uuid]) {
                this.tasksStatus[group.uuid] = { state: 'idle' };
            }
            this.tasksStatus[group.uuid].selected = isChecked;
        });
    },
    
    // 开始计时
    startTimer(uuid) {
        this.taskStartTimes[uuid] = Date.now();
    },
    
    // 获取已用时间（秒）
    getElapsedTime(uuid) {
        if (!this.taskStartTimes[uuid]) return 0;
        return Math.floor((Date.now() - this.taskStartTimes[uuid]) / 1000);
    },
    
    // 获取格式化的时间字符串
    getElapsedTimeStr(uuid) {
        const elapsedSeconds = this.getElapsedTime(uuid);
        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = elapsedSeconds % 60;
        return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
    },
    
    // 清除计时器
    clearTimer(uuid) {
        delete this.taskStartTimes[uuid];
    },
    
    // 清空所有任务
    clearAll() {
        console.log(`🧹 清空所有: ${this.uploadedImages.length} 张图片, ${this.taskGroups.length} 个任务`);
        
        // 释放所有 Blob URL，防止内存泄漏
        this.uploadedImages.forEach(img => {
            if (img.url) {
                URL.revokeObjectURL(img.url);
                console.log(`  释放 Blob: ${img.id}`);
            }
        });
        
        this.uploadedImages = [];
        this.imagePrompts = {};
        this.taskGroups = [];
        this.tasksStatus = {};
        this.taskStartTimes = {};
        console.log(`✅ 清空完成`);
    },
    
    // 清理过期的临时任务
    clearExpiredTasks() {
        const expiredUuids = [];
        for (const uuid in this.tasksStatus) {
            const status = this.tasksStatus[uuid];
            if (status.isExpired || (status.result && status.result.includes('/api/proxy/comfyui/view'))) {
                expiredUuids.push(uuid);
            }
        }
        
        if (expiredUuids.length === 0) {
            return { count: 0, message: '没有找到临时文件任务' };
        }
        
        let expiredCount = 0;
        expiredUuids.forEach(uuid => {
            const group = this.taskGroups.find(g => g.uuid === uuid);
            if (group) {
                group.ids.forEach(imgId => {
                    const imgIndex = this.uploadedImages.findIndex(i => i.id === imgId);
                    if (imgIndex !== -1) {
                        const img = this.uploadedImages[imgIndex];
                        if (img.url) URL.revokeObjectURL(img.url);
                        this.uploadedImages.splice(imgIndex, 1);
                    }
                    delete this.imagePrompts[imgId];
                });
                
                const taskIndex = this.taskGroups.findIndex(g => g.uuid === uuid);
                if (taskIndex !== -1) this.taskGroups.splice(taskIndex, 1);
                
                delete this.tasksStatus[uuid];
                delete this.taskStartTimes[uuid];
                expiredCount++;
            }
        });
        
        console.log(`🧹 已清理 ${expiredCount} 个过期任务`);
        return { count: expiredCount, message: `✅ 已清理 ${expiredCount} 个临时文件任务` };
    },
    
    /**
     * 🆕 保存任务到数据库
     */
    async saveTaskToDatabase(uuid, taskData) {
        try {
            const result = await API.saveVideoTask({
                uuid: uuid,
                ...taskData
            });
            
            if (result.success) {
                console.log('✅ 任务已保存到数据库:', uuid);
            }
        } catch (error) {
            console.error('❌ 保存任务到数据库失败:', error);
        }
    },
    
    /**
     * 🆕 从数据库加载历史任务
     */
    async loadTasksFromDatabase() {
        try {
            const data = await API.getWorkspaceTasks();
            const tasks = data.tasks || [];
            
            console.log(`📥 从数据库加载 ${tasks.length} 个历史任务`);
            
            for (const task of tasks) {
                if (task.status !== 'completed' || !task.videos || task.videos.length === 0) {
                    continue;
                }
                
                // 查找对应的任务组（可能不存在）
                let taskGroup = this.taskGroups.find(g => g.uuid === task.uuid);
                
                // 如果不存在，跳过
                if (!taskGroup) {
                    continue;
                }
                
                // 恢复视频数组
                const videoUrls = task.videos.map(v => {
                    const baseUrl = v.url.startsWith('http') ? v.url : `${API.baseURL}${v.url}`;
                    return baseUrl + (baseUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                });
                
                const videoTimes = task.videos.map(v => v.generateTime || 0);
                
                // 恢复任务状态
                this.tasksStatus[task.uuid] = {
                    state: 'done',
                    result: videoUrls[0],
                    videos: videoUrls,
                    videoGenerateTimes: videoTimes,
                    progress: 100,
                    isUpscaled: taskGroup.isUpscaled || false
                };
                
                console.log(`✅ 恢复任务 ${task.uuid}: ${videoUrls.length} 个视频`);
            }
            
            UI.refreshUI();
            console.log('✅ 历史任务加载完成');
        } catch (error) {
            console.error('❌ 从数据库加载任务失败:', error);
        }
    },
    
    /**
     * 保存workspace会话（已迁移到React VideoPage.tsx）
     * 旧版workspace路由已重定向到React SPA，此方法保留兼容性
     */
    async saveSession() {
        // 检查是否处于旧版workspace页面（极端情况兼容）
        if (!window.location.pathname.includes('/workspace')) {
            console.log('ℹ️ task.js saveSession() 已迁移到 React VideoPage.tsx，跳过');
            return;
        }
        try {
            console.log(`💾 准备保存会话: ${this.taskGroups.length} 个任务组, ${this.uploadedImages.length} 张图片`);
            
            // 过滤掉不需要保存的临时数据
            const cleanedTasksStatus = {};
            Object.keys(this.tasksStatus).forEach(uuid => {
                const status = this.tasksStatus[uuid];
                // ✅ 保存已完成和空闲状态的任务（包括导入的任务）
                if (status.state === 'done' || status.state === 'idle') {
                    // 🔧 移除视频URL中的token参数（刷新后会重新加上）
                    const cleanedVideos = (status.videos || []).map(url => {
                        if (typeof url === 'string') {
                            return url.split('?')[0];  // 移除token参数
                        }
                        return url;
                    });
                    const cleanedResult = status.result ? status.result.split('?')[0] : '';
                    
                    cleanedTasksStatus[uuid] = {
                        state: status.state,
                        result: cleanedResult,  // 🔧 保存result字段（去掉token）
                        videos: cleanedVideos,  // 🔧 保存视频数组（去掉token）
                        videoGenerateTimes: status.videoGenerateTimes,
                        progress: status.progress,
                        isUpscaled: status.isUpscaled,
                        uploadedVideo: status.uploadedVideo,  // 🔧 保存上传标记
                        videoStoragePath: status.videoStoragePath,  // 🔧 保存存储路径
                        images: status.images  // 🔧 保存导入的图片数据
                    };
                }
            });
            
            // 🔧 过滤掉临时blob URL和正在上传的图片
            const validImages = this.uploadedImages.filter(img => {
                // 跳过正在上传的图片
                if (img.isUploading) {
                    console.log(`⏳ 跳过保存正在上传的图片: ${img.filename || img.id}`);
                    return false;
                }
                // 跳过上传失败的图片
                if (img.uploadFailed) {
                    console.log(`❌ 跳过保存上传失败的图片: ${img.filename || img.id}`);
                    return false;
                }
                // 跳过blob URL（临时URL）
                if (img.url && img.url.startsWith('blob:')) {
                    console.log(`⚠️ 跳过保存临时URL: ${img.filename || img.id}`);
                    return false;
                }
                // 必须有有效的URL（http/https 或相对路径 /storage/...）
                if (!img.url) {
                    console.log(`⚠️ 跳过保存无URL的图片: ${img.filename || img.id}`);
                    return false;
                }
                // 接受 http/https 开头的URL，或者 / 开头的相对路径
                if (!img.url.startsWith('http') && !img.url.startsWith('/')) {
                    console.log(`⚠️ 跳过保存无效URL的图片: ${img.filename || img.id}, URL: ${img.url}`);
                    return false;
                }
                return true;
            });
            
            const sessionData = {
                task_groups: this.taskGroups,
                uploaded_images: validImages.map(img => ({
                    id: img.id,
                    filename: img.filename,
                    url: img.url,
                    storageUrl: img.storageUrl || img.url,
                    comfyuiFilename: img.comfyuiFilename,
                    uploadTime: img.uploadTime
                })),
                image_prompts: this.imagePrompts,
                tasks_status: cleanedTasksStatus
            };
            
            console.log('📤 发送会话数据:', {
                task_groups: sessionData.task_groups.length,
                uploaded_images: sessionData.uploaded_images.length,
                total_images: this.uploadedImages.length,
                filtered_out: this.uploadedImages.length - validImages.length,
                image_prompts: Object.keys(sessionData.image_prompts).length
            });
            
            const result = await API.saveWorkspaceSession(sessionData);
            
            if (result.success) {
                console.log('✅ Workspace会话已保存到服务器');
            } else {
                console.error('❌ 服务器返回保存失败:', result);
            }
        } catch (error) {
            console.error('❌ 保存workspace会话失败:', error);
        }
    },
    
    /**
     * 🆕 从数据库加载workspace会话
     */
    async loadSession() {
        try {
            console.log('📂 开始加载workspace会话...');
            const data = await API.loadWorkspaceSession();
            
            console.log('📥 服务器返回数据:', data);
            
            if (!data.success || !data.session) {
                console.log('📭 没有找到workspace会话');
                return false;
            }
            
            const session = data.session;
            
            // 🚀 优化：覆盖模式而不是合并模式（确保删除操作生效）
            const savedTaskGroups = session.task_groups || [];
            const savedImages = session.uploaded_images || [];
            const savedPrompts = session.image_prompts || {};
            
            console.log(`📦 会话中的任务组: ${savedTaskGroups.length} 个`);
            console.log(`🖼️  会话中的图片: ${savedImages.length} 张`);
            console.log(`🔄 当前内存中: ${this.taskGroups.length} 个任务组, ${this.uploadedImages.length} 张图片`);
            
            // 空数据保护：服务器返回空但内存有数据时，保留内存状态
            if (savedTaskGroups.length === 0 && savedImages.length === 0 
                && (this.taskGroups.length > 0 || this.uploadedImages.length > 0)) {
                console.warn('⚠️ 服务器返回空session但内存中有数据，保留当前状态');
                return false;
            }
            
            // ✅ 直接覆盖（不合并），确保删除操作生效
            // 如果用户删除了任务，刷新后不应该再出现
            this.taskGroups = [];
            this.uploadedImages = [];
            this.imagePrompts = {};
            
            // 加载任务组
            this.taskGroups = [...savedTaskGroups];
            
            // 加载图片（过滤无效URL）
            let skippedCount = 0;
            savedImages.forEach(img => {
                // 🔧 过滤掉blob URL和无效URL
                if (img.url && img.url.startsWith('blob:')) {
                    console.warn(`⚠️ 跳过恢复临时blob URL: ${img.filename} (${img.id})`);
                    skippedCount++;
                    return;
                }
                // 接受 http/https 或 / 开头的相对路径
                if (!img.url || (!img.url.startsWith('http') && !img.url.startsWith('/'))) {
                    console.warn(`⚠️ 跳过恢复无效URL: ${img.filename} (${img.id}), URL: ${img.url}`);
                    skippedCount++;
                    return;
                }
                
                this.uploadedImages.push(img);
            });
            
            if (skippedCount > 0) {
                console.warn(`⚠️ 跳过了 ${skippedCount} 个无效图片`);
            }
            
            // 🔧 清理引用了无效图片的任务组（无论是否跳过图片都要检查）
            const validImageIds = new Set(this.uploadedImages.map(img => img.id));
            const beforeCount = this.taskGroups.length;
            this.taskGroups = this.taskGroups.filter(group => {
                // 检查任务组引用的所有图片是否都存在
                const allImagesValid = group.ids && group.ids.every(id => validImageIds.has(id));
                if (!allImagesValid) {
                    console.warn(`🗑️ 清理无效任务组: ${group.uuid}（引用了不存在的图片: ${group.ids.join(', ')}）`);
                }
                return allImagesValid;
            });
            const removedCount = beforeCount - this.taskGroups.length;
            if (removedCount > 0) {
                console.warn(`🗑️ 清理了 ${removedCount} 个无效任务组`);
                // 🔧 清理后立即保存，避免下次加载时又出现
                setTimeout(() => {
                    this.saveSession();
                    console.log('💾 已保存清理后的会话');
                }, 1000);
            }
            
            // 加载提示词（只保留有效图片的提示词）
            this.imagePrompts = {};
            Object.keys(savedPrompts).forEach(imgId => {
                if (validImageIds.has(imgId)) {
                    this.imagePrompts[imgId] = savedPrompts[imgId];
                }
            });
            
            // 加载任务状态（覆盖而不是合并）
            this.tasksStatus = {};
            if (session.tasks_status) {
                // 🔧 恢复视频URL时重新添加token
                Object.keys(session.tasks_status).forEach(uuid => {
                    const status = session.tasks_status[uuid];
                    const token = Auth.getToken();
                    
                    // 为视频数组添加token
                    const videosWithToken = (status.videos || []).map(url => {
                        if (typeof url === 'string' && url && !url.includes('token=')) {
                            return url + (url.includes('?') ? '&' : '?') + `token=${token}`;
                        }
                        return url;
                    });
                    
                    // 为result添加token
                    let resultWithToken = status.result || '';
                    if (resultWithToken && !resultWithToken.includes('token=')) {
                        resultWithToken = resultWithToken + (resultWithToken.includes('?') ? '&' : '?') + `token=${token}`;
                    }
                    
                    this.tasksStatus[uuid] = {
                        ...status,
                        videos: videosWithToken,
                        result: resultWithToken
                    };
                });
                
                console.log('🔧 已为恢复的视频URL添加token');
            }
            
            console.log(`✅ Workspace会话恢复完成 - 当前共 ${this.taskGroups.length} 个任务组, ${this.uploadedImages.length} 张图片`);
            
            // 🔧 只有数据恢复成功时才刷新UI
            if (this.taskGroups.length > 0 || this.uploadedImages.length > 0) {
                UI.refreshUI();
            }
            return true;
        } catch (error) {
            console.error('❌ 加载workspace会话失败:', error);
            return false;
        }
    }
};

// 导出到全局
window.TaskManager = TaskManager;

