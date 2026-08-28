// ==================== UI 工具函数 ====================

const UI = {
    // 生成UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },
    
    // 显示Toast消息
    showToast(msg) {
        const toast = document.getElementById('toast');
        const msgEl = document.getElementById('toastMsg');
        if (!toast || !msgEl) return;
        
        msgEl.innerText = msg;
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
    },
    
    // 刷新UI
    refreshUI() {
        this.renderStoryboard();
        this.renderResultsQueue();
        this.updateSelectAllCheckbox();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    // 滚动同步
    setupScrollSync() {
        let isScrollSyncing = false;
        
        const syncScroll = (sourceContainer) => {
            if (isScrollSyncing) return;
            isScrollSyncing = true;
            
            const storyboard = document.getElementById('storyboardContainer');
            const results = document.getElementById('resultsContainer');
            const targetContainer = sourceContainer === storyboard ? results : storyboard;
            
            const maxScroll = sourceContainer.scrollHeight - sourceContainer.clientHeight;
            if (maxScroll <= 0) {
                isScrollSyncing = false;
                return;
            }
            
            const scrollPercentage = sourceContainer.scrollTop / maxScroll;
            const targetMaxScroll = targetContainer.scrollHeight - targetContainer.clientHeight;
            if (targetMaxScroll > 0) {
                targetContainer.scrollTop = scrollPercentage * targetMaxScroll;
            }
            
            requestAnimationFrame(() => {
                isScrollSyncing = false;
            });
        };
        
        const storyboard = document.getElementById('storyboardContainer');
        const results = document.getElementById('resultsContainer');
        
        if (storyboard) {
            storyboard.addEventListener('scroll', () => syncScroll(storyboard));
        }
        if (results) {
            results.addEventListener('scroll', () => syncScroll(results));
        }
    },
    
    // 添加时间戳参数，防止浏览器缓存
    getCacheBustedUrl(url) {
        if (!url) return '';
        if (url.startsWith('blob:')) return url;
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}_t=${Date.now()}`;
    },
    
    // 创建连接按钮HTML
    createLinkButtonHtml(index, viewMode) {
        const marginClass = viewMode === 'card' ? '-my-5' : '-my-3';
        return `
            <div class="flex justify-center ${marginClass} relative z-10 mb-2 pointer-events-none">
                <button onclick="TaskManager.linkGroups(${index}); UI.refreshUI();" class="pointer-events-auto bg-slate-800 hover:bg-purple-600 text-slate-400 hover:text-white border border-slate-600 hover:border-purple-500 rounded-full p-1 transition-all shadow-lg transform hover:scale-110" title="合并为首尾帧任务">
                    <i data-lucide="link" class="w-3 h-3"></i>
                </button>
            </div>
        `;
    },
    
    // 渲染分镜板
    renderStoryboard() {
        const container = document.getElementById('storyboardContainer');
        if (!container) return;
        
        const scrollTop = container.scrollTop;
        
        // 保存emptyLeft引用（在清空之前）
        let emptyLeft = document.getElementById('emptyLeft');
        const emptyLeftHTML = emptyLeft ? emptyLeft.outerHTML : `<div id="emptyLeft" class="absolute inset-0 flex flex-col items-center justify-center text-slate-600 pointer-events-none">
            <i data-lucide="images" class="w-16 h-16 mb-4 opacity-20"></i>
            <p class="text-sm">拖拽图片或 Ctrl+V 粘贴</p>
        </div>`;
        
        container.innerHTML = '';
        
        if (TaskManager.uploadedImages.length === 0) {
            container.innerHTML = emptyLeftHTML;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }
        
        // 渲染任务卡片
        TaskManager.taskGroups.forEach((group, index) => {
            const card = this.createStoryboardCard(group, index);
            container.appendChild(card);
            
            // 添加链接按钮（如果可以）
            if (index < TaskManager.taskGroups.length - 1) {
                const currentIsSingle = group.ids.length === 1;
                const nextGroup = TaskManager.taskGroups[index + 1];
                const nextIsSingle = nextGroup.ids.length === 1;
                if (currentIsSingle && nextIsSingle) {
                    const btnContainer = this.createLinkButton(index);
                    container.appendChild(btnContainer);
                }
            }
        });
        
        container.scrollTop = scrollTop;
    },
    
    // 创建分镜卡片
    createStoryboardCard(group, index) {
        const taskCard = document.createElement('div');
        const isPair = group.ids.length === 2;
        const viewMode = Workspace.viewMode;
        
        taskCard.setAttribute('draggable', 'true');
        taskCard.setAttribute('data-index', index);
        taskCard.classList.add('draggable-item');
        
        if (viewMode === 'card') {
            taskCard.className = 'draggable-item relative bg-slate-800 rounded-xl border border-slate-700 p-4 transition-all hover:border-slate-600 group mb-4 card-mode-item';
        } else {
            taskCard.className = 'draggable-item relative bg-slate-800 rounded-lg border border-slate-700 p-2 flex gap-3 items-start hover:border-slate-600 group mb-2 list-mode-item';
        }
        
        // 绑定拖拽事件
        taskCard.addEventListener('dragstart', (e) => DragDrop.handleDragStart(e, index));
        taskCard.addEventListener('dragend', DragDrop.handleDragEnd);
        taskCard.addEventListener('dragenter', DragDrop.handleDragEnter);
        taskCard.addEventListener('dragleave', DragDrop.handleDragLeave);
        
        // 生成卡片HTML
        taskCard.innerHTML = this.generateStoryboardCardHTML(group, index, isPair, viewMode);
        
        return taskCard;
    },
    
    // 生成分镜卡片HTML
    generateStoryboardCardHTML(group, index, isPair, viewMode) {
        const img1 = TaskManager.uploadedImages.find(i => i.id === group.ids[0]);
        const img2 = isPair ? TaskManager.uploadedImages.find(i => i.id === group.ids[1]) : null;
        
        // 🔧 检查图片是否存在
        if (!img1) {
            console.error(`❌ 找不到图片 ${group.ids[0]}，任务组 ${group.uuid}`);
            return `<div class="text-red-400 text-xs p-4">错误：图片不存在</div>`;
        }
        if (isPair && !img2) {
            console.error(`❌ 找不到图片 ${group.ids[1]}，任务组 ${group.uuid}`);
            return `<div class="text-red-400 text-xs p-4">错误：图片不存在</div>`;
        }
        
        // 模型选择
        const modelSelectHtml = `
            <select onchange="TaskManager.updateTaskModel(${index}, this.value); UI.refreshUI();" class="bg-slate-900 border border-slate-700 text-[10px] text-white rounded px-1 py-0.5 focus:outline-none focus:border-indigo-500 cursor-pointer hover:bg-slate-700">
                <option value="Wan2" ${group.model === 'Wan2' ? 'selected' : ''}>Wan2</option>
                <option value="一阶" ${group.model === '一阶' ? 'selected' : ''}>Smooth</option>
                <option value="二阶" ${group.model === '二阶' ? 'selected' : ''}>Dawasi</option>
                <option value="三阶" ${group.model === '三阶' ? 'selected' : ''}>Hunyuan Video</option>
                <option value="四阶" ${group.model === '四阶' ? 'selected' : ''}>LTX Video</option>
                <option value="五阶" ${group.model === '五阶' ? 'selected' : ''}>Turbo 2.2</option>
                <option value="六阶" ${group.model === '六阶' ? 'selected' : ''}>Turbo 2.1</option>
                <option value="七阶" ${group.model === '七阶' ? 'selected' : ''}>SVD-WAN</option>
                <option value="Veo" ${group.model === 'Veo' ? 'selected' : ''}>veo-3.1-landscape-fast-fl</option>
                <option value="Sora2" ${group.model === 'Sora2' ? 'selected' : ''}>sora_video2-landscape-15s</option>
                <option value="MINI" ${group.model === 'MINI' ? 'selected' : ''}>MiniMax-Hailuo-2.3</option>
                <option value="大能" ${group.model === '大能' ? 'selected' : ''}>wan2.6-i2v</option>
            </select>
        `;
        
        // 🆕 大能模型的镜头类型选择器（仅在大能模型时显示）
        const shotTypeHtml = group.model === '大能' ? `
            <select onchange="TaskManager.taskGroups[${index}].shotType = this.value; UI.refreshUI();" class="bg-amber-900/30 border border-amber-600/50 text-[10px] text-amber-200 rounded px-1 py-0.5 focus:outline-none focus:border-amber-500 cursor-pointer hover:bg-amber-800/40">
                <option value="multi" ${(group.shotType || 'multi') === 'multi' ? 'selected' : ''}>智能多镜头</option>
                <option value="single" ${group.shotType === 'single' ? 'selected' : ''}>单镜头</option>
            </select>
        ` : '';
        
        // 音频控件
        const audioInfo = Workspace.imageAudios[group.ids[0]];
        const audioHtml = audioInfo 
            ? `<div class="flex items-center gap-1 bg-green-500/20 border border-green-500/30 rounded px-1.5 py-0.5">
                 <i data-lucide="volume-2" class="w-3 h-3 text-green-400"></i>
                 <span class="text-[10px] text-green-300">${audioInfo.name.substring(0, 8)}...</span>
                 <button onclick="Workspace.removeAudio('${group.ids[0]}')" class="text-red-400 hover:text-red-300 ml-1">
                   <i data-lucide="x" class="w-3 h-3"></i>
                 </button>
               </div>`
            : `<label class="flex items-center gap-1 bg-slate-700/50 border border-slate-600 rounded px-1.5 py-0.5 cursor-pointer hover:bg-slate-600/50">
                 <i data-lucide="upload" class="w-3 h-3 text-slate-400"></i>
                 <span class="text-[10px] text-slate-400">上传音频</span>
                 <input type="file" accept="audio/*" onchange="Workspace.handleAudioUpload('${group.ids[0]}', event)" class="hidden">
               </label>`;
        
        const typeLabel = isPair ? 'Morph' : 'I2V';
        const typeClass = isPair ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' : 'bg-blue-500/20 text-blue-300 border-blue-500/30';
        const typeHtml = `<span class="${typeClass} text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border mr-2">${typeLabel}</span>`;
        
        // 格式化上传时间
        const formatUploadTime = (timestamp) => {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);
            
            if (minutes < 1) return '刚刚';
            if (minutes < 60) return `${minutes}分钟前`;
            if (hours < 24) return `${hours}小时前`;
            if (days < 7) return `${days}天前`;
            return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        };
        
        const uploadTimeHtml = img1?.uploadTime 
            ? `<span class="text-[10px] text-slate-500 flex items-center gap-1">
                <i data-lucide="clock" class="w-3 h-3"></i>
                ${formatUploadTime(img1.uploadTime)}
               </span>`
            : '';
        
        const actionBtns = isPair 
            ? `<button onclick="TaskManager.unlinkGroup(${index}); UI.refreshUI();" class="text-xs text-slate-500 hover:text-red-400 p-1" title="拆分"><i data-lucide="unlink" class="w-3.5 h-3.5"></i></button>`
            : `<button onclick="TaskManager.removeTask('${group.uuid}'); UI.refreshUI();" class="text-slate-500 hover:text-red-400 p-1" title="删除"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>`;
        
        const dragHandle = `<div class="cursor-grab text-slate-600 hover:text-slate-400 mr-2"><i data-lucide="grip-vertical" class="w-4 h-4"></i></div>`;
        
        if (viewMode === 'card') {
            return this.generateCardModeHTML(group, index, img1, img2, isPair, modelSelectHtml, shotTypeHtml, audioHtml, typeHtml, actionBtns, dragHandle, uploadTimeHtml);
        } else {
            return this.generateListModeHTML(group, index, img1, img2, isPair, modelSelectHtml, shotTypeHtml, audioHtml, typeHtml, actionBtns, dragHandle, uploadTimeHtml);
        }
    },
    
    // 生成卡片模式HTML
    generateCardModeHTML(group, index, img1, img2, isPair, modelSelectHtml, shotTypeHtml, audioHtml, typeHtml, actionBtns, dragHandle, uploadTimeHtml) {
        const header = `
            <div class="flex justify-between items-center w-full mb-2 pb-2 border-b border-slate-700/50 shrink-0">
                <div class="flex items-center gap-2 flex-wrap">
                    ${dragHandle} ${typeHtml} ${modelSelectHtml} ${shotTypeHtml} ${audioHtml}
                </div>
                <div class="flex items-center gap-2">
                    ${uploadTimeHtml}
                    ${actionBtns}
                </div>
            </div>
        `;
        
        let visual = '';
        if (isPair && img2) {
            visual = `
                <div class="w-full flex items-center justify-center gap-2 shrink-0 mb-1">
                    <div class="flex-1 relative bg-black rounded-lg overflow-hidden border border-slate-600 group/img cursor-zoom-in" onclick="Modals.openLightbox('${img1.url}')">
                        <img src="${img1.url}" loading="lazy" class="w-full h-32 object-contain bg-black/50">
                        <div class="absolute bottom-0 left-0 bg-black/60 text-white text-[10px] px-1">Start</div>
                    </div>
                    <div class="text-slate-500"><i data-lucide="arrow-right" class="w-4 h-4"></i></div>
                    <div class="flex-1 relative bg-black rounded-lg overflow-hidden border border-slate-600 group/img cursor-zoom-in" onclick="Modals.openLightbox('${img2.url}')">
                        <img src="${img2.url}" loading="lazy" class="w-full h-32 object-contain bg-black/50">
                        <div class="absolute bottom-0 left-0 bg-black/60 text-white text-[10px] px-1">End</div>
                    </div>
                </div>
            `;
        } else {
            visual = `
                <div class="w-full flex items-center justify-center gap-2 shrink-0">
                    <div class="relative w-full bg-black rounded-lg overflow-hidden border border-slate-600 group/img cursor-zoom-in" onclick="Modals.openLightbox('${img1.url}')">
                        <img src="${img1.url}" loading="lazy" class="w-full h-52 object-contain bg-black/50">
                    </div>
                </div>
            `;
        }
        
        const promptInput = `
            <div class="flex-1 relative group/input mt-2 min-h-0 flex flex-col">
                <textarea
                    oninput="TaskManager.updatePrompt('${group.ids[0]}', this.value)"
                    placeholder="${isPair ? '描述变化过程...' : '描述动作内容...'}"
                    class="flex-1 w-full bg-black/30 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none prompt-input resize-none"
                >${TaskManager.imagePrompts[group.ids[0]] || ''}</textarea>
            </div>
        `;
        
        return header + visual + promptInput;
    },
    
    // 生成列表模式HTML
    generateListModeHTML(group, index, img1, img2, isPair, modelSelectHtml, shotTypeHtml, audioHtml, typeHtml, actionBtns, dragHandle, uploadTimeHtml) {
        let thumb = '';
        if (isPair && img2) {
            thumb = `<div class="flex flex-col gap-1 w-32 shrink-0 h-full justify-center">
                <img src="${img1.url}" loading="lazy" class="w-full h-12 object-cover rounded border border-slate-600 bg-black">
                <img src="${img2.url}" loading="lazy" class="w-full h-12 object-cover rounded border border-slate-600 bg-black">
            </div>`;
        } else {
            thumb = `<div class="w-32 shrink-0 h-full flex items-center">
                <img src="${img1.url}" loading="lazy" class="w-full h-24 object-contain rounded border border-slate-600 bg-black">
            </div>`;
        }
        
        const promptInput = `
            <div class="flex-1 w-full h-full">
                <textarea
                    oninput="TaskManager.updatePrompt('${group.ids[0]}', this.value)"
                    placeholder="${isPair ? '描述变化...' : '描述动作...'}"
                    class="w-full h-full bg-black/30 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none resize-none"
                >${TaskManager.imagePrompts[group.ids[0]] || ''}</textarea>
            </div>
        `;
        
        return `
            <div class="flex items-center h-full pt-2 shrink-0">${dragHandle}</div>
            ${thumb}
            <div class="flex-1 flex flex-col gap-2 h-full py-1 min-w-0">
                <div class="flex justify-between items-center shrink-0">
                    <div class="flex items-center gap-2">${typeHtml}<span class="text-xs text-slate-500">#${index+1}</span>${uploadTimeHtml}</div>
                    <div class="flex items-center gap-2">${modelSelectHtml}${shotTypeHtml}${audioHtml}${actionBtns}</div>
                </div>
                ${promptInput}
            </div>
        `;
    },
    
    // 创建链接按钮
    createLinkButton(index) {
        const div = document.createElement('div');
        const marginClass = Workspace.viewMode === 'card' ? '-my-5' : '-my-3';
        div.innerHTML = `
            <div class="flex justify-center ${marginClass} relative z-10 mb-2 pointer-events-none">
                <button onclick="TaskManager.linkGroups(${index}); UI.refreshUI();" class="pointer-events-auto bg-slate-800 hover:bg-purple-600 text-slate-400 hover:text-white border border-slate-600 hover:border-purple-500 rounded-full p-1 transition-all shadow-lg transform hover:scale-110" title="合并为首尾帧任务">
                    <i data-lucide="link" class="w-3 h-3"></i>
                </button>
            </div>
        `;
        return div.firstElementChild;
    },
    
    // 渲染结果队列
    renderResultsQueue() {
        const resultsContainer = document.getElementById('resultsContainer');
        const taskCountBadge = document.getElementById('taskCountBadge');
        
        if (!resultsContainer) return;
        
        const scrollTop = resultsContainer.scrollTop;
        
        // 保存emptyRight引用（在清空之前）
        let emptyRight = document.getElementById('emptyRight');
        const emptyRightHTML = emptyRight ? emptyRight.outerHTML : `<div id="emptyRight" class="h-full flex flex-col items-center justify-center text-slate-600">
            <i data-lucide="film" class="w-12 h-12 mb-4 opacity-20"></i>
            <p class="text-sm">等待任务配置...</p>
        </div>`;
        
        resultsContainer.innerHTML = '';
        
        if (TaskManager.taskGroups.length === 0) {
            resultsContainer.innerHTML = emptyRightHTML;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            if (taskCountBadge) taskCountBadge.innerText = `0 任务`;
            this.updateSelectAllCheckbox();
            return;
        } else {
            if (taskCountBadge) taskCountBadge.innerText = `${TaskManager.taskGroups.length} 任务`;
        }
        
        // 渲染任务卡片
        TaskManager.taskGroups.forEach((group, index) => {
            const card = this.createResultCard(group, index);
            resultsContainer.appendChild(card);
            
            // 添加链接按钮
            if (index < TaskManager.taskGroups.length - 1) {
                const currentIsSingle = group.ids.length === 1;
                const nextGroup = TaskManager.taskGroups[index + 1];
                const nextIsSingle = nextGroup.ids.length === 1;
                if (currentIsSingle && nextIsSingle) {
                    const btnContainer = document.createElement('div');
                    btnContainer.innerHTML = this.createLinkButtonHtml(index, Workspace.viewMode);
                    resultsContainer.appendChild(btnContainer.firstElementChild);
                }
            }
        });
        
        resultsContainer.scrollTop = scrollTop;
        this.updateSelectAllCheckbox();
    },
    
    // 创建结果卡片（完整版）
    createResultCard(group, index) {
        const resultItem = document.createElement('div');
        const uuid = group.uuid;
        const isPair = group.ids.length === 2;
        const status = TaskManager.tasksStatus[uuid] || { state: 'idle', progress: 0 };
        const viewMode = Workspace.viewMode;
        
        resultItem.setAttribute('draggable', 'true');
        resultItem.setAttribute('data-index', index);
        resultItem.classList.add('draggable-item');
        
        if (viewMode === 'card') {
            resultItem.className = `draggable-item bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col gap-3 ${status.selected ? 'border-blue-500 ring-1 ring-blue-500/30' : ''} mb-4 card-mode-item`;
        } else {
            resultItem.className = `draggable-item bg-slate-800 rounded-lg border border-slate-700 p-2 flex gap-3 items-center ${status.selected ? 'border-blue-500 ring-1 ring-blue-500/30' : ''} mb-2 list-mode-item`;
        }
        
        resultItem.addEventListener('dragstart', (e) => DragDrop.handleDragStart(e, index));
        resultItem.addEventListener('dragend', DragDrop.handleDragEnd);
        resultItem.addEventListener('dragenter', DragDrop.handleDragEnter);
        resultItem.addEventListener('dragleave', DragDrop.handleDragLeave);
        
        // 生成完整的结果卡片HTML
        resultItem.innerHTML = this.generateResultCardHTML(group, index, uuid, isPair, status, viewMode);
        
        return resultItem;
    },
    
    // 生成结果卡片HTML
    generateResultCardHTML(group, index, uuid, isPair, status, viewMode) {
        const checkbox = `<input type="checkbox" onchange="TaskManager.toggleTaskSelection('${uuid}', this.checked); UI.updateSelectAllCheckbox();" class="task-checkbox w-4 h-4 shrink-0 rounded bg-slate-700 border-slate-600 text-indigo-600 focus:ring-offset-0 cursor-pointer" ${status.selected ? 'checked' : ''}>`;
        const promptText = TaskManager.imagePrompts[group.ids[0]] || "";
        const dragHandle = `<div class="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 w-4 shrink-0 flex justify-center" title="拖拽排序"><i data-lucide="grip-vertical" class="w-4 h-4"></i></div>`;
        
        // 状态文本
        const renderStatusText = () => {
            if (status.state === 'running') {
                const timeStr = TaskManager.getElapsedTimeStr(uuid);
                return `<div class="text-xs text-indigo-400 flex items-center gap-1" data-uuid-header="${uuid}"><i data-lucide="loader-2" class="w-3 h-3 loader-spin"></i> ${timeStr}</div>`;
            }
            else if (status.state === 'processing') {
                return `<div class="text-xs text-purple-400 flex items-center gap-1"><i data-lucide="loader-2" class="w-3 h-3 loader-spin"></i> 处理中 ${status.progress || 0}%</div>`;
            }
            else if (status.state === 'done') return `<div class="text-xs text-green-400 flex items-center gap-1"><i data-lucide="check-circle" class="w-3 h-3"></i> 完成</div>`;
            else return `<div class="text-xs text-slate-500">等待</div>`;
        };
        
        // 操作按钮
        const btnLabel = status.state === 'done' ? '重做' : '生成';
        const btnIcon = status.state === 'done' ? 'refresh-cw' : 'play';
        const btnAction = status.state === 'done' ? `Workspace.redoTask('${uuid}')` : `Workspace.runTask('${uuid}')`;
        let actionBtn = `<button onclick="${btnAction}" class="flex items-center gap-1.5 px-3 py-1 bg-slate-700 hover:bg-indigo-600 text-white text-xs rounded transition-colors"><i data-lucide="${btnIcon}" class="w-3 h-3"></i> ${btnLabel}</button>`;
        
        // 检查是否有视频结果
        const hasVideoResult = 
            (status.state === 'done') || 
            (status.state === 'idle' && status.keepResult && status.result) ||
            (status.state === 'running' && status.videos && status.videos.length > 0);
        
        if (hasVideoResult) {
            if (!status.isUpscaled) {
                actionBtn += `<button onclick="Workspace.handleUpscale('${uuid}')" class="flex items-center gap-1.5 px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded transition-colors ml-2" title="视频放大"><i data-lucide="maximize" class="w-3 h-3"></i> 放大</button>`;
            } else {
                actionBtn += `<span class="flex items-center gap-1.5 px-3 py-1 bg-green-700 text-white text-xs rounded ml-2" title="已放大"><i data-lucide="check-circle" class="w-3 h-3"></i> 已放大</span>`;
            }
            actionBtn += `<button onclick="Modals.openVoiceModal('${uuid}')" class="flex items-center gap-1.5 px-3 py-1 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded transition-colors ml-2" title="视频配音"><i data-lucide="mic" class="w-3 h-3"></i> 配音</button>`;
            actionBtn += `<button onclick="Modals.openVideoEditModal('${uuid}')" class="flex items-center gap-1.5 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded transition-colors ml-2" title="视频编辑"><i data-lucide="scissors" class="w-3 h-3"></i> 编辑</button>`;
            
            if (status.originalResult) {
                actionBtn += `<button onclick="Modals.openLightbox('${status.originalResult}', 'video')" class="flex items-center gap-1.5 px-3 py-1 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded transition-colors ml-2" title="查看原视频"><i data-lucide="eye" class="w-3 h-3"></i> 原片</button>`;
            }
        }
        
        // 只读提示词
        const renderReadOnlyPrompt = () => {
            if (viewMode === 'card') {
                return `<div class="flex-1 relative mt-2 min-h-0 flex flex-col"><div class="flex-1 w-full bg-black/20 border border-slate-700/50 rounded px-3 py-2 text-xs text-slate-400 overflow-y-auto whitespace-pre-wrap border-l-2 border-l-slate-600">${promptText || '<span class="italic opacity-50">无独立描述...</span>'}</div></div>`;
            } else {
                return `<div class="flex-1 w-full bg-black/20 border border-slate-700/50 rounded px-2 py-1 text-xs text-slate-400 overflow-y-auto border-l-2 border-l-slate-600">${promptText || '<span class="italic opacity-50">无独立描述...</span>'}</div>`;
            }
        };
        
        if (viewMode === 'card') {
            return this.generateResultCardModeHTML(group, index, uuid, isPair, status, checkbox, dragHandle, renderStatusText(), actionBtn, renderReadOnlyPrompt());
        } else {
            return this.generateResultListModeHTML(group, index, uuid, isPair, status, checkbox, dragHandle, renderStatusText(), actionBtn, renderReadOnlyPrompt());
        }
    },
    
    // Stable internal keys map to creator-facing model names.
    getModelDisplayName(model) {
        const modelNameMap = {
            'Wan2': 'Wan2',
            '一阶': 'Smooth',
            '二阶': 'Dawasi',
            '三阶': 'Hunyuan Video',
            '四阶': 'LTX Video',
            '五阶': 'Turbo 2.2',
            '六阶': 'Turbo 2.1',
            '七阶': 'SVD-WAN',
            'Veo': 'veo-3.1-landscape-fast-fl',
            'MINI': 'MiniMax-Hailuo-2.3',
            'Sora2': 'sora_video2-landscape-15s',
            '大能': 'wan2.6-i2v'
        };
        return modelNameMap[model] || model;
    },
    
    // 生成结果卡片模式HTML
    generateResultCardModeHTML(group, index, uuid, isPair, status, checkbox, dragHandle, statusText, actionBtn, readOnlyPrompt) {
        const modelDisplayName = this.getModelDisplayName(group.model);
        const header = `<div class="flex justify-between items-center w-full mb-2 pb-2 border-b border-slate-700/50 shrink-0"><div class="flex items-center gap-2">${dragHandle} ${checkbox}<span class="text-xs font-bold text-slate-300">#${index+1} ${isPair?'Morph':'I2V'}</span><span class="text-[10px] px-1 rounded border border-slate-600 text-slate-400">${modelDisplayName}</span></div>${statusText}</div>`;
        const visual = this.generateResultVisualHTML(group, uuid, isPair, status, true);
        const footer = `<div class="mt-2 flex justify-end shrink-0">${actionBtn}</div>`;
        return header + visual + readOnlyPrompt + footer;
    },
    
    // 生成结果列表模式HTML
    generateResultListModeHTML(group, index, uuid, isPair, status, checkbox, dragHandle, statusText, actionBtn, readOnlyPrompt) {
        const modelDisplayName = this.getModelDisplayName(group.model);
        const visual = this.generateResultVisualHTML(group, uuid, isPair, status, false);
        return `<div class="flex items-center h-full pt-2 shrink-0 gap-1">${dragHandle}${checkbox}</div>${visual}<div class="flex-1 flex flex-col gap-2 h-full py-1 min-w-0"><div class="flex justify-between items-center shrink-0"><div class="flex items-center gap-2"><span class="text-xs font-bold text-slate-300">#${index+1}</span><span class="text-[10px] text-slate-500">${modelDisplayName}</span></div>${statusText}</div>${readOnlyPrompt}</div><div class="self-center w-20 flex justify-end shrink-0">${actionBtn}</div>`;
    },
    
    // 生成结果视觉HTML（视频预览或图片）
    generateResultVisualHTML(group, uuid, isPair, status, isCardMode) {
        const visualClass = isCardMode ? "w-full flex items-center justify-center gap-2 shrink-0" : "";
        const heightClass = isCardMode ? (isPair ? 'h-32' : 'h-52') : '';
        
        if (status.state === 'done') {
            return this.generateDoneVisual(uuid, status, isPair, isCardMode, visualClass, heightClass);
        } else if (status.state === 'running' || status.state === 'processing') {
            return this.generateRunningVisual(uuid, status, isPair, isCardMode, visualClass, heightClass);
        } else {
            return this.generateIdleVisual(group, uuid, status, isPair, isCardMode, visualClass, heightClass);
        }
    },
    
    // 生成完成状态的视觉HTML
    generateDoneVisual(uuid, status, isPair, isCardMode, visualClass, heightClass) {
        // 只有明确标记为过期的才显示警告，ComfyUI代理URL正常可用
        const isExpiredUrl = status.isExpired === true;
        const expiredWarning = isExpiredUrl 
            ? `<div class="absolute bottom-0 left-0 right-0 bg-orange-600/90 text-white text-[10px] px-2 py-1 text-center z-10 backdrop-blur-sm flex items-center justify-center gap-1">
                <i data-lucide="alert-triangle" class="w-3 h-3"></i> 文件已过期或不可用
            </div>`
            : '';
        
        const videos = status.videos || [status.result];
        const videoCount = videos.length;
        const videoTimes = status.videoGenerateTimes || [];
        const totalTime = status.totalGenerationTime;
        
        // 格式化总生成时间
        let totalTimeLabel = '';
        if (totalTime > 0) {
            if (totalTime >= 60) {
                const minutes = Math.floor(totalTime / 60);
                const seconds = totalTime % 60;
                totalTimeLabel = `总耗时 ${minutes}分${seconds}秒`;
            } else {
                totalTimeLabel = `总耗时 ${totalTime}秒`;
            }
        }
        
        console.log(`🎬 渲染视频卡片 ${uuid}:`, {
            videoCount,
            videoTimes,
            totalTime,
            hasVideoTimes: videoTimes.length > 0
        });
        
        if (!isCardMode) {
            // 列表模式 - 单个缩略图（显示最新视频）
            const latestVideoTime = videoTimes.length > 0 ? videoTimes[videoTimes.length - 1] : null;
            const listTimeLabel = latestVideoTime 
                ? `<span class="absolute top-1 right-1 bg-green-500/80 text-white text-[9px] px-1.5 py-0.5 rounded font-bold z-10">${latestVideoTime}s</span>`
                : '';
            
            // 列表模式下的总时间标签
            const listTotalTimeTag = totalTimeLabel 
                ? `<div class="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[9px] text-cyan-400 font-medium flex items-center gap-0.5 z-10">
                    <i data-lucide="clock" class="w-2.5 h-2.5"></i>
                    <span>${totalTimeLabel.replace('总耗时 ', '')}</span>
                </div>`
                : '';
            
            return `<div class="w-32 h-full bg-black rounded border border-slate-700 overflow-hidden relative cursor-pointer shrink-0" onclick="Modals.openLightbox('${status.result}', 'video')">
                ${listTimeLabel}${listTotalTimeTag}
                <video src="${status.result}" class="w-full h-full object-cover" muted preload="none" loading="lazy" onmouseenter="this.play().catch(e=>{})" onmouseleave="this.pause(); this.currentTime=0;"></video>
            </div>`;
        }
        
        if (videoCount === 1) {
            // 单个视频
            const videoTime = videoTimes.length > 0 ? videoTimes[0] : null;
            const timeLabel = videoTime 
                ? `<span class="absolute top-2 right-2 bg-green-500/80 text-white text-[10px] px-2 py-0.5 rounded-full font-bold z-10 backdrop-blur-sm">${videoTime}s</span>`
                : '';
            
            // 总生成时间标签（左下角）
            const totalTimeTag = totalTimeLabel 
                ? `<div class="absolute bottom-2 left-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded text-[10px] text-cyan-400 font-medium flex items-center gap-1 z-10">
                    <i data-lucide="clock" class="w-3 h-3"></i>
                    <span>${totalTimeLabel}</span>
                </div>`
                : '';
            
            return `<div class="${visualClass} ${isPair ? 'mb-1' : ''}">
                <div class="relative w-full bg-black rounded-lg overflow-hidden border border-slate-700 group cursor-pointer ${heightClass}" onclick="Modals.openLightbox('${videos[0]}', 'video')">
                    ${timeLabel}${totalTimeTag}${expiredWarning}
                    <video src="${videos[0]}" class="w-full h-full object-cover" muted preload="none" loading="lazy" onmouseenter="this.play().catch(e=>{})" onmouseleave="this.pause(); this.currentTime=0;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"></video>
                    <div class="w-full h-full flex flex-col items-center justify-center text-orange-400 text-xs gap-2" style="display:none;">
                        <i data-lucide="alert-circle" class="w-8 h-8"></i><span>视频加载失败</span><span class="text-[10px] text-slate-500">可能文件已被清理</span>
                    </div>
                    <div class="absolute inset-0 flex flex-col items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                        <i data-lucide="maximize-2" class="w-5 h-5 text-white"></i>
                    </div>
                </div>
            </div>`;
        } else {
            // 多个视频 - 网格，每个视频显示自己的生成时间
            const videoCards = videos.slice(0, 5).map((videoUrl, idx) => {
                const videoTime = videoTimes[idx] || null;
                const timeLabel = videoTime 
                    ? `<span class="absolute top-1 left-1 bg-green-500/80 text-white text-[10px] px-1.5 py-0.5 rounded font-bold z-10 backdrop-blur-sm">${videoTime}s</span>`
                    : '';
                
                return `
                    <div class="relative bg-black rounded border border-slate-700 group overflow-hidden">
                        ${timeLabel}
                        <button onclick="Workspace.deleteVideo('${uuid}', ${idx}); event.stopPropagation();" class="absolute top-1 right-1 z-10 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <i data-lucide="x" class="w-3 h-3"></i>
                        </button>
                        <video src="${videoUrl}" class="w-full h-full object-cover cursor-pointer" muted preload="none" loading="lazy" onmouseenter="this.play().catch(e=>{})" onmouseleave="this.pause(); this.currentTime=0;" onclick="Modals.openLightbox('${videoUrl}', 'video')" onerror="this.style.display='none';"></video>
                    </div>
                `;
            }).join('');
            
            // 总生成时间标签（显示在网格上方）
            const totalTimeTag = totalTimeLabel 
                ? `<div class="absolute bottom-2 left-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded text-[10px] text-cyan-400 font-medium flex items-center gap-1 z-10">
                    <i data-lucide="clock" class="w-3 h-3"></i>
                    <span>${totalTimeLabel}</span>
                </div>`
                : '';
            
            return `<div class="${visualClass} ${isPair ? 'mb-1' : ''}">
                <div class="relative w-full">
                    ${totalTimeTag}
                    ${expiredWarning}
                    <div class="w-full grid grid-cols-3 gap-2 ${heightClass}">
                        ${videoCards}
                        ${videoCount < 5 ? `<div class="bg-slate-900 rounded border border-dashed border-slate-600 flex items-center justify-center text-slate-600 text-xs">+</div>` : ''}
                    </div>
                </div>
            </div>`;
        }
    },
    
    // 生成运行中状态的视觉HTML
    generateRunningVisual(uuid, status, isPair, isCardMode, visualClass, heightClass) {
        const runningVideos = status.videos || [];
        
        const overlayLoader = `
            <div class="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 text-white" style="pointer-events:none">
                <div class="loader-container scale-90">
                    <div class="loader-ring loader-ring-1"></div>
                    <div class="loader-ring loader-ring-2"></div>
                    <div class="loader-ring loader-ring-3"></div>
                    <div class="loader-core"></div>
                </div>
                <div class="text-indigo-200 text-sm">生成中...</div>
                <div class="text-slate-400 text-[10px]">旧视频仍可剪辑/配音/放大</div>
            </div>
        `;
        
        if (!isCardMode) {
            // 列表模式
            if (runningVideos.length > 0) {
                return `<div class="w-32 h-full bg-black rounded border border-slate-700 overflow-hidden relative cursor-pointer shrink-0">
                    <video src="${runningVideos[0]}" class="w-full h-full object-cover opacity-60" muted loop></video>
                    <div class="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1 text-white" style="pointer-events:none">
                        <div class="loader-ring" style="width: 32px; height: 32px; border: 2px solid transparent; border-top-color: #6366f1; border-right-color: #6366f1; animation: spin 1.5s linear infinite;"></div>
                        <div class="text-[11px] text-indigo-200">生成中...</div>
                    </div>
                </div>`;
            } else {
                return `<div class="w-32 h-full rounded border border-slate-700 flex flex-col items-center justify-center shrink-0 relative overflow-hidden" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                    <div class="absolute inset-0 progress-bar-animated progress-bar opacity-30" style="width: ${status.progress || 0}%; transition: width 0.5s ease-out;"></div>
                    <div style="position: relative; width: 40px; height: 40px; margin-bottom: 4px;">
                        <div class="loader-ring" style="width: 40px; height: 40px; border: 2px solid transparent; border-top-color: #6366f1; border-right-color: #6366f1; animation: spin-slow 2s linear infinite;"></div>
                        <div class="loader-ring" style="width: 30px; height: 30px; top: 5px; left: 5px; border: 2px solid transparent; border-bottom-color: #8b5cf6; animation: spin-reverse 1.5s linear infinite;"></div>
                        <div style="position: absolute; width: 10px; height: 10px; top: 15px; left: 15px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 50%; animation: pulse-glow 1.5s ease-in-out infinite;"></div>
                    </div>
                    <div class="relative z-10 text-[10px] text-slate-300 progress-percent">${Math.round(status.progress || 0)}%</div>
                </div>`;
            }
        }
        
        // 卡片模式
        if (runningVideos.length > 0) {
            return `<div class="${visualClass} ${isPair ? 'mb-1' : ''}">
                <div class="relative w-full bg-black rounded-lg overflow-hidden border border-slate-700 ${heightClass}">
                    <video src="${runningVideos[0]}" class="w-full h-full object-cover opacity-60" muted loop></video>
                    ${overlayLoader}
                </div>
            </div>`;
        } else {
            return `<div class="${visualClass} ${isPair ? 'mb-1' : ''}">
                <div class="w-full rounded border border-slate-700 flex flex-col items-center justify-center relative overflow-hidden ${heightClass}" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                    <div class="absolute inset-0 progress-bar-animated progress-bar opacity-30" style="width: ${status.progress || 0}%; transition: width 0.5s ease-out;"></div>
                    <div class="loader-container mb-2">
                        <div class="loader-ring loader-ring-1"></div>
                        <div class="loader-ring loader-ring-2"></div>
                        <div class="loader-ring loader-ring-3"></div>
                        <div class="loader-core"></div>
                    </div>
                    <div class="relative z-10 text-center">
                        <div class="text-indigo-400 text-sm font-medium generating-text mb-1">生成中...</div>
                        <div class="text-slate-300 text-xs progress-percent">${Math.round(status.progress || 0)}%</div>
                    </div>
                </div>
            </div>`;
        }
    },
    
    // 生成空闲状态的视觉HTML
    generateIdleVisual(group, uuid, status, isPair, isCardMode, visualClass, heightClass) {
        // 如果有keepResult标记，显示之前的视频
        if (status.keepResult && status.result) {
            const videos = status.videos || [status.result];
            const waitingLabel = '<div class="absolute top-2 left-2 bg-blue-500/80 text-white text-[10px] px-2 py-0.5 rounded-full font-bold z-10">等待重做</div>';
            
            if (!isCardMode) {
                // 列表模式
                return `<div class="w-32 shrink-0 h-full flex items-center opacity-70"><video src="${videos[0]}" class="w-full h-24 object-contain rounded border border-slate-600 bg-black cursor-pointer" muted preload="none" loading="lazy" onclick="Modals.openLightbox('${videos[0]}', 'video')"></video></div>`;
            }
            
            if (videos.length === 1) {
                return `<div class="${visualClass} ${isPair ? 'mb-1' : ''}">
                    <div class="relative w-full bg-black rounded-lg overflow-hidden border border-slate-700 group cursor-pointer ${heightClass}" onclick="Modals.openLightbox('${videos[0]}', 'video')">
                        ${waitingLabel}
                        <video src="${videos[0]}" class="w-full h-full object-cover opacity-70" muted preload="none" loading="lazy" onmouseenter="this.play().catch(e=>{})" onmouseleave="this.pause(); this.currentTime=0;"></video>
                        <div class="absolute inset-0 flex flex-col items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                            <i data-lucide="maximize-2" class="w-5 h-5 text-white"></i>
                        </div>
                    </div>
                </div>`;
            } else {
                const videoCards = videos.slice(0, 5).map((videoUrl, idx) => `
                    <div class="relative bg-black rounded border border-slate-700 group overflow-hidden">
                        <button onclick="Workspace.deleteVideo('${uuid}', ${idx}); event.stopPropagation();" class="absolute top-1 right-1 z-10 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <i data-lucide="x" class="w-3 h-3"></i>
                        </button>
                        <video src="${videoUrl}" class="w-full h-full object-cover cursor-pointer opacity-70" muted preload="none" loading="lazy" onmouseenter="this.play().catch(e=>{})" onmouseleave="this.pause(); this.currentTime=0;" onclick="Modals.openLightbox('${videoUrl}', 'video')"></video>
                    </div>
                `).join('');
                
                return `<div class="${visualClass} ${isPair ? 'mb-1' : ''}">
                    <div class="relative w-full">
                        ${waitingLabel}
                        <div class="w-full grid grid-cols-3 gap-2 ${heightClass}">
                            ${videoCards}
                            ${videos.length < 5 ? `<div class="bg-slate-900 rounded border border-dashed border-slate-600 flex items-center justify-center text-slate-600 text-xs">+</div>` : ''}
                        </div>
                    </div>
                </div>`;
            }
        }
        
        // 没有保留视频，显示原图
        const img1 = TaskManager.uploadedImages.find(i => i.id === group.ids[0]);
        if (!isCardMode) {
            // 列表模式
            if (isPair) {
                const img2 = TaskManager.uploadedImages.find(i => i.id === group.ids[1]);
                return `<div class="flex flex-col gap-1 w-32 shrink-0 h-full justify-center opacity-60 grayscale"><img src="${img1?.url || ''}" loading="lazy" onerror="this.style.display='none'" class="w-full h-12 object-cover rounded border border-slate-600 bg-black"><img src="${img2?.url || ''}" loading="lazy" onerror="this.style.display='none'" class="w-full h-12 object-cover rounded border border-slate-600 bg-black"></div>`;
            } else {
                return `<div class="w-32 shrink-0 h-full flex items-center opacity-60 grayscale"><img src="${img1?.url || ''}" loading="lazy" onerror="this.style.display='none'" class="w-full h-24 object-contain rounded border border-slate-600 bg-black"></div>`;
            }
        }
        
        // 卡片模式
        if (isPair) {
            const img2 = TaskManager.uploadedImages.find(i => i.id === group.ids[1]);
            return `<div class="${visualClass} mb-1 opacity-60 grayscale"><div class="flex-1 ${heightClass} bg-black rounded border border-slate-700 overflow-hidden"><img src="${img1?.url || ''}" loading="lazy" onerror="this.style.display='none'" class="w-full h-full object-contain"></div><div class="flex-1 ${heightClass} bg-black rounded border border-slate-700 overflow-hidden"><img src="${img2?.url || ''}" loading="lazy" onerror="this.style.display='none'" class="w-full h-full object-contain"></div></div>`;
        } else {
            return `<div class="${visualClass} opacity-60 grayscale"><div class="w-full ${heightClass} bg-black rounded border border-slate-700 overflow-hidden"><img src="${img1?.url || ''}" loading="lazy" onerror="this.style.display='none'" class="w-full h-full object-contain"></div></div>`;
        }
    },
    
    // 更新全选复选框
    updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (!selectAllCheckbox) return;
        
        if (TaskManager.taskGroups.length === 0) {
            selectAllCheckbox.checked = false;
            return;
        }
        
        const allSelected = TaskManager.taskGroups.every((group) => 
            TaskManager.tasksStatus[group.uuid] && TaskManager.tasksStatus[group.uuid].selected
        );
        selectAllCheckbox.checked = allSelected;
    },
    
    // 切换视图模式
    toggleViewMode(mode) {
        Workspace.viewMode = mode;
        const btnCard = document.getElementById('viewBtnCard');
        const btnList = document.getElementById('viewBtnList');
        const activeClass = ['bg-slate-700', 'shadow', 'text-white'];
        const inactiveClass = ['text-slate-400'];
        
        if (mode === 'card') {
            btnCard.classList.add(...activeClass);
            btnCard.classList.remove(...inactiveClass);
            btnList.classList.remove(...activeClass);
            btnList.classList.add(...inactiveClass);
        } else {
            btnList.classList.add(...activeClass);
            btnList.classList.remove(...inactiveClass);
            btnCard.classList.remove(...activeClass);
            btnCard.classList.add(...inactiveClass);
        }
        this.refreshUI();
    }
};

// 拖拽处理
const DragDrop = {
    handleDragStart(e, index) {
        Workspace.dragSrcIndex = index;
        Workspace.isDragging = true;
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index);
    },
    
    handleDragEnd(e) {
        Workspace.isDragging = false;
        e.target.classList.remove('dragging');
        document.querySelectorAll('.draggable-item').forEach(item => item.classList.remove('drag-over'));
    },
    
    handleDragEnter(e) {
        e.target.closest('.draggable-item')?.classList.add('drag-over');
    },
    
    handleDragLeave(e) {
        e.target.closest('.draggable-item')?.classList.remove('drag-over');
    },
    
    handleDrop(e) {
        e.stopPropagation();
        e.preventDefault();
        Workspace.isDragging = false;
        
        const targetItem = e.target.closest('.draggable-item');
        if (!targetItem) return;
        
        const dragDestIndex = parseInt(targetItem.getAttribute('data-index'));
        if (Workspace.dragSrcIndex !== dragDestIndex && Workspace.dragSrcIndex !== null) {
            const itemToMove = TaskManager.taskGroups[Workspace.dragSrcIndex];
            TaskManager.taskGroups.splice(Workspace.dragSrcIndex, 1);
            TaskManager.taskGroups.splice(dragDestIndex, 0, itemToMove);
            UI.refreshUI();
            UI.showToast('顺序已更新');
        }
        return false;
    }
};

// 拖拽文件上传功能
const FileUpload = {
    // 设置拖拽上传功能
    setupDragAndDrop() {
        // 创建拖拽提示层
        const dropOverlay = document.createElement('div');
        dropOverlay.id = 'dropOverlay';
        dropOverlay.className = 'fixed inset-0 z-[100] bg-indigo-900/90 backdrop-blur-sm hidden flex items-center justify-center';
        dropOverlay.innerHTML = `
            <div class="text-center">
                <div class="w-32 h-32 mx-auto mb-6 rounded-full bg-white/10 flex items-center justify-center">
                    <i data-lucide="upload-cloud" class="w-16 h-16 text-white"></i>
                </div>
                <h3 class="text-2xl font-bold text-white mb-2">拖拽文件到此处</h3>
                <p class="text-white/70">支持图片、视频、音频文件</p>
            </div>
        `;
        document.body.appendChild(dropOverlay);
        
        // 防止默认拖拽行为
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.body.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });
        
        // 拖拽进入
        let dragCounter = 0;
        
        document.body.addEventListener('dragenter', (e) => {
            if (!Auth.isLoggedIn()) return;
            
            // 检查是否包含文件（外部拖入）
            // 内部拖拽的 dataTransfer.types 通常是 ['text/plain']
            // 外部文件拖入的 dataTransfer.types 会包含 'Files'
            const hasFiles = e.dataTransfer.types.includes('Files');
            
            if (hasFiles) {
                dragCounter++;
                if (dragCounter === 1) {
                    dropOverlay.classList.remove('hidden');
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                }
            }
        });
        
        // 拖拽离开
        document.body.addEventListener('dragleave', (e) => {
            if (!Auth.isLoggedIn()) return;
            
            const hasFiles = e.dataTransfer.types.includes('Files');
            if (hasFiles) {
                dragCounter--;
                if (dragCounter === 0) {
                    dropOverlay.classList.add('hidden');
                }
            }
        });
        
        // 拖拽悬停
        document.body.addEventListener('dragover', (e) => {
            if (!Auth.isLoggedIn()) return;
            
            const hasFiles = e.dataTransfer.types.includes('Files');
            if (hasFiles) {
                e.dataTransfer.dropEffect = 'copy';
            }
        });
        
        // 文件放下
        document.body.addEventListener('drop', async (e) => {
            if (!Auth.isLoggedIn()) return;
            
            dragCounter = 0;
            dropOverlay.classList.add('hidden');
            
            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0) return;  // 内部拖拽或无文件
            
            const imageFiles = files.filter(f => f.type.startsWith('image/'));
            const videoFiles = files.filter(f => f.type.startsWith('video/'));
            const audioFiles = files.filter(f => f.type.startsWith('audio/'));
            
            // 处理图片
            if (imageFiles.length > 0) {
                if (typeof Workspace !== 'undefined' && Workspace.handleFiles) {
                    Workspace.handleFiles(imageFiles);
                    UI.showToast(`📁 上传了 ${imageFiles.length} 张图片`);
                }
            }
            
            // 处理视频
            if (videoFiles.length > 0) {
                for (const file of videoFiles) {
                    if (typeof Workspace !== 'undefined' && Workspace.handleVideoUpload) {
                        await Workspace.handleVideoUpload({ target: { files: [file] } });
                    }
                }
                UI.showToast(`📁 上传了 ${videoFiles.length} 个视频`);
            }
            
            // 处理音频（如果配音模态框打开）
            if (audioFiles.length > 0) {
                const voiceModal = document.getElementById('voiceModal');
                if (voiceModal && !voiceModal.classList.contains('hidden')) {
                    if (typeof Modals !== 'undefined' && Modals.handleVoiceAudioFile) {
                        Modals.handleVoiceAudioFile(audioFiles[0]);
                        UI.showToast(`📁 上传了音频: ${audioFiles[0].name}`);
                    }
                } else {
                    UI.showToast(`💡 提示：打开配音面板后可拖拽上传音频`);
                }
            }
        });
    }
};

// 历史记录功能
const History = {
    // 页面切换
    switchPage(page) {
        const workspaceMain = document.getElementById('workspaceMain');
        const historyMain = document.getElementById('historyMain');
        const pageWorkspace = document.getElementById('pageWorkspace');
        const pageHistory = document.getElementById('pageHistory');
        
        const activeClass = ['bg-slate-700', 'shadow', 'text-white'];
        const inactiveClass = ['text-slate-400'];
        
        if (page === 'workspace') {
            workspaceMain.style.display = 'flex';
            historyMain.style.display = 'none';
            pageWorkspace.classList.add(...activeClass);
            pageWorkspace.classList.remove(...inactiveClass);
            pageHistory.classList.remove(...activeClass);
            pageHistory.classList.add(...inactiveClass);
        } else if (page === 'history') {
            workspaceMain.style.display = 'none';
            historyMain.style.display = 'flex';
            pageHistory.classList.add(...activeClass);
            pageHistory.classList.remove(...inactiveClass);
            pageWorkspace.classList.remove(...activeClass);
            pageWorkspace.classList.add(...inactiveClass);
            
            // 加载历史记录
            this.loadHistory();
        }
    },
    
    // 加载历史记录
    async loadHistory() {
        try {
            const result = await API.getTasks(100);
            const tasks = result.tasks || [];
            this.renderHistory(tasks);
        } catch (error) {
            console.error('加载历史记录失败:', error);
            UI.showToast('加载历史记录失败');
        }
    },
    
    // 渲染历史记录
    renderHistory(tasks) {
        const container = document.getElementById('historyContainer');
        const countText = document.getElementById('historyCountText');
        
        if (!container) return;
        
        // 更新任务数量
        if (countText) {
            countText.textContent = `共 ${tasks.length} 个任务`;
        }
        
        // 先清空内容
        container.innerHTML = '';
        
        if (tasks.length === 0) {
            // 显示空状态
            container.className = 'flex-1 flex items-center justify-center pb-8';
            container.innerHTML = `
                <div class="text-center py-20">
                    <div class="mb-6">
                        <svg class="w-24 h-24 mx-auto text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                    </div>
                    <h3 class="text-xl font-semibold text-slate-400 mb-2">暂无历史记录</h3>
                    <p class="text-sm text-slate-500">开始生成你的第一个视频吧</p>
                </div>
            `;
            return;
        }
        
        // 恢复网格布局
        container.className = 'flex-1 overflow-y-auto grid grid-cols-3 gap-5 auto-rows-max pb-8';
        
        container.innerHTML = tasks.map(task => {
            const statusBadge = {
                'completed': '<span class="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px]">已完成</span>',
                'failed': '<span class="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px]">失败</span>',
                'cancelled': '<span class="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px]">已取消</span>',
                'processing': '<span class="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px]">处理中</span>',
                'queued': '<span class="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px]">队列中</span>'
            }[task.status] || '<span class="px-2 py-0.5 bg-slate-500/20 text-slate-400 rounded text-[10px]">未知</span>';
            
            let videoUrl = '';
            if (task.result && task.result.videos && task.result.videos.length > 0) {
                let relativeUrl = task.result.videos[0].url;
                // 兼容旧数据：修正单数路径为复数路径
                if (relativeUrl.startsWith('/storage/video/')) {
                    relativeUrl = relativeUrl.replace('/storage/video/', '/storage/videos/');
                } else if (relativeUrl.startsWith('/storage/image/')) {
                    relativeUrl = relativeUrl.replace('/storage/image/', '/storage/images/');
                }
                videoUrl = relativeUrl.startsWith('http') ? relativeUrl : `${API.baseURL}${relativeUrl}`;
                if (!videoUrl.includes('token=')) {
                    videoUrl = videoUrl + (videoUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                }
            } else if (task.result && task.result.images && task.result.images.length > 0) {
                let relativeUrl = task.result.images[0].url;
                // 兼容旧数据：修正单数路径为复数路径
                if (relativeUrl.startsWith('/storage/video/')) {
                    relativeUrl = relativeUrl.replace('/storage/video/', '/storage/videos/');
                } else if (relativeUrl.startsWith('/storage/image/')) {
                    relativeUrl = relativeUrl.replace('/storage/image/', '/storage/images/');
                }
                videoUrl = relativeUrl.startsWith('http') ? relativeUrl : `${API.baseURL}${relativeUrl}`;
                if (!videoUrl.includes('token=')) {
                    videoUrl = videoUrl + (videoUrl.includes('?') ? '&' : '?') + `token=${Auth.getToken()}`;
                }
            }
            
            const createdDate = task.created_at ? new Date(task.created_at).toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}) : '未知';
            const prompt = task.data?.prompt || '无提示词';
            const taskTypeLabel = task.task_type === 'i2v' ? 'I2V' : task.task_type === 'morph' ? 'Morph' : task.task_type === 'upscale' ? '放大' : task.task_type === 'voice' ? '配音' : task.task_type;
            
            // 计算生成时间
            let generationTime = '';
            if (task.status === 'completed' && task.completed_at) {
                let startTime = task.started_at ? new Date(task.started_at) : new Date(task.created_at);
                let endTime = new Date(task.completed_at);
                let durationSeconds = Math.floor((endTime - startTime) / 1000);
                
                if (durationSeconds >= 60) {
                    const minutes = Math.floor(durationSeconds / 60);
                    const seconds = durationSeconds % 60;
                    generationTime = `${minutes}分${seconds}秒`;
                } else if (durationSeconds > 0) {
                    generationTime = `${durationSeconds}秒`;
                }
            }
            
            return `
                <div class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden hover:border-indigo-500 transition-all hover:shadow-lg hover:shadow-indigo-900/20 group relative" data-task-id="${task.task_id}">
                    <!-- 复选框 -->
                    <div class="absolute top-3 left-3 z-10">
                        <input type="checkbox" 
                               class="history-checkbox w-5 h-5 rounded border-2 border-slate-600 bg-slate-700/80 text-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer transition-all"
                               data-task-id="${task.task_id}"
                               data-video-url="${videoUrl}"
                               ${task.status !== 'completed' || !videoUrl ? 'disabled' : ''}>
                    </div>
                    <!-- 视频/图片预览 -->
                    <div class="relative w-full aspect-video bg-slate-900">
                        ${videoUrl && task.status === 'completed' ? `
                            ${task.result && task.result.images && task.result.images.length > 0 ? `
                                <!-- 图片预览 -->
                                <img src="${videoUrl}" loading="lazy" class="w-full h-full object-cover cursor-pointer" 
                                     onclick="Modals.openLightbox('${videoUrl}', 'image')" 
                                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                <div class="w-full h-full flex flex-col items-center justify-center text-orange-400 text-xs gap-2" style="display:none;">
                                    <i data-lucide="alert-circle" class="w-12 h-12 opacity-50"></i>
                                    <span>图片文件不存在</span>
                                    <span class="text-[10px] text-slate-500">可能已被清理或移动</span>
                                </div>
                            ` : `
                                <!-- 视频预览 -->
                                <video src="${videoUrl}" class="w-full h-full object-cover cursor-pointer" 
                                       onclick="Modals.openLightbox('${videoUrl}', 'video')"
                                       preload="metadata"
                                       loading="lazy"
                                       muted
                                       loop
                                       playsinline
                                       onmouseenter="this.play().catch(e => console.log('播放失败:', e))"
                                       onmouseleave="this.pause(); this.currentTime = 0;"
                                       onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"></video>
                                <div class="w-full h-full flex flex-col items-center justify-center text-orange-400 text-xs gap-2" style="display:none;">
                                    <i data-lucide="alert-circle" class="w-12 h-12 opacity-50"></i>
                                    <span>视频文件不存在</span>
                                    <span class="text-[10px] text-slate-500">可能已被清理或移动</span>
                                </div>
                            `}
                            ${generationTime ? `
                                <div class="absolute bottom-2 right-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded text-[10px] text-green-400 font-medium flex items-center gap-1">
                                    <i data-lucide="clock" class="w-3 h-3"></i>
                                    <span>${generationTime}</span>
                                </div>
                            ` : ''}
                        ` : `
                            <div class="w-full h-full flex items-center justify-center text-slate-600">
                                <i data-lucide="${task.result && task.result.images ? 'image' : 'file-video'}" class="w-16 h-16 opacity-20"></i>
                            </div>
                        `}
                    </div>
                    
                    <!-- 信息区域 -->
                    <div class="p-3">
                        <!-- 标题行 -->
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-1.5">
                                ${statusBadge}
                                <!-- 🔧 隐藏任务类型/工作流名称 -->
                            </div>
                            <span class="text-[10px] text-slate-500">${createdDate}</span>
                        </div>
                        
                        <!-- 提示词 -->
                        <div class="text-xs text-slate-400 mb-3 line-clamp-2 min-h-[2.5rem]">
                            ${prompt || '<span class="italic opacity-50">无提示词</span>'}
                        </div>
                        
                        ${task.error ? `
                            <div class="text-[10px] text-red-400 mb-2 line-clamp-1">
                                错误：${task.error}
                            </div>
                        ` : ''}
                        
                        <!-- 操作按钮 -->
                        <div class="flex gap-2">
                            ${videoUrl && task.status === 'completed' ? `
                                <a href="${videoUrl}" download class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition-colors">
                                    <i data-lucide="download" class="w-3 h-3"></i> 下载
                                </a>
                            ` : `
                                <button disabled class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-700 text-slate-500 rounded text-xs cursor-not-allowed">
                                    <i data-lucide="download" class="w-3 h-3"></i> 下载
                                </button>
                            `}
                            <button onclick="History.deleteHistoryTask('${task.task_id}')" class="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-medium transition-colors">
                                <i data-lucide="trash-2" class="w-3 h-3"></i> 删除
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        if(typeof lucide !== 'undefined') lucide.createIcons();
    },
    
    // 删除历史任务
    async deleteHistoryTask(taskId) {
        if (!confirm('确定要彻底删除此任务吗？此操作无法撤销。')) {
            return;
        }
        
        try {
            UI.showToast('正在删除...');
            
            const response = await fetch(`${API.baseURL}/api/task/${taskId}/delete`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${Auth.getToken()}`
                }
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: '删除失败' }));
                throw new Error(error.detail || '删除失败');
            }
            
            // 🔧 立即从DOM中移除该任务卡片，不重新加载
            const taskCard = document.querySelector(`[data-task-id="${taskId}"]`);
            if (taskCard) {
                taskCard.style.transition = 'opacity 0.3s, transform 0.3s';
                taskCard.style.opacity = '0';
                taskCard.style.transform = 'scale(0.9)';
                
                setTimeout(() => {
                    taskCard.remove();
                    
                    // 检查是否还有任务，如果没有显示空状态
                    const historyContainer = document.getElementById('history-list');
                    if (historyContainer && historyContainer.children.length === 0) {
                        historyContainer.innerHTML = `
                            <div class="text-center py-12 text-slate-400">
                                <i data-lucide="inbox" class="w-12 h-12 mx-auto mb-3 opacity-50"></i>
                                <p>暂无历史记录</p>
                            </div>
                        `;
                        if(typeof lucide !== 'undefined') lucide.createIcons();
                    }
                }, 300);
            }
            
            UI.showToast('✅ 任务已删除');
        } catch (error) {
            console.error('删除任务失败:', error);
            UI.showToast('❌ 删除失败: ' + error.message);
        }
    },
    
    // 全选/取消全选历史记录
    selectAllHistory() {
        const checkboxes = document.querySelectorAll('.history-checkbox:not(:disabled)');
        if (checkboxes.length === 0) {
            UI.showToast('没有可选择的任务');
            return;
        }
        
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        
        checkboxes.forEach(cb => {
            cb.checked = !allChecked;
        });
        
        UI.showToast(allChecked ? '已取消全选' : `已选中 ${checkboxes.length} 个任务`);
    },
    
    // 批量下载选中的历史记录
    async downloadSelectedHistory() {
        const checkboxes = document.querySelectorAll('.history-checkbox:checked');
        
        if (checkboxes.length === 0) {
            UI.showToast('请先选择要下载的视频');
            return;
        }
        
        UI.showToast(`开始下载 ${checkboxes.length} 个视频...`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const checkbox of checkboxes) {
            const videoUrl = checkbox.dataset.videoUrl;
            const taskId = checkbox.dataset.taskId;
            
            if (!videoUrl) continue;
            
            try {
                // 创建一个临时的a标签来触发下载
                const link = document.createElement('a');
                link.href = videoUrl;
                link.download = `video_${taskId.substring(0, 8)}.mp4`;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                successCount++;
                
                // 延迟避免同时下载过多
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error('下载失败:', error);
                failCount++;
            }
        }
        
        UI.showToast(`下载完成：成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`);
    },
    
    // 批量删除选中的历史记录
    async deleteSelectedHistory() {
        const checkboxes = document.querySelectorAll('.history-checkbox:checked');
        
        if (checkboxes.length === 0) {
            UI.showToast('请先选择要删除的任务');
            return;
        }
        
        if (!confirm(`确定要删除选中的 ${checkboxes.length} 个任务吗？此操作无法撤销。`)) {
            return;
        }
        
        UI.showToast(`开始删除 ${checkboxes.length} 个任务...`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const checkbox of checkboxes) {
            const taskId = checkbox.dataset.taskId;
            
            if (!taskId) continue;
            
            try {
                const response = await fetch(`${API.baseURL}/api/task/${taskId}/delete`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${Auth.getToken()}`
                    }
                });
                
                if (!response.ok) {
                    throw new Error('删除失败');
                }
                
                successCount++;
                
                // 延迟避免请求过快
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                console.error('删除任务失败:', error);
                failCount++;
            }
        }
        
        UI.showToast(`删除完成：成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`);
        
        // 重新加载历史记录
        this.loadHistory();
    }
};

// 导出到全局
window.UI = UI;
window.DragDrop = DragDrop;
window.FileUpload = FileUpload;
window.History = History;

// 全局便捷函数
window.selectAllHistory = () => History.selectAllHistory();
window.downloadSelectedHistory = () => History.downloadSelectedHistory();
