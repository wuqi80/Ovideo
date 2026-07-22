import type { VideoReverseSegment, VideoReverseTask } from '../services/videoReverseService';

const clean = (value: unknown): string => String(value ?? '').trim();

const parseMetadata = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
export const getVideoReverseSourceTaskId = (script: any): string => {
  const metadata = parseMetadata(script?.metadata);
  return clean(metadata.source_reverse_task_id);
};

export const buildVideoReverseCandidateName = (task: VideoReverseTask): string => {
  const sourceName = clean(task.video_file_name || task.video_file_id)
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .slice(0, 48);
  return `视频反推 · ${sourceName || '未命名视频'}`;
};

export const buildVideoReverseCandidateMetadata = (task: VideoReverseTask) => ({
  source_type: 'video_reverse',
  source_reverse_task_id: task.reverse_task_id,
  source_video_file_id: task.video_file_id,
  source_video_name: task.video_file_name || '',
  source_duration_seconds: Number(task.duration_seconds || 0),
  source_credit_cost: Number(task.credit_cost || 0),
  source_completed_at: task.completed_at || task.updated_at || '',
});

export const buildVideoReverseCandidateScript = (
  task: VideoReverseTask,
  segments: VideoReverseSegment[],
): string => {
  const lines = [
    '【视频反推候选剧本】',
    `来源视频：${clean(task.video_file_name || task.video_file_id) || '未命名视频'}`,
    `反推任务：${task.reverse_task_id}`,
  ];

  if (clean(task.overall_prompt_zh)) {
    lines.push('', '【整体内容】', clean(task.overall_prompt_zh));
  }
  if (clean(task.overall_negative_prompt)) {
    lines.push('', '【生成限制】', clean(task.overall_negative_prompt));
  }

  const orderedSegments = [...segments].sort((a, b) => (
    Number(a.sort_order || 0) - Number(b.sort_order || 0)
  ));
  orderedSegments.forEach((segment, index) => {
    lines.push(
      '',
      `【镜头 ${String(index + 1).padStart(2, '0')}】`,
      `时间：${Number(segment.start_seconds || 0).toFixed(1)}s - ${Number(segment.end_seconds || 0).toFixed(1)}s`,
    );
    if (clean(segment.description)) lines.push(`画面描述：${clean(segment.description)}`);
    if (clean(segment.camera_description)) lines.push(`镜头语言：${clean(segment.camera_description)}`);
    if (clean(segment.motion_description)) lines.push(`镜头运动：${clean(segment.motion_description)}`);
    if (clean(segment.prompt_zh)) lines.push(`生成提示词：${clean(segment.prompt_zh)}`);
  });

  if (!clean(task.overall_prompt_zh) && orderedSegments.length === 0) return '';
  return lines.join('\n').trim();
};
