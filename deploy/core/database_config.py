# -*- coding: utf-8 -*-
"""
数据库配置文件
请根据实际环境修改这些配置
"""
import os

from core.db_config_loader import get_db_config_value

class DatabaseConfig:
    """PostgreSQL 数据库配置"""

    # 连接字符串
    @classmethod
    def get_connection_string(cls):
        params = cls.get_connection_params()
        return (
            f"postgresql://{params['user']}:{params['password']}"
            f"@{params['host']}:{params['port']}/{params['database']}"
        )

    # 连接参数
    @classmethod
    def get_connection_params(cls):
        return {
            'host': get_db_config_value('DB_HOST', 'localhost'),
            'port': int(get_db_config_value('DB_PORT', '5432')),
            'database': get_db_config_value('DB_NAME', 'my2_db'),
            'user': get_db_config_value('DB_USER', 'my2_user'),
            'password': get_db_config_value('DB_PASSWORD', 'changeme'),
            'min_size': int(get_db_config_value('DB_POOL_MIN_SIZE', '10')),
            'max_size': int(get_db_config_value('DB_POOL_MAX_SIZE', '50')),
        }

class JWTConfig:
    """JWT认证配置"""
    SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'your-secret-key-change-this-in-production-' + os.urandom(24).hex())
    ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')
    EXPIRE_HOURS = int(os.getenv('JWT_EXPIRE_HOURS', '720'))  # 30天

class StorageConfig:
    """存储配置"""
    TYPE = os.getenv('STORAGE_TYPE', 'local')  # local, s3, oss
    BASE_PATH = os.getenv('STORAGE_BASE_PATH', './persistent_storage')
    MAX_UPLOAD_SIZE = int(os.getenv('MAX_UPLOAD_SIZE', str(1024 * 1024 * 1024)))  # 1GB
    
    # CDN配置（可选）
    CDN_ENABLED = os.getenv('CDN_ENABLED', 'false').lower() == 'true'
    CDN_BASE_URL = os.getenv('CDN_BASE_URL', '')
    CDN_ACCESS_KEY = os.getenv('CDN_ACCESS_KEY', '')
    CDN_SECRET_KEY = os.getenv('CDN_SECRET_KEY', '')
