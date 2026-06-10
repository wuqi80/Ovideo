# -*- coding: utf-8 -*-
"""
ComfyUI 工作流管理器
支持动态工作流加载和占位符替换
"""
import json
import os
import re
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path
import copy

# 导入工作流配置
from workflow_config import (
    WORKFLOW_CONFIGS, get_workflow_config, 
    map_frontend_params_to_workflow, validate_workflow_params as validate_wf_params
)

logger = logging.getLogger(__name__)


class WorkflowManager:
    """工作流管理器 - 负责加载、管理和处理 ComfyUI 工作流"""
    
    def __init__(self, workflow_dir: str = "workflows"):
        """
        初始化工作流管理器
        
        Args:
            workflow_dir: 工作流文件存储目录
        """
        self.workflow_dir = Path(workflow_dir)
        self.workflow_dir.mkdir(exist_ok=True)
        
        # 工作流缓存
        self.workflows: Dict[str, Dict] = {}
        
        # 占位符映射配置
        self.placeholder_mappings: Dict[str, Dict[str, str]] = {}
        
        # 加载所有工作流
        self.load_all_workflows()
        
    def load_all_workflows(self):
        """加载所有工作流文件"""
        logger.info(f"正在从 {self.workflow_dir} 加载工作流...")
        
        for workflow_file in self.workflow_dir.glob("*.json"):
            try:
                workflow_name = workflow_file.stem
                with open(workflow_file, 'r', encoding='utf-8') as f:
                    workflow_data = json.load(f)
                    
                self.workflows[workflow_name] = workflow_data
                logger.info(f"✅ 加载工作流: {workflow_name}")
                
                # 自动检测占位符
                placeholders = self.detect_placeholders(workflow_data)
                if placeholders:
                    logger.info(f"   检测到占位符: {', '.join(placeholders)}")
                    
            except Exception as e:
                logger.error(f"❌ 加载工作流失败 {workflow_file}: {e}")
    
    def detect_placeholders(self, workflow: Dict) -> List[str]:
        """
        自动检测工作流中的占位符
        
        Args:
            workflow: 工作流 JSON 数据
            
        Returns:
            占位符列表
        """
        placeholders = set()
        
        # 递归查找所有占位符（格式: {placeholder_name}）
        def search_dict(obj):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    search_dict(value)
            elif isinstance(obj, list):
                for item in obj:
                    search_dict(item)
            elif isinstance(obj, str):
                # 查找 {xxx} 格式的占位符
                found = re.findall(r'\{(\w+)\}', obj)
                placeholders.update(found)
        
        search_dict(workflow)
        return sorted(list(placeholders))
    
    def save_workflow(self, workflow_name: str, workflow_data: Dict, 
                     placeholder_mapping: Optional[Dict[str, str]] = None) -> bool:
        """
        保存工作流到文件
        
        Args:
            workflow_name: 工作流名称
            workflow_data: 工作流 JSON 数据
            placeholder_mapping: 占位符映射配置（可选）
            
        Returns:
            是否保存成功
        """
        try:
            workflow_file = self.workflow_dir / f"{workflow_name}.json"
            
            with open(workflow_file, 'w', encoding='utf-8') as f:
                json.dump(workflow_data, f, indent=2, ensure_ascii=False)
            
            # 更新缓存
            self.workflows[workflow_name] = workflow_data
            
            # 保存占位符映射
            if placeholder_mapping:
                self.placeholder_mappings[workflow_name] = placeholder_mapping
                mapping_file = self.workflow_dir / f"{workflow_name}_mapping.json"
                with open(mapping_file, 'w', encoding='utf-8') as f:
                    json.dump(placeholder_mapping, f, indent=2, ensure_ascii=False)
            
            logger.info(f"✅ 保存工作流: {workflow_name}")
            
            # 检测并记录占位符
            placeholders = self.detect_placeholders(workflow_data)
            if placeholders:
                logger.info(f"   占位符: {', '.join(placeholders)}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ 保存工作流失败: {e}")
            return False
    
    def get_workflow(self, workflow_name: str) -> Optional[Dict]:
        """
        获取工作流模板（深拷贝）
        
        Args:
            workflow_name: 工作流名称
            
        Returns:
            工作流数据（深拷贝），如果不存在返回 None
        """
        if workflow_name in self.workflows:
            return copy.deepcopy(self.workflows[workflow_name])
        
        logger.warning(f"⚠️ 工作流不存在: {workflow_name}")
        return None
    
    def list_workflows(self) -> List[Dict[str, Any]]:
        """
        列出所有可用的工作流
        
        Returns:
            工作流信息列表
        """
        workflows_info = []
        
        for name, workflow_data in self.workflows.items():
            placeholders = self.detect_placeholders(workflow_data)
            
            workflows_info.append({
                "name": name,
                "placeholders": placeholders,
                "node_count": len(workflow_data),
                "has_mapping": name in self.placeholder_mappings
            })
        
        return workflows_info
    
    def replace_placeholders(self, workflow: Dict, params: Dict[str, Any]) -> Dict:
        """
        替换工作流中的占位符
        
        Args:
            workflow: 工作流数据（会被修改）
            params: 参数字典，key 是占位符名称，value 是要替换的值
            
        Returns:
            处理后的工作流
        """
        # 递归替换所有字符串中的占位符
        def replace_in_obj(obj):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    obj[key] = replace_in_obj(value)
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    obj[i] = replace_in_obj(item)
            elif isinstance(obj, str):
                # 替换所有占位符
                for placeholder, value in params.items():
                    pattern = f"{{{placeholder}}}"
                    if pattern in obj:
                        # 如果整个字符串就是占位符，直接替换为值（保持类型）
                        if obj == pattern:
                            return value
                        # 否则作为字符串替换
                        obj = obj.replace(pattern, str(value))
            return obj
        
        return replace_in_obj(workflow)
    
    def prepare_workflow(self, workflow_name: str, params: Dict[str, Any]) -> Optional[Dict]:
        """
        准备工作流：加载 + 替换占位符
        
        Args:
            workflow_name: 工作流名称
            params: 参数字典
            
        Returns:
            准备好的工作流，如果失败返回 None
        """
        # 获取工作流模板
        workflow = self.get_workflow(workflow_name)
        if not workflow:
            return None
        
        # 替换占位符
        try:
            workflow = self.replace_placeholders(workflow, params)
            logger.info(f"✅ 工作流准备完成: {workflow_name}")
            return workflow
        except Exception as e:
            logger.error(f"❌ 替换占位符失败: {e}")
            return None
    
    def prepare_workflow_with_frontend_params(
        self, 
        workflow_name: str, 
        frontend_params: Dict[str, Any]
    ) -> Optional[Dict]:
        """
        使用前端参数准备工作流（自动进行参数映射）
        
        Args:
            workflow_name: 工作流名称
            frontend_params: 前端参数（包含 image_data, prompt 等）
            
        Returns:
            准备好的工作流，如果失败返回 None
        """
        try:
            # 使用工作流配置进行参数映射
            workflow_params = map_frontend_params_to_workflow(workflow_name, frontend_params)
            
            logger.info(f"参数映射完成: {len(frontend_params)} 个前端参数 -> {len(workflow_params)} 个工作流参数")
            
            # 准备工作流
            return self.prepare_workflow(workflow_name, workflow_params)
            
        except Exception as e:
            logger.error(f"❌ 使用前端参数准备工作流失败: {e}")
            return None
    
    def get_workflow_info(self, workflow_name: str) -> Optional[Dict[str, Any]]:
        """
        获取工作流的详细信息（包括配置）
        
        Args:
            workflow_name: 工作流名称
            
        Returns:
            工作流信息字典
        """
        workflow = self.get_workflow(workflow_name)
        if not workflow:
            return None
        
        # 获取工作流配置
        config = get_workflow_config(workflow_name)
        
        # 自动检测占位符
        detected_placeholders = self.detect_placeholders(workflow)
        
        info = {
            "name": workflow_name,
            "node_count": len(workflow),
            "detected_placeholders": detected_placeholders,
            "has_config": config is not None
        }
        
        # 如果有配置，添加配置信息
        if config:
            info.update({
                "display_name": config.name,
                "description": config.description,
                "configured_placeholders": config.placeholders,
                "param_mapping": config.param_mapping,
                "default_params": config.default_params
            })
        
        return info
    
    def validate_params(self, workflow_name: str, params: Dict[str, Any]) -> tuple[bool, List[str]]:
        """
        验证参数是否满足工作流需求
        
        Args:
            workflow_name: 工作流名称
            params: 参数字典
            
        Returns:
            (是否验证通过, 缺失的参数列表)
        """
        workflow = self.get_workflow(workflow_name)
        if not workflow:
            return False, [f"工作流不存在: {workflow_name}"]
        
        # 检测所有占位符
        required_placeholders = self.detect_placeholders(workflow)
        
        # 检查缺失的参数
        missing_params = [p for p in required_placeholders if p not in params]
        
        if missing_params:
            logger.warning(f"⚠️ 缺失参数: {', '.join(missing_params)}")
            return False, missing_params
        
        return True, []
    
    def delete_workflow(self, workflow_name: str) -> bool:
        """
        删除工作流
        
        Args:
            workflow_name: 工作流名称
            
        Returns:
            是否删除成功
        """
        try:
            workflow_file = self.workflow_dir / f"{workflow_name}.json"
            mapping_file = self.workflow_dir / f"{workflow_name}_mapping.json"
            
            if workflow_file.exists():
                workflow_file.unlink()
            
            if mapping_file.exists():
                mapping_file.unlink()
            
            # 从缓存中删除
            if workflow_name in self.workflows:
                del self.workflows[workflow_name]
            
            if workflow_name in self.placeholder_mappings:
                del self.placeholder_mappings[workflow_name]
            
            logger.info(f"✅ 删除工作流: {workflow_name}")
            return True
            
        except Exception as e:
            logger.error(f"❌ 删除工作流失败: {e}")
            return False


# 创建全局工作流管理器实例
workflow_manager = WorkflowManager()


# 示例：创建默认的 Wan2.2 工作流模板
def create_default_workflows():
    """创建默认工作流模板（示例）"""
    
    # Wan2.2 I2V 工作流示例
    wan2_i2v = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": "{seed}",  # 占位符：随机种子
                "steps": 20,
                "cfg": 7.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": "wan2.2_i2v.safetensors"
            }
        },
        "5": {
            "class_type": "LoadImage",
            "inputs": {
                "image": "{image}"  # 占位符：输入图片
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "{prompt}",  # 占位符：正面提示词
                "clip": ["4", 1]
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "{negative_prompt}",  # 占位符：负面提示词
                "clip": ["4", 1]
            }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2]
            }
        },
        "9": {
            "class_type": "SaveVideo",
            "inputs": {
                "filename_prefix": "wan2_i2v",
                "images": ["8", 0]
            }
        }
    }
    
    # Wan2.2 Morph 工作流示例（首尾帧）
    wan2_morph = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": "{seed}",
                "steps": 25,
                "cfg": 8.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": "wan2.2_morph.safetensors"
            }
        },
        "5": {
            "class_type": "LoadImagePair",
            "inputs": {
                "start_image": "{start_image}",  # 占位符：起始图片
                "end_image": "{end_image}"       # 占位符：结束图片
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "{prompt}",
                "clip": ["4", 1]
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "{negative_prompt}",
                "clip": ["4", 1]
            }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2]
            }
        },
        "9": {
            "class_type": "SaveVideo",
            "inputs": {
                "filename_prefix": "wan2_morph",
                "images": ["8", 0]
            }
        }
    }
    
    # 保存默认工作流
    workflow_manager.save_workflow("wan2_i2v", wan2_i2v)
    workflow_manager.save_workflow("wan2_morph", wan2_morph)
    
    logger.info("✅ 默认工作流创建完成")


if __name__ == "__main__":
    # 测试工作流管理器
    print("=== ComfyUI 工作流管理器测试 ===\n")
    
    # 创建默认工作流
    create_default_workflows()
    
    # 列出所有工作流
    print("\n可用工作流:")
    for info in workflow_manager.list_workflows():
        print(f"  - {info['name']}: {info['node_count']} 节点, 占位符: {info['placeholders']}")
    
    # 测试准备工作流
    print("\n测试工作流准备:")
    params = {
        "image": "test.png",
        "seed": 12345,
        "prompt": "a beautiful landscape",
        "negative_prompt": "bad quality"
    }
    
    workflow = workflow_manager.prepare_workflow("wan2_i2v", params)
    if workflow:
        print("✅ 工作流准备成功")
        print(f"   Seed: {workflow['3']['inputs']['seed']}")
        print(f"   Image: {workflow['5']['inputs']['image']}")
        print(f"   Prompt: {workflow['6']['inputs']['text']}")
    else:
        print("❌ 工作流准备失败")
    
    # 测试参数验证
    print("\n测试参数验证:")
    valid, missing = workflow_manager.validate_params("wan2_i2v", {"seed": 123})
    print(f"验证结果: {'通过' if valid else '失败'}")
    if not valid:
        print(f"缺失参数: {', '.join(missing)}")

