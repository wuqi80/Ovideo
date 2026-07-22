import { describe, expect, it } from 'vitest';
import type { VideoReverseSegment, VideoReverseTask } from '../../services/videoReverseService';
import {
  buildVideoReverseCandidateMetadata,
  buildVideoReverseCandidateName,
  buildVideoReverseCandidateScript,
  getVideoReverseSourceTaskId,
} from '../../utils/videoReverseCandidate';

const task = {
  reverse_task_id: 'reverse_1',
  video_file_id: 'file_1',
  video_file_name: 'sample.mp4',
  duration_seconds: 8.5,
  credit_cost: 20,
  overall_prompt_zh: '两个人在办公室交谈。',
  overall_negative_prompt: '不要字幕。',
  completed_at: '2026-07-19T10:00:00Z',
  updated_at: '2026-07-19T10:00:00Z',
} as VideoReverseTask;

const segments = [
  {
    segment_id: 'seg_2',
    sort_order: 2,
    start_seconds: 4,
    end_seconds: 8.5,
    description: '机器人回答。',
    prompt_zh: '机器人近景。',
  },
  {
    segment_id: 'seg_1',
    sort_order: 1,
    start_seconds: 0,
    end_seconds: 4,
    description: '主角提问。',
    camera_description: '中景',
    motion_description: '缓慢推进',
    prompt_zh: '主角坐在桌边。',
  },
] as VideoReverseSegment[];

describe('video reverse candidate helpers', () => {
  it('builds an ordered, editable candidate script', () => {
    const result = buildVideoReverseCandidateScript(task, segments);
    expect(result).toContain('【视频反推候选剧本】');
    expect(result).toContain('来源视频：sample.mp4');
    expect(result.indexOf('主角提问')).toBeLessThan(result.indexOf('机器人回答'));
    expect(result).toContain('镜头语言：中景');
    expect(result).toContain('生成提示词：主角坐在桌边。');
  });

  it('keeps source identity for idempotent imports', () => {
    expect(buildVideoReverseCandidateName(task)).toBe('视频反推 · sample');
    expect(buildVideoReverseCandidateMetadata(task)).toMatchObject({
      source_type: 'video_reverse',
      source_reverse_task_id: 'reverse_1',
      source_video_file_id: 'file_1',
      source_credit_cost: 20,
    });
    expect(getVideoReverseSourceTaskId({
      metadata: JSON.stringify({ source_reverse_task_id: 'reverse_1' }),
    })).toBe('reverse_1');
  });

  it('does not create an empty candidate', () => {
    expect(buildVideoReverseCandidateScript({
      ...task,
      overall_prompt_zh: '',
      overall_negative_prompt: '',
    }, [])).toBe('');
  });
});
