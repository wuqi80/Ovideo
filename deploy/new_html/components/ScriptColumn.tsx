import React, { useState, useRef, useEffect } from 'react';
import { ProjectFile } from '../types';
import { ScrollText, FileSignature, LayoutDashboard, Users, MapPin, Tags, ListPlus, Sparkles, Wand2, Split, Merge, Edit, Save, X, Undo2, Redo2, FileText, CheckCircle, Clock, AlertOctagon, Download, FileSpreadsheet } from 'lucide-react';

interface ScriptColumnProps {
  selectedFile: ProjectFile | undefined;
  checkedCount: number;
  onGenerateStoryboard: (fileId: string) => Promise<void>;  // 🔧 修改为接受fileId参数
  onExtractMetadata: (targetFileId?: string) => Promise<void>;
  onRefineScript: (selection: string, instruction: string) => Promise<void>;
  onRestructure: (selection: string, instruction: string, type: 'split' | 'merge') => Promise<void>;
  onUpdateScript: (newContent: string) => void;
  onUpdateStoryboardItems?: (items: any[]) => void;  // 🆕 更新分镜列表
  isProcessing: boolean;
  
  // 🆕 新增props
  onExtractShots: () => Promise<void>;
  isShotExtracting: boolean;
  aiModel?: any;  // 用于快速操作（润色、扩写等）
  onRewrite?: (targetFileId?: string) => Promise<void>;
  
  isExpanded: boolean;
  onToggleExpand: () => void;
  highlightedTextSegments: Set<string>;
  highlightedItemIds: Set<string>;
  onSelectionChange: (selection: string | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // 🔧 已移除 storyboardUserRequirements 和 onStoryboardUserRequirementsChange - 新流程中镜头由规则自动解析生成
}

export const ScriptColumn: React.FC<ScriptColumnProps> = ({ 
  selectedFile,
  checkedCount,
  onGenerateStoryboard,
  onExtractMetadata,
  onRefineScript,
  onRestructure,
  onUpdateScript,
  onUpdateStoryboardItems,  // 🆕 更新分镜列表
  isProcessing,
  
  // 🆕 新增props
  onExtractShots,
  isShotExtracting,
  aiModel,
  onRewrite,
  
  highlightedTextSegments,
  highlightedItemIds,
  onSelectionChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo
  // 🔧 已移除 storyboardUserRequirements, onStoryboardUserRequirementsChange
}) => {
  const [selection, setSelection] = useState<string | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number } | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [activeInstruction, setActiveInstruction] = useState<string>('');
  const [activeActionType, setActiveActionType] = useState<'refine' | 'expand' | 'split' | 'merge'>('refine');
  const [isEditMode, setIsEditMode] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  
  // 🆕 分镜段落编辑状态
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [editingScriptSegment, setEditingScriptSegment] = useState<string>('');
  const [showShotPromptModal, setShowShotPromptModal] = useState(false);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  // 🔧 已移除 showRequirementsModal - 新流程中不需要编辑分镜要求
  
  const hasScript = selectedFile?.scriptContent;

  // 🆕 Bug 5 修复：StoryboardItem.shotNumber 类型是 string | number（types.ts），
  // 直接调用 ?.replace / ?.match 时 number 不会被可选链短路，会抛
  // "TypeError: replace/match is not a function"。这个 helper 保证拿到的是 string。
  const getShotNumberStr = (sn: string | number | undefined | null): string => {
    if (sn === undefined || sn === null) return '';
    return typeof sn === 'string' ? sn : String(sn);
  };

  // 🔧 导出分镜到 Excel (CSV格式) - 按照用户要求的格式
  const exportStoryboardToExcel = () => {
    if (!selectedFile?.storyboard?.items) return;
    
    const items = selectedFile.storyboard.items;
    
    // 🔧 新表头格式（按用户图片）
    const headers = ['镜号', '镜头描述', '画面描述', '转场', '时间', '人声', '音效', '人物名称', '场景名称', '道具名称'];
    
    // 解析每个镜头的详细信息（支持新旧字段名）
    const parseOriginalText = (text: string) => {
      const result: Record<string, string> = {};
      
      // 解析各个字段（支持新旧字段名）
      const fieldPatterns: Record<string, RegExp> = {
        '取景': /取景[:：]\s*(.+?)(?:\n|$)/,
        '角度': /(?:摄像机)?角度[:：]\s*(.+?)(?:\n|$)/,  // 支持 "角度" 或 "摄像机角度"
        '运动': /(?:镜头)?运动[:：]\s*(.+?)(?:\n|$)/,    // 支持 "运动" 或 "镜头运动"
        '机位': /机位[:：]\s*(.+?)(?:\n|$)/,
        '站位与构图': /站位与构图[:：]\s*(.+?)(?:\n|$)/,
        '动作与神态': /动作与神态[:：]\s*(.+?)(?:\n|$)/,
        '氛围与特效': /氛围与特效[:：]\s*(.+?)(?:\n|$)/,
        '人声': /人声[:：]\s*(.+?)(?:\n|$)/,
        '音效': /音效[:：]\s*(.+?)(?:\n|$)/,
        '转场': /转场[:：]\s*(.+?)(?:\n|$)/,
        '时间': /(?:时长|时间)[:：]\s*(.+?)(?:\n|$)/,    // 支持 "时长" 或 "时间"
        '人物名称': /人物名称[:：]\s*(.+?)(?:\n|$)/,
        '场景名称': /场景名称[:：]\s*(.+?)(?:\n|$)/,
        '道具名称': /道具名称[:：]\s*(.+?)(?:\n|$)/,
      };
      
      for (const [field, pattern] of Object.entries(fieldPatterns)) {
        const match = text.match(pattern);
        if (match) {
          result[field] = match[1].trim();
        }
      }
      
      return result;
    };
    
    // 生成CSV行
    const rows = items.map((item, index) => {
      const parsed = parseOriginalText(item.originalText);
      
      // 🔧 镜头描述：【取景】【角度】【运动】【机位】格式
      const 镜头描述Parts = [];
      if (parsed['取景']) 镜头描述Parts.push(`【取景】${parsed['取景']}`);
      if (parsed['角度']) 镜头描述Parts.push(`【角度】${parsed['角度']}`);
      if (parsed['运动']) 镜头描述Parts.push(`【运动】${parsed['运动']}`);
      if (parsed['机位']) 镜头描述Parts.push(`【机位】${parsed['机位']}`);
      const 镜头描述 = 镜头描述Parts.join(' ');
      
      // 🔧 画面描述：【站位与构图】【动作与神态】【氛围与特效】格式
      const 画面描述Parts = [];
      if (parsed['站位与构图']) 画面描述Parts.push(`【站位与构图】${parsed['站位与构图']}`);
      if (parsed['动作与神态']) 画面描述Parts.push(`【动作与神态】${parsed['动作与神态']}`);
      if (parsed['氛围与特效']) 画面描述Parts.push(`【氛围与特效】${parsed['氛围与特效']}`);
      const 画面描述 = 画面描述Parts.join('\n');
      
      // 🔧 转场
      const 转场 = parsed['转场'] || '';
      
      // 🔧 人声：如果为空显示"(无台词)"
      let 人声 = parsed['人声'] || item.dialogue || '';
      if (!人声.trim()) 人声 = '(无台词)';
      else if (!人声.startsWith('【人声】')) 人声 = `【人声】${人声}`;
      
      // 🔧 人物名称：如果为空显示"(群演)"
      let 人物名称 = parsed['人物名称'] || (item.characters || []).join('、');
      if (!人物名称.trim()) 人物名称 = '(群演)';
      
      // 🔧 场景名称
      const 场景名称 = parsed['场景名称'] || item.scene || '';
      const 道具名称 = parsed['道具名称'] || (item.props || []).join('、');
      
      const row = [
        getShotNumberStr(item.shotNumber).replace(/镜头0?/, '') || `${index + 1}`.padStart(3, '0'),  // 镜号：001, 002...
        镜头描述,
        画面描述,
        转场,
        parsed['时间'] || item.duration || '',  // 时间
        人声,
        parsed['音效'] || '',  // 音效
        人物名称,
        场景名称,
        道具名称
      ];
      
      // CSV格式需要对包含逗号、引号或换行的字段用引号包裹
      return row.map(cell => {
        const cellStr = String(cell || '');
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',');
    });
    
    // 组装CSV内容
    const csvContent = '\ufeff' + [headers.join(','), ...rows].join('\n'); // BOM for Excel UTF-8
    
    // 创建下载
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedFile.name.replace(/\.[^.]+$/, '')}_分镜表.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 🔧 基于镜头号匹配：找到选中文字属于哪个镜头
  const findMatchingOriginalTexts = (selectedText: string): string[] => {
    if (!selectedFile?.storyboard || !selectedText || selectedText.length < 2) return [];
    
    const matched: string[] = [];

    // 🔧 策略0（三阶段精确）：选中文字落在哪个 videoScriptBlock 内（段内唯一，避免镜头号全局重复误命中）
    const seln = selectedText.trim();
    if (seln.length >= 3) {
      for (const item of selectedFile.storyboard.items) {
        const blk = item.videoScriptBlock;
        if (blk && blk.trim() && blk.includes(seln)) {
          matched.push(blk);
          return matched;
        }
      }
    }

    // 🔧 策略1：从选中文本中提取镜头号
    const shotMatch = selectedText.match(/镜头\s*(\d+)/);
    if (shotMatch) {
      const shotNum = parseInt(shotMatch[1]);
      const item = selectedFile.storyboard.items.find(i => {
        const itemNum = getShotNumberStr(i.shotNumber).match(/\d+/)?.[0];
        return itemNum && parseInt(itemNum) === shotNum;
      });
      if (item) {
        matched.push(getShotNumberStr(item.shotNumber) || item.originalText || item.scriptSegment);
        return matched;
      }
    }
    
    // 🔧 策略2：在 scriptContent 中查找选中文本所在的镜头块
    const content = selectedFile.scriptContent || '';
    const selectionIndex = content.indexOf(selectedText);
    if (selectionIndex !== -1) {
      // 往前查找最近的镜头标识
      const beforeText = content.substring(0, selectionIndex);
      const shotMatches = [...beforeText.matchAll(/镜头\s*(\d+)/g)];
      if (shotMatches.length > 0) {
        const lastMatch = shotMatches[shotMatches.length - 1];
        const shotNum = parseInt(lastMatch[1]);
        const item = selectedFile.storyboard.items.find(i => {
          const itemNum = getShotNumberStr(i.shotNumber).match(/\d+/)?.[0];
          return itemNum && parseInt(itemNum) === shotNum;
        });
        if (item) {
          matched.push(getShotNumberStr(item.shotNumber) || item.originalText || item.scriptSegment);
          return matched;
        }
      }
    }
    
    // 🔧 策略3：降级到原来的匹配逻辑（兼容旧数据）
    selectedFile.storyboard.items.forEach(item => {
      const originalText = item.originalText || item.scriptSegment;
      if (originalText && originalText.includes(selectedText)) {
        matched.push(originalText);
      }
    });
    
    return matched;
  };

  // Handle Text Selection - 优化为只在选择完成后触发
  useEffect(() => {
    if (isEditMode) return; 

    let selectionTimeout: NodeJS.Timeout | null = null;
    let isSelecting = false; // 跟踪是否正在拖拽选择

    const handleMouseDown = () => {
      isSelecting = true;
      // 清除工具条，避免干扰选择
      setToolbarPosition(null);
    };

    const handleMouseUp = () => {
      if (!isSelecting) return;
      isSelecting = false;
      
      // 延迟处理，确保选择已完成
      setTimeout(() => {
        const activeSelection = window.getSelection();
        
        if (!activeSelection || activeSelection.isCollapsed || !contentRef.current?.contains(activeSelection.anchorNode)) {
          setSelection(null);
          setToolbarPosition(null);
          onSelectionChange(null);
          return;
        }

        const text = activeSelection.toString().trim();
        if (text.length === 0) {
          setSelection(null);
          setToolbarPosition(null);
          onSelectionChange(null);
          return;
        }

        // 🎯 找到匹配的 originalText（用于高亮）
        const matchedTexts = findMatchingOriginalTexts(text);
        
        // 通知父组件
        if (matchedTexts.length > 0) {
          onSelectionChange(matchedTexts[0]);
        } else {
          onSelectionChange(text);
        }

        // Internal Toolbar Logic (用于 AI 操作)
        setSelection(text);
        const range = activeSelection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        if (rect.width > 0 && rect.height > 0) {
          // 🔧 修改定位：工具栏显示在选中文本上方，不遮挡文字
          const toolbarHeight = 180; // 预估工具栏高度（含箭头）
          const gap = 15; // 与文本的间距
          
          setToolbarPosition({
            top: rect.top - toolbarHeight - gap,
            left: rect.left + (rect.width / 2) 
          });
        }
      }, 50);
    };

    const handleSelectionChange = () => {
      // 只有在不是拖拽选择时才处理（例如：双击、三击选择）
      if (isSelecting || showInput) return;

      if (selectionTimeout) {
        clearTimeout(selectionTimeout);
      }

      selectionTimeout = setTimeout(() => {
        const activeSelection = window.getSelection();
        
      if (!activeSelection || activeSelection.isCollapsed || !contentRef.current?.contains(activeSelection.anchorNode)) {
         setSelection(null);
         setToolbarPosition(null);
          onSelectionChange(null);
         return;
      }

      const text = activeSelection.toString().trim();
        if (text.length === 0) {
          setSelection(null);
          setToolbarPosition(null);
          onSelectionChange(null);
          return;
        }

        // 找到匹配的文本
        const matchedTexts = findMatchingOriginalTexts(text);
        if (matchedTexts.length > 0) {
          onSelectionChange(matchedTexts[0]);
        } else {
          onSelectionChange(text);
        }

        setSelection(text);
        const range = activeSelection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        if (rect.width > 0 && rect.height > 0) {
             setToolbarPosition({
                top: rect.top - 60,
                left: rect.left + (rect.width / 2) 
            });
        }
      }, 200); // 增加延迟到 200ms
    };

    if (contentRef.current) {
      contentRef.current.addEventListener('mousedown', handleMouseDown);
      contentRef.current.addEventListener('mouseup', handleMouseUp);
    }
    document.addEventListener('selectionchange', handleSelectionChange);
    
    return () => {
      if (contentRef.current) {
        contentRef.current.removeEventListener('mousedown', handleMouseDown);
        contentRef.current.removeEventListener('mouseup', handleMouseUp);
      }
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (selectionTimeout) clearTimeout(selectionTimeout);
    };
  }, [onSelectionChange, isEditMode, showInput, selectedFile]);

  const handleToolbarAction = (instruction: string, type: 'refine' | 'expand' | 'split' | 'merge') => {
    setActiveInstruction(instruction);
    setActiveActionType(type);
    setShowInput(true);
  };

  const cancelAction = () => {
      setShowInput(false);
      setInputValue('');
  };

  const submitAction = () => {
    if (selection) {
        const fullInstruction = activeInstruction 
            ? `${activeInstruction} ${inputValue ? `(额外要求: ${inputValue})` : ''}`
            : inputValue;
        
        if (fullInstruction) {
            if (activeActionType === 'split' || activeActionType === 'merge') {
                onRestructure(selection, fullInstruction, activeActionType);
            } else {
                onRefineScript(selection, fullInstruction);
            }
            
            window.getSelection()?.removeAllRanges();
            setSelection(null);
            setToolbarPosition(null);
            setShowInput(false);
            setInputValue('');
        }
    }
  };

  // Markdown渲染函数
  const renderMarkdown = (text: string): string => {
    let html = text;
    
    // HTML转义（防止XSS）
    const escapeHtml = (str: string) => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };
    
    html = escapeHtml(html);
    
    // 渲染Markdown语法
    // 注意：不使用inline-block，保持inline以确保文本选择的连续性
    
    // 1. **粗体** 或 ** 内容 **
    html = html.replace(/\*\*\s*([^*]+?)\s*\*\*/g, '<strong class="font-bold text-cyan-300">$1</strong>');
    
    // 2. *斜体*
    html = html.replace(/\*([^*]+?)\*/g, '<em class="italic text-emerald-300">$1</em>');
    
    // 3. 【标记】加颜色（紫色/靛蓝色）- 使用普通span，不加额外样式
    html = html.replace(/【([^】]+)】/g, '<span class="text-indigo-400 font-bold">【$1】</span>');
    
    // 4. （说明）加颜色 - 使用普通span，不加额外样式
    html = html.replace(/（([^）]+)）/g, '<span class="text-gray-400">（$1）</span>');
    
    return html;
  };

  // 🔧 基于镜头号匹配渲染原文并高亮
  const renderScriptContentWithHighlight = () => {
    const content = selectedFile?.scriptContent || '';
    if (!content) return '';

    // 如果没有分镜或没有选中的镜头，直接显示Markdown渲染的内容
    if (!selectedFile?.storyboard || highlightedItemIds.size === 0) {
      return renderMarkdown(content);
    }

    // 使用占位符标记要高亮的文本段落
    const MARK_START = '###HLSTART###';
    const MARK_END = '###HLEND###';
    let markedContent = content;

    // 🔧 三阶段精确高亮：按选中镜头的 videoScriptBlock（段内唯一）标记，
    // 避免镜头号全局重复时永远高亮第一处。多个细分镜头可能共享同一块 → 去重后整块高亮。
    const highlightBlocks = Array.from(new Set(
      selectedFile.storyboard.items
        .filter(item => highlightedItemIds.has(item.id))
        .map(item => (item.videoScriptBlock || '').trim())
        .filter(b => b.length > 0)
    ));
    if (highlightBlocks.length > 0) {
      for (const blk of highlightBlocks) {
        const idx = markedContent.indexOf(blk);
        if (idx !== -1) {
          markedContent = markedContent.slice(0, idx) + MARK_START + blk + MARK_END + markedContent.slice(idx + blk.length);
        }
      }
      let html = renderMarkdown(markedContent);
      html = html.replace(
        new RegExp(`${MARK_START}([\\s\\S]*?)${MARK_END}`, 'g'),
        `<mark class="bg-yellow-500/20 text-yellow-50" style="user-select: text; padding: 0.125rem 0.25rem; border-left: 3px solid rgb(234 179 8); background-color: rgba(234 179 8 / 0.15);">$1</mark>`
      );
      return html;
    }

    // 🔧 兜底（旧数据无 videoScriptBlock）：按 shotNumber 镜头号匹配
    const highlightShotNumbers = selectedFile.storyboard.items
      .filter(item => highlightedItemIds.has(item.id))
      .map(item => getShotNumberStr(item.shotNumber))
      .filter(sn => sn && sn.trim());

    if (highlightShotNumbers.length === 0) {
      return renderMarkdown(content);
    }

    // 🔧 基于镜头号找到对应的文本块并高亮
    // 策略：找到 "镜头XX" 开始到下一个 "镜头YY" 或文档末尾的区域
    highlightShotNumbers.forEach(shotNumber => {
      // 匹配 shotNumber（如 "镜头01" 或 "镜头1"）
      const shotNum = shotNumber.match(/\d+/)?.[0];
      if (!shotNum) return;
      
      // 构造正则：匹配 "镜头01" 或 "镜头 01" 或 "镜头1" 等格式
      const shotPattern = new RegExp(`(镜头\\s*0?${parseInt(shotNum)}(?![\\d]))`, 'g');
      
      // 找到这个镜头在内容中的位置
      const match = markedContent.match(shotPattern);
      if (match) {
        // 找到镜头开始位置
        const startIndex = markedContent.search(shotPattern);
        if (startIndex === -1) return;
        
        // 找到下一个镜头的位置（作为结束位置）
        const nextShotNum = parseInt(shotNum) + 1;
        const nextShotPattern = new RegExp(`镜头\\s*0?${nextShotNum}(?![\\d])`);
        const afterStart = markedContent.substring(startIndex + match[0].length);
        const nextMatch = afterStart.match(nextShotPattern);
        
        let endIndex: number;
        if (nextMatch && nextMatch.index !== undefined) {
          endIndex = startIndex + match[0].length + nextMatch.index;
        } else {
          // 如果没有下一个镜头，查找下一个任意镜头标识
          const anyNextShot = afterStart.match(/镜头\s*\d+/);
          if (anyNextShot && anyNextShot.index !== undefined) {
            endIndex = startIndex + match[0].length + anyNextShot.index;
          } else {
            endIndex = markedContent.length;
          }
        }
        
        // 提取这个镜头的完整文本块
        const shotBlock = markedContent.substring(startIndex, endIndex).trimEnd();
        
        // 标记这个区块
        if (shotBlock && !shotBlock.includes(MARK_START)) {
          markedContent = markedContent.replace(shotBlock, `${MARK_START}${shotBlock}${MARK_END}`);
        }
      }
    });

    // 先渲染 Markdown
    let htmlContent = renderMarkdown(markedContent);

    // 然后将占位符替换为高亮标签（使用inline样式避免选择异常）
    htmlContent = htmlContent.replace(
      new RegExp(`${MARK_START}([\\s\\S]*?)${MARK_END}`, 'g'),
      `<mark class="bg-yellow-500/20 text-yellow-50" style="user-select: text; padding: 0.125rem 0.25rem; border-left: 3px solid rgb(234 179 8); background-color: rgba(234 179 8 / 0.15);">$1</mark>`
    );

    return htmlContent;
  };

  return (
    <div className="flex flex-col h-full bg-n0 border-r border-n40 relative">
      <div className="h-[52px] px-4 border-b border-n40 bg-n0 flex-shrink-0 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-n700 uppercase tracking-wider flex items-center gap-2">
            3. 分镜脚本
            </h2>
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 border-r border-n40 pr-2 mr-1">
                     <button onClick={onUndo} disabled={!canUndo} className="p-1.5 text-n100 hover:text-n800 disabled:opacity-30 rounded hover:bg-n20">
                         <Undo2 className="w-4 h-4" />
                     </button>
                     <button onClick={onRedo} disabled={!canRedo} className="p-1.5 text-n100 hover:text-n800 disabled:opacity-30 rounded hover:bg-n20">
                         <Redo2 className="w-4 h-4" />
                     </button>
                 </div>

                {hasScript && (
                  <button
                    onClick={() => setIsEditMode(!isEditMode)}
                    className={`p-1.5 rounded transition-colors ${isEditMode ? 'bg-primary text-white' : 'text-n100 hover:text-n800 hover:bg-n20'}`}
                    title={isEditMode ? "完成编辑" : "手动编辑剧本"}
                  >
                      {isEditMode ? <Save className="w-4 h-4" /> : <Edit className="w-4 h-4" />}
                  </button>
                )}
            </div>
      </div>

      {/* Toolbar - 固定高度52px，与其他栏目对齐 */}
      <div className="h-[52px] px-3 border-b border-n40 bg-n0 flex items-center">
           {/* 🆕 提取分镜按钮 */}
           {hasScript && !selectedFile?.storyboard && (
               <button
               onClick={onExtractShots}
               disabled={isShotExtracting || isProcessing}
               className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-xs transition-all ${
                 isShotExtracting || isProcessing
                   ? 'bg-n0 text-n100 cursor-not-allowed'
                   : 'bg-gradient-to-r from-primary to-pink-600 hover:from-primary-hover hover:to-pink-500 text-white shadow-lg shadow-purple-900/50'
               }`}
             >
               {isShotExtracting ? (
                 <>
                   <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                   <span>提取中...</span>
                 </>
               ) : (
                 <>
                   <LayoutDashboard className="w-4 h-4" />
                   <span>提取分镜</span>
                 </>
               )}
               </button>
           )}
               
          {/* 🆕 已提取分镜提示 + 导出按钮 */}
          {selectedFile?.storyboard && (
            <div className="w-full flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-green-900/20 border border-green-500/30 rounded-lg text-xs text-success">
                <LayoutDashboard className="w-4 h-4" />
                <span>已提取 {selectedFile.storyboard.items.length} 个分镜</span>
              </div>

              {/* 🆕 导出Excel按钮 */}
              <button
                onClick={() => exportStoryboardToExcel()}
                className="flex items-center gap-1.5 px-3 py-2 bg-b50 hover:bg-blue-600 border border-b75 rounded-lg text-xs text-b400 hover:text-white transition-all"
                title="导出分镜表格"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>导出Excel</span>
              </button>
            </div>
          )}
          
          {/* 无脚本内容时显示AI改写按钮 */}
          {!hasScript && onRewrite && (
            <button
              onClick={() => onRewrite(selectedFile?.id)}
              disabled={isProcessing}
              className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-xs transition-all ${
                isProcessing
                  ? 'bg-n0 text-n100 cursor-not-allowed'
                  : 'bg-gradient-to-r from-primary to-purple-600 hover:from-primary-hover hover:to-purple-500 text-white shadow-lg shadow-indigo-900/50'
              }`}
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  <span>AI改写中...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  <span>AI 分镜脚本改写</span>
                </>
              )}
            </button>
          )}
          {!hasScript && !onRewrite && (
            <div className="w-full text-center text-xs text-n100">等待剧本生成...</div>
          )}
      </div>

      <div
        className="flex-1 overflow-y-auto bg-n20 relative custom-scrollbar"
        ref={contentRef}
        onClick={(e) => {
          // 🔧 编辑模式下不清除选择，让textarea正常工作
          if (isEditMode) return;
          
          // 点击空白区域清除选择
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('p-6')) {
            window.getSelection()?.removeAllRanges();
            setSelection(null);
            setToolbarPosition(null);
          }
        }}
      >
        {hasScript ? (
          <>
            {isEditMode ? (
                <textarea
                    className="w-full h-full p-6 bg-n0 text-sm font-mono text-n700 leading-relaxed resize-none focus:outline-none focus:bg-n0 border border-primary focus:border-primary focus:ring-2 focus:ring-primary/20"
                    value={selectedFile.scriptContent || ''}
                    onChange={(e) => onUpdateScript(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    spellCheck={false}
                    autoFocus
                    placeholder="在此编辑剧本内容..."
                    style={{ userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}
                />
            ) : selectedFile?.storyboard?.items && selectedFile.storyboard.items.length > 0 ? (
                // 🆕 已提取分镜：显示原文+选择高亮+工具条
                <div className="p-6 space-y-6 pb-20 relative">
                    <div
                      className="font-mono text-sm whitespace-pre-wrap text-n700 leading-relaxed border-l-2 border-success pl-4 selection:bg-primary-light selection:text-n800 relative"
                      style={{ userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}
                      dangerouslySetInnerHTML={{ __html: renderScriptContentWithHighlight() }}
                    />

                    {/* 分镜统计 */}
                    <div className="mt-6 p-4 bg-primary-light border border-primary rounded-lg">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-success" />
                        <span className="text-sm text-n700">
                          已提取 <strong className="text-primary">{selectedFile.storyboard.items.length}</strong> 个分镜段落
                        </span>
                        {/* 🔧 已移除"重新提取"按钮 - 新流程中分镜由AI直接生成并流式解析 */}
                      </div>
                      <p className="text-xs text-n100 mt-2">
                        💡 选择文本片段可查看对应分镜的场景描述
                      </p>
                    </div>
                </div>
            ) : (
                // 纯剧本文本显示
                <div className="p-6 space-y-6 pb-20">
                    {/* 显示原文脚本并基于数据结构高亮 */}
                    <div
                      className="font-mono text-sm whitespace-pre-wrap text-n700 leading-relaxed border-l-2 border-success pl-4 selection:bg-primary-light selection:text-n800"
                      style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                      dangerouslySetInnerHTML={{ __html: renderScriptContentWithHighlight() }}
                    />

                    {(selectedFile.extractedCharacters.length > 0 || selectedFile.extractedScenes.length > 0 || (selectedFile.extractedProps || []).length > 0) && (
                        <div className="mt-8 pt-6 border-t border-n40 space-y-4">
                            <h3 className="text-xs font-bold text-n100 uppercase flex items-center gap-2">
                                <Tags className="w-3 h-3" />
                                数据库标签提取
                            </h3>
                            
                            {selectedFile.extractedCharacters.length > 0 && (
                                <div>
                                    <span className="text-[10px] text-primary font-bold mb-2 block">角色 (Characters)</span>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedFile.extractedCharacters.map((char, i) => (
                                            <span key={i} className="px-2 py-1 bg-primary-light border border-primary rounded text-[10px] text-primary">
                                                {char}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {selectedFile.extractedScenes.length > 0 && (
                                <div>
                                    <span className="text-[10px] text-orange-400 font-bold mb-2 block">场景 (Scenes)</span>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedFile.extractedScenes.map((scene, i) => (
                                            <span key={i} className="px-2 py-1 bg-orange-900/30 border border-orange-500/20 rounded text-[10px] text-orange-200">
                                                {scene}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(selectedFile.extractedProps || []).length > 0 && (
                                <div>
                                    <span className="text-[10px] text-yellow-600 font-bold mb-2 block">道具 (Props)</span>
                                    <div className="flex flex-wrap gap-2">
                                        {(selectedFile.extractedProps || []).map((prop, i) => (
                                            <span key={i} className="px-2 py-1 bg-yellow-900/20 border border-yellow-500/20 rounded text-[10px] text-yellow-600">
                                                {prop}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
          </>
        ) : selectedFile ? (
          <div className="h-full flex flex-col items-center justify-center text-n100">
            <FileSignature className="w-12 h-12 mb-4 opacity-20" />
            <p>暂无剧本内容</p>
            <p className="text-xs mt-2">请在"文字脚本"栏点击改写</p>
          </div>
        ) : (
           <div className="h-full flex flex-col items-center justify-center text-n100">
            <ScrollText className="w-12 h-12 mb-4 opacity-20" />
            <p>请选择文件查看剧本</p>
          </div>
        )}
      </div>

      {!isEditMode && selection && toolbarPosition && (
          <div 
            style={{ top: toolbarPosition.top, left: toolbarPosition.left, transform: 'translate(-50%, -100%)' }}
            className="fixed z-50 bg-n0 rounded-lg shadow-bottom border border-n40 p-1.5 flex flex-col gap-2 min-w-[280px] max-w-[320px] animate-in fade-in zoom-in-95 duration-200"
            onMouseDown={(e) => e.preventDefault()}
          >
             {!showInput ? (
                 <>
                 {/* 第一行：快速操作 */}
                 <div className="flex items-center gap-1 justify-between">
                    <button onClick={() => handleToolbarAction('润色文字', 'refine')} className="flex flex-col items-center gap-1 p-2 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors flex-1">
                        <Wand2 className="w-4 h-4 text-primary" />
                        <span>润色</span>
                    </button>
                    <button onClick={() => handleToolbarAction('扩写这一段，增加细节', 'expand')} className="flex flex-col items-center gap-1 p-2 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors flex-1">
                        <Sparkles className="w-4 h-4 text-success" />
                        <span>扩写</span>
                    </button>
                    <button onClick={() => handleToolbarAction('拆分这个分镜，使其更细致', 'split')} className="flex flex-col items-center gap-1 p-2 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors flex-1">
                        <Split className="w-4 h-4 text-orange-400" />
                        <span>拆分</span>
                    </button>
                    <button 
                      onClick={() => {
                        // 检查是否匹配到多个分镜
                        const matchedShots = selectedFile?.storyboard?.items.filter(item =>
                          item.originalText.includes(selection || '') || 
                          (selection && selection.length > 30 && item.originalText.substring(0, 100).includes(selection.substring(0, 30)))
                        ) || [];
                        
                        if (matchedShots.length > 1) {
                          handleToolbarAction(`合并这${matchedShots.length}个镜头为一个`, 'merge');
                        } else {
                          alert('合并操作需要选择多个镜头的文字');
                        }
                      }}
                      className="flex flex-col items-center gap-1 p-2 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors flex-1"
                    >
                        <Merge className="w-4 h-4 text-b400" />
                        <span>合并</span>
                    </button>
                 </div>
                 
                 {/* 第二行：查看详情按钮（仅在已提取分镜后显示） */}
                 {selectedFile?.storyboard?.items && (() => {
                   // 查找所有匹配的分镜
                   const matchedShots = selectedFile.storyboard?.items.filter(item =>
                     item.originalText.includes(selection || '') || 
                     (selection && selection.length > 50 && item.originalText.substring(0, 50).includes(selection.substring(0, 50))) ||
                     item.scriptSegment.includes(selection || '')
                   ) || [];
                   
                   if (matchedShots.length === 0) return null;
                   
                   return (
                     <div className="w-full flex items-center gap-2 px-2 py-2 bg-n20 border-t border-n40">
                       <span className="text-[10px] text-n100">
                         匹配到 <strong className="text-primary">{matchedShots.length}</strong> 个分镜
                       </span>
                       <button
                         onClick={() => {
                           if (matchedShots.length === 1) {
                             // 单个分镜：直接查看详情
                             setSelectedShotId(matchedShots[0].id);
                             setShowShotPromptModal(true);
                           } else {
                             // 多个分镜：打开多镜头查看器
                             setSelectedShotId(matchedShots[0].id); // 先显示第一个
                             setShowShotPromptModal(true);
                           }
                           // 关闭工具条
                           setToolbarPosition(null);
                           setSelection(null);
                         }}
                         className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-primary-light hover:bg-primary-light border border-primary rounded text-primary hover:text-white transition-colors"
                       >
                         <FileText className="w-3.5 h-3.5" />
                         <span className="text-xs font-medium">
                           查看详情 {matchedShots.length > 1 ? `(${matchedShots.length}个)` : ''}
                         </span>
                       </button>
                     </div>
                   );
                 })()}
                 </>
             ) : (
                 <div className="flex flex-col gap-2 p-2">
                     <div className="flex items-center justify-between border-b border-n40 pb-2 mb-1">
                        <span className="text-[10px] font-bold text-n300 uppercase">
                            {activeActionType === 'split' ? '拆分分镜' : activeActionType === 'merge' ? '合并分镜' : activeActionType === 'expand' ? '文本扩写' : '文本润色'}
                        </span>
                        <button onClick={cancelAction} className="text-n100 hover:text-n800"><X className="w-3 h-3" /></button>
                     </div>

                     <span className="text-[10px] text-n100">具体要求:</span>
                     <textarea 
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={
                            activeActionType === 'split' ? "例：拆分成3个镜头，先特写眼神，再拉远..." :
                            activeActionType === 'merge' ? "例：合并为一个长镜头，强调氛围..." :
                            "输入您的具体修改要求..."
                        }
                        autoFocus
                        rows={3}
                        className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs text-n800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                submitAction();
                            }
                            if (e.key === 'Escape') {
                                cancelAction();
                            }
                        }}
                     />
                     <div className="flex gap-2 mt-1">
                        <button onClick={cancelAction} className="flex-1 py-1.5 bg-n30 hover:bg-n20 rounded text-[10px] text-n700 font-medium">取消</button>
                        <button onClick={submitAction} className="flex-1 py-1.5 bg-primary hover:bg-primary-hover rounded text-[10px] text-white font-bold">确认执行</button>
                     </div>
                 </div>
             )}
             {/* 🔧 箭头指向下方（选中的文字） */}
             <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-n0 border-b border-r border-n40 rotate-45 z-10"></div>
          </div>
      )}
      
      {/* 🆕 分镜场景描述弹窗 */}
      {showShotPromptModal && selectedShotId && selectedFile?.storyboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm" onClick={() => setShowShotPromptModal(false)}>
          <div className="bg-n0 border border-n40 rounded-md w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col shadow-bottom m-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-n40 flex items-center justify-between sticky top-0 bg-n0 z-10">
              <h3 className="text-lg font-semibold text-n800 flex items-center gap-2">
                <LayoutDashboard className="w-5 h-5 text-primary" />
                分镜场景描述
                {(() => {
                  const currentIndex = selectedFile.storyboard.items.findIndex(i => i.id === selectedShotId);
                  const totalShots = selectedFile.storyboard.items.length;
                  return currentIndex >= 0 ? (
                    <span className="text-sm text-n100 ml-2">
                      ({currentIndex + 1} / {totalShots})
                    </span>
                  ) : null;
                })()}
              </h3>
              <div className="flex items-center gap-2">
                {/* 🆕 多镜头导航 */}
                {(() => {
                  const currentIndex = selectedFile.storyboard.items.findIndex(i => i.id === selectedShotId);
                  return (
                    <>
                      <button
                        onClick={() => {
                          if (currentIndex > 0) {
                            setSelectedShotId(selectedFile.storyboard.items[currentIndex - 1].id);
                          }
                        }}
                        disabled={currentIndex <= 0}
                        className="p-1 hover:bg-n20 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="上一个分镜"
                      >
                        <svg className="w-5 h-5 text-n300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          if (currentIndex < selectedFile.storyboard.items.length - 1) {
                            setSelectedShotId(selectedFile.storyboard.items[currentIndex + 1].id);
                          }
                        }}
                        disabled={currentIndex >= selectedFile.storyboard.items.length - 1}
                        className="p-1 hover:bg-n20 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="下一个分镜"
                      >
                        <svg className="w-5 h-5 text-n300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </>
                  );
                })()}
                <button
                  onClick={() => setShowShotPromptModal(false)}
                  className="p-1 hover:bg-n20 rounded transition-colors"
                >
                  <X className="w-5 h-5 text-n300" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              {(() => {
                const shot = selectedFile.storyboard.items.find(i => i.id === selectedShotId);
                if (!shot) return null;
                
                const hasDetails = !!shot.imagePrompt;  // 判断是否已生成详细信息
                
                return (
                  <>
                    {/* 镜头编号 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-n300">镜头编号:</span>
                        <span className="text-n800 text-lg">#{shot.shotNumber || selectedFile.storyboard.items.indexOf(shot) + 1}</span>
                      </div>
                      {hasDetails ? (
                        <span className="px-2 py-1 bg-green-900/30 text-success rounded text-xs flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          已生成详情
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-n0 text-n100 rounded text-xs flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          待生成详情
                        </span>
                      )}
                    </div>

                    {/* 场景描述 - 可编辑 */}
                    <div>
                      <label className="text-xs font-bold text-n300 block mb-2">
                        场景描述（AI提炼的视觉描述）
                      </label>
                      {editingShotId === shot.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingScriptSegment}
                            onChange={(e) => setEditingScriptSegment(e.target.value)}
                            className="w-full p-3 bg-n0 border border-primary rounded text-sm text-n700 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                            rows={4}
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (selectedFile) {
                                  const updatedItems = selectedFile.storyboard!.items.map(i =>
                                    i.id === shot.id ? { ...i, scriptSegment: editingScriptSegment } : i
                                  );
                                  onUpdateScript(JSON.stringify({ items: updatedItems }));
                                }
                                setEditingShotId(null);
                              }}
                              className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded transition-all"
                            >
                              保存修改
                            </button>
                            <button
                              onClick={() => setEditingShotId(null)}
                              className="px-4 py-2 bg-n30 hover:bg-n20 text-n800 text-sm rounded transition-all"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="relative group">
                          <div className="p-3 bg-n0 rounded text-sm text-n700 border border-n40 leading-relaxed">
                            {shot.scriptSegment}
                          </div>
                          <button
                            onClick={() => {
                              setEditingShotId(shot.id);
                              setEditingScriptSegment(shot.scriptSegment);
                            }}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1.5 bg-n30 hover:bg-n20 rounded transition-all"
                            title="编辑场景描述"
                          >
                            <Edit className="w-4 h-4 text-n700" />
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {/* 原文段落 */}
                    <div>
                      <label className="text-xs font-bold text-n300 block mb-2">原文段落（剧本原文）</label>
                      <details className="bg-n0 rounded border border-n40">
                        <summary className="p-3 cursor-pointer text-xs text-n300 hover:text-n700 select-none">
                          点击展开/收起原文
                        </summary>
                        <div className="p-3 pt-0 text-xs text-n300 max-h-48 overflow-y-auto custom-scrollbar">
                          {shot.originalText}
                        </div>
                      </details>
                    </div>

                    {/* 🆕 已生成详情时显示 */}
                    {hasDetails ? (
                      <div className="space-y-4 pt-4 border-t border-n40">
                        <h4 className="text-sm font-bold text-n700 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-success" />
                          生成的详细信息
                        </h4>

                        {/* 图像提示词 */}
                        {shot.imagePrompt && (
                          <div>
                            <label className="text-xs font-bold text-n300 block mb-2">图像生成提示词</label>
                            <div className="p-3 bg-n0 rounded text-sm text-n700 border border-n40 leading-relaxed">
                              {shot.imagePrompt}
                            </div>
                          </div>
                        )}

                        {/* 视频提示词 */}
                        {shot.videoPrompt && (
                          <div>
                            <label className="text-xs font-bold text-n300 block mb-2">视频生成提示词</label>
                            <div className="p-3 bg-n0 rounded text-sm text-n700 border border-n40 leading-relaxed">
                              {shot.videoPrompt}
                            </div>
                          </div>
                        )}

                        {/* 台词 */}
                        {shot.dialogue && (
                          <div>
                            <label className="text-xs font-bold text-n300 block mb-2">台词</label>
                            <div className="p-3 bg-n0 rounded text-sm text-n700 border border-n40 italic">
                              "{shot.dialogue}"
                            </div>
                          </div>
                        )}

                        {/* 角色、场景和道具 */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {shot.characters && shot.characters.length > 0 && (
                            <div>
                              <label className="text-xs font-bold text-n300 block mb-2">角色</label>
                              <div className="flex flex-wrap gap-1.5">
                                {shot.characters.map(char => (
                                  <span key={char} className="px-2 py-1 bg-primary-light text-primary rounded text-xs border border-primary">
                                    {char}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {shot.scene && (
                            <div>
                              <label className="text-xs font-bold text-n300 block mb-2">场景</label>
                              <div className="px-2 py-1 bg-n0 text-n700 rounded text-xs border border-n40">
                                📍 {shot.scene}
                              </div>
                            </div>
                          )}
                          {shot.props && shot.props.length > 0 && (
                            <div>
                              <label className="text-xs font-bold text-n300 block mb-2">道具</label>
                              <div className="flex flex-wrap gap-1.5">
                                {shot.props.map(prop => (
                                  <span key={prop} className="px-2 py-1 bg-yellow-900/20 text-yellow-700 rounded text-xs border border-yellow-500/20">
                                    {prop}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* 🆕 未生成详情时的提示 */
                      <div className="p-4 bg-b50 border border-b75 rounded-lg">
                        <div className="flex items-start gap-3">
                          <AlertOctagon className="w-5 h-5 text-b400 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <h4 className="text-sm font-bold text-b400 mb-1">尚未生成详细信息</h4>
                            <p className="text-xs text-b400 leading-relaxed">
                              此分镜仅提取了场景描述。
                              <br/>
                              请前往右侧 <strong className="text-b400">"镜头设计"</strong> 栏，点击 <strong className="text-b400">"一键生成分镜详情"</strong> 按钮，
                              <br/>
                              为所有分镜生成图像提示词、视频提示词、角色标签等详细信息。
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* 操作按钮区域 */}
                    <div className="pt-4 border-t border-n40">
                      <label className="text-xs font-bold text-n300 block mb-3">快速操作（当前分镜）</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={async () => {
                            // 润色场景描述
                            const instruction = prompt('请输入润色要求（可选）：', '使其更生动形象');
                            if (instruction !== null) {
                              try {
                                const { aiRefineScriptSegment } = await import('../services/aiModelService');
                                const refined = await aiRefineScriptSegment(
                                  aiModel,
                                  shot.scriptSegment,
                                  instruction || '使其更生动形象',
                                  selectedFile.scriptContent || ''
                                );
                                // 🔧 使用正确的方法更新分镜
                                const updatedItems = selectedFile.storyboard!.items.map(i =>
                                  i.id === shot.id ? { ...i, scriptSegment: refined } : i
                                );
                                if (onUpdateStoryboardItems) {
                                  onUpdateStoryboardItems(updatedItems);
                                }
                                alert('✅ 润色完成！');
                              } catch (error) {
                                alert('❌ 润色失败: ' + (error as Error).message);
                              }
                            }
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-primary-light hover:bg-primary-light border border-primary text-primary hover:text-white rounded transition-all"
                        >
                          <Wand2 className="w-4 h-4" />
                          <span className="text-sm">润色</span>
                        </button>
                        <button
                          onClick={async () => {
                            // 扩写场景描述
                            const instruction = prompt('请输入扩写要求（可选）：', '增加更多细节描述');
                            if (instruction !== null) {
                              try {
                                const { aiRefineScriptSegment } = await import('../services/aiModelService');
                                const expanded = await aiRefineScriptSegment(
                                  aiModel,
                                  shot.scriptSegment,
                                  instruction || '扩写这一段，增加细节',
                                  selectedFile.scriptContent || ''
                                );
                                // 🔧 使用正确的方法更新分镜
                                const updatedItems = selectedFile.storyboard!.items.map(i =>
                                  i.id === shot.id ? { ...i, scriptSegment: expanded } : i
                                );
                                if (onUpdateStoryboardItems) {
                                  onUpdateStoryboardItems(updatedItems);
                                }
                                alert('✅ 扩写完成！');
                              } catch (error) {
                                alert('❌ 扩写失败: ' + (error as Error).message);
                              }
                            }
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-green-900/30 hover:bg-green-800/50 border border-green-500/30 text-success hover:text-white rounded transition-all"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span className="text-sm">扩写</span>
                        </button>
                        <button
                          onClick={async () => {
                            // 拆分当前分镜
                            const count = prompt('拆分为几个镜头？', '2');
                            if (count && parseInt(count) > 1) {
                              try {
                                const { aiRestructureShot } = await import('../services/aiModelService');
                                const result = await aiRestructureShot(
                                  aiModel,
                                  shot.originalText || shot.scriptSegment,  // 🔧 优先使用 originalText
                                  `拆分为${count}个独立镜头`,
                                  'split'
                                );
                                
                                // 🔧 处理拆分结果，实际更新storyboard
                                if (result.newStoryboardItems && result.newStoryboardItems.length > 0 && onUpdateStoryboardItems) {
                                  const currentIndex = selectedFile.storyboard!.items.findIndex(i => i.id === shot.id);
                                  const newItems = result.newStoryboardItems.map((item: any, idx: number) => ({
                                    id: `${Date.now()}-${idx}`,
                                    shotNumber: item.shotNumber || item.shotId || `${currentIndex + 1 + idx}`,
                                    originalText: item.originalText || shot.originalText,
                                    scriptSegment: item.scriptSegment || '',
                                    imagePrompt: item.imagePrompt,
                                    videoPrompt: item.videoPrompt,
                                    dialogue: item.dialogue,
                                    characters: item.characters,
                                    scene: item.scene,
                                    timestamp: Date.now()
                                  }));
                                  
                                  // 替换当前分镜为新的多个分镜
                                  const updatedItems = [
                                    ...selectedFile.storyboard!.items.slice(0, currentIndex),
                                    ...newItems,
                                    ...selectedFile.storyboard!.items.slice(currentIndex + 1)
                                  ];
                                  
                                  onUpdateStoryboardItems(updatedItems);
                                  setShowShotPromptModal(false);  // 关闭弹窗
                                  alert(`✅ 拆分完成！已生成 ${newItems.length} 个新镜头`);
                                } else {
                                  alert('❌ 拆分失败: 未返回有效的分镜数据');
                                }
                              } catch (error) {
                                alert('❌ 拆分失败: ' + (error as Error).message);
                              }
                            }
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-orange-900/30 hover:bg-orange-800/50 border border-orange-500/30 text-orange-300 hover:text-white rounded transition-all"
                        >
                          <Split className="w-4 h-4" />
                          <span className="text-sm">拆分</span>
                        </button>
                        <button
                          onClick={() => {
                            // 合并功能需要选中多个分镜，在工具条中提供
                            alert('请在分镜脚本中框选多个镜头的文字，然后点击工具条的"合并"按钮');
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-b50 hover:bg-blue-800/50 border border-b75 text-b400 hover:text-white rounded transition-all"
                        >
                          <Merge className="w-4 h-4" />
                          <span className="text-sm">合并</span>
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      
      {/* 🔧 已移除分镜要求编辑Modal - 新流程中镜头由规则自动解析生成 */}
    </div>
  );
};
