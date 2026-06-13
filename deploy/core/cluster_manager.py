# -*- coding: utf-8 -*-
"""
ComfyUI 集群管理器
负责节点管理、负载均衡、健康检查
"""
import asyncio
import aiohttp
import time
import logging
from typing import Optional, List, Dict
from datetime import datetime
from enum import Enum

from cluster_config import ClusterConfig, ComfyUINode

logger = logging.getLogger(__name__)

class NodeStatus(Enum):
    """节点状态"""
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    OFFLINE = "offline"
    BUSY = "busy"

class ClusterManager:
    """集群管理器"""
    
    def __init__(self, redis_client, node_type: str = None):
        """
        初始化集群管理器
        :param redis_client: Redis客户端
        :param node_type: 节点类型过滤 (image/video/None)
                         None=管理所有节点
        """
        self.redis = redis_client
        self.node_type = node_type
        self.nodes = ClusterConfig.get_enabled_nodes(node_type=node_type)
        self.node_status: Dict[str, NodeStatus] = {}
        self.node_failures: Dict[str, int] = {}
        self.node_tasks: Dict[str, int] = {}  # 当前任务数
        self.current_node_index = 0  # 轮询索引
        
        # 初始化节点状态
        for node in self.nodes:
            self.node_status[node.id] = NodeStatus.OFFLINE
            self.node_failures[node.id] = 0
            self.node_tasks[node.id] = 0
    
    async def start(self):
        """启动集群管理器"""
        type_info = f"({self.node_type}类型)" if self.node_type else "(所有类型)"
        logger.info(f"启动集群管理器{type_info}...")
        
        # 初始健康检查
        await self.check_all_nodes_health()
        
        # 启动定期健康检查
        asyncio.create_task(self._health_check_loop())
        
        logger.info(f"集群管理器{type_info}已启动，管理 {len(self.nodes)} 个节点")
    
    async def _health_check_loop(self):
        """健康检查循环"""
        while True:
            try:
                await asyncio.sleep(ClusterConfig.HEALTH_CHECK_INTERVAL)
                await self.check_all_nodes_health()
            except Exception as e:
                logger.error(f"健康检查循环错误: {e}")
    
    async def check_all_nodes_health(self):
        """检查所有节点健康状态"""
        tasks = [self.check_node_health(node) for node in self.nodes]
        await asyncio.gather(*tasks, return_exceptions=True)
    
    async def check_node_health(self, node: ComfyUINode) -> bool:
        """检查单个节点健康状态"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{node.base_url}/system_stats",
                    timeout=aiohttp.ClientTimeout(total=ClusterConfig.HEALTH_CHECK_TIMEOUT)
                ) as response:
                    if response.status == 200:
                        # 节点健康
                        self.node_status[node.id] = NodeStatus.HEALTHY
                        self.node_failures[node.id] = 0
                        
                        # 更新节点信息到 Redis
                        await self._update_node_status(node.id, {
                            "status": NodeStatus.HEALTHY.value,
                            "last_check": datetime.now().isoformat(),
                            "url": node.base_url,
                            "tasks": self.node_tasks.get(node.id, 0)
                        })
                        
                        logger.debug(f"节点 {node.id} 健康")
                        return True
                    else:
                        raise Exception(f"HTTP {response.status}")
        
        except Exception as e:
            # 节点不健康
            self.node_failures[node.id] += 1
            
            if self.node_failures[node.id] >= ClusterConfig.NODE_FAILURE_THRESHOLD:
                self.node_status[node.id] = NodeStatus.OFFLINE
                logger.warning(f"节点 {node.id} 已离线: {e}")
            else:
                self.node_status[node.id] = NodeStatus.UNHEALTHY
                logger.warning(f"节点 {node.id} 不健康 ({self.node_failures[node.id]}/{ClusterConfig.NODE_FAILURE_THRESHOLD}): {e}")
            
            await self._update_node_status(node.id, {
                "status": self.node_status[node.id].value,
                "last_check": datetime.now().isoformat(),
                "error": str(e),
                "failures": self.node_failures[node.id]
            })
            
            return False
    
    async def _update_node_status(self, node_id: str, status: dict):
        """更新节点状态到 Redis"""
        try:
            from cluster_config import RedisConfig
            key = f"{RedisConfig.NODE_STATUS_PREFIX}{node_id}"
            await self.redis.hset(key, mapping=status)
            await self.redis.expire(key, 300)  # 5分钟过期
        except Exception as e:
            logger.error(f"更新节点状态失败: {e}")
    
    def get_available_node(self, node_type: str = None) -> Optional[ComfyUINode]:
        """
        获取可用节点（负载均衡）
        :param node_type: 节点类型过滤 (image/video/all/None)
                         None=使用manager初始化时的类型
        """
        strategy = ClusterConfig.LOAD_BALANCE_STRATEGY
        
        if strategy == "round_robin":
            return self._round_robin(node_type)
        elif strategy == "least_busy":
            return self._least_busy(node_type)
        elif strategy == "priority":
            return self._priority_based(node_type)
        else:
            return self._round_robin(node_type)
    
    def _round_robin(self, node_type: str = None) -> Optional[ComfyUINode]:
        """轮询策略"""
        # 🔧 不再按类型过滤节点，所有节点都可以处理所有任务
        nodes_to_check = self.nodes
        
        healthy_nodes = [
            node for node in nodes_to_check
            if self.node_status.get(node.id) == NodeStatus.HEALTHY
            and self.node_tasks.get(node.id, 0) < node.max_concurrent
        ]
        
        if not healthy_nodes:
            logger.warning(f"没有可用的健康节点")
            return None
        
        # 轮询选择
        node = healthy_nodes[self.current_node_index % len(healthy_nodes)]
        self.current_node_index += 1
        
        logger.info(f"选择节点 {node.id} (轮询)")
        return node
    
    def _least_busy(self, node_type: str = None) -> Optional[ComfyUINode]:
        """最少忙碌策略"""
        # 🔧 不再按类型过滤节点，所有节点都可以处理所有任务
        nodes_to_check = self.nodes
        
        healthy_nodes = [
            node for node in nodes_to_check
            if self.node_status.get(node.id) == NodeStatus.HEALTHY
            and self.node_tasks.get(node.id, 0) < node.max_concurrent
        ]
        
        if not healthy_nodes:
            logger.warning(f"没有可用的健康节点")
            return None
        
        # 选择任务最少的节点
        node = min(healthy_nodes, key=lambda n: self.node_tasks.get(n.id, 0))
        
        logger.info(f"选择节点 {node.id} (最少忙碌: {self.node_tasks.get(node.id, 0)} 任务)")
        return node
    
    def _priority_based(self, node_type: str = None) -> Optional[ComfyUINode]:
        """优先级策略"""
        # 🔧 不再按类型过滤节点，所有节点都可以处理所有任务
        nodes_to_check = self.nodes
        
        healthy_nodes = [
            node for node in nodes_to_check
            if self.node_status.get(node.id) == NodeStatus.HEALTHY
            and self.node_tasks.get(node.id, 0) < node.max_concurrent
        ]
        
        if not healthy_nodes:
            logger.warning(f"没有可用的健康节点")
            return None
        
        # 按优先级排序，选择优先级最高的
        node = max(healthy_nodes, key=lambda n: n.priority)
        
        logger.info(f"选择节点 {node.id} (优先级: {node.priority})")
        return node
    
    def acquire_node(self, node_id: str) -> bool:
        """获取节点（增加任务计数）"""
        node = ClusterConfig.get_node_by_id(node_id)
        if not node:
            return False
        
        current_tasks = self.node_tasks.get(node_id, 0)
        if current_tasks >= node.max_concurrent:
            logger.warning(f"节点 {node_id} 已达到最大并发数 {node.max_concurrent}")
            return False
        
        self.node_tasks[node_id] = current_tasks + 1
        logger.debug(f"节点 {node_id} 任务数: {self.node_tasks[node_id]}/{node.max_concurrent}")
        return True
    
    def release_node(self, node_id: str):
        """释放节点（减少任务计数）"""
        if node_id in self.node_tasks:
            self.node_tasks[node_id] = max(0, self.node_tasks[node_id] - 1)
            logger.debug(f"节点 {node_id} 任务数: {self.node_tasks[node_id]}")
    
    def get_cluster_stats(self) -> dict:
        """获取集群统计信息"""
        total_nodes = len(self.nodes)
        healthy_nodes = sum(1 for s in self.node_status.values() if s == NodeStatus.HEALTHY)
        total_tasks = sum(self.node_tasks.values())
        max_capacity = sum(node.max_concurrent for node in self.nodes if self.node_status.get(node.id) == NodeStatus.HEALTHY)
        
        return {
            "total_nodes": total_nodes,
            "healthy_nodes": healthy_nodes,
            "offline_nodes": total_nodes - healthy_nodes,
            "total_tasks": total_tasks,
            "max_capacity": max_capacity,
            "utilization": (total_tasks / max_capacity * 100) if max_capacity > 0 else 0,
            "nodes": [
                {
                    "id": node.id,
                    "url": node.base_url,
                    "status": self.node_status.get(node.id, NodeStatus.OFFLINE).value,
                    "tasks": self.node_tasks.get(node.id, 0),
                    "max_concurrent": node.max_concurrent,
                    "priority": node.priority
                }
                for node in self.nodes
            ]
        }

