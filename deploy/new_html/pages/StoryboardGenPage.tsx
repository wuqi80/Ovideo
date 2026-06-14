import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEpisode } from '../contexts/EpisodeContext';
import { GenerationPage } from '../components/GenerationPage';
import {
  scriptToProjectFile,
  assetsToMaterialLibrary,
  storyboardItemToDbUpdate,
} from '../utils/episodeAdapters';
import { updateStoryboardItem, createStoryboardItem, deleteStoryboardItem } from '../services/apiService';
import { crmConfirm, crmMessage } from '../admin/crmUI';
import { fetchEntityFiles } from '../services/entityFileService';
import { useSelectFileMutation, useDeleteFileMutation } from '../hooks/useFilesMutation';
import { LayoutGrid, Loader, ChevronDown, ChevronRight, GripHorizontal } from 'lucide-react';
import { TimelineTrack, type TimelineClip } from '../components/TimelineTrack';
import type { StoryboardItem, FileVersion, GeneratedImage } from '../types';
import { usePersistedPageState } from '../hooks/usePersistedPageState';

function fmtTimeSimple(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const sec = ms / 1000;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const StoryboardGenPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    episodeId, projectId, selectedScriptId,
    script, storyboardItems, assets,
    isLoading, error, reload,
    loadSlices, forceReloadSlices,
  } = useEpisode();

  // 2026-06-14：进入分镜页强制刷新——loadSlices 对已加载 slice 会跳过，
  // 导致在「素材」改了人物绑定/在别处生成了新图后，跳到分镜仍显示会话缓存的旧数据
  //（用户反馈「导入到分镜始终只有这 8 个、没有新的」的真因）。改用 forceReload 拉最新。
  useEffect(() => {
    forceReloadSlices('storyboardItems', 'assets', 'script');
  }, [forceReloadSlices]);

  const pseudoFile = useMemo(
    () => scriptToProjectFile(script, storyboardItems, assets, episodeId),
    [script, storyboardItems, assets, episodeId]
  );

  const materialLibrary = useMemo(
    () => assetsToMaterialLibrary(assets),
    [assets]
  );

  const queryClient = useQueryClient();
  const selectFile = useSelectFileMutation();
  const deleteFile = useDeleteFileMutation();

  const localImagesRef = useRef<Record<string, GeneratedImage[]>>({});
  const [localImagesTick, setLocalImagesTick] = React.useState(0);

  const entityImageQueries = useQueries({
    queries: storyboardItems.map(item => ({
      queryKey: ['entityFiles', 'storyboard_item', item.itemId, 'generated_image'],
      queryFn: () => fetchEntityFiles('storyboard_item', item.itemId, 'generated_image'),
      staleTime: 30_000,
    })),
  });

  const entityImages = useMemo<Record<string, GeneratedImage[]>>(() => {
    const result: Record<string, GeneratedImage[]> = {};
    storyboardItems.forEach((item, idx) => {
      const data = entityImageQueries[idx]?.data;
      if (data?.items?.length) {
        result[item.itemId] = data.items.map(ef => ({
          id: ef.fileId,
          url: ef.fileUrl,
          thumbnail: ef.fileUrl,
          timestamp: new Date(ef.createdAt).getTime(),
          fileId: ef.fileId,
          isSelected: ef.isSelected,
        }));
      }
    });
    return result;
  }, [entityImageQueries, storyboardItems]);

  const handleUpdateStoryboardItem = useCallback(
    (shotId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => {
      const currentShot = pseudoFile.storyboard?.items.find(i => i.id === shotId);
      if (!currentShot) return;

      const resolvedUpdates = typeof updates === 'function'
        ? updates(currentShot)
        : updates;

      // 1. 立即更新本地缓存 → UI马上显示
      if (resolvedUpdates.generatedImages) {
        localImagesRef.current[shotId] = resolvedUpdates.generatedImages;
        setLocalImagesTick(t => t + 1);
        queryClient.invalidateQueries({
          queryKey: ['entityFiles', 'storyboard_item', shotId, 'generated_image'],
        });
      }

      // 2. 选中图片 → 更新DB
      const dbUpdates = storyboardItemToDbUpdate(resolvedUpdates);

      // 🛡️ 写入白名单：generated_image_url 必须是持久化 URL（http / 站内 /storage、/api/files），
      // 拒绝 data:/blob:（base64 内联或临时 sandbox URL，前者会撑爆 DB 字段并触发下游 414，
      // 后者刷新即失效）。详见 docs/faq.md 同名条目 + docs/conventions.md § Data URL Prohibition。
      const isPersistentUrl = (u: string | undefined | null): boolean => {
        if (!u) return false;
        if (u.startsWith('data:')) return false;
        if (u.startsWith('blob:')) return false;
        return u.startsWith('http') || u.startsWith('/');
      };

      let pickedUrl: string | undefined;
      let pickedSource: string = '';
      if (resolvedUpdates.selectedImageId) {
        const allImages = resolvedUpdates.generatedImages || entityImages[shotId] || [];
        const selected = allImages.find(img => img.id === resolvedUpdates.selectedImageId);
        if (selected) {
          pickedUrl = selected.url;
          pickedSource = `selected(id=${selected.id})`;
          if (selected.fileId) {
            selectFile.mutate({
              fileId: selected.fileId,
              entityType: 'storyboard_item',
              entityId: shotId,
              fileRole: 'generated_image',
            });
          }
        }
      } else if (resolvedUpdates.generatedImages?.length) {
        const last = resolvedUpdates.generatedImages[resolvedUpdates.generatedImages.length - 1];
        pickedUrl = last.url;
        pickedSource = `last(id=${last.id})`;
      }

      if (pickedUrl !== undefined) {
        if (isPersistentUrl(pickedUrl)) {
          dbUpdates.generated_image_url = pickedUrl;
        } else {
          console.warn(
            '[StoryboardGenPage] 拒绝把非持久化 URL 写入 generated_image_url',
            { shotId, source: pickedSource, sample: (pickedUrl || '').slice(0, 60) }
          );
        }
      }

      if (Object.keys(dbUpdates).length > 0) {
        updateStoryboardItem(shotId, dbUpdates).catch(err => {
          console.error('更新分镜失败:', err);
        });
      }
    },
    [pseudoFile, entityImages, queryClient, selectFile],
  );

  const handleExportNext = useCallback(
    (_data: any) => {
      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/video`);
    },
    [navigate, projectId, episodeId]
  );

  const handleForceSave = useCallback(() => {
    reload();
  }, [reload]);

  // 2026-06-14：删除分镜镜头（列表项垃圾桶按钮）
  const handleDeleteStoryboardItem = useCallback(async (itemId: string) => {
    if (!await crmConfirm({ title: '删除镜头', message: '确认删除这个分镜镜头？此操作不可撤销。', type: 'danger', confirmText: '删除' })) return;
    try {
      await deleteStoryboardItem(itemId);
      crmMessage.success('已删除镜头');
      await forceReloadSlices('storyboardItems');
    } catch (e: any) {
      crmMessage.error(`删除失败：${e?.message || e}`);
    }
  }, [forceReloadSlices]);

  const noopSaveVersion = useCallback((_name: string) => {}, []);
  const noopRestoreVersion = useCallback((_v: FileVersion) => {}, []);
  const noopDeleteVersion = useCallback((_id: string) => {}, []);
  const noopImportProject = useCallback(() => {}, []);

  const enhancedFile = useMemo(() => {
    if (!pseudoFile.storyboard) return pseudoFile;
    const enhancedItems = pseudoFile.storyboard.items.map(item => {
      const dbImages = entityImages[item.id];
      const localImages = localImagesRef.current[item.id];

      if (dbImages && dbImages.length > 0 && localImages && dbImages.length >= localImages.length) {
        delete localImagesRef.current[item.id];
      }

      // 合并所有来源（去重）：DB + 本地缓存 + pseudoFile 的 generatedImageUrl
      const urlSet = new Set<string>();
      const images: GeneratedImage[] = [];

      const addImage = (img: GeneratedImage) => {
        if (img.url && !urlSet.has(img.url)) {
          urlSet.add(img.url);
          images.push(img);
        }
      };

      // 优先级1：DB entity files
      if (dbImages) dbImages.forEach(addImage);
      // 优先级2：本地缓存（新生成但 DB 还没同步的）
      if (localImages) localImages.forEach(addImage);
      // 优先级3：pseudoFile 中的 generatedImageUrl（历史兜底）
      if (item.generatedImage) {
        addImage({ id: `legacy_${item.id}`, url: item.generatedImage, timestamp: 0 });
      }

      if (images.length === 0) return item;
      const selected = images.find(img => (img as any).isSelected) || images[0];
      return {
        ...item,
        generatedImages: images,
        selectedImageId: selected.id,
        generatedImage: selected.url,
      };
    });
    return {
      ...pseudoFile,
      storyboard: { ...pseudoFile.storyboard, items: enhancedItems },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pseudoFile, entityImages, localImagesTick]);

  const timelineClips: TimelineClip[] = useMemo(() => {
    const sorted = [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder);
    const result: TimelineClip[] = [];
    let cursorMs = 0;
    for (const item of sorted) {
      const hasImage = !!item.generatedImageUrl;
      const hasAudio = !!(item.dialogueAudioUrl || item.narrationAudioUrl);
      if (!hasImage && !hasAudio) continue;
      const durMs = item.audioDurationMs || 3000;

      if (hasImage) {
        const imgUrl = item.generatedImageUrl!.startsWith('/') ? item.generatedImageUrl! : `/${item.generatedImageUrl}`;
        result.push({
          id: `img_${item.itemId}`,
          label: item.sceneHeading || `#${item.sortOrder}`,
          track: 'image',
          imageUrl: imgUrl,
          durationMs: durMs,
          startMs: cursorMs,
        });
      }
      if (item.dialogueAudioUrl) {
        const audioUrl = item.dialogueAudioUrl.startsWith('/') ? item.dialogueAudioUrl : `/${item.dialogueAudioUrl}`;
        result.push({
          id: `dlg_${item.itemId}`,
          label: (item.dialogue || '').slice(0, 20) || '台词',
          track: 'dialogue',
          audioUrl,
          durationMs: durMs,
          startMs: cursorMs,
        });
      }
      if (item.narrationAudioUrl) {
        const audioUrl = item.narrationAudioUrl.startsWith('/') ? item.narrationAudioUrl : `/${item.narrationAudioUrl}`;
        result.push({
          id: `nar_${item.itemId}`,
          label: (item.dialogue || '').slice(0, 20) || '旁白',
          track: 'narration',
          audioUrl,
          durationMs: durMs,
          startMs: cursorMs,
        });
      }
      cursorMs += durMs;
    }
    return result;
  }, [storyboardItems]);

  const timelineTotalMs = useMemo(
    () => timelineClips.reduce((m, c) => Math.max(m, c.startMs + c.durationMs), 0),
    [timelineClips],
  );

  const showTimeline = timelineClips.length > 0;
  const [timelinePanel, setTimelinePanel] = usePersistedPageState<{ collapsed: boolean; heightPx: number }>({
    page: 'StoryboardGenPage:timelinePanel',
    episodeId: 'global', // 面板尺寸是全局视觉偏好，不按剧集隔离
    version: 1,
    defaultValue: { collapsed: false, heightPx: 260 },
  });
  const timelineCollapsed = timelinePanel.collapsed;
  const setTimelineCollapsed = useCallback(
    (updater: boolean | ((c: boolean) => boolean)) =>
      setTimelinePanel(p => ({
        ...p,
        collapsed: typeof updater === 'function' ? (updater as (c: boolean) => boolean)(p.collapsed) : updater,
      })),
    [setTimelinePanel],
  );
  const [isTimelineResizing, setIsTimelineResizing] = React.useState(false);

  const startTimelineResize = useCallback(() => {
    setIsTimelineResizing(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isTimelineResizing) return;
    const onMove = (e: MouseEvent) => {
      // 时间轴贴在底部：面板高度 = 视口底部 - 鼠标 Y，clamp 到 [140, 70vh]
      const raw = Math.round(window.innerHeight - e.clientY);
      const clamped = Math.max(140, Math.min(raw, Math.round(window.innerHeight * 0.7)));
      setTimelinePanel(p => ({ ...p, heightPx: clamped }));
    };
    const onUp = () => {
      setIsTimelineResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isTimelineResizing, setTimelinePanel]);

  const durationWarnings = useMemo(() =>
    storyboardItems.filter(i => i.plannedDurationMs && i.audioDurationMs && i.audioDurationMs > i.plannedDurationMs),
    [storyboardItems],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-n300">
        <div className="animate-pulse flex items-center gap-2">
          <Loader className="w-5 h-5 animate-spin" />
          <span>加载分镜数据...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-danger p-6">
        <p>{error}</p>
      </div>
    );
  }

  if (!pseudoFile.storyboard || pseudoFile.storyboard.items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-n300">
        <div className="text-center space-y-3">
          <LayoutGrid className="w-12 h-12 mx-auto text-primary" />
          <p className="text-xl font-medium text-n700">分镜画面生成</p>
          <p className="text-sm text-n100">暂无分镜数据，请先在剧本页面创建分镜</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {durationWarnings.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-n30 border-b border-n40 text-warning text-sm flex items-center gap-2">
          <span>⚠ {durationWarnings.length} 个镜头的音频时长超过设计时长</span>
          <span className="text-xs text-warning ml-2">
            {durationWarnings.map(i => `#${i.sortOrder}: 音频${((i.audioDurationMs || 0) / 1000).toFixed(1)}s/设计${((i.plannedDurationMs || 0) / 1000).toFixed(1)}s`).join(' | ')}
          </span>
        </div>
      )}
      <div className={showTimeline ? 'flex-1 min-h-0 overflow-auto' : 'h-full'}>
        <GenerationPage
          files={[enhancedFile]}
          selectedFileId={episodeId}
          episodeId={episodeId}
          materialLibrary={materialLibrary}
          onUpdateStoryboardItem={handleUpdateStoryboardItem}
          onDeleteStoryboardItem={handleDeleteStoryboardItem}
          onSaveVersion={noopSaveVersion}
          onRestoreVersion={noopRestoreVersion}
          onDeleteVersion={noopDeleteVersion}
          onForceSave={handleForceSave}
          onExportNext={handleExportNext}
          onImportProject={noopImportProject}
        />
      </div>
      {showTimeline && (
        <div className="shrink-0 border-t border-n40 bg-n20 relative">
          {/* 拖拽手柄：仅展开时可调高度 */}
          {!timelineCollapsed && (
            <div
              onMouseDown={startTimelineResize}
              className="absolute -top-1.5 left-0 right-0 h-3 flex items-center justify-center cursor-row-resize group z-10"
              title="拖动调整时间轴高度"
            >
              <div className="w-12 h-1 rounded-full bg-n0 group-hover:bg-primary transition-colors flex items-center justify-center">
                <GripHorizontal className="w-3 h-3 text-n100 opacity-0 group-hover:opacity-100" />
              </div>
            </div>
          )}
          <div
            className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-n20 transition-colors"
            onClick={() => setTimelineCollapsed(c => !c)}
          >
            <h4 className="text-xs font-bold text-n100 uppercase tracking-wider flex items-center gap-2">
              {timelineCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              图 + 音联合时间轴
            </h4>
            <span className="text-[10px] text-n100">
              {fmtTimeSimple(timelineTotalMs)} | {timelineClips.filter(c => c.track === 'image').length} 个镜头
            </span>
          </div>
          {!timelineCollapsed && (
            <div className="px-4 pb-4 overflow-y-auto" style={{ height: timelinePanel.heightPx }}>
              <TimelineTrack mode="combined" clips={timelineClips} totalDurationMs={timelineTotalMs} showPreview />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
