
import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

interface SkeletonScreenProps {
  message?: string;
}

/**
 * 轻量级骨架屏 - 用于视图切换时的非阻塞加载
 * 与LoadingOverlay不同，这个组件不会完全覆盖页面，只显示在内容区域
 */
export const SkeletonScreen: React.FC<SkeletonScreenProps> = ({ 
  message = '正在加载数据...' 
}) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-950/50 backdrop-blur-sm">
      {/* 简洁的加载动画 */}
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-indigo-500/20 blur-xl animate-pulse rounded-full"></div>
        <div className="relative bg-gray-900/80 border border-indigo-500/30 p-4 rounded-xl shadow-lg flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
        <div className="absolute -top-1 -right-1">
          <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
        </div>
      </div>

      {/* 加载文本 */}
      <p className="text-sm font-mono text-gray-400 tracking-wider animate-pulse">
        {message}
      </p>

      {/* 进度条 */}
      <div className="w-48 h-0.5 bg-gray-800 rounded-full mt-4 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 w-1/3 animate-loading-shimmer rounded-full"></div>
      </div>

      <style>{`
        @keyframes loading-shimmer {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
        .animate-loading-shimmer {
          animation: loading-shimmer 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};
