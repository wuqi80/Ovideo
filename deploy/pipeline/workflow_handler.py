# -*- coding: utf-8 -*-
"""
工作流处理器
加载工作流JSON并替换占位符
"""
import json
import random
import logging
import os
from copy import deepcopy
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class WorkflowHandler:
    """工作流处理器"""
    
    def __init__(self, workflow_dir: str = "workflows"):
        self.workflow_dir = Path(workflow_dir)
        self.workflows = {}
        self.load_workflows()
    
    def load_workflows(self):
        """加载所有工作流"""
        if not self.workflow_dir.exists():
            logger.warning(f"工作流目录不存在: {self.workflow_dir}")
            return
        
        for file_path in self.workflow_dir.glob("*.json"):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    workflow = json.load(f)
                    name = file_path.stem  # 文件名（不含扩展名）
                    self.workflows[name] = workflow
                    logger.info(f"✅ 加载工作流: {name}")
            except Exception as e:
                logger.error(f"❌ 加载工作流失败 {file_path}: {e}")
    
    def get_workflow(self, name: str) -> Optional[Dict]:
        """获取工作流 — 优先从磁盘读取最新版本，内存缓存作 fallback"""
        file_path = self.workflow_dir / f"{name}.json"
        if not file_path.is_file():
            file_path = next(
                (
                    candidate
                    for candidate in self.workflow_dir.glob("*.json")
                    if candidate.stem.lower() == str(name or "").lower()
                ),
                file_path,
            )
        if file_path.is_file():
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    workflow = json.load(f)
                self.workflows[name] = workflow
                return workflow
            except Exception as e:
                logger.warning(f"⚠️ 读取工作流文件失败 {file_path}: {e}")
        return self.workflows.get(name)

    def extract_executable_nodes(self, workflow: Dict, workflow_name: str) -> Dict:
        """Return a ComfyUI prompt graph without template metadata entries."""
        cleaned = {
            str(node_id): deepcopy(node)
            for node_id, node in workflow.items()
            if isinstance(node, dict)
            and node.get('class_type')
            and str(node.get('class_type')).lower() not in {'placeholder_node', 'placeholdernode'}
        }
        removed = len(workflow) - len(cleaned)
        if removed:
            logger.info(f"🧹 工作流 {workflow_name} 已移除 {removed} 个非执行节点/元信息字段")
        return cleaned
    
    def replace_placeholders(self, workflow: Dict, params: Dict[str, Any]) -> Dict:
        """
        替换工作流中的占位符
        
        占位符：
        - {prompt}: 提示词
        - {seed}: 15位随机数
        - {seed_1}: 另一个15位随机数
        - {image}: 图片文件名
        - {image_end}: 结束帧图片文件名（morph模式）
        """
        # 生成随机种子（15位数字）
        if 'seed' not in params or params['seed'] == -1:
            params['seed'] = self.generate_seed()
        
        if 'seed_1' not in params or params['seed_1'] == -1:
            params['seed_1'] = self.generate_seed()
        
        # 生成6位随机种子
        if 'seed_6' not in params or params['seed_6'] == -1:
            params['seed_6'] = self.generate_seed_6()
        
        # 处理视频路径：如果传入的是相对路径（如 output/xxx.mp4），转换为绝对路径
        if 'video' in params and params['video']:
            video_path = str(params['video'])
            # 检查是否是 output 目录下的文件
            if video_path.startswith('output/') or video_path.startswith('output\\'):
                # 获取绝对路径
                abs_path = Path(os.getcwd()) / video_path
                if abs_path.exists():
                    params['video'] = str(abs_path)
                    logger.info(f"✅ 转换视频路径为绝对路径: {params['video']}")
            # 如果是URL (包含 http)，尝试提取文件名并在 output 查找
            elif video_path.startswith('http'):
                # 假设 URL 结构是 .../output/filename.mp4 或 similar
                # 简单策略：取最后的文件名，在 output 找
                filename = Path(video_path).name
                possible_path = Path(os.getcwd()) / "output" / filename
                if possible_path.exists():
                    params['video'] = str(possible_path)
                    logger.info(f"✅ 从URL解析视频路径: {params['video']}")

        # 转换为JSON字符串进行全局替换
        workflow_str = json.dumps(workflow)
        
        # 替换占位符
        replacements = {
            '"{prompt}"': json.dumps(params.get('prompt', '')),  # 保持字符串格式
            '"{negative_prompt}"': json.dumps(params.get('negative_prompt', '')),
            '"{prompt_AU}"': json.dumps(params.get('prompt_AU', '')),  # 配音提示词
            '"{duration}"': str(params.get('duration', 5)),
            '"{seed}"': str(params.get('seed')),  # 替换为数字（移除引号）
            '"{seed_0}"': str(params.get('seed_0', params.get('seed', 123456))),  # seed_0
            '"{seed_1}"': str(params.get('seed_1')),  # 替换为数字（移除引号）
            '"{seed_6}"': str(params.get('seed_6')),  # 替换为数字（移除引号）
            '"{Seed_6}"': str(params.get('seed_6')),  # 替换为数字（移除引号）- 兼容大写
            '"{image}"': json.dumps(params.get('image', '')),  # 保持字符串格式
            '"{image_filename}"': json.dumps(params.get('image', '')),  # 保持字符串格式
            '"{start_image}"': json.dumps(params.get('start_image', '')),  # 首帧别名
            '"{first_frame_image}"': json.dumps(params.get('first_frame_image', '')),  # 首帧别名
            '"{image_end}"': json.dumps(params.get('image_end', '')),  # 保持字符串格式
            '"{image_filename_end}"': json.dumps(params.get('image_end', '')),  # 保持字符串格式
            '"{end_image}"': json.dumps(params.get('end_image', '')),  # 尾帧别名
            '"{last_frame_image}"': json.dumps(params.get('last_frame_image', '')),  # 尾帧别名
            '"{image_BK}"': json.dumps(params.get('image_BK', '')),  # 融合/迁移/模仿: 背景图
            '"{image_HU}"': json.dumps(params.get('image_HU', '')),  # 融合/迁移/模仿: 人物图
            '"{image_MB}"': json.dumps(params.get('image_MB', '')),  # 迁移学习: 蒙版图
            '"{video}"': json.dumps(params.get('video', '')),  # 保持字符串格式
            '"{Audio}"': json.dumps(params.get('Audio', '')),  # 音频文件名
        }
        
        # 添加 image_1 到 image_6 的占位符
        for i in range(1, 7):
            key = f'image_{i}'
            if key in params:
                replacements[f'"{{{key}}}"'] = json.dumps(params[key])
        
        for placeholder, value in replacements.items():
            if value and value != '""' and value != 'null':  # 跳过空值
                workflow_str = workflow_str.replace(placeholder, str(value))
        
        # 转回JSON对象
        result = json.loads(workflow_str)
        
        # 🔧 调试：显示实际的图片值
        image_values = {k: v[:50] if v and len(v) > 50 else v for k, v in params.items() if 'image' in k}
        logger.info(f"✅ 替换占位符完成: prompt={bool(params.get('prompt'))}, seed={params.get('seed')}, images={image_values}")
        return result

    @staticmethod
    def normalize_video_duration(value: Any) -> float | int:
        """Return a Wan-compatible duration without emitting invalid JSON."""
        try:
            duration = float(value)
        except (TypeError, ValueError):
            duration = 5.0
        duration = max(1.0, min(15.0, duration))
        return int(duration) if duration.is_integer() else duration

    @staticmethod
    def apply_gpu1_qwen_model_paths(
        workflow: Dict[str, Any],
        workflow_name: str,
    ) -> Dict[str, Any]:
        """Normalize legacy Qwen paths to the model inventory verified on GPU1."""
        normalized_name = str(workflow_name or '').lower()
        if not (
            normalized_name.startswith('qwen_')
            or normalized_name.startswith('qwen_lora_')
        ):
            return workflow

        replacements = {
            'Qwen_Image_Edit_2509_bf16.safetensors':
                'qwen/qwen_image_edit_2509_bf16.safetensors',
            'Qwen-Image-Lightning-4steps-V2.0.safetensors':
                'Qwen/Qwen-Image-Lightning-4steps-V2.0.safetensors',
        }
        for node in workflow.values():
            if not isinstance(node, dict):
                continue
            inputs = node.get('inputs')
            if not isinstance(inputs, dict):
                continue
            for key in ('unet_name', 'lora_name'):
                current = inputs.get(key)
                if current in replacements:
                    inputs[key] = replacements[current]
        return workflow

    @staticmethod
    def apply_gpu1_upscale_contract(
        workflow: Dict[str, Any],
        workflow_name: str,
    ) -> Dict[str, Any]:
        """Keep the verified tiled GPU1 graph while enforcing the UI's 4K target."""
        if str(workflow_name or '').lower() != 'upscale_hd':
            return workflow
        for node in workflow.values():
            if not isinstance(node, dict) or node.get('class_type') != 'MathExpression|pysssss':
                continue
            inputs = node.get('inputs') or {}
            if str(inputs.get('expression') or '').replace(' ', '') != 'a*1024':
                continue
            constant_link = inputs.get('a')
            if not isinstance(constant_link, list) or not constant_link:
                continue
            constant = workflow.get(str(constant_link[0]))
            if isinstance(constant, dict) and constant.get('class_type') == 'INTConstant':
                constant.setdefault('inputs', {})['value'] = 4
        return workflow

    @staticmethod
    def apply_ltx_duration_contract(
        workflow: Dict[str, Any],
        workflow_name: str,
        duration: Any,
    ) -> Dict[str, Any]:
        """Project the requested seconds into the verified LTX frame-count graph."""
        if str(workflow_name or '').lower() not in {'ltx_i2v', 'ltx_morph'}:
            return workflow
        normalized_duration = max(
            1,
            int(round(float(WorkflowHandler.normalize_video_duration(duration)))),
        )
        for node in workflow.values():
            if not isinstance(node, dict) or node.get('class_type') != 'MathExpression|pysssss':
                continue
            inputs = node.get('inputs') or {}
            if str(inputs.get('expression') or '').replace(' ', '') != 'a*b+1':
                continue
            duration_link = inputs.get('a')
            if not isinstance(duration_link, list) or not duration_link:
                continue
            duration_node = workflow.get(str(duration_link[0]))
            if isinstance(duration_node, dict) and duration_node.get('class_type') == 'PrimitiveInt':
                duration_node.setdefault('inputs', {})['value'] = normalized_duration
        return workflow

    @staticmethod
    def apply_output_dimensions(
        workflow: Dict[str, Any],
        output_width: Optional[int],
        output_height: Optional[int],
    ) -> Dict[str, Any]:
        """Apply an explicit image size to every latent-image source in a workflow."""
        if output_width is None or output_height is None:
            return workflow

        width = int(output_width)
        height = int(output_height)
        updated = 0
        for node in workflow.values():
            if not isinstance(node, dict) or node.get('class_type') != 'EmptyLatentImage':
                continue
            inputs = node.setdefault('inputs', {})
            inputs['width'] = width
            inputs['height'] = height
            updated += 1

        if updated:
            logger.info(f"🖼️ 已设置 {updated} 个潜空间节点输出尺寸: {width}x{height}")
        else:
            logger.info(f"ℹ️ 工作流无 EmptyLatentImage 节点，忽略输出尺寸: {width}x{height}")
        return workflow
    
    @staticmethod
    def generate_seed() -> int:
        """生成15位随机数"""
        # 生成 100000000000000 到 999999999999999 之间的随机数
        return random.randint(100000000000000, 999999999999999)
    
    @staticmethod
    def generate_seed_6() -> int:
        """生成6位随机数"""
        # 生成 100000 到 999999 之间的随机数
        return random.randint(100000, 999999)

    def resolve_workflow_name(self, task_type: str, task_data: Dict[str, Any]) -> str:
        """
        根据任务类型和模型参数解析 workflow key。
        """
        model = task_data.get('model', 'Wan2')

        # 🆕 模型到工作流前缀的映射
        model_workflow_prefix = {
            # Wan2 remains the stable frontend operation ID. GPU1 executes the
            # verified LTX graph; GPU2 replaces it with its isolated low-VRAM
            # Wan graph inside windows_gpu_agent_runner.py.
            'Wan2': 'ltx',
            '一阶': 'smooth',
            '二阶': 'dawasi',
            '三阶': 'hunyuan',
            '四阶': 'ltx',
            '五阶': 'turbo22',
            '六阶': 'turbo21',
            '七阶': 'svdwan',
        }
        
        # 🆕 不支持首尾帧的模型列表
        no_morph_models = ['三阶', '四阶', '五阶', '六阶', '七阶']
        
        # 根据任务类型选择工作流（直接映射或通过前缀匹配）
        workflow_map = {
            'upscale': 'viedo_upscaler',  # 视频放大
            'voice': 'video_infinitetalk',  # 视频配音
            'i2i_fj': 'I2I_FJ',  # 图生图角度调整
            'i2i_angel': 'I2I_angel',  # 旧版图生图角度调整
            'i2i_human': 'I2I_HUMAN',  # 多角度人物生成
            'i2i_around': 'I2I_Around',  # 🆕 全景角度生成
            'upscale_hd': 'upscale_hd',  # 图像高清放大
            'remove_watermark': 'remove_watermark',  # 去水印
            'three_view': 'three_view',  # 三视图
            # 🆕 抠图工作流
            'matting_subject': 'matting_subject',
            'matting_split': 'matting_split',
            # 🆕 融合工作流
            'image_fusion': 'image_fusion',
            'image_transfer': 'image_transfer',
            'pose_imitation': 'pose_imitation',
            # 🆕 分镜弹窗工作流
            'panorama_360': 'panorama_360',
            'panorama_fusion_1': 'panorama_fusion_1',
            'panorama_fusion_2': 'panorama_fusion_2',
            'panorama_fusion_3': 'panorama_fusion_3',
            'auto_storyboard': 'auto_storyboard',
        }
        
        # 直接查找映射
        workflow_name = workflow_map.get(task_type)
        
        # 🆕 处理 i2v 和 morph 任务类型（根据模型选择工作流）
        if not workflow_name and task_type in ['i2v', 'morph']:
            prefix = model_workflow_prefix.get(model, 'wan2')
            
            # 检查是否支持首尾帧模式
            if task_type == 'morph' and model in no_morph_models:
                raise ValueError(f"模型 {model} 不支持首尾帧模式")
            
            workflow_name = f"{prefix}_{task_type}"
            logger.info(f"🔧 根据模型 {model} 选择工作流: {workflow_name}")
        
        # 如果没有直接映射，检查是否是 qwen/qwen_lora/qwenN/qwenN_lora/kontext 系列
        if not workflow_name:
            # qwen_1 ~ qwen_6, qwenN_1 ~ qwenN_6, qwenN_lora_1 ~ qwenN_lora_6 直接使用任务类型作为工作流名
            if (task_type.startswith('qwen_') or 
                task_type.startswith('qwen_lora_') or
                task_type.startswith('qwenN_') or 
                task_type.startswith('qwenN_lora_') or
                task_type.startswith('kontext')):
                workflow_name = task_type
            else:
                raise ValueError(f"不支持的任务类型: {task_type}")

        return workflow_name

    def build_workflow_for_task(
        self,
        task_type: str,
        task_data: Dict[str, Any],
        workflow_override: Optional[Dict[str, Any]] = None,
    ) -> Dict:
        """
        为任务构建工作流
        
        Args:
            task_type: 任务类型 (i2v, morph, qwen_1, qwen_lora_2, i2i_fj, etc.)
            task_data: 任务数据，包含 image_path, prompt, model 等
            workflow_override: 后台 workflow_templates 中的完整工作流；为空时回退磁盘文件
        
        Returns:
            处理后的工作流JSON
        """
        workflow_name = self.resolve_workflow_name(task_type, task_data)

        # 获取工作流模板
        workflow = workflow_override if workflow_override is not None else self.get_workflow(workflow_name)
        if workflow is None:
            raise ValueError(f"找不到工作流: {workflow_name}")
        workflow = self.extract_executable_nodes(workflow, workflow_name)
        executable_nodes = list(workflow.values())
        if not executable_nodes:
            raise ValueError(f"工作流模板 {workflow_name}.json 不是可执行的 ComfyUI 节点图，请在后台导入完整 workflow JSON")
        
        # 🔧 调试：打印接收到的 task_data 中的图片字段
        image_fields_in_data = {k: v for k, v in task_data.items() if 'image' in k.lower()}
        logger.info(f"🔍 workflow_handler 接收到的图片字段: {image_fields_in_data}")
        
        # 准备替换参数
        primary_image = (
            task_data.get('uploaded_image')
            or task_data.get('image')
            or task_data.get('image_path')
            or task_data.get('start_image')
            or task_data.get('first_frame_image')
            or ''
        )
        tail_image = (
            task_data.get('uploaded_image_end')
            or task_data.get('image_end')
            or task_data.get('image_path_end')
            or task_data.get('end_image')
            or task_data.get('last_frame_image')
            or ''
        )

        params = {
            'prompt': task_data.get('prompt', ''),
            'negative_prompt': task_data.get('negative_prompt', ''),
            'prompt_AU': task_data.get('prompt_AU', ''),
            'duration': self.normalize_video_duration(task_data.get('duration')),
            'seed': task_data.get('seed', -1),
            'seed_0': task_data.get('seed_0', task_data.get('seed', random.randint(100000, 999999))),  # 6位随机数
            'seed_1': task_data.get('seed', -1),  # 默认使用相同seed
            'seed_6': task_data.get('seed', random.randint(100000, 999999)),  # 6位随机数
            'image': primary_image,
            'start_image': primary_image,
            'first_frame_image': primary_image,
            'image_end': tail_image,
            'end_image': tail_image,
            'last_frame_image': tail_image,
            'video': '',
            'Audio': '',
        }
        
        # 处理 qwen/qwen_lora/qwenN/qwenN_lora 系列的多图片参数 (uploaded_image_1, uploaded_image_2, ...)
        # Worker会将image_path_1转为uploaded_image_1
        for i in range(1, 7):
            uploaded_key = f'uploaded_image_{i}'
            if uploaded_key in task_data:
                params[f'image_{i}'] = task_data[uploaded_key]
                logger.info(f"🔧 设置 image_{i} = {task_data[uploaded_key]}")

        # 兼容兜底：cluster_main.py 对 qwen/qwen_lora/qwenN/qwenN_lora 统一发 image_path_X，
        # 不会发 image_path。一些早期 qwen_1/qwen_lora_1 模板的 LoadImage 节点占位符
        # 写成 {image}（应为 {image_1}），导致 {image} 永远拿不到值。把 image_1 兜底到
        # image，让两种命名都能正确替换。新工作流推荐统一使用 {image_X}。
        if not params.get('image') and params.get('image_1'):
            params['image'] = params['image_1']
            logger.info(f"🔧 单图兜底: image = image_1 = {params['image_1']}")
        if params.get('image') and not params.get('image_1'):
            params['image_1'] = params['image']
            logger.info(f"🔧 单图 Qwen 兜底: image_1 = image = {params['image']}")
        
        # 🆕 处理融合工作流的图片参数 (image_BK, image_HU, image_MB)
        if 'uploaded_image_BK' in task_data:
            params['image_BK'] = task_data['uploaded_image_BK']
            logger.info(f"🔧 设置 image_BK = {task_data['uploaded_image_BK']}")
        if 'uploaded_image_HU' in task_data:
            params['image_HU'] = task_data['uploaded_image_HU']
            logger.info(f"🔧 设置 image_HU = {task_data['uploaded_image_HU']}")
        if 'uploaded_image_MB' in task_data:
            params['image_MB'] = task_data['uploaded_image_MB']
            logger.info(f"🔧 设置 image_MB = {task_data['uploaded_image_MB']}")
        
        # upscale 模式需要视频文件名
        if task_type == 'upscale':
            video_filename = task_data.get('video_filename', '')
            if video_filename:
                # 视频文件名直接使用，不需要路径转换
                params['video'] = video_filename
                logger.info(f"✅ 视频放大 - 使用文件: {video_filename}")
            else:
                logger.error(f"❌ 视频放大任务缺少 video_filename 参数。task_data: {task_data}")
                raise ValueError("视频放大任务缺少 video_filename 参数")
        
        # voice 模式需要视频和音频文件名
        if task_type == 'voice':
            video_filename = task_data.get('video_filename', '')
            audio_filename = task_data.get('audio_filename', '')
            if video_filename and audio_filename:
                params['video'] = video_filename
                params['Audio'] = audio_filename
                params['prompt_AU'] = task_data.get('prompt_AU', '生动的表情、自然的口型同步')
                logger.info(f"✅ 视频配音 - 视频: {video_filename}, 音频: {audio_filename}")
            else:
                logger.error(f"❌ 视频配音任务缺少参数。task_data: {task_data}")
                raise ValueError("视频配音任务缺少 video_filename 或 audio_filename 参数")
        
        # morph 模式需要结束帧
        if task_type == 'morph' and 'uploaded_image_end' in task_data:
            params['image_end'] = task_data['uploaded_image_end']
            params['end_image'] = task_data['uploaded_image_end']
            params['last_frame_image'] = task_data['uploaded_image_end']
        
        # 替换占位符，并将前端选择的比例/档位落实到 GPU 图像工作流。
        workflow = self.apply_gpu1_qwen_model_paths(workflow, workflow_name)
        workflow = self.apply_gpu1_upscale_contract(workflow, workflow_name)
        workflow = self.apply_ltx_duration_contract(
            workflow,
            workflow_name,
            params['duration'],
        )
        rendered_workflow = self.replace_placeholders(workflow, params)
        return self.apply_output_dimensions(
            rendered_workflow,
            task_data.get('output_width'),
            task_data.get('output_height'),
        )

# 全局实例
_workflow_handler = None

def get_workflow_handler() -> WorkflowHandler:
    """获取全局工作流处理器实例"""
    global _workflow_handler
    if _workflow_handler is None:
        # 🔧 使用绝对路径，避免工作目录问题
        script_dir = Path(__file__).parent.resolve()
        workflow_dir = script_dir / "workflows"
        legacy_workflow_dir = script_dir.parent / "workflows"
        if not workflow_dir.exists() and legacy_workflow_dir.exists():
            workflow_dir = legacy_workflow_dir
        _workflow_handler = WorkflowHandler(str(workflow_dir))
        logger.info(f"📂 工作流目录（绝对路径）: {workflow_dir}")
    return _workflow_handler
