import type { ProjectFile, ScriptSegment, StoryboardItem } from '../types';

/**
 * 从已持久化的数据（分段 / 改编稿 / 分镜行）反推三步生成的阶段完成状态。
 *
 * 重新进入剧本时，generationStages 这个运行态不会从后端带回来。如果不重建，
 * 三步生成的阶段徽章会全部显示「未开始」，用户误以为要重新生成（测试问题 A.2-2）。
 * 判定口径与主按钮 handleRunThreeStagePipeline 的 hasSegments/hasVideoScript/
 * hasStoryboard 保持一致：
 *   - split：存在任意分段
 *   - videoScript：有改编稿且所有分段都已生成 videoScript
 *   - storyboardPrompt：存在带 imagePrompt 的分镜行
 */
export function deriveScriptStagesFromPersisted(
  segments: ScriptSegment[],
  scriptContent: string | null,
  storyboardItems: StoryboardItem[],
): ProjectFile['generationStages'] | undefined {
  const segCount = segments.length;
  const segsWithVideo = segments.filter(s => s.videoScript).length;
  const itemsWithPrompt = storyboardItems.filter(i => i.imagePrompt).length;

  const splitDone = segCount > 0;
  const videoDone = !!scriptContent && segCount > 0 && segsWithVideo === segCount;
  const storyboardDone = itemsWithPrompt > 0;

  if (!splitDone && !videoDone && !storyboardDone) return undefined;

  const stages: NonNullable<ProjectFile['generationStages']> = {};
  if (splitDone) {
    stages.split = { status: 'done', total: segCount, completed: segCount };
  }
  if (videoDone) {
    stages.videoScript = { status: 'done', total: segCount, completed: segsWithVideo };
  }
  if (storyboardDone) {
    stages.storyboardPrompt = { status: 'done', total: storyboardItems.length, completed: itemsWithPrompt };
  }
  return stages;
}
