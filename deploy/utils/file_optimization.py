# -*- coding: utf-8 -*-
"""
文件优化服务 - 压缩、缩略图、分块传输
"""
import os
import io
import asyncio
import aiofiles
import hashlib
from pathlib import Path
from typing import Optional, Tuple, AsyncGenerator
from PIL import Image
import ffmpeg
import logging

logger = logging.getLogger(__name__)

class FileOptimizationService:
    """文件优化服务"""
    
    # 图片压缩质量
    IMAGE_QUALITY = {
        'thumbnail': 75,   # 缩略图
        'preview': 85,     # 预览图
        'original': 95     # 原图(轻度压缩)
    }
    
    # 缩略图尺寸
    THUMBNAIL_SIZES = {
        'small': (256, 256),
        'medium': (512, 512),
        'large': (1024, 1024)
    }
    
    # 分块大小 (10MB)
    CHUNK_SIZE = 10 * 1024 * 1024
    
    @staticmethod
    async def compress_image(
        input_path: str,
        output_path: str,
        quality: str = 'preview',
        max_size: Optional[Tuple[int, int]] = None
    ) -> dict:
        """压缩图片"""
        try:
            with Image.open(input_path) as img:
                # 转换RGBA到RGB
                if img.mode == 'RGBA':
                    background = Image.new('RGB', img.size, (255, 255, 255))
                    background.paste(img, mask=img.split()[3])
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # 调整尺寸
                if max_size:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)
                
                # 保存压缩后的图片
                img.save(
                    output_path,
                    'JPEG',
                    quality=FileOptimizationService.IMAGE_QUALITY[quality],
                    optimize=True
                )
                
                # 获取文件信息
                original_size = os.path.getsize(input_path)
                compressed_size = os.path.getsize(output_path)
                compression_ratio = (1 - compressed_size / original_size) * 100
                
                return {
                    'success': True,
                    'original_size': original_size,
                    'compressed_size': compressed_size,
                    'compression_ratio': round(compression_ratio, 2),
                    'width': img.width,
                    'height': img.height
                }
        
        except Exception as e:
            logger.error(f"图片压缩失败: {e}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    async def create_thumbnail(
        input_path: str,
        output_path: str,
        size: str = 'medium'
    ) -> dict:
        """创建缩略图"""
        try:
            thumbnail_size = FileOptimizationService.THUMBNAIL_SIZES[size]
            
            with Image.open(input_path) as img:
                # 转换模式
                if img.mode == 'RGBA':
                    background = Image.new('RGB', img.size, (255, 255, 255))
                    background.paste(img, mask=img.split()[3])
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # 创建缩略图
                img.thumbnail(thumbnail_size, Image.Resampling.LANCZOS)
                img.save(output_path, 'JPEG', quality=75, optimize=True)
                
                return {
                    'success': True,
                    'thumbnail_path': output_path,
                    'size': thumbnail_size
                }
        
        except Exception as e:
            logger.error(f"缩略图创建失败: {e}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    async def create_video_thumbnail(
        video_path: str,
        output_path: str,
        time_position: float = 1.0
    ) -> dict:
        """从视频提取缩略图"""
        try:
            # 使用ffmpeg提取帧
            (
                ffmpeg
                .input(video_path, ss=time_position)
                .output(output_path, vframes=1, format='image2', vcodec='mjpeg')
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            
            # 压缩缩略图
            await FileOptimizationService.compress_image(
                output_path, output_path, 'thumbnail'
            )
            
            return {
                'success': True,
                'thumbnail_path': output_path
            }
        
        except Exception as e:
            logger.error(f"视频缩略图创建失败: {e}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    async def get_video_info(video_path: str) -> dict:
        """获取视频信息"""
        try:
            probe = ffmpeg.probe(video_path)
            video_stream = next(
                (s for s in probe['streams'] if s['codec_type'] == 'video'),
                None
            )
            
            if not video_stream:
                raise ValueError("找不到视频流")
            
            return {
                'success': True,
                'width': int(video_stream['width']),
                'height': int(video_stream['height']),
                'duration': float(probe['format']['duration']),
                'size': int(probe['format']['size']),
                'format': probe['format']['format_name']
            }
        
        except Exception as e:
            logger.error(f"获取视频信息失败: {e}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    async def compress_video(
        input_path: str,
        output_path: str,
        crf: int = 23,
        preset: str = 'medium'
    ) -> dict:
        """压缩视频(使用H.264)"""
        try:
            (
                ffmpeg
                .input(input_path)
                .output(
                    output_path,
                    vcodec='libx264',
                    crf=crf,
                    preset=preset,
                    acodec='aac',
                    audio_bitrate='128k'
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            
            original_size = os.path.getsize(input_path)
            compressed_size = os.path.getsize(output_path)
            compression_ratio = (1 - compressed_size / original_size) * 100
            
            return {
                'success': True,
                'original_size': original_size,
                'compressed_size': compressed_size,
                'compression_ratio': round(compression_ratio, 2)
            }
        
        except Exception as e:
            logger.error(f"视频压缩失败: {e}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    async def file_chunked_reader(
        file_path: str,
        chunk_size: int = CHUNK_SIZE
    ) -> AsyncGenerator[bytes, None]:
        """分块读取文件(用于大文件传输)"""
        async with aiofiles.open(file_path, 'rb') as f:
            while True:
                chunk = await f.read(chunk_size)
                if not chunk:
                    break
                yield chunk
    
    @staticmethod
    async def calculate_file_hash(file_path: str) -> str:
        """计算文件SHA256哈希(用于去重)"""
        sha256_hash = hashlib.sha256()
        
        async with aiofiles.open(file_path, 'rb') as f:
            while True:
                chunk = await f.read(8192)
                if not chunk:
                    break
                sha256_hash.update(chunk)
        
        return sha256_hash.hexdigest()
    
    @staticmethod
    def get_file_size_mb(file_path: str) -> float:
        """获取文件大小(MB)"""
        size_bytes = os.path.getsize(file_path)
        return round(size_bytes / (1024 * 1024), 2)

class FileDeduplicationService:
    """文件去重服务"""
    
    @staticmethod
    async def check_duplicate(file_hash: str, user_id: str) -> Optional[dict]:
        """检查文件是否已存在"""
        from db_manager import get_db_manager
        
        db = get_db_manager()
        query = """
            SELECT * FROM files
            WHERE user_id = $1 
            AND metadata->>'file_hash' = $2
            AND is_deleted = FALSE
            LIMIT 1
        """
        return await db.fetchrow(query, user_id, file_hash)
    
    @staticmethod
    async def link_duplicate_file(
        existing_file: dict,
        version_id: str,
        user_id: str
    ) -> dict:
        """链接已存在的文件到新版本(避免重复存储)"""
        from dao_content import FileDAO
        
        # 创建新的文件记录,指向相同的物理文件
        return await FileDAO.create_file(
            version_id=version_id,
            user_id=user_id,
            file_type=existing_file['file_type'],
            file_name=existing_file['file_name'],
            file_path=existing_file['file_path'],
            file_url=existing_file['file_url'],
            file_size_bytes=0,  # 不计入存储(因为是链接)
            mime_type=existing_file['mime_type'],
            metadata={
                **existing_file['metadata'],
                'is_duplicate': True,
                'original_file_id': existing_file['file_id']
            }
        )
