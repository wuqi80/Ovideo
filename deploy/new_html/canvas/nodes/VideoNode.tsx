import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Film } from 'lucide-react';

export const VideoNode = memo(({ data, id }: NodeProps) => {
  const videoUrl = data?.videoUrl as string | undefined;

  return (
    <div style={{
      background: '#252540', borderRadius: '12px', padding: '12px',
      border: '1px solid #e91e6344', minWidth: '220px', color: '#e0e0e0'
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#e91e63' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Film size={16} color="#e91e63" />
        <span style={{ fontSize: '12px', color: '#888' }}>视频节点</span>
      </div>
      {videoUrl ? (
        <video controls preload="metadata" src={videoUrl} style={{
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
      <Handle type="source" position={Position.Right} style={{ background: '#e91e63' }} />
    </div>
  );
});

VideoNode.displayName = 'VideoNode';
