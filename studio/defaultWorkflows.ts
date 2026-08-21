import {
  STUDIO_IMAGE_MODEL_CONFIGURED,
  STUDIO_TEXT_MODEL_CONFIGURED,
  STUDIO_VIDEO_MODEL_STANDARD,
} from './services/modelOptions';
import type { StudioSnapshot } from './services/runtime';
import { NodeStatus, NodeType, type AppNode, type Connection, type Group, type Workflow } from './types';

export const STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID = 'builtin-standard-text-image-video-v1';

const PROMPT_NODE_ID = 'builtin-standard-prompt';
const IMAGE_NODE_ID = 'builtin-standard-image';
const VIDEO_NODE_ID = 'builtin-standard-video';

function createNodes(): AppNode[] {
  return [
    {
      id: PROMPT_NODE_ID,
      type: NodeType.PROMPT_INPUT,
      x: 40,
      y: 120,
      width: 360,
      title: '01 · 输入创意描述',
      status: NodeStatus.IDLE,
      data: {
        model: STUDIO_TEXT_MODEL_CONFIGURED,
        prompt: '雨夜的霓虹街道上，一位侦探撑伞走向镜头，电影感，柔和光影。',
      },
      inputs: [],
    },
    {
      id: IMAGE_NODE_ID,
      type: NodeType.IMAGE_GENERATOR,
      x: 440,
      y: 80,
      width: 360,
      title: '02 · 生成图片',
      status: NodeStatus.IDLE,
      data: {
        model: STUDIO_IMAGE_MODEL_CONFIGURED,
        aspectRatio: '16:9',
        resolution: '2K',
        imageCount: 1,
      },
      inputs: [PROMPT_NODE_ID],
    },
    {
      id: VIDEO_NODE_ID,
      type: NodeType.VIDEO_GENERATOR,
      x: 840,
      y: 80,
      width: 360,
      title: '03 · 生成视频',
      status: NodeStatus.IDLE,
      data: {
        model: STUDIO_VIDEO_MODEL_STANDARD,
        prompt: '保持主体与场景一致，人物自然向前行走，镜头缓慢推进，画面连续稳定。',
        aspectRatio: '16:9',
        duration: 5,
        videoCount: 1,
        generationMode: 'DEFAULT',
      },
      inputs: [IMAGE_NODE_ID],
    },
  ];
}

function createConnections(): Connection[] {
  return [
    { from: PROMPT_NODE_ID, to: IMAGE_NODE_ID },
    { from: IMAGE_NODE_ID, to: VIDEO_NODE_ID },
  ];
}

/**
 * The first built-in workflow intentionally contains only the minimum viable
 * creation chain. Every edge is mirrored in the target node's `inputs`, which
 * is the execution source of truth used by the Studio canvas.
 */
export function createStandardTextImageVideoWorkflow(): Workflow {
  return {
    id: STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID,
    title: '标准工作流 · 文本到图片到视频',
    thumbnail: '',
    isBuiltin: true,
    nodes: createNodes(),
    connections: createConnections(),
    groups: [],
  };
}

export function mergeBuiltinStudioWorkflows(workflows: Workflow[]): Workflow[] {
  return [
    createStandardTextImageVideoWorkflow(),
    ...workflows.filter(workflow => workflow.id !== STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID),
  ];
}

export function createDefaultStudioWorkspace(): {
  workflows: Workflow[];
  nodes: AppNode[];
  connections: Connection[];
  groups: Group[];
} {
  const workflow = createStandardTextImageVideoWorkflow();
  return {
    workflows: [workflow],
    nodes: createNodes(),
    connections: createConnections(),
    groups: [],
  };
}

export function resolveStudioWorkspace(snapshot: StudioSnapshot | null): StudioSnapshot {
  if (snapshot) {
    return {
      ...snapshot,
      workflows: mergeBuiltinStudioWorkflows(snapshot.workflows || []),
    };
  }
  return {
    schemaVersion: 1,
    assets: [],
    ...createDefaultStudioWorkspace(),
  };
}
