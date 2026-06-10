# -*- coding: utf-8 -*-
"""
任务队列管理器
基于 Redis 实现分布式任务队列，支持优先级、取消、重试
"""
import json
import uuid
import time
import asyncio
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum

from cluster_config import RedisConfig, QueueConfig

logger = logging.getLogger(__name__)

class TaskStatus(Enum):
    """任务状态"""
    PENDING = "pending"          # 等待中
    QUEUED = "queued"            # 已入队
    PROCESSING = "processing"    # 处理中
    COMPLETED = "completed"      # 已完成
    FAILED = "failed"            # 失败
    CANCELLED = "cancelled"      # 已取消
    TIMEOUT = "timeout"          # 超时

class Task:
    """任务对象"""
    
    def __init__(
        self,
        task_id: str,
        task_type: str,
        data: dict,
        priority: int = QueueConfig.PRIORITY_NORMAL,
        user_id: Optional[str] = None
    ):
        self.task_id = task_id
        self.task_type = task_type
        self.data = data
        self.priority = priority
        self.user_id = user_id
        
        self.status = TaskStatus.PENDING
        self.node_id: Optional[str] = None
        self.prompt_id: Optional[str] = None
        
        self.created_at = datetime.now().isoformat()
        self.started_at: Optional[str] = None
        self.completed_at: Optional[str] = None
        
        self.result: Optional[dict] = None
        self.error: Optional[str] = None
        self.progress: float = 0.0
        
        self.retries = 0
        self.max_retries = QueueConfig.MAX_RETRIES
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "task_id": self.task_id,
            "task_type": self.task_type,
            "data": self.data,
            "priority": self.priority,
            "user_id": self.user_id,
            "status": self.status.value,
            "node_id": self.node_id,
            "prompt_id": self.prompt_id,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "result": self.result,
            "error": self.error,
            "progress": self.progress,
            "retries": self.retries,
            "max_retries": self.max_retries
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Task':
        """从字典创建"""
        # 🔧 反序列化data字段（在_save_task中被序列化为JSON字符串）
        task_data = data["data"]
        if isinstance(task_data, str):
            try:
                task_data = json.loads(task_data) if task_data else {}
            except json.JSONDecodeError:
                task_data = {}
        
        task = cls(
            task_id=data["task_id"],
            task_type=data["task_type"],
            data=task_data,
            priority=int(data.get("priority", QueueConfig.PRIORITY_NORMAL)) if data.get("priority") else QueueConfig.PRIORITY_NORMAL,
            user_id=data.get("user_id")
        )
        
        task.status = TaskStatus(data.get("status", TaskStatus.PENDING.value))
        task.node_id = data.get("node_id") if data.get("node_id") else None
        task.prompt_id = data.get("prompt_id") if data.get("prompt_id") else None
        task.created_at = data.get("created_at", task.created_at)
        task.started_at = data.get("started_at") if data.get("started_at") else None
        task.completed_at = data.get("completed_at") if data.get("completed_at") else None
        
        # 🔧 反序列化result字段（在_save_task中被序列化为JSON字符串）
        task_result = data.get("result")
        if task_result and isinstance(task_result, str):
            try:
                task.result = json.loads(task_result) if task_result else None
            except json.JSONDecodeError:
                task.result = None
        else:
            task.result = task_result
        
        task.error = data.get("error") if data.get("error") else None
        # 🔧 确保数值类型正确转换（Redis返回的是字符串）
        task.progress = float(data.get("progress", 0.0)) if data.get("progress") else 0.0
        task.retries = int(data.get("retries", 0)) if data.get("retries") else 0
        task.max_retries = int(data.get("max_retries", QueueConfig.MAX_RETRIES)) if data.get("max_retries") else QueueConfig.MAX_RETRIES
        
        return task

class TaskQueue:
    """任务队列管理器"""

    def __init__(self, redis_client):
        self.redis = redis_client

    @staticmethod
    def _map_task_category(task_type: str) -> str:
        if not task_type:
            return 'image'
        t = task_type.lower()
        if any(k in t for k in ('video', 'i2v', 'morph', 'upscale', 'lip')):
            return 'video'
        if any(k in t for k in ('text', 'rewrite', 'storyboard')):
            return 'text'
        if 'material' in t:
            return 'material'
        return 'image'
    
    async def enqueue(self, task: Task) -> bool:
        """将任务加入队列"""
        try:
            # 保存任务状态到Redis
            task.status = TaskStatus.QUEUED
            await self._save_task(task)
            
            # 🆕 同时保存到PostgreSQL数据库
            try:
                from dao_task import TaskDAO
                from db_manager import get_db_manager
                
                db = get_db_manager()
                if db:
                    await TaskDAO.create_task(
                        task_id=task.task_id,
                        user_id=task.user_id or 'system',
                        task_type=task.task_type,
                        task_data=task.data,
                        priority=task.priority
                    )
                    logger.info(f"✅ 任务 {task.task_id} 已保存到数据库 (类型: {task.task_type})")
            except Exception as db_error:
                logger.error(f"⚠️ 保存任务到数据库失败: {db_error}", exc_info=True)
            
            # 添加到用户任务索引（使用时间戳作为分数）
            if task.user_id:
                user_tasks_key = f"{RedisConfig.TASK_STATUS_PREFIX}user:{task.user_id}"
                await self.redis.zadd(
                    user_tasks_key,
                    {task.task_id: int(time.time())}
                )
                # 设置过期时间（保留30天）
                await self.redis.expire(user_tasks_key, 30 * 86400)
            
            # 根据优先级加入队列
            queue_key = RedisConfig.TASK_QUEUE_KEY
            priority_score = task.priority * 1000000 + int(time.time())
            
            await self.redis.zadd(
                queue_key,
                {task.task_id: priority_score}
            )
            
            logger.info(f"任务 {task.task_id} 已加入队列 (优先级: {task.priority})")
            return True
        
        except Exception as e:
            logger.error(f"任务入队失败: {e}")
            return False
    
    async def dequeue(self, timeout: int = QueueConfig.QUEUE_BLOCK_TIMEOUT) -> Optional[Task]:
        """从队列取出任务（阻塞）"""
        try:
            # 使用有序集合按分数获取（优先级+时间戳）
            result = await self.redis.zpopmin(RedisConfig.TASK_QUEUE_KEY, count=1)
            
            if not result:
                return None
            
            task_id = result[0][0] if isinstance(result[0], tuple) else result[0]
            
            # 获取任务详情
            task = await self.get_task(task_id)
            if not task:
                logger.warning(f"任务 {task_id} 不存在")
                return None
            
            # 更新状态为处理中
            task.status = TaskStatus.PROCESSING
            task.started_at = datetime.now().isoformat()
            await self._save_task(task)
            
            # 加入处理队列（用于监控）
            await self.redis.zadd(
                RedisConfig.PROCESSING_QUEUE_KEY,
                {task_id: int(time.time())}
            )
            
            logger.info(f"任务 {task_id} 已出队")
            return task
        
        except Exception as e:
            logger.error(f"任务出队失败: {e}")
            return None
    
    async def complete_task(self, task_id: str, result: dict):
        """标记任务完成"""
        try:
            task = await self.get_task(task_id)
            if not task:
                logger.warning(f"任务 {task_id} 不存在")
                return False
            
            task.status = TaskStatus.COMPLETED
            task.completed_at = datetime.now().isoformat()
            task.result = result
            task.progress = 100.0
            
            await self._save_task(task)
            
            # 从处理队列移除
            await self.redis.zrem(RedisConfig.PROCESSING_QUEUE_KEY, task_id)
            
            # 加入完成队列
            await self.redis.zadd(
                RedisConfig.COMPLETED_QUEUE_KEY,
                {task_id: int(time.time())}
            )
            
            # 🆕 同步到数据库
            try:
                from dao_task import TaskDAO
                from db_manager import get_db_manager
                
                db = get_db_manager()
                if db:
                    await TaskDAO.update_task_status(
                        task_id=task_id,
                        status='completed',
                        result_data=result
                    )
                    logger.debug(f"✅ 任务 {task_id} 状态已同步到数据库")
            except Exception as db_error:
                logger.warning(f"同步任务状态到数据库失败: {db_error}")
            
            # 发布任务完成事件（SSE 推送到前端）
            task_type = task.data.get("task_type", "") if task.data else ""
            display_name = task.data.get("display_name", "") if task.data else ""
            project_id = task.data.get("project_id", "") if task.data else ""
            source_page = task.data.get("source_page", "") if task.data else ""
            try:
                await self.redis.publish(
                    f"task_complete:{task.user_id}",
                    json.dumps({
                        "type": "task_complete",
                        "task_id": task_id,
                        "status": "completed",
                        "task_type": task_type,
                        "display_name": display_name,
                        "project_id": project_id,
                        "source_page": source_page,
                        "entity_type": task.data.get("entity_type", "") if task.data else "",
                        "entity_id": task.data.get("entity_id", "") if task.data else "",
                        "file_role": task.data.get("file_role", "") if task.data else "",
                        "episode_id": task.data.get("episode_id", "") if task.data else "",
                    })
                )
            except Exception:
                pass

            # 持久化通知到数据库
            try:
                from dao_notification import NotificationDAO
                await NotificationDAO.create(
                    user_id=task.user_id,
                    title=f"{display_name or task_type or '任务'} 已完成",
                    message=f"任务 {task_id} 执行成功",
                    category=self._map_task_category(task_type),
                    task_id=task_id,
                    target_view="Video",
                    target_project_id=project_id,
                    target_page=source_page,
                )
            except Exception as ne:
                logger.debug(f"创建通知记录失败(不影响任务): {ne}")

            logger.info(f"任务 {task_id} 已完成")
            return True
        
        except Exception as e:
            logger.error(f"标记任务完成失败: {e}")
            return False
    
    async def fail_task(self, task_id: str, error: str, retry: bool = True):
        """标记任务失败"""
        try:
            task = await self.get_task(task_id)
            if not task:
                logger.warning(f"任务 {task_id} 不存在")
                return False
            
            task.error = error
            task.retries += 1
            
            # 检查是否需要重试
            if retry and task.retries < task.max_retries:
                logger.info(f"任务 {task_id} 失败，准备重试 ({task.retries}/{task.max_retries})")
                
                # 重新入队（降低优先级）
                task.status = TaskStatus.QUEUED
                task.node_id = None
                task.prompt_id = None
                await self._save_task(task)
                
                # 延迟重新入队
                await asyncio.sleep(QueueConfig.RETRY_DELAY)
                
                priority_score = (task.priority - 1) * 1000000 + int(time.time())
                await self.redis.zadd(
                    RedisConfig.TASK_QUEUE_KEY,
                    {task_id: priority_score}
                )
            else:
                # 标记为最终失败
                task.status = TaskStatus.FAILED
                task.completed_at = datetime.now().isoformat()
                await self._save_task(task)
                
                # 加入失败队列
                await self.redis.zadd(
                    RedisConfig.FAILED_QUEUE_KEY,
                    {task_id: int(time.time())}
                )
                
                logger.error(f"任务 {task_id} 最终失败: {error}")
                
                # 发布任务失败事件（SSE 推送到前端）
                fail_task_type = task.data.get("task_type", "") if task.data else ""
                fail_display_name = task.data.get("display_name", "") if task.data else ""
                fail_project_id = task.data.get("project_id", "") if task.data else ""
                fail_source_page = task.data.get("source_page", "") if task.data else ""
                try:
                    await self.redis.publish(
                        f"task_failed:{task.user_id}",
                        json.dumps({
                            "type": "task_failed",
                            "task_id": task_id,
                            "status": "failed",
                            "error": error,
                            "task_type": fail_task_type,
                            "display_name": fail_display_name,
                            "project_id": fail_project_id,
                            "source_page": fail_source_page,
                        })
                    )
                except Exception:
                    pass

                # 持久化失败通知到数据库
                try:
                    from dao_notification import NotificationDAO
                    await NotificationDAO.create(
                        user_id=task.user_id,
                        title=f"{fail_display_name or fail_task_type or '任务'} 失败",
                        message=f"任务 {task_id} 执行失败: {error[:200]}",
                        category=self._map_task_category(fail_task_type),
                        task_id=task_id,
                        target_view="Video",
                        target_project_id=fail_project_id,
                        target_page=fail_source_page,
                    )
                except Exception as ne:
                    logger.debug(f"创建失败通知记录失败(不影响任务): {ne}")
            
            # 从处理队列移除
            await self.redis.zrem(RedisConfig.PROCESSING_QUEUE_KEY, task_id)
            
            return True
        
        except Exception as e:
            logger.error(f"标记任务失败失败: {e}")
            return False
    
    async def requeue_task(self, task_id: str) -> bool:
        """
        将任务放回队列（不消耗重试次数）
        用于节点忙碌时让任务等待
        """
        try:
            task = await self.get_task(task_id)
            if not task:
                logger.warning(f"任务 {task_id} 不存在，无法放回队列")
                return False
            
            # 保持状态为QUEUED，不消耗重试次数
            task.status = TaskStatus.QUEUED
            task.node_id = None
            task.prompt_id = None
            await self._save_task(task)
            
            # 从处理队列移除
            await self.redis.zrem(RedisConfig.PROCESSING_QUEUE_KEY, task_id)
            
            # 重新入队（保持原优先级）
            priority_score = task.priority * 1000000 + int(time.time())
            await self.redis.zadd(
                RedisConfig.TASK_QUEUE_KEY,
                {task_id: priority_score}
            )
            
            logger.info(f"🔄 任务 {task_id} 已放回队列等待")
            return True
        
        except Exception as e:
            logger.error(f"放回任务失败: {e}")
            return False
    
    async def cancel_task(self, task_id: str) -> bool:
        """取消任务。

        关键：除了更新 Redis，还必须把数据库状态落为 cancelled。
        否则 /api/tasks/active 在前端刷新时会从数据库重新拉回
        pending/processing，导致"取消后刷新又出现"。

        同时兼容 Redis 中已不存在该任务（如长时间残留任务过期/被驱逐）
        的情况——此时仍尝试更新数据库 + 清理队列，让用户能取消僵尸任务。
        """
        redis_ok = False
        try:
            task = await self.get_task(task_id)
            if task:
                if task.status in [TaskStatus.QUEUED, TaskStatus.PROCESSING]:
                    task.status = TaskStatus.CANCELLED
                    task.completed_at = datetime.now().isoformat()
                    await self._save_task(task)
                    redis_ok = True
                    # 如果任务正在 ComfyUI 中处理，需要中断
                    if task.node_id and task.prompt_id:
                        # 这里需要调用 ComfyUI 的中断 API
                        # await self._interrupt_comfyui_task(task.node_id, task.prompt_id)
                        pass
                elif task.status == TaskStatus.CANCELLED:
                    redis_ok = True
                # 其它终态（completed/failed）保持不动

            # 无论 Redis 中状态如何，都把任务从队列里清掉
            await self.redis.zrem(RedisConfig.TASK_QUEUE_KEY, task_id)
            await self.redis.zrem(RedisConfig.PROCESSING_QUEUE_KEY, task_id)
        except Exception as e:
            logger.error(f"取消任务（Redis 阶段）失败: {e}")

        # 🆕 同步数据库为 cancelled —— 否则刷新会从 DB 重新拉回
        db_ok = False
        try:
            from dao_task import TaskDAO
            from db_manager import get_db_manager

            db = get_db_manager()
            if db:
                db_task = await TaskDAO.get_task(task_id)
                if db_task:
                    cur_status = db_task.get('status')
                    if cur_status in ('pending', 'processing', 'queued'):
                        await TaskDAO.update_task_status(task_id=task_id, status='cancelled')
                        db_ok = True
                    elif cur_status == 'cancelled':
                        db_ok = True
                    # completed/failed 不覆盖
        except Exception as e:
            logger.warning(f"取消任务时更新数据库失败 {task_id}: {e}")

        if not (redis_ok or db_ok):
            logger.warning(f"任务 {task_id} 在 Redis/数据库中均无法取消（可能已是终态或不存在）")
            return False

        logger.info(f"任务 {task_id} 已取消 (redis={redis_ok}, db={db_ok})")
        return True
    
    async def delete_task(self, task_id: str) -> bool:
        """彻底删除任务（从Redis中删除）"""
        try:
            task = await self.get_task(task_id)
            if not task:
                logger.warning(f"任务 {task_id} 不存在")
                return False
            
            # 从所有队列中移除
            await self.redis.zrem(RedisConfig.TASK_QUEUE_KEY, task_id)
            await self.redis.zrem(RedisConfig.PROCESSING_QUEUE_KEY, task_id)
            await self.redis.zrem(RedisConfig.COMPLETED_QUEUE_KEY, task_id)
            await self.redis.zrem(RedisConfig.FAILED_QUEUE_KEY, task_id)
            
            # 从用户任务索引中移除
            if task.user_id:
                user_tasks_key = f"{RedisConfig.TASK_STATUS_PREFIX}user:{task.user_id}"
                await self.redis.zrem(user_tasks_key, task_id)
            
            # 删除任务数据
            task_key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
            await self.redis.delete(task_key)
            
            logger.info(f"任务 {task_id} 已彻底删除")
            return True
        
        except Exception as e:
            logger.error(f"删除任务失败: {e}")
            return False
    
    async def update_progress(self, task_id: str, progress: float, message: str = ""):
        """更新任务进度"""
        try:
            task = await self.get_task(task_id)
            if not task:
                return False
            
            task.progress = min(100.0, max(0.0, progress))
            if message:
                if not task.data:
                    task.data = {}
                task.data["progress_message"] = message
            
            await self._save_task(task)
            
            # 发布进度更新事件（用于 WebSocket 推送）
            await self.redis.publish(
                f"task_progress:{task_id}",
                json.dumps({
                    "task_id": task_id,
                    "progress": task.progress,
                    "message": message
                })
            )
            
            return True
        
        except Exception as e:
            logger.error(f"更新任务进度失败: {e}")
            return False
    
    async def get_task(self, task_id: str) -> Optional[Task]:
        """获取任务"""
        try:
            key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
            data = await self.redis.hgetall(key)
            
            if not data:
                return None
            
            # 解析 JSON 字段
            if "data" in data and isinstance(data["data"], str):
                data["data"] = json.loads(data["data"])
            if "result" in data and isinstance(data["result"], str):
                data["result"] = json.loads(data["result"]) if data["result"] else None
            
            return Task.from_dict(data)
        
        except Exception as e:
            logger.error(f"获取任务失败: {e}")
            return None
    
    async def _save_task(self, task: Task):
        """保存任务状态"""
        try:
            key = f"{RedisConfig.TASK_STATUS_PREFIX}{task.task_id}"
            data = task.to_dict()
            
            # 序列化复杂字段
            data["data"] = json.dumps(data["data"]) if data["data"] else "{}"
            data["result"] = json.dumps(data["result"]) if data["result"] else ""
            
            # 确保所有None值被转换为空字符串，数值转换为字符串
            for k, v in data.items():
                if v is None:
                    data[k] = ""
                elif isinstance(v, (int, float)):
                    data[k] = str(v)
                elif not isinstance(v, str):
                    data[k] = str(v)
            
            await self.redis.hset(key, mapping=data)
            await self.redis.expire(key, RedisConfig.TASK_EXPIRE_TIME)
        
        except Exception as e:
            logger.error(f"保存任务失败: {e}")
            raise
    
    async def get_queue_length(self) -> int:
        """获取队列长度"""
        try:
            return await self.redis.zcard(RedisConfig.TASK_QUEUE_KEY)
        except:
            return 0
    
    async def get_processing_count(self) -> int:
        """获取处理中的任务数"""
        try:
            return await self.redis.zcard(RedisConfig.PROCESSING_QUEUE_KEY)
        except:
            return 0
    
    # ---- 并发控制 ----

    async def get_running_count(self, category: str) -> int:
        """获取某个类别正在执行的任务数"""
        try:
            val = await self.redis.get(f"running_count:{category}")
            return int(val) if val else 0
        except:
            return 0
    
    async def increment_running(self, category: str) -> int:
        """增加某个类别的执行计数，返回新值"""
        key = f"running_count:{category}"
        val = await self.redis.incr(key)
        await self.redis.expire(key, 3600)
        return val
    
    async def decrement_running(self, category: str) -> int:
        """减少某个类别的执行计数，返回新值"""
        key = f"running_count:{category}"
        val = await self.redis.decr(key)
        if val < 0:
            await self.redis.set(key, 0)
            val = 0
        return val
    
    async def get_user_tasks(self, user_id: str, limit: int = 100, status: Optional[str] = None) -> List[Task]:
        """获取用户的任务列表"""
        try:
            tasks = []
            
            # 构建用户任务索引键
            user_tasks_key = f"{RedisConfig.TASK_STATUS_PREFIX}user:{user_id}"
            
            # 获取用户的所有任务ID（按时间倒序）
            task_ids = await self.redis.zrevrange(user_tasks_key, 0, limit - 1)
            
            # 获取每个任务的详细信息
            for task_id in task_ids:
                task = await self.get_task(task_id)
                if task:
                    # 如果指定了状态过滤
                    if status and task.status.value != status:
                        continue
                    tasks.append(task)
            
            return tasks
        except Exception as e:
            logger.error(f"获取用户任务失败: {e}")
            return []
    
    async def cleanup_old_tasks(self, days: int = 7):
        """清理旧任务"""
        try:
            cutoff_time = int(time.time()) - (days * 86400)
            
            # 清理完成队列
            await self.redis.zremrangebyscore(
                RedisConfig.COMPLETED_QUEUE_KEY,
                0,
                cutoff_time
            )
            
            # 清理失败队列
            await self.redis.zremrangebyscore(
                RedisConfig.FAILED_QUEUE_KEY,
                0,
                cutoff_time
            )
            
            logger.info(f"已清理 {days} 天前的旧任务")
        
        except Exception as e:
            logger.error(f"清理旧任务失败: {e}")

