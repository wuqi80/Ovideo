import { apiBlob, apiJson, getAuthToken, publicBlob, secureApiUrl } from './httpClient';
import { resolveGpuTaskRouting } from './clusterNodeService';

export type MaterialWorkflowType = 'upscale_hd' | 'image_upscale' | 'remove_watermark' | 'three_view';

export interface MaterialEntityOptions {
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  episodeId?: string;
  projectId?: string;
  targetLongEdge?: number;
  dpi?: number;
  textClarity?: boolean;
  preferredAgentId?: string;
  preferredNodeId?: string;
  sourceFileId?: string;
}

function normalizeImageSourceUrl(imageUrl: string): string {
  if (imageUrl.startsWith('http') || imageUrl.startsWith('/')) return imageUrl;
  return '/' + imageUrl;
}

function isSameOriginUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

function dataUrlToBlob(imageDataUrl: string): Blob {
  const base64Data = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: 'image/png' });
}

async function downloadImageBlob(imageUrlOrDataUrl: string): Promise<Blob> {
  if (imageUrlOrDataUrl.startsWith('data:')) {
    return dataUrlToBlob(imageUrlOrDataUrl);
  }

  if (imageUrlOrDataUrl.startsWith('blob:')) {
    console.log(`[ProcessingService] Downloading blob image: ${imageUrlOrDataUrl}`);
    return publicBlob(imageUrlOrDataUrl, { method: 'GET' }, 'downloadBlobImageForComfyUI');
  }

  const normalizedUrl = normalizeImageSourceUrl(imageUrlOrDataUrl);
  const absolute = normalizedUrl.startsWith('http')
    ? normalizedUrl
    : `${window.location.origin}${normalizedUrl}`;

  console.log(`[ProcessingService] Downloading image: ${imageUrlOrDataUrl} -> ${absolute}`);

  if (isSameOriginUrl(normalizedUrl)) {
    return apiBlob(
      secureApiUrl(absolute, { requireAuth: false }),
      { method: 'GET' },
      'downloadImageForComfyUI',
      { requireAuth: false, includeContentType: false },
    );
  }

  return publicBlob(absolute, { method: 'GET' }, 'downloadExternalImageForComfyUI');
}

export async function uploadImageToComfyUI(imageUrlOrDataUrl: string): Promise<{
  success: boolean;
  filename: string;
  storage_url: string;
  file_id?: string;
}> {
  if (!imageUrlOrDataUrl || imageUrlOrDataUrl.trim() === '') {
    throw new Error('图片地址为空，无法提交到处理节点。');
  }

  if (!getAuthToken()) {
    throw new Error('Not logged in.');
  }

  const blob = await downloadImageBlob(imageUrlOrDataUrl);
  const formData = new FormData();
  formData.append('image', blob, `image_${Date.now()}.png`);
  formData.append('node_type', 'image');

  return apiJson<any>('/api/comfyui/upload', {
    method: 'POST',
    body: formData,
  }, 'uploadImageToComfyUI', { includeContentType: false });
}

export async function processMaterial(
  imageFilename: string,
  workflowType: MaterialWorkflowType,
  entityOptions?: MaterialEntityOptions,
): Promise<{
  success: boolean;
  task_id: string;
  message: string;
}> {
  if (!getAuthToken()) {
    throw new Error('Not logged in.');
  }

  const explicitNodeId = entityOptions?.preferredAgentId || entityOptions?.preferredNodeId;
  const routing = await resolveGpuTaskRouting(
    explicitNodeId,
    explicitNodeId ? undefined : { automatic: true },
  );

  return apiJson<any>('/api/materials/process', {
    method: 'POST',
    body: JSON.stringify({
      image_filename: imageFilename,
      workflow_type: workflowType,
      entity_type: entityOptions?.entityType,
      entity_id: entityOptions?.entityId,
      file_role: entityOptions?.fileRole,
      episode_id: entityOptions?.episodeId,
      project_id: entityOptions?.projectId,
      target_long_edge: entityOptions?.targetLongEdge,
      dpi: entityOptions?.dpi,
      text_clarity: entityOptions?.textClarity ?? false,
      source_file_id: entityOptions?.sourceFileId,
      preferred_agent_id: entityOptions?.preferredAgentId || routing.preferredAgentId,
      preferred_node_id: entityOptions?.preferredNodeId || routing.preferredNodeId,
    }),
  }, 'processMaterial');
}
