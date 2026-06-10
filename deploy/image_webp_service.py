"""
WebP图片处理服务
- 统一使用WebP格式压缩所有图片
- 缩略图：长边1024px
- 上传图：保持原尺寸，使用WebP压缩
- 生成图：保持原尺寸，使用WebP压缩
"""

import io
import base64
from PIL import Image
from pathlib import Path
from typing import Union, Tuple, Optional
import logging

logger = logging.getLogger(__name__)

class WebPImageService:
    """WebP图片处理服务"""
    
    # WebP压缩质量设置
    QUALITY = {
        'thumbnail': 80,    # 缩略图
        'compressed': 85,   # 压缩图
        'high': 90         # 高质量
    }
    
    # 缩略图尺寸（长边）
    THUMBNAIL_MAX_SIZE = 1024
    
    @staticmethod
    def create_thumbnail_from_path(
        input_path: Union[str, Path],
        output_path: Union[str, Path],
        max_size: int = THUMBNAIL_MAX_SIZE,
        quality: int = QUALITY['thumbnail']
    ) -> dict:
        """
        从文件路径创建WebP缩略图
        
        Args:
            input_path: 输入图片路径
            output_path: 输出WebP路径
            max_size: 长边最大尺寸
            quality: WebP质量 (0-100)
        
        Returns:
            dict: {'success': bool, 'size': tuple, 'file_size': int}
        """
        try:
            with Image.open(input_path) as img:
                # 转换模式
                if img.mode == 'RGBA':
                    # 保留透明通道
                    pass
                elif img.mode not in ['RGB', 'RGBA']:
                    img = img.convert('RGB')
                
                # 计算缩放比例（长边缩放到max_size）
                width, height = img.size
                if width > height:
                    if width > max_size:
                        new_width = max_size
                        new_height = int(height * (max_size / width))
                    else:
                        new_width, new_height = width, height
                else:
                    if height > max_size:
                        new_height = max_size
                        new_width = int(width * (max_size / height))
                    else:
                        new_width, new_height = width, height
                
                # 调整尺寸
                if (new_width, new_height) != (width, height):
                    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                
                # 保存为WebP
                img.save(
                    output_path,
                    'WEBP',
                    quality=quality,
                    method=6  # 最高压缩效率
                )
                
                file_size = Path(output_path).stat().st_size
                
                logger.info(f"✅ 缩略图已生成: {new_width}x{new_height}, {file_size} bytes")
                
                return {
                    'success': True,
                    'size': (new_width, new_height),
                    'file_size': file_size,
                    'format': 'webp'
                }
        
        except Exception as e:
            logger.error(f"❌ 缩略图生成失败: {e}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    def create_thumbnail_from_bytes(
        image_bytes: bytes,
        max_size: int = THUMBNAIL_MAX_SIZE,
        quality: int = QUALITY['thumbnail']
    ) -> Optional[str]:
        """
        从字节数据创建WebP缩略图，返回Base64
        
        Args:
            image_bytes: 图片字节数据
            max_size: 长边最大尺寸
            quality: WebP质量
        
        Returns:
            str: Base64编码的WebP数据 (data:image/webp;base64,...)
        """
        try:
            img = Image.open(io.BytesIO(image_bytes))
            
            # 转换模式
            if img.mode == 'RGBA':
                pass
            elif img.mode not in ['RGB', 'RGBA']:
                img = img.convert('RGB')
            
            # 计算缩放比例
            width, height = img.size
            if width > height:
                if width > max_size:
                    new_width = max_size
                    new_height = int(height * (max_size / width))
                else:
                    new_width, new_height = width, height
            else:
                if height > max_size:
                    new_height = max_size
                    new_width = int(width * (max_size / height))
                else:
                    new_width, new_height = width, height
            
            # 调整尺寸
            if (new_width, new_height) != (width, height):
                img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # 保存为WebP
            output_buffer = io.BytesIO()
            img.save(output_buffer, 'WEBP', quality=quality, method=6)
            webp_bytes = output_buffer.getvalue()
            
            # 转为Base64
            b64_data = base64.b64encode(webp_bytes).decode('utf-8')
            
            logger.info(f"✅ 缩略图已生成: {new_width}x{new_height}, {len(webp_bytes)} bytes")
            
            return f"data:image/webp;base64,{b64_data}"
        
        except Exception as e:
            logger.error(f"❌ 缩略图生成失败: {e}")
            return None
    
    @staticmethod
    def compress_image_to_webp(
        input_path: Union[str, Path],
        output_path: Union[str, Path],
        quality: int = QUALITY['compressed'],
        max_size: Optional[Tuple[int, int]] = None
    ) -> dict:
        """
        压缩图片为WebP格式（保持原尺寸或指定尺寸）
        
        Args:
            input_path: 输入图片路径
            output_path: 输出WebP路径
            quality: WebP质量
            max_size: 最大尺寸 (width, height)，None表示保持原尺寸
        
        Returns:
            dict: {'success': bool, 'size': tuple, 'file_size': int}
        """
        try:
            with Image.open(input_path) as img:
                original_size = img.size
                
                # 转换模式
                if img.mode == 'RGBA':
                    pass
                elif img.mode not in ['RGB', 'RGBA']:
                    img = img.convert('RGB')
                
                # 调整尺寸（如果指定）
                if max_size:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)
                
                # 保存为WebP
                img.save(
                    output_path,
                    'WEBP',
                    quality=quality,
                    method=6
                )
                
                file_size = Path(output_path).stat().st_size
                
                logger.info(f"✅ 图片已压缩为WebP: {original_size} -> {img.size}, {file_size} bytes")
                
                return {
                    'success': True,
                    'original_size': original_size,
                    'size': img.size,
                    'file_size': file_size,
                    'format': 'webp'
                }
        
        except Exception as e:
            logger.error(f"❌ 图片压缩失败: {e}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    def compress_base64_to_webp(
        base64_data: str,
        quality: int = QUALITY['compressed'],
        max_size: Optional[Tuple[int, int]] = None
    ) -> Optional[str]:
        """
        压缩Base64图片为WebP格式
        
        Args:
            base64_data: Base64编码的图片 (data:image/...;base64,... 或纯base64)
            quality: WebP质量
            max_size: 最大尺寸，None表示保持原尺寸
        
        Returns:
            str: Base64编码的WebP数据
        """
        try:
            # 提取Base64数据
            if ',' in base64_data:
                base64_data = base64_data.split(',')[1]
            
            # 解码
            image_bytes = base64.b64decode(base64_data)
            img = Image.open(io.BytesIO(image_bytes))
            
            # 转换模式
            if img.mode == 'RGBA':
                pass
            elif img.mode not in ['RGB', 'RGBA']:
                img = img.convert('RGB')
            
            # 调整尺寸（如果指定）
            if max_size:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # 保存为WebP
            output_buffer = io.BytesIO()
            img.save(output_buffer, 'WEBP', quality=quality, method=6)
            webp_bytes = output_buffer.getvalue()
            
            # 转为Base64
            b64_data = base64.b64encode(webp_bytes).decode('utf-8')
            
            logger.info(f"✅ Base64图片已压缩为WebP: {img.size}, {len(webp_bytes)} bytes")
            
            return f"data:image/webp;base64,{b64_data}"
        
        except Exception as e:
            logger.error(f"❌ Base64图片压缩失败: {e}")
            return None
    
    @staticmethod
    def bytes_to_webp(
        image_bytes: bytes,
        quality: int = QUALITY['compressed']
    ) -> Optional[bytes]:
        """
        将图片字节转为WebP字节
        
        Args:
            image_bytes: 图片字节数据
            quality: WebP质量
        
        Returns:
            bytes: WebP格式的字节数据
        """
        try:
            img = Image.open(io.BytesIO(image_bytes))
            
            # 转换模式
            if img.mode == 'RGBA':
                pass
            elif img.mode not in ['RGB', 'RGBA']:
                img = img.convert('RGB')
            
            # 保存为WebP
            output_buffer = io.BytesIO()
            img.save(output_buffer, 'WEBP', quality=quality, method=6)
            webp_bytes = output_buffer.getvalue()
            
            logger.info(f"✅ 图片已转换为WebP: {img.size}, {len(webp_bytes)} bytes")
            
            return webp_bytes
        
        except Exception as e:
            logger.error(f"❌ 图片转换失败: {e}")
            return None
