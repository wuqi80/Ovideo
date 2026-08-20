export const CREATE_IDEA_STORAGE_KEY = 'create:idea';

export interface CreateIdeaSeed {
  sentence: string;
  genre: string;
  duration: string;
  projectId: string;
  episodeId: string;
}

type CreateIdeaStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveCreateIdeaSeed(storage: CreateIdeaStorage, seed: CreateIdeaSeed): void {
  storage.setItem(CREATE_IDEA_STORAGE_KEY, JSON.stringify(seed));
}

export function readCreateIdeaSeed(
  storage: Pick<CreateIdeaStorage, 'getItem'>,
  episodeId: string,
): CreateIdeaSeed | null {
  const raw = storage.getItem(CREATE_IDEA_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CreateIdeaSeed>;
    const sentence = typeof parsed.sentence === 'string' ? parsed.sentence.trim() : '';
    if (!sentence) return null;
    if (parsed.episodeId && parsed.episodeId !== episodeId) return null;
    return {
      sentence,
      genre: typeof parsed.genre === 'string' ? parsed.genre : '',
      duration: typeof parsed.duration === 'string' ? parsed.duration : '',
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : '',
      episodeId: typeof parsed.episodeId === 'string' ? parsed.episodeId : episodeId,
    };
  } catch {
    return null;
  }
}

export function clearCreateIdeaSeed(storage: Pick<CreateIdeaStorage, 'removeItem'>): void {
  storage.removeItem(CREATE_IDEA_STORAGE_KEY);
}
