
import React, { useState, useCallback } from 'react';
import { Sparkles, BookOpen, ScrollText, LayoutDashboard, FileText, Settings, Play, StopCircle, Layers, Image as ImageIcon, Video, ShieldCheck, History, LogOut, ChevronDown, FolderOpen } from 'lucide-react';
import { AppView, AiModel, TaskNotification } from '../types';
import { NotificationPanel } from './NotificationPanel';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface HeaderProps {
  visibleColumns: boolean[];
  onToggleColumn: (index: number) => void;
  onGlobalBatchProcess: () => void;
  onStopProcessing?: () => void;  // 🆕 停止处理的回调
  isProcessing: boolean;
  fileCount: number;
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  aiModel: AiModel;
  onChangeModel: (model: AiModel) => void;
  // 🆕 任务通知（2026-05-20 起改由 TaskContext 提供，props 仅作向后兼容）
  notifications?: TaskNotification[];
  onDismissNotification?: (id: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  visibleColumns, 
  onToggleColumn, 
  onGlobalBatchProcess,
  onStopProcessing,
  isProcessing,
  fileCount,
  currentView,
  onChangeView,
  aiModel,
  onChangeModel,
  notifications = [],
  onDismissNotification
}) => {
  // 🔐 检查是否为管理员（包括超级管理员）
  const username = localStorage.getItem('username') || 'User';
  const isAdmin = username === 'admin' || username === 'lllsdhr';
  
  // 用户菜单状态
  const [showUserMenu, setShowUserMenu] = useState(false);
  
  // 登出处理
  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
    } catch (e) {
      console.warn('登出请求失败', e);
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    window.location.href = '/login';
  }, []);
  
  const navItems = [
    { icon: FileText, label: "文件", index: 0 },
    { icon: BookOpen, label: "阅读", index: 1 },
    { icon: ScrollText, label: "剧本", index: 2 },
    { icon: LayoutDashboard, label: "分镜", index: 3 },
  ];

  // 跳转到第四阶段（视频生成）- 现在使用React内部路由
  const handleNavigateToVideo = () => {
    onChangeView(AppView.Video);
  };

  return (
    <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-6 justify-between flex-shrink-0 z-50">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3">
          <a href="/projects" className="flex items-center gap-1.5 text-gray-400 hover:text-purple-400 transition-colors" title="返回项目列表">
            <FolderOpen className="w-4 h-4" />
          </a>
          <img src="/static/image_1ca1c5.png" alt="MESSIAH" className="h-7 object-contain invert" />
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-lg tracking-tight text-white">MESSIAH</span>
            <span className="text-[10px] text-slate-400 uppercase">Storyboard AI</span>
          </div>
        </div>
        
        {/* Navigation Tabs - 四个阶段 */}
        <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800">
          <button 
            onClick={() => onChangeView(AppView.Editor)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all
               ${currentView === AppView.Editor ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}
            `}
          >
            剧本分镜
          </button>
          <button 
            onClick={() => onChangeView(AppView.Materials)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all
               ${currentView === AppView.Materials ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}
            `}
          >
            素材绑定
          </button>
          <button 
            onClick={() => onChangeView(AppView.Generation)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all
               ${currentView === AppView.Generation ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}
            `}
          >
            画面分镜
          </button>
          {/* 视频生成 */}
          <button 
            onClick={handleNavigateToVideo}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all
               ${currentView === AppView.Video ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}
            `}
            title="进入视频生成阶段"
          >
            视频生成
          </button>
           {/* 历史记录 */}
           <button 
             onClick={() => onChangeView(AppView.History)}
             className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2
                ${currentView === AppView.History ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}
             `}
             title="查看视频生成历史记录"
           >
             <History className="w-3.5 h-3.5" />
             历史记录
           </button>
        </div>
        
        {/* 🔐 管理员专属入口（仅admin可见） */}
        {isAdmin && (
          <button 
            onClick={() => onChangeView(AppView.Admin)}
            className={`ml-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 border
               ${currentView === AppView.Admin 
                 ? 'bg-red-900/30 text-red-400 border-red-500/30' 
                 : 'text-gray-500 hover:text-red-400 border-gray-700 hover:border-red-500/30'}
            `}
            title="管理员控制台"
          >
            <ShieldCheck className="w-4 h-4" />
            管理
          </button>
        )}
        
        {/* Layout Toggles - Only show in Editor view */}
        {currentView === AppView.Editor && (
            <div className="flex items-center gap-2">
            <div className="flex items-center bg-gray-800/50 rounded-lg p-1 gap-1 border border-gray-700/50">
            <span className="text-xs text-gray-500 px-2 font-medium">视图:</span>
            {navItems.map((item) => (
                <button
                    key={item.index}
                    onClick={() => onToggleColumn(item.index)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-all ${
                    visibleColumns[item.index]
                        ? 'bg-gray-700 text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                    }`}
                    title={visibleColumns[item.index] ? `隐藏${item.label}` : `显示${item.label}`}
                >
                    <item.icon className={`w-3.5 h-3.5 ${visibleColumns[item.index] ? 'text-indigo-400' : ''}`} />
                    <span className="hidden lg:inline">{item.label}</span>
                </button>
            ))}
              </div>
              
              {/* 🔧 全部显示按钮（当有列被隐藏时显示） */}
              {!visibleColumns.every(v => v) && (
                <button
                  onClick={() => {
                    [0, 1, 2, 3].forEach(i => {
                      if (!visibleColumns[i]) onToggleColumn(i);
                    });
                  }}
                  className="px-2 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-gray-800/50 rounded transition-all"
                  title="显示全部栏目"
                >
                  全部显示
                </button>
              )}
            </div>
        )}

      </div>

      <div className="flex items-center gap-4">
        {currentView === AppView.Editor && (
          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                // 🆕 弹出确认对话框
                if (window.confirm('确定要开始批量执行吗？\n\n这将会对所有文件执行：\n1. AI改写剧本\n2. 提取分镜\n3. 生成详细分镜\n\n支持多文件批量处理，处理时间可能较长，请确认。')) {
                  onGlobalBatchProcess();
                }
              }}
              disabled={isProcessing || fileCount === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all
                  ${isProcessing || fileCount === 0
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/40 border border-emerald-500/50'
                  }`}
            >
              {isProcessing ? (
                  <span className="animate-pulse">批量处理中...</span>
              ) : (
                  <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  批量执行
                  </>
              )}
            </button>
            
            {/* 🆕 停止按钮 */}
            {isProcessing && onStopProcessing && (
              <button 
                onClick={onStopProcessing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/40 border border-red-500/50"
              >
                <StopCircle className="w-3.5 h-3.5" />
                停止
              </button>
            )}
          </div>
        )}

        <div className="h-6 w-px bg-gray-700 mx-2"></div>

        <div className="flex items-center gap-4 text-sm text-gray-400">
          {/* 2026-05-26 组织管理 MVP — workspace 切换器（个人 / 组织） */}
          <WorkspaceSwitcher />

          <button className="p-2 hover:bg-gray-800 rounded-full transition-colors" title="设置">
              <Settings className="w-4 h-4" />
          </button>
          
          {/* 2026-05-20 (Task System Overhaul M1)：统一 NotificationPanel，从 TaskContext 拉数据。
              旧的 props.notifications / props.onDismissNotification 仍向后兼容，但不再用于渲染。 */}
          <NotificationPanel />
          
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
            <span className="hidden sm:inline text-xs font-medium">
              {aiModel === AiModel.Gemini ? 'GI化神' : aiModel === AiModel.DeepseekChat ? 'DK金丹' : 'DK筑基'}
            </span>
          </span>
          
          {/* 用户菜单 */}
          <div className="h-6 w-px bg-gray-700 mx-1"></div>
          
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-800 rounded transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-pink-500 to-orange-500 flex items-center justify-center text-[10px] font-bold text-white">
                {username.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-gray-300">{username}</span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-gray-800 rounded-lg shadow-lg border border-gray-700 py-2 z-50">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};