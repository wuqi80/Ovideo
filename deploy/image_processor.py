# -*- coding: utf-8 -*-
"""
图片处理模块
负责从 ComfyUI 下载图片、处理和保存
"""
import requests
import logging
from PIL import Image
from io import BytesIO
from pathlib import Path
from typing import List, Dict, Any, Optional
import os
from datetime import datetime

logger = logging.getLogger(__name__)


class ImageProcessor:
    """图片处理器 - 负责下载、处理和保存图片"""
    
    def __init__(
        self,
        comfyui_base_url: str,
        local_storage_dir: str = "outputs",
        jpeg_quality: int = 85,
        max_size: Optional[tuple] = None
    ):
        """
        初始化图片处理器
        
        Args:
            comfyui_base_url: ComfyUI 服务器地址
            local_storage_dir: 本地存储目录
            jpeg_quality: JPEG 压缩质量 (1-100)
            max_size: 最大尺寸限制 (width, height)，None 表示不限制
        """
        self.comfyui_base_url = comfyui_base_url.rstrip('/')
        self.local_storage_dir = Path(local_storage_dir)
        self.jpeg_quality = jpeg_quality
        self.max_size = max_size
        
        # 创建存储目录
        self.local_storage_dir.mkdir(parents=True, exist_ok=True)
        
        # 创建按日期分类的子目录
        self.today_dir = self.local_storage_dir / datetime.now().strftime('%Y%m%d')
        self.today_dir.mkdir(parents=True, exist_ok=True)
    
    def process_image_from_url(self, image_url: str) -> bytes:
        """
        从URL下载图片并处理
        
        Args:
            image_url: 图片URL
            
        Returns:
            处理后的图片数据（JPEG格式）
        """
        try:
            # 下载图片
            logger.info(f"正在下载图片: {image_url}")
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()
            
            # 打开图片
            img = Image.open(BytesIO(response.content))
            
            # 转换为 RGB（去除 Alpha 通道）
            if img.mode in ('RGBA', 'LA', 'P'):
                # 创建白色背景
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            # 调整大小（如果需要）
            if self.max_size:
                img.thumbnail(self.max_size, Image.Resampling.LANCZOS)
            
            # 去除 EXIF 信息并保存为 JPEG
            output = BytesIO()
            img.save(output, format='JPEG', quality=self.jpeg_quality, optimize=True)
            output.seek(0)
            
            logger.info(f"图片处理完成，大小: {len(output.getvalue())} 字节")
            return output.getvalue()
            
        except Exception as e:
            logger.error(f"处理图片失败: {e}")
            raise
    
    def save_processed_image(self, image_data: bytes, original_filename: str) -> str:
        """
        保存处理后的图片
        
        Args:
            image_data: 图片数据
            original_filename: 原始文件名
            
        Returns:
            保存的本地路径
        """
        try:
            # 生成新文件名（改为 .jpg 扩展名）
            base_name = Path(original_filename).stem
            new_filename = f"{base_name}_processed.jpg"
            
            # 保存到今天的目录
            local_path = self.today_dir / new_filename
            
            # 如果文件已存在，添加时间戳
            if local_path.exists():
                timestamp = datetime.now().strftime('%H%M%S')
                new_filename = f"{base_name}_processed_{timestamp}.jpg"
                local_path = self.today_dir / new_filename
            
            # 保存文件
            with open(local_path, 'wb') as f:
                f.write(image_data)
            
            logger.info(f"图片已保存: {local_path}")
            return str(local_path)
            
        except Exception as e:
            logger.error(f"保存图片失败: {e}")
            raise
    
    def get_images_from_comfyui(
        self,
        prompt_id: str,
        process: bool = True
    ) -> List[Dict[str, Any]]:
        """
        从 ComfyUI 获取生成的图片
        
        Args:
            prompt_id: ComfyUI 任务 ID
            process: 是否处理图片（压缩、去EXIF等）
            
        Returns:
            图片信息列表
        """
        try:
            logger.info(f"开始获取 prompt_id {prompt_id} 的生成图片")
            
            # 获取任务历史
            history_url = f"{self.comfyui_base_url}/history/{prompt_id}"
            logger.info(f"正在查询ComfyUI历史: {history_url}")
            
            history_response = requests.get(history_url, timeout=10)
            
            if not history_response.ok:
                logger.error(f"获取历史失败: {history_response.status_code} {history_response.text}")
                return []
            
            history_data = history_response.json()
            logger.info(f"历史数据键列表: {list(history_data.keys())}")
            
            if prompt_id not in history_data:
                logger.warning(f"在历史中未找到 prompt_id: {prompt_id}")
                logger.info(f"可用的 prompt_id: {list(history_data.keys())}")
                return []
            
            task_data = history_data[prompt_id]
            
            # 检查任务状态
            if not task_data.get('status', {}).get('completed', False):
                logger.warning(f"任务 {prompt_id} 尚未完成")
                return []
            
            # 获取输出结果
            outputs = task_data.get('outputs', {})
            result_images = []
            has_output_images = False
            
            logger.info(f"任务 {prompt_id} 输出节点数量: {len(outputs)}")
            
            # 优先处理 output 类型的图片
            for node_id, node_output in outputs.items():
                images = node_output.get('images', [])
                for idx, image_info in enumerate(images):
                    folder_type = image_info.get('type', '')
                    if folder_type == 'output':
                        has_output_images = True
                        result_images.extend(
                            self._process_image_info(
                                image_info, node_id, process
                            )
                        )
            
            # 如果没有 output 类型，则使用 temp 类型
            if not has_output_images:
                logger.info("未找到 output 类型图片，尝试 temp 类型...")
                for node_id, node_output in outputs.items():
                    images = node_output.get('images', [])
                    for idx, image_info in enumerate(images):
                        folder_type = image_info.get('type', '')
                        if folder_type == 'temp':
                            result_images.extend(
                                self._process_image_info(
                                    image_info, node_id, process
                                )
                            )
            
            # 统计结果
            if not result_images:
                logger.error("未找到任何图片")
            else:
                successful_count = len([img for img in result_images if 'error' not in img])
                logger.info(f"任务 {prompt_id} 总共找到 {len(result_images)} 张图片，成功处理 {successful_count} 张")
            
            return result_images
            
        except Exception as e:
            logger.error(f"获取图片失败: {e}", exc_info=True)
            return []
    
    def _process_image_info(
        self,
        image_info: Dict[str, Any],
        node_id: str,
        process: bool
    ) -> List[Dict[str, Any]]:
        """
        处理单个图片信息
        
        Args:
            image_info: 图片信息字典
            node_id: 节点ID
            process: 是否处理图片
            
        Returns:
            处理后的图片信息列表
        """
        results = []
        
        filename = image_info.get('filename')
        if not filename:
            logger.warning(f"图片信息中缺少文件名: {image_info}")
            return results
        
        subfolder = image_info.get('subfolder', '')
        folder_type = image_info.get('type', '')
        
        # 构建图片 URL
        if subfolder:
            image_url = f"{self.comfyui_base_url}/view?filename={filename}&subfolder={subfolder}&type={folder_type}"
        else:
            image_url = f"{self.comfyui_base_url}/view?filename={filename}&type={folder_type}"
        
        try:
            if process:
                # 下载并处理图片
                logger.info(f"正在处理图片: {filename}")
                processed_data = self.process_image_from_url(image_url)
                local_path = self.save_processed_image(processed_data, filename)
                
                # 生成本地访问 URL（统一使用正斜杠）
                relative_path = str(
                    Path(local_path).relative_to(Path(self.local_storage_dir))
                ).replace('\\', '/')
                local_url = f"/outputs/{relative_path}"
                
                results.append({
                    'url': local_url,
                    'filename': filename,
                    'processed_filename': Path(local_path).name,
                    'local_path': local_path,
                    'original_url': image_url,
                    'subfolder': subfolder,
                    'type': folder_type,
                    'node_id': node_id,
                    'size': len(processed_data),
                    'processed': True
                })
                
                logger.info(f"图片处理完成: {filename} -> {Path(local_path).name}")
            else:
                # 不处理，直接返回原始 URL
                results.append({
                    'url': image_url,
                    'filename': filename,
                    'original_filename': filename,
                    'original_url': image_url,
                    'subfolder': subfolder,
                    'type': folder_type,
                    'node_id': node_id,
                    'processed': False,
                    'is_original': True
                })
                
                logger.info(f"找到原始图片: {filename}")
                
        except Exception as e:
            logger.error(f"处理图片失败 {filename}: {e}")
            # 如果处理失败，仍然添加原始 URL
            results.append({
                'url': image_url,
                'filename': filename,
                'error': str(e),
                'original_url': image_url,
                'subfolder': subfolder,
                'type': folder_type,
                'node_id': node_id,
                'processed': False
            })
        
        return results


if __name__ == "__main__":
    # 测试图片处理器
    processor = ImageProcessor(
        comfyui_base_url="http://localhost:8188",
        jpeg_quality=85
    )
    
    print("图片处理器已初始化")
    print(f"存储目录: {processor.local_storage_dir}")
    print(f"今日目录: {processor.today_dir}")

