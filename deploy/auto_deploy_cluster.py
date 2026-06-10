#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全自动集群部署工具 - 增强版
支持：
1. 自动检测 GPU 数量
2. 自动分配端口
3. 自动修改启动脚本
4. 自动生成 cluster_config.py
"""

import yaml
import subprocess
import sys
import os
import re
from pathlib import Path
from typing import Dict, List, Tuple
import argparse
import time

class AutoClusterDeployer:
    def __init__(self, config_file="servers_config.yaml"):
        self.config_file = config_file
        self.config = self.load_config()
        self.detected_gpus = {}  # 缓存检测到的 GPU 信息
        self.ssh_tunnels = []  # 记录创建的SSH隧道进程
        
    def load_config(self) -> dict:
        """加载配置文件"""
        if not os.path.exists(self.config_file):
            print(f"❌ 配置文件不存在: {self.config_file}")
            print(f"💡 请先创建配置文件")
            sys.exit(1)
        
        with open(self.config_file, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    
    def run_ssh_command(self, host: str, port: int, user: str, 
                       command: str, password: str = None, 
                       silent: bool = False) -> tuple:
        """执行SSH命令"""
        ssh_cmd = f"ssh -o StrictHostKeyChecking=no -p {port} {user}@{host}"
        
        if password:
            ssh_cmd = f"sshpass -p '{password}' {ssh_cmd}"
        
        ssh_cmd += f" '{command}'"
        
        if not silent:
            print(f"  [SSH] {command[:60]}...")
        
        result = subprocess.run(
            ssh_cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    
    def detect_gpus(self, server: dict) -> List[int]:
        """自动检测服务器的 GPU 数量"""
        name = server['name']
        host = server['host']
        port = server['ssh_port']
        user = server['ssh_user']
        password = server.get('ssh_password', '')
        
        print(f"\n🔍 检测 {name} 的 GPU...")
        
        # 使用 nvidia-smi 检测
        cmd = "nvidia-smi --query-gpu=index --format=csv,noheader 2>/dev/null || echo ''"
        code, stdout, stderr = self.run_ssh_command(host, port, user, cmd, password, silent=True)
        
        if code == 0 and stdout:
            gpu_ids = [int(line.strip()) for line in stdout.split('\n') if line.strip().isdigit()]
            print(f"  ✅ 检测到 {len(gpu_ids)} 张 GPU: {gpu_ids}")
            return gpu_ids
        else:
            print(f"  ⚠️  无法检测 GPU，假设 1 张卡")
            return [0]
    
    def setup_ssh_tunnel(self, server: dict, remote_port: int, local_port: int) -> bool:
        """设置SSH隧道"""
        name = server['name']
        host = server['host']
        ssh_port = server['ssh_port']
        user = server['ssh_user']
        password = server.get('ssh_password', '')
        
        print(f"\n  🔗 设置SSH隧道: 远程{remote_port} → 本地{local_port}")
        
        # 检查本地端口是否已被占用
        check_cmd = f"lsof -i :{local_port} 2>/dev/null || netstat -tuln 2>/dev/null | grep :{local_port} || true"
        result = subprocess.run(check_cmd, shell=True, capture_output=True, text=True)
        if result.stdout.strip():
            print(f"    ⚠️  本地端口 {local_port} 已被占用")
            # 尝试关闭旧的SSH隧道
            kill_cmd = f"pkill -f 'ssh.*-L {local_port}:localhost:{remote_port}' || true"
            subprocess.run(kill_cmd, shell=True)
            import time
            time.sleep(2)
        
        # 构建SSH隧道命令
        ssh_cmd = f"ssh -L {local_port}:localhost:{remote_port} -N -f " \
                  f"-o ServerAliveInterval=60 " \
                  f"-o ServerAliveCountMax=3 " \
                  f"-o StrictHostKeyChecking=no " \
                  f"-p {ssh_port} {user}@{host}"
        
        if password:
            ssh_cmd = f"sshpass -p '{password}' {ssh_cmd}"
        
        # 启动SSH隧道
        result = subprocess.run(ssh_cmd, shell=True, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
            print(f"    ❌ SSH隧道启动失败: {result.stderr}")
            return False
        
        # 等待隧道建立
        time.sleep(2)
        
        # 验证隧道
        verify_cmd = f"curl -s -m 3 http://localhost:{local_port}/system_stats > /dev/null 2>&1"
        verify_result = subprocess.run(verify_cmd, shell=True)
        
        if verify_result.returncode == 0:
            print(f"    ✅ SSH隧道已建立并验证成功")
            
            # 记录隧道信息
            self.ssh_tunnels.append({
                'server': name,
                'host': host,
                'remote_port': remote_port,
                'local_port': local_port
            })
            return True
        else:
            print(f"    ⚠️  SSH隧道已建立但验证失败（远程ComfyUI可能未启动）")
            return True  # 仍然返回True，因为隧道本身已建立
    
    def generate_start_script(self, server: dict, gpu_id: int, port: int) -> str:
        """生成针对特定 GPU 和端口的启动脚本"""
        original_script = server.get('start_script', '')
        comfyui_path = server['comfyui_path']
        extra_args = self.config.get('global', {}).get('comfyui_extra_args', '')
        
        if not original_script:
            # 如果没有指定启动脚本，生成默认脚本
            script_content = f"""#!/bin/bash
cd {comfyui_path}
CUDA_VISIBLE_DEVICES={gpu_id} python main.py --port {port} --listen 0.0.0.0 {extra_args}
"""
        else:
            # 读取原始启动脚本（如果是远程的）
            host = server['host']
            ssh_port = server['ssh_port']
            user = server['ssh_user']
            password = server.get('ssh_password', '')
            
            cmd = f"cat {original_script}"
            code, stdout, stderr = self.run_ssh_command(
                host, ssh_port, user, cmd, password, silent=True
            )
            
            if code != 0:
                print(f"  ⚠️  无法读取启动脚本 {original_script}，使用默认脚本")
                script_content = f"""#!/bin/bash
cd {comfyui_path}
CUDA_VISIBLE_DEVICES={gpu_id} python main.py --port {port} --listen 0.0.0.0 {extra_args}
"""
            else:
                # 修改脚本中的端口和 CUDA 设备
                script_content = stdout
                
                # 替换端口（--port 8188 → --port {port}）
                script_content = re.sub(
                    r'--port\s+\d+',
                    f'--port {port}',
                    script_content
                )
                
                # 添加 CUDA_VISIBLE_DEVICES（如果不存在）
                if 'CUDA_VISIBLE_DEVICES' not in script_content:
                    # 在 python main.py 之前添加
                    script_content = re.sub(
                        r'(python\s+main\.py)',
                        f'CUDA_VISIBLE_DEVICES={gpu_id} \\1',
                        script_content
                    )
                else:
                    # 替换现有的 CUDA_VISIBLE_DEVICES
                    script_content = re.sub(
                        r'CUDA_VISIBLE_DEVICES=\d+',
                        f'CUDA_VISIBLE_DEVICES={gpu_id}',
                        script_content
                    )
                
                # 添加额外参数（如果不存在）
                if extra_args and extra_args not in script_content:
                    script_content = re.sub(
                        r'(--listen\s+[\d\.]+)',
                        f'\\1 {extra_args}',
                        script_content
                    )
        
        return script_content
    
    def setup_and_start(self, server_name: str = None):
        """设置并启动集群"""
        print("\n" + "="*60)
        print("🚀 自动部署集群（支持SSH隧道）")
        print("="*60)
        
        servers = self.config['servers']
        if server_name:
            servers = [s for s in servers if s['name'] == server_name]
        
        all_nodes = []  # 收集所有节点信息，用于生成配置
        
        for server in servers:
            name = server['name']
            host = server['host']
            ssh_port = server['ssh_port']
            user = server['ssh_user']
            password = server.get('ssh_password', '')
            comfyui_path = server['comfyui_path']
            
            print(f"\n{'='*60}")
            print(f"📦 配置 {name} ({host})")
            print(f"{'='*60}")
            
            # 检查是否需要SSH隧道
            ssh_tunnel_config = server.get('ssh_tunnel', {})
            use_tunnel = ssh_tunnel_config.get('enabled', False)
            
            if use_tunnel:
                print(f"  🔐 检测到SSH隧道配置")
                remote_port = ssh_tunnel_config.get('remote_port', 8188)
                local_port = ssh_tunnel_config.get('local_port', 8189)
                
                # 设置SSH隧道
                if self.setup_ssh_tunnel(server, remote_port, local_port):
                    # 使用SSH隧道，节点配置为localhost
                    node_host = "127.0.0.1"
                    node_port = local_port
                    
                    # 收集节点信息
                    if 'gpus' in server:
                        for gpu in server['gpus']:
                            all_nodes.append({
                                'server_name': name,
                                'host': node_host,  # 使用localhost
                                'gpu_id': gpu['gpu_id'],
                                'port': node_port,
                                'node_type': gpu.get('node_type', 'video'),
                                'priority': gpu.get('priority', 3),
                                'max_concurrent': gpu.get('max_concurrent', 2)
                            })
                    
                    print(f"  ✅ 已配置为SSH隧道模式: localhost:{local_port} → {host}:{remote_port}")
                    continue  # 跳过常规启动流程
                else:
                    print(f"  ❌ SSH隧道设置失败，跳过此服务器")
                    continue
            
            # 跳过本地且没有启动脚本的
            if host == '127.0.0.1' and not server.get('start_script'):
                print(f"  ℹ️  本地服务器，跳过自动启动")
                
                # 但仍然收集节点信息
                if 'gpus' in server:
                    for gpu in server['gpus']:
                        all_nodes.append({
                            'server_name': name,
                            'host': host,
                            'gpu_id': gpu['gpu_id'],
                            'port': gpu.get('port', 8188),
                            'node_type': gpu.get('node_type', 'all'),
                            'priority': gpu.get('priority', 1),
                            'max_concurrent': gpu.get('max_concurrent', 1)
                        })
                continue
            
            # 1. 检测或获取 GPU 列表
            if server.get('gpu_auto_detect', False):
                gpu_ids = self.detect_gpus(server)
                self.detected_gpus[name] = gpu_ids
            elif 'gpus' in server:
                gpu_ids = [gpu['gpu_id'] for gpu in server['gpus']]
            else:
                print(f"  ⚠️  未配置 GPU，假设 1 张卡")
                gpu_ids = [0]
            
            # 2. 停止旧的 ComfyUI 进程
            print(f"\n  🛑 停止旧的 ComfyUI 进程...")
            stop_cmd = "pkill -f 'python.*main.py' || true"
            self.run_ssh_command(host, ssh_port, user, stop_cmd, password, silent=True)
            time.sleep(2)
            
            # 3. 为每张 GPU 生成并启动 ComfyUI
            start_port = server.get('gpu_start_port', 8188)
            
            for idx, gpu_id in enumerate(gpu_ids):
                port = start_port + idx
                
                print(f"\n  {'─'*50}")
                print(f"  🎮 配置 GPU {gpu_id} @ 端口 {port}")
                print(f"  {'─'*50}")
                
                # 生成启动脚本
                script_content = self.generate_start_script(server, gpu_id, port)
                
                # 保存启动脚本到远程服务器
                script_name = f"start_gpu{gpu_id}_port{port}.sh"
                script_path = f"{comfyui_path}/{script_name}"
                
                # 上传脚本
                upload_cmd = f"cat > {script_path} << 'EOFSCRIPT'\n{script_content}\nEOFSCRIPT"
                code, stdout, stderr = self.run_ssh_command(
                    host, ssh_port, user, upload_cmd, password, silent=True
                )
                
                if code != 0:
                    print(f"    ❌ 上传脚本失败: {stderr}")
                    continue
                
                # 赋予执行权限
                chmod_cmd = f"chmod +x {script_path}"
                self.run_ssh_command(host, ssh_port, user, chmod_cmd, password, silent=True)
                
                print(f"    ✅ 启动脚本已生成: {script_path}")
                
                # 启动 ComfyUI
                start_cmd = f"cd {comfyui_path} && nohup bash {script_name} > comfyui_gpu{gpu_id}_port{port}.log 2>&1 &"
                code, stdout, stderr = self.run_ssh_command(
                    host, ssh_port, user, start_cmd, password, silent=True
                )
                
                if code == 0:
                    print(f"    ✅ GPU {gpu_id} @ {port} 已启动")
                else:
                    print(f"    ❌ 启动失败: {stderr}")
                
                # 收集节点信息
                if server.get('gpu_auto_detect', False):
                    node_type = server.get('default_node_type', 'all')
                    priority = server.get('default_priority', 1)
                    max_concurrent = server.get('default_max_concurrent', 1)
                else:
                    gpu_config = next((g for g in server.get('gpus', []) if g['gpu_id'] == gpu_id), {})
                    node_type = gpu_config.get('node_type', 'all')
                    priority = gpu_config.get('priority', 1)
                    max_concurrent = gpu_config.get('max_concurrent', 1)
                
                all_nodes.append({
                    'server_name': name,
                    'host': host,
                    'gpu_id': gpu_id,
                    'port': port,
                    'node_type': node_type,
                    'priority': priority,
                    'max_concurrent': max_concurrent
                })
        
        print(f"\n{'='*60}")
        print("⏳ 等待 ComfyUI 完全启动（30秒）...")
        print("="*60)
        time.sleep(30)
        
        # 4. 生成 cluster_config.py
        self.generate_cluster_config(all_nodes)
        
        print(f"\n{'='*60}")
        print("✅ 集群部署完成！")
        print("="*60)
        
        # 显示SSH隧道信息
        if self.ssh_tunnels:
            print(f"\n🔗 已建立的SSH隧道:")
            for tunnel in self.ssh_tunnels:
                print(f"  - {tunnel['server']}: localhost:{tunnel['local_port']} → {tunnel['host']}:{tunnel['remote_port']}")
            print(f"\n💡 关闭SSH隧道: python3 auto_deploy_cluster.py stop-tunnels")
        
        print("\n📝 下一步:")
        print("1. 检查节点状态: python3 auto_deploy_cluster.py check")
        print("2. 应用配置: cp cluster_config_generated.py cluster_config.py")
        print("3. 启动主服务器: bash start_cluster.sh")
    
    def check_status(self):
        """检查所有节点状态"""
        print("\n" + "="*60)
        print("📊 检查节点状态")
        print("="*60)
        
        # 首先检查SSH隧道
        print(f"\n🔗 SSH隧道状态:")
        print("-" * 40)
        tunnel_cmd = "ps aux | grep 'ssh.*-L.*localhost' | grep -v grep || echo ''"
        result = subprocess.run(tunnel_cmd, shell=True, capture_output=True, text=True)
        if result.stdout.strip():
            for line in result.stdout.strip().split('\n'):
                match = re.search(r'-L (\d+):localhost:(\d+).*?(\S+@\S+)', line)
                if match:
                    local_port, remote_port, connection = match.groups()
                    print(f"  🟢 localhost:{local_port} → {remote_port} ({connection})")
        else:
            print(f"  ℹ️  没有运行的SSH隧道")
        
        # 检查ComfyUI节点
        for server in self.config['servers']:
            name = server['name']
            host = server['host']
            port = server['ssh_port']
            user = server['ssh_user']
            password = server.get('ssh_password', '')
            
            print(f"\n🖥️  {name} ({host}):")
            print("-" * 40)
            
            # 检查运行的 ComfyUI 进程
            cmd = "ps aux | grep 'python.*main.py.*--port' | grep -v grep || echo ''"
            code, stdout, stderr = self.run_ssh_command(
                host, port, user, cmd, password, silent=True
            )
            
            if stdout:
                # 解析端口和 GPU
                for line in stdout.split('\n'):
                    if '--port' in line:
                        port_match = re.search(r'--port\s+(\d+)', line)
                        cuda_match = re.search(r'CUDA_VISIBLE_DEVICES=(\d+)', line)
                        
                        if port_match:
                            comfyui_port = port_match.group(1)
                            gpu_id = cuda_match.group(1) if cuda_match else '?'
                            print(f"  🟢 GPU {gpu_id} @ 端口 {comfyui_port}: 运行中")
            else:
                print(f"  🔴 没有运行的 ComfyUI 进程")
    
    def stop_tunnels(self):
        """关闭所有SSH隧道"""
        print("\n" + "="*60)
        print("🛑 关闭SSH隧道")
        print("="*60)
        
        # 查找所有SSH隧道进程
        find_cmd = "ps aux | grep 'ssh.*-L.*localhost' | grep -v grep || echo ''"
        result = subprocess.run(find_cmd, shell=True, capture_output=True, text=True)
        
        if not result.stdout.strip():
            print("\nℹ️  没有运行的SSH隧道")
            return
        
        print(f"\n发现以下SSH隧道:")
        tunnels = []
        for line in result.stdout.strip().split('\n'):
            match = re.search(r'-L (\d+):localhost:(\d+)', line)
            if match:
                local_port, remote_port = match.groups()
                print(f"  - localhost:{local_port} → {remote_port}")
                tunnels.append((local_port, remote_port))
        
        if not tunnels:
            print("\n⚠️  未找到有效的SSH隧道进程")
            return
        
        print(f"\n确认关闭所有SSH隧道？(y/n): ", end='')
        choice = input().strip().lower()
        
        if choice != 'y':
            print("取消操作")
            return
        
        print(f"\n正在关闭SSH隧道...")
        for local_port, remote_port in tunnels:
            kill_cmd = f"pkill -f 'ssh.*-L {local_port}:localhost:{remote_port}'"
            subprocess.run(kill_cmd, shell=True)
            print(f"  ✅ 已关闭: localhost:{local_port} → {remote_port}")
        
        time.sleep(1)
        print(f"\n✅ 所有SSH隧道已关闭")
    
    def generate_cluster_config(self, nodes: List[dict]):
        """生成 cluster_config.py"""
        print(f"\n{'='*60}")
        print("⚙️  生成 cluster_config.py")
        print("="*60)
        
        nodes_code = []
        
        for node in nodes:
            # 🔧 修复：在节点ID中包含node_type，避免重复
            node_id = f"{node['server_name']}-gpu{node['gpu_id']}-{node['node_type']}"
            
            node_code = f"""
        ComfyUINode(
            id="{node_id}",
            host="{node['host']}",
            port={node['port']},
            node_type="{node['node_type']}",
            priority={node['priority']},
            max_concurrent={node['max_concurrent']},
            enabled=True
        ),"""
            
            nodes_code.append(node_code)
        
        config_content = f'''# -*- coding: utf-8 -*-
"""
ComfyUI 集群配置 - 自动生成
生成时间: {time.strftime("%Y-%m-%d %H:%M:%S")}
生成自: {self.config_file}

节点总数: {len(nodes)}
"""
import os
from typing import List
from dataclasses import dataclass

@dataclass
class ComfyUINode:
    """ComfyUI 节点配置"""
    id: str
    host: str
    port: int
    node_type: str = "all"
    priority: int = 1
    max_concurrent: int = 1
    enabled: bool = True
    
    @property
    def base_url(self) -> str:
        return f"http://{{self.host}}:{{self.port}}"
    
    @property
    def ws_url(self) -> str:
        return f"ws://{{self.host}}:{{self.port}}/ws"

class ClusterConfig:
    """集群配置"""
    
    # 🤖 自动生成的节点配置（共 {len(nodes)} 个节点）
    NODES: List[ComfyUINode] = [{''.join(nodes_code)}
    ]
    
    # 负载均衡策略
    LOAD_BALANCE_STRATEGY = "{self.config.get('global', {}).get('load_balance_strategy', 'priority')}"
    
    # 健康检查
    HEALTH_CHECK_INTERVAL = {self.config.get('global', {}).get('health_check_interval', 30)}
    HEALTH_CHECK_TIMEOUT = {self.config.get('global', {}).get('health_check_timeout', 10)}
    NODE_FAILURE_THRESHOLD = {self.config.get('global', {}).get('node_failure_threshold', 3)}
    
    @classmethod
    def get_enabled_nodes(cls, node_type: str = None) -> List[ComfyUINode]:
        """获取启用的节点"""
        nodes = [node for node in cls.NODES if node.enabled]
        if node_type:
            nodes = [node for node in nodes if node.node_type == node_type or node.node_type == "all"]
        return nodes
    
    @classmethod
    def get_node_by_id(cls, node_id: str) -> ComfyUINode:
        """根据ID获取节点"""
        for node in cls.NODES:
            if node.id == node_id:
                return node
        return None
    
    @classmethod
    def get_image_nodes(cls) -> List[ComfyUINode]:
        """获取图像处理节点"""
        return cls.get_enabled_nodes(node_type="image")
    
    @classmethod
    def get_video_nodes(cls) -> List[ComfyUINode]:
        """获取视频处理节点"""
        return cls.get_enabled_nodes(node_type="video")

# ========== 其他配置类（保持原有配置）==========

class RedisConfig:
    HOST = os.getenv("REDIS_HOST", "localhost")
    PORT = int(os.getenv("REDIS_PORT", "6379"))
    DB = int(os.getenv("REDIS_DB", "0"))
    PASSWORD = os.getenv("REDIS_PASSWORD", None)
    MAX_CONNECTIONS = 50
    DECODE_RESPONSES = True
    TASK_QUEUE_KEY = "comfyui:task_queue"
    PROCESSING_QUEUE_KEY = "comfyui:processing"
    COMPLETED_QUEUE_KEY = "comfyui:completed"
    FAILED_QUEUE_KEY = "comfyui:failed"
    TASK_STATUS_PREFIX = "comfyui:task:"
    TASK_RESULT_PREFIX = "comfyui:result:"
    NODE_STATUS_PREFIX = "comfyui:node:"
    NODE_LOCK_PREFIX = "comfyui:lock:"
    TASK_EXPIRE_TIME = 15552000    # 180天（确保历史任务长期可查）
    RESULT_EXPIRE_TIME = 15552000  # 180天
    QUEUE_BLOCK_TIMEOUT = 5
    MAX_RETRIES = 3
    RETRY_DELAY = 10

class QueueConfig:
    PRIORITY_HIGH = 3
    PRIORITY_NORMAL = 2
    PRIORITY_LOW = 1
    QUEUE_BLOCK_TIMEOUT = 5
    TASK_TIMEOUT = 600
    TASK_HEARTBEAT_INTERVAL = 5
    MAX_RETRIES = 3
    RETRY_DELAY = 10
    BATCH_SIZE = 10
    DEAD_LETTER_QUEUE = "comfyui:dead_letter"
    MAX_DEAD_LETTER_SIZE = 1000

class WorkerConfig:
    NUM_WORKERS = 4
    WORKER_ID_PREFIX = "worker"
    WORKER_STATUS_KEY = "comfyui:workers"
    WORKER_HEARTBEAT_INTERVAL = 10
    WORKER_TIMEOUT = 30
    TASK_PREFETCH_COUNT = 1
    GRACEFUL_SHUTDOWN_TIMEOUT = 30

class MonitorConfig:
    METRICS_ENABLED = True
    METRICS_INTERVAL = 60
    STATS_KEY = "comfyui:stats"
    METRICS = [
        "tasks_total",
        "tasks_completed",
        "tasks_failed",
        "tasks_cancelled",
        "avg_processing_time",
        "queue_length",
        "workers_active",
        "nodes_active"
    ]

class SystemConfig:
    HOST = "0.0.0.0"
    PORT = 6006
    LOG_LEVEL = "INFO"
    LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    LOG_FILE = "logs/cluster.log"
    FRONTEND_CONFIG = {{
        "title": "ComfyUI 集群管理平台",
        "description": "分布式图像生成服务",
        "version": "2.0.0"
    }}
    ALLOW_ORIGINS = ["*"]
    SESSION_TIMEOUT = 86400
    UPLOAD_DIR = "uploads"
    OUTPUT_DIR = "outputs"
    TEMP_DIR = "temp"
    MAX_UPLOAD_SIZE = 10 * 1024 * 1024
    ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"]

def validate_cluster_config() -> list:
    """验证集群配置"""
    errors = []
    if not ClusterConfig.NODES:
        errors.append("至少需要配置一个 ComfyUI 节点")
    if not RedisConfig.HOST:
        errors.append("Redis HOST 未配置")
    node_ids = [node.id for node in ClusterConfig.NODES]
    if len(node_ids) != len(set(node_ids)):
        errors.append("节点ID必须唯一")
    return errors
'''
        
        output_file = "cluster_config_generated.py"
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(config_content)
        
        print(f"\n✅ 已生成: {output_file}")
        print(f"   包含 {len(nodes)} 个节点")

def main():
    parser = argparse.ArgumentParser(description='全自动集群部署工具（支持SSH隧道）')
    parser.add_argument('action', choices=['deploy', 'check', 'stop', 'stop-tunnels'], 
                       help='操作: deploy=部署, check=检查, stop=停止, stop-tunnels=关闭SSH隧道')
    parser.add_argument('--server', type=str, help='指定服务器名称')
    parser.add_argument('--config', type=str, default='servers_config.yaml',
                       help='配置文件路径')
    
    args = parser.parse_args()
    
    deployer = AutoClusterDeployer(args.config)
    
    if args.action == 'deploy':
        deployer.setup_and_start(args.server)
    elif args.action == 'check':
        deployer.check_status()
    elif args.action == 'stop-tunnels':
        deployer.stop_tunnels()
    elif args.action == 'stop':
        print("停止功能开发中...")

if __name__ == '__main__':
    main()

