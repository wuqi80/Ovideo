import { useMemo } from 'react';
import type { SeedanceParams } from '../services/videoService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { buildCandidates } from '../utils/seedanceCandidateBuilder';
import { useEpisode } from '../contexts/EpisodeContext';
import { useEntityFilesQuery } from './useEntityFilesQuery';

export interface UseSeedanceCandidatesProps {
    currentParams: SeedanceParams;
    /** Optional. When provided, storyboard_data and audio candidates are
     *  filtered to this item only. Pass undefined for upload-only cards. */
    currentStoryboardItemId?: string;
    /** Optional history-videos slice. If absent, derived from EpisodeContext.videoSegments. */
    historyVideos?: any[];
}

export interface UseSeedanceCandidatesResult {
    candidates: SeedanceAssetCandidate[];
    isLoading: boolean;
}

// Hoisted stable empty-array constants so that fallbacks for missing context
// slices don't break referential equality across renders (memo test relies on this).
const EMPTY_ASSETS: any[] = [];
const EMPTY_AUDIO: any[] = [];
const EMPTY_VIDEO: any[] = [];
const EMPTY_STORYBOARD: any[] = [];
const EMPTY_FILES: any[] = [];

export function useSeedanceCandidates(p: UseSeedanceCandidatesProps): UseSeedanceCandidatesResult {
    const ep = useEpisode();
    const ufQuery = useEntityFilesQuery('episode', ep.episodeId || null);

    const materialLibrary = useMemo(() => {
        const toLibItem = (a: any) => {
            const url = a.thumbnailUrl
                || a.entityFiles?.find((f: any) => f.fileRole === 'reference_image')?.fileUrl
                || a.entityFiles?.[0]?.fileUrl
                || a.referenceImages?.[0]
                || '';
            return { id: a.assetId, name: a.name, currentVersion: { url } };
        };
        const toAudioLibItem = (t: any) => ({
            id: t.trackId || t.id || t.audioTrackId,
            name: t.name || t.title || '音轨',
            currentVersion: {
                url: t.audioUrl || t.url || '',
                durationMs: t.durationMs,
            },
        });
        const assets = ep.assets ?? EMPTY_ASSETS;
        const audioTracks = ep.audioTracks ?? EMPTY_AUDIO;
        return {
            characters: assets.filter((a: any) => a.assetType === 'character').map(toLibItem),
            scenes:     assets.filter((a: any) => a.assetType === 'scene').map(toLibItem),
            props:      assets.filter((a: any) => a.assetType === 'prop').map(toLibItem),
            audio:      audioTracks.map(toAudioLibItem),
        };
    }, [ep.assets, ep.audioTracks]);

    const historyVideosResolved = useMemo(() => {
        if (p.historyVideos) return p.historyVideos;
        const segs = ep.videoSegments ?? EMPTY_VIDEO;
        return segs.map((v: any) => ({
            id: v.segmentId || v.id,
            url: v.videoUrl || v.url || '',
            label: v.label || v.name || `镜头 ${v.sortOrder ?? ''}`.trim(),
            durationMs: v.durationMs,
        }));
    }, [p.historyVideos, ep.videoSegments]);

    const userFilesAdapted = useMemo(() => {
        const items = ufQuery.data?.items ?? EMPTY_FILES;
        return items.map((f: any) => ({
            id: f.fileId || f.entityFileId || f.id || f.fileUrl,
            file_url: f.fileUrl,
            file_name: f.fileName,
            mime_type: f.fileType || f.mimeType,
        }));
    }, [ufQuery.data]);

    const storyboardItems = ep.storyboardItems ?? EMPTY_STORYBOARD;

    // 2026-05-20 (Bug 3a)：把 EpisodeContext 的 characterVoices + audioTracks 直接喂给 builder。
    // 这两个数据源是 episode/project 级目录资源，无视分镜 scope；buildCandidates 内部
    // 决定 scope 行为（参见 seedanceCandidateBuilder.ts § 4b/4c）。
    const characterVoices = (ep as any).characterVoices ?? EMPTY_AUDIO;
    const audioTracksAll  = (ep as any).audioTracks     ?? EMPTY_AUDIO;

    const candidates = useMemo<SeedanceAssetCandidate[]>(
        () => buildCandidates({
            currentParams: p.currentParams,
            currentStoryboardItemId: p.currentStoryboardItemId,
            materialLibrary,
            storyboardItems,
            historyVideos: historyVideosResolved,
            userFiles: userFilesAdapted,
            characterVoices,
            audioTracks: audioTracksAll,
        }),
        [p.currentParams, p.currentStoryboardItemId, materialLibrary, storyboardItems, historyVideosResolved, userFilesAdapted, characterVoices, audioTracksAll],
    );

    return { candidates, isLoading: !!ufQuery.isLoading };
}
