#!/bin/bash
# -*- coding: utf-8 -*-

echo "========================================"
echo "从 YAML 生成并应用集群配置"
echo "========================================"
echo ""

echo "[1/3] 从 servers_config.yaml 生成配置..."
python3 auto_deploy_cluster.py deploy --config servers_config.yaml
if [ $? -ne 0 ]; then
    echo "❌ 配置生成失败"
    exit 1
fi
echo ""

echo "[2/3] 应用生成的配置到 cluster_config.py..."
if [ -f cluster_config_generated.py ]; then
    cp cluster_config_generated.py cluster_config.py
    echo "✅ 配置已应用到 cluster_config.py"
else
    echo "❌ 未找到 cluster_config_generated.py"
    exit 1
fi
echo ""

echo "[3/3] 验证配置..."
python3 -c "from cluster_config import ClusterConfig; nodes = ClusterConfig.get_enabled_nodes(); print(f'✅ 配置验证通过，共 {len(nodes)} 个节点'); [print(f'  - {n.id}: {n.base_url} (类型:{n.node_type}, 优先级:{n.priority})') for n in nodes]"
echo ""

echo "========================================"
echo "✅ 配置已更新！"
echo "现在需要重启服务以使配置生效："
echo "   python3 cluster_main.py"
echo "========================================"

