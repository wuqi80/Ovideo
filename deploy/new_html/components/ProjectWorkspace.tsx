/**
 * 项目工作区容器
 * 提供 ProjectContext，渲染子路由（editor/materials/generation/video/...）
 */
import React from 'react';
import { ProjectProvider, useProject } from '../contexts/ProjectContext';
import { Outlet } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';

const WorkspaceContent: React.FC = () => {
    const { loading, error } = useProject();

    if (loading) {
        return (
            <div className="h-screen bg-gray-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <span className="text-sm">加载项目中...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-screen bg-gray-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-red-400">
                    <AlertCircle className="w-10 h-10" />
                    <span className="text-sm">{error}</span>
                    <a href="/projects" className="text-xs text-purple-400 hover:underline mt-2">
                        返回项目列表
                    </a>
                </div>
            </div>
        );
    }

    return <Outlet />;
};

const ProjectWorkspace: React.FC = () => {
    return (
        <ProjectProvider>
            <WorkspaceContent />
        </ProjectProvider>
    );
};

export default ProjectWorkspace;
