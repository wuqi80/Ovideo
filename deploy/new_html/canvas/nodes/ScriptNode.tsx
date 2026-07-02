import React, { memo, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText } from 'lucide-react';

const handleStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  border: '3px solid #fff',
  borderRadius: '999px',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1000,
  cursor: 'crosshair',
  pointerEvents: 'all',
  boxShadow: '0 0 0 4px rgba(124, 131, 255, 0.22)',
};
const inputHandleStyle: React.CSSProperties = { ...handleStyle, left: -12, right: 'auto' };
const outputHandleStyle: React.CSSProperties = { ...handleStyle, left: 'auto', right: -12 };

export const ScriptNode = memo(({ data, id, isConnectable }: NodeProps) => {
  const [text, setText] = useState(data?.text as string || '');
  const onTextChange = data?.onTextChange as ((nodeId: string, text: string) => void) | undefined;

  useEffect(() => {
    setText(data?.text as string || '');
  }, [data?.text]);

  return (
    <div style={{
      background: '#252540', borderRadius: '12px', padding: '16px',
      border: '1px solid #7c83ff44', minWidth: '240px', color: '#e0e0e0',
      position: 'relative'
    }}>
      <Handle id="in" type="target" position={Position.Left} isConnectable={isConnectable} className="nodrag nopan" style={{ ...inputHandleStyle, background: '#7c83ff' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <FileText size={16} color="#7c83ff" />
        <span style={{ fontSize: '12px', color: '#888' }}>剧本节点</span>
      </div>
      <textarea
        className="nodrag nowheel"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange?.(id, e.target.value);
        }}
        placeholder="输入剧本内容..."
        style={{
          width: '100%', minHeight: '80px', background: '#1a1a2e',
          border: '1px solid #444', borderRadius: '6px', padding: '8px',
          color: '#e0e0e0', fontSize: '13px', resize: 'vertical',
          boxSizing: 'border-box'
        }}
      />
      <Handle id="out" type="source" position={Position.Right} isConnectable={isConnectable} className="nodrag nopan" style={{ ...outputHandleStyle, background: '#7c83ff' }} />
    </div>
  );
});

ScriptNode.displayName = 'ScriptNode';
