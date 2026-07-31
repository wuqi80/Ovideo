import { apiJson } from './httpClient';
import { crmMessage } from '../admin/crmUI';

export type ClusterNodeStatus = 'online' | 'busy' | 'healthy' | 'offline' | 'maintenance' | 'unavailable' | 'unknown';

export interface ClusterNodeOption {
  id: string;
  nodeId: string;
  agentId?: string;
  name: string;
  routingName?: string;
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
  if (status === 'online' || status === 'busy' || status === 'healthy' || status === 'offline' || status === 'maintenance' || status === 'unavailable') {
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
    routingName: row.routing_name ? String(row.routing_name) : undefined,
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

function matchesClusterNode(node: ClusterNodeOption, requested: string): boolean {
  const requestedKey = requested.trim().toLowerCase();
  return [node.id, node.nodeId, node.agentId, node.name, node.routingName]
    .filter(Boolean)
    .some((value) => String(value).trim().toLowerCase() === requestedKey);
}

export function clusterNodePreferenceId(node: ClusterNodeOption): string {
  return node.agentId || node.nodeId || node.id;
}

function clusterNodeLoad(node: ClusterNodeOption): number {
  const active = node.tasks ?? (node.status === 'busy' ? 1 : 0);
  const capacity = Math.max(1, node.maxConcurrent ?? 1);
  return active / capacity;
}

function hasClusterNodeCapacity(node: ClusterNodeOption): boolean {
  if (!isClusterNodeUsable(node)) return false;
  if (node.maxConcurrent == null || node.tasks == null) return true;
  return node.tasks < node.maxConcurrent;
}

/**
 * Mirrors the original cluster pool semantics: honor an explicit choice while it
 * is healthy, then prefer GPU1, then use the least-loaded healthy node.
 */
export function selectGpuTaskNode(
  nodes: ClusterNodeOption[],
  requested?: string,
): ClusterNodeOption | undefined {
  const usableNodes = nodes.filter(hasClusterNodeCapacity);
  if (requested) {
    const requestedNode = usableNodes.find((node) => matchesClusterNode(node, requested));
    if (requestedNode) return requestedNode;
  }

  const gpu1 = usableNodes.find((node) => matchesClusterNode(node, DEFAULT_GPU_NODE_NAME));
  if (gpu1) return gpu1;

  return [...usableNodes].sort((left, right) => (
    clusterNodeLoad(left) - clusterNodeLoad(right)
    || (left.tasks ?? 0) - (right.tasks ?? 0)
    || left.name.localeCompare(right.name)
  ))[0];
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
  const requestedNode = result.nodes.find((item) => matchesClusterNode(item, requested));
  const node = selectGpuTaskNode(result.nodes, requested);

  if (!node) {
    const message = 'GPU 集群当前没有可用节点，请检查节点状态后重试。';
    crmMessage.warning(message);
    throw new Error(message);
  }

  if (!explicitNodeId && requestedNode) {
    setPreferredGpuNodeId(clusterNodePreferenceId(requestedNode));
  }

  if (!requestedNode || !hasClusterNodeCapacity(requestedNode)) {
    crmMessage.info(`GPU 节点「${requested}」当前不可用，任务已自动切换到「${node.name}」。`);
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
