import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Server } from 'lucide-react';
import {
  clusterNodePreferenceId,
  DEFAULT_GPU_NODE_NAME,
  fetchClusterNodes,
  getPreferredGpuNodeId,
  isClusterNodeUsable,
  setPreferredGpuNodeId,
  type ClusterNodeOption,
} from '../services/clusterNodeService';

export interface GpuNodeSelection {
  id: string;
  name: string;
  preferredAgentId?: string;
  preferredNodeId: string;
  usable: boolean;
}

interface GpuNodeSelectorProps {
  onSelectionChange: (selection: GpuNodeSelection | null) => void;
  disabled?: boolean;
  className?: string;
}

function matchesNode(node: ClusterNodeOption, value: string): boolean {
  const key = value.trim().toLowerCase();
  return [node.id, node.nodeId, node.agentId, node.name, node.routingName]
    .filter(Boolean)
    .some(candidate => String(candidate).trim().toLowerCase() === key);
}

export function toGpuNodeSelection(node: ClusterNodeOption): GpuNodeSelection {
  return {
    id: node.id,
    name: node.name,
    preferredAgentId: node.agentId || (node.kind === 'agent' ? node.id : undefined),
    preferredNodeId: node.nodeId || node.id,
    usable: isClusterNodeUsable(node),
  };
}

export const GpuNodeSelector: React.FC<GpuNodeSelectorProps> = ({
  onSelectionChange,
  disabled = false,
  className = '',
}) => {
  const [nodes, setNodes] = useState<ClusterNodeOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const selectedNode = useMemo(
    () => nodes.find(node => node.id === selectedId),
    [nodes, selectedId],
  );
  const selectedUsable = Boolean(selectedNode && isClusterNodeUsable(selectedNode));

  const selectNode = useCallback((node: ClusterNodeOption | undefined, persist = false) => {
    setSelectedId(node?.id || '');
    onSelectionChange(node ? toGpuNodeSelection(node) : null);
    if (node && persist) setPreferredGpuNodeId(clusterNodePreferenceId(node));
  }, [onSelectionChange]);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchClusterNodes();
      setNodes(result.nodes);
      setMessage(result.message || '');

      const requested = getPreferredGpuNodeId();
      const requestedNode = result.nodes.find(node => matchesNode(node, requested));
      const usableNodes = result.nodes.filter(isClusterNodeUsable);
      const fallback = usableNodes.find(node => (
        node.routingName === DEFAULT_GPU_NODE_NAME || node.name === DEFAULT_GPU_NODE_NAME
      ))
        || usableNodes[0]
        || result.nodes[0];
      const next = requestedNode || fallback;
      selectNode(next, Boolean(next));
    } catch (error) {
      console.warn('[GpuNodeSelector] cluster nodes unavailable:', error);
      setNodes([]);
      setMessage('处理集群节点状态获取失败，请刷新重试。');
      selectNode(undefined);
    } finally {
      setLoading(false);
    }
  }, [selectNode]);

  useEffect(() => {
    void loadNodes();
  }, [loadNodes]);

  return (
    <div className={`rounded-md border border-n40 bg-n20 p-3 space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-n700" htmlFor="gpu-node-selector">
          <Server size={13} />
          处理集群节点
        </label>
        <button
          type="button"
          onClick={() => void loadNodes()}
          disabled={disabled || loading}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary-hover disabled:opacity-50"
          title="刷新处理节点状态"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>
      <select
        id="gpu-node-selector"
        aria-label="处理集群节点"
        value={selectedId}
        onChange={event => {
          const node = nodes.find(item => item.id === event.target.value);
          selectNode(node, true);
        }}
        disabled={disabled || loading || nodes.length === 0}
        className="w-full px-2.5 py-2 rounded bg-n0 border border-n40 text-xs text-n700 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-n20 disabled:text-n100"
      >
        {nodes.length === 0 && <option value="">暂无可用处理节点</option>}
        {nodes.map(node => (
          <option key={node.id} value={node.id}>
            {node.name} · {node.status}
            {node.tasks != null && node.maxConcurrent != null ? ` · ${node.tasks}/${node.maxConcurrent}` : ''}
          </option>
        ))}
      </select>
      <p className={`text-[10px] leading-4 ${selectedUsable ? 'text-g400' : 'text-amber-600'}`}>
        {selectedNode
          ? (selectedUsable ? `${selectedNode.name} 可用；繁忙时任务自动排队。` : `${selectedNode.name} 当前不可用。`)
          : (loading ? '正在读取处理节点...' : '当前没有可用处理节点。')}
        {message ? ` ${message}` : ''}
      </p>
    </div>
  );
};
