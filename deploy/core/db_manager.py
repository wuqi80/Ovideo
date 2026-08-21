# -*- coding: utf-8 -*-
"""
数据库管理器 - PostgreSQL连接池和操作封装
"""
import asyncpg
import logging
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from datetime import datetime

from core.db_config_loader import get_db_config_value

logger = logging.getLogger(__name__)

class DatabaseConfig:
    """数据库配置"""

    def __init__(self):
        self.HOST = get_db_config_value("DB_HOST", "localhost")
        self.PORT = int(get_db_config_value("DB_PORT", "5432"))
        self.DATABASE = get_db_config_value("DB_NAME", "ostory_db")
        self.USER = get_db_config_value("DB_USER", "ostory_user")
        self.PASSWORD = get_db_config_value("DB_PASSWORD", "")
        self.MIN_SIZE = int(get_db_config_value("DB_POOL_MIN_SIZE", "10"))
        self.MAX_SIZE = int(get_db_config_value("DB_POOL_MAX_SIZE", "50"))
        self.MAX_QUERIES = int(get_db_config_value("DB_MAX_QUERIES", "50000"))
        self.MAX_INACTIVE_CONNECTION_LIFETIME = float(get_db_config_value("DB_MAX_IDLE_TIME", "300"))

class DatabaseManager:
    """数据库管理器 - 连接池和查询封装"""
    
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
        self.config = DatabaseConfig()
    
    async def connect(self):
        """创建数据库连接池"""
        if self.pool:
            return
        
        try:
            self.pool = await asyncpg.create_pool(
                host=self.config.HOST,
                port=self.config.PORT,
                database=self.config.DATABASE,
                user=self.config.USER,
                password=self.config.PASSWORD,
                min_size=self.config.MIN_SIZE,
                max_size=self.config.MAX_SIZE,
                max_queries=self.config.MAX_QUERIES,
                max_inactive_connection_lifetime=self.config.MAX_INACTIVE_CONNECTION_LIFETIME
            )
            logger.info(f"✅ 数据库连接池已创建: {self.config.DATABASE}@{self.config.HOST}")
        except Exception as e:
            logger.error(f"❌ 数据库连接失败: {e}")
            raise
    
    async def disconnect(self):
        """关闭数据库连接池"""
        if self.pool:
            await self.pool.close()
            self.pool = None
            logger.info("数据库连接池已关闭")
    
    @asynccontextmanager
    async def acquire(self):
        """获取数据库连接"""
        if not self.pool:
            await self.connect()
        
        async with self.pool.acquire() as connection:
            yield connection
    
    async def execute(self, query: str, *args) -> str:
        """执行SQL语句(INSERT/UPDATE/DELETE)"""
        async with self.acquire() as conn:
            return await conn.execute(query, *args)
    
    async def fetch(self, query: str, *args) -> List[Dict[str, Any]]:
        """查询多行数据"""
        async with self.acquire() as conn:
            rows = await conn.fetch(query, *args)
            return [dict(row) for row in rows]
    
    async def fetchrow(self, query: str, *args) -> Optional[Dict[str, Any]]:
        """查询单行数据"""
        async with self.acquire() as conn:
            row = await conn.fetchrow(query, *args)
            return dict(row) if row else None
    
    async def fetchval(self, query: str, *args) -> Any:
        """查询单个值"""
        async with self.acquire() as conn:
            return await conn.fetchval(query, *args)

# 全局数据库管理器实例
_db_manager: Optional[DatabaseManager] = None

def get_db_manager() -> DatabaseManager:
    """获取数据库管理器实例"""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager

async def init_db_manager() -> DatabaseManager:
    """初始化数据库管理器"""
    db = get_db_manager()
    await db.connect()
    return db
