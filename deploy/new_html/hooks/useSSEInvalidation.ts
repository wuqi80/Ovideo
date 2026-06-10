import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { globalTaskManager } from '../services/globalTaskManager';
import type { TaskEventType } from '../services/globalTaskManager';
import type { TaskNotification } from '../types';

export function useSSEInvalidation() {
  const qc = useQueryClient();

  useEffect(() => {
    const unsubscribe = globalTaskManager.addEventListener((
      type: TaskEventType,
      data: { notification?: TaskNotification },
    ) => {
      if (type === 'notification' && data.notification) {
        const n = data.notification;
        if (n.entityType && n.entityId) {
          qc.invalidateQueries({
            queryKey: ['entityFiles', n.entityType, n.entityId],
          });
        }
        if (n.episodeId) {
          qc.invalidateQueries({ queryKey: ['storyboardItems', n.episodeId] });
          qc.invalidateQueries({ queryKey: ['videoSegments', n.episodeId] });
        }
      }
    });
    return unsubscribe;
  }, [qc]);
}
