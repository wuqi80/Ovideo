# -*- coding: utf-8 -*-
"""
存储管理器
支持本地文件系统和 MinIO 对象存储
"""
import os
import shutil
import logging
from pathlib import Path
from typing import Optional, Literal
from datetime import datetime
import hashlib

logger = logging.getLogger(__name__)

class StorageConfig:
    """存储配置"""
    # 存储类型：local 或 minio
    STORAGE_TYPE = os.getenv("STORAGE_TYPE", "local")
    
    # 本地存储配置
    LOCAL_STORAGE_PATH = os.getenv("LOCAL_STORAGE_PATH", "persistent_storage")
    
    # MinIO 配置
    MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    MINIO_BUCKET = os.getenv("MINIO_BUCKET", "comfyui-outputs")
    MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"

class StorageManager:
    """存储管理器 - 统一的存储接口"""
    
    def __init__(self, storage_type: str = "local"):
        self.storage_type = storage_type
        self.logger = logging.getLogger(f"{__name__}.StorageManager")
        
        if storage_type == "local":
            self._init_local_storage()
        elif storage_type == "minio":
            self._init_minio_storage()
        else:
            raise ValueError(f"不支持的存储类型: {storage_type}")
    
    def _init_local_storage(self):
        """初始化本地存储"""
        self.storage_path = Path(StorageConfig.LOCAL_STORAGE_PATH)
        
        # 创建目录结构（同时支持单数和复数形式）
        subdirs = ["video", "videos", "image", "images", "temp"]
        for subdir in subdirs:
            (self.storage_path / subdir).mkdir(parents=True, exist_ok=True)
        
        self.logger.info(f"✅ 本地存储已初始化: {self.storage_path}")
    
    def _init_minio_storage(self):
        """初始化 MinIO 存储"""
        try:
            from minio import Minio
            
            self.minio_client = Minio(
                StorageConfig.MINIO_ENDPOINT,
                access_key=StorageConfig.MINIO_ACCESS_KEY,
                secret_key=StorageConfig.MINIO_SECRET_KEY,
                secure=StorageConfig.MINIO_SECURE
            )
            
            # 确保 bucket 存在
            bucket_name = StorageConfig.MINIO_BUCKET
            if not self.minio_client.bucket_exists(bucket_name):
                self.minio_client.make_bucket(bucket_name)
                self.logger.info(f"✅ 创建 MinIO bucket: {bucket_name}")
            
            self.logger.info(f"✅ MinIO 存储已初始化: {StorageConfig.MINIO_ENDPOINT}")
        
        except ImportError:
            raise ImportError("请安装 minio: pip install minio")
        except Exception as e:
            self.logger.error(f"❌ MinIO 初始化失败: {e}")
            raise
    
    def save_file(
        self, 
        source_path: str, 
        file_type: Literal["video", "image", "temp"],
        user_id: str,
        task_id: str,
        preserve_name: bool = False
    ) -> dict:
        """
        保存文件到持久化存储
        
        Args:
            source_path: 源文件路径（ComfyUI 的 temp/output 目录）
            file_type: 文件类型
            user_id: 用户ID
            task_id: 任务ID
            preserve_name: 是否保留原文件名
        
        Returns:
            dict: {
                "storage_path": "存储路径",
                "url": "访问URL",
                "filename": "文件名",
                "size": 文件大小,
                "hash": "文件哈希"
            }
        """
        source_path = Path(source_path)
        
        if not source_path.exists():
            raise FileNotFoundError(f"源文件不存在: {source_path}")
        
        # 生成目标路径
        if preserve_name:
            filename = source_path.name
        else:
            # 使用时间戳 + 任务ID + 原扩展名
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            ext = source_path.suffix
            filename = f"{timestamp}_{task_id[:8]}{ext}"
        
        # 计算文件哈希（用于去重）
        file_hash = self._calculate_file_hash(source_path)
        
        if self.storage_type == "local":
            return self._save_to_local(source_path, file_type, user_id, filename, file_hash)
        elif self.storage_type == "minio":
            return self._save_to_minio(source_path, file_type, user_id, filename, file_hash)
    
    def _save_to_local(
        self, 
        source_path: Path, 
        file_type: str,
        user_id: str,
        filename: str,
        file_hash: str
    ) -> dict:
        """保存到本地存储"""
        # 保持单数形式（保持向后兼容）
        file_type_dir = file_type
        if file_type == "videos":
            file_type_dir = "video"
        elif file_type == "images":
            file_type_dir = "image"
        # 确保使用单数形式
        if file_type_dir not in ["video", "image", "temp"]:
            file_type_dir = file_type  # 保持原样
        
        # 构建目标路径：storage/file_type/user_id/YYYYMM/filename
        year_month = datetime.now().strftime("%Y%m")
        target_dir = self.storage_path / file_type_dir / user_id / year_month
        target_dir.mkdir(parents=True, exist_ok=True)
        
        target_path = target_dir / filename
        
        # 复制文件
        shutil.copy2(source_path, target_path)
        
        # 构建访问URL（相对路径）
        relative_path = target_path.relative_to(self.storage_path)
        url = f"/storage/{relative_path.as_posix()}"
        
        file_size = target_path.stat().st_size
        
        self.logger.info(f"✅ 文件已保存到本地: {target_path} ({file_size} bytes)")
        
        return {
            "storage_path": str(target_path),
            "url": url,
            "filename": filename,
            "size": file_size,
            "hash": file_hash,
            "storage_type": "local"
        }
    
    def _save_to_minio(
        self,
        source_path: Path,
        file_type: str,
        user_id: str,
        filename: str,
        file_hash: str
    ) -> dict:
        """保存到 MinIO"""
        # 标准化file_type为复数形式（兼容路由）
        file_type_plural = file_type
        if file_type == "video":
            file_type_plural = "videos"
        elif file_type == "image":
            file_type_plural = "images"
        
        # 构建对象路径：file_type/user_id/YYYYMM/filename
        year_month = datetime.now().strftime("%Y%m")
        object_name = f"{file_type_plural}/{user_id}/{year_month}/{filename}"
        
        # 上传文件
        file_size = source_path.stat().st_size
        
        self.minio_client.fput_object(
            StorageConfig.MINIO_BUCKET,
            object_name,
            str(source_path),
            content_type=self._get_content_type(source_path)
        )
        
        # 生成访问URL
        url = f"/storage/minio/{object_name}"
        
        self.logger.info(f"✅ 文件已保存到 MinIO: {object_name} ({file_size} bytes)")
        
        return {
            "storage_path": object_name,
            "url": url,
            "filename": filename,
            "size": file_size,
            "hash": file_hash,
            "storage_type": "minio"
        }
    
    def get_file(self, storage_path: str) -> Optional[Path]:
        """获取文件路径"""
        if self.storage_type == "local":
            full_path = Path(storage_path)
            if full_path.exists():
                return full_path
            return None
        elif self.storage_type == "minio":
            # MinIO 需要下载到临时文件
            temp_path = self.storage_path / "temp" / Path(storage_path).name
            temp_path.parent.mkdir(parents=True, exist_ok=True)
            
            try:
                self.minio_client.fget_object(
                    StorageConfig.MINIO_BUCKET,
                    storage_path,
                    str(temp_path)
                )
                return temp_path
            except Exception as e:
                self.logger.error(f"从 MinIO 下载文件失败: {e}")
                return None
    
    def delete_file(self, storage_path: str) -> bool:
        """删除文件"""
        try:
            if self.storage_type == "local":
                path = Path(storage_path)
                if path.exists():
                    path.unlink()
                    self.logger.info(f"✅ 已删除文件: {storage_path}")
                    return True
            elif self.storage_type == "minio":
                self.minio_client.remove_object(
                    StorageConfig.MINIO_BUCKET,
                    storage_path
                )
                self.logger.info(f"✅ 已从 MinIO 删除: {storage_path}")
                return True
        except Exception as e:
            self.logger.error(f"删除文件失败: {e}")
        return False
    
    @staticmethod
    def _calculate_file_hash(file_path: Path) -> str:
        """计算文件 SHA256 哈希"""
        sha256 = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()
    
    @staticmethod
    def _get_content_type(file_path: Path) -> str:
        """根据扩展名获取 Content-Type"""
        ext = file_path.suffix.lower()
        content_types = {
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.gif': 'image/gif',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp'
        }
        return content_types.get(ext, 'application/octet-stream')

# 全局实例
_storage_manager: Optional[StorageManager] = None

def get_storage_manager() -> StorageManager:
    """获取全局存储管理器实例"""
    global _storage_manager
    if _storage_manager is None:
        storage_type = StorageConfig.STORAGE_TYPE
        _storage_manager = StorageManager(storage_type)
    return _storage_manager

def init_storage_manager(storage_type: str = None):
    """初始化存储管理器"""
    global _storage_manager
    if storage_type is None:
        storage_type = StorageConfig.STORAGE_TYPE
    _storage_manager = StorageManager(storage_type)
    return _storage_manager

