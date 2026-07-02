import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Volume2 } from 'lucide-react';

const handleStyle = {
  width: 24,
  height: 24,
  border: '3px solid #fff',
  borderRadius: '999px',
  zIndex: 1000,
  cursor: 'crosshair',
  pointerEvents: 'all' as const,
  boxShadow: '0 0 0 4px rgba(255, 152, 0, 0.22)',
};

export const AudioNode = memo(({ data, isConnectable }: NodeProps) => {
  const audioUrl = data?.audioUrl as string | undefined;

  return (
    <div style={{
      background: '#252540', borderRadius: '12px', padding: '12px',
      border: '1px solid #ff980044', minWidth: '200px', color: '#e0e0e0',
      position: 'relative'
    }}>
      <Handle id="in" type="target" position={Position.Left} isConnectable={isConnectable} className="nodrag nopan" style={{ ...handleStyle, background: '#ff9800' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Volume2 size={16} color="#ff9800" />
        <span style={{ fontSize: '12px', color: '#888' }}>音频节点</span>
      </div>
      {audioUrl ? (
        <audio className="nodrag nowheel" controls src={audioUrl} style={{ width: '100%' }} />
      ) : (
        <div style={{
          width: '100%', height: '48px', background: '#1a1a2e',
          borderRadius: '8px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#555', fontSize: '12px'
        }}>
          暂无音频
        </div>
      )}
      <Handle id="out" type="source" position={Position.Right} isConnectable={isConnectable} className="nodrag nopan" style={{ ...handleStyle, background: '#ff9800' }} />
    </div>
  );
});

AudioNode.displayName = 'AudioNode';
