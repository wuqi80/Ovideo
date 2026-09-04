import React, { useMemo } from 'react';

import type { VideoModel, VideoModelOption } from '../../services/videoModelService';
import { ModelPicker, type ModelPickerOption } from '../ModelPicker';

interface VideoModelPickerProps {
  value: VideoModel;
  options: readonly VideoModelOption[];
  onChange: (model: VideoModel) => void;
  compact?: boolean;
  className?: string;
}

export const VideoModelPicker: React.FC<VideoModelPickerProps> = ({
  value,
  options,
  onChange,
  compact = false,
  className = '',
}) => {
  const pickerOptions = useMemo<readonly ModelPickerOption<VideoModel>[]>(() => (
    options.map(option => ({
      value: option.value,
      label: option.label,
      runtimeLabel: option.runtimeLabel,
      group: option.provider === 'processing_cluster' ? '本地节点' : '在线 API',
      badge: option.provider === 'processing_cluster' ? '本地节点' : undefined,
      available: option.available,
      unavailableReason: option.unavailableReason,
    }))
  ), [options]);
  return (
    <ModelPicker
      value={value}
      options={pickerOptions}
      onChange={onChange}
      compact={compact}
      className={compact ? `max-w-[170px] ${className}` : className}
      ariaLabel="选择视频生成模型"
      title="视频模型"
      subtitle="全部模型始终展示；灰色模型悬停可查看不可用原因"
      kind="video"
    />
  );
};
