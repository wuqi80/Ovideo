import React, { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import WorkspaceApp from '../WorkspaceApp';
import { useEpisode } from '../contexts/EpisodeContext';

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
    <div className="h-full w-full overflow-hidden">
      <WorkspaceApp hideHeader episodeId={episodeId} initialScriptId={selectedScriptId} onScriptSelect={setSelectedScriptId} onAfterExport={handleAfterExport} />
    </div>
  );
};
