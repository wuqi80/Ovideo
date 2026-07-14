import React, { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';

const WorkspaceApp = React.lazy(() => import('../WorkspaceApp'));

const ScriptWorkspaceFallback: React.FC = () => (
  <div className="h-full w-full flex items-center justify-center text-sm text-n300">
    Loading script workspace...
  </div>
);

export const ScriptPage: React.FC = () => {
  const { episodeId } = useParams<{ episodeId: string }>();
  const { selectedScriptId, setSelectedScriptId, forceReloadSlices } = useEpisode();
  const handleAfterExport = useCallback(async () => {
    try {
      await forceReloadSlices('assets', 'script', 'storyboardItems');
    } catch (e) {
      console.warn('刷新 EpisodeContext 失败:', e);
    }
  }, [forceReloadSlices]);
  return (
    <div className="layout-safe h-full w-full overflow-auto">
      <React.Suspense fallback={<ScriptWorkspaceFallback />}>
        <WorkspaceApp
          hideHeader
          episodeId={episodeId}
          initialScriptId={selectedScriptId}
          activeScriptId={selectedScriptId}
          onActivateScript={setSelectedScriptId}
          onAfterExport={handleAfterExport}
        />
      </React.Suspense>
    </div>
  );
};
