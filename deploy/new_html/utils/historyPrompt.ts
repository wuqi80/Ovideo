import type { EntityFile } from '../services/entityFileService';

export function getHistoryPromptText(
  file: Pick<EntityFile, 'fileRole' | 'metadata'>,
): string {
  const prompt = file.metadata?.prompt;
  if (typeof prompt === 'string' && prompt.trim()) {
    return prompt;
  }

  return file.fileRole === 'upscaled_image' ? '图片高清放大' : '';
}
