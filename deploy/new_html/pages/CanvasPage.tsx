import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeChange,
  type EdgeChange,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useParams, useNavigate } from 'react-router-dom';
import { EpisodeProvider, useEpisode } from '../contexts/EpisodeContext';
import { Plus, LayoutList, ArrowLeft, Sparkles, Image, FileText, Film, Volume2 } from 'lucide-react';
import { ScriptNode } from '../canvas/nodes/ScriptNode';
import { ImageNode } from '../canvas/nodes/ImageNode';
import { AudioNode } from '../canvas/nodes/AudioNode';
import { VideoNode } from '../canvas/nodes/VideoNode';
import {
  createCanvasBoard,
  createCanvasConnection,
  createCanvasNode,
  deleteCanvasConnection,
  deleteCanvasNode,
  getCanvasBoardDetail,
  getCanvasBoards,
  updateCanvasNode,
} from '../services/canvasService';

const nodeTypes: NodeTypes = {
  script: ScriptNode,
  image: ImageNode,
  audio: AudioNode,
  video: VideoNode,
};

const INITIAL_NODES: Node[] = [];
const INITIAL_EDGES: Edge[] = [];

const edgeStyle = { stroke: '#7c83ff', strokeWidth: 2.5 };
const edgeMarker = { type: MarkerType.ArrowClosed, color: '#7c83ff' };

type CanvasApiNode = Record<string, any>;
type CanvasApiConnection = Record<string, any>;

const getId = (value: Record<string, any> | undefined, ...keys: string[]) => {
  for (const key of keys) {
    if (value?.[key]) return String(value[key]);
  }
  return '';
};

const unwrapBoard = (response: any) => response?.board || response;
const unwrapBoards = (response: any) => response?.boards || [];
const unwrapNode = (response: any) => response?.node || response;
const unwrapConnection = (response: any) => response?.connection || response;

const normalizeNodeType = (type: string) => {
  if (type === 'audio' || type === 'image' || type === 'video' || type === 'script') return type;
  if (type === 'text' || type === 'storyboard' || type === 'prompt' || type === 'group') return 'script';
  return 'script';
};

const CanvasInner: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const navigate = useNavigate();
  useEpisode();

  const [nodes, setNodes] = useNodesState(INITIAL_NODES);
  const [edges, setEdges] = useEdgesState(INITIAL_EDGES);
  const [showMenu, setShowMenu] = useState(false);
  const [boardId, setBoardId] = useState('');
  const [statusText, setStatusText] = useState('正在加载画布...');
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const saveTextTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const persistNodeText = useCallback((nodeId: string, text: string) => {
    clearTimeout(saveTextTimers.current[nodeId]);
    saveTextTimers.current[nodeId] = setTimeout(() => {
      updateCanvasNode(nodeId, { data: { text } }).catch((error) => {
        console.warn('update canvas node text failed', error);
        setStatusText('文本保存失败，请稍后重试');
      });
    }, 450);
  }, []);

  const updateNodeText = useCallback((nodeId: string, text: string) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, text } } : node
      )
    );
    persistNodeText(nodeId, text);
  }, [persistNodeText, setNodes]);

  useEffect(() => {
    return () => {
      Object.values(saveTextTimers.current).forEach(clearTimeout);
    };
  }, []);

  const mapApiNode = useCallback((item: CanvasApiNode): Node => {
    const id = getId(item, 'node_id', 'nodeId', 'id');
    const rawType = String(item.node_type || item.nodeType || item.type || 'script');
    const data = item.data && typeof item.data === 'object' ? item.data : {};
    return {
      id,
      type: normalizeNodeType(rawType),
      position: {
        x: Number(item.x ?? item.position?.x ?? 120),
        y: Number(item.y ?? item.position?.y ?? 120),
      },
      data: {
        ...data,
        label: data.label || `${rawType} node`,
        onTextChange: updateNodeText,
      },
      width: item.width ? Number(item.width) : undefined,
      height: item.height ? Number(item.height) : undefined,
    };
  }, [updateNodeText]);

  const mapApiConnection = useCallback((item: CanvasApiConnection): Edge => {
    const id = getId(item, 'connection_id', 'connectionId', 'id');
    const source = getId(item, 'source_node_id', 'sourceNodeId', 'source');
    const target = getId(item, 'target_node_id', 'targetNodeId', 'target');
    return {
      id,
      source,
      target,
      sourceHandle: item.source_port || item.sourcePort || 'out',
      targetHandle: item.target_port || item.targetPort || 'in',
      type: 'smoothstep',
      animated: true,
      style: edgeStyle,
      markerEnd: edgeMarker,
      data: { connectionId: id, persisted: true },
    };
  }, []);

  const loadBoard = useCallback(async () => {
    if (!projectId) {
      setStatusText('缺少项目 ID，无法加载画布');
      return;
    }

    try {
      setStatusText('正在加载画布...');
      const listResponse = await getCanvasBoards(projectId);
      const boards = unwrapBoards(listResponse);
      let board = boards[0];
      if (!board) {
        const created = await createCanvasBoard(projectId, '自由创作画布', episodeId ? `episode:${episodeId}` : '');
        board = unwrapBoard(created);
      }
      const nextBoardId = getId(board, 'board_id', 'boardId', 'id');
      if (!nextBoardId) throw new Error('后端未返回 board_id');

      setBoardId(nextBoardId);
      const detail = await getCanvasBoardDetail(nextBoardId);
      const loadedNodes = (detail?.nodes || []).map(mapApiNode).filter((node: Node) => Boolean(node.id));
      const loadedEdges = (detail?.connections || []).map(mapApiConnection).filter((edge: Edge) => edge.source && edge.target);
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      setStatusText(loadedNodes.length ? '画布已加载，可以拖拽节点圆点进行连线' : '画布已加载，请点击右上角 + 添加节点');
    } catch (error) {
      console.error('load canvas board failed', error);
      setStatusText('画布加载失败，请刷新或重新登录后重试');
    }
  }, [episodeId, mapApiConnection, mapApiNode, projectId, setEdges, setNodes]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const onConnect = useCallback(async (params: Connection) => {
    if (!boardId) {
      setStatusText('画布还在加载，请稍后再连线');
      return;
    }
    if (!params.source || !params.target || params.source === params.target) return;

    const sourceHandle = params.sourceHandle || 'out';
    const targetHandle = params.targetHandle || 'in';
    const duplicate = edges.some((edge) =>
      edge.source === params.source &&
      edge.target === params.target &&
      (edge.sourceHandle || 'out') === sourceHandle &&
      (edge.targetHandle || 'in') === targetHandle
    );
    if (duplicate) {
      setStatusText('这两个节点已经连接过了');
      return;
    }

    const optimisticId = `edge_${params.source}_${sourceHandle}_${params.target}_${targetHandle}_${Date.now()}`;
    const optimisticEdge: Edge = {
      ...params,
      id: optimisticId,
      sourceHandle,
      targetHandle,
      type: 'smoothstep',
      animated: true,
      style: edgeStyle,
      markerEnd: edgeMarker,
      data: { persisted: false },
    };

    setEdges((current) => addEdge(optimisticEdge, current));
    setStatusText('正在保存连线...');

    try {
      const response = await createCanvasConnection(boardId, params.source, params.target, sourceHandle, targetHandle);
      const saved = unwrapConnection(response);
      const savedId = getId(saved, 'connection_id', 'connectionId', 'id') || optimisticId;
      setEdges((current) =>
        current.map((edge) =>
          edge.id === optimisticId
            ? { ...edge, id: savedId, data: { ...edge.data, connectionId: savedId, persisted: true } }
            : edge
        )
      );
      setStatusText('连线已保存');
    } catch (error) {
      console.error('create canvas connection failed', error);
      setEdges((current) => current.filter((edge) => edge.id !== optimisticId));
      setStatusText('连线保存失败，请重试');
    }
  }, [boardId, edges, setEdges]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const removedIds = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    setNodes((current) => applyNodeChanges(changes, current));
    removedIds.forEach((nodeId) => {
      deleteCanvasNode(nodeId).catch((error) => console.warn('delete canvas node failed', error));
    });
  }, [setNodes]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removedIds = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    const removedEdges = edges.filter((edge) => removedIds.includes(edge.id));
    setEdges((current) => applyEdgeChanges(changes, current));
    removedEdges.forEach((edge) => {
      const connectionId = String(edge.data?.connectionId || edge.id);
      if (connectionId.startsWith('edge_')) return;
      deleteCanvasConnection(connectionId).catch((error) => console.warn('delete canvas connection failed', error));
    });
  }, [edges, setEdges]);

  const addNode = useCallback(async (type: string) => {
    if (!boardId) {
      setStatusText('画布还在加载，请稍后再添加节点');
      return;
    }

    const x = Math.round(Math.random() * 400 + 100);
    const y = Math.round(Math.random() * 260 + 120);
    const tempId = `temp_${type}_${Date.now()}`;
    const tempNode: Node = {
      id: tempId,
      type,
      position: { x, y },
      data: { label: `${type} node`, onTextChange: updateNodeText },
    };
    setNodes((current) => [...current, tempNode]);
    setShowMenu(false);
    setStatusText('正在保存节点...');

    try {
      const response = await createCanvasNode(boardId, type, x, y, { label: `${type} node` });
      const savedNode = mapApiNode(unwrapNode(response));
      setNodes((current) => current.map((node) => node.id === tempId ? savedNode : node));
      setStatusText('节点已保存，可从右侧圆点拖到另一个节点左侧圆点连线');
    } catch (error) {
      console.error('create canvas node failed', error);
      setNodes((current) => current.filter((node) => node.id !== tempId));
      setStatusText('节点保存失败，请重试');
    }
  }, [boardId, mapApiNode, setNodes, updateNodeText]);

  const onNodeDragStop = useCallback((_event: any, node: Node) => {
    updateCanvasNode(node.id, { x: node.position.x, y: node.position.y }).catch((error) => {
      console.warn('update canvas node position failed', error);
      setStatusText('节点位置保存失败，请稍后重试');
    });
  }, []);

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
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={edgeStyle}
        connectionLineType="smoothstep"
        connectOnClick
        connectionRadius={48}
        nodesConnectable
        nodesDraggable
        elementsSelectable
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          style: edgeStyle,
          markerEnd: edgeMarker,
        }}
        isValidConnection={(connection) =>
          Boolean(connection.source && connection.target && connection.source !== connection.target)
        }
        fitView
        style={{ background: '#0d0d1a' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
        <Controls style={{ background: '#252540', borderColor: '#444' }} />
        <MiniMap style={{ background: '#1a1a2e' }} nodeColor="#7c83ff" maskColor="rgba(0,0,0,0.6)" />

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

        <Panel position="bottom-center">
          <div style={{
            background: '#252540', borderRadius: '12px', padding: '12px 20px',
            border: '1px solid #7c83ff44', display: 'flex', gap: '12px',
            alignItems: 'center', minWidth: '420px'
          }}>
            <Sparkles size={18} color="#7c83ff" />
            <input
              className="nodrag nowheel"
              type="text"
              placeholder={statusText || 'AI 指令：描述你想创建的内容...'}
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
