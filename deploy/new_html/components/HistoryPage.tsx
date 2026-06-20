import React, { useState, useEffect, useCallback } from 'react';
import { History, Download, Trash2, RefreshCw, CheckSquare, Square, Film, Image as ImageIcon, Play, Clock, AlertTriangle, X, HardDrive, ShieldAlert } from 'lucide-react';
import { fetchUserFiles, deleteEntityFile, hardDeleteEntityFile, hardDeleteEntityFiles, type EntityFile } from '../services/entityFileService';
import { LazyVideo } from './LazyVideo';
import { apiJson, secureApiUrl } from '../services/httpClient';

interface HistoryPageProps {
  // 预留扩展
}

export const HistoryPage: React.FC<HistoryPageProps> = () => {
  const [files, setFiles] = useState<EntityFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'video' | 'image'>('video');
  const [deleteModal, setDeleteModal] = useState<{ mode: 'single' | 'batch'; files: EntityFile[] } | null>(null);
  const [hardDelete, setHardDelete] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchUserFiles('image', 200, 0);
      let allFiles = data.items;

      if (allFiles.length === 0) {
        const taskFiles = await loadTaskImages();
        allFiles = taskFiles;
      }

      setFiles(allFiles);
    } catch (error: any) {
      console.error('加载历史记录失败:', error);
      setLoadError(error?.message || '加载历史记录失败');
      try {
        const taskFiles = await loadTaskImages();
        if (taskFiles.length > 0) {
          setFiles(taskFiles);
          setLoadError(null);
        }
      } catch { /* ignore fallback error */ }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadTaskImages = async (): Promise<EntityFile[]> => {
    let data: { tasks?: any[] };
    try {
      data = await apiJson<{ tasks?: any[] }>('/api/tasks?limit=100', {}, '加载任务图片');
    } catch {
      return [];
    }
    const taskFiles: EntityFile[] = [];
    for (const task of (data.tasks || [])) {
      if (task.status !== 'completed') continue;
      const images = task.result?.images || [];
      for (const img of images) {
        const url = img.url || img;
        if (!url || typeof url !== 'string') continue;
        taskFiles.push({
          fileId: `task_${task.task_id}_${taskFiles.length}`,
          fileUrl: url,
          fileType: 'image',
          fileRole: 'generated_image',
          isSelected: false,
          createdAt: task.completed_at || task.created_at || '',
          metadata: { prompt: task.data?.prompt, model: task.data?.model || task.task_type, source: 'task' },
        });
      }
    }
    return taskFiles;
  };

  const [activeTasks, setActiveTasks] = useState<Array<{
    task_id: string;
    status: string;
    task_type: string;
    created_at: string;
  }>>([]);

  const loadActiveTasks = useCallback(async () => {
    try {
      const data = await apiJson<{ tasks?: any[] }>('/api/tasks?status=processing,queued&limit=20', {}, '加载进行中任务');
      setActiveTasks((data.tasks || []).filter((t: any) =>
        t.status === 'processing' || t.status === 'queued'
      ));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    loadActiveTasks();
    const interval = setInterval(loadActiveTasks, 10000);
    return () => clearInterval(interval);
  }, [loadActiveTasks]);

  // 切换选择
  const toggleSelect = (fileId: string) => {
    const newSelected = new Set(selectedTasks);
    if (newSelected.has(fileId)) {
      newSelected.delete(fileId);
    } else {
      newSelected.add(fileId);
    }
    setSelectedTasks(newSelected);
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    const completedFiles = files.filter(f => getMediaUrl(f));
    if (selectedTasks.size === completedFiles.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(completedFiles.map(f => f.fileId)));
    }
  };

  const openDeleteModal = (file: EntityFile) => {
    setDeleteModal({ mode: 'single', files: [file] });
    setHardDelete(true);
    setDeleteProgress(null);
  };

  const openBatchDeleteModal = () => {
    if (selectedTasks.size === 0) return;
    const selected = files.filter(f => selectedTasks.has(f.fileId));
    setDeleteModal({ mode: 'batch', files: selected });
    setHardDelete(true);
    setDeleteProgress(null);
  };

  const executeDelete = async () => {
    if (!deleteModal) return;
    setIsDeleting(true);
    const ids = deleteModal.files.map(f => f.fileId);
    const total = ids.length;

    try {
      if (hardDelete) {
        if (ids.length === 1) {
          await hardDeleteEntityFile(ids[0]);
        } else {
          await hardDeleteEntityFiles(ids);
        }
      } else {
        let done = 0;
        for (const id of ids) {
          await deleteEntityFile(id);
          done++;
          setDeleteProgress({ done, total });
        }
      }
      setSelectedTasks(new Set());
      setDeleteModal(null);
      loadHistory();
    } catch (error: any) {
      console.error('删除失败:', error);
      alert(`删除失败: ${error?.message || '未知错误'}`);
    } finally {
      setIsDeleting(false);
      setDeleteProgress(null);
    }
  };

  // 批量下载
  const downloadSelected = async () => {
    if (selectedTasks.size === 0) {
      alert('请先选择要下载的文件');
      return;
    }

    let downloadCount = 0;
    for (const fileId of selectedTasks) {
      const file = files.find(f => f.fileId === fileId);
      if (!file) continue;

      const url = getMediaUrl(file);
      if (!url) continue;

      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = isVideo(file)
          ? `video_${fileId.substring(0, 8)}.mp4`
          : `image_${fileId.substring(0, 8)}.jpg`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        downloadCount++;

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('下载失败:', fileId, error);
      }
    }

    alert(`成功下载 ${downloadCount} 个文件`);
  };

  // 获取媒体URL（原图）
  const getMediaUrl = (file: EntityFile): string | null => {
    if (!file.fileUrl) return null;
    return secureApiUrl(file.fileUrl, { absolute: true });
  };

  const getThumbnailUrl = (file: EntityFile): string | null => {
    return getMediaUrl(file);
  };

  const isVideo = (file: EntityFile): boolean => {
    return file.fileType === 'video';
  };

  // 格式化时间
  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 打开预览
  const openPreview = (file: EntityFile) => {
    const url = getMediaUrl(file);
    if (url) {
      setPreviewUrl(url);
      setPreviewType(isVideo(file) ? 'video' : 'image');
    }
  };

  const meta = (file: EntityFile) => file.metadata as { prompt?: string; model?: string } | undefined;

  return (
    <div className="flex flex-col h-full bg-n20">
      {/* 头部 - 固定52px高度 */}
      <div className="h-[52px] px-4 bg-n0 border-b border-n40 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <History className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-n700 uppercase tracking-wider">生成历史</h2>
          <span className="text-xs text-n100">共 {files.length} 个文件</span>
        </div>

        <div className="flex items-center gap-2">
          {/* 全选 */}
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 rounded text-xs font-medium transition-colors"
          >
            {selectedTasks.size > 0 ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            {selectedTasks.size > 0 ? `已选 ${selectedTasks.size}` : '全选'}
          </button>

          {/* 批量下载 */}
          <button
            onClick={downloadSelected}
            disabled={selectedTasks.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover disabled:bg-n0 disabled:text-n100 text-white rounded text-xs font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            批量下载
          </button>

          {/* 批量删除 */}
          <button
            onClick={openBatchDeleteModal}
            disabled={selectedTasks.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-danger hover:bg-red-500 disabled:bg-n0 disabled:text-n100 text-white rounded text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            批量删除
          </button>

          {/* 刷新 */}
          <button
            onClick={loadHistory}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 rounded text-xs font-medium transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTasks.length > 0 && (
          <div className="mb-4 p-3 bg-b50 border border-b75 rounded-lg">
            <h4 className="text-xs font-bold text-b400 mb-2 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 animate-spin" />
              进行中 ({activeTasks.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {activeTasks.map(t => (
                <div key={t.task_id} className="px-3 py-1.5 bg-b50 border border-b75 rounded text-xs text-b400">
                  {t.task_type} - {t.status === 'processing' ? '处理中' : '排队中'}
                </div>
              ))}
            </div>
          </div>
        )}
        {loadError && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-danger text-xs font-bold mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              加载出错
            </div>
            <p className="text-danger text-xs">{loadError}</p>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
              <span className="text-n300">加载中...</span>
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-n100">
            <History className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">暂无历史记录</p>
            <p className="text-sm mt-2">开始生成你的第一个视频吧</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {files.map(file => {
              const mediaUrl = getMediaUrl(file);
              const thumbnailUrl = getThumbnailUrl(file);
              const isVideoFile = isVideo(file);
              const isSelected = selectedTasks.has(file.fileId);
              const canSelect = !!mediaUrl;
              const m = meta(file);

              return (
                <div
                  key={file.fileId}
                  className={`bg-n0 rounded-md border overflow-hidden hover:border-primary transition-all shadow-card hover:shadow-atlas group relative ${
                    isSelected ? 'border-primary ring-1 ring-primary/30' : 'border-n40'
                  }`}
                >
                  {/* 复选框 */}
                  {canSelect && (
                    <div className="absolute top-3 left-3 z-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(file.fileId)}
                        className="w-5 h-5 rounded border-2 border-n40 bg-n0 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-0 cursor-pointer transition-all"
                      />
                    </div>
                  )}

                  {/* 预览区域 */}
                  <div
                    className="relative w-full aspect-video bg-n0 cursor-pointer"
                    onClick={() => canSelect && openPreview(file)}
                  >
                    {mediaUrl ? (
                      <>
                        {isVideoFile ? (
                          <LazyVideo
                            src={mediaUrl}
                            className="w-full h-full object-cover"
                            muted
                            loop
                            playsInline
                          />
                        ) : (
                          <img src={thumbnailUrl || mediaUrl} className="w-full h-full object-cover" loading="lazy" alt="" />
                        )}

                        <div className="absolute inset-0 flex items-center justify-center bg-n900/50 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="w-12 h-12 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-n100">
                        {isVideoFile ? <Film className="w-16 h-16 opacity-20" /> : <ImageIcon className="w-16 h-16 opacity-20" />}
                      </div>
                    )}
                  </div>

                  {/* 信息区域 */}
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-n100 truncate max-w-[55%]" title={m?.model}>
                        {m?.model || '—'}
                      </span>
                      <span className="text-[10px] text-n100 shrink-0">{formatTime(file.createdAt)}</span>
                    </div>

                    <div className="text-xs text-n300 mb-3 line-clamp-2 min-h-[2.5rem]">
                      {m?.prompt || <span className="italic opacity-50">无提示词</span>}
                    </div>

                    <div className="flex gap-2">
                      {mediaUrl ? (
                        <a
                          href={mediaUrl}
                          download
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-medium transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          下载
                        </a>
                      ) : (
                        <button
                          disabled
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-n0 text-n100 rounded text-xs cursor-not-allowed"
                        >
                          <Download className="w-3 h-3" />
                          下载
                        </button>
                      )}
                      <button
                        onClick={() => openDeleteModal(file)}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-danger hover:bg-red-500 text-white rounded text-xs font-medium transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm" onClick={() => !isDeleting && setDeleteModal(null)}>
          <div
            className="relative w-full max-w-lg mx-4 bg-n0 border border-red-500/20 rounded-2xl shadow-bottom shadow-red-950/30 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="h-1 bg-gradient-to-r from-red-600 via-red-500 to-orange-500" />

            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5 text-danger" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-n800">
                    {deleteModal.mode === 'single' ? '确认删除' : `批量删除 ${deleteModal.files.length} 个文件`}
                  </h3>
                  <p className="text-xs text-n100 mt-0.5">此操作不可撤销</p>
                </div>
              </div>
              {!isDeleting && (
                <button onClick={() => setDeleteModal(null)} className="w-8 h-8 rounded-lg hover:bg-n20 flex items-center justify-center text-n100 hover:text-n700 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="px-6 py-3">
              {deleteModal.mode === 'single' ? (
                <div className="flex gap-4 p-3 bg-n30 rounded-md border border-n40">
                  <div className="w-24 h-24 rounded-lg overflow-hidden bg-n0 flex-shrink-0">
                    {deleteModal.files[0]?.fileUrl ? (
                      <img src={getMediaUrl(deleteModal.files[0]) || ''} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-n100" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-n300 truncate">{meta(deleteModal.files[0])?.model || '未知模型'}</p>
                    <p className="text-xs text-n100 mt-1">{formatTime(deleteModal.files[0]?.createdAt || '')}</p>
                    <p className="text-xs text-n100 mt-2 line-clamp-2">{meta(deleteModal.files[0])?.prompt || '无提示词'}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    {deleteModal.files.slice(0, 8).map(f => (
                      <div key={f.fileId} className="aspect-square rounded-lg overflow-hidden bg-n0 border border-n40">
                        {f.fileUrl ? (
                          <img src={getMediaUrl(f) || ''} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-6 h-6 text-n100" /></div>
                        )}
                      </div>
                    ))}
                  </div>
                  {deleteModal.files.length > 8 && (
                    <p className="text-xs text-n100 text-center">...还有 {deleteModal.files.length - 8} 个文件</p>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-3">
              <label className="flex items-center gap-3 p-3 rounded-md bg-n30 border border-n40 cursor-pointer hover:bg-n20 transition-colors">
                <input
                  type="checkbox"
                  checked={hardDelete}
                  onChange={e => setHardDelete(e.target.checked)}
                  disabled={isDeleting}
                  className="w-4 h-4 rounded border-n40 bg-n0 text-danger focus:ring-red-500 focus:ring-offset-0"
                />
                <HardDrive className="w-4 h-4 text-n300" />
                <div>
                  <span className="text-sm text-n700">同时删除磁盘文件</span>
                  <p className="text-[10px] text-n100 mt-0.5">勾选后将永久释放存储空间，文件无法恢复</p>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-n30 border-t border-n40">
              {deleteProgress && (
                <div className="flex-1 text-xs text-n100">
                  正在删除 {deleteProgress.done}/{deleteProgress.total}...
                </div>
              )}
              <button
                onClick={() => setDeleteModal(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm text-n300 hover:text-n700 hover:bg-n20 rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={executeDelete}
                disabled={isDeleting}
                className="px-5 py-2 text-sm font-medium text-white bg-danger hover:bg-red-500 rounded-lg transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    删除中...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    {hardDelete ? '永久删除' : '删除记录'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 预览弹窗 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="max-w-4xl max-h-[90vh] relative" onClick={e => e.stopPropagation()}>
            {previewType === 'video' ? (
              <video
                src={previewUrl}
                className="max-w-full max-h-[85vh] rounded-lg"
                controls
                autoPlay
              />
            ) : (
              <img src={previewUrl} className="max-w-full max-h-[85vh] rounded-lg" alt="" />
            )}
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-2 -right-2 w-8 h-8 bg-n0 hover:bg-n20 text-n800 rounded-full flex items-center justify-center"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
