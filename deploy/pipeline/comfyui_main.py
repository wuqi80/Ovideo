# -*- coding: utf-8 -*-
"""
ComfyUI API 集成后端服务
基于 FastAPI 的图像/视频生成服务
"""
from fastapi import FastAPI, HTTPException, Request, Depends, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import requests
import aiohttp
import asyncio
import websockets
import json
import uuid
import os
import logging
import time
import shutil
from datetime import datetime
from typing import Optional, Dict, List, Any
from pathlib import Path
import base64
from io import BytesIO
from PIL import Image

# 导入配置
from config import (
    ComfyUIConfig, SystemConfig, WorkflowConfig, 
    StorageConfig, ModelConfig, validate_config, init_directories
)

# 导入工作流管理器和配置
from workflow_manager import workflow_manager, create_default_workflows
from workflow_config import (
    WORKFLOW_CONFIGS, get_workflow_config, list_workflow_types,
    list_workflow_configs, map_frontend_params_to_workflow
)

# 导入图片处理器
from image_processor import ImageProcessor

# 配置日志
logging.basicConfig(
    level=getattr(logging, SystemConfig.LOG_LEVEL),
    format=SystemConfig.LOG_FORMAT
)
logger = logging.getLogger(__name__)

# 验证配置
config_errors = validate_config()
if config_errors:
    logger.error("配置验证失败:")
    for error in config_errors:
        logger.error(f"  - {error}")
    logger.warning("将使用默认配置继续运行")

# 初始化目录
init_directories()

# 创建 FastAPI 应用
app = FastAPI(
    title=SystemConfig.FRONTEND_CONFIG["title"],
    description=SystemConfig.FRONTEND_CONFIG["description"],
    version=SystemConfig.FRONTEND_CONFIG["version"]
)

# 添加 CORS 支持
app.add_middleware(
    CORSMiddleware,
    allow_origins=SystemConfig.ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件目录（用于 logo、图片等静态资源）
# 如果 static 目录不存在，创建它
import os
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# 用户认证配置
try:
    DEFAULT_USERS = json.loads(os.getenv("COMFYUI_LEGACY_USERS_JSON", "{}"))
except (TypeError, ValueError):
    DEFAULT_USERS = {}
if not isinstance(DEFAULT_USERS, dict):
    DEFAULT_USERS = {}

# Session 存储
active_sessions = {}

# 任务状态存储
task_storage = {}
upload_owners = {}

# 认证依赖
security = HTTPBearer(auto_error=False)

def verify_credentials(username: str, password: str) -> bool:
    """验证用户凭据"""
    return username in DEFAULT_USERS and DEFAULT_USERS[username] == password

def create_session_token(username: str) -> str:
    """创建 session token"""
    import secrets
    token = secrets.token_urlsafe(32)
    active_sessions[token] = {
        'username': username,
        'created_at': datetime.now(),
        'last_active': datetime.now()
    }
    return token

def verify_session(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[str]:
    """验证 session"""
    if not credentials:
        return None
    
    token = credentials.credentials
    if token in active_sessions:
        session = active_sessions[token]
        # 更新最后活跃时间
        session['last_active'] = datetime.now()
        
        # 检查 session 是否过期
        if (datetime.now() - session['created_at']).total_seconds() > SystemConfig.SESSION_TIMEOUT:
            del active_sessions[token]
            return None
            
        return session['username']
    
    return None

def require_auth(username: Optional[str] = Depends(verify_session)) -> str:
    """需要认证的依赖"""
    if not username:
        raise HTTPException(status_code=401, detail="需要登录")
    return username


def _require_task_owner(task_id: str, username: str) -> dict:
    task = task_storage.get(task_id)
    if not task or task.get("user") != username:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _task_for_prompt(prompt_id: str, username: str) -> Optional[dict]:
    for task in task_storage.values():
        if task.get("prompt_id") == prompt_id and task.get("user") == username:
            return task
    return None


def _owns_artifact(filename: str, username: str) -> bool:
    if upload_owners.get(filename) == username:
        return True
    for task in task_storage.values():
        if task.get("user") != username:
            continue
        result = task.get("result") or {}
        for entry in result.get("output_files") or []:
            if entry.get("filename") == filename or Path(str(entry.get("url") or "")).name == filename:
                return True
    return False


def _safe_child(root: str, filename: str) -> Path:
    base = Path(root).resolve()
    candidate = (base / filename).resolve()
    if candidate.parent != base:
        raise HTTPException(status_code=404, detail="File not found")
    return candidate


def _require_configured_comfyui_server(server: Optional[str]) -> str:
    configured = str(ComfyUIConfig.COMFYUI_BASE_URL).rstrip("/")
    requested = str(server or configured).rstrip("/")
    if requested != configured:
        raise HTTPException(status_code=400, detail="Unregistered processing node")
    return configured


def _save_output_file(content: bytes, task_id: str, filename: str, content_type: str) -> dict:
    ext = Path(filename).suffix.lower()
    IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"}
    VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv"}
    if ext in IMAGE_EXTS:
        category = "images"
    elif ext in VIDEO_EXTS:
        category = "videos"
    else:
        major = content_type.split("/")[0] if content_type else "other"
        category = {"image": "images", "video": "videos"}.get(major, "others")
    year_month = datetime.now().strftime("%Y%m")
    disk_name = f"{task_id}_{filename}"
    rel_path = f"{category}/{year_month}/{disk_name}"
    full_path = Path("persistent_storage") / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    return {"url": f"/storage/{rel_path}", "filename": filename, "size": len(content)}


def _build_task_result(file_entries: list, duration: float = 0.0) -> dict:
    images, videos = [], []
    for entry in file_entries:
        fname = entry.get("filename", "").lower()
        if any(fname.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".avi")):
            videos.append(entry)
        else:
            images.append(entry)
    return {"images": images, "videos": videos, "output_files": file_entries, "duration": duration}


# Pydantic 模型
class LoginRequest(BaseModel):
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="密码")
    remember: bool = Field(False, description="记住登录")

class GenerateRequest(BaseModel):
    workflow_name: str = Field(..., description="工作流名称，如: wan2_i2v, wan2_morph")
    model: str = Field("Wan2", description="使用的模型")
    prompt: str = Field("", description="提示词")
    negative_prompt: str = Field("nsfw, bad quality, worst quality", description="负面提示词")
    # 改为使用已上传的文件名（通过 /api/comfyui/upload 上传后获得）
    image_filename: Optional[str] = Field(None, description="已上传到处理节点的图片文件名")
    image_filename_end: Optional[str] = Field(None, description="结束帧图片文件名（用于 morph）")
    seed: int = Field(-1, description="随机种子，-1 表示随机")
    steps: int = Field(20, description="生成步数")
    cfg: float = Field(7.5, description="CFG 强度")
    width: int = Field(1024, description="图片宽度")
    height: int = Field(1024, description="图片高度")
    batch_size: int = Field(1, description="批次大小")
    # ComfyUI 服务器地址（用于集群环境）
    comfyui_server: Optional[str] = Field(None, description="指定的处理节点地址")
    # 额外参数（用于替换工作流占位符）
    extra_params: Optional[Dict[str, Any]] = Field(None, description="额外参数")

class TaskStatusResponse(BaseModel):
    task_id: str
    status: str  # queued, running, completed, failed
    progress: float
    message: str
    result_url: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

# ==================== ComfyUI API 交互 ====================

class ComfyUIClient:
    """ComfyUI API 客户端"""
    
    def __init__(self):
        self.base_url = ComfyUIConfig.COMFYUI_BASE_URL
        self.ws_url = ComfyUIConfig.COMFYUI_WS_URL
        self.client_id = str(uuid.uuid4())
    
    async def upload_image(self, file_content: bytes, filename: str) -> str:
        """上传图片到 ComfyUI（直接使用文件流，不需要 Base64）"""
        try:
            url = f"{self.base_url}{ComfyUIConfig.UPLOAD_ENDPOINT}"
            
            # 使用 aiohttp 的 FormData
            data = aiohttp.FormData()
            data.add_field('image',
                          file_content,
                          filename=filename,
                          content_type='image/png')
            data.add_field('overwrite', 'true')
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, data=data, timeout=ComfyUIConfig.REQUEST_TIMEOUT) as response:
                    if response.status == 200:
                        result = await response.json()
                        uploaded_filename = result.get('name', filename)
                        logger.info(f"图片上传成功: {uploaded_filename}")
                        return uploaded_filename
                    else:
                        error_text = await response.text()
                        logger.error(f"图片上传失败: {response.status} - {error_text}")
                        raise HTTPException(status_code=500, detail=f"图片上传失败: {error_text}")
        
        except Exception as e:
            logger.error(f"上传图片时发生错误: {e}")
            raise HTTPException(status_code=500, detail=f"上传图片失败: {str(e)}")
    
    async def submit_prompt(self, workflow: Dict, client_id: Optional[str] = None) -> str:
        """提交工作流到 ComfyUI"""
        try:
            url = f"{self.base_url}{ComfyUIConfig.PROMPT_ENDPOINT}"
            
            payload = {
                "prompt": workflow,
                "client_id": client_id or self.client_id
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, timeout=ComfyUIConfig.REQUEST_TIMEOUT) as response:
                    if response.status == 200:
                        result = await response.json()
                        prompt_id = result.get('prompt_id')
                        logger.info(f"工作流提交成功，prompt_id: {prompt_id}")
                        return prompt_id
                    else:
                        error_text = await response.text()
                        logger.error(f"工作流提交失败: {response.status} - {error_text}")
                        raise HTTPException(status_code=500, detail=f"工作流提交失败: {error_text}")
        
        except Exception as e:
            logger.error(f"提交工作流时发生错误: {e}")
            raise HTTPException(status_code=500, detail=f"提交工作流失败: {str(e)}")
    
    async def get_history(self, prompt_id: str) -> Dict:
        """获取任务历史和结果"""
        try:
            url = f"{self.base_url}{ComfyUIConfig.HISTORY_ENDPOINT}/{prompt_id}"
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=ComfyUIConfig.REQUEST_TIMEOUT) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result.get(prompt_id, {})
                    else:
                        error_text = await response.text()
                        logger.error(f"获取历史失败: {response.status} - {error_text}")
                        return {}
        
        except Exception as e:
            logger.error(f"获取历史时发生错误: {e}")
            return {}
    
    async def get_image(self, filename: str, subfolder: str = "", folder_type: str = "output") -> bytes:
        """从 ComfyUI 获取生成的图片"""
        try:
            url = f"{self.base_url}{ComfyUIConfig.VIEW_ENDPOINT}"
            params = {
                "filename": filename,
                "subfolder": subfolder,
                "type": folder_type
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=ComfyUIConfig.REQUEST_TIMEOUT) as response:
                    if response.status == 200:
                        return await response.read()
                    else:
                        error_text = await response.text()
                        logger.error(f"获取图片失败: {response.status} - {error_text}")
                        return b""
        
        except Exception as e:
            logger.error(f"获取图片时发生错误: {e}")
            return b""
    
    async def monitor_progress(self, prompt_id: str, task_id: str, timeout: int = 300):
        """监控任务进度（通过 WebSocket）"""
        try:
            async with websockets.connect(f"{self.ws_url}?clientId={self.client_id}") as websocket:
                start_time = time.time()
                
                while True:
                    # 检查超时
                    if time.time() - start_time > timeout:
                        logger.warning(f"任务 {task_id} 超时")
                        task_storage[task_id]['status'] = 'failed'
                        task_storage[task_id]['error'] = '任务执行超时'
                        break
                    
                    try:
                        # 接收消息（超时 5 秒）
                        message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                        data = json.loads(message)
                        
                        msg_type = data.get('type')
                        
                        # 处理不同类型的消息
                        if msg_type == 'progress':
                            # 更新进度
                            progress_data = data.get('data', {})
                            value = progress_data.get('value', 0)
                            max_value = progress_data.get('max', 100)
                            progress = (value / max_value) * 100 if max_value > 0 else 0
                            
                            task_storage[task_id]['progress'] = progress
                            task_storage[task_id]['updated_at'] = datetime.now()
                            logger.info(f"任务 {task_id} 进度: {progress:.1f}%")
                        
                        elif msg_type == 'executing':
                            # 检查是否完成
                            node = data.get('data', {}).get('node')
                            if node is None:
                                # 任务完成
                                logger.info(f"任务 {task_id} 执行完成")
                                task_storage[task_id]['status'] = 'completed'
                                task_storage[task_id]['progress'] = 100
                                
                                # 获取结果
                                await self.fetch_result(prompt_id, task_id)
                                break
                        
                        elif msg_type == 'execution_error':
                            # 执行错误
                            error_data = data.get('data', {})
                            error_msg = error_data.get('exception_message', '未知错误')
                            logger.error(f"任务 {task_id} 执行失败: {error_msg}")
                            task_storage[task_id]['status'] = 'failed'
                            task_storage[task_id]['error'] = error_msg
                            break
                    
                    except asyncio.TimeoutError:
                        # 超时，继续等待
                        continue
                    except json.JSONDecodeError as e:
                        logger.error(f"解析 WebSocket 消息失败: {e}")
                        continue
        
        except Exception as e:
            logger.error(f"监控任务进度时发生错误: {e}")
            task_storage[task_id]['status'] = 'failed'
            task_storage[task_id]['error'] = str(e)
    
    async def fetch_result(self, prompt_id: str, task_id: str):
        """获取任务结果"""
        try:
            history = await self.get_history(prompt_id)

            if not history:
                logger.error(f"无法获取任务 {task_id} 的历史记录")
                task_storage[task_id]['status'] = 'failed'
                task_storage[task_id]['error'] = '无法获取结果'
                return

            outputs = history.get('outputs', {})
            file_entries = []

            for node_id, node_output in outputs.items():
                for image_info in node_output.get('images', []):
                    filename = image_info['filename']
                    subfolder = image_info.get('subfolder', '')
                    data = await self.get_image(filename, subfolder)
                    if data:
                        entry = _save_output_file(data, task_id, filename, "image/png")
                        file_entries.append(entry)

                for video_info in node_output.get('videos', []):
                    filename = video_info['filename']
                    subfolder = video_info.get('subfolder', '')
                    data = await self.get_image(filename, subfolder)
                    if data:
                        entry = _save_output_file(data, task_id, filename, "video/mp4")
                        file_entries.append(entry)

            if file_entries:
                task_storage[task_id]['result'] = _build_task_result(file_entries)
                task_storage[task_id]['result_url'] = file_entries[0]['url']
                logger.info(f"任务 {task_id} 结果已保存: {len(file_entries)} 个文件")
            else:
                task_storage[task_id]['status'] = 'failed'
                task_storage[task_id]['error'] = '未获取到输出文件'

        except Exception as e:
            logger.error(f"获取任务结果时发生错误: {e}")
            task_storage[task_id]['status'] = 'failed'
            task_storage[task_id]['error'] = str(e)

# 创建 ComfyUI 客户端实例
comfyui_client = ComfyUIClient()

# 创建图片处理器实例
image_processor = ImageProcessor(
    comfyui_base_url=ComfyUIConfig.COMFYUI_BASE_URL,
    local_storage_dir=StorageConfig.OUTPUT_DIR,
    jpeg_quality=85
)

# ==================== API 端点 ====================

@app.get("/")
async def root():
    """返回登录页面"""
    return FileResponse('login.html')

@app.get("/login")
async def login_page():
    """返回登录页面"""
    return FileResponse('login.html')

@app.get("/workspace")
async def workspace_page():
    """返回工作区页面"""
    return FileResponse('workspace.html')

@app.get("/app")
async def app_page():
    """重定向到工作区页面"""
    return RedirectResponse(url="/workspace")

@app.post("/api/login")
async def login(request: LoginRequest):
    """用户登录"""
    try:
        if not verify_credentials(request.username, request.password):
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        
        # 创建 session token
        token = create_session_token(request.username)
        
        logger.info(f"用户 {request.username} 登录成功")
        
        return {
            "success": True,
            "message": "登录成功",
            "token": token,
            "username": request.username,
            "remember": request.remember
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"登录失败: {e}")
        raise HTTPException(status_code=500, detail="登录过程中发生错误")

@app.post("/api/logout")
async def logout(username: str = Depends(require_auth)):
    """用户登出"""
    try:
        # 清除相关的 session tokens
        tokens_to_remove = []
        for token, session in active_sessions.items():
            if session['username'] == username:
                tokens_to_remove.append(token)
        
        for token in tokens_to_remove:
            del active_sessions[token]
        
        logger.info(f"用户 {username} 登出成功")
        
        return {
            "success": True,
            "message": "登出成功"
        }
        
    except Exception as e:
        logger.error(f"登出失败: {e}")
        raise HTTPException(status_code=500, detail="登出过程中发生错误")

@app.get("/api/user/info")
async def get_user_info(username: str = Depends(require_auth)):
    """获取当前用户信息"""
    return {
        "username": username,
        "login_time": datetime.now().isoformat(),
        "permissions": ["generate", "upload", "history"]
    }

@app.post("/api/generate")
async def generate_task(request: GenerateRequest, username: str = Depends(require_auth)):
    """创建生成任务"""
    try:
        _require_configured_comfyui_server(request.comfyui_server)
        # 生成任务 ID
        task_id = str(uuid.uuid4())
        
        logger.info(f"用户 {username} 创建任务 {task_id}, 工作流: {request.workflow_name}, 模型: {request.model}")
        
        # 初始化任务状态
        task_storage[task_id] = {
            'task_id': task_id,
            'status': 'queued',
            'progress': 0,
            'message': '任务已加入队列',
            'result_url': None,
            'error': None,
            'created_at': datetime.now(),
            'updated_at': datetime.now(),
            'user': username,
            'request': request.dict()
        }
        
        # 异步处理任务
        asyncio.create_task(process_generation_task(task_id, request))
        
        return {
            "success": True,
            "task_id": task_id,
            "message": "任务已创建，正在处理中"
        }
        
    except Exception as e:
        logger.error(f"创建任务失败: {e}")
        raise HTTPException(status_code=500, detail=f"创建任务失败: {str(e)}")

async def process_generation_task(task_id: str, request: GenerateRequest):
    """处理生成任务（使用已上传的图片文件名）"""
    try:
        # 更新状态为运行中
        task_storage[task_id]['status'] = 'running'
        task_storage[task_id]['message'] = '正在准备工作流...'
        task_storage[task_id]['updated_at'] = datetime.now()
        
        # 准备工作流参数
        workflow_params = {
            "prompt": request.prompt,
            "negative_prompt": request.negative_prompt,
            "seed": request.seed if request.seed != -1 else int(time.time()),
            "steps": request.steps,
            "cfg": request.cfg,
            "width": request.width,
            "height": request.height,
            "batch_size": request.batch_size
        }
        
        # 使用已上传的图片文件名（不再需要上传）
        if request.image_filename:
            workflow_params["image"] = request.image_filename
            logger.info(f"使用已上传的图片: {request.image_filename}")
        
        # 处理第二张图片（morph 模式）
        if request.image_filename_end:
            workflow_params["start_image"] = request.image_filename
            workflow_params["end_image"] = request.image_filename_end
            logger.info(f"使用已上传的图片对: {request.image_filename} -> {request.image_filename_end}")
        
        # 添加额外参数
        if request.extra_params:
            workflow_params.update(request.extra_params)
        
        # 使用工作流管理器准备工作流
        task_storage[task_id]['message'] = '正在准备工作流...'
        workflow = workflow_manager.prepare_workflow(request.workflow_name, workflow_params)
        
        if not workflow:
            raise Exception(f"工作流不存在或准备失败: {request.workflow_name}")
        
        # 验证参数
        valid, missing = workflow_manager.validate_params(request.workflow_name, workflow_params)
        if not valid:
            logger.warning(f"参数验证失败，缺少: {missing}. 继续执行...")
        
        # 确定目标 ComfyUI 服务器（用于集群环境）
        target_server = request.comfyui_server or ComfyUIConfig.COMFYUI_BASE_URL
        logger.info(f"提交到 ComfyUI 服务器: {target_server}")
        
        # 提交工作流
        task_storage[task_id]['message'] = '正在提交到处理节点...'
        task_storage[task_id]['comfyui_server'] = target_server
        
        # 如果指定了服务器，临时修改 client 的 base_url
        original_base_url = comfyui_client.base_url
        if request.comfyui_server:
            comfyui_client.base_url = request.comfyui_server
        
        try:
            prompt_id = await comfyui_client.submit_prompt(workflow)
            
            task_storage[task_id]['prompt_id'] = prompt_id
            task_storage[task_id]['message'] = '正在生成中...'
            
            # 监控进度
            await comfyui_client.monitor_progress(prompt_id, task_id, timeout=ComfyUIConfig.GENERATION_TIMEOUT)
            
        finally:
            # 恢复原始 base_url
            comfyui_client.base_url = original_base_url
        
        task_storage[task_id]['updated_at'] = datetime.now()
        
    except Exception as e:
        logger.error(f"处理任务 {task_id} 时发生错误: {e}")
        task_storage[task_id]['status'] = 'failed'
        task_storage[task_id]['error'] = str(e)
        task_storage[task_id]['message'] = f'任务失败: {str(e)}'
        task_storage[task_id]['updated_at'] = datetime.now()

@app.get("/api/task/{task_id}")
async def get_task_status(task_id: str, username: str = Depends(require_auth)):
    _require_task_owner(task_id, username)
    """获取任务状态"""
    if task_id not in task_storage:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    task = task_storage[task_id]
    
    return {
        "task_id": task['task_id'],
        "status": task['status'],
        "progress": task['progress'],
        "message": task['message'],
        "result_url": task.get('result_url'),
        "result": task.get('result'),
        "error": task.get('error'),
        "created_at": task['created_at'].isoformat(),
        "updated_at": task['updated_at'].isoformat()
    }

@app.get("/api/tasks")
async def list_tasks(username: str = Depends(require_auth)):
    """获取所有任务列表"""
    tasks = []
    for task_id, task in task_storage.items():
        if task.get('user') == username:
            tasks.append({
                "task_id": task['task_id'],
                "status": task['status'],
                "progress": task['progress'],
                "message": task['message'],
                "result_url": task.get('result_url'),
                "created_at": task['created_at'].isoformat(),
                "updated_at": task['updated_at'].isoformat()
            })
    
    # 按创建时间倒序排列
    tasks.sort(key=lambda x: x['created_at'], reverse=True)
    
    return {
        "success": True,
        "total": len(tasks),
        "tasks": tasks
    }

@app.get("/outputs/{filename}")
async def get_output_file(filename: str, username: str = Depends(require_auth)):
    """获取输出文件"""
    if not _owns_artifact(filename, username):
        raise HTTPException(status_code=404, detail="File not found")
    file_path = _safe_child(StorageConfig.OUTPUT_DIR, filename)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    # 根据文件扩展名确定媒体类型
    ext = file_path.suffix.lower()
    media_type_map = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm'
    }
    
    media_type = media_type_map.get(ext, 'application/octet-stream')
    
    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type=media_type
    )

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), username: str = Depends(require_auth)):
    """上传文件"""
    try:
        # 检查文件大小
        contents = await file.read()
        if len(contents) > StorageConfig.MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="文件太大")
        
        # 检查文件类型
        if file.content_type not in StorageConfig.ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="不支持的文件类型")
        
        # 生成唯一文件名
        file_id = str(uuid.uuid4())
        ext = Path(file.filename).suffix
        filename = f"{file_id}{ext}"
        
        # 保存文件
        file_path = Path(StorageConfig.UPLOAD_DIR) / filename
        file_path.write_bytes(contents)
        upload_owners[filename] = username
        
        logger.info(f"用户 {username} 上传文件: {filename}")
        
        # 转换为 base64（用于前端显示）
        base64_data = base64.b64encode(contents).decode('utf-8')
        data_url = f"data:{file.content_type};base64,{base64_data}"
        
        return {
            "success": True,
            "file_id": file_id,
            "filename": filename,
            "url": f"/uploads/{filename}",
            "data_url": data_url
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"上传文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")

@app.get("/uploads/{filename}")
async def get_upload_file(filename: str, username: str = Depends(require_auth)):
    """获取上传的文件"""
    if upload_owners.get(filename) != username:
        raise HTTPException(status_code=404, detail="File not found")
    file_path = _safe_child(StorageConfig.UPLOAD_DIR, filename)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    return FileResponse(path=str(file_path))

@app.get("/health")
async def health_check():
    """健康检查"""
    try:
        # 尝试连接 ComfyUI
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{ComfyUIConfig.COMFYUI_BASE_URL}/system_stats", timeout=5) as response:
                comfyui_status = "healthy" if response.status == 200 else "unhealthy"
    except:
        comfyui_status = "unreachable"
    
    return {
        "status": "healthy",
        "service": SystemConfig.FRONTEND_CONFIG["title"],
        "version": SystemConfig.FRONTEND_CONFIG["version"],
        "processing_status": comfyui_status,
    }

@app.get("/api/config")
async def get_config():
    """获取系统配置"""
    return {
        "models": list(ModelConfig.AVAILABLE_MODELS.keys()),
        "default_params": ModelConfig.DEFAULT_PARAMS,
        "max_upload_size": StorageConfig.MAX_UPLOAD_SIZE,
        "allowed_image_types": StorageConfig.ALLOWED_IMAGE_TYPES,
        "task_types": ["i2v", "morph", "img2img"]
    }

# ==================== 工作流管理 API ====================

@app.get("/api/workflows")
async def list_workflows(username: str = Depends(require_auth)):
    """获取所有可用的工作流列表"""
    try:
        workflows = workflow_manager.list_workflows()
        return {
            "success": True,
            "workflows": workflows,
            "count": len(workflows)
        }
    except Exception as e:
        logger.error(f"获取工作流列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/workflows/{workflow_name}")
async def get_workflow_detail(workflow_name: str, username: str = Depends(require_auth)):
    """获取工作流详情"""
    try:
        workflow = workflow_manager.get_workflow(workflow_name)
        if not workflow:
            raise HTTPException(status_code=404, detail=f"工作流不存在: {workflow_name}")
        
        placeholders = workflow_manager.detect_placeholders(workflow)
        
        return {
            "success": True,
            "workflow_name": workflow_name,
            "workflow": workflow,
            "placeholders": placeholders,
            "node_count": len(workflow)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取工作流详情失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/workflows/{workflow_name}")
async def upload_workflow(
    workflow_name: str,
    workflow_file: UploadFile = File(...),
    username: str = Depends(require_auth)
):
    """上传自定义工作流"""
    try:
        # 读取上传的工作流文件
        content = await workflow_file.read()
        workflow_data = json.loads(content.decode('utf-8'))
        
        # 保存工作流
        success = workflow_manager.save_workflow(workflow_name, workflow_data)
        
        if success:
            placeholders = workflow_manager.detect_placeholders(workflow_data)
            return {
                "success": True,
                "message": f"工作流 {workflow_name} 上传成功",
                "workflow_name": workflow_name,
                "placeholders": placeholders,
                "node_count": len(workflow_data)
            }
        else:
            raise HTTPException(status_code=500, detail="保存工作流失败")
    
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"工作流 JSON 格式错误: {str(e)}")
    except Exception as e:
        logger.error(f"上传工作流失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/workflows/{workflow_name}")
async def delete_workflow(workflow_name: str, username: str = Depends(require_auth)):
    """删除工作流"""
    try:
        success = workflow_manager.delete_workflow(workflow_name)
        
        if success:
            return {
                "success": True,
                "message": f"工作流 {workflow_name} 删除成功"
            }
        else:
            raise HTTPException(status_code=500, detail="删除工作流失败")
    
    except Exception as e:
        logger.error(f"删除工作流失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/workflows/{workflow_name}/validate")
async def validate_workflow_params(
    workflow_name: str,
    params: Dict[str, Any],
    username: str = Depends(require_auth)
):
    """验证工作流参数"""
    try:
        valid, missing = workflow_manager.validate_params(workflow_name, params)
        
        return {
            "success": True,
            "valid": valid,
            "missing_params": missing,
            "workflow_name": workflow_name
        }
    
    except Exception as e:
        logger.error(f"验证工作流参数失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== 工作流配置 API ====================

@app.get("/api/workflow-configs")
async def get_workflow_configs(username: str = Depends(require_auth)):
    """获取所有工作流配置"""
    try:
        configs = list_workflow_configs()
        return {
            "success": True,
            "configs": configs,
            "count": len(configs),
            "available_types": list_workflow_types()
        }
    except Exception as e:
        logger.error(f"获取工作流配置失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/workflow-config/{workflow_type}")
async def get_workflow_config_detail(
    workflow_type: str,
    username: str = Depends(require_auth)
):
    """获取指定工作流的配置详情"""
    try:
        config = get_workflow_config(workflow_type)
        if not config:
            raise HTTPException(status_code=404, detail=f"未找到工作流配置: {workflow_type}")
        
        # 获取工作流详细信息
        workflow_info = workflow_manager.get_workflow_info(workflow_type)
        
        return {
            "success": True,
            "workflow_type": workflow_type,
            "config": config.to_dict(),
            "workflow_info": workflow_info
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取工作流配置详情失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== ComfyUI 图片获取 API ====================

@app.get("/api/comfyui/images/{prompt_id}")
async def get_comfyui_images(
    prompt_id: str,
    process: bool = True,
    username: str = Depends(require_auth)
):
    if not _task_for_prompt(prompt_id, username):
        raise HTTPException(status_code=404, detail="Task not found")
    """
    获取 ComfyUI 生成的图片列表
    
    Args:
        prompt_id: ComfyUI 任务 ID
        process: 是否处理图片（压缩、去EXIF等），默认 True
    """
    try:
        logger.info(f"API请求：获取 prompt_id {prompt_id} 的生成图片（process={process}）")
        images = image_processor.get_images_from_comfyui(prompt_id, process=process)
        
        if not images:
            # 尝试检查任务状态
            try:
                history_response = requests.get(
                    f"{ComfyUIConfig.COMFYUI_BASE_URL}/history/{prompt_id}",
                    timeout=5
                )
                if history_response.ok:
                    history_data = history_response.json()
                    if prompt_id in history_data:
                        task_data = history_data[prompt_id]
                        status = task_data.get('status', {})
                        if not status.get('completed', False):
                            raise HTTPException(
                                status_code=202,
                                detail=f"任务 {prompt_id} 仍在处理中"
                            )
                        else:
                            raise HTTPException(
                                status_code=404,
                                detail="任务已完成但未找到生成图片，可能是工作流配置问题"
                            )
                    else:
                        raise HTTPException(
                            status_code=404,
                            detail=f"未找到任务 {prompt_id}"
                        )
                else:
                    raise HTTPException(
                        status_code=503,
                        detail="无法连接到处理节点"
                    )
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"检查任务状态失败: {e}")
                raise HTTPException(
                    status_code=404,
                    detail=f"未找到 prompt_id {prompt_id} 的图片"
                )
        
        return {
            "prompt_id": prompt_id,
            "images": images,
            "count": len(images),
            "processed": process,
            "format": "JPG" if process else "原始格式",
            "info": "图片已处理（去EXIF、转JPG、压缩）" if process else "原始图片"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取 ComfyUI 图片失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取图片失败: {str(e)}")

@app.get("/api/comfyui/view")
async def proxy_comfyui_view(
    filename: str,
    subfolder: str = "",
    type: str = "output",
    username: str = Depends(require_auth),
):
    """代理 ComfyUI 的 /view 端点，用于获取原始图片"""
    try:
        if not _owns_artifact(filename, username):
            raise HTTPException(status_code=404, detail="File not found")
        # 构建 ComfyUI 的 view URL
        params = {
            "filename": filename,
            "type": type
        }
        if subfolder:
            params["subfolder"] = subfolder
        
        url = f"{ComfyUIConfig.COMFYUI_BASE_URL}/view"
        
        # 转发请求到 ComfyUI
        response = requests.get(url, params=params, timeout=30)
        
        if not response.ok:
            raise HTTPException(
                status_code=response.status_code,
                detail="从处理节点获取图片失败"
            )
        
        # 返回图片
        return StreamingResponse(
            BytesIO(response.content),
            media_type=response.headers.get('content-type', 'image/png'),
            headers={
                "Content-Disposition": f"inline; filename={filename}",
                "Cache-Control": "public, max-age=3600"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"代理 ComfyUI view 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/comfyui/upload")
async def comfyui_upload_proxy(
    image: UploadFile = File(...),
    comfyui_server: Optional[str] = None,
    username: str = Depends(require_auth)
):
    """
    代理 ComfyUI 图片上传接口（直接上传文件流，不使用 Base64）
    
    Args:
        image: 上传的图片文件
        comfyui_server: 指定的 ComfyUI 服务器地址（用于集群环境）
        username: 当前用户
    
    Returns:
        ComfyUI 返回的上传结果，包含上传后的文件名
    """
    try:
        # 读取上传的文件
        file_content = await image.read()
        
        logger.info(f"用户 {username} 上传图片: {image.filename}, 大小: {len(file_content)} 字节")
        
        # 确定目标 ComfyUI 服务器
        target_server = _require_configured_comfyui_server(comfyui_server)
        
        # 准备转发到 ComfyUI 的请求
        files = {
            'image': (image.filename, file_content, image.content_type or 'image/png')
        }
        
        data = {
            'overwrite': 'true'
        }
        
        # 转发请求到 ComfyUI 服务器
        upload_url = f"{target_server}/upload/image"
        logger.info(f"转发上传请求到: {upload_url}")
        
        response = requests.post(
            upload_url,
            files=files,
            data=data,
            timeout=30
        )
        
        if not response.ok:
            raise HTTPException(
                status_code=response.status_code,
                detail="处理节点上传失败"
            )
        
        result = response.json()
        uploaded_filename = result.get('name', image.filename)
        upload_owners[uploaded_filename] = username
        
        logger.info(f"ComfyUI 图片上传成功，文件名: {uploaded_filename}, 服务器: {target_server}")
        
        return {
            "success": True,
            "filename": uploaded_filename,
            "original_filename": image.filename,
            "size": len(file_content),
            "server": target_server,
            "comfyui_response": result
        }
        
    except requests.exceptions.RequestException as e:
        logger.error(f"ComfyUI 上传请求失败: {e}")
        raise HTTPException(status_code=503, detail="无法连接到处理节点")
    
    except HTTPException:
        raise
    
    except Exception as e:
        logger.error(f"ComfyUI 上传代理失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"上传代理失败: {str(e)}")

# ==================== 静态文件路由（必须放在最后） ====================

@app.get("/{filename}")
async def serve_image_files(filename: str):
    """提供图片文件（PNG、JPG等）- 此路由必须放在最后"""
    import os
    
    # 排除 API 路径
    if filename.startswith('api'):
        raise HTTPException(status_code=404, detail="Not Found")
    
    # 只处理图片文件
    if not any(filename.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']):
        raise HTTPException(status_code=404, detail="不支持的文件类型")
    
    # 尝试多个可能的路径
    possible_paths = [str(_safe_child(static_dir, filename))]
    
    for path in possible_paths:
        if os.path.exists(path):
            logger.info(f"✅ 找到图片: {path}")
            # 根据文件扩展名设置正确的 media_type
            ext = filename.lower().split('.')[-1]
            if ext == 'jpg':
                media_type = "image/jpeg"
            elif ext == 'svg':
                media_type = "image/svg+xml"
            else:
                media_type = f"image/{ext}"
            return FileResponse(path, media_type=media_type)
    
    # 如果都找不到，返回 404
    logger.warning(f"❌ 图片未找到: {filename} (尝试了路径: {possible_paths})")
    raise HTTPException(status_code=404, detail=f"图片未找到: {filename}")

# ==================== 主程序入口 ====================

if __name__ == "__main__":
    import uvicorn
    
    # 创建默认工作流
    logger.info("正在初始化默认工作流...")
    create_default_workflows()
    
    logger.info(f"启动 {SystemConfig.FRONTEND_CONFIG['title']} v{SystemConfig.FRONTEND_CONFIG['version']}")
    logger.info(f"ComfyUI 地址: {ComfyUIConfig.COMFYUI_BASE_URL}")
    logger.info(f"已加载工作流: {len(workflow_manager.workflows)} 个")
    
    uvicorn.run(app, host=SystemConfig.HOST, port=SystemConfig.PORT, log_level=SystemConfig.LOG_LEVEL.lower())
