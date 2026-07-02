import React, { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText } from 'lucide-react';

const handleStyle = {
  width: 14,
  height: 14,
  border: '2px solid #fff',
  zIndex: 20,
  cursor: 'crosshair',
};

export const ScriptNode = memo(({ data, id }: NodeProps) => {
  const [text, setText] = useState(data?.text as string || '');

  return (
    <div style={{
      background: '#252540', borderRadius: '12px', padding: '16px',
      border: '1px solid #7c83ff44', minWidth: '240px', color: '#e0e0e0'
    }}>
      <Handle id="in" type="target" position={Position.Left} isConnectable style={{ ...handleStyle, background: '#7c83ff' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <FileText size={16} color="#7c83ff" />
        <span style={{ fontSize: '12px', color: '#888' }}>剧本节点</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入剧本内容..."
        style={{
          width: '100%', minHeight: '80px', background: '#1a1a2e',
          border: '1px solid #444', borderRadius: '6px', padding: '8px',
          color: '#e0e0e0', fontSize: '13px', resize: 'vertical',
          boxSizing: 'border-box'
        }}
      />
      <Handle id="out" type="source" position={Position.Right} isConnectable style={{ ...handleStyle, background: '#7c83ff' }} />
    </div>
  );
});

ScriptNode.displayName = 'ScriptNode';
