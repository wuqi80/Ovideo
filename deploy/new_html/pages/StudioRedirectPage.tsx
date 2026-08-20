import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';

export function buildStudioUrl(projectId: string, episodeId: string): string {
  const params = new URLSearchParams({
    projectId,
    episodeId,
    returnTo: `/projects/${projectId}/ep/${episodeId}`,
  });
  return `/studio/?${params.toString()}`;
}

export const StudioRedirectPage: React.FC = () => {
  const { projectId = '', episodeId = '' } = useParams();

  useEffect(() => {
    if (!projectId || !episodeId) return;
    window.location.replace(buildStudioUrl(projectId, episodeId));
  }, [episodeId, projectId]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-n20 text-sm text-n300">
      正在打开 Ostory Studio…
    </div>
  );
};
