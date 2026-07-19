# -*- coding: utf-8 -*-
"""
任务数据访问对象 (DAO) - 持久化Redis任务到数据库
"""
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime
from db_manager import get_db_manager

class TaskDAO:
    """任务数据访问对象"""
    
    @staticmethod
    async def create_task(
        task_id: str,
        user_id: str,
        task_type: str,
        task_data: Dict,
        project_id: Optional[str] = None,
        version_id: Optional[str] = None,
        priority: int = 0
    ) -> Dict[str, Any]:
        """创建任务记录"""
        db = get_db_manager()
        
        # 🆕 将 dict 转换为 JSON 字符串
        import json
        task_data_json = json.dumps(task_data) if isinstance(task_data, dict) else task_data
        
        # 幂等 INSERT：task_id 唯一约束 tasks_task_id_key。
        # enqueue() 在首次入队时已写入本行；lite Worker 把 ComfyUI 任务丢回队列时
        # （worker._process_task 的 lite 守卫 → task_queue.enqueue）会再次调用本方法，
        # worker 真正开始处理时（worker.py:263）也会再调一次。若用普通 INSERT，
        # 这些重复调用都会抛 UniqueViolationError，在「无 ComfyUI agent」时形成死循环刷屏。
        # ON CONFLICT DO UPDATE 做空更新（task_id 写回自身），既不覆盖已有行数据，
        # 又能让 RETURNING * 在冲突时仍返回现有行，保持所有调用方语义不变。
        query = """
            INSERT INTO tasks (
                task_id, user_id, project_id, version_id,
                task_type, status, priority, task_data
            )
            VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7::jsonb)
            ON CONFLICT (task_id) DO UPDATE SET task_id = EXCLUDED.task_id
            RETURNING *
        """
        return await db.fetchrow(
            query, task_id, user_id, project_id, version_id,
            task_type, priority, task_data_json
        )
    
    @staticmethod
    async def update_task_status(
        task_id: str,
        status: str,
        node_id: Optional[str] = None,
        result_data: Optional[Dict] = None,
        error_message: Optional[str] = None
    ):
        """更新任务状态"""
        db = get_db_manager()
        
        # 🆕 将 dict 转换为 JSON 字符串
        import json
        result_data_json = json.dumps(result_data) if isinstance(result_data, dict) else result_data
        
        if status == 'processing':
            query = """
                UPDATE tasks
                SET status = $1, node_id = $2, started_at = CURRENT_TIMESTAMP
                WHERE task_id = $3
            """
            await db.execute(query, status, node_id, task_id)
        
        elif status == 'completed':
            query = """
                UPDATE tasks
                SET status = $1, result_data = $2::jsonb, completed_at = CURRENT_TIMESTAMP
                WHERE task_id = $3
            """
            await db.execute(query, status, result_data_json, task_id)
        
        elif status == 'failed':
            query = """
                UPDATE tasks
                SET status = $1, error_message = $2, completed_at = CURRENT_TIMESTAMP,
                    retry_count = retry_count + 1
                WHERE task_id = $3
            """
            await db.execute(query, status, error_message, task_id)

        elif status == 'cancelled':
            # 取消：终态落库，避免 /api/tasks/active 刷新后再次拉回 pending/processing
            query = """
                UPDATE tasks
                SET status = $1, completed_at = CURRENT_TIMESTAMP
                WHERE task_id = $2
            """
            await db.execute(query, status, task_id)

    @staticmethod
    async def reconcile_terminal_task(
        task_id: str,
        status: str,
        result_data: Optional[Dict] = None,
        error_message: Optional[str] = None,
        retries: Optional[int] = None,
    ):
        """Persist a terminal Redis task state back to SQL idempotently."""
        db = get_db_manager()
        import json

        result_data_json = json.dumps(result_data) if isinstance(result_data, dict) else result_data
        retry_count = max(0, int(retries or 0))

        if status == 'completed':
            query = """
                UPDATE tasks
                SET status = 'completed',
                    result_data = $2::jsonb,
                    error_message = NULL,
                    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
                    retry_count = GREATEST(COALESCE(retry_count, 0), $3)
                WHERE task_id = $1
            """
            await db.execute(query, task_id, result_data_json, retry_count)
            return

        if status in ('failed', 'timeout'):
            query = """
                UPDATE tasks
                SET status = 'failed',
                    error_message = $2,
                    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
                    retry_count = GREATEST(COALESCE(retry_count, 0), $3)
                WHERE task_id = $1
            """
            await db.execute(query, task_id, error_message or 'Task already failed in Redis', retry_count)
            return

        if status == 'cancelled':
            query = """
                UPDATE tasks
                SET status = 'cancelled',
                    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
                    retry_count = GREATEST(COALESCE(retry_count, 0), $2)
                WHERE task_id = $1
            """
            await db.execute(query, task_id, retry_count)
    
    @staticmethod
    async def get_task(task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务详情"""
        db = get_db_manager()
        if not db:
            return None
        query = "SELECT * FROM tasks WHERE task_id = $1"
        return await db.fetchrow(query, task_id)
    
    @staticmethod
    async def get_task_by_task_id(task_id: str) -> Optional[Dict[str, Any]]:
        """按task_id查询任务（用于Redis过期后的API降级查询）"""
        db = get_db_manager()
        if not db:
            return None
        query = """
            SELECT task_id, user_id, status, result_data, error_message,
                   node_id, task_type, task_data, metadata,
                   created_at, started_at, completed_at
            FROM tasks WHERE task_id = $1
        """
        return await db.fetchrow(query, task_id)
    
    @staticmethod
    async def get_user_tasks(
        user_id: str,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Optional[List[Dict[str, Any]]]:
        """获取用户的任务列表"""
        db = get_db_manager()
        if not db:
            return None
        
        if status:
            query = """
                SELECT * FROM tasks
                WHERE user_id = $1 AND status = $2
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
            """
            return await db.fetch(query, user_id, status, limit, offset)
        else:
            query = """
                SELECT * FROM tasks
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
            """
            return await db.fetch(query, user_id, limit, offset)
    
    @staticmethod
    async def get_recent_completed_tasks(
        user_id: str,
        hours: int = 24,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """获取最近完成的任务(用于恢复丢失的任务)"""
        db = get_db_manager()
        query = """
            SELECT * FROM tasks
            WHERE user_id = $1 
            AND status = 'completed'
            AND completed_at > CURRENT_TIMESTAMP - INTERVAL '%s hours'
            ORDER BY completed_at DESC
            LIMIT $2
        """ % hours
        return await db.fetch(query, user_id, limit)

    @staticmethod
    async def get_active_tasks_for_user(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get active pending/processing/queued tasks for task recovery polling."""
        db = get_db_manager()
        limit = max(1, min(int(limit or 50), 200))
        query = """
            SELECT task_id, task_type, status, project_id, category,
                   source_page, source_item_id, display_name,
                   created_at, started_at, completed_at, metadata, task_data
            FROM tasks
            WHERE user_id = $1 AND status IN ('pending', 'processing', 'queued')
            ORDER BY created_at DESC
            LIMIT $2
        """
        return await db.fetch(query, user_id, limit)

    @staticmethod
    async def get_terminal_tasks_for_notifications(
        user_id: str,
        since_dt: Optional[datetime] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Get completed/failed task rows for notification polling."""
        db = get_db_manager()
        limit = max(1, min(int(limit or 20), 100))
        query = """
            SELECT task_id, task_type, status, project_id, category,
                   source_page, source_item_id, display_name,
                   created_at, completed_at, result_data, task_data
            FROM tasks
            WHERE user_id = $1 AND status IN ('completed', 'failed')
              AND ($2::timestamp IS NULL OR completed_at > $2)
              AND COALESCE(error_message, '') <> 'Auto-cleanup: stale task exceeded timeout'
            ORDER BY completed_at DESC
            LIMIT $3
        """
        return await db.fetch(query, user_id, since_dt, limit)
    
    @staticmethod
    async def link_task_file(task_id: str, file_id: str, file_role: str = 'output'):
        """关联任务和文件"""
        db = get_db_manager()
        query = """
            INSERT INTO task_files (task_id, file_id, file_role)
            VALUES ($1, $2, $3)
            ON CONFLICT (task_id, file_id) DO NOTHING
        """
        await db.execute(query, task_id, file_id, file_role)
    
    @staticmethod
    async def get_task_files(task_id: str) -> List[Dict[str, Any]]:
        """获取任务关联的文件"""
        db = get_db_manager()
        query = """
            SELECT f.*, tf.file_role
            FROM files f
            JOIN task_files tf ON f.file_id = tf.file_id
            WHERE tf.task_id = $1 AND f.is_deleted = FALSE
            ORDER BY tf.created_at
        """
        return await db.fetch(query, task_id)
    
    @staticmethod
    async def delete_task(task_id: str, user_id: str) -> Optional[bool]:
        """
        删除任务
        :param task_id: 任务ID
        :param user_id: 用户ID（用于权限检查）
        :return: 是否删除成功
        """
        db = get_db_manager()
        if not db:
            return None
        query = """
            DELETE FROM tasks
            WHERE task_id = $1 AND user_id = $2
            RETURNING task_id
        """
        result = await db.fetchrow(query, task_id, user_id)
        return result is not None
    
    @staticmethod
    async def get_user_task_stats(user_id: str) -> Dict[str, Any]:
        """
        获取用户任务统计
        :param user_id: 用户ID
        :return: 统计数据 {today_count, total_count, by_status, by_type}
        """
        db = get_db_manager()
        
        # 今日完成任务数
        today_query = """
            SELECT COUNT(*) as count
            FROM tasks
            WHERE user_id = $1 
            AND status = 'completed'
            AND DATE(completed_at) = CURRENT_DATE
        """
        today_result = await db.fetchrow(today_query, user_id)
        today_count = today_result['count'] if today_result else 0
        
        # 总任务数
        total_query = """
            SELECT COUNT(*) as count
            FROM tasks
            WHERE user_id = $1
        """
        total_result = await db.fetchrow(total_query, user_id)
        total_count = total_result['count'] if total_result else 0
        
        # 按状态统计
        status_query = """
            SELECT status, COUNT(*) as count
            FROM tasks
            WHERE user_id = $1
            GROUP BY status
        """
        status_results = await db.fetch(status_query, user_id)
        by_status = {row['status']: row['count'] for row in status_results}
        
        # 按类型统计
        type_query = """
            SELECT task_type, COUNT(*) as count
            FROM tasks
            WHERE user_id = $1
            GROUP BY task_type
        """
        type_results = await db.fetch(type_query, user_id)
        by_type = {row['task_type']: row['count'] for row in type_results}
        
        return {
            'today_count': today_count,
            'total_count': total_count,
            'by_status': by_status,
            'by_type': by_type
        }
    
    @staticmethod
    async def cleanup_old_tasks(days: int = 30):
        """清理旧任务(保留完成和失败的任务记录)"""
        db = get_db_manager()
        query = """
            DELETE FROM tasks
            WHERE status IN ('completed', 'failed')
            AND completed_at < CURRENT_TIMESTAMP - INTERVAL '%s days'
        """ % days
        result = await db.execute(query)
        return result

    @staticmethod
    async def get_stats() -> Dict[str, Any]:
        """任务统计（替代 TaskHistoryDAO.get_stats）"""
        db = get_db_manager()
        if not db:
            return {"total": 0, "completed": 0, "failed": 0, "queued": 0,
                    "processing": 0, "avg_duration": 0.0, "today_completed": 0}
        row = await db.fetchrow("""
            SELECT
                COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
                COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
                COUNT(*) FILTER (WHERE status IN ('pending', 'queued'))::bigint AS queued,
                COUNT(*) FILTER (WHERE status = 'processing')::bigint AS processing,
                AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))
                    FILTER (WHERE status = 'completed'
                            AND started_at IS NOT NULL
                            AND completed_at IS NOT NULL) AS avg_duration,
                COUNT(*) FILTER (WHERE status = 'completed'
                                 AND completed_at >= (NOW() - INTERVAL '24 hours'))::bigint AS today_completed
            FROM tasks
        """)
        if not row:
            return {"total": 0, "completed": 0, "failed": 0, "queued": 0,
                    "processing": 0, "avg_duration": 0.0, "today_completed": 0}
        avg = row["avg_duration"]
        return {
            "total": int(row["total"] or 0),
            "completed": int(row["completed"] or 0),
            "failed": int(row["failed"] or 0),
            "queued": int(row["queued"] or 0),
            "processing": int(row["processing"] or 0),
            "avg_duration": float(avg) if avg is not None else 0.0,
            "today_completed": int(row["today_completed"] or 0),
        }

    @staticmethod
    async def get_recent(limit: int = 50) -> List[Dict[str, Any]]:
        """最近任务列表（替代 TaskHistoryDAO.get_recent）"""
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1",
            limit,
        )

    @staticmethod
    async def cleanup_stale(hours: int = 24, limit: int = 50) -> int:
        """将超时的 pending/queued/processing 任务标记为 failed"""
        db = get_db_manager()
        if not db:
            return 0
        limit = max(1, min(int(limit or 50), 500))
        result = await db.execute("""
            WITH stale_tasks AS (
                SELECT task_id
                FROM tasks
                WHERE status IN ('pending', 'queued', 'processing')
                  AND created_at < NOW() - INTERVAL '1 hour' * $1
                ORDER BY created_at ASC
                LIMIT $2
            )
            UPDATE tasks SET status = 'failed',
                error_message = 'Auto-cleanup: stale task exceeded timeout',
                completed_at = COALESCE(started_at, created_at)
            WHERE task_id IN (SELECT task_id FROM stale_tasks)
        """, hours, limit)
        count = int(result.split()[-1]) if result else 0
        return count

class ActivityLogDAO:
    """活动日志数据访问对象"""
    
    @staticmethod
    async def log_activity(
        user_id: str,
        action: str,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        metadata: Optional[Dict] = None
    ):
        """记录用户活动"""
        db = get_db_manager()
        query = """
            INSERT INTO activity_logs (
                user_id, action, resource_type, resource_id,
                ip_address, user_agent, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """
        import json as _json
        meta_str = _json.dumps(metadata or {}, ensure_ascii=False)
        await db.execute(
            query, user_id, action, resource_type, resource_id,
            ip_address, user_agent, meta_str
        )
    
    @staticmethod
    async def get_user_activities(
        user_id: str,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """获取用户活动记录"""
        db = get_db_manager()
        query = """
            SELECT * FROM activity_logs
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        """
        return await db.fetch(query, user_id, limit, offset)
