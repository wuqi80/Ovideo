import React from 'react';
import { LayoutGrid, MessagesSquare } from 'lucide-react';
import type { ScriptWorkspaceMode } from '../utils/scriptWorkspaceMode';

interface ScriptWorkspaceModeSwitchProps {
  mode: ScriptWorkspaceMode;
  onChange: (mode: ScriptWorkspaceMode) => void;
}

const OPTIONS: Array<{
  value: ScriptWorkspaceMode;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'writing',
    label: '写作版',
    title: '写作版：通过对话持续生成和修改分镜脚本',
    icon: MessagesSquare,
  },
  {
    value: 'quick',
    label: '快速版',
    title: '快速版：使用四列工作区查看同一份剧本和镜头数据',
    icon: LayoutGrid,
  },
];

export const ScriptWorkspaceModeSwitch: React.FC<ScriptWorkspaceModeSwitchProps> = ({
  mode,
  onChange,
}) => (
  <div
    className="inline-flex h-8 flex-shrink-0 items-center rounded border border-n40 bg-n20 p-0.5"
    role="radiogroup"
    aria-label="分集剧本工作模式"
    data-testid="script-workspace-mode-switch"
  >
    {OPTIONS.map(option => {
      const Icon = option.icon;
      const active = mode === option.value;
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
            active
              ? 'bg-n0 text-primary shadow-sm'
              : 'text-n300 hover:bg-n0/70 hover:text-n700'
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {option.label}
        </button>
      );
    })}
  </div>
);
