import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Volume2 } from 'lucide-react';

const handleStyle = {
  width: 14,
  height: 14,
  border: '2px solid #fff',
  zIndex: 20,
  cursor: 'crosshair',
};

export const AudioNode = memo(({ data, id }: NodeProps) => {
  const audioUrl = data?.audioUrl as string | undefined;

  return (
    <div style={{
      background: '#252540', borderRadius: '12px', padding: '12px',
      border: '1px solid #ff980044', minWidth: '200px', color: '#e0e0e0'
    }}>
      <Handle id="in" type="target" position={Position.Left} isConnectable style={{ ...handleStyle, background: '#ff9800' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Volume2 size={16} color="#ff9800" />
        <span style={{ fontSize: '12px', color: '#888' }}>音频节点</span>
      </div>
      {audioUrl ? (
        <audio controls src={audioUrl} style={{ width: '100%' }} />
      ) : (
        <div style={{
          width: '100%', height: '48px', background: '#1a1a2e',
          borderRadius: '8px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#555', fontSize: '12px'
        }}>
          无音频
        </div>
      )}
      <Handle id="out" type="source" position={Position.Right} isConnectable style={{ ...handleStyle, background: '#ff9800' }} />
    </div>
  );
});

AudioNode.displayName = 'AudioNode';
