export interface TextTaskContext {
  operation?: string;
  displayName?: string;
  projectId?: string;
  episodeId?: string;
  sourcePage?: string;
  sourceItemId?: string;
  entityType?: string;
  entityId?: string;
}

export function toTextTaskPayload(context?: TextTaskContext): Record<string, string> {
  if (!context) return {};

  const fields: Array<[string, string | undefined]> = [
    ['operation', context.operation],
    ['display_name', context.displayName],
    ['project_id', context.projectId],
    ['episode_id', context.episodeId],
    ['source_page', context.sourcePage],
    ['source_item_id', context.sourceItemId],
    ['entity_type', context.entityType],
    ['entity_id', context.entityId],
  ];

  return Object.fromEntries(
    fields.filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
  ) as Record<string, string>;
}
