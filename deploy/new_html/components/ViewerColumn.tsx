import React from 'react';
import { ProjectFile, AiModel } from '../types';
import { BookOpen, Wand2, Undo2, Redo2 } from 'lucide-react';

interface ViewerColumnProps {
  selectedFile: ProjectFile | undefined;
  files: ProjectFile[];
  checkedCount: number;
  onRewrite: (targetFileId?: string) => Promise<void>;
  onUpdateContent: (id: string, content: string) => void;
  isProcessing: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  aiModel: AiModel;
  onChangeModel: (model: AiModel) => void;
}

export const ViewerColumn: React.FC<ViewerColumnProps> = ({ 
  selectedFile, 
  files,
  checkedCount,
  onRewrite,
  onUpdateContent,
  isProcessing,
  isExpanded,
  onToggleExpand,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  aiModel,
  onChangeModel
}) => {
  
  const handleMainAction = async () => {
    if (isProcessing) return;
    await onRewrite(); 
  };

  const getButtonText = () => {
      if (isProcessing) return '改写中...';
      if (checkedCount > 1) return `批量改写 (${checkedCount} 个文件)`;
      if (checkedCount === 1) return '改写选中的文件';
      return '改写当前文件';
  };

  return (
    <div className="flex flex-col h-full bg-n0 border-r border-n40">
      {/* Standard Header */}
      <div className="h-[52px] px-4 border-b border-n40 bg-n0 flex-shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-n700 uppercase tracking-wider flex items-center gap-2">
                2. 文字脚本
              </h2>

              {/* 生成模型选择器 */}
              <div className="flex items-center bg-n20 rounded-lg border border-n40">
                <button
                  onClick={() => onChangeModel(AiModel.Gemini)}
                  className={`px-2 py-1 text-[10px] font-semibold rounded-l transition-all ${
                      aiModel === AiModel.Gemini ? 'bg-primary text-white' : 'text-n300 hover:text-n800'
                  }`}
                  title="GI化神 (Gemini)"
                >
                  GI化神
                </button>
                <button
                  onClick={() => onChangeModel(AiModel.Deepseek)}
                  className={`px-2 py-1 text-[10px] font-semibold transition-all border-l border-n40 ${
                      aiModel === AiModel.Deepseek ? 'bg-primary text-white' : 'text-n300 hover:text-n800'
                  }`}
                  title="DK筑基 (DeepSeek Reasoner)"
                >
                  DK筑基
                </button>
                <button
                  onClick={() => onChangeModel(AiModel.DeepseekChat)}
                  className={`px-2 py-1 text-[10px] font-semibold rounded-r transition-all border-l border-n40 ${
                      aiModel === AiModel.DeepseekChat ? 'bg-yellow-600 text-white' : 'text-n300 hover:text-n800'
                  }`}
                  title="DK金丹 (DeepSeek Chat)"
                >
                  DK金丹
                </button>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
                 <button onClick={onUndo} disabled={!canUndo} className="p-1.5 text-n100 hover:text-n800 disabled:opacity-30 rounded hover:bg-n20">
                     <Undo2 className="w-4 h-4" />
                 </button>
                 <button onClick={onRedo} disabled={!canRedo} className="p-1.5 text-n100 hover:text-n800 disabled:opacity-30 rounded hover:bg-n20">
                     <Redo2 className="w-4 h-4" />
                 </button>
            </div>
      </div>

      {/* Toolbar - 固定高度52px，与其他栏目对齐 */}
      <div className="h-[52px] px-3 border-b border-n40 bg-n0 flex items-center">
           {/* AI改写按钮 */}
           <button
                onClick={handleMainAction}
                disabled={(!selectedFile && checkedCount === 0) || isProcessing}
                className={`w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold tracking-wide transition-all
                    ${(!selectedFile && checkedCount === 0) || isProcessing
                    ? 'bg-n0 text-n100 cursor-not-allowed'
                    : 'bg-primary hover:bg-primary-hover text-white shadow-lg shadow-indigo-900/50'
                    }`}
            >
                {isProcessing ? (
                     <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-100" />
                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-200" />
                     </div>
                ) : (
                    <>
                    <Wand2 className="w-3.5 h-3.5" />
                    {getButtonText()}
                    </>
                )}
            </button>
      </div>

      <div className="flex-1 overflow-hidden relative bg-n20">
        {selectedFile ? (
          <textarea
            className="w-full h-full p-6 bg-transparent text-n700 font-serif leading-relaxed resize-none focus:outline-none focus:bg-n0 transition-colors custom-scrollbar"
            value={selectedFile.originalContent}
            onChange={(e) => onUpdateContent(selectedFile.id, e.target.value)}
            placeholder="在此处可以直接编辑原著内容..."
            spellCheck={false}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-n100">
            <BookOpen className="w-12 h-12 mb-4 opacity-20" />
            <p>请先选择一个文件查看内容</p>
            <p className="text-xs mt-2">点击内容区域可直接修改文本</p>
          </div>
        )}
      </div>
    </div>
  );
};