import React, { useCallback, useRef, useState, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useParams, useNavigate } from 'react-router-dom';
import { EpisodeProvider, useEpisode } from '../contexts/EpisodeContext';
import { Plus, LayoutList, ArrowLeft, Sparkles, Image, FileText, Film, Volume2 } from 'lucide-react';
import { ScriptNode } from '../canvas/nodes/ScriptNode';
import { ImageNode } from '../canvas/nodes/ImageNode';
import { AudioNode } from '../canvas/nodes/AudioNode';
import { VideoNode } from '../canvas/nodes/VideoNode';

const nodeTypes: NodeTypes = {
  script: ScriptNode,
  image: ImageNode,
  audio: AudioNode,
  video: VideoNode,
};

let nodeIdCounter = 0;
const getNodeId = () => `canvas_node_${++nodeIdCounter}`;

const INITIAL_NODES: Node[] = [];
const INITIAL_EDGES: Edge[] = [];

const CanvasInner: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const navigate = useNavigate();
  const { assets, storyboardItems } = useEpisode();

  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [showMenu, setShowMenu] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const addNode = useCallback((type: string) => {
    const id = getNodeId();
    const newNode: Node = {
      id,
      type,
      position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
      data: { label: `${type} node` },
    };
    setNodes((nds) => [...nds, newNode]);
    setShowMenu(false);
  }, [setNodes]);

  const goToWorkflow = () => {
    navigate(`/projects/${projectId}/ep/${episodeId}/workflow/script`);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0d0d1a' }} ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        style={{ background: '#0d0d1a' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
        <Controls style={{ background: '#252540', borderColor: '#444' }} />
        <MiniMap
          style={{ background: '#1a1a2e' }}
          nodeColor="#7c83ff"
          maskColor="rgba(0,0,0,0.6)"
        />

        {/* Top Left Panel - Navigation */}
        <Panel position="top-left">
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => navigate(`/projects/${projectId}/episodes`)}
              style={{
                padding: '8px 16px', background: '#252540', color: '#ccc',
                border: '1px solid #444', borderRadius: '8px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '13px'
              }}
            >
              <ArrowLeft size={16} /> 返回分集
            </button>
            <button
              onClick={goToWorkflow}
              style={{
                padding: '8px 16px', background: '#252540', color: '#7c83ff',
                border: '1px solid #7c83ff44', borderRadius: '8px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '13px'
              }}
            >
              <LayoutList size={16} /> 流程化制作
            </button>
          </div>
        </Panel>

        {/* Top Right Panel - Add Node */}
        <Panel position="top-right">
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              style={{
                padding: '10px', background: '#7c83ff', color: '#fff',
                border: 'none', borderRadius: '50%', cursor: 'pointer',
                width: '40px', height: '40px', display: 'flex',
                alignItems: 'center', justifyContent: 'center'
              }}
            >
              <Plus size={20} />
            </button>
            {showMenu && (
              <div style={{
                position: 'absolute', top: '50px', right: 0,
                background: '#252540', borderRadius: '12px', padding: '8px',
                border: '1px solid #444', minWidth: '180px', zIndex: 10
              }}>
                {[
                  { type: 'script', icon: <FileText size={16} />, label: '剧本节点' },
                  { type: 'image', icon: <Image size={16} />, label: '图片节点' },
                  { type: 'audio', icon: <Volume2 size={16} />, label: '音频节点' },
                  { type: 'video', icon: <Film size={16} />, label: '视频节点' },
                ].map(item => (
                  <button
                    key={item.type}
                    onClick={() => addNode(item.type)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 12px', background: 'transparent',
                      border: 'none', color: '#e0e0e0', cursor: 'pointer',
                      width: '100%', borderRadius: '8px', fontSize: '13px',
                      textAlign: 'left'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a5a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {/* Bottom Panel - AI Agent */}
        <Panel position="bottom-center">
          <div style={{
            background: '#252540', borderRadius: '12px', padding: '12px 20px',
            border: '1px solid #7c83ff44', display: 'flex', gap: '12px',
            alignItems: 'center', minWidth: '400px'
          }}>
            <Sparkles size={18} color="#7c83ff" />
            <input
              type="text"
              placeholder="AI 指令: 描述你想创建的内容..."
              style={{
                flex: 1, background: 'transparent', border: 'none',
                color: '#e0e0e0', outline: 'none', fontSize: '14px'
              }}
            />
            <button style={{
              padding: '6px 16px', background: '#7c83ff', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontSize: '13px'
            }}>
              生成
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
};

export const CanvasPage: React.FC = () => (
  <EpisodeProvider>
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  </EpisodeProvider>
);
