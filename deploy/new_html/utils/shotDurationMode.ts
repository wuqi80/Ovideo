export type ShotDurationMode = 'fragmented' | 'complete';

export const DEFAULT_SHOT_DURATION_MODE: ShotDurationMode = 'complete';

export const SHOT_DURATION_MODE_STORAGE_KEY = 'drama:script-shot-duration-mode';

export const buildShotDurationInstruction = (mode: ShotDurationMode): string => {
  if (mode === 'fragmented') {
    return [
      '【镜头时长模式：细碎 + 合并】',
      '基础镜头通常控制在 3-5 秒，用连续的短镜头拆解动作、表情和环境变化。',
      '再按剧情连续性将多个基础镜头组织为累计不超过 15 秒的分段，供后续合并生成。',
      '人物对白必须完整保留；镜头时长不得短于对白朗读时间，不得为了满足 3-5 秒而截断台词。',
    ].join('\n');
  }

  return [
    '【镜头时长模式：直接完善】',
    '优先生成 10-15 秒的完整镜头，在单个镜头内完整表达连续动作、对白和情绪变化。',
    '每个分段原则上对应一个可直接生成的视频镜头，累计时长不得超过 15 秒。',
    '人物对白必须完整保留；镜头时长不得短于对白朗读时间。单句对白超过 15 秒时允许独立成段，不得截断台词。',
  ].join('\n');
};
