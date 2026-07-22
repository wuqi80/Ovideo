
import React, { useState, useEffect, useRef } from 'react';
import { ProjectFile, FileStatus, FileVersion } from '../types';
import { Upload, CheckCircle2, CircleDashed, AlertCircle, Trash2, ChevronUp, ChevronDown, History, Save, RotateCcw, X, Download, Edit2, FileDown, FilePlus, GripVertical } from 'lucide-react';

interface FileColumnProps {
  files: ProjectFile[];
  selectedFileId: string | null;
  activeFileId: string | null;
  checkedFileIds: Set<string>;
  onFileSelect: (id: string) => void;
  onActivateFile: (id: string) => Promise<void> | void;
  onFileCheck: (id: string, checked: boolean) => void;
  onCheckAll: (checked: boolean) => void;
  onFileUpload: (files: FileList) => void;
  onCreateBlankFile: () => void;
  onRenameFile: (id: string, newName: string) => void;
  onDeleteFile: (e: React.MouseEvent, id: string) => void;
  onDownloadFile: (id: string) => void;
  onMoveFile: (e: React.MouseEvent, id: string, direction: 'up' | 'down') => void;
  onSaveVersion: (id: string) => void;
  onRestoreVersion: (fileId: string, version: FileVersion) => void;
  onSaveAs?: (id: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onExportProject: () => void;
  onReorderFiles?: (fromIndex: number, toIndex: number) => void;  // 🆕 拖拽排序
}

export const FileColumn: React.FC<FileColumnProps> = ({ 
  files, 
  selectedFileId, 
  activeFileId,
  checkedFileIds,
  onFileSelect, 
  onActivateFile,
  onFileCheck,
  onCheckAll,
  onFileUpload,
  onCreateBlankFile,
  onRenameFile,
  onDeleteFile,
  onDownloadFile,
  onMoveFile,
  onSaveVersion,
  onRestoreVersion,
  onSaveAs,
  onExportProject,
  onReorderFiles
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState<string | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activatingFileId, setActivatingFileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Keep the dragged file identifiable while the parent reorders the array live.
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Handle Paste
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        e.preventDefault();
        onFileUpload(e.clipboardData.files);
        return;
      }
      const text = e.clipboardData?.getData('text');
      const target = e.target as HTMLElement;
      if (text && !(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        e.preventDefault();
        const timestamp = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
        const fileName = `粘贴文本-${timestamp}.txt`;
        const file = new File([text], fileName, { type: 'text/plain' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        onFileUpload(dataTransfer.files);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [onFileUpload]);

  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    onFileUpload(e.dataTransfer.files);
  };

  const getStatusIcon = (status: FileStatus) => {
    switch (status) {
      case FileStatus.Completed: return (
        <span
          data-testid="file-generated-status"
          className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded bg-g50 px-1.5 text-[10px] font-medium text-success"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          已生成
        </span>
      );
      case FileStatus.Processing: return <CircleDashed className="w-3.5 h-3.5 text-b400 animate-spin" />;
      case FileStatus.Error: return <AlertCircle className="w-3.5 h-3.5 text-danger" />;
      default: return null;
    }
  };

  const activeFileForHistory = files.find(f => f.id === showHistoryModal);
  const deleteFile = files.find(f => f.id === deleteConfirmId);
  
  const handleStartRename = (e: React.MouseEvent, file: ProjectFile) => {
    e.stopPropagation();
    setRenamingFileId(file.id);
    setRenameValue(file.name);
  };
  
  const handleConfirmRename = () => {
    if (renamingFileId && renameValue.trim()) {
      onRenameFile(renamingFileId, renameValue.trim());
      setRenamingFileId(null);
      setRenameValue('');
    }
  };
  
  const handleCancelRename = () => {
    setRenamingFileId(null);
    setRenameValue('');
  };
  
  const handleConfirmDelete = (e: React.MouseEvent) => {
    if (deleteConfirmId) {
      onDeleteFile(e, deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  return (
    <div 
      className={`flex flex-col h-full bg-n0 border-r border-n40 transition-colors relative ${isDragging ? 'bg-primary-light' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input type="file" ref={fileInputRef} className="hidden" multiple accept=".txt,.md,.json" onChange={(e) => {
        if(e.target.files) { onFileUpload(e.target.files); e.target.value = ''; }
      }} />

      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary-light backdrop-blur-sm border-2 border-primary border-dashed m-2 rounded-md flex items-center justify-center pointer-events-none">
          <div className="bg-n0 p-4 rounded-lg shadow-bottom flex items-center gap-3">
            <Upload className="w-6 h-6 text-primary animate-bounce" />
            <span className="text-n800 font-medium">释放以添加文件</span>
          </div>
        </div>
      )}

      {/* Header uses stable rows so narrow columns and macOS fonts never wrap controls. */}
      <div className="flex-shrink-0 border-b border-n40 bg-n0">
        <div
          data-testid="file-column-title-row"
          className="flex h-11 min-w-0 items-center gap-2 px-4"
        >
          <h2 className="whitespace-nowrap text-sm font-semibold text-n700">
            文件列表
          </h2>
          <span className="whitespace-nowrap font-mono text-xs text-n100">({files.length})</span>
        </div>

        <div
          data-testid="file-column-action-row"
          className="flex h-10 items-center justify-end gap-1 border-t border-n40 px-4"
        >
            <button
              type="button"
              onClick={onCreateBlankFile}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-n300 transition-colors hover:bg-success hover:text-white"
              title="新建空白文件"
              aria-label="新建空白文件"
            >
              <FilePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-n300 transition-colors hover:bg-primary hover:text-white"
              title="上传文件"
              aria-label="上传文件"
            >
              <Upload className="h-4 w-4" />
            </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar relative pb-10">
        {files.length === 0 ? (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 m-4 border-2 border-dashed border-n40 hover:border-primary hover:bg-n30 rounded-md flex flex-col items-center justify-center cursor-pointer group transition-all"
          >
            <div className="p-4 bg-n30 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-sm font-medium text-n700 mb-2">点击或拖拽上传</h3>
             <p className="text-xs text-n100 text-center px-6 leading-relaxed">
              支持 .txt, .md, .json 文件<br/>
              或直接 <span className="text-primary font-mono border border-primary rounded px-1 bg-primary-light">Ctrl+V</span> 粘贴文本
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {files.map((file, index) => (
              <div
                key={file.id}
                data-file-card={file.id}
                onDragStart={(e) => {
                  if (!onReorderFiles) return;
                  e.stopPropagation();
                  setDraggedFileId(file.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('application/x-mecha-script-file', file.id);
                  e.dataTransfer.setDragImage(e.currentTarget, 18, 18);
                }}
                onDragEnd={(e) => {
                  e.stopPropagation();
                  setDraggedFileId(null);
                  setDragOverIndex(null);
                }}
                onDragOver={(e) => {
                  if (!onReorderFiles || draggedFileId === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverIndex(index);
                }}
                onDragEnter={(e) => {
                  if (!onReorderFiles || draggedFileId === null || draggedFileId === file.id) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const fromIndex = files.findIndex(item => item.id === draggedFileId);
                  if (fromIndex !== -1 && fromIndex !== index) {
                    onReorderFiles(fromIndex, index);
                    setDragOverIndex(index);
                  }
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  setDragOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDraggedFileId(null);
                  setDragOverIndex(null);
                }}
                onClick={() => onFileSelect(file.id)}
                className={`group relative flex flex-col gap-2 rounded-lg border p-2.5 cursor-pointer transition-all duration-200 ${
                  selectedFileId === file.id
                    ? 'bg-primary-light border-primary shadow-sm'
                    : 'hover:bg-n20 border-transparent hover:border-n40'
                } ${activeFileId === file.id
                    ? 'ring-2 ring-success/30 border-success'
                    : ''
                } ${draggedFileId === file.id ? 'border-primary shadow-sm ring-2 ring-primary/20' : ''} ${
                  dragOverIndex === index
                    ? 'border-primary bg-primary-light ring-2 ring-primary/20'
                    : ''
                }`}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if(onSaveAs && confirm(`将 "${file.name}" 另存为新文件?`)) {
                        onSaveAs(file.id);
                    }
                }}
              >
                <div
                  data-testid="file-card-control-row"
                  className="flex h-6 w-full min-w-0 items-center gap-2 pr-[132px]"
                >
                  {onReorderFiles && (
                    <div
                      draggable
                      className="cursor-grab text-n100 transition-colors hover:text-n300 active:cursor-grabbing"
                      title="拖拽排序"
                      aria-label={`拖动 ${file.name} 调整顺序`}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                  )}

                  <span className={`min-w-[20px] font-mono text-[10px] font-bold ${selectedFileId === file.id ? 'text-primary' : 'text-n100'}`}>
                    {(index + 1).toString().padStart(2, '0')}
                  </span>
                  {getStatusIcon(file.status)}
                </div>

                <div data-testid="file-card-content" className="w-full min-w-0 select-none">
                  <div className="mb-1 flex min-w-0 items-center gap-2">
                    <h3 className={`min-w-0 flex-1 truncate text-sm font-medium ${selectedFileId === file.id ? 'text-n800' : 'text-n700 group-hover:text-n800'}`}>
                      {file.name}
                    </h3>
                    {activeFileId === file.id && (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-success/40 bg-g50 px-2 py-1 text-[10px] font-semibold text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        当前主剧本
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-n100 line-clamp-2 font-serif leading-relaxed opacity-80 group-hover:opacity-100">
                    {file.originalContent.slice(0, 60).replace(/\n/g, ' ')}...
                  </p>
                  <div className="mt-2">
                    {activeFileId === file.id ? (
                      <div className="h-9 w-full inline-flex items-center justify-center gap-2 rounded border border-success/40 bg-g50 px-3 text-xs font-semibold text-success">
                        <CheckCircle2 className="w-4 h-4" />
                        本集后续流程使用此剧本
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          setActivatingFileId(file.id);
                          try {
                            await onActivateFile(file.id);
                          } catch (error) {
                            console.error('设置本集主剧本失败:', error);
                            window.alert('设置本集主剧本失败，请稍后重试。');
                          } finally {
                            setActivatingFileId(null);
                          }
                        }}
                        disabled={activatingFileId !== null}
                        className="h-9 w-full inline-flex items-center justify-center gap-2 rounded bg-primary px-3 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-wait disabled:opacity-50"
                        title="设为本集后续流程使用的主剧本"
                      >
                        <CheckCircle2 className={`w-4 h-4 ${activatingFileId === file.id ? 'animate-pulse' : ''}`} />
                        {activatingFileId === file.id ? '正在设置...' : '设为本集主剧本'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Actions stay visible so they are discoverable on touch devices and narrow layouts. */}
                <div
                  className="absolute right-2 top-2.5 z-30 flex items-center gap-0.5 rounded-md border border-n40 bg-n0 px-1 py-0.5 opacity-100 shadow-bottom backdrop-blur-sm"
                >
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleStartRename(e, file); }}
                    className="p-1 text-n300 hover:text-primary hover:bg-n20 rounded"
                    title="重命名"
                  >
                      <Edit2 className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDownloadFile(file.id); }}
                    className="p-1 text-n300 hover:text-success hover:bg-n20 rounded"
                    title="下载"
                  >
                      <FileDown className="w-3 h-3" />
                  </button>
                  <div className="w-px h-4 bg-n40 mx-0.5" />
                  <button
                    onClick={(e) => { e.stopPropagation(); onMoveFile(e, file.id, 'up'); }}
                    disabled={index === 0}
                    className="p-1 text-n300 hover:text-n800 hover:bg-n20 rounded disabled:opacity-20 disabled:cursor-not-allowed"
                    title="上移"
                  >
                      <ChevronUp className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onMoveFile(e, file.id, 'down'); }}
                    disabled={index === files.length - 1}
                    className="p-1 text-n300 hover:text-n800 hover:bg-n20 rounded disabled:opacity-20 disabled:cursor-not-allowed"
                    title="下移"
                  >
                      <ChevronDown className="w-3 h-3" />
                  </button>
                  <div className="w-px h-4 bg-n40 mx-0.5" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(file.id); }}
                    className="p-1 text-danger hover:text-danger hover:bg-r50 rounded"
                    title="删除"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

       {/* Footer Actions */}
       {files.length > 0 && (
           <div className="p-3 border-t border-n40 bg-n0 sticky bottom-0 z-10">
               <button
                onClick={onExportProject}
                className="w-full py-2 bg-n0 hover:bg-primary text-n300 hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 border border-n40"
                title="导出所有项目数据为 JSON"
               >
                   <Download className="w-3.5 h-3.5" />
                   下载项目备份 (JSON)
               </button>
           </div>
       )}

      {/* History Modal */}
      {showHistoryModal && activeFileForHistory && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-n900/50 backdrop-blur-sm">
              <div className="bg-n0 border border-n40 rounded-md shadow-bottom w-[500px] max-h-[80vh] flex flex-col">
                  <div className="p-4 border-b border-n40 flex justify-between items-center">
                      <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                          <History className="w-5 h-5 text-primary" />
                          历史版本: {activeFileForHistory.name}
                      </h3>
                      <button onClick={() => setShowHistoryModal(null)} className="text-n100 hover:text-n800">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {activeFileForHistory.versions && activeFileForHistory.versions.length > 0 ? (
                         [...activeFileForHistory.versions].reverse().map((ver) => (
                             <div key={ver.id} className="p-3 bg-n0 rounded-lg flex items-center justify-between border border-n40">
                                 <div>
                                     <div className="text-sm font-bold text-n700">{ver.name}</div>
                                     <div className="text-xs text-n100 font-mono mt-1">
                                         {new Date(ver.timestamp).toLocaleString()}
                                     </div>
                                 </div>
                                 <button 
                                    onClick={() => {
                                        if(confirm("确定要恢复到此版本吗？当前未保存的修改将丢失。")) {
                                            onRestoreVersion(activeFileForHistory.id, ver);
                                            setShowHistoryModal(null);
                                        }
                                    }}
                                    className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs rounded font-medium flex items-center gap-1"
                                 >
                                     <RotateCcw className="w-3 h-3" />
                                     恢复
                                 </button>
                             </div>
                         ))
                      ) : (
                          <div className="text-center text-n100 py-8">暂无保存的历史版本</div>
                      )}
                  </div>
                  <div className="p-4 border-t border-n40 bg-n0 rounded-b-xl text-xs text-n100">
                      提示：点击文件列表的保存按钮可手动创建版本快照。
                  </div>
              </div>
          </div>
      )}
      
      {/* 重命名Modal */}
      {renamingFileId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-n900/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-gradient-to-br from-n0 to-n0 border border-primary rounded-2xl shadow-bottom w-[450px] overflow-hidden transform animate-scaleIn">
            <div className="p-6 border-b border-n40 bg-gradient-to-r from-primary-light to-primary-light">
              <h3 className="text-lg font-bold text-n800 flex items-center gap-3">
                <div className="p-2 bg-primary-light rounded-lg">
                  <Edit2 className="w-5 h-5 text-primary" />
                </div>
                重命名文件
              </h3>
            </div>
            
            <div className="p-6">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmRename();
                  if (e.key === 'Escape') handleCancelRename();
                }}
                autoFocus
                className="w-full px-4 py-3 bg-n20 border border-n40 rounded-lg text-n800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                placeholder="输入新文件名..."
              />
              <p className="text-xs text-n100 mt-2">按 Enter 确认，Esc 取消</p>
            </div>

            <div className="p-4 border-t border-n40 flex items-center justify-end gap-3 bg-n0">
              <button
                onClick={handleCancelRename}
                className="px-5 py-2 text-sm text-n300 hover:text-n800 hover:bg-n20 rounded-lg transition-all"
              >
                取消
              </button>
              <button
                onClick={handleConfirmRename}
                disabled={!renameValue.trim()}
                className="px-5 py-2 text-sm bg-gradient-to-r from-primary to-primary hover:from-primary-hover hover:to-primary-hover text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-card"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 删除确认Modal */}
      {deleteConfirmId && deleteFile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-n900/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-gradient-to-br from-n0 to-n0 border border-danger rounded-2xl shadow-bottom w-[450px] overflow-hidden transform animate-scaleIn">
            <div className="p-6 border-b border-n40 bg-gradient-to-r from-r50 to-r50">
              <h3 className="text-lg font-bold text-n800 flex items-center gap-3">
                <div className="p-2 bg-r50 rounded-lg">
                  <Trash2 className="w-5 h-5 text-danger" />
                </div>
                确认删除
              </h3>
            </div>
            
            <div className="p-6">
              <p className="text-n700 mb-3">确定要删除以下文件吗？</p>
              <div className="p-3 bg-n20 border border-n40 rounded-lg">
                <p className="text-sm font-medium text-n800">{deleteFile.name}</p>
                <p className="text-xs text-n100 mt-1">
                  {deleteFile.originalContent.slice(0, 100).replace(/\n/g, ' ')}...
                </p>
              </div>
              <p className="text-xs text-danger mt-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                此操作无法撤销
              </p>
            </div>
            
            <div className="p-4 border-t border-n40 flex items-center justify-end gap-3 bg-n0">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-5 py-2 text-sm text-n300 hover:text-n800 hover:bg-n20 rounded-lg transition-all"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-5 py-2 text-sm bg-gradient-to-r from-danger to-danger hover:from-danger hover:to-danger text-white rounded-lg transition-all shadow-card"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
