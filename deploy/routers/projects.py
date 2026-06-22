"""Legacy project compatibility routes."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from schemas.project import ExportToVideoRequest, ProjectData
from services.project_image_service import (
    is_data_image,
    persist_export_storyboard_base64_image,
    persist_project_embedded_base64_image,
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

    async def can_read_project(db_project: dict, username: str) -> bool:
        """Owner, project members, and platform admins may read project detail."""
        project_id = db_project.get("project_id")
        if db_project.get("user_id") == username:
            return True
        if project_id and await ProjectMemberDAO.check_permission(project_id, username, "readonly"):
            return True
        return await UserDAO.is_admin_user(username)

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
            logger.info(f"📂 读取项目: {project_id} (用户: {username}, 缩略图模式: {thumbnail_only})")

            # 从数据库读取项目
            db_project = await ProjectDAO.get_project(project_id)

            if not db_project:
                raise HTTPException(status_code=404, detail="项目不存在")

            if not await can_read_project(db_project, username):
                raise HTTPException(status_code=403, detail="无权访问此项目")

            # 从settings JSONB字段中获取完整的项目数据
            data = parse_jsonb_field(db_project.get('settings'))

            # 🎯 如果只需要缩略图，精简图片数据
            if thumbnail_only and data.get('generated_images'):
                thumbnail_data = {}
                for shot_id, img_data in data['generated_images'].items():
                    if isinstance(img_data, dict) and 'images' in img_data:
                        # 只保留缩略图信息，不包含完整图片URL
                        thumbnail_images = []
                        for img in img_data['images']:
                            # 🔧 如果有缩略图但没有完整URL，标记为有完整图片（实际使用缩略图）
                            has_url = bool(img.get('url')) or bool(img.get('thumbnail'))
                            thumbnail_images.append({
                                'id': img.get('id'),
                                'thumbnail': img.get('thumbnail'),  # 只保留缩略图
                                'timestamp': img.get('timestamp'),
                                'hasFullImage': has_url  # 标记是否有原图
                            })
                        thumbnail_data[shot_id] = {
                            'images': thumbnail_images,
                            'selectedImageId': img_data.get('selectedImageId'),
                            'count': len(thumbnail_images)
                        }
                    elif isinstance(img_data, list):
                        # 兼容旧格式
                        thumbnail_images = []
                        for img in img_data:
                            has_url = bool(img.get('url')) or bool(img.get('thumbnail'))
                            thumbnail_images.append({
                                'id': img.get('id'),
                                'thumbnail': img.get('thumbnail'),
                                'timestamp': img.get('timestamp'),
                                'hasFullImage': has_url
                            })
                        thumbnail_data[shot_id] = thumbnail_images

                data['generated_images'] = thumbnail_data
                logger.info(f"✂️ 缩略图模式: 精简了 {len(thumbnail_data)} 个镜头的图片数据")

            # 🔍 调试：打印读取的数据
            logger.info(f"📦 项目数据keys: {list(data.keys())}")
            logger.info(f"📦 项目stage: {data.get('stage')}")

            video_tasks = data.get('video_tasks')
            if video_tasks and isinstance(video_tasks, list) and len(video_tasks) > 0:
                logger.info(f"📦 项目包含 {len(video_tasks)} 个视频任务")
                for task in video_tasks[:3]:
                    logger.info(f"   - 镜头: {task.get('storyboard_id')}, 图片: {task.get('image_url', '')[:50]}...")
            else:
                # 新项目没有视频任务是正常的
                logger.debug(f"📝 项目暂无视频任务（新项目或第一阶段）")

            if data.get('generated_images'):
                img_count = len(data['generated_images'])
                logger.info(f"🖼️ 项目包含 {img_count} 个镜头的生成图片")
                for shot_id, img_data in list(data['generated_images'].items())[:3]:
                    if isinstance(img_data, dict) and 'images' in img_data:
                        logger.debug(f"   - 镜头 {shot_id}: {len(img_data['images'])} 张图片")

            # 更新项目访问时间
            await ProjectDAO.update_project_access(project_id)

            return {"success": True, "project": data}
        except HTTPException:
            raise
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
            logger.info(f"🖼️ 按需加载镜头图片: 项目={project_id}, 镜头={shot_id}")

            # 从数据库读取项目
            db_project = await ProjectDAO.get_project(project_id)

            if not db_project:
                raise HTTPException(status_code=404, detail="项目不存在")

            if not await can_read_project(db_project, username):
                raise HTTPException(status_code=403, detail="无权访问此项目")

            # 从settings JSONB字段中获取项目数据
            data = parse_jsonb_field(db_project.get('settings'))

            # 🔧 防御性编程：确保data不为None
            if not data:
                logger.warning(f"⚠️ 项目 {project_id} 的settings为空")
                return {"success": True, "images": []}

            # 提取指定镜头的图片数据
            generated_images = data.get('generated_images')

            # 🔧 防御性编程：确保generated_images不为None
            if not generated_images or not isinstance(generated_images, dict):
                logger.warning(f"⚠️ 项目 {project_id} 的generated_images为空或格式错误")
                return {"success": True, "images": []}

            shot_data = generated_images.get(shot_id)

            if not shot_data:
                return {"success": True, "images": []}

            # 🔧 智能修复：如果只有缩略图没有完整URL，自动补全
            def fix_image_urls(images_list):
                """修复图片数据，确保每张图片都有url字段"""
                fixed_images = []
                for img in images_list:
                    if isinstance(img, dict):
                        # 如果有缩略图但没有完整图片URL，使用缩略图作为完整图片
                        if 'thumbnail' in img and not img.get('url'):
                            img['url'] = img['thumbnail']
                            logger.debug(f"🔧 补全缺失的URL: {img.get('id', 'unknown')}")
                        fixed_images.append(img)
                    else:
                        fixed_images.append(img)
                return fixed_images

            # 返回完整图片数据
            if isinstance(shot_data, dict) and 'images' in shot_data:
                fixed_images = fix_image_urls(shot_data['images'])
                logger.info(f"✅ 返回镜头 {shot_id} 的 {len(fixed_images)} 张完整图片")
                return {
                    "success": True,
                    "images": fixed_images,
                    "selectedImageId": shot_data.get('selectedImageId')
                }
            elif isinstance(shot_data, list):
                # 兼容旧格式
                fixed_images = fix_image_urls(shot_data)
                logger.info(f"✅ 返回镜头 {shot_id} 的 {len(fixed_images)} 张完整图片（旧格式）")
                return {
                    "success": True,
                    "images": fixed_images
                }

            return {"success": True, "images": []}

        except HTTPException:
            raise
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
            # 从数据库读取项目
            db_project = await ProjectDAO.get_project(project_id)

            if not db_project:
                raise HTTPException(status_code=404, detail="项目不存在")

            if db_project.get('user_id') != username:
                raise HTTPException(status_code=403, detail="无权访问此项目")

            # 获取或创建导出版本
            versions = await VersionDAO.get_project_versions(project_id)
            if versions:
                export_version = versions[0]  # 使用最新版本
                version_id = export_version['version_id']
                logger.info(f"📦 使用现有版本: {version_id}")
            else:
                # 创建新版本
                export_version = await VersionDAO.create_version(
                    project_id=project_id,
                    user_id=username,
                    version_name="导出版本",
                    description="画面分镜导出到视频生成"
                )
                version_id = export_version['version_id']
                logger.info(f"📦 创建新版本: {version_id}")

            # 从settings JSONB字段中获取完整的项目数据
            data = parse_jsonb_field(db_project.get('settings'))

            # 提取选中分镜的生成结果
            storyboard = data.get("storyboard", {})
            items = storyboard.get("items", [])
            generated_images_data = data.get("generated_images", {})  # 🔧 从正确的位置读取

            logger.info(f"📦 导出数据检查: storyboard有 {len(items)} 个镜头, generated_images有 {len(generated_images_data)} 个条目")

            video_tasks = []
            for item in items:
                if item.get("id") in request.selected_items:
                    item_id = item.get("id")

                    # 🔧 从 generated_images 对象中获取该镜头的图片数据
                    shot_images_data = generated_images_data.get(item_id, {})
                    generated_images = shot_images_data.get("images", [])
                    selected_image_id = shot_images_data.get("selectedImageId")

                    logger.info(f"📸 镜头 {item_id}: {len(generated_images)} 张图片, 选中ID: {selected_image_id}")

                    # 找到选中的图片
                    image_url = ""
                    selected_img = None
                    if selected_image_id and generated_images:
                        selected_img = next((img for img in generated_images if img.get("id") == selected_image_id), None)
                        if selected_img:
                            # 🔧 优先使用 url，如果没有则使用 thumbnail
                            image_url = selected_img.get("url") or selected_img.get("thumbnail") or ""
                            if image_url:
                                logger.info(f"✅ 找到选中图片: {image_url[:50]}...")
                            else:
                                logger.warning(f"⚠️ 选中的图片没有 url 或 thumbnail")

                    # 如果没找到，使用第一张图片
                    if not selected_img and generated_images:
                        selected_img = generated_images[0]
                        # 🔧 优先使用 url，如果没有则使用 thumbnail
                        image_url = selected_img.get("url") or selected_img.get("thumbnail") or ""
                        if image_url:
                            logger.info(f"⚠️ 未找到选中图片，使用第一张: {image_url[:50]}...")
                        else:
                            logger.warning(f"⚠️ 第一张图片也没有 url 或 thumbnail")

                    # 🔧 处理图片URL（如果有的话）
                    if image_url and is_data_image(image_url):
                        logger.info(f"🔄 检测到Base64图片，开始转换: {image_url[:50]}...")
                        try:
                            persisted = await persist_export_storyboard_base64_image(
                                username=username,
                                image_data=image_url,
                                storyboard_item=item,
                                version_id=version_id,
                                file_dao=FileDAO,
                                logger=logger,
                            )
                            # 使用数据库文件ID作为URL
                            image_url = persisted.file_url
                            logger.info(f"✅ Base64图片已保存到数据库, 文件ID: {persisted.file_id}")

                        except Exception as e:
                            logger.error(f"❌ Base64转换失败: {e}", exc_info=True)
                            # 继续使用原始Base64（作为fallback）
                            logger.warning(f"⚠️ 使用Base64作为fallback")
                    elif image_url:
                        logger.info(f"✅ 图片已是URL格式: {image_url[:100]}")
                    else:
                        logger.warning(f"⚠️ 镜头 {item_id} 没有图片")

                    # 🔍 调试：打印镜头的详细信息
                    logger.info(f"📝 镜头 {item_id} 详细信息:")
                    logger.info(f"   - image_url: {image_url[:50] if image_url else '(无)'}...")
                    logger.info(f"   - videoPrompt: {item.get('videoPrompt', '(无)')[:50] if item.get('videoPrompt') else '(无)'}...")
                    logger.info(f"   - dialogue: {item.get('dialogue', '(无)')[:30] if item.get('dialogue') else '(无)'}...")
                    logger.info(f"   - characters: {item.get('characters', [])}")
                    logger.info(f"   - scene: {item.get('scene', '(无)')}")

                    # 🔧 无论是否有图片都添加到video_tasks（至少导出提示词）
                    video_tasks.append({
                        "storyboard_id": item["id"],
                    "image_url": image_url or "",  # 可能为空
                        "video_prompt": item.get("videoPrompt", ""),
                        "dialogue": item.get("dialogue", ""),
                        "characters": item.get("characters", []),
                        "scene": item.get("scene", "")
                    })
                    logger.info(f"✅ 已添加镜头 {item_id} 到导出列表")

            # 更新项目数据
            data["video_tasks"] = video_tasks
            data["stage"] = 4
            data["updated_at"] = datetime.now().isoformat()

            # 保存到数据库
            await ProjectDAO.save_or_update_project(
                user_id=username,
                project_id=project_id,
                project_name=db_project.get('project_name', 'Untitled'),
                project_data=data,
                description=db_project.get('description', '')
            )

            logger.info(f"✅ 导出 {len(video_tasks)} 个分镜到视频生成（已保存到数据库）")

            return {
                "success": True,
                "exported_count": len(video_tasks),
                "video_tasks": video_tasks
            }
        except HTTPException:
            raise
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
            # 从数据库读取项目
            db_project = await ProjectDAO.get_project(project_id)

            if not db_project:
                raise HTTPException(status_code=404, detail="项目不存在")

            if db_project.get('user_id') != username:
                raise HTTPException(status_code=403, detail="无权访问此项目")

            # 从settings JSONB字段中获取完整的项目数据
            data = parse_jsonb_field(db_project.get('settings'))

            # 清除video_tasks
            if 'video_tasks' in data:
                cleared_count = len(data['video_tasks'])
                data['video_tasks'] = []

                # 保存到数据库
                await ProjectDAO.save_or_update_project(
                    user_id=username,
                    project_id=project_id,
                    project_name=db_project.get('project_name', 'Untitled'),
                    project_data=data,
                    description=db_project.get('description', '')
                )

                logger.info(f"✅ 已清除项目 {project_id} 的 {cleared_count} 个video_tasks（已保存到数据库）")

                return {
                    "success": True,
                    "cleared_count": cleared_count
                }

            return {
                "success": True,
                "cleared_count": 0
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"清除video_tasks失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
