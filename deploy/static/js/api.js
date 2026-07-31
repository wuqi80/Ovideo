// ==================== API 调用封装 ====================

const API = {
    baseURL: '',
    
    // 获取请求头
    getHeaders(includeContentType = true) {
        const headers = {
            'Authorization': `Bearer ${Auth.getToken()}`
        };
        if (includeContentType) {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    },
    
    // 上传图片到持久化存储（不上传到ComfyUI）
    async uploadImage(file) {
        console.log('📤 开始上传图片到持久化存储:', file.name);
        const token = Auth.getToken();
        if (!token) {
            console.error('❌ 未登录或 token 不存在');
            throw new Error('请先登录');
        }
        console.log('🔑 使用 token:', token.substring(0, 20) + '...');
        
        const formData = new FormData();
        formData.append('file', file);  // 注意：字段名改为'file'
        
        const response = await fetch(`${this.baseURL}/api/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!response.ok) {
            // 如果是 401 未授权，清除 token 并提示重新登录
            if (response.status === 401) {
                console.error('❌ 登录已过期，请重新登录');
                Auth.clearAuth();
                alert('登录已过期，请重新登录');
                window.location.href = '/login.html';
                throw new Error('登录已过期');
            }
            
            let errorMsg = '图片上传失败';
            try {
                const error = await response.json();
                console.error('❌ 上传失败:', error);
                errorMsg = error.detail || JSON.stringify(error);
            } catch (e) {
                const text = await response.text();
                console.error('❌ 上传失败 (非JSON响应):', text);
                errorMsg = text || `HTTP ${response.status}`;
            }
            throw new Error(errorMsg);
        }
        
        const result = await response.json();
        console.log('✅ 图片上传成功到持久化存储');
        console.log('   - 文件名:', result.filename);
        console.log('   - 存储URL:', result.storage_url);
        console.log('   - 文件大小:', result.size, 'bytes');
        
        // 直接使用持久化存储URL
        result.url = result.storage_url || result.url;
        
        return result;  // 返回: { filename, storage_url, url, path, size }
    },
    
    // 🆕 上传图片到ComfyUI（用于Wan2等ComfyUI工作流）
    async uploadImageToComfyUI(file, nodeType = 'video') {
        console.log(`📤 开始上传图片到处理节点 (节点类型: ${nodeType}):`, file.name);
        const token = Auth.getToken();
        if (!token) {
            throw new Error('请先登录');
        }
        
        const formData = new FormData();
        formData.append('image', file);
        // 🔧 添加节点类型参数，确保上传到正确的节点
        formData.append('node_type', nodeType);
        
        const response = await fetch(`${this.baseURL}/api/comfyui/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: '上传失败' }));
            throw new Error(error.detail || '上传到处理节点失败');
        }
        
        const result = await response.json();
        console.log('✅ 图片上传到处理节点成功:', result.filename, `(节点: ${result.node_id || 'default'})`);
        
        return result;  // 返回: { filename (ComfyUI文件名), storage_url, node_id, ... }
    },
    
    // 提交生成任务（完整版本，支持多种工作流）
    async submitTask(workflowName, imageFilename, imageFilenameEnd, prompt, model, videoFilename, audioFilename, shotType = 'multi') {
        // 根据工作流名称确定任务类型
        let taskType = imageFilenameEnd ? 'morph' : 'i2v';
        let requestData = {};

        if (workflowName === 'viedo_upscaler') {
            taskType = 'upscale';
            requestData = {
                task_type: 'upscale',
                video_filename: imageFilename, // 使用 video_filename 传递视频文件名
                seed: -1,
                priority: 2
            };
        } else if (workflowName === 'video_infinitetalk') {
            taskType = 'voice';
            requestData = {
                task_type: 'voice',
                video_filename: videoFilename,
                audio_filename: audioFilename,
                prompt_AU: prompt,
                seed: -1,
                priority: 2
            };
        } else if (model === 'MINI') {
            // MiniMax API 任务
            taskType = imageFilenameEnd ? 'minimax_morph' : 'minimax_i2v';
            
            // 构建图片URL（假设imageFilename是已上传到uploads的文件名）
            const imageUrl = imageFilename.startsWith('http') ? imageFilename : `${this.baseURL}/uploads/${imageFilename}`;
            
            requestData = {
                task_type: taskType,
                first_frame_image: imageUrl,
                prompt: prompt,
                priority: 2
            };
            
            // 如果是首尾帧模式，添加尾帧
            if (imageFilenameEnd) {
                const endImageUrl = imageFilenameEnd.startsWith('http') ? imageFilenameEnd : `${this.baseURL}/uploads/${imageFilenameEnd}`;
                requestData.last_frame_image = endImageUrl;
            }
        } else if (model === 'Sora2') {
            // Sora2 API 任务
            taskType = imageFilenameEnd ? 'sora2_morph' : 'sora2_i2v';
            
            requestData = {
                task_type: taskType,
                image_path: imageFilename,
                prompt: prompt,
                priority: 2
            };
            
            // 如果是首尾帧模式，添加尾帧
            if (imageFilenameEnd) {
                requestData.image_path_end = imageFilenameEnd;
            }
        } else if (model === 'Veo') {
            // Veo API 任务
            taskType = imageFilenameEnd ? 'veo_morph' : 'veo_i2v';
            
            requestData = {
                task_type: taskType,
                image_path: imageFilename,
                prompt: prompt,
                priority: 2
            };
            
            // 如果是首尾帧模式，添加尾帧
            if (imageFilenameEnd) {
                requestData.image_path_end = imageFilenameEnd;
            }
        } else if (model === '大能') {
            // Wan2.6 DashScope API 任务（不支持首尾帧）
            if (imageFilenameEnd) {
                throw new Error('大能模型不支持首尾帧模式');
            }
            
            taskType = 'wan26_i2v';
            
            requestData = {
                task_type: taskType,
                image_path: imageFilename,
                prompt: prompt,
                resolution: '1080P',  // 720P, 1080P
                duration: 5,          // 5, 10, 15
                shot_type: shotType || 'multi',  // 🆕 镜头类型：multi(智能多镜头) / single(单镜头)
                seed: -1,
                priority: 2
            };
        } else {
            requestData = {
                task_type: taskType,
                image_path: imageFilename,
                prompt: prompt,
                negative_prompt: 'nsfw, bad quality, worst quality',
                model: model,
                seed: -1,
                priority: 2
            };
            
            // 如果是首尾帧模式，添加结束帧
            if (imageFilenameEnd) {
                requestData.image_path_end = imageFilenameEnd;
            }
        }
        
        console.log('📝 提交生成任务:', requestData);
        
        const response = await fetch(`${this.baseURL}/api/generate`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            let errorMsg = '任务提交失败';
            try {
                const error = await response.json();
                console.error('❌ 任务提交失败:', error);
                errorMsg = error.detail || JSON.stringify(error);
            } catch (e) {
                const text = await response.text();
                console.error('❌ 任务提交失败 (非JSON响应):', text);
                errorMsg = text || `HTTP ${response.status}`;
            }
            throw new Error(errorMsg);
        }
        
        return await response.json();
    },
    
    // 🆕 保存视频任务到数据库
    async saveVideoTask(taskData) {
        const response = await fetch(`${this.baseURL}/api/workspace/save-task`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(taskData)
        });
        
        if (!response.ok) {
            console.error('❌ 保存任务失败:', response.statusText);
            return { success: false };
        }
        
        return await response.json();
    },
    
    // 🆕 获取用户的所有工作台任务
    async getWorkspaceTasks() {
        try {
            const response = await fetch(`${this.baseURL}/api/workspace/tasks`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            if (!response.ok) {
                console.error('❌ 获取任务失败:', response.statusText);
                return { tasks: [] };
            }
            
            return await response.json();
        } catch (error) {
            console.error('❌ 获取任务失败:', error);
            return { tasks: [] };
        }
    },
    
    // 🆕 保存workspace会话（任务组、图片、提示词）
    async saveWorkspaceSession(sessionData) {
        try {
            const response = await fetch(`${this.baseURL}/api/workspace/save-session`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(sessionData)
            });
            
            if (!response.ok) {
                console.error('❌ 保存会话失败:', response.statusText);
                return { success: false };
            }
            
            return await response.json();
        } catch (error) {
            console.error('❌ 保存会话失败:', error);
            return { success: false };
        }
    },
    
    // 🆕 加载workspace会话
    async loadWorkspaceSession() {
        try {
            const response = await fetch(`${this.baseURL}/api/workspace/load-session`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            if (!response.ok) {
                console.error('❌ 加载会话失败:', response.statusText);
                return { success: false, session: null };
            }
            
            return await response.json();
        } catch (error) {
            console.error('❌ 加载会话失败:', error);
            return { success: false, session: null };
        }
    },
    
    // 提交简单任务（兼容旧的调用方式）
    async submitSimpleTask(taskData) {
        const response = await fetch(`${this.baseURL}/api/generate`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(taskData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '任务提交失败');
        }
        
        return await response.json();
    },
    
    // 查询任务状态
    async getTaskStatus(taskId) {
        const response = await fetch(`${this.baseURL}/api/task/${taskId}`, {
            headers: this.getHeaders()
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('TASK_NOT_FOUND');
            }
            throw new Error('查询任务状态失败');
        }
        
        return await response.json();
    },
    
    // 上传音频
    async uploadAudio(file, startTime = 0, duration = 5) {
        const formData = new FormData();
        formData.append('audio', file);
        formData.append('start_time', startTime.toString());
        formData.append('duration', duration.toString());
        
        const response = await fetch(`${this.baseURL}/api/upload/audio`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('音频上传失败');
        }
        
        return await response.json();
    },
    
    // 视频重新上传
    async reuploadVideo(filename, fileType = 'output') {
        const response = await fetch(
            `${this.baseURL}/api/comfyui/reupload/video?filename=${encodeURIComponent(filename)}&file_type=${fileType}`,
            {
                method: 'POST',
                headers: this.getHeaders()
            }
        );
        
        if (!response.ok) {
            throw new Error('视频文件准备失败');
        }
        
        return await response.json();
    },
    
    // 裁剪视频
    async cropVideo(videoFilename, startTime, endTime) {
        const response = await fetch(`${this.baseURL}/api/video/crop`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                video_filename: videoFilename,
                start_time: startTime,
                end_time: endTime
            })
        });
        
        if (!response.ok) {
            throw new Error('视频裁剪失败');
        }
        
        return await response.json();
    },
    
    // 获取历史任务列表
    async getTasks(limit = 50) {
        const token = Auth.getToken();
        if (!token) {
            console.warn('⚠️ 未登录，跳过加载历史任务');
            return { tasks: [] };
        }
        
        const response = await fetch(`${this.baseURL}/api/tasks?limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                console.error('❌ token已过期，清除认证信息');
                Auth.clearAuth();
                window.location.href = '/';
                throw new Error('登录已过期，请重新登录');
            }
            throw new Error('加载历史任务失败');
        }
        
        return await response.json();
    }
};

// 导出到全局
window.API = API;

