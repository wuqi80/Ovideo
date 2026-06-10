/**
 * 视频后处理页面
 * 用于视频放大和配音，从 VideoPage 拆分而来
 */
import React, { useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { ArrowLeft, Wand2, Volume2, ArrowUpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PostProcessPage: React.FC = () => {
    const { projectId, project } = useProject();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'upscale' | 'voice'>('upscale');

    return (
        <div className="h-screen bg-gray-950 text-gray-100 flex flex-col">
            {/* 页面头部 */}
            <div className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4 flex-shrink-0">
                <button
                    onClick={() => navigate(`/projects/${projectId}/episodes`)}
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-white"
                >
                    <ArrowLeft className="w-4 h-4" />
                    返回视频
                </button>
                <div className="w-px h-6 bg-gray-700" />
                <h2 className="text-sm font-medium">
                    视频后处理 — {project?.projectName || ''}
                </h2>
            </div>

            {/* 功能选项卡 */}
            <div className="flex border-b border-gray-800">
                <button
                    onClick={() => setActiveTab('upscale')}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'upscale'
                            ? 'border-purple-500 text-white'
                            : 'border-transparent text-gray-400 hover:text-gray-200'
                    }`}
                >
                    <ArrowUpCircle className="w-4 h-4" />
                    视频放大
                </button>
                <button
                    onClick={() => setActiveTab('voice')}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'voice'
                            ? 'border-purple-500 text-white'
                            : 'border-transparent text-gray-400 hover:text-gray-200'
                    }`}
                >
                    <Volume2 className="w-4 h-4" />
                    配音
                </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-auto p-6">
                {activeTab === 'upscale' ? (
                    <div className="max-w-4xl mx-auto">
                        <div className="bg-gray-800/40 rounded-xl p-8 border border-gray-700/50 text-center">
                            <ArrowUpCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                            <h3 className="text-lg font-medium mb-2">视频放大</h3>
                            <p className="text-sm text-gray-400 mb-6">
                                选择已生成的视频，使用 AI 将其放大至更高分辨率
                            </p>
                            <p className="text-xs text-gray-500">
                                功能开发中，将从视频页面的放大功能迁移至此
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="max-w-4xl mx-auto">
                        <div className="bg-gray-800/40 rounded-xl p-8 border border-gray-700/50 text-center">
                            <Volume2 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                            <h3 className="text-lg font-medium mb-2">配音</h3>
                            <p className="text-sm text-gray-400 mb-6">
                                为视频添加 AI 语音旁白或角色对话配音
                            </p>
                            <p className="text-xs text-gray-500">
                                功能开发中，将从视频页面的配音功能迁移至此
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PostProcessPage;
