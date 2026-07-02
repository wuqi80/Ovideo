import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Image as ImageIcon } from 'lucide-react';

const handleStyle = {
  width: 24,
  height: 24,
  border: '3px solid #fff',
  borderRadius: '999px',
  zIndex: 1000,
  cursor: 'crosshair',
  pointerEvents: 'all' as const,
  boxShadow: '0 0 0 4px rgba(76, 175, 80, 0.22)',
};

export const ImageNode = memo(({ data, isConnectable }: NodeProps) => {
  const imageUrl = data?.imageUrl as string | undefined;

  return (
    <div style={{
      background: '#252540', borderRadius: '12px', padding: '12px',
      border: '1px solid #4caf5044', minWidth: '200px', color: '#e0e0e0',
      position: 'relative'
    }}>
      <Handle id="in" type="target" position={Position.Left} isConnectable={isConnectable} className="nodrag nopan" style={{ ...handleStyle, background: '#4caf50' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <ImageIcon size={16} color="#4caf50" />
        <span style={{ fontSize: '12px', color: '#888' }}>图片节点</span>
      </div>
      {imageUrl ? (
        <img className="nodrag" src={imageUrl} alt="" style={{
          width: '100%', borderRadius: '8px', maxHeight: '200px', objectFit: 'cover'
        }} />
      ) : (
        <div style={{
          width: '100%', height: '120px', background: '#1a1a2e',
          borderRadius: '8px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#555'
        }}>
          <ImageIcon size={32} />
        </div>
      )}
      <Handle id="out" type="source" position={Position.Right} isConnectable={isConnectable} className="nodrag nopan" style={{ ...handleStyle, background: '#4caf50' }} />
    </div>
  );
});

ImageNode.displayName = 'ImageNode';
