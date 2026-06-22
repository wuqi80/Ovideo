"""Legacy project compatibility routes."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from schemas.project import ExportToVideoRequest, ProjectData
from services.project_image_service import (
    is_data_image,
    persist_project_embedded_base64_image,
)
from services.project_read_service import (
    ProjectReadForbidden,
    ProjectReadNotFound,
    get_project_response,
    get_shot_images_response,
)
from services.project_video_task_service import (
    ProjectVideoTaskForbidden,
    ProjectVideoTaskNotFound,
    clear_project_video_tasks_response,
    export_project_to_video_response,
)
from utils.json_helpers import parse_jsonb_field


def create_projects_router(
    *,
    require_auth_dependency: Any,
    project_dao: Any,
    project_member_dao: Any,
    user_dao: Any,
    file_dao: Any,
    version_dao: Any,
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()
    ProjectDAO = project_dao
    ProjectMemberDAO = project_member_dao
    UserDAO = user_dao
    FileDAO = file_dao
    VersionDAO = version_dao

    # ==================== 项目数据管理 API（四阶段数据打通） ====================

    async def convert_base64_images_in_project(project_data: dict, username: str) -> dict:
        """将项目中的所有Base64图片转换为数据库文件URL"""

        async def convert_base64_to_url(base64_data: str, context: str = "") -> str:
            """转换单个Base64图片为URL"""
            # 🔧 如果不是Base64数据，直接返回（已经是URL）
            if not base64_data:
                return base64_data

            # 🔧 检查是否已经是持久化的文件URL（避免重复转换）
            if base64_data.startswith('/api/files/'):
                return base64_data

            # 🔧 检查是否是HTTP URL（远程图片）
            if base64_data.startswith('http://') or base64_data.startswith('https://'):
                return base64_data

            # 🔧 只转换Base64数据
            if not is_data_image(base64_data):
                return base64_data

            try:
                # 提取Base64数据
                persisted = await persist_project_embedded_base64_image(
                    username=username,
                    image_data=base64_data,
                    context=context,
                    file_dao=FileDAO,
                    project_dao=ProjectDAO,
                    version_dao=VersionDAO,
                    logger=logger,
                )
                url = persisted.file_url
                logger.info("Base64 project image persisted: %s -> %s", context, url)
                return url

            except Exception as e:
                logger.error(f"❌ Base64转换失败: {context} - {e}")
                return base64_data  # 失败则保持原样

        # 处理素材库中的图片
        if project_data.get('material_library'):
            for tag_name, materials in project_data['material_library'].items():
                if isinstance(materials, list):
                    for idx, material in enumerate(materials):
                        if isinstance(material, dict):
                            # 转换原图 URL
                            if 'url' in material:
                                material['url'] = await convert_base64_to_url(
                                    material['url'],
                                    f"material_{tag_name}_{idx}_full"
                                )
                            # 转换缩略图 URL
                            if 'thumbnail' in material:
                                material['thumbnail'] = await convert_base64_to_url(
                                    material['thumbnail'],
                                    f"material_{tag_name}_{idx}_thumb"
                                )

        # 处理生成的图片
        if project_data.get('generated_images'):
            for shot_id, images in project_data['generated_images'].items():
                if isinstance(images, dict) and 'images' in images:
                    # 新格式：{images: [...], selectedImageId: ...}
                    for idx, img_data in enumerate(images['images']):
                        if isinstance(img_data, dict):
                            # 转换原图 URL
                            if 'url' in img_data:
                                images['images'][idx]['url'] = await convert_base64_to_url(
                                    img_data['url'],
                                    f"generated_{shot_id}_{idx}_full"
                                )
                            # 转换缩略图 URL
                            if 'thumbnail' in img_data:
                                images['images'][idx]['thumbnail'] = await convert_base64_to_url(
                                    img_data['thumbnail'],
                                    f"generated_{shot_id}_{idx}_thumb"
                                )
                elif isinstance(images, list):
                    # 旧格式：直接是数组
                    for idx, img_data in enumerate(images):
                        if isinstance(img_data, dict):
                            # 转换原图 URL
                            if 'url' in img_data:
                                images[idx]['url'] = await convert_base64_to_url(
                                    img_data['url'],
                                    f"generated_{shot_id}_{idx}_full"
                                )
                            # 转换缩略图 URL
                            if 'thumbnail' in img_data:
                                images[idx]['thumbnail'] = await convert_base64_to_url(
                                    img_data['thumbnail'],
                                    f"generated_{shot_id}_{idx}_thumb"
                                )
                        elif isinstance(img_data, str):
                            # 直接是URL字符串
                            project_data['generated_images'][shot_id][idx] = await convert_base64_to_url(
                                img_data,
                                f"generated_{shot_id}_{idx}"
                            )

        # 处理分镜中的参考图片
        if project_data.get('storyboard') and project_data['storyboard'].get('items'):
            for item in project_data['storyboard']['items']:
                if 'references' in item and isinstance(item['references'], list):
                    for idx, ref in enumerate(item['references']):
                        if isinstance(ref, dict):
                            # 转换原图 URL
                            if 'url' in ref:
                                ref['url'] = await convert_base64_to_url(
                                    ref['url'],
                                    f"ref_{item.get('id', 'unknown')}_{idx}_full"
                                )
                            # 转换缩略图 URL
                            if 'thumbnail' in ref:
                                ref['thumbnail'] = await convert_base64_to_url(
                                    ref['thumbnail'],
                                    f"ref_{item.get('id', 'unknown')}_{idx}_thumb"
                                )
                # 处理生成的图片（generatedImages）
                if 'generatedImages' in item and isinstance(item['generatedImages'], list):
                    for idx, gen_img in enumerate(item['generatedImages']):
                        if isinstance(gen_img, dict):
                            # 转换原图 URL
                            if 'url' in gen_img:
                                gen_img['url'] = await convert_base64_to_url(
                                    gen_img['url'],
                                    f"item_{item.get('id', 'unknown')}_gen_{idx}_full"
                                )
                            # 转换缩略图 URL
                            if 'thumbnail' in gen_img:
                                gen_img['thumbnail'] = await convert_base64_to_url(
                                    gen_img['thumbnail'],
                                    f"item_{item.get('id', 'unknown')}_gen_{idx}_thumb"
                                )
                        elif isinstance(gen_img, str):
                            item['generatedImages'][idx] = await convert_base64_to_url(
                                gen_img,
                                f"item_{item.get('id', 'unknown')}_gen_{idx}"
                            )

        # 处理版本历史中的图片
        if project_data.get('versions') and isinstance(project_data['versions'], list):
            for version_idx, version in enumerate(project_data['versions']):
                if isinstance(version, dict) and 'data' in version:
                    version_data = version['data']

                    # 递归处理版本数据中的图片（素材库、生成图片、分镜）
                    if version_data.get('materialLibrary'):
                        for tag_name, materials in version_data['materialLibrary'].items():
                            if isinstance(materials, list):
                                for idx, material in enumerate(materials):
                                    if isinstance(material, dict) and 'url' in material:
                                        material['url'] = await convert_base64_to_url(
                                            material['url'],
                                            f"v{version_idx}_material_{tag_name}_{idx}"
                                        )

                    if version_data.get('storyboard') and version_data['storyboard'].get('items'):
                        for item in version_data['storyboard']['items']:
                            if 'references' in item and isinstance(item['references'], list):
                                for idx, ref in enumerate(item['references']):
                                    if isinstance(ref, dict) and 'url' in ref:
                                        ref['url'] = await convert_base64_to_url(
                                            ref['url'],
                                            f"v{version_idx}_ref_{item.get('id', 'unknown')}_{idx}"
                                        )
                            if 'generatedImages' in item and isinstance(item['generatedImages'], list):
                                for idx, gen_img in enumerate(item['generatedImages']):
                                    if isinstance(gen_img, dict) and 'url' in gen_img:
                                        gen_img['url'] = await convert_base64_to_url(
                                            gen_img['url'],
                                            f"v{version_idx}_gen_{item.get('id', 'unknown')}_{idx}"
                                        )

        return project_data


    @router.post("/api/projects/save")
    async def save_project(project: ProjectData, username: str = Depends(require_auth_dependency)):
        """保存项目数据到数据库（自动将Base64图片转换为持久化URL）"""
        try:
            # username 就是 user_id（系统设计）
            project.user_id = username
            project.updated_at = datetime.now().isoformat()
            if not project.created_at:
                project.created_at = project.updated_at

            # 转换项目数据为字典
            project_dict = project.model_dump()

            # Read existing project data ONCE (not 3 times)
            existing_data = {}
            if project.project_id:
                try:
                    db_project = await ProjectDAO.get_project(project.project_id)
                    if db_project and db_project.get('settings'):
                        existing_data = parse_jsonb_field(db_project['settings'])
                except Exception as e:
                    logger.warning(f"⚠️ 读取现有项目数据失败: {e}")

            if 'video_tasks' not in project_dict or project_dict['video_tasks'] is None:
                existing_video_tasks = existing_data.get('video_tasks')
                if existing_video_tasks and len(existing_video_tasks) > 0:
                    project_dict['video_tasks'] = existing_video_tasks
                    logger.info(f"🔒 保留现有的 {len(existing_video_tasks)} 个 video_tasks")

            if 'generated_images' not in project_dict or project_dict['generated_images'] is None:
                existing_generated_images = existing_data.get('generated_images')
                if existing_generated_images and len(existing_generated_images) > 0:
                    project_dict['generated_images'] = existing_generated_images
                    logger.info(f"🔒 保留现有的 {len(existing_generated_images)} 个 generated_images")

            if project_dict.get('generated_images'):
                try:
                    existing_generated_images = existing_data.get('generated_images', {})

                    recovered_count = 0
                    thumbnail_fallback_count = 0

                    # 遍历所有镜头的图片
                    for shot_id, img_data in project_dict['generated_images'].items():
                        if isinstance(img_data, dict) and 'images' in img_data:
                            existing_shot_data = existing_generated_images.get(shot_id, {})
                            existing_images_list = []
                            if isinstance(existing_shot_data, dict) and 'images' in existing_shot_data:
                                existing_images_list = existing_shot_data['images']
                            elif isinstance(existing_shot_data, list):
                                existing_images_list = existing_shot_data

                            # 处理每张图片
                            for idx, img in enumerate(img_data['images']):
                                if not img.get('url'):
                                    # 尝试从数据库恢复URL
                                    if idx < len(existing_images_list):
                                        existing_img = existing_images_list[idx]
                                        if existing_img.get('url'):
                                            img['url'] = existing_img['url']
                                            recovered_count += 1
                                            continue

                                    # 回退：使用缩略图作为完整图片
                                    if img.get('thumbnail'):
                                        img['url'] = img['thumbnail']
                                        thumbnail_fallback_count += 1

                    if recovered_count > 0:
                        logger.info(f"✅ 从数据库恢复了 {recovered_count} 张图片的原图URL")
                    if thumbnail_fallback_count > 0:
                        logger.info(f"📋 使用缩略图作为完整图片: {thumbnail_fallback_count} 张")

                except Exception as e:
                    logger.error(f"❌ 恢复原图URL失败: {e}")

            # 🔍 调试：打印 generated_images 的数据（只打印前3个）
            if project_dict.get('generated_images'):
                for shot_id, img_data in list(project_dict['generated_images'].items())[:3]:
                    if isinstance(img_data, dict) and 'images' in img_data:
                        url_count = sum(1 for img in img_data['images'] if img.get('url'))
                        logger.info(f"📦 保存镜头 {shot_id}: {len(img_data['images'])} 张图片, 有URL: {url_count}, 选中: {img_data.get('selectedImageId')}")

            # 将所有Base64图片转换为持久化URL
            project_dict = await convert_base64_images_in_project(project_dict, username)

            # 🔍 调试：转换后再次检查
            if project_dict.get('generated_images'):
                for shot_id, img_data in list(project_dict['generated_images'].items())[:3]:
                    if isinstance(img_data, dict) and 'images' in img_data:
                        logger.info(f"💾 转换后镜头 {shot_id}: {len(img_data['images'])} 张图片")

            # 💾 保存到数据库（使用JSONB字段存储完整项目数据）
            result = await ProjectDAO.save_or_update_project(
                user_id=username,
                project_id=project.project_id,
                project_name=project.name,
                project_data=project_dict,
                description=project_dict.get('description', '')
            )

            if result:
                logger.info(f"✅ 保存项目到数据库: {project.name} ({project.project_id})")

            # 🔧 返回转换后的素材库URL，供前端更新本地state
            return {
                "success": True,
                "project_id": project.project_id,
                "message": "项目保存成功",
                "material_library": project_dict.get('material_library', {})  # 返回转换后的URL
            }
        except Exception as e:
            logger.error(f"保存项目失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/projects/list")
    async def list_projects(
        username: str = Depends(require_auth_dependency),
        limit: int = 100,
        org_id: Optional[str] = None,
    ):
        """从数据库获取项目列表。

        org_id=None：旧行为（user_id=me）
        org_id=X：组织 workspace — owner=me 或 项目/分组被 share 给 X
        详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5.4
        """
        try:
            if org_id:
                from dao_organization import OrganizationMemberDAO
                if not await OrganizationMemberDAO.is_member(org_id, username):
                    raise HTTPException(status_code=403, detail="不是该组织成员")
                db_projects = await ProjectDAO.get_projects_for_org(
                    user_id=username, org_id=org_id, include_archived=False,
                )
            else:
                db_projects = await ProjectDAO.get_user_projects(
                    user_id=username, include_archived=False,
                )

            projects = []
            for proj in db_projects[:limit]:
                project_data = parse_jsonb_field(proj.get('settings'))
                projects.append({
                    "project_id": proj.get("project_id"),
                    "name": proj.get("project_name"),
                    "stage": project_data.get("stage", 1),
                    "created_at": proj.get("created_at").isoformat() if proj.get("created_at") else None,
                    "updated_at": proj.get("updated_at").isoformat() if proj.get("updated_at") else None,
                    "owner_user_id": proj.get("user_id"),
                    "group_id": proj.get("group_id"),
                    "visibility": proj.get("visibility"),
                })

            return {"success": True, "projects": projects}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"获取项目列表失败: {e}", exc_info=True)
            return {"success": False, "projects": []}

    @router.get("/api/projects/{project_id}")
    async def get_project(
        project_id: str,
        thumbnail_only: bool = True,
        username: str = Depends(require_auth_dependency)
    ):
        """从数据库获取项目详情"""
        try:
            return await get_project_response(
                project_id,
                username=username,
                thumbnail_only=thumbnail_only,
                project_dao=ProjectDAO,
                project_member_dao=ProjectMemberDAO,
                user_dao=UserDAO,
                logger=logger,
            )
        except ProjectReadNotFound as exc:
            raise HTTPException(status_code=404, detail="项目不存在") from exc
        except ProjectReadForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问此项目") from exc
        except Exception as e:
            logger.error(f"获取项目失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/projects/{project_id}")
    async def delete_project(project_id: str, username: str = Depends(require_auth_dependency)):
        """从数据库删除项目"""
        try:
            # 验证项目存在且属于当前用户
            db_project = await ProjectDAO.get_project(project_id)

            if not db_project:
                raise HTTPException(status_code=404, detail="项目不存在")

            if db_project.get('user_id') != username:
                raise HTTPException(status_code=403, detail="无权删除此项目")

            # 从数据库删除项目（会级联删除相关版本、文件、文本）
            await ProjectDAO.delete_project(project_id, username)
            logger.info(f"✅ 删除项目: {project_id}")

            return {"success": True, "message": "项目删除成功"}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"删除项目失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/projects/{project_id}/images/{shot_id}")
    async def get_shot_images(
        project_id: str,
        shot_id: str,
        username: str = Depends(require_auth_dependency)
    ):
        """获取指定镜头的完整图片数据（按需加载）"""
        try:
            return await get_shot_images_response(
                project_id,
                shot_id,
                username=username,
                project_dao=ProjectDAO,
                project_member_dao=ProjectMemberDAO,
                user_dao=UserDAO,
                logger=logger,
            )
        except ProjectReadNotFound as exc:
            raise HTTPException(status_code=404, detail="项目不存在") from exc
        except ProjectReadForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问此项目") from exc
        except Exception as e:
            logger.error(f"获取镜头图片失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/projects/{project_id}/export-to-video")
    async def export_to_video(
        project_id: str,
        request: ExportToVideoRequest,
        username: str = Depends(require_auth_dependency)
    ):
        """第三阶段 -> 第四阶段数据传递"""
        try:
            return await export_project_to_video_response(
                project_id,
                selected_items=request.selected_items,
                username=username,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                file_dao=FileDAO,
                logger=logger,
            )
        except ProjectVideoTaskNotFound as exc:
            raise HTTPException(status_code=404, detail="项目不存在") from exc
        except ProjectVideoTaskForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问此项目") from exc
        except Exception as e:
            logger.error(f"导出失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/projects/{project_id}/clear-video-tasks")
    async def clear_video_tasks(
        project_id: str,
        username: str = Depends(require_auth_dependency)
    ):
        """清除项目中的video_tasks，避免重复导入"""
        try:
            return await clear_project_video_tasks_response(
                project_id,
                username=username,
                project_dao=ProjectDAO,
                logger=logger,
            )
        except ProjectVideoTaskNotFound as exc:
            raise HTTPException(status_code=404, detail="项目不存在") from exc
        except ProjectVideoTaskForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问此项目") from exc
        except Exception as e:
            logger.error(f"清除video_tasks失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
