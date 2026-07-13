import { apiJson } from './httpClient';
import { crmMessage } from '../admin/crmUI';

export type ClusterNodeStatus = 'online' | 'busy' | 'healthy' | 'offline' | 'maintenance' | 'unknown';

export interface ClusterNodeOption {
  id: string;
  nodeId: string;
  agentId?: string;
  name: string;
  status: ClusterNodeStatus;
  kind?: string;
  host?: string;
  url?: string;
  tasks?: number;
  maxConcurrent?: number;
  lastHeartbeat?: string;
}

export interface GpuTaskRouting {
  preferredAgentId?: string;
  preferredNodeId?: string;
  node?: ClusterNodeOption;
}

const PREFERRED_GPU_NODE_KEY = 'mecha:preferred-gpu-node-id';
export const DEFAULT_GPU_NODE_NAME = 'GPU1';

interface ClusterNodesResponse {
  success?: boolean;
  nodes?: unknown;
  agent_only_mode?: boolean;
  message?: string;
}

function normalizeStatus(value: unknown): ClusterNodeStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'online' || status === 'busy' || status === 'healthy' || status === 'offline' || status === 'maintenance') {
    return status;
  }
  return 'unknown';
}

function toNodeRows(nodes: unknown): Array<Record<string, any>> {
  if (!nodes) return [];
  if (Array.isArray(nodes)) return nodes.filter(Boolean).map((row) => row as Record<string, any>);
  if (typeof nodes === 'object') {
    return Object.entries(nodes as Record<string, any>).map(([id, value]) => ({
      id,
      ...(value && typeof value === 'object' ? value : {}),
    }));
  }
  return [];
}

export function normalizeClusterNode(row: Record<string, any>, index = 0): ClusterNodeOption {
  const id = String(row.id ?? row.node_id ?? row.agent_id ?? `node-${index + 1}`);
  const status = normalizeStatus(row.status ?? row.health ?? row.state);
  const name = String(row.name ?? row.label ?? row.node_name ?? row.agent_id ?? id);
  return {
    id,
    nodeId: String(row.node_id ?? id),
    agentId: row.agent_id ? String(row.agent_id) : undefined,
    name,
    status,
    kind: row.kind ?? row.type,
    host: row.host ?? row.ip,
    url: row.url ?? row.base_url,
    tasks: Number.isFinite(Number(row.tasks ?? row.current_tasks)) ? Number(row.tasks ?? row.current_tasks) : undefined,
    maxConcurrent: Number.isFinite(Number(row.max_concurrent ?? row.maxConcurrent)) ? Number(row.max_concurrent ?? row.maxConcurrent) : undefined,
    lastHeartbeat: row.last_heartbeat ?? row.lastHeartbeat,
  };
}

export function isClusterNodeUsable(node: ClusterNodeOption): boolean {
  return node.status === 'online' || node.status === 'busy' || node.status === 'healthy';
}

export function setPreferredGpuNodeId(nodeId: string): void {
  try {
    if (!nodeId) localStorage.removeItem(PREFERRED_GPU_NODE_KEY);
    else localStorage.setItem(PREFERRED_GPU_NODE_KEY, nodeId);
  } catch {
    // Storage may be unavailable in private/restricted browser contexts.
  }
}

export function getPreferredGpuNodeId(): string {
  try {
    return localStorage.getItem(PREFERRED_GPU_NODE_KEY) || DEFAULT_GPU_NODE_NAME;
  } catch {
    return DEFAULT_GPU_NODE_NAME;
  }
}

export async function fetchClusterNodes(): Promise<{ nodes: ClusterNodeOption[]; message: string; agentOnlyMode: boolean }> {
  const data = await apiJson<ClusterNodesResponse>(
    '/api/cluster/nodes',
    { method: 'GET' },
    'Cluster Nodes',
  );
  const nodes = toNodeRows(data.nodes).map((row, index) => normalizeClusterNode(row, index));
  return {
    nodes,
    message: data.message || '',
    agentOnlyMode: Boolean(data.agent_only_mode),
  };
}

export async function resolveGpuTaskRouting(explicitNodeId?: string): Promise<GpuTaskRouting> {
  const result = await fetchClusterNodes();
  const requested = explicitNodeId || getPreferredGpuNodeId();
  const requestedKey = requested.trim().toLowerCase();
  const node = result.nodes.find((item) => (
    [item.id, item.nodeId, item.agentId, item.name]
      .filter(Boolean)
      .some((value) => String(value).trim().toLowerCase() === requestedKey)
  ));

  if (!node || !isClusterNodeUsable(node)) {
    const message = `GPU 节点「${requested}」当前不可用，请在节点选择器中切换到在线节点。`;
    crmMessage.warning(message);
    throw new Error(message);
  }

  const active = node.tasks ?? (node.status === 'busy' ? 1 : 0);
  const capacity = node.maxConcurrent ?? 1;
  if (node.status === 'busy' || active >= capacity) {
    crmMessage.info(`GPU 节点「${node.name}」正在处理任务，本次任务已进入服务端队列等待。`);
  }

  return {
    preferredAgentId: node.agentId || (node.kind === 'agent' ? node.id : undefined),
    preferredNodeId: node.nodeId || node.id,
    node,
  };
}
