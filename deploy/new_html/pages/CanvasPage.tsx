import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ConnectionLineType,
  MarkerType,
  useUpdateNodeInternals,
  useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useParams, useNavigate } from 'react-router-dom';
import { EpisodeProvider, useEpisode } from '../contexts/EpisodeContext';
import { Plus, LayoutList, ArrowLeft, Sparkles, Image, FileText, Film, Volume2, Trash2, Zap } from 'lucide-react';
import { ScriptNode } from '../canvas/nodes/ScriptNode';
import { ImageNode } from '../canvas/nodes/ImageNode';
import { AudioNode } from '../canvas/nodes/AudioNode';
import { VideoNode } from '../canvas/nodes/VideoNode';
import { generateGeminiImageVariant } from '../services/geminiImageGenerationService';
import { generateWithComfyUIWorkflowQueued } from '../services/comfyuiGenerationService';
import type { GeneratedImageResult } from '../services/comfyuiTaskWaitService';
import { fetchComfyuiAvailable } from '../services/videoWorkflowService';
import { minimaxTTSSync } from '../services/audioGenerationService';
import { generateUUID, submitSeedanceTask } from '../services/videoTaskService';
import { startVideoPoll } from '../services/videoTaskPoller';
import type { SeedanceMediaInput } from '../services/videoModelService';
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

const edgeStyle = { stroke: '#7c83ff', strokeWidth: 3 };
const selectedEdgeStyle = { stroke: '#f87171', strokeWidth: 4 };
const edgeMarker = { type: MarkerType.ArrowClosed, color: '#7c83ff' };
const selectedEdgeMarker = { type: MarkerType.ArrowClosed, color: '#f87171' };
const CANVAS_IMAGE_MODEL = 'gemini-2.5-flash-image';
const CANVAS_DEFAULT_VOICE_ID = 'presenter_male';
const CANVAS_DEFAULT_VIDEO_PROMPT = '让参考画面自然动起来，保持人物与场景一致，动作连贯，镜头自然。';
const EMPTY_REFERENCE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

type CanvasApiNode = Record<string, any>;
type CanvasApiConnection = Record<string, any>;
type CanvasGenerationMode = 'api' | 'gpu';
type CanvasNodeKind = 'script' | 'image' | 'audio' | 'video';

export type CanvasGenerationTarget =
  | {
      kind: 'image';
      targetNodeId: string;
      scriptNodeId: string;
      text: string;
      prompt: string;
      hasPromptInput: boolean;
    }
  | {
      kind: 'audio';
      targetNodeId: string;
      scriptNodeId?: string;
      imageNodeId?: string;
      text: string;
    }
  | {
      kind: 'video';
      targetNodeId: string;
      scriptNodeId?: string;
      imageNodeId?: string;
      audioNodeId?: string;
      imageUrl?: string;
      audioUrl?: string;
      prompt: string;
    };


const isDuplicateConnectionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  const lower = message.toLowerCase();
  return (
    lower.includes('409') ||
    lower.includes('duplicate') ||
    lower.includes('already') ||
    lower.includes('exist') ||
    message.includes('\u5df2\u5b58\u5728') ||
    message.includes('\u91cd\u590d')
  );
};

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
const normalizeHandle = (handle: string | null | undefined, fallback: string) => handle || fallback;

const normalizeCanvasEdge = (edge: Edge, sourceHandle = 'out', targetHandle = 'in'): Edge => ({
  ...edge,
  sourceHandle: normalizeHandle(edge.sourceHandle, sourceHandle),
  targetHandle: normalizeHandle(edge.targetHandle, targetHandle),
  type: 'smoothstep',
  animated: true,
  hidden: false,
  zIndex: edge.selected ? 2 : 0,
  interactionWidth: 32,
  style: edge.selected ? selectedEdgeStyle : edgeStyle,
  markerEnd: edge.selected ? selectedEdgeMarker : edgeMarker,
});

const normalizeNodeType = (type: string) => {
  if (type === 'audio' || type === 'image' || type === 'video' || type === 'script') return type;
  if (type === 'text' || type === 'storyboard' || type === 'prompt' || type === 'group') return 'script';
  return 'script';
};

const sameStringList = (a: string[], b: string[]) => (
  a.length === b.length && a.every((value, index) => value === b[index])
);

const getSerializableNodeData = (node: Node) => {
  const { onTextChange: _onTextChange, ...serializableData } = (node.data || {}) as Record<string, any>;
  return serializableData;
};

const isCanvasNodeKind = (node: Node | undefined, kind: CanvasNodeKind) => node?.type === kind;

const getNodeText = (node: Node | undefined) => String(node?.data?.text || '').trim();
const getImageUrl = (node: Node | undefined) => String(node?.data?.imageUrl || node?.data?.fileUrl || node?.data?.url || '').trim();
const getAudioUrl = (node: Node | undefined) => String(node?.data?.audioUrl || node?.data?.fileUrl || node?.data?.url || '').trim();
const getVideoUrl = (node: Node | undefined) => String(node?.data?.videoUrl || node?.data?.fileUrl || node?.data?.url || '').trim();

const buildCanvasImagePrompt = (scriptText: string, instruction: string) => [
  scriptText,
  instruction ? `额外要求：${instruction}` : '',
  '画面要求：高质量动漫/漫剧分镜风格，电影感构图，主体清晰，细节丰富。',
].filter(Boolean).join('\n\n');

const buildCanvasVideoPrompt = (scriptText: string, instruction: string) => {
  const prompt = [
    scriptText,
    instruction ? `额外要求：${instruction}` : '',
    '视频要求：基于参考画面生成自然连续的短镜头，保持人物、场景和画风一致，动作连贯。',
  ].filter(Boolean).join('\n\n');
  return prompt || CANVAS_DEFAULT_VIDEO_PROMPT;
};

const findConnectedNode = (
  nodes: Node[],
  edges: Edge[],
  startNodeId: string,
  kind: CanvasNodeKind,
  direction: 'upstream' | 'downstream',
  predicate: (node: Node) => boolean = () => true,
) => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set([startNodeId]);
  const queue = [startNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const linkedIds = edges
      .filter((edge) => direction === 'upstream' ? edge.target === currentId : edge.source === currentId)
      .map((edge) => direction === 'upstream' ? edge.source : edge.target);

    for (const linkedId of linkedIds) {
      if (visited.has(linkedId)) continue;
      visited.add(linkedId);
      const linkedNode = nodeMap.get(linkedId);
      if (!linkedNode) continue;
      if (isCanvasNodeKind(linkedNode, kind) && predicate(linkedNode)) return linkedNode;
      queue.push(linkedId);
    }
  }

  return undefined;
};

const buildImageTarget = (nodes: Node[], edges: Edge[], imageNode: Node, instruction: string): CanvasGenerationTarget | null => {
  const scriptNode = findConnectedNode(nodes, edges, imageNode.id, 'script', 'upstream');
  if (!scriptNode) return null;

  const scriptText = getNodeText(scriptNode);
  return {
    kind: 'image',
    targetNodeId: imageNode.id,
    scriptNodeId: scriptNode.id,
    text: scriptText,
    prompt: buildCanvasImagePrompt(scriptText, instruction),
    hasPromptInput: Boolean(scriptText || instruction),
  };
};

const buildAudioTarget = (nodes: Node[], edges: Edge[], audioNode: Node, instruction: string): CanvasGenerationTarget => {
  const scriptNode = findConnectedNode(nodes, edges, audioNode.id, 'script', 'upstream');
  const imageNode = findConnectedNode(nodes, edges, audioNode.id, 'image', 'upstream');
  const scriptText = getNodeText(scriptNode);
  return {
    kind: 'audio',
    targetNodeId: audioNode.id,
    scriptNodeId: scriptNode?.id,
    imageNodeId: imageNode?.id,
    text: scriptText || instruction,
  };
};

const buildVideoTarget = (nodes: Node[], edges: Edge[], videoNode: Node, instruction: string): CanvasGenerationTarget => {
  const scriptNode = findConnectedNode(nodes, edges, videoNode.id, 'script', 'upstream');
  const imageNode = findConnectedNode(nodes, edges, videoNode.id, 'image', 'upstream');
  const audioNode = findConnectedNode(nodes, edges, videoNode.id, 'audio', 'upstream');
  const scriptText = getNodeText(scriptNode);

  return {
    kind: 'video',
    targetNodeId: videoNode.id,
    scriptNodeId: scriptNode?.id,
    imageNodeId: imageNode?.id,
    audioNodeId: audioNode?.id,
    imageUrl: getImageUrl(imageNode),
    audioUrl: getAudioUrl(audioNode),
    prompt: buildCanvasVideoPrompt(scriptText, instruction),
  };
};

const resolveFromSelectedImage = (nodes: Node[], edges: Edge[], imageNode: Node, instruction: string) => {
  if (getImageUrl(imageNode)) {
    const nextAudioNode = findConnectedNode(nodes, edges, imageNode.id, 'audio', 'downstream', (node) => !getAudioUrl(node));
    if (nextAudioNode) return buildAudioTarget(nodes, edges, nextAudioNode, instruction);

    const nextVideoNode = findConnectedNode(nodes, edges, imageNode.id, 'video', 'downstream', (node) => !getVideoUrl(node));
    if (nextVideoNode) return buildVideoTarget(nodes, edges, nextVideoNode, instruction);
  }

  return buildImageTarget(nodes, edges, imageNode, instruction);
};

const resolveFromSelectedAudio = (nodes: Node[], edges: Edge[], audioNode: Node, instruction: string) => {
  if (getAudioUrl(audioNode)) {
    const nextVideoNode = findConnectedNode(nodes, edges, audioNode.id, 'video', 'downstream', (node) => !getVideoUrl(node));
    if (nextVideoNode) return buildVideoTarget(nodes, edges, nextVideoNode, instruction);
  }

  return buildAudioTarget(nodes, edges, audioNode, instruction);
};

export const resolveCanvasGenerationTarget = (
  nodes: Node[],
  edges: Edge[],
  selectedNodeIds: string[],
  agentCommand: string,
): CanvasGenerationTarget | null => {
  const instruction = agentCommand.trim();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  for (const selectedNodeId of selectedNodeIds) {
    const selectedNode = nodeMap.get(selectedNodeId);
    if (isCanvasNodeKind(selectedNode, 'video')) return buildVideoTarget(nodes, edges, selectedNode, instruction);
    if (isCanvasNodeKind(selectedNode, 'audio')) return resolveFromSelectedAudio(nodes, edges, selectedNode, instruction);
    if (isCanvasNodeKind(selectedNode, 'image')) return resolveFromSelectedImage(nodes, edges, selectedNode, instruction);
  }

  for (const imageNode of nodes.filter((node) => isCanvasNodeKind(node, 'image') && !getImageUrl(node))) {
    const target = buildImageTarget(nodes, edges, imageNode, instruction);
    if (target) return target;
  }

  const emptyAudioNode = nodes.find((node) => isCanvasNodeKind(node, 'audio') && !getAudioUrl(node));
  if (emptyAudioNode) return buildAudioTarget(nodes, edges, emptyAudioNode, instruction);

  const emptyVideoNode = nodes.find((node) => isCanvasNodeKind(node, 'video') && !getVideoUrl(node));
  if (emptyVideoNode) return buildVideoTarget(nodes, edges, emptyVideoNode, instruction);

  const firstImageTarget = nodes
    .filter((node) => isCanvasNodeKind(node, 'image'))
    .map((node) => buildImageTarget(nodes, edges, node, instruction))
    .find(Boolean);
  if (firstImageTarget) return firstImageTarget;

  const firstAudioNode = nodes.find((node) => isCanvasNodeKind(node, 'audio'));
  if (firstAudioNode) return buildAudioTarget(nodes, edges, firstAudioNode, instruction);

  const firstVideoNode = nodes.find((node) => isCanvasNodeKind(node, 'video'));
  if (firstVideoNode) return buildVideoTarget(nodes, edges, firstVideoNode, instruction);

  return null;
};

const getCanvasVideoResult = (status: any) => {
  const result = status?.result || {};
  const firstVideo = Array.isArray(result.videos) ? result.videos[0] : null;
  return {
    url: firstVideo?.url || result.video_url || result.file_url || result.url || '',
    filename: firstVideo?.filename || result.filename || '',
    generateTime: firstVideo?.generateTime ?? result.generateTime,
  };
};

export const buildCanvasSeedanceVideoParams = (target: Extract<CanvasGenerationTarget, { kind: 'video' }>) => ({
  media_inputs: target.imageUrl
    ? [{ kind: 'image' as const, url: target.imageUrl, role: 'first_frame' as const }]
    : [],
  generate_audio: !target.audioUrl,
});

type CanvasEdgeOverlayProps = {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  edges: Edge[];
  selectedEdgeIds: string[];
  nodePositionKey?: string;
  onEdgeSelect: (edgeId: string) => void;
};

const getCssEscapedValue = (value: string) => {
  if (typeof window !== 'undefined' && window.CSS?.escape) return window.CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
};

export const CanvasEdgeOverlay: React.FC<CanvasEdgeOverlayProps> = ({ wrapperRef, edges, selectedEdgeIds, nodePositionKey, onEdgeSelect }) => {
  const viewport = useViewport();
  const selectedEdgeSet = useMemo(() => new Set(selectedEdgeIds), [selectedEdgeIds]);
  const [paths, setPaths] = useState<Array<{ id: string; path: string; hitPath: string }>>([]);

  const measurePaths = useCallback(() => {
    const flowRoot = wrapperRef.current?.querySelector('.react-flow') as HTMLElement | null;
    if (!flowRoot || edges.length === 0) {
      setPaths([]);
      return;
    }

    const rootRect = flowRoot.getBoundingClientRect();
    const getHandleCenter = (nodeId: string, handleId: string | null | undefined, type: 'source' | 'target') => {
      const safeNodeId = getCssEscapedValue(nodeId);
      const safeHandleId = handleId ? getCssEscapedValue(handleId) : '';
      const handleSelector = safeHandleId
        ? `.react-flow__handle.${type}[data-nodeid="${safeNodeId}"][data-handleid="${safeHandleId}"]`
        : `.react-flow__handle.${type}[data-nodeid="${safeNodeId}"]`;
      const handle = flowRoot.querySelector(handleSelector) as HTMLElement | null;
      if (!handle) return null;

      const rect = handle.getBoundingClientRect();
      return {
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top + rect.height / 2,
      };
    };

    const nextPaths = edges
      .map((edge) => {
        const source = getHandleCenter(edge.source, edge.sourceHandle || 'out', 'source');
        const target = getHandleCenter(edge.target, edge.targetHandle || 'in', 'target');
        if (!source || !target) return null;

        const direction = target.x >= source.x ? 1 : -1;
        const delta = Math.max(Math.abs(target.x - source.x) * 0.45, 80);
        const endpointInset = Math.min(30, Math.max(Math.abs(target.x - source.x) / 5, 12));
        const hitSourceX = source.x + direction * endpointInset;
        const hitTargetX = target.x - direction * endpointInset;

        return {
          id: edge.id,
          path: `M ${source.x} ${source.y} C ${source.x + direction * delta} ${source.y}, ${target.x - direction * delta} ${target.y}, ${target.x} ${target.y}`,
          hitPath: `M ${hitSourceX} ${source.y} C ${source.x + direction * delta} ${source.y}, ${target.x - direction * delta} ${target.y}, ${hitTargetX} ${target.y}`,
        };
      })
      .filter(Boolean) as Array<{ id: string; path: string; hitPath: string }>;

    setPaths(nextPaths);
  }, [edges, wrapperRef]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(measurePaths);
    const timerId = window.setTimeout(measurePaths, 120);
    window.addEventListener('resize', measurePaths);

    const flowRoot = wrapperRef.current?.querySelector('.react-flow') as HTMLElement | null;
    const resizeObserver = flowRoot ? new ResizeObserver(measurePaths) : null;
    if (flowRoot && resizeObserver) resizeObserver.observe(flowRoot);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
      window.removeEventListener('resize', measurePaths);
      resizeObserver?.disconnect();
    };
  }, [measurePaths, viewport.x, viewport.y, viewport.zoom, wrapperRef, nodePositionKey]);

  if (paths.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 4,
      }}
    >
      <defs>
        <marker id="canvas-overlay-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b5cf6" />
        </marker>
        <marker id="canvas-overlay-arrow-selected" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f87171" />
        </marker>
      </defs>
      {paths.map(({ id, path, hitPath }) => {
        const selected = selectedEdgeSet.has(id);
        return (
          <g key={id}>
            <path
              d={hitPath}
              fill="none"
              stroke="transparent"
              strokeWidth={24}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={(event) => {
                event.stopPropagation();
                onEdgeSelect(id);
              }}
            />
            <path
              d={path}
              fill="none"
              stroke={selected ? '#f87171' : '#8b5cf6'}
              strokeWidth={selected ? 5 : 4}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={selected ? 'url(#canvas-overlay-arrow-selected)' : 'url(#canvas-overlay-arrow)'}
              filter={selected ? 'drop-shadow(0 0 9px rgba(248, 113, 113, 0.7))' : 'drop-shadow(0 0 8px rgba(139, 92, 246, 0.55))'}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}
    </svg>
  );
};

const CanvasInner: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const navigate = useNavigate();
  useEpisode();

  const [nodes, setNodes] = useNodesState(INITIAL_NODES);
  const [edges, setEdges] = useEdgesState(INITIAL_EDGES);
  const updateNodeInternals = useUpdateNodeInternals();
  const [showMenu, setShowMenu] = useState(false);
  const [boardId, setBoardId] = useState('');
  const [statusText, setStatusText] = useState('正在加载画布...');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [agentCommand, setAgentCommand] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<CanvasGenerationMode>('api');
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

  const nodeIdsForInternals = useMemo(() => nodes.map((node) => node.id).join('|'), [nodes]);
  const nodePositionKey = useMemo(
    () => nodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}:${node.width || ''}:${node.height || ''}`).join('|'),
    [nodes],
  );

  useEffect(() => {
    if (!nodeIdsForInternals) return;

    const frameId = window.requestAnimationFrame(() => {
      nodeIdsForInternals.split('|').forEach((nodeId) => updateNodeInternals(nodeId));
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [nodeIdsForInternals, updateNodeInternals]);

  const deleteEdgesFromServer = useCallback((edgesToDelete: Edge[]) => {
    edgesToDelete.forEach((edge) => {
      const connectionId = String(edge.data?.connectionId || edge.id);
      if (connectionId.startsWith('edge_')) return;
      deleteCanvasConnection(connectionId).catch((error) => console.warn('delete canvas connection failed', error));
    });
  }, []);

  const deleteSelectedEdges = useCallback(() => {
    if (selectedEdgeIds.length === 0) {
      setStatusText('请先选中要删除的线条');
      return;
    }

    const selectedEdgeSet = new Set(selectedEdgeIds);
    const edgesToDelete = edges.filter((edge) => selectedEdgeSet.has(edge.id));

    setEdges((current) => current.filter((edge) => !selectedEdgeSet.has(edge.id)));
    setSelectedEdgeIds([]);
    deleteEdgesFromServer(edgesToDelete);
    setStatusText(`已删除 ${edgesToDelete.length} 条线条`);
  }, [deleteEdgesFromServer, edges, selectedEdgeIds, setEdges]);

  const deleteSelected = useCallback(() => {
    if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) {
      setStatusText('\u8bf7\u5148\u9009\u4e2d\u8981\u5220\u9664\u7684\u8282\u70b9\u6216\u8fde\u7ebf');
      return;
    }

    const selectedNodeSet = new Set(selectedNodeIds);
    const selectedEdgeSet = new Set(selectedEdgeIds);
    const edgesToDelete = edges.filter(
      (edge) => selectedEdgeSet.has(edge.id) || selectedNodeSet.has(edge.source) || selectedNodeSet.has(edge.target)
    );
    const nodesToDelete = nodes.filter((node) => selectedNodeSet.has(node.id));

    setEdges((current) =>
      current.filter(
        (edge) => !selectedEdgeSet.has(edge.id) && !selectedNodeSet.has(edge.source) && !selectedNodeSet.has(edge.target)
      )
    );
    setNodes((current) => current.filter((node) => !selectedNodeSet.has(node.id)));
    setSelectedEdgeIds([]);
    setSelectedNodeIds([]);
    deleteEdgesFromServer(edgesToDelete);
    nodesToDelete.forEach((node) => {
      deleteCanvasNode(node.id).catch((error) => console.warn('delete canvas node failed', error));
    });
    setStatusText('\u5df2\u5220\u9664\u9009\u4e2d\u7684\u8282\u70b9/\u8fde\u7ebf');
  }, [deleteEdgesFromServer, edges, nodes, selectedEdgeIds, selectedNodeIds, setEdges, setNodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable) return;
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      event.preventDefault();
      deleteSelected();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, selectedEdgeIds.length, selectedNodeIds.length]);

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
    return normalizeCanvasEdge({
      id,
      source,
      target,
      sourceHandle: item.source_port || item.sourcePort || 'out',
      targetHandle: item.target_port || item.targetPort || 'in',
      data: { connectionId: id, persisted: true },
    });
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
    const isSameConnection = (edge: Edge) =>
      edge.source === params.source &&
      edge.target === params.target &&
      (edge.sourceHandle || 'out') === sourceHandle &&
      (edge.targetHandle || 'in') === targetHandle;
    const duplicate = edges.find(isSameConnection);

    if (duplicate) {
      setEdges((current) => [
        ...current.filter((edge) => !isSameConnection(edge)),
        normalizeCanvasEdge(duplicate, sourceHandle, targetHandle),
      ]);
      setStatusText('这两个节点已经连接过了，已刷新连线显示');
      return;
    }

    const optimisticId = `edge_${params.source}_${sourceHandle}_${params.target}_${targetHandle}_${Date.now()}`;
    const optimisticEdge: Edge = normalizeCanvasEdge({
      ...params,
      id: optimisticId,
      sourceHandle,
      targetHandle,
      data: { persisted: false },
    }, sourceHandle, targetHandle);

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
      if (isDuplicateConnectionError(error)) {
        setStatusText('\u540e\u7aef\u5df2\u6709\u8fd9\u6761\u8fde\u7ebf\uff0c\u5df2\u4fdd\u7559\u753b\u5e03\u663e\u793a');
        return;
      }
      setStatusText('\u8fde\u7ebf\u5df2\u663e\u793a\uff0c\u4f46\u540e\u53f0\u4fdd\u5b58\u5931\u8d25\uff0c\u5237\u65b0\u540e\u53ef\u80fd\u4e22\u5931');
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
    deleteEdgesFromServer(removedEdges);
  }, [deleteEdgesFromServer, edges, setEdges]);

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

  const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) => {
    const nextNodeIds = selectedNodes.map((node) => node.id);
    const nextEdgeIds = selectedEdges.map((edge) => edge.id);
    setSelectedNodeIds((current) => sameStringList(current, nextNodeIds) ? current : nextNodeIds);
    setSelectedEdgeIds((current) => sameStringList(current, nextEdgeIds) ? current : nextEdgeIds);
  }, []);

  useEffect(() => {
    const selectedEdgeSet = new Set(selectedEdgeIds);
    setEdges((current) => {
      let changed = false;
      const nextEdges = current.map((edge) => {
        const shouldSelect = selectedEdgeSet.has(edge.id);
        const currentStroke = (edge.style as React.CSSProperties | undefined)?.stroke;
        const expectedStroke = shouldSelect ? selectedEdgeStyle.stroke : edgeStyle.stroke;
        if (edge.selected === shouldSelect && currentStroke === expectedStroke) return edge;
        changed = true;
        return normalizeCanvasEdge({ ...edge, selected: shouldSelect }, edge.sourceHandle || 'out', edge.targetHandle || 'in');
      });
      return changed ? nextEdges : current;
    });
  }, [selectedEdgeIds, setEdges]);

  const selectEdge = useCallback((edgeId: string) => {
    setSelectedNodeIds([]);
    setSelectedEdgeIds((current) => sameStringList(current, [edgeId]) ? current : [edgeId]);
    setEdges((current) => current.map((edge) => (
      normalizeCanvasEdge({ ...edge, selected: edge.id === edgeId }, edge.sourceHandle || 'out', edge.targetHandle || 'in')
    )));
    setStatusText('已选中线条，可点击右上角“删除线条”或按 Delete');
  }, [setEdges]);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation();
    selectEdge(edge.id);
  }, [selectEdge]);

  const persistGeneratedNodeData = useCallback(async (node: Node, nextData: Record<string, any>) => {
    setNodes((current) => current.map((item) => (
      item.id === node.id ? { ...item, data: { ...item.data, ...nextData } } : item
    )));
    await updateCanvasNode(node.id, { data: nextData });
  }, [setNodes]);

  const generateCanvasImageTarget = useCallback(async (target: Extract<CanvasGenerationTarget, { kind: 'image' }>) => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const imageNode = nodeMap.get(target.targetNodeId);
    const scriptNode = nodeMap.get(target.scriptNodeId);

    if (!imageNode || !scriptNode) {
      setStatusText('请先将“剧本节点”的右侧圆点连接到“图片节点”的左侧圆点');
      return;
    }
    if (!target.hasPromptInput) {
      setStatusText('请先在剧本节点或底部 AI 指令中输入要生成的内容');
      return;
    }

    setIsGenerating(true);
    setStatusText(generationMode === 'gpu' ? '正在提交本地GPU生成任务...' : '正在通过 API 生成图片...');

    try {
      let generatedUrl = '';
      let generatedFileId: string | null | undefined;

      if (generationMode === 'gpu') {
        const comfyuiAvailable = await fetchComfyuiAvailable();
        if (!comfyuiAvailable) {
          throw new Error('当前没有在线 GPU Agent，请在后台“集群节点监控”确认节点在线，或切回 API 生成');
        }

        const gpuResults = await generateWithComfyUIWorkflowQueued(
          'qwen',
          target.prompt,
          EMPTY_REFERENCE_IMAGE,
          [],
          -1,
          undefined,
          { entityType: 'canvas_node', entityId: imageNode.id, fileRole: 'canvas_image', projectId, episodeId },
          {
            title: '画布 GPU 图片生成',
            kind: 'qwen-image',
            targetPage: 'canvas',
            targetEntityType: 'canvas_node',
            targetEntityId: imageNode.id,
            targetItemId: imageNode.id,
            targetProjectId: projectId,
            episodeId,
            fileRole: 'canvas_image',
          },
        ) as GeneratedImageResult[];
        generatedUrl = gpuResults[0]?.url || '';
        generatedFileId = gpuResults[0]?.fileId;
      } else {
        const results = await generateGeminiImageVariant({
          model: CANVAS_IMAGE_MODEL,
          prompt: target.prompt,
          aspectRatio: '16:9',
          imageSize: '2K',
          entityType: 'canvas_node',
          entityId: imageNode.id,
          fileRole: 'canvas_image',
          projectId,
          episodeId,
        });
        generatedUrl = results[0]?.fileUrl || results[0]?.url || '';
        generatedFileId = results[0]?.fileId;
      }

      if (!generatedUrl) throw new Error('图片生成接口未返回图片地址');

      const nextData = {
        ...getSerializableNodeData(imageNode),
        imageUrl: generatedUrl,
        fileId: generatedFileId,
        prompt: target.prompt,
        generationMode,
        generatedAt: new Date().toISOString(),
        sourceScriptNodeId: scriptNode.id,
      };

      await persistGeneratedNodeData(imageNode, nextData);
      setSelectedNodeIds([imageNode.id]);
      setSelectedEdgeIds([]);
      setStatusText(generationMode === 'gpu' ? 'GPU 图片已生成并写入图片节点，可继续生成下游音频/视频' : 'API 图片已生成并写入图片节点，可继续生成下游音频/视频');
    } catch (error) {
      console.error('canvas image generation failed', error);
      const message = error instanceof Error ? error.message : '图片生成失败';
      setStatusText(`图片生成失败：${message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [episodeId, generationMode, nodes, persistGeneratedNodeData, projectId]);

  const generateCanvasAudioTarget = useCallback(async (target: Extract<CanvasGenerationTarget, { kind: 'audio' }>) => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const audioNode = nodeMap.get(target.targetNodeId);
    const text = target.text.trim();

    if (!audioNode) {
      setStatusText('请先添加或选中音频节点');
      return;
    }
    if (!text) {
      setStatusText('请先连接有文字的剧本节点，或在底部 AI 指令中输入要朗读的文本');
      return;
    }

    setIsGenerating(true);
    setStatusText('正在生成音频...');

    try {
      const result = await minimaxTTSSync({
        text,
        voice_id: CANVAS_DEFAULT_VOICE_ID,
        speed: 1,
        pitch: 0,
        entity_type: 'canvas_node',
        entity_id: audioNode.id,
        file_role: 'canvas_audio',
        project_id: projectId,
        episode_id: episodeId,
      });
      const audioUrl = result.audio_url || result.file_url || '';
      if (!audioUrl) throw new Error('音频生成接口未返回 audio_url');

      const nextData = {
        ...getSerializableNodeData(audioNode),
        audioUrl,
        fileId: result.file_id,
        fileUrl: result.file_url,
        durationMs: result.duration_ms,
        text,
        voiceId: CANVAS_DEFAULT_VOICE_ID,
        generatedAt: new Date().toISOString(),
        sourceScriptNodeId: target.scriptNodeId,
        sourceImageNodeId: target.imageNodeId,
      };

      await persistGeneratedNodeData(audioNode, nextData);
      setSelectedNodeIds([audioNode.id]);
      setSelectedEdgeIds([]);
      setStatusText('音频已生成并写入音频节点，可继续生成下游视频');
    } catch (error) {
      console.error('canvas audio generation failed', error);
      const message = error instanceof Error ? error.message : '音频生成失败';
      setStatusText(`音频生成失败：${message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [episodeId, nodes, persistGeneratedNodeData, projectId]);

  const generateCanvasVideoTarget = useCallback(async (target: Extract<CanvasGenerationTarget, { kind: 'video' }>) => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const videoNode = nodeMap.get(target.targetNodeId);

    if (!videoNode) {
      setStatusText('请先添加或选中视频节点');
      return;
    }
    if (!target.imageUrl) {
      setStatusText('请先生成上游图片，或将已有图片节点连接到视频节点');
      return;
    }

    const videoParams = buildCanvasSeedanceVideoParams(target);
    const mediaInputs: SeedanceMediaInput[] = videoParams.media_inputs;
    const prompt = target.prompt || CANVAS_DEFAULT_VIDEO_PROMPT;
    const submittedAt = new Date().toISOString();

    setIsGenerating(true);
    setStatusText(target.audioUrl ? '正在提交视频生成任务（先按图片生成，音频节点保留用于后续合成）...' : '正在提交视频生成任务...');

    try {
      const response = await submitSeedanceTask({
        sub_model: 'fast',
        prompt,
        media_inputs: mediaInputs,
        resolution: '720p',
        ratio: 'adaptive',
        duration: 5,
        generate_audio: videoParams.generate_audio,
      }, {
        entity_type: 'canvas_node',
        entity_id: videoNode.id,
        file_role: 'canvas_video',
        project_id: projectId,
        episode_id: episodeId,
      });

      const backendTaskId = response.task_id;
      if (!backendTaskId) throw new Error('视频生成接口未返回 task_id');

      const pendingData = {
        ...getSerializableNodeData(videoNode),
        taskId: backendTaskId,
        taskStatus: 'processing',
        prompt,
        mediaInputs,
        submittedAt,
        sourceScriptNodeId: target.scriptNodeId,
        sourceImageNodeId: target.imageNodeId,
        sourceAudioNodeId: target.audioNodeId,
      };

      await persistGeneratedNodeData(videoNode, pendingData);
      setSelectedNodeIds([videoNode.id]);
      setSelectedEdgeIds([]);

      startVideoPoll(`canvas-video:${videoNode.id}:${generateUUID()}`, {
        taskId: backendTaskId,
        title: '画布视频生成',
        kind: 'seedance-fast',
        targetPage: 'canvas',
        targetEntityType: 'canvas_node',
        targetEntityId: videoNode.id,
        episodeId,
        projectId,
        callbacks: {
          onProgress: (progress) => {
            const displayProgress = progress > 1 ? Math.round(progress) : Math.round(progress * 100);
            setStatusText(`视频生成中 ${displayProgress}%...`);
          },
          onComplete: ({ status }) => {
            const result = getCanvasVideoResult(status);
            if (!result.url) {
              setStatusText('视频任务已完成，但后端未返回视频地址');
              return;
            }

            const nextData = {
              ...pendingData,
              videoUrl: result.url,
              videoFilename: result.filename,
              videoGenerateTime: result.generateTime,
              taskStatus: 'completed',
              completedAt: new Date().toISOString(),
              generatedAt: new Date().toISOString(),
            };

            persistGeneratedNodeData(videoNode, nextData)
              .then(() => setStatusText('视频已生成并写入视频节点'))
              .catch((error) => {
                console.warn('persist canvas video result failed', error);
                setStatusText('视频已生成，但写入视频节点失败，请刷新后检查任务历史');
              });
          },
          onFail: (error) => {
            setStatusText(`视频生成失败：${error}`);
            const nextData = {
              ...pendingData,
              taskStatus: 'failed',
              error,
            };
            persistGeneratedNodeData(videoNode, nextData).catch((persistError) => {
              console.warn('persist canvas video failure failed', persistError);
            });
          },
        },
      });

      setStatusText(target.audioUrl ? '视频任务已提交，完成后会写入视频节点；音频节点暂不传入 Seedance' : '视频任务已提交；上游音频为空，将由视频模型自行生成或保持无音频');
    } catch (error) {
      console.error('canvas video generation failed', error);
      const message = error instanceof Error ? error.message : '视频生成失败';
      setStatusText(`视频生成失败：${message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [episodeId, nodes, persistGeneratedNodeData, projectId]);

  const generateCanvasContent = useCallback(async () => {
    if (isGenerating) return;

    const target = resolveCanvasGenerationTarget(nodes, edges, selectedNodeIds, agentCommand);
    if (!target) {
      setStatusText('请先添加并连接剧本、图片、音频或视频节点');
      return;
    }

    if (target.kind === 'image') {
      await generateCanvasImageTarget(target);
      return;
    }
    if (target.kind === 'audio') {
      await generateCanvasAudioTarget(target);
      return;
    }
    await generateCanvasVideoTarget(target);
  }, [agentCommand, edges, generateCanvasAudioTarget, generateCanvasImageTarget, generateCanvasVideoTarget, isGenerating, nodes, selectedNodeIds]);

  const currentGenerationTarget = useMemo(
    () => resolveCanvasGenerationTarget(nodes, edges, selectedNodeIds, agentCommand),
    [agentCommand, edges, nodes, selectedNodeIds],
  );

  const generateButtonLabel = isGenerating
    ? '生成中'
    : currentGenerationTarget?.kind === 'audio'
      ? '生成音频'
      : currentGenerationTarget?.kind === 'video'
        ? '生成视频'
        : generationMode === 'gpu'
          ? 'GPU生成'
          : '生成图片';

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
        onSelectionChange={onSelectionChange}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={edgeStyle}
        connectionLineType={ConnectionLineType.SmoothStep}
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
          zIndex: 0,
          interactionWidth: 32,
        }}
        isValidConnection={(connection) =>
          Boolean(connection.source && connection.target && connection.source !== connection.target)
        }
        deleteKeyCode={null}
        fitView
        style={{ background: '#0d0d1a' }}
      >
        <CanvasEdgeOverlay
          wrapperRef={reactFlowWrapper}
          edges={edges}
          selectedEdgeIds={selectedEdgeIds}
          nodePositionKey={nodePositionKey}
          onEdgeSelect={selectEdge}
        />
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

        <Panel position="top-center">
          {statusText && (
            <div style={{
              background: 'rgba(37,37,64,0.92)',
              border: '1px solid #7c83ff33',
              borderRadius: 999,
              color: '#c7d2fe',
              fontSize: '12px',
              padding: '7px 13px',
              boxShadow: '0 10px 24px rgba(0,0,0,0.22)',
            }}>
              {statusText}
            </div>
          )}
        </Panel>

        <Panel position="top-right">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
            {(selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) && (
              <button
                onClick={selectedNodeIds.length === 0 && selectedEdgeIds.length > 0 ? deleteSelectedEdges : deleteSelected}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  border: '1px solid rgba(248,113,113,0.7)',
                  background: 'rgba(127,29,29,0.82)',
                  color: '#fecaca',
                  borderRadius: 12,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.3)',
                }}
                title={selectedNodeIds.length === 0 && selectedEdgeIds.length > 0 ? '删除选中的线条' : '删除选中的节点和线条'}
              >
                <Trash2 size={16} /> {selectedNodeIds.length === 0 && selectedEdgeIds.length > 0 ? `删除线条 (${selectedEdgeIds.length})` : '\u5220\u9664\u9009\u4e2d'}
              </button>
            )}
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
            alignItems: 'center', minWidth: '620px'
          }}>
            <div
              className="nodrag nopan"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: '#1a1a2e',
                border: '1px solid #444',
                borderRadius: 8,
                padding: 3,
                gap: 3,
              }}
            >
              {([
                { mode: 'api' as const, label: 'API', icon: <Sparkles size={13} /> },
                { mode: 'gpu' as const, label: '本地GPU', icon: <Zap size={13} /> },
              ]).map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => setGenerationMode(item.mode)}
                  disabled={isGenerating}
                  title={item.mode === 'gpu' ? '使用 ComfyUI GPU Agent 生成' : '使用外部图像 API 生成'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 9px',
                    border: 'none',
                    borderRadius: 6,
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                    color: generationMode === item.mode ? '#fff' : '#a5b4fc',
                    background: generationMode === item.mode ? '#7c83ff' : 'transparent',
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
            <Sparkles size={18} color="#7c83ff" />
            <input
              className="nodrag nowheel"
              type="text"
              value={agentCommand}
              onChange={(event) => setAgentCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  generateCanvasContent();
                }
              }}
              placeholder="AI 指令：描述你想创建的内容..."
              style={{
                flex: 1, background: 'transparent', border: 'none',
                color: '#e0e0e0', outline: 'none', fontSize: '14px'
              }}
            />
            <button
              onClick={generateCanvasContent}
              disabled={isGenerating}
              style={{
              padding: '6px 16px', background: isGenerating ? '#4b5563' : '#7c83ff', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: isGenerating ? 'wait' : 'pointer',
              fontSize: '13px'
            }}>
              {generateButtonLabel}
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
