# -*- coding: utf-8 -*-
"""
数据库配置文件
请根据实际环境修改这些配置
"""
import os

class DatabaseConfig:
    """PostgreSQL 数据库配置"""
    HOST = os.getenv('DB_HOST', 'localhost')
    PORT = int(os.getenv('DB_PORT', '5432'))
    NAME = os.getenv('DB_NAME', 'my2_db')
    USER = os.getenv('DB_USER', 'my2_user')
    PASSWORD = os.getenv('DB_PASSWORD', 'changeme')
    
    # 连接池配置
    POOL_MIN_SIZE = int(os.getenv('DB_POOL_MIN_SIZE', '10'))
    POOL_MAX_SIZE = int(os.getenv('DB_POOL_MAX_SIZE', '50'))
    
    # 连接字符串
    @classmethod
    def get_connection_string(cls):
        return f"postgresql://{cls.USER}:{cls.PASSWORD}@{cls.HOST}:{cls.PORT}/{cls.NAME}"
    
    # 连接参数
    @classmethod
    def get_connection_params(cls):
        return {
            'host': cls.HOST,
            'port': cls.PORT,
            'database': cls.NAME,
            'user': cls.USER,
            'password': cls.PASSWORD,
            'min_size': cls.POOL_MIN_SIZE,
            'max_size': cls.POOL_MAX_SIZE
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

