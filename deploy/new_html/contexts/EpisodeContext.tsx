import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  getEpisodeScript,
  getStoryboardItems,
  getAssets,
  getAudioTracks,
  getVideoSegments,
  getCharacterVoices,
  updateStoryboardItem as apiUpdateStoryboardItem,
  updateEpisodeScript as apiUpdateEpisodeScript,
  batchCreateStoryboardItems as apiBatchCreateStoryboardItems,
  extractToAssets as apiExtractToAssets,
} from '../services/apiService';
import type { AssetItem, StoryboardItemDB, VideoSegment, AudioTrack, EpisodeScript, CharacterVoice } from '../types';

/* ============ snake_case → camelCase 规范化 ============ */

function safeArr(v: unknown): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {} }
  return [];
}
function safeObj(v: unknown): Record<string, any> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, any>;
  if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') return p; } catch {} }
  return {};
}

function normalizeStoryboardItem(r: any): StoryboardItemDB {
  return {
    itemId: r.item_id ?? r.itemId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    sceneHeading: r.scene_heading ?? r.sceneHeading ?? '',
    actionText: r.action_text ?? r.actionText ?? '',
    dialogue: r.dialogue ?? '',
    cameraMovement: r.camera_movement ?? r.cameraMovement ?? '',
    imagePrompt: r.image_prompt ?? r.imagePrompt ?? '',
    videoPrompt: r.video_prompt ?? r.videoPrompt ?? '',
    generatedImageUrl: r.generated_image_url ?? r.generatedImageUrl ?? null,
    boundAssets: safeArr(r.bound_assets ?? r.boundAssets),
    status: r.status ?? 'draft',
    dialogueAudioUrl: r.dialogue_audio_url ?? r.dialogueAudioUrl ?? null,
    narrationAudioUrl: r.narration_audio_url ?? r.narrationAudioUrl ?? null,
    sfxAudioUrl: r.sfx_audio_url ?? r.sfxAudioUrl ?? null,
    audioDurationMs: r.audio_duration_ms ?? r.audioDurationMs ?? null,
    plannedDurationMs: r.planned_duration_ms ?? r.plannedDurationMs ?? null,
  };
}

function normalizeAsset(r: any): AssetItem {
  return {
    assetId: String(r.asset_id ?? r.assetId ?? ''),
    projectId: String(r.project_id ?? r.projectId ?? ''),
    episodeId: r.episode_id ?? r.episodeId ?? null,
    assetType: (r.asset_type ?? r.assetType ?? 'character') as AssetItem['assetType'],
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    thumbnailUrl: r.thumbnail_url ?? r.thumbnailUrl ?? null,
    referenceImages: safeArr(r.reference_images ?? r.referenceImages),
    styleParams: safeObj(r.style_params ?? r.styleParams),
    tags: safeArr(r.tags),
    entityFiles: Array.isArray(r.entity_files)
      ? r.entity_files.map((f: any) => ({
          fileId: String(f.file_id ?? f.fileId ?? ''),
          fileUrl: String(f.file_url ?? f.fileUrl ?? ''),
          fileType: String(f.file_type ?? f.fileType ?? ''),
          fileRole: String(f.file_role ?? f.fileRole ?? ''),
          isSelected: !!(f.is_selected ?? f.isSelected),
          createdAt: String(f.created_at ?? f.createdAt ?? ''),
        }))
      : [],
    createdBy: String(r.created_by ?? r.createdBy ?? ''),
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
  };
}

function normalizeVideoSegment(r: any): VideoSegment {
  return {
    segmentId: r.segment_id ?? r.segmentId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    storyboardItemId: r.storyboard_item_id ?? r.storyboardItemId ?? null,
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    generationMode: r.generation_mode ?? r.generationMode ?? '',
    model: r.model ?? '',
    inputParams: safeObj(r.input_params ?? r.inputParams),
    videoUrl: r.video_url ?? r.videoUrl ?? null,
    thumbnailUrl: r.thumbnail_url ?? r.thumbnailUrl ?? null,
    durationMs: r.duration_ms ?? r.durationMs ?? null,
    taskId: r.task_id ?? r.taskId ?? null,
    status: r.status ?? 'pending',
  };
}

function normalizeAudioTrack(r: any): AudioTrack {
  return {
    trackId: r.track_id ?? r.trackId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    trackType: r.track_type ?? r.trackType ?? 'bgm',
    name: r.name ?? '',
    audioUrl: r.audio_url ?? r.audioUrl ?? null,
    durationMs: r.duration_ms ?? r.durationMs ?? null,
    startItemId: r.start_item_id ?? r.startItemId ?? null,
    endItemId: r.end_item_id ?? r.endItemId ?? null,
    generationParams: safeObj(r.generation_params ?? r.generationParams),
  };
}

function normalizeEpisodeScript(r: any): EpisodeScript {
  return {
    scriptId: r.script_id ?? r.scriptId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    originalContent: r.original_content ?? r.originalContent ?? '',
    adaptedScript: r.adapted_script ?? r.adaptedScript ?? '',
    metadata: safeObj(r.metadata),
  };
}

function normalizeCharacterVoice(r: any): CharacterVoice {
  return {
    voiceId: r.voice_id ?? r.voiceId ?? '',
    projectId: r.project_id ?? r.projectId ?? '',
    assetId: r.asset_id ?? r.assetId ?? null,
    characterName: r.character_name ?? r.characterName ?? '',
    voiceProvider: r.voice_provider ?? r.voiceProvider ?? null,
    voiceModelId: r.voice_model_id ?? r.voiceModelId ?? null,
    voiceName: r.voice_name ?? r.voiceName ?? null,
    voiceParams: safeObj(r.voice_params ?? r.voiceParams),
    sampleAudioUrl: r.sample_audio_url ?? r.sampleAudioUrl ?? null,
    createdAt: r.created_at ?? r.createdAt ?? '',
    updatedAt: r.updated_at ?? r.updatedAt ?? '',
  };
}

export type DataSlice = 'script' | 'storyboardItems' | 'assets' | 'audioTracks' | 'videoSegments' | 'characterVoices';

interface EpisodeContextValue {
  episodeId: string;
  projectId: string;
  selectedScriptId: string | null;
  setSelectedScriptId: (id: string | null) => void;
  isLoading: boolean;
  error: string | null;
  script: EpisodeScript | null;
  storyboardItems: StoryboardItemDB[];
  assets: AssetItem[];
  audioTracks: AudioTrack[];
  videoSegments: VideoSegment[];
  characterVoices: CharacterVoice[];
  loadSlices: (...slices: DataSlice[]) => Promise<void>;
  forceReloadSlices: (...slices: DataSlice[]) => Promise<void>;
  reload: () => Promise<void>;
  updateStoryboardDuration: (itemId: string, durationMs: number) => Promise<void>;
  saveScript: (data: { original_content?: string; adapted_script?: string; metadata?: Record<string, any> }) => Promise<void>;
  saveStoryboardItem: (itemId: string, data: Record<string, any>) => Promise<void>;
  createStoryboardItems: (items: any[]) => Promise<void>;
  extractToAssets: (characters: any[], scenes: any[]) => Promise<void>;
}

const EpisodeContext = createContext<EpisodeContextValue>({
  episodeId: '',
  projectId: '',
  selectedScriptId: null,
  setSelectedScriptId: () => {},
  isLoading: false,
  error: null,
  script: null,
  storyboardItems: [],
  assets: [],
  audioTracks: [],
  videoSegments: [],
  characterVoices: [],
  loadSlices: async () => {},
  forceReloadSlices: async () => {},
  reload: async () => {},
  updateStoryboardDuration: async () => {},
  saveScript: async () => {},
  saveStoryboardItem: async () => {},
  createStoryboardItems: async () => {},
  extractToAssets: async () => {},
});

export const useEpisode = () => useContext(EpisodeContext);

interface EpisodeProviderProps {
  children: React.ReactNode;
  projectId?: string;
  episodeId?: string;
}

export const EpisodeProvider: React.FC<EpisodeProviderProps> = ({ children, projectId: propProjectId, episodeId: propEpisodeId }) => {
  const params = useParams<{ projectId: string; episodeId: string }>();
  const projectId = propProjectId || params.projectId || '';
  const episodeId = propEpisodeId || params.episodeId || '';

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [script, setScript] = useState<EpisodeScript | null>(null);
  const [storyboardItems, setStoryboardItems] = useState<StoryboardItemDB[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [videoSegments, setVideoSegments] = useState<VideoSegment[]>([]);
  const [characterVoices, setCharacterVoices] = useState<CharacterVoice[]>([]);

  const loadedSlicesRef = useRef<Set<DataSlice>>(new Set());
  const selectedScriptIdRef = useRef<string | null>(null);
  selectedScriptIdRef.current = selectedScriptId;

  const fetchSlices = useCallback(async (...slices: DataSlice[]) => {
    if (!episodeId || slices.length === 0) return;
    setIsLoading(true);
    setError(null);

    slices.forEach(s => loadedSlicesRef.current.add(s));

    const loaders: Record<DataSlice, () => Promise<void>> = {
      script: async () => {
        const res = await getEpisodeScript(episodeId).catch(() => ({ success: false, script: null }));
        if (res.success && res.script) setScript(normalizeEpisodeScript(res.script));
      },
      storyboardItems: async () => {
        const sid = selectedScriptIdRef.current || undefined;
        const res = await getStoryboardItems(episodeId, sid).catch(() => ({ success: false, items: [] }));
        if (res.success) setStoryboardItems((res.items || []).map(normalizeStoryboardItem));
      },
      assets: async () => {
        const sid = selectedScriptIdRef.current || undefined;
        const res = await getAssets(projectId, episodeId, undefined, sid).catch(() => ({ success: false, assets: [] }));
        if (res.success) setAssets((res.assets || []).map(normalizeAsset));
      },
      audioTracks: async () => {
        const res = await getAudioTracks(episodeId).catch(() => ({ success: false, tracks: [] }));
        if (res.success) setAudioTracks((res.tracks || []).map(normalizeAudioTrack));
      },
      videoSegments: async () => {
        const res = await getVideoSegments(episodeId).catch(() => ({ success: false, segments: [] }));
        if (res.success) setVideoSegments((res.segments || []).map(normalizeVideoSegment));
      },
      characterVoices: async () => {
        const res = await getCharacterVoices(projectId).catch((e) => {
          console.warn('character_voices 加载失败:', e);
          return { success: false, voices: [] };
        });
        if (res.success && Array.isArray(res.voices)) {
          setCharacterVoices(res.voices.map(normalizeCharacterVoice));
        } else {
          setCharacterVoices([]);
        }
      },
    };

    try {
      await Promise.all(slices.map(s => loaders[s]()));
    } catch (e: any) {
      setError(e.message || '加载集数据失败');
    } finally {
      setIsLoading(false);
    }
  }, [episodeId, projectId]);

  const loadSlices = useCallback(async (...slices: DataSlice[]) => {
    const newSlices = slices.filter(s => !loadedSlicesRef.current.has(s));
    if (newSlices.length === 0) return;
    await fetchSlices(...newSlices);
  }, [fetchSlices]);

  const reload = useCallback(async () => {
    const slices = Array.from(loadedSlicesRef.current) as DataSlice[];
    if (slices.length > 0) {
      await fetchSlices(...slices);
    }
  }, [fetchSlices]);

  useEffect(() => {
    loadedSlicesRef.current.clear();
    prevScriptIdRef.current = null;
    setSelectedScriptId(null);
    setScript(null);
    setStoryboardItems([]);
    setAssets([]);
    setAudioTracks([]);
    setVideoSegments([]);
    setCharacterVoices([]);
    setIsLoading(false);
  }, [episodeId]);

  const prevScriptIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedScriptId) return;
    if (prevScriptIdRef.current === null) {
      prevScriptIdRef.current = selectedScriptId;
      return;
    }
    if (prevScriptIdRef.current === selectedScriptId) return;
    prevScriptIdRef.current = selectedScriptId;
    const slicesToReload: DataSlice[] = [];
    if (loadedSlicesRef.current.has('storyboardItems')) slicesToReload.push('storyboardItems');
    if (loadedSlicesRef.current.has('assets')) slicesToReload.push('assets');
    if (slicesToReload.length > 0) {
      fetchSlices(...slicesToReload);
    }
  }, [selectedScriptId, fetchSlices]);

  const updateStoryboardDuration = useCallback(async (itemId: string, durationMs: number) => {
    try {
      await apiUpdateStoryboardItem(itemId, { audio_duration_ms: durationMs });
      setStoryboardItems(prev =>
        prev.map(item =>
          item.itemId === itemId ? { ...item, audioDurationMs: durationMs } : item
        )
      );
    } catch (e: any) {
      console.error('Failed to update storyboard duration:', e);
    }
  }, []);

  const saveScript = useCallback(async (data: { original_content?: string; adapted_script?: string; metadata?: Record<string, any> }) => {
    try {
      await apiUpdateEpisodeScript(episodeId, data);
      await reload();
    } catch (e: any) {
      console.error('Failed to save script:', e);
    }
  }, [episodeId, reload]);

  const saveStoryboardItem = useCallback(async (itemId: string, data: Record<string, any>) => {
    try {
      await apiUpdateStoryboardItem(itemId, data);
      setStoryboardItems(prev =>
        prev.map(item => item.itemId === itemId ? { ...item, ...data } : item)
      );
    } catch (e: any) {
      console.error('Failed to save storyboard item:', e);
    }
  }, []);

  const createStoryboardItems = useCallback(async (items: any[]) => {
    try {
      await apiBatchCreateStoryboardItems(episodeId, items, selectedScriptIdRef.current || undefined);
      await reload();
    } catch (e: any) {
      console.error('Failed to batch create storyboard items:', e);
    }
  }, [episodeId, reload]);

  const extractToAssetsFn = useCallback(async (characters: any[], scenes: any[]) => {
    try {
      await apiExtractToAssets(episodeId, characters, scenes, selectedScriptIdRef.current || undefined);
      await reload();
    } catch (e: any) {
      console.error('Failed to extract to assets:', e);
    }
  }, [episodeId, reload]);

  const filteredVideoSegments = useMemo(() => {
    if (!selectedScriptId) return videoSegments;
    if (storyboardItems.length === 0) return [];
    const sbItemIds = new Set(storyboardItems.map(si => si.itemId));
    return videoSegments.filter(seg => {
      const sbItemId = seg.storyboardItemId ?? (seg as any).storyboard_item_id;
      return sbItemId && sbItemIds.has(sbItemId);
    });
  }, [videoSegments, storyboardItems, selectedScriptId]);

  return (
    <EpisodeContext.Provider value={{
      episodeId,
      projectId,
      selectedScriptId,
      setSelectedScriptId,
      isLoading,
      error,
      script,
      storyboardItems,
      assets,
      audioTracks,
      videoSegments: filteredVideoSegments,
      characterVoices,
      loadSlices,
      forceReloadSlices: fetchSlices,
      reload,
      updateStoryboardDuration,
      saveScript,
      saveStoryboardItem,
      createStoryboardItems,
      extractToAssets: extractToAssetsFn,
    }}>
      {children}
    </EpisodeContext.Provider>
  );
};
