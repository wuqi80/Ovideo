
import React, { useState, useEffect, useRef } from 'react';
import { ProjectFile, FileStatus, FileVersion } from '../types';
import { Upload, CheckCircle2, CircleDashed, AlertCircle, Trash2, ChevronUp, ChevronDown, Plus, History, Save, RotateCcw, X, Download, Edit2, FileDown, FilePlus, GripVertical } from 'lucide-react';

interface FileColumnProps {
  files: ProjectFile[];
  selectedFileId: string | null;
  checkedFileIds: Set<string>;
  onFileSelect: (id: string) => void;
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
  onSaveAs: (id: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onExportProject: () => void;
  onReorderFiles?: (fromIndex: number, toIndex: number) => void;  // 🆕 拖拽排序
}

export const FileColumn: React.FC<FileColumnProps> = ({ 
  files, 
  selectedFileId, 
  checkedFileIds,
  onFileSelect, 
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 🆕 拖拽排序状态
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
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
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileUpload(e.dataTransfer.files);
    }
  };

  const getStatusIcon = (status: FileStatus) => {
    switch (status) {
      case FileStatus.Completed: return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case FileStatus.Processing: return <CircleDashed className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
      case FileStatus.Error: return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
      default: return null;
    }
  };

  const allChecked = files.length > 0 && files.every(f => checkedFileIds.has(f.id));
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
      className={`flex flex-col h-full bg-gray-900 border-r border-gray-800 transition-colors relative ${isDragging ? 'bg-indigo-900/20' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input type="file" ref={fileInputRef} className="hidden" multiple accept=".txt,.md,.json" onChange={(e) => {
        if(e.target.files) { onFileUpload(e.target.files); e.target.value = ''; }
      }} />

      {isDragging && (
        <div className="absolute inset-0 z-50 bg-indigo-500/20 backdrop-blur-sm border-2 border-indigo-500 border-dashed m-2 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="bg-gray-900/90 p-4 rounded-lg shadow-xl flex items-center gap-3">
            <Upload className="w-6 h-6 text-indigo-400 animate-bounce" />
            <span className="text-indigo-100 font-medium">释放以添加文件</span>
          </div>
        </div>
      )}

      {/* Standard Header */}
      <div className="h-[52px] px-4 border-b border-gray-800 bg-gray-850 flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider pl-1">
            1. 文件列表
            </h2>
             {files.length > 0 && <span className="text-xs text-gray-500 font-mono">({files.length})</span>}
            {files.length > 0 && (
                <div className="flex items-center gap-1.5 ml-2">
                     <input 
                        type="checkbox" 
                        checked={allChecked} 
                        onChange={(e) => onCheckAll(e.target.checked)}
                        className="w-3.5 h-3.5 rounded bg-gray-800 border-gray-600 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer"
                        title="全选/取消全选"
                     />
                </div>
            )}
        </div>
        
        <div className="flex items-center gap-1">
             <button 
                onClick={onCreateBlankFile}
                className="p-1.5 bg-gray-800 hover:bg-emerald-600 text-gray-400 hover:text-white rounded transition-colors"
                title="新建空白文件"
            >
                <FilePlus className="w-3.5 h-3.5" />
            </button>
             <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-400 hover:text-white rounded transition-colors"
                title="上传文件"
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
      </div>
      
      {/* Toolbar - 固定高度52px，与其他栏目对齐 */}
      <div className="h-[52px] px-3 border-b border-gray-800 bg-gray-900/50 flex items-center">
        <div className="w-full flex items-center gap-2 px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-xs text-gray-500">
          <Upload className="w-4 h-4" />
          <span>拖拽或粘贴文件上传</span>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar relative pb-10">
        {files.length === 0 ? (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 m-4 border-2 border-dashed border-gray-700 hover:border-indigo-500/50 hover:bg-gray-800/30 rounded-xl flex flex-col items-center justify-center cursor-pointer group transition-all"
          >
            <div className="p-4 bg-gray-800 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300">
              <Upload className="w-8 h-8 text-indigo-500" />
            </div>
            <h3 className="text-sm font-medium text-gray-200 mb-2">点击或拖拽上传</h3>
             <p className="text-xs text-gray-500 text-center px-6 leading-relaxed">
              支持 .txt, .md, .json 文件<br/>
              或直接 <span className="text-indigo-400 font-mono border border-indigo-500/30 rounded px-1 bg-indigo-500/10">Ctrl+V</span> 粘贴文本
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {files.map((file, index) => (
              <div
                key={file.id}
                draggable={!!onReorderFiles}
                onDragStart={(e) => {
                  if (!onReorderFiles) return;
                  setDraggedIndex(index);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', index.toString());
                }}
                onDragEnd={() => {
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                onDragOver={(e) => {
                  if (!onReorderFiles || draggedIndex === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (index !== draggedIndex) {
                    setDragOverIndex(index);
                  }
                }}
                onDragLeave={() => {
                  setDragOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!onReorderFiles || draggedIndex === null || draggedIndex === index) return;
                  onReorderFiles(draggedIndex, index);
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                onClick={() => onFileSelect(file.id)}
                className={`group relative flex items-start gap-2 p-3 rounded-lg cursor-pointer transition-all duration-200 border ${
                  selectedFileId === file.id 
                    ? 'bg-indigo-900/30 border-indigo-500/30 shadow-sm' 
                    : 'hover:bg-gray-800 border-transparent hover:border-gray-700/50'
                } ${draggedIndex === index ? 'opacity-50 scale-95' : ''} ${
                  dragOverIndex === index 
                    ? 'border-indigo-500 bg-indigo-900/20 ring-2 ring-indigo-500/30' 
                    : ''
                }`}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if(confirm(`将 "${file.name}" 另存为新文件?`)) {
                        onSaveAs(file.id);
                    }
                }}
              >
                {/* 🆕 拖拽手柄 */}
                {onReorderFiles && (
                  <div 
                    className="mt-1 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 transition-colors"
                    title="拖拽排序"
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </div>
                )}
                
                {/* Checkbox */}
                 <div className="mt-0.5" onClick={(e) => e.stopPropagation()}>
                    <input 
                        type="checkbox" 
                        checked={checkedFileIds.has(file.id)}
                        onChange={(e) => onFileCheck(file.id, e.target.checked)}
                        className="w-3.5 h-3.5 rounded bg-gray-700 border-gray-600 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                </div>

                <div className={`text-[10px] font-mono font-bold mt-0.5 min-w-[18px] ${selectedFileId === file.id ? 'text-indigo-400' : 'text-gray-600'}`}>
                  {(index + 1).toString().padStart(2, '0')}
                </div>

                <div className="flex-1 min-w-0 select-none">
                  <div className="flex items-center justify-between mb-0.5">
                     <h3 className={`text-sm font-medium truncate pr-2 ${selectedFileId === file.id ? 'text-gray-100' : 'text-gray-300 group-hover:text-gray-200'}`}>
                      {file.name}
                    </h3>
                    <div className="flex items-center gap-2">
                        {getStatusIcon(file.status)}
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 line-clamp-2 font-serif leading-relaxed opacity-80 group-hover:opacity-100">
                    {file.originalContent.slice(0, 60).replace(/\n/g, ' ')}...
                  </p>
                </div>

                {/* Hover Actions - 水平布局 */}
                <div 
                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800/95 rounded-md backdrop-blur-sm shadow-xl px-1 py-0.5 border border-gray-700 z-30 flex items-center gap-0.5" 
                >
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleStartRename(e, file); }} 
                    className="p-1 text-gray-400 hover:text-cyan-400 hover:bg-gray-700 rounded" 
                    title="重命名"
                  >
                      <Edit2 className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDownloadFile(file.id); }} 
                    className="p-1 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded" 
                    title="下载"
                  >
                      <FileDown className="w-3 h-3" />
                  </button>
                  <div className="w-px h-4 bg-gray-700 mx-0.5" />
                  <button 
                    onClick={(e) => { e.stopPropagation(); onMoveFile(e, file.id, 'up'); }} 
                    disabled={index === 0} 
                    className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded disabled:opacity-20 disabled:cursor-not-allowed" 
                    title="上移"
                  >
                      <ChevronUp className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onMoveFile(e, file.id, 'down'); }} 
                    disabled={index === files.length - 1} 
                    className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded disabled:opacity-20 disabled:cursor-not-allowed" 
                    title="下移"
                  >
                      <ChevronDown className="w-3 h-3" />
                  </button>
                  <div className="w-px h-4 bg-gray-700 mx-0.5" />
                  <button 
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(file.id); }} 
                    className="p-1 text-red-400 hover:text-red-200 hover:bg-red-900/50 rounded" 
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
           <div className="p-3 border-t border-gray-800 bg-gray-900 sticky bottom-0 z-10">
               <button 
                onClick={onExportProject}
                className="w-full py-2 bg-gray-800 hover:bg-indigo-600 text-gray-400 hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 border border-gray-700"
                title="导出所有项目数据为 JSON"
               >
                   <Download className="w-3.5 h-3.5" />
                   下载项目备份 (JSON)
               </button>
           </div>
       )}

      {/* History Modal */}
      {showHistoryModal && activeFileForHistory && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[500px] max-h-[80vh] flex flex-col">
                  <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                      <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                          <History className="w-5 h-5 text-indigo-400" />
                          历史版本: {activeFileForHistory.name}
                      </h3>
                      <button onClick={() => setShowHistoryModal(null)} className="text-gray-500 hover:text-white">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {activeFileForHistory.versions && activeFileForHistory.versions.length > 0 ? (
                         [...activeFileForHistory.versions].reverse().map((ver) => (
                             <div key={ver.id} className="p-3 bg-gray-800 rounded-lg flex items-center justify-between border border-gray-700">
                                 <div>
                                     <div className="text-sm font-bold text-gray-200">{ver.name}</div>
                                     <div className="text-xs text-gray-500 font-mono mt-1">
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
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded font-medium flex items-center gap-1"
                                 >
                                     <RotateCcw className="w-3 h-3" />
                                     恢复
                                 </button>
                             </div>
                         ))
                      ) : (
                          <div className="text-center text-gray-500 py-8">暂无保存的历史版本</div>
                      )}
                  </div>
                  <div className="p-4 border-t border-gray-800 bg-gray-850 rounded-b-xl text-xs text-gray-500">
                      提示：点击文件列表的保存按钮可手动创建版本快照。
                  </div>
              </div>
          </div>
      )}
      
      {/* 重命名Modal */}
      {renamingFileId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-indigo-500/30 rounded-2xl shadow-2xl w-[450px] overflow-hidden transform animate-scaleIn">
            <div className="p-6 border-b border-gray-700/50 bg-gradient-to-r from-indigo-600/10 to-purple-600/10">
              <h3 className="text-lg font-bold text-white flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <Edit2 className="w-5 h-5 text-indigo-400" />
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
                className="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                placeholder="输入新文件名..."
              />
              <p className="text-xs text-gray-500 mt-2">按 Enter 确认，Esc 取消</p>
            </div>
            
            <div className="p-4 border-t border-gray-700/50 flex items-center justify-end gap-3 bg-gray-900/50">
              <button
                onClick={handleCancelRename}
                className="px-5 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
              >
                取消
              </button>
              <button
                onClick={handleConfirmRename}
                disabled={!renameValue.trim()}
                className="px-5 py-2 text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 删除确认Modal */}
      {deleteConfirmId && deleteFile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-red-500/30 rounded-2xl shadow-2xl w-[450px] overflow-hidden transform animate-scaleIn">
            <div className="p-6 border-b border-gray-700/50 bg-gradient-to-r from-red-600/10 to-orange-600/10">
              <h3 className="text-lg font-bold text-white flex items-center gap-3">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                确认删除
              </h3>
            </div>
            
            <div className="p-6">
              <p className="text-gray-300 mb-3">确定要删除以下文件吗？</p>
              <div className="p-3 bg-gray-950 border border-gray-700 rounded-lg">
                <p className="text-sm font-medium text-white">{deleteFile.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {deleteFile.originalContent.slice(0, 100).replace(/\n/g, ' ')}...
                </p>
              </div>
              <p className="text-xs text-red-400 mt-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                此操作无法撤销
              </p>
            </div>
            
            <div className="p-4 border-t border-gray-700/50 flex items-center justify-end gap-3 bg-gray-900/50">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-5 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-5 py-2 text-sm bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white rounded-lg transition-all shadow-lg shadow-red-500/20"
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
