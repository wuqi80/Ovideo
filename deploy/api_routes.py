# -*- coding: utf-8 -*-
"""
新增API路由 - 用户管理、项目、版本、文件
这个文件应该被导入到cluster_main.py中
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import os
import uuid
import json
import logging
from pathlib import Path
from datetime import datetime

from dao_user import UserDAO
from dao_content import ProjectDAO, VersionDAO, FileDAO, TextContentDAO, ProjectMemberDAO
from dao_task import TaskDAO, ActivityLogDAO
from dao_canvas import CanvasBoardDAO, CanvasNodeDAO, CanvasConnectionDAO
from dao_asset import AssetDAO
from dao_storyboard import StoryboardDAO
from dao_episode_script import EpisodeScriptDAO
from dao_episode_script_segment import EpisodeScriptSegmentDAO
from dao_video_segment import VideoSegmentDAO
from dao_entity_file import EntityFileDAO
from dao_timeline import TimelineDAO
from dao_audio_track import AudioTrackDAO
from dao_character_voice import CharacterVoiceDAO
from audio_provider import get_audio_provider, AUDIO_UPLOAD_DIR
from db_manager import get_db_manager

try:
    from minimax_audio import get_minimax_audio_client
except ImportError:
    get_minimax_audio_client = None
    logging.getLogger(__name__).warning("minimax_audio 模块不可用，MiniMax 音频端点将返回 501")
from file_optimization import FileOptimizationService, FileDeduplicationService

# 2026-05-25：MiniMax TTS 短文本试听 fast-path 需要在模块顶部 import
# save_generated_file_to_db，使其成为 api_routes 命名空间属性，
# 让 tests 可以 patch('api_routes.save_generated_file_to_db', ...)。
# 详见 docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md
from file_service import save_generated_file_to_db

# 2026-05-24：MiniMax TTS 改异步入队，handler 调 task_service.submit
import task_service

# 配置日志
logger = logging.getLogger(__name__)

# 创建路由
router = APIRouter()

# ============================================
# JWT 令牌认证
# ============================================
import jwt_auth

# ============================================
# 数据模型
# ============================================

class UserRegister(BaseModel):
    username: str
    password: str
    email: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str

class ProjectCreate(BaseModel):
    project_name: str
    description: Optional[str] = ""
    visibility: Optional[str] = "private"

class VersionCreate(BaseModel):
    project_id: str
    version_name: Optional[str] = ""
    description: Optional[str] = ""

class TextContentCreate(BaseModel):
    version_id: str
    content_type: str
    title: Optional[str] = ""
    content: str

class MemberAdd(BaseModel):
    user_id: str
    role: Optional[str] = 'member'
    responsibility: Optional[str] = 'all'

class MemberUpdate(BaseModel):
    role: Optional[str] = None
    responsibility: Optional[str] = None

class ProjectUpdate(BaseModel):
    project_name: Optional[str] = None
    description: Optional[str] = None
    cover_url: Optional[str] = None
    tags: Optional[List[str]] = None

class ExportScriptRequest(BaseModel):
    project_id: str
    original_content: str = ""
    script_content: str = ""
    storyboard_items: List[dict] = []
    characters: List[dict] = []
    scenes: List[dict] = []
    script_id: Optional[str] = None

class CanvasBoardCreate(BaseModel):
    project_id: str
    name: Optional[str] = "未命名画布"
    description: Optional[str] = ""

class CanvasNodeCreate(BaseModel):
    board_id: str
    node_type: str
    x: Optional[float] = 0
    y: Optional[float] = 0
    width: Optional[float] = 200
    height: Optional[float] = 150
    data: Optional[dict] = None

class CanvasConnectionCreate(BaseModel):
    board_id: str
    source_node_id: str
    target_node_id: str
    source_port: Optional[str] = None
    target_port: Optional[str] = None
    label: Optional[str] = None

class EntityFileLinkRequest(BaseModel):
    file_id: str
    entity_type: str
    entity_id: str
    file_role: str
    is_selected: bool = False

class EntityFileSelectRequest(BaseModel):
    entity_type: str
    entity_id: str
    file_role: str

# ============================================
# 依赖项 - 获取当前用户
# ============================================

async def get_current_user(request: Request) -> str:
    """从请求的 JWT 令牌中获取当前用户ID"""
    authorization = request.headers.get("Authorization")
    if not authorization:
        raise HTTPException(status_code=401, detail="未授权")
    
    token = authorization.replace("Bearer ", "")
    username = jwt_auth.verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Token已失效或不存在，请重新登录")
    return username

# ============================================
# 调试接口（可在生产环境删除）
# ============================================

@router.get("/api/debug/auth-status")
async def debug_auth_status(request: Request):
    """调试：检查认证状态"""
    authorization = request.headers.get("Authorization")
    token = authorization.replace("Bearer ", "") if authorization else None
    username = jwt_auth.verify_token(token) if token else None
    
    return {
        "has_authorization_header": authorization is not None,
        "token_prefix": token[:20] + "..." if token else None,
        "jwt_valid": username is not None,
        "jwt_username": username,
        "auth_method": "jwt"
    }

@router.get("/api/debug/file/{file_id}")
async def debug_file_info(file_id: str):
    """调试：检查文件信息"""
    try:
        file_record = await FileDAO.get_file(file_id)
        if not file_record:
            return {"error": "文件记录不存在", "file_id": file_id}
        
        file_path = file_record['file_path']
        
        # 检查是否是绝对路径
        is_absolute = os.path.isabs(file_path)
        
        # 如果是相对路径，转换为绝对路径
        absolute_path = file_path
        if not is_absolute:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            absolute_path = os.path.join(base_dir, file_path)
        
        # 检查文件是否存在
        file_exists = os.path.exists(absolute_path)
        
        # 列出父目录的文件（如果存在）
        parent_dir = os.path.dirname(absolute_path)
        parent_exists = os.path.exists(parent_dir)
        parent_files = []
        if parent_exists:
            try:
                parent_files = os.listdir(parent_dir)[:10]  # 只列出前10个
            except:
                parent_files = ["无法列出"]
        
        return {
            "file_id": file_id,
            "database_path": file_path,
            "is_absolute": is_absolute,
            "absolute_path": absolute_path,
            "file_exists": file_exists,
            "parent_dir": parent_dir,
            "parent_exists": parent_exists,
            "parent_files": parent_files,
            "cwd": os.getcwd(),
            "script_location": os.path.abspath(__file__)
        }
    except Exception as e:
        return {"error": str(e), "file_id": file_id}

# ============================================
# 用户相关API
# ============================================

@router.post("/api/auth/register")
async def register_user(user_data: UserRegister):
    """用户注册"""
    try:
        # 检查用户名是否存在
        existing_user = await UserDAO.get_user_by_username(user_data.username)
        if existing_user:
            raise HTTPException(status_code=400, detail="用户名已存在")
        
        # 创建用户
        user = await UserDAO.create_user(
            username=user_data.username,
            password=user_data.password,
            email=user_data.email
        )
        
        return {
            "success": True,
            "user_id": user['user_id'],
            "username": user['username']
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/auth/login")
async def login_user(login_data: UserLogin):
    """用户登录"""
    try:
        user = await UserDAO.verify_password(
            login_data.username,
            login_data.password
        )
        
        if not user:
            raise HTTPException(status_code=401, detail="用户名或密码错误")

        # 2026-05-26 Slice 4: 管理员禁用的账号不允许登录
        # 详见 docs/superpowers/plans/2026-05-26-feature-rollout/04-admin-users-project-groups.md
        user_status = user.get('status') if isinstance(user, dict) else None
        if user_status and user_status != 'active':
            reason = (user.get('disabled_reason') if isinstance(user, dict) else None) or '账户已被管理员禁用'
            raise HTTPException(status_code=403, detail=f"账户已被禁用：{reason}")

        # 记录登录日志
        await ActivityLogDAO.log_activity(
            user_id=user['user_id'],
            action='login'
        )
        
        return {
            "success": True,
            "user_id": user['user_id'],
            "username": user['username'],
            "token": user['user_id']  # 简化版,生产环境应使用JWT
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/user/profile")
async def get_user_profile(user_id: str = Depends(get_current_user)):
    """获取用户资料"""
    try:
        user = await UserDAO.get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        
        # 获取存储统计
        storage_stats = await UserDAO.get_storage_stats(user_id)
        
        return {
            "success": True,
            "user": user,
            "storage_stats": storage_stats
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 项目管理API
# ============================================

@router.post("/api/projects")
async def create_project(
    project_data: ProjectCreate,
    user_id: str = Depends(get_current_user)
):
    """创建新项目"""
    try:
        project = await ProjectDAO.create_project(
            user_id=user_id,
            project_name=project_data.project_name,
            description=project_data.description,
            visibility=project_data.visibility or 'private',
        )
        
        # 创建初始版本
        version = await VersionDAO.create_version(
            project_id=project['project_id'],
            user_id=user_id,
            version_name="初始版本",
            description="项目创建时的初始版本"
        )
        
        # 添加创建者为项目 owner
        await ProjectMemberDAO.add_member(
            project_id=project['project_id'],
            user_id=user_id,
            role='owner'
        )
        
        # 记录活动
        await ActivityLogDAO.log_activity(
            user_id=user_id,
            action='create_project',
            resource_type='project',
            resource_id=project['project_id']
        )
        
        return {
            "success": True,
            "project": project,
            "initial_version": version
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/projects")
async def get_user_projects(
    include_archived: bool = False,
    org_id: Optional[str] = None,
    user_id: str = Depends(get_current_user)
):
    """获取用户可访问的所有项目。

    org_id=None：旧行为（自有 + 被邀请）
    org_id=X：组织 workspace — owner / project_members / share→org / group∈org
    2026-05-26 组织管理 MVP — Slice 3
    """
    try:
        if org_id:
            from dao_organization import OrganizationMemberDAO
            if not await OrganizationMemberDAO.is_member(org_id, user_id):
                raise HTTPException(status_code=403, detail="不是该组织成员")
            projects = await ProjectMemberDAO.get_org_accessible_projects(
                user_id, org_id, include_archived,
            )
        else:
            projects = await ProjectMemberDAO.get_user_accessible_projects(user_id, include_archived)
        return {
            "success": True,
            "projects": projects
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/projects/{project_id}")
async def get_project_detail(
    project_id: str,
    user_id: str = Depends(get_current_user)
):
    """获取项目详情"""
    try:
        project = await ProjectDAO.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")
        
        has_access = await ProjectMemberDAO.check_permission(project_id, user_id, 'readonly')
        if not has_access:
            raise HTTPException(status_code=403, detail="无权访问")
        
        await ProjectDAO.update_project_access(project_id)
        
        versions = await VersionDAO.get_project_versions(project_id)
        members = await ProjectMemberDAO.get_project_members(project_id)
        
        return {
            "success": True,
            "project": project,
            "versions": versions,
            "members": members
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 版本管理API
# ============================================

@router.post("/api/versions")
async def create_version(
    version_data: VersionCreate,
    user_id: str = Depends(get_current_user)
):
    """创建新版本"""
    try:
        # 验证项目权限
        project = await ProjectDAO.get_project(version_data.project_id)
        if not project or project['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权操作")
        
        # 获取当前版本作为父版本
        current_version = await VersionDAO.get_current_version(version_data.project_id)
        parent_version_id = current_version['version_id'] if current_version else None
        
        # 创建新版本
        version = await VersionDAO.create_version(
            project_id=version_data.project_id,
            user_id=user_id,
            version_name=version_data.version_name,
            description=version_data.description,
            parent_version_id=parent_version_id
        )
        
        # 记录活动
        await ActivityLogDAO.log_activity(
            user_id=user_id,
            action='create_version',
            resource_type='version',
            resource_id=version['version_id']
        )
        
        return {
            "success": True,
            "version": version
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/versions/{version_id}")
async def get_version_detail(
    version_id: str,
    user_id: str = Depends(get_current_user)
):
    """获取版本详情"""
    try:
        version = await VersionDAO.get_version(version_id)
        if not version:
            raise HTTPException(status_code=404, detail="版本不存在")
        
        if version['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权访问")
        
        # 获取版本的文件和文本
        files = await FileDAO.get_version_files(version_id)
        texts = await TextContentDAO.get_version_texts(version_id)
        
        return {
            "success": True,
            "version": version,
            "files": files,
            "texts": texts
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/versions/{version_id}/restore")
async def restore_version(
    version_id: str,
    user_id: str = Depends(get_current_user)
):
    """恢复到指定版本"""
    try:
        version = await VersionDAO.get_version(version_id)
        if not version or version['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权操作")
        
        # 设置为当前版本
        await VersionDAO.set_current_version(version_id)
        
        # 记录活动
        await ActivityLogDAO.log_activity(
            user_id=user_id,
            action='restore_version',
            resource_type='version',
            resource_id=version_id
        )
        
        return {
            "success": True,
            "message": "版本已恢复"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/versions/{version_id}")
async def delete_version(
    version_id: str,
    user_id: str = Depends(get_current_user)
):
    """删除版本"""
    try:
        version = await VersionDAO.get_version(version_id)
        if not version or version['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权操作")
        
        if version['is_current']:
            raise HTTPException(status_code=400, detail="无法删除当前版本")
        
        # 删除版本
        await VersionDAO.delete_version(version_id)
        
        # 记录活动
        await ActivityLogDAO.log_activity(
            user_id=user_id,
            action='delete_version',
            resource_type='version',
            resource_id=version_id
        )
        
        return {
            "success": True,
            "message": "版本已删除"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 文件管理API
# ============================================

@router.post("/api/files/upload")
async def upload_file(
    version_id: str = Form(...),
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user)
):
    """上传文件"""
    try:
        # 验证版本权限
        version = await VersionDAO.get_version(version_id)
        if not version or version['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权操作")
        
        # 检查存储配额
        user = await UserDAO.get_user_by_id(user_id)
        if user['used_storage_bytes'] >= user['storage_quota_gb'] * 1024 * 1024 * 1024:
            raise HTTPException(status_code=507, detail="存储空间不足")
        
        # 保存文件
        file_id = f"file_{uuid.uuid4().hex[:12]}"
        file_ext = Path(file.filename).suffix
        file_type = 'image' if file_ext.lower() in ['.jpg', '.jpeg', '.png', '.gif', '.webp'] else \
                   'video' if file_ext.lower() in ['.mp4', '.avi', '.mov', '.mkv'] else 'other'
        
        # 创建存储路径
        storage_base = Path("persistent_storage") / file_type + 's' / user_id / datetime.now().strftime("%Y%m")
        storage_base.mkdir(parents=True, exist_ok=True)
        
        file_path = storage_base / f"{file_id}{file_ext}"
        
        # 保存原始文件
        content = await file.read()
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(content)
        
        file_size = len(content)
        file_url = f"/storage/{file_type}s/{user_id}/{datetime.now().strftime('%Y%m')}/{file_id}{file_ext}"
        
        # 计算文件哈希(用于去重)
        file_hash = await FileOptimizationService.calculate_file_hash(str(file_path))
        
        # 检查是否重复
        duplicate = await FileDeduplicationService.check_duplicate(file_hash, user_id)
        if duplicate:
            # 链接已存在的文件
            file_record = await FileDeduplicationService.link_duplicate_file(
                duplicate, version_id, user_id
            )
        else:
            # 创建新文件记录
            file_record = await FileDAO.create_file(
                version_id=version_id,
                user_id=user_id,
                file_type=file_type,
                file_name=file.filename,
                file_path=str(file_path),
                file_url=file_url,
                file_size_bytes=file_size,
                mime_type=file.content_type,
                metadata={'file_hash': file_hash}
            )
            
            # 如果是图片,创建缩略图
            if file_type == 'image':
                thumbnail_path = storage_base / f"{file_id}_thumb.jpg"
                await FileOptimizationService.create_thumbnail(
                    str(file_path), str(thumbnail_path)
                )
        
        # 记录活动
        await ActivityLogDAO.log_activity(
            user_id=user_id,
            action='upload_file',
            resource_type='file',
            resource_id=file_record['file_id']
        )
        
        return {
            "success": True,
            "file": file_record
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/files/{file_id}/download")
async def download_file(file_id: str, request: Request, token: str = None):
    """下载文件(使用分块传输)
    
    ⚡ 可选认证的文件下载
    安全性说明：
    - file_id 是随机生成的12位十六进制字符串 (68万亿种可能)，几乎不可能被猜到
    - 只有登录用户才能访问项目API获取 file_id
    - 这样设计使得 <img> 标签可以直接使用 URL，无需处理认证
    - 类似于 AWS S3 的预签名 URL 机制
    
    🔒 可选增强安全性：
    - 如果 URL 中包含 token 参数，将验证用户是否有权访问该文件
    - 这提供了更严格的访问控制，同时保持向后兼容
    """
    try:
        logger.info(f"📥 文件下载请求: file_id={file_id}, has_token={token is not None}")
        
        file_record = await FileDAO.get_file(file_id)
        if not file_record:
            logger.error(f"❌ 文件记录不存在: file_id={file_id}")
            raise HTTPException(status_code=404, detail="文件不存在")
        
        # 🔒 可选的用户权限验证（如果提供了 token）
        if token:
            username = jwt_auth.verify_token(token)
            if username:
                file_owner = file_record.get('user_id')
                if username and file_owner and username != file_owner:
                    logger.warning(f"⚠️ 用户 {username} 尝试访问 {file_owner} 的文件 {file_id}")
                    # 仅记录警告，不阻止访问（保持向后兼容）
                    # 如需严格控制，可取消下面注释：
                    # raise HTTPException(status_code=403, detail="无权访问此文件")
        
        logger.info(f"📄 找到文件: user={file_record['user_id']}, path={file_record['file_path']}")
        
        file_path = file_record['file_path']
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        # 尝试多个可能的路径
        possible_paths = []
        
        # 1. 原始路径（绝对路径）
        if os.path.isabs(file_path):
            possible_paths.append(file_path)
        else:
            # 2. 相对于项目根目录
            possible_paths.append(os.path.join(base_dir, file_path))
            
            # 3. 尝试 temp/uploads/ 路径（如果原路径包含 persistent_storage）
            if 'persistent_storage' in file_path:
                # persistent_storage/images/user/202512/xxx.png -> temp/uploads/images/user/202512/xxx.png
                temp_path = file_path.replace('persistent_storage/', 'temp/uploads/')
                possible_paths.append(os.path.join(base_dir, temp_path))
                
                # persistent_storage/videos/user/202512/xxx.mp4 -> temp/uploads/video/user/202512/xxx.mp4
                temp_path2 = file_path.replace('persistent_storage/videos/', 'temp/uploads/video/')
                possible_paths.append(os.path.join(base_dir, temp_path2))
                
                temp_path3 = file_path.replace('persistent_storage/images/', 'temp/uploads/images/')
                possible_paths.append(os.path.join(base_dir, temp_path3))
        
        # 查找存在的文件
        actual_file_path = None
        for path in possible_paths:
            if os.path.exists(path):
                actual_file_path = path
                logger.info(f"✅ 找到文件: {path}")
                break
            else:
                logger.debug(f"❌ 路径不存在: {path}")
        
        if not actual_file_path:
            logger.error(f"文件不存在于磁盘，尝试的路径:")
            for path in possible_paths:
                logger.error(f"  - {path}")
            logger.error(f"当前工作目录: {os.getcwd()}")
            logger.error(f"api_routes.py 位置: {os.path.abspath(__file__)}")
            raise HTTPException(status_code=404, detail="文件不存在")
        
        logger.info(f"✅ 开始传输文件: {actual_file_path}")
        
        # 处理文件名编码（支持中文）
        from urllib.parse import quote
        import aiofiles
        filename = file_record.get('file_name', 'download')
        encoded_filename = quote(filename)
        mime_type = file_record['mime_type'] or 'application/octet-stream'
        file_size = os.path.getsize(actual_file_path)
        
        # Range请求支持（视频seek必须）
        range_header = request.headers.get('range')
        
        if range_header and ('video' in mime_type or 'audio' in mime_type):
            range_spec = range_header.replace('bytes=', '')
            parts = range_spec.split('-')
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if parts[1] else file_size - 1
            end = min(end, file_size - 1)
            content_length = end - start + 1
            
            async def ranged_reader():
                async with aiofiles.open(actual_file_path, 'rb') as f:
                    await f.seek(start)
                    remaining = content_length
                    while remaining > 0:
                        chunk_size = min(65536, remaining)
                        chunk = await f.read(chunk_size)
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk
            
            return StreamingResponse(
                ranged_reader(),
                status_code=206,
                media_type=mime_type,
                headers={
                    'Content-Range': f'bytes {start}-{end}/{file_size}',
                    'Accept-Ranges': 'bytes',
                    'Content-Length': str(content_length),
                    'Content-Disposition': f"inline; filename*=UTF-8''{encoded_filename}",
                }
            )
        
        return StreamingResponse(
            FileOptimizationService.file_chunked_reader(actual_file_path),
            media_type=mime_type,
            headers={
                'Content-Disposition': f"inline; filename*=UTF-8''{encoded_filename}",
                'Accept-Ranges': 'bytes',
                'Content-Length': str(file_size),
            }
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"下载文件失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/files/{file_id}")
async def delete_file(
    file_id: str,
    user_id: str = Depends(get_current_user)
):
    """删除文件"""
    try:
        file_record = await FileDAO.get_file(file_id)
        if not file_record or file_record['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权操作")
        
        # 软删除
        await FileDAO.delete_file(file_id)
        
        # 记录活动
        await ActivityLogDAO.log_activity(
            user_id=user_id,
            action='delete_file',
            resource_type='file',
            resource_id=file_id
        )
        
        return {
            "success": True,
            "message": "文件已删除"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 文本内容API
# ============================================

@router.post("/api/texts")
async def create_text(
    text_data: TextContentCreate,
    user_id: str = Depends(get_current_user)
):
    """创建文本内容"""
    try:
        # 验证版本权限
        version = await VersionDAO.get_version(text_data.version_id)
        if not version or version['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权操作")
        
        # 创建文本
        text = await TextContentDAO.create_text_content(
            version_id=text_data.version_id,
            user_id=user_id,
            content_type=text_data.content_type,
            content=text_data.content,
            title=text_data.title
        )
        
        # 记录活动
        await ActivityLogDAO.log_activity(
            user_id=user_id,
            action='create_text',
            resource_type='text',
            resource_id=text['content_id']
        )
        
        return {
            "success": True,
            "text": text
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/texts/{content_id}")
async def get_text(
    content_id: str,
    user_id: str = Depends(get_current_user)
):
    """获取文本内容"""
    try:
        text = await TextContentDAO.get_text_content(content_id)
        if not text:
            raise HTTPException(status_code=404, detail="文本不存在")
        
        if text['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权访问")
        
        return {
            "success": True,
            "text": text
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 任务管理API
# ============================================

@router.get("/api/tasks/recent")
async def get_recent_tasks(
    hours: int = 24,
    user_id: str = Depends(get_current_user)
):
    """获取最近完成的任务(用于恢复丢失的任务)"""
    try:
        tasks = await TaskDAO.get_recent_completed_tasks(user_id, hours)
        return {
            "success": True,
            "tasks": tasks
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/tasks/{task_id}/files")
async def get_task_files(
    task_id: str,
    user_id: str = Depends(get_current_user)
):
    """获取任务相关的文件"""
    try:
        task = await TaskDAO.get_task(task_id)
        if not task or task['user_id'] != user_id:
            raise HTTPException(status_code=403, detail="无权访问")
        
        files = await TaskDAO.get_task_files(task_id)
        return {
            "success": True,
            "files": files
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 项目更新 API
# ============================================

@router.put("/api/projects/{project_id}")
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    user_id: str = Depends(get_current_user)
):
    """更新项目信息（名称/描述/封面/标签）"""
    try:
        has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
        if not has_perm:
            raise HTTPException(status_code=403, detail="需要管理员权限")
        
        from db_manager import get_db_manager as _get_db
        db = _get_db()
        sets, vals = [], []
        idx = 1
        if data.project_name is not None:
            sets.append(f"project_name = ${idx}")
            vals.append(data.project_name)
            idx += 1
        if data.description is not None:
            sets.append(f"description = ${idx}")
            vals.append(data.description)
            idx += 1
        if data.cover_url is not None:
            sets.append(f"cover_url = ${idx}")
            vals.append(data.cover_url)
            idx += 1
        if data.tags is not None:
            import json as _json
            sets.append(f"tags = ${idx}::jsonb")
            vals.append(_json.dumps(data.tags, ensure_ascii=False))
            idx += 1
        
        if sets:
            vals.append(project_id)
            query = f"UPDATE projects SET {', '.join(sets)} WHERE project_id = ${idx}"
            await db.execute(query, *vals)
        
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/projects/{project_id}/archive")
async def archive_project(
    project_id: str,
    user_id: str = Depends(get_current_user)
):
    try:
        has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
        if not has_perm:
            raise HTTPException(status_code=403, detail="需要管理员权限")
        from dao_content import ProjectDAO
        await ProjectDAO.archive_project(project_id, user_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/projects/{project_id}/unarchive")
async def unarchive_project(
    project_id: str,
    user_id: str = Depends(get_current_user)
):
    try:
        has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
        if not has_perm:
            raise HTTPException(status_code=403, detail="需要管理员权限")
        from dao_content import ProjectDAO
        await ProjectDAO.unarchive_project(project_id, user_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 项目成员管理 API (Step 7)
# ============================================

@router.get("/api/projects/{project_id}/members")
async def get_members(
    project_id: str,
    user_id: str = Depends(get_current_user)
):
    """获取项目成员列表"""
    try:
        has_access = await ProjectMemberDAO.check_permission(project_id, user_id, 'readonly')
        if not has_access:
            raise HTTPException(status_code=403, detail="无权访问")
        members = await ProjectMemberDAO.get_project_members(project_id)
        return {"success": True, "members": members}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/projects/{project_id}/members")
async def add_member(
    project_id: str,
    data: MemberAdd,
    user_id: str = Depends(get_current_user)
):
    """添加项目成员"""
    try:
        has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
        if not has_perm:
            raise HTTPException(status_code=403, detail="需要管理员权限")
        
        target_user = await UserDAO.get_user_by_id(data.user_id)
        if not target_user:
            raise HTTPException(status_code=404, detail="用户不存在")
        
        member = await ProjectMemberDAO.add_member(
            project_id, data.user_id, data.role, data.responsibility
        )
        return {"success": True, "member": member}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/projects/{project_id}/members/{member_user_id}")
async def update_member(
    project_id: str,
    member_user_id: str,
    data: MemberUpdate,
    user_id: str = Depends(get_current_user)
):
    """更新成员角色/职责"""
    try:
        has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
        if not has_perm:
            raise HTTPException(status_code=403, detail="需要管理员权限")
        
        if data.role:
            await ProjectMemberDAO.update_member_role(project_id, member_user_id, data.role)
        if data.responsibility:
            await ProjectMemberDAO.update_member_responsibility(project_id, member_user_id, data.responsibility)
        
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/projects/{project_id}/members/{member_user_id}")
async def remove_member(
    project_id: str,
    member_user_id: str,
    user_id: str = Depends(get_current_user)
):
    """移除项目成员"""
    try:
        has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
        if not has_perm:
            raise HTTPException(status_code=403, detail="需要管理员权限")
        
        member = await ProjectMemberDAO.get_member(project_id, member_user_id)
        if member and member['role'] == 'owner':
            raise HTTPException(status_code=400, detail="不能移除项目拥有者")
        
        await ProjectMemberDAO.remove_member(project_id, member_user_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 全局任务状态 API (Step 8)
# ============================================

@router.get("/api/tasks/active")
async def get_active_tasks(
    user_id: str = Depends(get_current_user)
):
    """获取用户所有活跃任务（running + queued）"""
    try:
        from db_manager import get_db_manager as _get_db
        db = _get_db()
        query = """
            SELECT task_id, task_type, status, project_id, category,
                   source_page, source_item_id, display_name,
                   created_at, started_at, completed_at, metadata
            FROM tasks
            WHERE user_id = $1 AND status IN ('pending', 'processing', 'queued')
            ORDER BY created_at DESC
            LIMIT 50
        """
        tasks = await db.fetch(query, user_id)
        return {"success": True, "tasks": tasks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/tasks/notifications")
async def get_task_notifications(
    since: Optional[int] = None,
    user_id: str = Depends(get_current_user)
):
    """获取最近完成/失败的任务通知"""
    try:
        from db_manager import get_db_manager as _get_db
        db = _get_db()
        
        if since:
            from datetime import datetime as _dt, timezone as _tz
            # tasks.completed_at 列是 TIMESTAMP（naive，存 UTC），asyncpg 不允许把
            # tz-aware datetime 与 naive 列做比较，会抛 "can't subtract offset-naive
            # and offset-aware datetimes"。先按 UTC 解析时间戳，再剥 tzinfo。
            since_dt = _dt.fromtimestamp(since / 1000, tz=_tz.utc).replace(tzinfo=None)
            query = """
                SELECT task_id, task_type, status, project_id, category,
                       source_page, source_item_id, display_name,
                       created_at, completed_at, result_data, task_data
                FROM tasks
                WHERE user_id = $1 AND status IN ('completed', 'failed')
                  AND completed_at > $2
                ORDER BY completed_at DESC
                LIMIT 20
            """
            tasks = await db.fetch(query, user_id, since_dt)
        else:
            query = """
                SELECT task_id, task_type, status, project_id, category,
                       source_page, source_item_id, display_name,
                       created_at, completed_at, result_data, task_data
                FROM tasks
                WHERE user_id = $1 AND status IN ('completed', 'failed')
                ORDER BY completed_at DESC
                LIMIT 20
            """
            tasks = await db.fetch(query, user_id)
        
        notifications = []
        for t in tasks:
            row = dict(t)
            td = row.pop("task_data", None) or {}
            if isinstance(td, str):
                import json as _json
                try:
                    td = _json.loads(td)
                except Exception:
                    td = {}
            row["entity_type"] = td.get("entity_type", "")
            row["entity_id"] = td.get("entity_id", "")
            row["file_role"] = td.get("file_role", "")
            row["episode_id"] = td.get("episode_id", "")
            notifications.append(row)
        
        return {"success": True, "notifications": notifications}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 持久化通知 API
# ============================================

@router.get("/api/notifications/unread-count")
async def get_unread_notification_count(user_id: str = Depends(get_current_user)):
    try:
        from dao_notification import NotificationDAO
        count = await NotificationDAO.get_unread_count(user_id)
        return {"success": True, "count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/notifications")
async def get_notifications(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user_id: str = Depends(get_current_user)
):
    try:
        from dao_notification import NotificationDAO
        if status == 'unread':
            items = await NotificationDAO.get_unread(user_id, limit=limit)
        else:
            items = await NotificationDAO.get_history(user_id, limit=limit, offset=offset)
        return {"success": True, "notifications": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user_id: str = Depends(get_current_user)):
    try:
        from dao_notification import NotificationDAO
        await NotificationDAO.mark_read(notification_id, user_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/notifications/read-all")
async def mark_all_notifications_read(user_id: str = Depends(get_current_user)):
    try:
        from dao_notification import NotificationDAO
        count = await NotificationDAO.mark_all_read(user_id)
        return {"success": True, "count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/notifications/{notification_id}")
async def dismiss_notification(notification_id: str, user_id: str = Depends(get_current_user)):
    try:
        from dao_notification import NotificationDAO
        await NotificationDAO.dismiss(notification_id, user_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 集数管理 API
# ============================================

class EpisodeCreate(BaseModel):
    episode_name: str = ''
    description: str = ''

class EpisodeUpdate(BaseModel):
    episode_name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    settings: Optional[dict] = None
    sort_order: Optional[int] = None

class EpisodeReorder(BaseModel):
    episode_ids: List[str]

@router.get("/api/projects/{project_id}/episodes")
async def list_episodes(project_id: str, user_id: str = Depends(get_current_user)):
    try:
        from dao_episode import EpisodeDAO
        episodes = await EpisodeDAO.get_episodes(project_id)
        return {"success": True, "episodes": episodes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/projects/{project_id}/episodes")
async def create_episode(project_id: str, data: EpisodeCreate, user_id: str = Depends(get_current_user)):
    try:
        from dao_episode import EpisodeDAO
        ep_num = await EpisodeDAO.get_next_episode_number(project_id)
        episode = await EpisodeDAO.create_episode(
            project_id=project_id,
            episode_number=ep_num,
            episode_name=data.episode_name or f'第{ep_num}集',
            description=data.description
        )
        return {"success": True, "episode": episode}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/episodes/{episode_id}")
async def get_episode(episode_id: str, user_id: str = Depends(get_current_user)):
    try:
        from dao_episode import EpisodeDAO
        episode = await EpisodeDAO.get_episode(episode_id)
        if not episode:
            raise HTTPException(status_code=404, detail="集数不存在")
        return {"success": True, "episode": episode}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/episodes/{episode_id}")
async def update_episode(episode_id: str, data: EpisodeUpdate, user_id: str = Depends(get_current_user)):
    try:
        from dao_episode import EpisodeDAO
        await EpisodeDAO.update_episode(
            episode_id=episode_id,
            episode_name=data.episode_name,
            description=data.description,
            status=data.status,
            settings=data.settings,
            sort_order=data.sort_order
        )
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/episodes/{episode_id}")
async def delete_episode(episode_id: str, user_id: str = Depends(get_current_user)):
    try:
        from dao_episode import EpisodeDAO
        await EpisodeDAO.delete_episode(episode_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/projects/{project_id}/episodes/reorder")
async def reorder_episodes(project_id: str, data: EpisodeReorder, user_id: str = Depends(get_current_user)):
    try:
        from dao_episode import EpisodeDAO
        await EpisodeDAO.reorder_episodes(project_id, data.episode_ids)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# 画布 CRUD API (Step 9)
# ============================================

@router.post("/api/canvas/boards")
async def create_canvas_board(
    data: CanvasBoardCreate,
    user_id: str = Depends(get_current_user)
):
    """创建画布面板"""
    try:
        has_perm = await ProjectMemberDAO.check_permission(data.project_id, user_id, 'member')
        if not has_perm:
            raise HTTPException(status_code=403, detail="无权操作")
        board = await CanvasBoardDAO.create_board(data.project_id, user_id, data.name, data.description)
        return {"success": True, "board": board}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/canvas/boards")
async def get_canvas_boards(
    project_id: str,
    user_id: str = Depends(get_current_user)
):
    """获取项目的画布列表"""
    try:
        has_access = await ProjectMemberDAO.check_permission(project_id, user_id, 'readonly')
        if not has_access:
            raise HTTPException(status_code=403, detail="无权访问")
        boards = await CanvasBoardDAO.get_project_boards(project_id)
        return {"success": True, "boards": boards}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/canvas/boards/{board_id}")
async def get_canvas_board_detail(
    board_id: str,
    user_id: str = Depends(get_current_user)
):
    """获取画布详情（含节点和连接）"""
    try:
        board = await CanvasBoardDAO.get_board(board_id)
        if not board:
            raise HTTPException(status_code=404, detail="画布不存在")
        
        has_access = await ProjectMemberDAO.check_permission(board['project_id'], user_id, 'readonly')
        if not has_access:
            raise HTTPException(status_code=403, detail="无权访问")
        
        nodes = await CanvasNodeDAO.get_board_nodes(board_id)
        connections = await CanvasConnectionDAO.get_board_connections(board_id)
        
        return {
            "success": True,
            "board": board,
            "nodes": nodes,
            "connections": connections
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/canvas/boards/{board_id}")
async def update_canvas_board(
    board_id: str,
    data: dict,
    user_id: str = Depends(get_current_user)
):
    """更新画布信息"""
    try:
        board = await CanvasBoardDAO.get_board(board_id)
        if not board:
            raise HTTPException(status_code=404, detail="画布不存在")
        has_perm = await ProjectMemberDAO.check_permission(board['project_id'], user_id, 'member')
        if not has_perm:
            raise HTTPException(status_code=403, detail="无权操作")
        await CanvasBoardDAO.update_board(board_id, **data)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/canvas/boards/{board_id}")
async def delete_canvas_board(
    board_id: str,
    user_id: str = Depends(get_current_user)
):
    """删除画布"""
    try:
        board = await CanvasBoardDAO.get_board(board_id)
        if not board:
            raise HTTPException(status_code=404, detail="画布不存在")
        has_perm = await ProjectMemberDAO.check_permission(board['project_id'], user_id, 'admin')
        if not has_perm:
            raise HTTPException(status_code=403, detail="需要管理员权限")
        await CanvasBoardDAO.delete_board(board_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/canvas/nodes")
async def create_canvas_node(
    data: CanvasNodeCreate,
    user_id: str = Depends(get_current_user)
):
    """创建画布节点"""
    try:
        board = await CanvasBoardDAO.get_board(data.board_id)
        if not board:
            raise HTTPException(status_code=404, detail="画布不存在")
        has_perm = await ProjectMemberDAO.check_permission(board['project_id'], user_id, 'member')
        if not has_perm:
            raise HTTPException(status_code=403, detail="无权操作")
        node = await CanvasNodeDAO.create_node(
            data.board_id, data.node_type, data.x, data.y,
            data.width, data.height, data.data
        )
        return {"success": True, "node": node}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/canvas/nodes/{node_id}")
async def update_canvas_node(
    node_id: str,
    data: dict,
    user_id: str = Depends(get_current_user)
):
    """更新画布节点"""
    try:
        await CanvasNodeDAO.update_node(node_id, **data)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/canvas/nodes/{node_id}")
async def delete_canvas_node(
    node_id: str,
    user_id: str = Depends(get_current_user)
):
    """删除画布节点"""
    try:
        await CanvasNodeDAO.delete_node(node_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/canvas/connections")
async def create_canvas_connection(
    data: CanvasConnectionCreate,
    user_id: str = Depends(get_current_user)
):
    """创建画布连接"""
    try:
        conn = await CanvasConnectionDAO.create_connection(
            data.board_id, data.source_node_id, data.target_node_id,
            data.source_port, data.target_port, data.label
        )
        return {"success": True, "connection": conn}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/canvas/connections/{connection_id}")
async def delete_canvas_connection(
    connection_id: str,
    user_id: str = Depends(get_current_user)
):
    """删除画布连接"""
    try:
        await CanvasConnectionDAO.delete_connection(connection_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 资产 API
# ============================================

class AssetCreate(BaseModel):
    project_id: str
    asset_type: str
    name: str
    episode_id: Optional[str] = None
    script_id: Optional[str] = None
    description: Optional[str] = ''
    reference_images: Optional[list] = None

class AssetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    episode_id: Optional[str] = None
    reference_images: Optional[list] = None
    style_params: Optional[dict] = None
    tags: Optional[list] = None
    style_params: Optional[dict] = None
    tags: Optional[list] = None


@router.get("/api/projects/{project_id}/assets")
async def get_assets(
    project_id: str,
    episode_id: Optional[str] = None,
    asset_type: Optional[str] = None,
    script_id: Optional[str] = None,
    user_id: str = Depends(get_current_user)
):
    assets = await AssetDAO.get_by_project(project_id, episode_id, asset_type, script_id=script_id)
    assets_list = [dict(a) for a in assets]

    asset_ids = [a["asset_id"] for a in assets_list]
    if asset_ids:
        from dao_entity_file import EntityFileDAO
        files_map = await EntityFileDAO.get_files_for_entities("asset", asset_ids)
        for asset in assets_list:
            asset["entity_files"] = files_map.get(asset["asset_id"], [])
    else:
        for asset in assets_list:
            asset["entity_files"] = []

    return {"success": True, "assets": assets_list}


@router.post("/api/assets")
async def create_asset(data: AssetCreate, user_id: str = Depends(get_current_user)):
    asset = await AssetDAO.create(
        project_id=data.project_id, asset_type=data.asset_type,
        name=data.name, created_by=user_id,
        episode_id=data.episode_id, description=data.description or '',
        reference_images=data.reference_images,
        script_id=data.script_id,
    )
    if not asset:
        raise HTTPException(status_code=500, detail="创建资产失败")
    return {"success": True, "asset": dict(asset)}


@router.put("/api/assets/{asset_id}")
async def update_asset(asset_id: str, data: AssetUpdate, user_id: str = Depends(get_current_user)):
    asset = await AssetDAO.update(asset_id, **data.dict(exclude_none=True))
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    return {"success": True, "asset": dict(asset)}


@router.delete("/api/assets/{asset_id}")
async def delete_asset(asset_id: str, user_id: str = Depends(get_current_user)):
    ok = await AssetDAO.delete(asset_id)
    if not ok:
        raise HTTPException(status_code=404, detail="资产不存在")
    return {"success": True}


# ============================================
# 分镜 API
# ============================================

class StoryboardItemCreate(BaseModel):
    sort_order: int = 0
    scene_heading: Optional[str] = ''
    dialogue: Optional[str] = ''
    action_text: Optional[str] = ''
    camera_movement: Optional[str] = ''
    image_prompt: Optional[str] = ''
    video_prompt: Optional[str] = ''
    script_id: Optional[str] = None

class StoryboardItemUpdate(BaseModel):
    sort_order: Optional[int] = None
    scene_heading: Optional[str] = None
    dialogue: Optional[str] = None
    action_text: Optional[str] = None
    camera_movement: Optional[str] = None
    image_prompt: Optional[str] = None
    video_prompt: Optional[str] = None
    generated_image_url: Optional[str] = None
    status: Optional[str] = None
    dialogue_audio_url: Optional[str] = None
    narration_audio_url: Optional[str] = None
    sfx_audio_url: Optional[str] = None
    audio_duration_ms: Optional[int] = None
    planned_duration_ms: Optional[int] = None
    bound_assets: Optional[list] = None

class ReorderRequest(BaseModel):
    item_ids: List[str]


@router.get("/api/episodes/{episode_id}/storyboard-items")
async def get_storyboard_items(episode_id: str, script_id: Optional[str] = None, user_id: str = Depends(get_current_user)):
    items = await StoryboardDAO.get_by_episode(episode_id, script_id=script_id)
    result = []
    for i in items:
        d = dict(i)
        if isinstance(d.get("bound_assets"), str):
            try:
                d["bound_assets"] = json.loads(d["bound_assets"]) if d["bound_assets"] else []
            except Exception:
                d["bound_assets"] = []
        result.append(d)
    return {"success": True, "items": result}


@router.post("/api/episodes/{episode_id}/storyboard-items")
async def create_storyboard_item(episode_id: str, data: StoryboardItemCreate, user_id: str = Depends(get_current_user)):
    item = await StoryboardDAO.create(
        episode_id=episode_id, sort_order=data.sort_order,
        scene_heading=data.scene_heading, dialogue=data.dialogue,
        action_text=data.action_text, camera_movement=data.camera_movement,
        image_prompt=data.image_prompt, video_prompt=data.video_prompt,
        script_id=data.script_id,
    )
    if not item:
        raise HTTPException(status_code=500, detail="创建分镜失败")
    return {"success": True, "item": dict(item)}


@router.put("/api/storyboard-items/{item_id}")
async def update_storyboard_item(item_id: str, data: StoryboardItemUpdate, user_id: str = Depends(get_current_user)):
    item = await StoryboardDAO.update(item_id, **data.dict(exclude_none=True))
    if not item:
        raise HTTPException(status_code=404, detail="分镜不存在")
    return {"success": True, "item": dict(item)}


@router.delete("/api/storyboard-items/{item_id}")
async def delete_storyboard_item(item_id: str, user_id: str = Depends(get_current_user)):
    ok = await StoryboardDAO.delete(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="分镜不存在")
    return {"success": True}


@router.delete("/api/episodes/{episode_id}/storyboard-items/all")
async def delete_all_storyboard_items(episode_id: str, script_id: Optional[str] = None, user_id: str = Depends(get_current_user)):
    """一次性清空该集的所有分镜（用于重新导出）"""
    count = await StoryboardDAO.delete_by_episode(episode_id, script_id=script_id)
    return {"success": True, "deleted": count}


@router.post("/api/episodes/{episode_id}/export-script")
async def export_script(episode_id: str, req: ExportScriptRequest, user_id: str = Depends(get_current_user)):
    """原子导出：单事务写入 episode_scripts + storyboard_items + assets"""
    from db_manager import get_db_manager
    db = get_db_manager()
    if not db:
        raise HTTPException(500, "数据库不可用")

    async with db.acquire() as conn:
        async with conn.transaction():
            await EpisodeScriptDAO.upsert_transactional(
                conn, episode_id,
                original_content=req.original_content,
                adapted_script=req.script_content,
                metadata={
                    'extracted_characters': [c.get('name', '') for c in req.characters],
                    'extracted_scenes': [s.get('name', '') for s in req.scenes],
                },
            )

            if req.script_id:
                await conn.execute(
                    "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                    episode_id, req.script_id
                )
            else:
                await conn.execute(
                    "DELETE FROM storyboard_items WHERE episode_id = $1", episode_id
                )

            created = await StoryboardDAO.batch_create_transactional(
                conn, episode_id, req.storyboard_items, script_id=req.script_id
            )

            if req.script_id:
                existing_assets = await conn.fetch(
                    "SELECT asset_type, name FROM assets WHERE project_id = $1 AND episode_id = $2 AND script_id = $3",
                    req.project_id, episode_id, req.script_id
                )
            else:
                existing_assets = await conn.fetch(
                    "SELECT asset_type, name FROM assets WHERE project_id = $1 AND episode_id = $2",
                    req.project_id, episode_id
                )
            existing_names = {(r['asset_type'], r['name']) for r in existing_assets}

            for char in req.characters:
                name = char.get('name', '').strip()
                if not name or ('character', name) in existing_names:
                    continue
                await conn.execute("""
                    INSERT INTO assets (asset_id, project_id, episode_id, script_id, asset_type, name, description, created_by)
                    VALUES ($1, $2, $3, $4, 'character', $5, $6, $7)
                """,
                    f"asset_{uuid.uuid4().hex[:12]}",
                    req.project_id, episode_id, req.script_id,
                    name, char.get('description', ''), user_id,
                )
                existing_names.add(('character', name))

            for scene in req.scenes:
                name = scene.get('name', '').strip()
                if not name or ('scene', name) in existing_names:
                    continue
                await conn.execute("""
                    INSERT INTO assets (asset_id, project_id, episode_id, script_id, asset_type, name, description, created_by)
                    VALUES ($1, $2, $3, $4, 'scene', $5, $6, $7)
                """,
                    f"asset_{uuid.uuid4().hex[:12]}",
                    req.project_id, episode_id, req.script_id,
                    name, scene.get('description', ''), user_id,
                )
                existing_names.add(('scene', name))

    return {
        "success": True,
        "storyboard_items_created": created,
        "characters_count": len(req.characters),
        "scenes_count": len(req.scenes),
    }


@router.post("/api/episodes/{episode_id}/storyboard-items/reorder")
async def reorder_storyboard_items(episode_id: str, data: ReorderRequest, user_id: str = Depends(get_current_user)):
    ok = await StoryboardDAO.reorder(episode_id, data.item_ids)
    if not ok:
        raise HTTPException(status_code=500, detail="排序失败")
    return {"success": True}


# ============================================
# 分镜音频混音 API (Task 2: backend audio mix)
# ============================================

class MixAudioRequest(BaseModel):
    item_id: str
    dialogue_url: Optional[str] = None
    narration_url: Optional[str] = None
    sfx_url: Optional[str] = None
    dialogue_gain_db: float = 0.0
    narration_gain_db: float = -3.0
    sfx_gain_db: float = -8.0


class MixAudioResponse(BaseModel):
    success: bool
    mixed_audio_url: str
    cached: bool
    duration_ms: int


@router.post("/api/storyboard/mix-audio", response_model=MixAudioResponse)
async def mix_storyboard_audio_endpoint(
    body: MixAudioRequest,
    user_id: str = Depends(get_current_user),
) -> MixAudioResponse:
    """Mix dialogue / narration / sfx into one reference_audio for a storyboard item.

    Cache: hash of (urls + gains) is stored on `storyboard_items.mixed_audio_hash`;
    same hash → returns existing `mixed_audio_url` without invoking ffmpeg.
    """
    from audio_mix_service import MixInput, mix_storyboard_audio

    if not (body.dialogue_url or body.narration_url or body.sfx_url):
        raise HTTPException(status_code=400, detail="at least one of dialogue/narration/sfx url is required")

    try:
        result = await mix_storyboard_audio(
            body.item_id,
            MixInput(
                dialogue_url=body.dialogue_url,
                narration_url=body.narration_url,
                sfx_url=body.sfx_url,
                dialogue_gain_db=body.dialogue_gain_db,
                narration_gain_db=body.narration_gain_db,
                sfx_gain_db=body.sfx_gain_db,
            ),
            user_id=user_id,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        msg = str(e)
        if "ffmpeg not found" in msg:
            raise HTTPException(status_code=503, detail="ffmpeg unavailable on server")
        raise HTTPException(status_code=500, detail=msg)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return MixAudioResponse(
        success=result.success,
        mixed_audio_url=result.mixed_audio_url,
        cached=result.cached,
        duration_ms=result.duration_ms,
    )


# ============================================
# 视频片段 API
# ============================================

class VideoSegmentCreate(BaseModel):
    sort_order: int = 0
    storyboard_item_id: Optional[str] = None
    generation_mode: str = 'i2v'
    model: str = ''
    input_params: Optional[dict] = None

class VideoSegmentUpdate(BaseModel):
    sort_order: Optional[int] = None
    generation_mode: Optional[str] = None
    model: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration_ms: Optional[int] = None
    task_id: Optional[str] = None
    status: Optional[str] = None
    input_params: Optional[dict] = None


@router.get("/api/episodes/{episode_id}/video-segments")
async def get_video_segments(episode_id: str, user_id: str = Depends(get_current_user)):
    segments = await VideoSegmentDAO.get_by_episode(episode_id)
    return {"success": True, "segments": [dict(s) for s in segments]}


@router.post("/api/episodes/{episode_id}/video-segments")
async def create_video_segment(episode_id: str, data: VideoSegmentCreate, user_id: str = Depends(get_current_user)):
    seg = await VideoSegmentDAO.create(
        episode_id=episode_id, sort_order=data.sort_order,
        storyboard_item_id=data.storyboard_item_id,
        generation_mode=data.generation_mode,
        model=data.model, input_params=data.input_params
    )
    if not seg:
        raise HTTPException(status_code=500, detail="创建视频片段失败")
    return {"success": True, "segment": dict(seg)}


@router.put("/api/video-segments/{segment_id}")
async def update_video_segment(segment_id: str, data: VideoSegmentUpdate, user_id: str = Depends(get_current_user)):
    seg = await VideoSegmentDAO.update(segment_id, **data.dict(exclude_none=True))
    if not seg:
        raise HTTPException(status_code=404, detail="视频片段不存在")
    return {"success": True, "segment": dict(seg)}


@router.delete("/api/video-segments/{segment_id}")
async def delete_video_segment(segment_id: str, user_id: str = Depends(get_current_user)):
    ok = await VideoSegmentDAO.delete(segment_id)
    if not ok:
        raise HTTPException(404, "视频段不存在")
    return {"success": True}


# ============================================
# 音频轨 API
# ============================================

class AudioTrackCreate(BaseModel):
    track_type: str
    name: str = ''
    audio_url: Optional[str] = None
    duration_ms: Optional[int] = None
    start_item_id: Optional[str] = None
    end_item_id: Optional[str] = None
    generation_params: Optional[dict] = None


@router.get("/api/episodes/{episode_id}/audio-tracks")
async def get_audio_tracks(episode_id: str, user_id: str = Depends(get_current_user)):
    tracks = await AudioTrackDAO.get_by_episode(episode_id)
    return {"success": True, "tracks": [dict(t) for t in tracks]}


@router.post("/api/episodes/{episode_id}/audio-tracks")
async def create_audio_track(episode_id: str, data: AudioTrackCreate, user_id: str = Depends(get_current_user)):
    track = await AudioTrackDAO.create(
        episode_id=episode_id, track_type=data.track_type, name=data.name,
        audio_url=data.audio_url, duration_ms=data.duration_ms,
        start_item_id=data.start_item_id, end_item_id=data.end_item_id,
        generation_params=data.generation_params
    )
    if not track:
        raise HTTPException(status_code=500, detail="创建音频轨失败")
    return {"success": True, "track": dict(track)}


@router.delete("/api/audio-tracks/{track_id}")
async def delete_audio_track(track_id: str, user_id: str = Depends(get_current_user)):
    ok = await AudioTrackDAO.delete(track_id)
    if not ok:
        raise HTTPException(status_code=404, detail="音频轨不存在")
    return {"success": True}


# ============================================
# 音频生成 API
# ============================================

class SpeechGenRequest(BaseModel):
    text: str
    persona: str = 'narrator'
    emotion: str = 'neutral'
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    file_role: Optional[str] = None
    episode_id: Optional[str] = None

class SFXGenRequest(BaseModel):
    description: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    file_role: Optional[str] = None
    episode_id: Optional[str] = None

class MusicGenRequest(BaseModel):
    description: str
    duration_ms: Optional[int] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    file_role: Optional[str] = None
    episode_id: Optional[str] = None


@router.post("/api/audio/generate-speech")
async def gen_speech(data: SpeechGenRequest, user_id: str = Depends(get_current_user)):
    try:
        provider = get_audio_provider('gemini')
        result = await provider.generate_speech(data.text, persona=data.persona, emotion=data.emotion)
        try:
            from file_service import save_generated_file_to_db
            audio_url = result.get('audio_url', '')
            if audio_url:
                audio_file_path = Path(AUDIO_UPLOAD_DIR) / os.path.basename(audio_url)
                if audio_file_path.exists():
                    saved = await save_generated_file_to_db(
                        content=audio_file_path.read_bytes(),
                        file_type='audio',
                        user_id=user_id,
                        source='gemini',
                        entity_type=data.entity_type,
                        entity_id=data.entity_id,
                        file_role=data.file_role or 'dialogue_audio',
                        original_ext=audio_file_path.suffix,
                        episode_id=data.episode_id,
                    )
                    result['file_id'] = saved['file_id']
                    result['file_url'] = saved['file_url']
                    # 2026-05-26 Slice 1 收尾：同步进通用素材库
                    try:
                        import media_library_service
                        await media_library_service.create_from_file(
                            file_record=saved, source='generated_audio_gemini_speech',
                            episode_id=data.episode_id,
                            source_entity_type=data.entity_type,
                            source_entity_id=data.entity_id,
                            title=(getattr(data, 'text', '') or '')[:80] or None,
                        )
                    except Exception as _e:
                        logger.warning(f"media_library 同步失败 (gemini speech): {_e}")
        except Exception as e:
            logger.warning(f"保存音频到 files 表失败: {e}")
        return {"success": True, **result}
    except HTTPException:
        raise
    except RuntimeError as e:
        msg = str(e)
        if 'GEMINI_API_KEY' in msg or '未配置' in msg:
            raise HTTPException(status_code=503, detail=msg)
        logger.error(f"generate_speech 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=msg)
    except Exception as e:
        msg = str(e)
        if 'Missing key inputs' in msg or 'api_key' in msg:
            raise HTTPException(
                status_code=503,
                detail="GEMINI_API_KEY 未配置：请在管理员后台 → API 配置 中添加 provider=gemini-tts 的密钥后重启后端。"
            )
        logger.error(f"generate_speech 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=msg)


@router.post("/api/audio/generate-sfx")
async def gen_sfx(data: SFXGenRequest, user_id: str = Depends(get_current_user)):
    # 2026-06-10：原走 Gemini provider，但 Gemini generate_content 只有 TTS 模型
    # （朗读文本），生成不了音效。改走 MiniMax（库内唯一可用的音频生成后端）。
    try:
        _require_minimax_client()  # 缺模块/缺 key 时抛 501/503
        provider = get_audio_provider('minimax')
        result = await provider.generate_sfx(data.description)
        try:
            from file_service import save_generated_file_to_db
            audio_url = result.get('audio_url', '')
            if audio_url:
                audio_file_path = Path(AUDIO_UPLOAD_DIR) / os.path.basename(audio_url)
                if audio_file_path.exists():
                    saved = await save_generated_file_to_db(
                        content=audio_file_path.read_bytes(),
                        file_type='audio',
                        user_id=user_id,
                        source='minimax',
                        entity_type=data.entity_type,
                        entity_id=data.entity_id,
                        file_role=data.file_role or 'sfx_audio',
                        original_ext=audio_file_path.suffix,
                        episode_id=data.episode_id,
                    )
                    result['file_id'] = saved['file_id']
                    result['file_url'] = saved['file_url']
                    try:
                        import media_library_service
                        await media_library_service.create_from_file(
                            file_record=saved, source='generated_audio_minimax_sfx',
                            episode_id=data.episode_id,
                            source_entity_type=data.entity_type,
                            source_entity_id=data.entity_id,
                            title=(getattr(data, 'description', '') or '')[:80] or None,
                        )
                    except Exception as _e:
                        logger.warning(f"media_library 同步失败 (minimax sfx): {_e}")
        except Exception as e:
            logger.warning(f"保存音频到 files 表失败: {e}")
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"generate_sfx 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/audio/generate-music")
async def gen_music(data: MusicGenRequest, user_id: str = Depends(get_current_user)):
    # 2026-06-10：原走 Gemini provider，但 Gemini generate_content 只有 TTS 模型，
    # 生成不了音乐。改走 MiniMax music_generate（与 /api/minimax/music 同一后端）。
    try:
        _require_minimax_client()  # 缺模块/缺 key 时抛 501/503
        provider = get_audio_provider('minimax')
        result = await provider.generate_music(data.description, duration_ms=data.duration_ms)
        try:
            from file_service import save_generated_file_to_db
            audio_url = result.get('audio_url', '')
            if audio_url:
                audio_file_path = Path(AUDIO_UPLOAD_DIR) / os.path.basename(audio_url)
                if audio_file_path.exists():
                    saved = await save_generated_file_to_db(
                        content=audio_file_path.read_bytes(),
                        file_type='audio',
                        user_id=user_id,
                        source='minimax',
                        entity_type=data.entity_type,
                        entity_id=data.entity_id,
                        file_role=data.file_role or 'background_music',
                        original_ext=audio_file_path.suffix,
                        episode_id=data.episode_id,
                    )
                    result['file_id'] = saved['file_id']
                    result['file_url'] = saved['file_url']
                    try:
                        import media_library_service
                        await media_library_service.create_from_file(
                            file_record=saved, source='generated_audio_minimax_music',
                            episode_id=data.episode_id,
                            source_entity_type=data.entity_type,
                            source_entity_id=data.entity_id,
                            title=(getattr(data, 'description', '') or '')[:80] or None,
                        )
                    except Exception as _e:
                        logger.warning(f"media_library 同步失败 (minimax music): {_e}")
        except Exception as e:
            logger.warning(f"保存音频到 files 表失败: {e}")
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"generate_music 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# MiniMax 音频 API
# ============================================

def _require_minimax_client():
    if get_minimax_audio_client is None:
        raise HTTPException(status_code=501, detail="MiniMax 音频模块未安装，请部署 minimax_audio.py")
    client = get_minimax_audio_client()
    if not getattr(client, 'api_key', None):
        raise HTTPException(
            status_code=503,
            detail="MINIMAX_API_KEY 未配置：请在管理员后台 → API 配置 中添加 provider=minimax 的密钥，"
                   "或在后端 .env 设置 MINIMAX_API_KEY 后重启服务。"
        )
    return client

class MinimaxVoiceDesignRequest(BaseModel):
    prompt: str
    preview_text: str
    voice_id: Optional[str] = None

class MinimaxVoiceCloneRequest(BaseModel):
    file_id: str
    voice_id: Optional[str] = None
    demo_text: Optional[str] = "你好，这是一段测试语音。"
    model: str = "speech-2.8-hd"
    voice_id_prefix: str = "clone"

class MinimaxTTSRequest(BaseModel):
    text: str
    voice_id: str
    model: str = "speech-2.8-hd"
    speed: float = 1.0
    pitch: int = 0
    emotion: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    file_role: Optional[str] = None
    episode_id: Optional[str] = None
    # 2026-05-24 新增：试听场景透传，worker 完成后回写 character_voices.sample_audio_url，
    # 让用户下次打开 VoiceSidebar 直接复用同一段试听，避免重复付费。
    bind_to_character_voice_id: Optional[str] = None

class MinimaxMusicRequest(BaseModel):
    lyrics: str = ""
    refer_voice: str = ""
    refer_instrumental: str = ""
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    file_role: Optional[str] = None
    episode_id: Optional[str] = None

class MinimaxLyricsRequest(BaseModel):
    text: str
    language: str = "zh"


@router.post("/api/minimax/voice-design")
async def minimax_voice_design(data: MinimaxVoiceDesignRequest, user_id: str = Depends(get_current_user)):
    try:
        client = _require_minimax_client()
        result = await client.voice_design(
            prompt=data.prompt,
            preview_text=data.preview_text,
            voice_id=data.voice_id,
        )
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"MiniMax voice_design 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/minimax/voice-clone")
async def minimax_voice_clone(data: MinimaxVoiceCloneRequest, user_id: str = Depends(get_current_user)):
    try:
        client = _require_minimax_client()
        result = await client.voice_clone(
            file_id=data.file_id,
            voice_id=data.voice_id,
            demo_text=data.demo_text,
            model=data.model,
            voice_id_prefix=data.voice_id_prefix,
        )
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"MiniMax voice_clone 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/minimax/voices")
async def minimax_list_voices(voice_type: str = "all", user_id: str = Depends(get_current_user)):
    try:
        client = _require_minimax_client()
        result = await client.list_voices(voice_type)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/minimax/voices/{voice_id}")
async def minimax_get_voice(voice_id: str, user_id: str = Depends(get_current_user)):
    try:
        client = _require_minimax_client()
        result = await client.get_voice(voice_id)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/minimax/voices/{voice_id}")
async def minimax_delete_voice(
    voice_id: str,
    voice_type: str = "voice_cloning",
    user_id: str = Depends(get_current_user),
):
    try:
        client = _require_minimax_client()
        result = await client.delete_voice(voice_id, voice_type=voice_type)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/minimax/tts")
async def minimax_tts(data: MinimaxTTSRequest, user_id: str = Depends(get_current_user)):
    """提交 MiniMax TTS 任务到队列，立即返回数据库 task_id。

    2026-05-24 改造：原同步阻塞 300s 改为异步入队。worker 进程在 600s 窗口内
    完成轮询+下载+入库+entity 同步，避开 autodl 反代 5min idle timeout 边界。
    前端通过 GET /api/task/{task_id} 轮询进度与最终 audio_url / file_id。

    详见 recurring-pitfalls §Q「HTTP handler 阻塞超过反代 idle timeout」。
    """
    # 早 fail：MiniMax 未配置直接 503/501，不浪费一次入队
    try:
        _require_minimax_client()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    task_data = {
        "text": data.text,
        "voice_id": data.voice_id,
        "model": data.model,
        "speed": data.speed,
        "pitch": data.pitch,
        "emotion": data.emotion,
        "entity_type": data.entity_type,
        "entity_id": data.entity_id,
        "file_role": data.file_role,
        "episode_id": data.episode_id,
    }
    # 可选：试听场景透传 bind_to_character_voice_id，
    # 让 worker 完成时回写 character_voices.sample_audio_url
    bind = getattr(data, 'bind_to_character_voice_id', None)
    if bind:
        task_data['bind_to_character_voice_id'] = bind

    try:
        svc = task_service.get()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"任务服务未就绪: {e}")

    try:
        task_id = await svc.submit(
            task_type='minimax_tts',
            task_data=task_data,
            user_id=user_id,
            priority=2,
            prepare=False,  # MiniMax TTS 不走 ComfyUI workflow 预构建
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"MiniMax TTS 入队失败: text_len={len(data.text or '')} err={e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"TTS 入队失败: {e}")

    logger.info(
        f"📤 MiniMax TTS 已入队: task_id={task_id} voice_id={data.voice_id} "
        f"text_len={len(data.text or '')}"
    )
    return {"success": True, "task_id": task_id}


@router.post("/api/minimax/tts/sync")
async def minimax_tts_sync(
    data: MinimaxTTSRequest,
    user_id: str = Depends(get_current_user),
):
    """同步 MiniMax TTS — 短文本试听 fast-path（绕开 worker / 队列 / 轮询）。

    2026-05-25 引入：原 POST /api/minimax/tts 走 worker 异步,对短文本试听
    场景过重——前端要走「入队 → 轮询 GET /api/task → worker 拉队列 → 调 sync
    → 入库 → 完成 → 前端再 fetch audio_url」5 个环节,任何一环卡死用户都是
    几十秒到分钟级 loading。

    本 endpoint 在 handler 内 await client.tts_sync(...)（典型 1-15s,远低于
    autodl 反代 5min idle timeout）,同步入库并直接返回 audio_url + file_id。

    适用场景（必须满足）：
      - text ≤ 1000 字符（MiniMax sync 接口上限 10000,但我们留 buffer 给反代）
      - 单次调用即可,不需要 worker 级 retry / 并发限流

    不适用（去走 POST /api/minimax/tts 走 worker）：
      - 批量生成（一集 200 条对白）
      - text > 1000 字符
      - 需要 worker 的失败重试

    详见 recurring-pitfalls.md §R + §R 子陷阱 4「sync/async 双轨」。
    """
    if not data.text or not data.text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")
    if len(data.text) > 1000:
        raise HTTPException(
            status_code=413,
            detail=(
                f"text 过长 ({len(data.text)} > 1000),"
                "请改用 POST /api/minimax/tts（走 worker 异步路径,支持长文本）"
            ),
        )

    client = _require_minimax_client()

    kwargs = {
        'text': data.text,
        'voice_id': data.voice_id,
        'model': data.model,
        'speed': data.speed,
        'pitch': data.pitch,
    }
    if data.emotion:
        kwargs['emotion'] = data.emotion

    try:
        result = await client.tts_sync(**kwargs) or {}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"MiniMax TTS sync handler 调用失败: text_len={len(data.text)} err={e}",
            exc_info=True,
        )
        raise HTTPException(status_code=502, detail=f"MiniMax TTS 调用失败: {e}")

    audio_bytes = result.get('audio_bytes')
    if not audio_bytes:
        raise HTTPException(
            status_code=502,
            detail=f"MiniMax 未返回音频字节, trace_id={result.get('trace_id')}",
        )

    saved = await save_generated_file_to_db(
        content=audio_bytes,
        file_type='audio',
        user_id=user_id,
        source='minimax',
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        file_role=data.file_role or 'dialogue_audio',
        original_ext='.mp3',
        episode_id=data.episode_id,
    )
    file_id = saved['file_id']
    file_url = saved['file_url']

    # 2026-05-26 Slice 1 收尾：同步进通用素材库
    try:
        import media_library_service
        await media_library_service.create_from_file(
            file_record=saved, source='generated_audio_minimax',
            episode_id=data.episode_id,
            source_entity_type=data.entity_type,
            source_entity_id=data.entity_id,
            title=(getattr(data, 'text', '') or '')[:80] or None,
        )
    except Exception as _e:
        logger.warning(f"media_library 同步失败 (minimax sync TTS): {_e}")

    if data.bind_to_character_voice_id:
        try:
            await CharacterVoiceDAO.update_sample_audio_url(
                data.bind_to_character_voice_id, file_url,
            )
        except Exception as e:
            logger.warning(
                f"sync TTS 回写 sample_audio_url 失败（不致命）: "
                f"voice_id={data.bind_to_character_voice_id} err={e}"
            )

    logger.info(
        f"✅ MiniMax TTS sync 完成: voice_id={data.voice_id} "
        f"text_len={len(data.text)} duration_ms={result.get('duration_ms')} "
        f"trace_id={result.get('trace_id')} file_id={file_id}"
    )

    return {
        "success": True,
        "audio_url": file_url,
        "file_id": file_id,
        "file_url": file_url,
        "duration_ms": result.get('duration_ms'),
        "minimax_trace_id": result.get('trace_id'),
    }


@router.get("/api/minimax/tts/{task_id}")
async def minimax_tts_query(task_id: str, user_id: str = Depends(get_current_user)):
    """【诊断用】直查 MiniMax 端任务状态（task_id 是 mx_task_id，不是数据库 task_id）。

    2026-05-24 改造后前端不再依赖此端点；正常路径用 GET /api/task/{db_task_id}
    通过数据库 task_id 查询 worker 的入库结果。此端点保留供运维排错（例如
    判断 MiniMax 端是否在 5min 保留窗口内仍有该 task）。
    """
    try:
        client = _require_minimax_client()
        result = await client.tts_query(task_id)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/minimax/music")
async def minimax_music(data: MinimaxMusicRequest, user_id: str = Depends(get_current_user)):
    try:
        client = _require_minimax_client()
        result = await client.music_generate(
            lyrics=data.lyrics,
            refer_voice=data.refer_voice,
            refer_instrumental=data.refer_instrumental,
        )
        resp = {"success": True, "audio_url": result.get("audio_url", ""), "duration_ms": result.get("duration_ms", 0)}
        try:
            from file_service import save_generated_file_to_db
            audio_url = result.get('audio_url', '')
            if audio_url:
                audio_file_path = Path(AUDIO_UPLOAD_DIR) / os.path.basename(audio_url)
                if audio_file_path.exists():
                    saved = await save_generated_file_to_db(
                        content=audio_file_path.read_bytes(),
                        file_type='audio',
                        user_id=user_id,
                        source='minimax',
                        entity_type=data.entity_type,
                        entity_id=data.entity_id,
                        file_role=data.file_role or 'background_music',
                        original_ext=audio_file_path.suffix,
                        episode_id=data.episode_id,
                    )
                    resp['file_id'] = saved['file_id']
                    resp['file_url'] = saved['file_url']
                    try:
                        import media_library_service
                        await media_library_service.create_from_file(
                            file_record=saved, source='generated_audio_minimax_music',
                            episode_id=data.episode_id,
                            source_entity_type=data.entity_type,
                            source_entity_id=data.entity_id,
                            title=(getattr(data, 'lyrics', '') or '')[:80] or None,
                        )
                    except Exception as _e:
                        logger.warning(f"media_library 同步失败 (minimax music): {_e}")
        except Exception as e:
            logger.warning(f"保存音频到 files 表失败: {e}")
        return resp
    except Exception as e:
        logger.error(f"MiniMax music 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/minimax/lyrics")
async def minimax_lyrics(data: MinimaxLyricsRequest, user_id: str = Depends(get_current_user)):
    try:
        client = _require_minimax_client()
        result = await client.lyrics_generate(text=data.text, language=data.language)
        return {"success": True, "lyrics": result.get("data", {}).get("lyrics", "")}
    except Exception as e:
        logger.error(f"MiniMax lyrics 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/minimax/files/upload")
async def minimax_file_upload(
    file: UploadFile = File(...),
    purpose: str = Form("voice_clone"),
    user_id: str = Depends(get_current_user),
):
    try:
        tmp_dir = Path(AUDIO_UPLOAD_DIR)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = tmp_dir / f"upload_{uuid.uuid4().hex[:8]}_{file.filename}"
        content = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)
        client = _require_minimax_client()
        result = await client.file_upload(str(tmp_path), purpose=purpose)
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return {"success": True, "file_id": result.get("file", {}).get("file_id", result.get("file_id", ""))}
    except Exception as e:
        logger.error(f"MiniMax file upload 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/minimax/files/{file_id}")
async def minimax_file_retrieve(file_id: str, user_id: str = Depends(get_current_user)):
    try:
        client = _require_minimax_client()
        result = await client.file_retrieve(file_id)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/minimax/files/{file_id}")
async def minimax_file_delete(file_id: str, user_id: str = Depends(get_current_user)):
    try:
        client = _require_minimax_client()
        result = await client.file_delete(file_id)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 剧本 API
# ============================================

class ScriptUpdate(BaseModel):
    original_content: Optional[str] = None
    adapted_script: Optional[str] = None
    metadata: Optional[dict] = None
    file_name: Optional[str] = None


class ScriptCreate(BaseModel):
    file_name: str = '未命名文件'
    original_content: str = ''
    adapted_script: str = ''
    sort_order: Optional[int] = None
    metadata: Optional[dict] = None


# ---------- 剧本分段 API（2026-05-29 三步生成 Stage 1 产物）----------

class ScriptSegmentBatchBody(BaseModel):
    script_id: Optional[str] = None
    segments: list = []


@router.get("/api/episodes/{episode_id}/script-segments")
async def list_script_segments(episode_id: str, script_id: Optional[str] = None,
                               user_id: str = Depends(get_current_user)):
    if script_id:
        rows = await EpisodeScriptSegmentDAO.list_by_script(episode_id, script_id)
    else:
        rows = await EpisodeScriptSegmentDAO.list_by_episode(episode_id)
    return {"success": True, "segments": rows}


@router.put("/api/episodes/{episode_id}/script-segments/batch")
async def batch_save_script_segments(episode_id: str, data: ScriptSegmentBatchBody,
                                     user_id: str = Depends(get_current_user)):
    rows = await EpisodeScriptSegmentDAO.batch_replace(episode_id, data.script_id, data.segments)
    return {"success": True, "segments": rows}


@router.delete("/api/episodes/{episode_id}/script-segments")
async def delete_script_segments(episode_id: str, script_id: Optional[str] = None,
                                 user_id: str = Depends(get_current_user)):
    count = await EpisodeScriptSegmentDAO.delete_by_script(episode_id, script_id)
    return {"success": True, "deleted": count}


@router.get("/api/episodes/{episode_id}/script")
async def get_script(episode_id: str, user_id: str = Depends(get_current_user)):
    script = await EpisodeScriptDAO.get_by_episode(episode_id)
    if not script:
        return {"success": True, "script": None}
    return {"success": True, "script": dict(script)}


@router.put("/api/episodes/{episode_id}/script")
async def update_script(episode_id: str, data: ScriptUpdate, user_id: str = Depends(get_current_user)):
    script = await EpisodeScriptDAO.save_or_update(
        episode_id=episode_id,
        original_content=data.original_content or '',
        adapted_script=data.adapted_script or '',
        metadata=data.metadata
    )
    if not script:
        raise HTTPException(status_code=500, detail="保存剧本失败")
    return {"success": True, "script": dict(script)}


# ---------- 多文件剧本 API ----------

@router.get("/api/episodes/{episode_id}/scripts")
async def list_scripts(episode_id: str, user_id: str = Depends(get_current_user)):
    scripts = await EpisodeScriptDAO.list_by_episode(episode_id)
    return {"success": True, "scripts": scripts}


@router.post("/api/episodes/{episode_id}/scripts")
async def create_script(episode_id: str, data: ScriptCreate, user_id: str = Depends(get_current_user)):
    sort_order = data.sort_order
    if sort_order is None:
        sort_order = await EpisodeScriptDAO.get_next_sort_order(episode_id)
    script = await EpisodeScriptDAO.create(
        episode_id=episode_id,
        file_name=data.file_name,
        original_content=data.original_content,
        adapted_script=data.adapted_script,
        sort_order=sort_order,
        metadata=data.metadata,
    )
    if not script:
        raise HTTPException(status_code=500, detail="创建剧本文件失败")
    return {"success": True, "script": dict(script)}


@router.put("/api/episodes/{episode_id}/scripts/{script_id}")
async def update_script_by_id(episode_id: str, script_id: str, data: ScriptUpdate, user_id: str = Depends(get_current_user)):
    script = await EpisodeScriptDAO.update(
        script_id=script_id,
        file_name=data.file_name,
        original_content=data.original_content,
        adapted_script=data.adapted_script,
        metadata=data.metadata,
    )
    if not script:
        raise HTTPException(status_code=404, detail="剧本文件不存在")
    return {"success": True, "script": dict(script)}


@router.delete("/api/episodes/{episode_id}/scripts/{script_id}")
async def delete_script_by_id(episode_id: str, script_id: str, user_id: str = Depends(get_current_user)):
    ok = await EpisodeScriptDAO.delete_by_id(script_id)
    if not ok:
        raise HTTPException(status_code=404, detail="剧本文件不存在")
    return {"success": True}


# ============================================
# 时间轴 API
# ============================================

class TimelineTrackCreate(BaseModel):
    track_type: str
    track_name: str = ''
    sort_order: int = 0
    items: Optional[list] = None

class TimelineTrackUpdate(BaseModel):
    track_name: Optional[str] = None
    sort_order: Optional[int] = None
    items: Optional[list] = None


@router.get("/api/episodes/{episode_id}/timeline-tracks")
async def get_timeline_tracks(episode_id: str, user_id: str = Depends(get_current_user)):
    tracks = await TimelineDAO.get_by_episode(episode_id)
    return {"success": True, "tracks": [dict(t) for t in tracks]}


@router.post("/api/episodes/{episode_id}/timeline-tracks")
async def create_timeline_track(episode_id: str, data: TimelineTrackCreate, user_id: str = Depends(get_current_user)):
    track = await TimelineDAO.create(
        episode_id=episode_id, track_type=data.track_type,
        track_name=data.track_name, sort_order=data.sort_order,
        items=data.items
    )
    if not track:
        raise HTTPException(status_code=500, detail="创建时间轴轨道失败")
    return {"success": True, "track": dict(track)}


@router.put("/api/timeline-tracks/{track_id}")
async def update_timeline_track(track_id: str, data: TimelineTrackUpdate, user_id: str = Depends(get_current_user)):
    track = await TimelineDAO.update(track_id, **data.dict(exclude_none=True))
    if not track:
        raise HTTPException(status_code=404, detail="时间轴轨道不存在")
    return {"success": True, "track": dict(track)}


# ============================================
# 人物音色 API
# ============================================

class CharacterVoiceCreate(BaseModel):
    project_id: str
    character_name: str
    asset_id: Optional[str] = None
    voice_provider: Optional[str] = None
    voice_model_id: Optional[str] = None
    voice_name: Optional[str] = None
    voice_params: Optional[dict] = None
    sample_audio_url: Optional[str] = None

class CharacterVoiceUpdate(BaseModel):
    character_name: Optional[str] = None
    asset_id: Optional[str] = None
    voice_provider: Optional[str] = None
    voice_model_id: Optional[str] = None
    voice_name: Optional[str] = None
    voice_params: Optional[dict] = None
    sample_audio_url: Optional[str] = None


@router.post("/api/character-voices")
async def create_character_voice(data: CharacterVoiceCreate, user_id: str = Depends(get_current_user)):
    voice = await CharacterVoiceDAO.create(
        project_id=data.project_id, character_name=data.character_name,
        asset_id=data.asset_id, voice_provider=data.voice_provider,
        voice_model_id=data.voice_model_id, voice_name=data.voice_name,
        voice_params=data.voice_params, sample_audio_url=data.sample_audio_url,
    )
    if not voice:
        raise HTTPException(status_code=500, detail="创建音色失败")
    return {"success": True, "voice": dict(voice)}


@router.get("/api/projects/{project_id}/character-voices")
async def get_character_voices(project_id: str, user_id: str = Depends(get_current_user)):
    voices = await CharacterVoiceDAO.get_by_project(project_id)
    return {"success": True, "voices": [dict(v) for v in voices]}


@router.put("/api/character-voices/{voice_id}")
async def update_character_voice(voice_id: str, data: CharacterVoiceUpdate, user_id: str = Depends(get_current_user)):
    voice = await CharacterVoiceDAO.update(voice_id, **data.dict(exclude_none=True))
    if not voice:
        raise HTTPException(status_code=404, detail="音色不存在")
    return {"success": True, "voice": dict(voice)}


@router.delete("/api/character-voices/{voice_id}")
async def delete_character_voice(voice_id: str, user_id: str = Depends(get_current_user)):
    ok = await CharacterVoiceDAO.delete(voice_id)
    if not ok:
        raise HTTPException(status_code=404, detail="音色不存在")
    return {"success": True}


# ============================================
# 批量操作 API
# ============================================

class BatchStoryboardCreate(BaseModel):
    items: list
    script_id: Optional[str] = None

class ExtractToAssetsRequest(BaseModel):
    characters: list
    scenes: list
    script_id: Optional[str] = None


@router.post("/api/episodes/{episode_id}/storyboard-items/batch")
async def batch_create_storyboard_items(
    episode_id: str, data: BatchStoryboardCreate,
    user_id: str = Depends(get_current_user)
):
    items = await StoryboardDAO.batch_create(episode_id, data.items, script_id=data.script_id)
    return {"success": True, "items": items}


@router.post("/api/episodes/{episode_id}/extract-to-assets")
async def extract_to_assets(
    episode_id: str, data: ExtractToAssetsRequest,
    user_id: str = Depends(get_current_user)
):
    from dao_episode import EpisodeDAO
    episode = await EpisodeDAO.get_episode(episode_id)
    if not episode:
        raise HTTPException(status_code=404, detail="集不存在")
    project_id = str(episode['project_id'])

    existing_assets = await AssetDAO.get_by_project(project_id, episode_id, script_id=data.script_id)
    existing_names = {(a['asset_type'], a['name']) for a in existing_assets}

    created = []
    for char in data.characters:
        name = char.get('name', '').strip()
        if not name or ('character', name) in existing_names:
            continue
        asset = await AssetDAO.create(
            project_id=project_id, asset_type='character',
            name=name, created_by=user_id,
            episode_id=episode_id, description=char.get('description', ''),
            script_id=data.script_id,
        )
        if asset:
            created.append(dict(asset))
            existing_names.add(('character', name))
    for scene in data.scenes:
        name = scene.get('name', '').strip()
        if not name or ('scene', name) in existing_names:
            continue
        asset = await AssetDAO.create(
            project_id=project_id, asset_type='scene',
            name=name, created_by=user_id,
            episode_id=episode_id, description=scene.get('description', ''),
            script_id=data.script_id,
        )
        if asset:
            created.append(dict(asset))
            existing_names.add(('scene', name))
    return {"success": True, "assets": created}


# ============================================
# 资产共享 API
# ============================================

class AssetShareRequest(BaseModel):
    target_episode_id: str
    target_script_id: str

@router.post("/api/assets/{asset_id}/share")
async def share_asset(asset_id: str, data: AssetShareRequest, user_id: str = Depends(get_current_user)):
    """复制一个资产到目标分集/文件（含关联的 entity_files）"""
    new_asset = await AssetDAO.copy_to(
        asset_id=asset_id,
        target_episode_id=data.target_episode_id,
        target_script_id=data.target_script_id,
        created_by=user_id,
    )
    if not new_asset:
        raise HTTPException(status_code=404, detail="源资产不存在")

    copied_files = []
    try:
        source_files = await EntityFileDAO.get_entity_files("asset", asset_id)
        items = source_files.get("items", [])
        for ef in items:
            copied = await EntityFileDAO.copy_file(
                ef["file_id"], "asset", new_asset["asset_id"], ef.get("file_role", "reference_image")
            )
            if copied:
                copied_files.append(copied)
    except Exception as e:
        logger.warning(f"复制资产关联文件失败: {e}")

    return {"success": True, "asset": dict(new_asset), "copied_files": len(copied_files)}


# ============================================
# 统一文件管理 (Entity Files)
# ============================================

@router.get("/api/user-files")
async def get_user_files(
    file_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
):
    """获取当前用户所有文件（支持 file_type 过滤）"""
    if limit > 500:
        limit = 500
    rows = await FileDAO.get_user_files(user_id, file_type, limit, offset)
    items = []
    for r in rows:
        item = dict(r)
        if isinstance(item.get("metadata"), str):
            try:
                item["metadata"] = json.loads(item["metadata"])
            except Exception:
                item["metadata"] = {}
        items.append(item)
    count_query = "SELECT COUNT(*) FROM files WHERE user_id = $1 AND is_deleted = FALSE"
    args = [user_id]
    if file_type:
        count_query += " AND file_type = $2"
        args.append(file_type)
    db = get_db_manager()
    total = await db.fetchval(count_query, *args) or 0
    return {"success": True, "items": items, "total": total}


@router.get("/api/entity-files")
async def get_entity_files(
    entity_type: str,
    entity_id: str,
    file_role: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
):
    if limit > 200:
        limit = 200
    result = await EntityFileDAO.get_entity_files(
        entity_type, entity_id, file_role, limit, offset
    )
    return {"success": True, **result}


@router.post("/api/entity-files/link")
async def link_entity_file(
    req: EntityFileLinkRequest,
    user_id: str = Depends(get_current_user),
):
    row = await EntityFileDAO.link_file(
        req.file_id, req.entity_type, req.entity_id,
        req.file_role, req.is_selected,
    )
    if not row:
        raise HTTPException(404, "文件不存在或已删除")
    return {"success": True, "file": row}


@router.put("/api/entity-files/{file_id}/select")
async def select_entity_file(
    file_id: str,
    req: EntityFileSelectRequest,
    user_id: str = Depends(get_current_user),
):
    row = await EntityFileDAO.select_file(
        file_id, req.entity_type, req.entity_id, req.file_role,
    )
    if not row:
        raise HTTPException(404, "文件不存在或不属于指定实体")

    await _sync_legacy_url(req.entity_type, req.entity_id, req.file_role, row["file_url"])

    return {"success": True, "file": row}


async def _sync_legacy_url(entity_type: str, entity_id: str, file_role: str, url: str):
    """向后兼容：选定文件后同步更新旧业务表的 URL 字段"""
    db = get_db_manager()
    if not db:
        return
    try:
        if entity_type == "storyboard_item":
            field_map = {
                "generated_image": "generated_image_url",
                "dialogue_audio": "dialogue_audio_url",
                "narration_audio": "narration_audio_url",
                "sfx": "sfx_audio_url",
            }
            col = field_map.get(file_role)
            if col:
                await db.execute(
                    f"UPDATE storyboard_items SET {col} = $1 WHERE item_id = $2",
                    url, entity_id,
                )
        elif entity_type == "asset":
            if file_role == "asset_thumbnail":
                await db.execute(
                    "UPDATE assets SET thumbnail_url = $1 WHERE asset_id = $2",
                    url, entity_id,
                )
            elif file_role == "reference_image":
                import json as _json
                row = await db.fetchrow(
                    "SELECT reference_images FROM assets WHERE asset_id = $1", entity_id
                )
                if row:
                    existing = row.get("reference_images") or []
                    if isinstance(existing, str):
                        existing = _json.loads(existing) if existing else []
                    if url not in existing:
                        existing.append(url)
                        await db.execute(
                            "UPDATE assets SET reference_images = $1::jsonb WHERE asset_id = $2",
                            _json.dumps(existing, ensure_ascii=False), entity_id,
                        )
        elif entity_type == "video_segment":
            if file_role == "video":
                await db.execute(
                    "UPDATE video_segments SET video_url = $1 WHERE segment_id = $2",
                    url, entity_id,
                )
            elif file_role == "video_thumbnail":
                await db.execute(
                    "UPDATE video_segments SET thumbnail_url = $1 WHERE segment_id = $2",
                    url, entity_id,
                )
    except Exception as e:
        logger.warning(f"同步旧URL字段失败: {e}")


@router.post("/api/entity-files/upload")
async def upload_entity_file(
    file: UploadFile = File(...),
    entity_type: str = Form(None),
    entity_id: str = Form(None),
    file_role: str = Form(None),
    episode_id: str = Form(None),
    user_id: str = Depends(get_current_user),
):
    """上传文件并关联到实体"""
    content = await file.read()
    ext = Path(file.filename).suffix if file.filename else '.bin'
    file_type = 'image' if file.content_type and file.content_type.startswith('image') else \
                'audio' if file.content_type and file.content_type.startswith('audio') else \
                'video' if file.content_type and file.content_type.startswith('video') else 'other'

    from file_service import save_generated_file_to_db
    saved = await save_generated_file_to_db(
        content=content,
        file_type=file_type,
        user_id=user_id,
        source='upload',
        entity_type=entity_type,
        entity_id=entity_id,
        file_role=file_role,
        original_ext=ext,
        episode_id=episode_id,
    )
    # 2026-05-26 Slice 1 收尾：通用上传也进素材库（best-effort）
    try:
        if file_type in ('image', 'video', 'audio'):
            import media_library_service
            await media_library_service.create_from_file(
                file_record=saved, source='upload',
                episode_id=episode_id,
                source_entity_type=entity_type,
                source_entity_id=entity_id,
                title=(file.filename or '')[:80] or None,
            )
    except Exception as _e:
        logger.warning(f"media_library 同步失败 (entity-files upload): {_e}")
    return {"success": True, "file_id": saved['file_id'], "file_url": saved['file_url']}


@router.delete("/api/entity-files/{file_id}")
async def delete_entity_file(
    file_id: str,
    user_id: str = Depends(get_current_user),
):
    ok = await EntityFileDAO.soft_delete(file_id)
    if not ok:
        raise HTTPException(404, "文件不存在或已删除")
    return {"success": True}


@router.delete("/api/entity-files/{file_id}/hard")
async def hard_delete_entity_file(
    file_id: str,
    user_id: str = Depends(get_current_user),
):
    """硬删除：同时删除磁盘文件和数据库记录"""
    result = await EntityFileDAO.hard_delete(file_id)
    if not result:
        raise HTTPException(404, "文件不存在")
    return {"success": True, "freed_bytes": result["freed_bytes"]}


class HardDeleteBatchRequest(BaseModel):
    file_ids: List[str]


@router.post("/api/entity-files/hard-delete-batch")
async def hard_delete_entity_files_batch(
    request: HardDeleteBatchRequest,
    user_id: str = Depends(get_current_user),
):
    """批量硬删除：同时删除磁盘文件和数据库记录"""
    if len(request.file_ids) > 200:
        raise HTTPException(400, "单次最多删除 200 个文件")
    result = await EntityFileDAO.hard_delete_batch(request.file_ids)
    return {"success": True, **result}


@router.post("/api/entity-files/migrate")
async def run_entity_file_migration(user_id: str = Depends(get_current_user)):
    """运行文件迁移：将孤儿文件链接到正确的 entity"""
    try:
        from migrate_existing_files import (
            migrate_storyboard_items,
            migrate_assets,
            migrate_video_segments,
            recover_orphan_files,
        )
        await migrate_storyboard_items()
        await migrate_assets()
        await migrate_video_segments()
        recovered = await recover_orphan_files()
        return {"success": True, "recovered": recovered}
    except Exception as e:
        raise HTTPException(500, f"迁移失败: {str(e)}")
