// ==================== 模态框管理 ====================

const Modals = {
    // ==================== Lightbox ====================
    openLightbox(url, type = 'image') {
        const lightbox = document.getElementById('lightbox');
        const lightboxImg = document.getElementById('lightboxImg');
        const lightboxVideo = document.getElementById('lightboxVideo');
        const lightboxDownload = document.getElementById('lightboxDownload');
        
        if (!lightbox) return;
        
        lightbox.classList.remove('hidden');
        lightboxDownload.href = url;
        
        if (type === 'video') {
            lightboxImg.classList.add('hidden');
            lightboxVideo.classList.remove('hidden');
            lightboxVideo.src = url;
            lightboxVideo.play().catch(e => console.log("Autoplay failed"));
        } else {
            lightboxVideo.classList.add('hidden');
            lightboxVideo.pause();
            lightboxVideo.src = "";
            lightboxImg.classList.remove('hidden');
            lightboxImg.src = url;
        }
        
        setTimeout(() => lightbox.classList.remove('opacity-0'), 10);
    },
    
    closeLightbox(event) {
        const lightbox = document.getElementById('lightbox');
        const lightboxImg = document.getElementById('lightboxImg');
        const lightboxVideo = document.getElementById('lightboxVideo');
        
        if (event && (event.target === lightboxImg || event.target === lightboxVideo)) return;
        
        lightbox.classList.add('opacity-0');
        setTimeout(() => {
            lightbox.classList.add('hidden');
            lightboxImg.src = '';
            lightboxVideo.pause();
            lightboxVideo.src = '';
        }, 300);
    },
    
    // ==================== Confirm Modal (模型切换确认) ====================
    closeConfirmModal(confirmed) {
        const modal = document.getElementById('confirmModal');
        const modalContent = document.getElementById('confirmModalContent');
        modal.classList.add('opacity-0');
        modalContent.classList.remove('scale-100');
        modalContent.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
        
        if (confirmed && Workspace.pendingModelChange) {
            const { index, model } = Workspace.pendingModelChange;
            TaskManager.updateTaskModel(index, model);
            UI.refreshUI();
            UI.showToast('已切换至 ' + model + ' 模型');
        }
        Workspace.pendingModelChange = null;
    },
    
    // ==================== Voice Modal (配音) ====================
    openVoiceModal(uuid) {
        Workspace.currentVoiceTaskUuid = uuid;
        const modal = document.getElementById('voiceModal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.style.opacity = '1';
            document.getElementById('voiceModalContent').style.transform = 'scale(1)';
        }, 10);
        
        // 重置表单
        document.getElementById('voiceAudioFileName').textContent = '选择音频文件';
        document.getElementById('voiceAudioControls').classList.add('hidden');
        document.getElementById('voicePrompt').value = '';
        document.getElementById('voiceStartTime').value = '0';
        document.getElementById('voiceEndTime').value = '5';
        Workspace.currentVoiceAudioFile = null;
        
        // 填充视频选择器
        const status = TaskManager.tasksStatus[uuid];
        const videoSelect = document.getElementById('voiceVideoSelect');
        videoSelect.innerHTML = '';
        
        if (status && status.videos && status.videos.length > 0) {
            status.videos.forEach((videoUrl, idx) => {
                const option = document.createElement('option');
                option.value = idx;
                option.textContent = `视频 #${idx + 1}`;
                videoSelect.appendChild(option);
            });
        } else if (status && status.result) {
            // 兼容旧数据
            const option = document.createElement('option');
            option.value = 0;
            option.textContent = '视频 #1';
            videoSelect.appendChild(option);
        }
        
        if(typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    closeVoiceModal() {
        const modal = document.getElementById('voiceModal');
        modal.style.opacity = '0';
        document.getElementById('voiceModalContent').style.transform = 'scale(0.95)';
        setTimeout(() => {
            modal.classList.add('hidden');
            document.getElementById('voiceAudioControls').classList.add('hidden');
            document.getElementById('voiceAudioFileName').textContent = '选择音频文件';
            Workspace.currentVoiceTaskUuid = null;
            Workspace.currentVoiceAudioFile = null;
        }, 300);
    },
    
    handleVoiceAudioUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        Workspace.currentVoiceAudioFile = file;
        document.getElementById('voiceAudioFileName').textContent = file.name;
        
        // 显示音频播放器和剪裁控制
        const controls = document.getElementById('voiceAudioControls');
        controls.classList.remove('hidden');
        
        // 加载音频到播放器
        const player = document.getElementById('voiceAudioPlayer');
        const url = URL.createObjectURL(file);
        player.src = url;
        
        // 监听音频加载完成，获取时长
        player.onloadedmetadata = function() {
            const duration = player.duration;
            document.getElementById('voiceStartTime').max = Math.max(0, duration - 5);
            console.log('音频时长:', duration, '秒');
        };
        
        if(typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    // 处理粘贴的音频文件
    handleVoiceAudioFile(file) {
        if (!file || !file.type.startsWith('audio/')) {
            UI.showToast('请选择音频文件');
            return;
        }
        
        Workspace.currentVoiceAudioFile = file;
        document.getElementById('voiceAudioFileName').textContent = file.name;
        
        const controls = document.getElementById('voiceAudioControls');
        controls.classList.remove('hidden');
        
        const player = document.getElementById('voiceAudioPlayer');
        const url = URL.createObjectURL(file);
        player.src = url;
        
        player.onloadedmetadata = function() {
            const duration = player.duration;
            document.getElementById('voiceStartTime').max = Math.max(0, duration - 5);
            console.log('音频时长:', duration, '秒');
        };
    },
    
    updateVoicePreview() {
        const startTime = parseFloat(document.getElementById('voiceStartTime').value) || 0;
        const endTime = startTime + 5;
        document.getElementById('voiceEndTime').value = endTime.toFixed(1);
        
        // 更新播放器的当前时间
        const player = document.getElementById('voiceAudioPlayer');
        player.currentTime = startTime;
    },
    
    async submitVoiceTask() {
        if (!Workspace.currentVoiceTaskUuid) {
            UI.showToast('任务ID丢失');
            return;
        }
        
        if (!Workspace.currentVoiceAudioFile) {
            UI.showToast('请先上传音频文件');
            return;
        }
        
        const status = TaskManager.tasksStatus[Workspace.currentVoiceTaskUuid];
        if (!status || status.state !== 'done') {
            UI.showToast('视频未完成，无法配音');
            return;
        }
        
        // 关闭模态框
        this.closeVoiceModal();
        
        // 调用workspace的配音任务提交函数
        if (typeof Workspace.submitVoiceTask === 'function') {
            await Workspace.submitVoiceTask();
        } else {
            UI.showToast('配音功能未加载');
        }
    },
    
    // ==================== Upscale Modal (视频放大) ====================
    openUpscaleModal(uuid) {
        Workspace.currentUpscaleTaskUuid = uuid;
        const modal = document.getElementById('upscaleModal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.style.opacity = '1';
            document.getElementById('upscaleModalContent').style.transform = 'scale(1)';
        }, 10);
        
        // 填充视频选择器
        const status = TaskManager.tasksStatus[uuid];
        const videoSelect = document.getElementById('upscaleVideoSelect');
        videoSelect.innerHTML = '';
        
        if (status && status.videos && status.videos.length > 0) {
            status.videos.forEach((videoUrl, idx) => {
                const option = document.createElement('option');
                option.value = idx;
                option.textContent = `视频 #${idx + 1}`;
                videoSelect.appendChild(option);
            });
        } else if (status && status.result) {
            // 兼容旧数据
            const option = document.createElement('option');
            option.value = 0;
            option.textContent = '视频 #1';
            videoSelect.appendChild(option);
        }
        
        if(typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    closeUpscaleModal() {
        const modal = document.getElementById('upscaleModal');
        modal.style.opacity = '0';
        document.getElementById('upscaleModalContent').style.transform = 'scale(0.95)';
        setTimeout(() => {
            modal.classList.add('hidden');
            Workspace.currentUpscaleTaskUuid = null;
        }, 300);
    },
    
    async submitUpscaleTask() {
        if (!Workspace.currentUpscaleTaskUuid) {
            UI.showToast('任务ID丢失');
            return;
        }
        
        const status = TaskManager.tasksStatus[Workspace.currentUpscaleTaskUuid];
        if (!status || status.state !== 'done') {
            UI.showToast('视频未完成，无法放大');
            return;
        }
        
        // 获取选中的视频索引
        const videoSelect = document.getElementById('upscaleVideoSelect');
        const selectedIndex = parseInt(videoSelect.value);
        
        // 关闭模态框
        this.closeUpscaleModal();
        
        // 调用workspace的放大任务提交函数
        if (typeof Workspace.handleUpscaleWithIndex === 'function') {
            await Workspace.handleUpscaleWithIndex(Workspace.currentUpscaleTaskUuid, selectedIndex);
        } else {
            UI.showToast('放大功能未加载');
        }
    },
    
    // ==================== Video Edit Modal (视频编辑) ====================
    openVideoEditModal(uuid) {
        Workspace.currentEditTaskUuid = uuid;
        const status = TaskManager.tasksStatus[uuid];
        
        if (!status || status.state !== 'done' || !status.result) {
            UI.showToast('视频未完成，无法编辑');
            return;
        }
        
        // 获取所有视频
        const videos = status.videos || [status.result];
        
        // 如果有多个视频，显示选择器
        const selectContainer = document.getElementById('editVideoSelectContainer');
        const videoSelect = document.getElementById('editVideoSelect');
        
        if (videos.length > 1) {
            selectContainer.classList.remove('hidden');
            videoSelect.innerHTML = videos.map((videoUrl, index) => {
                const label = index === 0 ? '原始视频' : `视频 ${index + 1}`;
                return `<option value="${index}">${label}</option>`;
            }).join('');
        } else {
            selectContainer.classList.add('hidden');
        }
        
        // 默认使用第一个视频
        Workspace.currentEditVideoUrl = videos[0];
        
        const modal = document.getElementById('videoEditModal');
        const player = document.getElementById('editVideoPlayer');
        player.src = Workspace.currentEditVideoUrl;
        
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.style.opacity = '1';
            document.getElementById('videoEditModalContent').style.transform = 'scale(1)';
        }, 10);
        
        // 重置输入
        document.getElementById('cropStartTime').value = '0';
        document.getElementById('cropEndTime').value = '5';
        
        if(typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    closeVideoEditModal() {
        const modal = document.getElementById('videoEditModal');
        modal.style.opacity = '0';
        document.getElementById('videoEditModalContent').style.transform = 'scale(0.95)';
        setTimeout(() => {
            modal.classList.add('hidden');
            const player = document.getElementById('editVideoPlayer');
            player.pause();
            player.src = '';
            Workspace.currentEditTaskUuid = null;
            Workspace.currentEditVideoUrl = null;
        }, 300);
    },
    
    changeEditVideo() {
        const status = TaskManager.tasksStatus[Workspace.currentEditTaskUuid];
        const videos = status.videos || [status.result];
        const selectedIndex = parseInt(document.getElementById('editVideoSelect').value) || 0;
        
        Workspace.currentEditVideoUrl = videos[selectedIndex];
        const player = document.getElementById('editVideoPlayer');
        player.src = Workspace.currentEditVideoUrl;
        player.load();
        
        console.log('切换编辑视频:', selectedIndex, Workspace.currentEditVideoUrl);
    },
    
    async extractCurrentFrame() {
        const player = document.getElementById('editVideoPlayer');
        
        if (!player.src) {
            UI.showToast('没有视频');
            return;
        }
        
        try {
            UI.showToast('正在抽取帧...');
            
            // 创建canvas抽取当前帧
            const canvas = document.createElement('canvas');
            canvas.width = player.videoWidth;
            canvas.height = player.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(player, 0, 0, canvas.width, canvas.height);
            
            // 转换为Blob
            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/jpeg', 0.95);
            });
            
            // 创建File对象
            const imageFile = new File([blob], `frame_${Date.now()}.jpg`, { type: 'image/jpeg' });
            
            // 生成唯一ID
            const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const imageUrl = URL.createObjectURL(imageFile);
            
            // 添加到图片列表
            TaskManager.uploadedImages.push({ 
                id, 
                file: imageFile, 
                url: imageUrl,
                filename: imageFile.name
            });
            
            TaskManager.imagePrompts[id] = `抽帧时间: ${player.currentTime.toFixed(2)}s`;
            TaskManager.taskGroups.push({ uuid: UI.generateUUID(), ids: [id], model: 'Wan2' });
            
            UI.refreshUI();
            UI.showToast(`✅ 已抽取帧并添加到左侧`);
            console.log(`🖼️ 抽帧成功: ${id}, 时间: ${player.currentTime}s`);
            
        } catch (error) {
            console.error('抽帧失败:', error);
            UI.showToast('抽帧失败: ' + error.message);
        }
    },
    
    async cropVideoSegment() {
        const startTime = parseFloat(document.getElementById('cropStartTime').value) || 0;
        const endTime = parseFloat(document.getElementById('cropEndTime').value) || 5;
        
        if (endTime <= startTime) {
            UI.showToast('结束时间必须大于开始时间');
            return;
        }
        
        if (!Workspace.currentEditVideoUrl) {
            UI.showToast('无法获取视频URL');
            return;
        }
        
        // 调用workspace的裁剪功能
        if (typeof Workspace.cropVideoSegment === 'function') {
            await Workspace.cropVideoSegment(startTime, endTime);
        } else {
            UI.showToast('裁剪功能未加载');
        }
    },
    
    seekToTime(seconds) {
        const videoPlayer = document.getElementById('editVideoPlayer');
        videoPlayer.currentTime = seconds;
    },
    
    setCurrentTimeAsStart() {
        const videoPlayer = document.getElementById('editVideoPlayer');
        document.getElementById('cropStartTime').value = videoPlayer.currentTime.toFixed(1);
    },
    
    setCurrentTimeAsEnd() {
        const videoPlayer = document.getElementById('editVideoPlayer');
        document.getElementById('cropEndTime').value = videoPlayer.currentTime.toFixed(1);
    },
    
    // ==================== Redo Modal (重做任务) ====================
    openRedoModal(uuid) {
        Workspace.pendingRedoTaskUuid = uuid;
        const group = TaskManager.taskGroups.find(g => g.uuid === uuid);
        if (!group) return;
        
        const prompt = TaskManager.imagePrompts[group.ids[0]] || "";
        document.getElementById('redoPromptInput').value = prompt;
        
        const modal = document.getElementById('redoModal');
        const modalContent = document.getElementById('redoModalContent');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modalContent.classList.remove('scale-95');
            modalContent.classList.add('scale-100');
        }, 10);
        
        if(typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    closeRedoModal() {
        const modal = document.getElementById('redoModal');
        const modalContent = document.getElementById('redoModalContent');
        modal.classList.add('opacity-0');
        modalContent.classList.remove('scale-100');
        modalContent.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
        Workspace.pendingRedoTaskUuid = null;
    },
    
    confirmRedo() {
        if (Workspace.pendingRedoTaskUuid) {
            const newPrompt = document.getElementById('redoPromptInput').value;
            const group = TaskManager.taskGroups.find(g => g.uuid === Workspace.pendingRedoTaskUuid);
            if (group) {
                TaskManager.imagePrompts[group.ids[0]] = newPrompt;
                this.closeRedoModal();
                UI.refreshUI();
                setTimeout(() => Workspace.runTask(Workspace.pendingRedoTaskUuid), 300);
            }
        }
    }
};

// 导出到全局
window.Modals = Modals;

// 全局便捷函数
window.closeLightbox = (event) => Modals.closeLightbox(event);
window.closeConfirmModal = (confirmed) => Modals.closeConfirmModal(confirmed);
window.openVoiceModal = (uuid) => Modals.openVoiceModal(uuid);
window.closeVoiceModal = () => Modals.closeVoiceModal();
window.handleVoiceAudioUpload = (event) => Modals.handleVoiceAudioUpload(event);
window.updateVoicePreview = () => Modals.updateVoicePreview();
window.submitVoiceTask = () => Modals.submitVoiceTask();
window.openVideoEditModal = (uuid) => Modals.openVideoEditModal(uuid);
window.closeVideoEditModal = () => Modals.closeVideoEditModal();
window.changeEditVideo = () => Modals.changeEditVideo();
window.extractCurrentFrame = () => Modals.extractCurrentFrame();
window.cropVideoSegment = () => Modals.cropVideoSegment();
window.seekToTime = (seconds) => Modals.seekToTime(seconds);
window.setCurrentTimeAsStart = () => Modals.setCurrentTimeAsStart();
window.setCurrentTimeAsEnd = () => Modals.setCurrentTimeAsEnd();
window.closeRedoModal = () => Modals.closeRedoModal();
window.confirmRedo = () => Modals.confirmRedo();

