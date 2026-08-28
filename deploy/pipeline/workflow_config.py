# -*- coding: utf-8 -*-
"""
工作流配置管理
为不同的工作流定义参数映射和配置
"""
from typing import Dict, List, Any, Optional
from pathlib import Path


class WorkflowConfig:
    """工作流配置类 - 管理每个工作流的元数据和参数映射"""
    
    def __init__(
        self,
        name: str,
        file: Optional[str],
        description: str,
        placeholders: Optional[List[str]] = None,
        param_mapping: Optional[Dict[str, Any]] = None,
        default_params: Optional[Dict[str, Any]] = None
    ):
        """
        初始化工作流配置
        
        Args:
            name: 工作流显示名称
            file: 工作流文件名
            description: 工作流描述
            placeholders: 占位符列表（如果为None，会自动检测）
            param_mapping: 参数映射配置（前端参数 -> 工作流占位符）
            default_params: 默认参数值
        """
        self.name = name
        self.file = file
        self.description = description
        self.placeholders = placeholders or []
        self.param_mapping = param_mapping or {}
        self.default_params = default_params or {}
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            'name': self.name,
            'file': self.file,
            'description': self.description,
            'placeholders': self.placeholders,
            'param_mapping': self.param_mapping,
            'default_params': self.default_params
        }


# ============================================
# 工作流配置定义
# ============================================

WORKFLOW_CONFIGS = {
    # 图片上传工作流
    'image_upload': WorkflowConfig(
        name='图片上传工作流',
        file='image_upload.json',
        description='用于上传图片后的处理工作流',
        placeholders=['image'],
        param_mapping={
            'image_data': 'image'  # 前端的 image_data 映射到工作流的 {image}
        }
    ),
    # Wan2 I2V 工作流
    'wan2_i2v': WorkflowConfig(
        name='Wan2 图片转视频',
        file='wan2_i2v.json',
        description='使用 Wan2 模型将单张图片转换为视频',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # MiniMax I2V（图生视频） - API调用
    'minimax_i2v': WorkflowConfig(
        name='MiniMax 图生视频',
        file=None,  # API调用，无JSON文件
        description='使用 MiniMax-Hailuo-02 API生成6s 720P视频',
        placeholders=['first_frame_image', 'prompt'],
        param_mapping={
            'first_frame_image': 'first_frame_image',
            'prompt': 'prompt'
        },
        default_params={
            'model': 'MiniMax-Hailuo-02',
            'duration': 6,
            'resolution': '720P',
            'prompt_optimizer': True
        }
    ),
    
    # MiniMax Morph（首尾帧） - API调用
    'minimax_morph': WorkflowConfig(
        name='MiniMax 首尾帧',
        file=None,  # API调用，无JSON文件
        description='使用 MiniMax-Hailuo-02 API生成首尾帧过渡视频',
        placeholders=['first_frame_image', 'last_frame_image', 'prompt'],
        param_mapping={
            'first_frame_image': 'first_frame_image',
            'last_frame_image': 'last_frame_image',
            'prompt': 'prompt'
        },
        default_params={
            'model': 'MiniMax-Hailuo-02',
            'duration': 6,
            'resolution': '720P',
            'prompt_optimizer': True
        }
    ),
    
    # Sora2 I2V（图生视频） - API调用
    'sora2_i2v': WorkflowConfig(
        name='Sora2 图生视频',
        file=None,  # API调用，无JSON文件
        description='使用 Sora2 API生成15s 1280x704视频',
        placeholders=['image', 'prompt'],
        param_mapping={
            'image': 'image',
            'prompt': 'prompt'
        },
        default_params={
            'model': 'sora_video2-landscape-15s',
            'size': '1280x704',
            'seconds': '15'
        }
    ),
    
    # Sora2 Morph（首尾帧） - API调用
    'sora2_morph': WorkflowConfig(
        name='Sora2 首尾帧',
        file=None,  # API调用，无JSON文件
        description='使用 Sora2 API生成首尾帧过渡视频（自动拼合）',
        placeholders=['start_image', 'end_image', 'prompt'],
        param_mapping={
            'start_image': 'start_image',
            'end_image': 'end_image',
            'prompt': 'prompt'
        },
        default_params={
            'model': 'sora_video2-landscape-15s',
            'size': '1280x704',
            'seconds': '15'
        }
    ),
    
    # Veo I2V（图生视频） - API调用
    'veo_i2v': WorkflowConfig(
        name='Veo 图生视频',
        file=None,  # API调用，无JSON文件
        description='使用 Veo-3.1 API生成视频',
        placeholders=['image', 'prompt'],
        param_mapping={
            'image': 'image',
            'prompt': 'prompt'
        },
        default_params={
            'model': 'veo-3.1-landscape-fast-fl'
        }
    ),
    
    # Veo Morph（首尾帧） - API调用
    'veo_morph': WorkflowConfig(
        name='Veo 首尾帧',
        file=None,  # API调用，无JSON文件
        description='使用 Veo-3.1 API生成首尾帧过渡视频',
        placeholders=['start_image', 'end_image', 'prompt'],
        param_mapping={
            'start_image': 'start_image',
            'end_image': 'end_image',
            'prompt': 'prompt'
        },
        default_params={
            'model': 'veo-3.1-landscape-fast-fl'
        }
    ),
    
    # Wan2 Morph 工作流
    'wan2_morph': WorkflowConfig(
        name='Wan2 首尾帧过渡',
        file='wan2_morph.json',
        description='使用 Wan2 模型生成首尾帧之间的过渡视频',
        placeholders=['start_image', 'end_image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'start_image',
            'image_data_end': 'end_image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # =====================================================
    # 一阶到七阶 ComfyUI 工作流（练气和筑基之间的境界）
    # =====================================================
    
    # 一阶（smooth）- I2V
    'smooth_i2v': WorkflowConfig(
        name='Smooth 图片转视频',
        file='smooth_i2v.json',
        description='使用 Smooth 模型将单张图片转换为视频',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # 一阶（smooth）- Morph
    'smooth_morph': WorkflowConfig(
        name='Smooth 首尾帧过渡',
        file=None,
        description='使用 Smooth 模型生成首尾帧之间的过渡视频',
        placeholders=['start_image', 'end_image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'start_image',
            'image_data_end': 'end_image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # 二阶（Dawasi）- I2V
    'dawasi_i2v': WorkflowConfig(
        name='Dawasi 图片转视频',
        file='Dawasi_i2v.json',
        description='使用 Dawasi 模型将单张图片转换为视频',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # 二阶（Dawasi）- Morph
    'dawasi_morph': WorkflowConfig(
        name='Dawasi 首尾帧过渡',
        file=None,
        description='使用 Dawasi 模型生成首尾帧之间的过渡视频',
        placeholders=['start_image', 'end_image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'start_image',
            'image_data_end': 'end_image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # 三阶（hunyuan）- I2V（无首尾帧）
    'hunyuan_i2v': WorkflowConfig(
        name='Hunyuan Video 图片转视频',
        file=None,
        description='使用 Hunyuan Video 模型将单张图片转换为视频',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # 四阶（LTX）- I2V（无首尾帧）
    'ltx_i2v': WorkflowConfig(
        name='LTX Video 图片转视频',
        file='LTX_i2v.json',
        description='使用 LTX Video 模型将单张图片转换为视频',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # 五阶（Turbo2.2）- I2V（无首尾帧）
    'turbo22_i2v': WorkflowConfig(
        name='Turbo 2.2 图片转视频',
        file=None,
        description='使用 Turbo 2.2 模型将单张图片转换为视频',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # 六阶（Turbo2.1）- I2V（无首尾帧）
    'turbo21_i2v': WorkflowConfig(
        name='Turbo 2.1 图片转视频',
        file=None,
        description='使用 Turbo 2.1 模型将单张图片转换为视频',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # 七阶（SVD_WAN）- I2V（无首尾帧）
    'svdwan_i2v': WorkflowConfig(
        name='SVD-WAN 图片转视频',
        file=None,
        description='使用 SVD-WAN 模型将单张图片转换为视频',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality'
        }
    ),
    
    # I2I_FJ 工作流（角度调整 - 素材绑定和画面分镜使用）
    'i2i_fj': WorkflowConfig(
        name='图像角度调整',
        file='I2I_FJ.json',
        description='基于单张参考图的角度调整（素材绑定和画面分镜专用）',
        placeholders=['image', 'prompt', 'seed'],
        param_mapping={
            'image_data': 'image',  # 单张输入图
            'prompt': 'prompt',      # 角度调整提示词（由滑杆生成）
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # I2I_HUMAN 工作流（多角度人物生成）
    'i2i_human': WorkflowConfig(
        name='多角度人物生成',
        file='I2I_HUMAN.json',
        description='基于单张参考图进行多角度人物生成',
        placeholders=['image'],
        param_mapping={
            'image_data': 'image'  # 单张输入图
        }
    ),

    # I2I_angel 工作流（旧版角度调整模板，保留后台可配置入口）
    'i2i_angel': WorkflowConfig(
        name='旧版图像角度调整',
        file='I2I_angel.json',
        description='旧版图像角度调整模板，基于单张参考图和提示词生成新角度',
        placeholders=['image', 'prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),

    # I2I_Around 工作流（全景角度生成）
    'i2i_around': WorkflowConfig(
        name='全景角度生成',
        file='I2I_Around.json',
        description='基于单张参考图生成全景/环绕角度结果',
        placeholders=['image', 'prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),

    # 视频处理工作流（GPU Agent 执行）
    'upscale': WorkflowConfig(
        name='视频高清放大',
        file='viedo_upscaler.json',
        description='使用 SeedVR2 对视频进行高清放大',
        placeholders=['video', 'Seed_6'],
        param_mapping={
            'video_filename': 'video',
            'seed_6': 'Seed_6'
        },
        default_params={
            'seed_6': 123456
        }
    ),

    'voice': WorkflowConfig(
        name='视频口型配音',
        file='video_infinitetalk.json',
        description='使用 InfiniteTalk 根据音频驱动视频口型和表情',
        placeholders=['video', 'Audio', 'prompt_AU'],
        param_mapping={
            'video_filename': 'video',
            'audio_filename': 'Audio',
            'prompt_AU': 'prompt_AU'
        },
        default_params={
            'prompt_AU': '生动的表情、自然的口型同步'
        }
    ),
    
    # Qwen 工作流（千问模型图像生成）- 1张参考图
    'qwen_1': WorkflowConfig(
        name='Qwen图像生成(1张)',
        file='qwen_1.json',
        description='基于Qwen模型的高质量图像生成(1张参考图)',
        placeholders=['image_1', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen 工作流 - 2张参考图
    'qwen_2': WorkflowConfig(
        name='Qwen图像生成(2张)',
        file='qwen_2.json',
        description='基于Qwen模型的高质量图像生成(2张参考图)',
        placeholders=['image_1', 'image_2', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen 工作流 - 3张参考图
    'qwen_3': WorkflowConfig(
        name='Qwen图像生成(3张)',
        file='qwen_3.json',
        description='基于Qwen模型的高质量图像生成(3张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen 工作流 - 4张参考图
    'qwen_4': WorkflowConfig(
        name='Qwen图像生成(4张)',
        file='qwen_4.json',
        description='基于Qwen模型的高质量图像生成(4张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen 工作流 - 5张参考图
    'qwen_5': WorkflowConfig(
        name='Qwen图像生成(5张)',
        file='qwen_5.json',
        description='基于Qwen模型的高质量图像生成(5张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'image_5': 'image_5',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen 工作流 - 6张参考图
    'qwen_6': WorkflowConfig(
        name='Qwen图像生成(6张)',
        file='qwen_6.json',
        description='基于Qwen模型的高质量图像生成(6张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'image_5': 'image_5',
            'image_6': 'image_6',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # =====================================================
    # K神（QwenN）工作流 - 画面分镜图像生成
    # =====================================================
    
    # K神 工作流 - 1张参考图
    'qwenN_1': WorkflowConfig(
        name='K神图像生成(1张)',
        file='qwenN_1.json',
        description='基于K神模型的高质量图像生成(1张参考图)',
        placeholders=['image_1', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # K神 工作流 - 2张参考图
    'qwenN_2': WorkflowConfig(
        name='K神图像生成(2张)',
        file='qwenN_2.json',
        description='基于K神模型的高质量图像生成(2张参考图)',
        placeholders=['image_1', 'image_2', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # K神 工作流 - 3张参考图
    'qwenN_3': WorkflowConfig(
        name='K神图像生成(3张)',
        file='qwenN_3.json',
        description='基于K神模型的高质量图像生成(3张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # K神 工作流 - 4张参考图
    'qwenN_4': WorkflowConfig(
        name='K神图像生成(4张)',
        file='qwenN_4.json',
        description='基于K神模型的高质量图像生成(4张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # K神 工作流 - 5张参考图
    'qwenN_5': WorkflowConfig(
        name='K神图像生成(5张)',
        file='qwenN_5.json',
        description='基于K神模型的高质量图像生成(5张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'image_5': 'image_5',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # K神 工作流 - 6张参考图
    'qwenN_6': WorkflowConfig(
        name='K神图像生成(6张)',
        file='qwenN_6.json',
        description='基于K神模型的高质量图像生成(6张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'image_5': 'image_5',
            'image_6': 'image_6',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Kontext 工作流（上下文连贯图像生成）
    'kontext': WorkflowConfig(
        name='Kontext图像生成',
        file='Kontext.json',
        description='基于Kontext模型的上下文连贯图像生成',
        placeholders=['image', 'prompt', 'negative_prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'negative_prompt': 'negative_prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1,
            'negative_prompt': 'nsfw, bad quality, worst quality, blurry'
        }
    ),
    
    # Qwen LoRA 工作流 - 1张参考图
    'qwen_lora_1': WorkflowConfig(
        name='Qwen LoRA图像生成(1张)',
        file='qwen_lora_1.json',
        description='基于Qwen LoRA模型的高质量图像生成(1张参考图)',
        placeholders=['image_1', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen LoRA 工作流 - 2张参考图
    'qwen_lora_2': WorkflowConfig(
        name='Qwen LoRA图像生成(2张)',
        file='qwen_lora_2.json',
        description='基于Qwen LoRA模型的高质量图像生成(2张参考图)',
        placeholders=['image_1', 'image_2', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen LoRA 工作流 - 3张参考图
    'qwen_lora_3': WorkflowConfig(
        name='Qwen LoRA图像生成(3张)',
        file='qwen_lora_3.json',
        description='基于Qwen LoRA模型的高质量图像生成(3张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen LoRA 工作流 - 4张参考图
    'qwen_lora_4': WorkflowConfig(
        name='Qwen LoRA图像生成(4张)',
        file='qwen_lora_4.json',
        description='基于Qwen LoRA模型的高质量图像生成(4张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen LoRA 工作流 - 5张参考图
    'qwen_lora_5': WorkflowConfig(
        name='Qwen LoRA图像生成(5张)',
        file='qwen_lora_5.json',
        description='基于Qwen LoRA模型的高质量图像生成(5张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'image_5': 'image_5',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # Qwen LoRA 工作流 - 6张参考图
    'qwen_lora_6': WorkflowConfig(
        name='Qwen LoRA图像生成(6张)',
        file='qwen_lora_6.json',
        description='基于Qwen LoRA模型的高质量图像生成(6张参考图)',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'image_5': 'image_5',
            'image_6': 'image_6',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # 素材处理工作流
    'upscale_hd': WorkflowConfig(
        name='高清放大',
        file='upscale_hd.json',
        description='使用处理集群放大图片到高清分辨率',
        placeholders=['image', 'seed_0'],
        param_mapping={
            'image': 'image',
            'seed_0': 'seed_0'
        },
        default_params={
            'seed_0': 123456  # 6位随机数
        }
    ),
    
    'remove_watermark': WorkflowConfig(
        name='图片去水印',
        file='remove_watermark.json',
        description='使用处理集群移除图片水印',
        placeholders=['image', 'seed'],
        param_mapping={
            'image': 'image',
            'seed': 'seed'
        },
        default_params={
            'seed': 100000000000000  # 15位随机数
        }
    ),
    
    'three_view': WorkflowConfig(
        name='一键三视图',
        file=None,
        description='使用处理集群生成物体的三视图',
        placeholders=['image', 'seed'],
        param_mapping={
            'image': 'image',
            'seed': 'seed'
        },
        default_params={
            'seed': 100000000000000  # 15位随机数
        }
    ),
    
    # ==================== 抠图工作流 ====================
    
    'matting_subject': WorkflowConfig(
        name='主体脱离',
        file=None,
        description='抠出图像主体，去除背景',
        placeholders=['image', 'seed'],
        param_mapping={
            'image': 'image',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'matting_split': WorkflowConfig(
        name='主体背景分离',
        file=None,
        description='分离图像主体和背景为两张图',
        placeholders=['image', 'seed'],
        param_mapping={
            'image': 'image',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # ==================== 融合工作流 ====================
    
    'image_fusion': WorkflowConfig(
        name='图像融合',
        file=None,
        description='将人物融合到底图中',
        placeholders=['image_BK', 'image_HU', 'seed'],
        param_mapping={
            'image_BK': 'image_BK',
            'image_HU': 'image_HU',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'image_transfer': WorkflowConfig(
        name='迁移学习',
        file=None,
        description='根据蒙版将人物迁移到底图指定位置',
        placeholders=['image_BK', 'image_HU', 'image_MB', 'seed'],
        param_mapping={
            'image_BK': 'image_BK',
            'image_HU': 'image_HU',
            'image_MB': 'image_MB',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'pose_imitation': WorkflowConfig(
        name='模仿学习',
        file=None,
        description='人物模仿另一图像中的姿势',
        placeholders=['image_BK', 'image_HU', 'seed'],
        param_mapping={
            'image_BK': 'image_BK',
            'image_HU': 'image_HU',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # ==================== 筑基二阶(qwenN_lora)工作流 ====================
    
    'qwenN_lora_1': WorkflowConfig(
        name='Qwen Image Edit 2509 + LoRA 1张参考图',
        file=None,
        description='使用K神LoRA模型生成图像（1张参考图）',
        placeholders=['image', 'prompt', 'seed'],
        param_mapping={
            'image_data': 'image',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'qwenN_lora_2': WorkflowConfig(
        name='Qwen Image Edit 2509 + LoRA 2张参考图',
        file=None,
        description='使用K神LoRA模型生成图像（2张参考图）',
        placeholders=['image_1', 'image_2', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'qwenN_lora_3': WorkflowConfig(
        name='Qwen Image Edit 2509 + LoRA 3张参考图',
        file=None,
        description='使用K神LoRA模型生成图像（3张参考图）',
        placeholders=['image_1', 'image_2', 'image_3', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'qwenN_lora_4': WorkflowConfig(
        name='Qwen Image Edit 2509 + LoRA 4张参考图',
        file=None,
        description='使用K神LoRA模型生成图像（4张参考图）',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'qwenN_lora_5': WorkflowConfig(
        name='Qwen Image Edit 2509 + LoRA 5张参考图',
        file=None,
        description='使用K神LoRA模型生成图像（5张参考图）',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'image_5': 'image_5',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'qwenN_lora_6': WorkflowConfig(
        name='Qwen Image Edit 2509 + LoRA 6张参考图',
        file=None,
        description='使用K神LoRA模型生成图像（6张参考图）',
        placeholders=['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'image_4': 'image_4',
            'image_5': 'image_5',
            'image_6': 'image_6',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    # ==================== 分镜弹窗工作流 ====================
    
    'panorama_360': WorkflowConfig(
        name='360度全景生成',
        file=None,
        description='基于场景素材生成360度全景照片',
        placeholders=['image', 'prompt', 'seed'],
        param_mapping={
            'image': 'image',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'panorama_fusion_1': WorkflowConfig(
        name='全景融合(1张输入)',
        file=None,
        description='全景场景融合（1张人物/场景）',
        placeholders=['image_1', 'image_3', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_3': 'image_3',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'panorama_fusion_2': WorkflowConfig(
        name='全景融合(2张输入)',
        file=None,
        description='全景场景融合（2张人物）',
        placeholders=['image_1', 'image_2', 'image_3', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'panorama_fusion_3': WorkflowConfig(
        name='全景融合(3张输入)',
        file=None,
        description='全景场景融合（3张输入）',
        placeholders=['image_1', 'image_2', 'image_3', 'prompt', 'seed'],
        param_mapping={
            'image_1': 'image_1',
            'image_2': 'image_2',
            'image_3': 'image_3',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
    
    'auto_storyboard': WorkflowConfig(
        name='自动分镜',
        file=None,
        description='自动生成分镜脚本并生成图像',
        placeholders=['image', 'prompt', 'seed'],
        param_mapping={
            'image': 'image',
            'prompt': 'prompt',
            'seed': 'seed'
        },
        default_params={
            'seed': -1
        }
    ),
}

# 默认工作流类型
DEFAULT_WORKFLOW_TYPE = 'single_angle'

# 工作流文件存放目录
WORKFLOW_DIR = 'workflows'


def get_workflow_config(workflow_type: str) -> Optional[WorkflowConfig]:
    """
    获取工作流配置
    
    Args:
        workflow_type: 工作流类型
        
    Returns:
        工作流配置对象，如果不存在返回 None
    """
    return WORKFLOW_CONFIGS.get(workflow_type)


def list_workflow_types() -> List[str]:
    """获取所有可用的工作流类型列表"""
    return list(WORKFLOW_CONFIGS.keys())


def list_workflow_configs() -> Dict[str, Dict[str, Any]]:
    """获取所有工作流配置的字典表示"""
    return {
        workflow_type: config.to_dict()
        for workflow_type, config in WORKFLOW_CONFIGS.items()
    }


def map_frontend_params_to_workflow(
    workflow_type: str,
    frontend_params: Dict[str, Any]
) -> Dict[str, Any]:
    """
    将前端参数映射到工作流占位符
    
    Args:
        workflow_type: 工作流类型
        frontend_params: 前端传来的参数
        
    Returns:
        映射后的工作流参数
    """
    config = get_workflow_config(workflow_type)
    if not config:
        raise ValueError(f"未知的工作流类型: {workflow_type}")
    
    # 从默认参数开始
    workflow_params = config.default_params.copy()
    
    # 根据映射配置转换参数
    for frontend_key, workflow_key in config.param_mapping.items():
        if frontend_key in frontend_params:
            workflow_params[workflow_key] = frontend_params[frontend_key]
    
    # 如果前端参数中有额外的参数（不在映射中），直接添加
    for key, value in frontend_params.items():
        if key not in config.param_mapping and key not in ['workflow_name', 'model']:
            workflow_params[key] = value
    
    return workflow_params


def validate_workflow_params(
    workflow_type: str,
    params: Dict[str, Any]
) -> tuple[bool, List[str]]:
    """
    验证工作流参数是否完整
    
    Args:
        workflow_type: 工作流类型
        params: 已映射的工作流参数
        
    Returns:
        (是否有效, 缺失的参数列表)
    """
    config = get_workflow_config(workflow_type)
    if not config:
        return False, [f"未知的工作流类型: {workflow_type}"]
    
    # 检查必需的占位符是否都有对应的参数
    missing = []
    for placeholder in config.placeholders:
        # seed 可以为 -1，表示随机，所以不检查
        if placeholder == 'seed':
            continue
        # 负面提示词有默认值，可以不传
        if placeholder == 'negative_prompt' and 'negative_prompt' in config.default_params:
            continue
        # 检查参数是否存在
        if placeholder not in params or params[placeholder] is None:
            missing.append(placeholder)
    
    return len(missing) == 0, missing


if __name__ == "__main__":
    # 测试工作流配置
    print("=== 工作流配置测试 ===\n")
    
    # 列出所有工作流
    print("可用的工作流类型:")
    for wf_type in list_workflow_types():
        config = get_workflow_config(wf_type)
        print(f"  - {wf_type}: {config.name}")
        print(f"    文件: {config.file}")
        print(f"    占位符: {config.placeholders}")
        print(f"    参数映射: {config.param_mapping}")
        print()
    
    # 测试参数映射
    print("\n测试参数映射:")
    frontend_params = {
        'image_data': 'test.png',
        'prompt': 'a beautiful building',
        'seed': 12345,
        'steps': 25
    }
    
    mapped = map_frontend_params_to_workflow('single_angle', frontend_params)
    print(f"前端参数: {frontend_params}")
    print(f"映射后参数: {mapped}")
    
    # 测试参数验证
    print("\n测试参数验证:")
    valid, missing = validate_workflow_params('single_angle', mapped)
    print(f"验证结果: {'通过' if valid else '失败'}")
    if not valid:
        print(f"缺失参数: {missing}")

