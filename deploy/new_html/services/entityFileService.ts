export interface EntityFile {
  fileId: string;
  fileUrl: string;
  fileType: string;
  fileRole: string;
  isSelected: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

function getHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function normalize(row: any): EntityFile {
  return {
    fileId: row.file_id ?? row.fileId ?? '',
    fileUrl: row.file_url ?? row.fileUrl ?? '',
    fileType: row.file_type ?? row.fileType ?? '',
    fileRole: row.file_role ?? row.fileRole ?? '',
    isSelected: !!(row.is_selected ?? row.isSelected),
    createdAt: row.created_at ?? row.createdAt ?? '',
    metadata: row.metadata,
    entityType: row.entity_type ?? row.entityType,
    entityId: row.entity_id ?? row.entityId,
  };
}

export async function fetchEntityFiles(
  entityType: string,
  entityId: string,
  fileRole?: string,
): Promise<{ items: EntityFile[]; total: number }> {
  const params = new URLSearchParams({ entity_type: entityType, entity_id: entityId });
  if (fileRole) params.set('file_role', fileRole);
  const res = await fetch(`/api/entity-files?${params}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`fetchEntityFiles failed: ${res.status}`);
  const data = await res.json();
  return {
    items: (data.items || []).map(normalize),
    total: data.total ?? 0,
  };
}

export async function fetchUserFiles(
  fileType?: string,
  limit: number = 100,
  offset: number = 0,
): Promise<{ items: EntityFile[]; total: number }> {
  const params = new URLSearchParams();
  if (fileType) params.set('file_type', fileType);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const res = await fetch(`/api/user-files?${params}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`fetchUserFiles failed: ${res.status}`);
  const data = await res.json();
  return {
    items: (data.items || []).map(normalize),
    total: data.total ?? 0,
  };
}

export async function selectEntityFile(
  fileId: string,
  entityType: string,
  entityId: string,
  fileRole: string,
): Promise<EntityFile> {
  const res = await fetch(`/api/entity-files/${fileId}/select`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, file_role: fileRole }),
  });
  if (!res.ok) throw new Error(`selectEntityFile failed: ${res.status}`);
  const data = await res.json();
  return normalize(data.file);
}

export async function deleteEntityFile(fileId: string): Promise<void> {
  const res = await fetch(`/api/entity-files/${fileId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`deleteEntityFile failed: ${res.status}`);
}

export async function hardDeleteEntityFile(fileId: string): Promise<{ freed_bytes: number }> {
  const res = await fetch(`/api/entity-files/${fileId}/hard`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`hardDeleteEntityFile failed: ${res.status}`);
  return res.json();
}

export async function hardDeleteEntityFiles(fileIds: string[]): Promise<{ deleted: number; freed_bytes: number; errors: string[] }> {
  const res = await fetch('/api/entity-files/hard-delete-batch', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ file_ids: fileIds }),
  });
  if (!res.ok) throw new Error(`hardDeleteEntityFiles failed: ${res.status}`);
  return res.json();
}

export async function linkEntityFile(
  fileId: string,
  entityType: string,
  entityId: string,
  fileRole: string,
  isSelected: boolean = false,
): Promise<EntityFile> {
  const res = await fetch('/api/entity-files/link', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      file_id: fileId, entity_type: entityType,
      entity_id: entityId, file_role: fileRole, is_selected: isSelected,
    }),
  });
  if (!res.ok) throw new Error(`linkEntityFile failed: ${res.status}`);
  const data = await res.json();
  return normalize(data.file);
}

export async function uploadEntityFile(
  file: File,
  entityType: string,
  entityId: string,
  fileRole: string,
  episodeId?: string,
): Promise<{ fileId: string; fileUrl: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (entityType) formData.append('entity_type', entityType);
  if (entityId) formData.append('entity_id', entityId);
  if (fileRole) formData.append('file_role', fileRole);
  if (episodeId) formData.append('episode_id', episodeId);

  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/entity-files/upload', {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`uploadEntityFile failed: ${res.status}`);
  const data = await res.json();
  return { fileId: data.file_id, fileUrl: data.file_url };
}
