import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Film } from 'lucide-react';

const handleStyle = {
  width: 24,
  height: 24,
  border: '3px solid #fff',
  borderRadius: '999px',
  zIndex: 1000,
  cursor: 'crosshair',
  pointerEvents: 'all' as const,
  boxShadow: '0 0 0 4px rgba(233, 30, 99, 0.22)',
};

export const VideoNode = memo(({ data, isConnectable }: NodeProps) => {
  const videoUrl = data?.videoUrl as string | undefined;

  return (
    <div style={{
      background: '#252540', borderRadius: '12px', padding: '12px',
      border: '1px solid #e91e6344', minWidth: '220px', color: '#e0e0e0',
      position: 'relative'
    }}>
      <Handle id="in" type="target" position={Position.Left} isConnectable={isConnectable} className="nodrag nopan" style={{ ...handleStyle, background: '#e91e63' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Film size={16} color="#e91e63" />
        <span style={{ fontSize: '12px', color: '#888' }}>视频节点</span>
      </div>
      {videoUrl ? (
        <video className="nodrag nowheel" controls preload="metadata" src={videoUrl} style={{
          width: '100%', borderRadius: '8px', maxHeight: '160px'
        }} />
      ) : (
        <div style={{
          width: '100%', height: '120px', background: '#1a1a2e',
          borderRadius: '8px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#555'
        }}>
          <Film size={32} />
        </div>
      )}
      <Handle id="out" type="source" position={Position.Right} isConnectable={isConnectable} className="nodrag nopan" style={{ ...handleStyle, background: '#e91e63' }} />
    </div>
  );
});

VideoNode.displayName = 'VideoNode';
