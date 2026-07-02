"""
任务提交服务 — 统一封装任务准备、创建、入队
所有运行模式下都初始化（包括 AGENT_ONLY_MODE）
"""
import uuid
import logging
from typing import Optional
from datetime import datetime

from fastapi import HTTPException

from task_queue import TaskQueue, Task

logger = logging.getLogger(__name__)

_service: Optional['TaskService'] = None


def init(redis_client):
    """应用启动时调用，Redis 连接后、AGENT_ONLY_MODE 判断前"""
    global _service
    _service = TaskService(redis_client)
    logger.info("✅ TaskService 已初始化")


def get() -> 'TaskService':
    """获取 TaskService 单例，未初始化时抛出明确错误"""
    if _service is None:
        raise RuntimeError("TaskService 未初始化，请先调用 task_service.init(redis_client)")
    return _service


def get_queue() -> TaskQueue:
    """快捷方式：获取底层 TaskQueue（用于 get_task / cancel / delete 等查询操作）"""
    return get().queue


class TaskService:
    def __init__(self, redis_client):
        self.queue = TaskQueue(redis_client)
        self.redis = redis_client

    async def submit(
        self,
        task_type: str,
        task_data: dict,
        user_id: str,
        priority: int = 2,
        prepare: bool = True,
    ) -> str:
        """
        提交任务到队列，返回 task_id。

        Args:
            task_type: 工作流类型，如 "qwen_2", "i2i_fj", "panorama_360" 等
            task_data: 任务参数字典（图片路径、提示词、种子等）
            user_id:   触发用户
            priority:  优先级（默认 2）
            prepare:   是否调用 _prepare_for_agent 构建工作流 JSON 和文件下载列表
        """
        task_id = str(uuid.uuid4())

        if prepare:
            await self._prepare_for_agent(task_type, task_data, user_id)

        task = Task(
            task_id=task_id,
            task_type=task_type,
            data=task_data,
            priority=priority,
            user_id=user_id,
        )

        success = await self.queue.enqueue(task)
        if not success:
            raise HTTPException(status_code=500, detail="任务入队失败")

        logger.info(f"✅ 任务已提交: {task_id} (type={task_type}, user={user_id})")
        return task_id

    async def _prepare_for_agent(self, task_type: str, task_data: dict, username: str):
        """
        Pre-build workflow JSON and resolve agent file download URLs.
        搬自 cluster_main.py 的 prepare_task_for_agent 函数。
        """
        try:
            from workflow_handler import get_workflow_handler

            if "image_path" in task_data:
                task_data["uploaded_image"] = task_data["image_path"]
            if "image_path_end" in task_data:
                task_data["uploaded_image_end"] = task_data["image_path_end"]
            for i in range(1, 7):
                src = f"image_path_{i}"
                if src in task_data:
                    task_data[f"uploaded_image_{i}"] = task_data[src]
            for suffix in ("BK", "HU", "MB"):
                src = f"image_{suffix}"
                if src in task_data:
                    task_data[f"uploaded_image_{suffix}"] = task_data[src]

            wh = get_workflow_handler()
            workflow_json = wh.build_workflow_for_task(task_type, task_data)
            task_data["workflow_json"] = workflow_json
            task_data.setdefault(
                "workflow_name",
                {
                    "i2i_fj": "I2I_FJ",
                    "i2i_human": "I2I_HUMAN",
                    "i2i_around": "I2I_Around",
                    "upscale_hd": "upscale_hd",
                    "remove_watermark": "remove_watermark",
                    "three_view": "three_view",
                }.get(task_type, task_type),
            )

            agent_files = []
            file_params = (
                ["image_path", "image_path_end", "video_filename", "audio_filename"]
                + [f"image_path_{i}" for i in range(1, 7)]
                + [f"image_{s}" for s in ("BK", "HU", "MB")]
            )
            for param in file_params:
                filename = task_data.get(param)
                if not filename or not isinstance(filename, str) or not filename.strip():
                    continue
                download_url = None
                if self.redis:
                    try:
                        file_id = await self.redis.get(f"comfyui:file:{filename}")
                        if file_id:
                            if isinstance(file_id, bytes):
                                file_id = file_id.decode()
                            download_url = f"/api/files/{file_id}/download"
                    except Exception:
                        pass
                if not download_url:
                    year_month = datetime.now().strftime('%Y%m')
                    download_url = f"/storage/image/{username}/{year_month}/{filename}"
                agent_files.append({"param": param, "filename": filename, "url": download_url})

            task_data["agent_files"] = agent_files
            logger.info(f"✅ Pre-built workflow for {task_type}, {len(agent_files)} agent files")
        except Exception as e:
            logger.exception(f"prepare_task_for_agent failed for {task_type}: {e}")
            raise HTTPException(status_code=500, detail=f"任务预处理失败: {e}")

