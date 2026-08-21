# -*- coding: utf-8 -*-
"""
Media Library Service
======================
封装 media_library_items 的业务级 API：
- 从 files 记录创建素材库索引
- 列表 / 详情 / 更新 / 删除 / 引用记录

约定：
- 真实文件保存继续走 file_service.save_generated_file_to_db；本服务在文件保存成功后再创建索引。
- create_from_file 失败是 best-effort，不应使生成主流程报错。
- list_items 已在 DAO 层处理 project_members 可见性。

"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from dao_media_library import MediaLibraryDAO, MediaLibraryUsageDAO
from dao_content import ProjectMemberDAO

logger = logging.getLogger(__name__)


async def _resolve_project_id(project_id: Optional[str], episode_id: Optional[str]) -> Optional[str]:
    """如果 project_id 缺失但有 episode_id，则从 episodes 表反查。"""
    if project_id or not episode_id:
        return project_id
    try:
        from dao_episode import EpisodeDAO
        episode = await EpisodeDAO.get_episode(episode_id)
        if episode and episode.get('project_id'):
            return episode['project_id']
    except Exception as e:
        logger.debug(f"episode->project 反查失败 (episode_id={episode_id}): {e}")
    return None


# file_type (files.file_type) -> media_library_items.item_type
_FILE_TYPE_TO_ITEM_TYPE = {
    'image': 'image',
    'video': 'video',
    'audio': 'audio',
    'text':  'text',
    'json':  'other',
}


def _derive_item_type(file_record: Dict[str, Any], explicit: Optional[str] = None) -> str:
    if explicit:
        return explicit
    ft = (file_record or {}).get('file_type') or ''
    return _FILE_TYPE_TO_ITEM_TYPE.get(ft, 'other')


async def create_from_file(
    file_record: Dict[str, Any],
    source: str,
    *,
    project_id: Optional[str] = None,
    episode_id: Optional[str] = None,
    source_task_id: Optional[str] = None,
    item_type: Optional[str] = None,
    title: Optional[str] = None,
    description: str = "",
    tags: Optional[List[str]] = None,
    permission_scope: str = "private",
    source_entity_type: Optional[str] = None,
    source_entity_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    raise_on_error: bool = False,
    visibility: str = "private",
    folder_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    file_record 至少需要 {file_id, user_id, file_type}（save_generated_file_to_db 返回的 db_record）。
    幂等：若该 file_id 已有素材库记录，直接返回已有记录，不重复插入。
    """
    if not file_record:
        logger.warning("media_library.create_from_file: file_record 为空")
        return None

    file_id = file_record.get('file_id')
    user_id = file_record.get('user_id')
    if not file_id or not user_id:
        logger.warning(
            "media_library.create_from_file: 缺少 file_id 或 user_id, record=%s",
            {k: file_record.get(k) for k in ('file_id', 'user_id', 'file_type')},
        )
        return None

    try:
        existing = await MediaLibraryDAO.get_by_file_id(file_id)
        if existing:
            return existing

        item_type_final = _derive_item_type(file_record, item_type)
        # title fallback: file_name
        title_final = title or file_record.get('file_name') or ""

        # 若仅给了 episode_id，则尝试反查 project_id，方便项目页能看到
        project_id_final = await _resolve_project_id(project_id, episode_id)

        row = await MediaLibraryDAO.create(
            file_id=file_id,
            user_id=user_id,
            item_type=item_type_final,
            source=source,
            project_id=project_id_final,
            episode_id=episode_id,
            title=title_final,
            description=description,
            tags=tags or [],
            permission_scope=permission_scope,
            source_task_id=source_task_id,
            source_entity_type=source_entity_type,
            source_entity_id=source_entity_id,
            metadata=metadata or {},
            visibility=visibility,
            folder_id=folder_id,
        )
        logger.info(
            "media_library: 已为 file_id=%s 创建索引 library_item_id=%s source=%s scope=%s",
            file_id, row.get('library_item_id'), source, permission_scope,
        )
        return row
    except Exception as e:
        logger.warning(
            "media_library.create_from_file 失败 (file_id=%s, source=%s): %s",
            file_id, source, e,
        )
        if raise_on_error:
            raise
        return None


async def list_items(
    user_id: str,
    *,
    project_id: Optional[str] = None,
    episode_id: Optional[str] = None,
    item_type: Optional[str] = None,
    source: Optional[str] = None,
    permission_scope: Optional[str] = None,
    include_shared: bool = False,
    is_favorite: Optional[bool] = None,
    keyword: Optional[str] = None,
    tag: Optional[str] = None,
    folder_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    org_id: Optional[str] = None,
) -> Dict[str, Any]:
    """返回 {items, total}。

    org_id=None：旧行为（个人 workspace：own + project-scope shared）
    org_id=X：组织 workspace（own + share→org + project shared→org）
    """
    items = await MediaLibraryDAO.list_for_user(
        user_id=user_id,
        project_id=project_id,
        item_type=item_type,
        source=source,
        permission_scope=permission_scope,
        is_favorite=is_favorite,
        keyword=keyword,
        tag=tag,
        episode_id=episode_id,
        include_shared=include_shared,
        folder_id=folder_id,
        limit=limit,
        offset=offset,
        org_id=org_id,
    )
    total = await MediaLibraryDAO.count_for_user(
        user_id,
        project_id=project_id,
        item_type=item_type,
        source=source,
        permission_scope=permission_scope,
        is_favorite=is_favorite,
        keyword=keyword,
        tag=tag,
        episode_id=episode_id,
        include_shared=include_shared,
        folder_id=folder_id,
        org_id=org_id,
    )
    return {'items': items, 'total': total, 'limit': limit, 'offset': offset}


async def get_item(library_item_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """获取单条素材；自动做权限检查（owner 或 项目内成员且 scope=project）。"""
    item = await MediaLibraryDAO.get(library_item_id)
    if not item:
        return None
    if not await can_view(item, user_id):
        return None
    return item


async def can_view(item: Dict[str, Any], user_id: str) -> bool:
    if item.get('user_id') == user_id:
        return True
    scope = item.get('permission_scope')
    if scope == 'public_link':
        return True
    if scope == 'project' and item.get('project_id'):
        return await ProjectMemberDAO.check_permission(
            item['project_id'], user_id, required_role='readonly',
        )
    return False


async def can_mutate(item: Dict[str, Any], user_id: str) -> bool:
    """可改 / 可删：owner、或同项目内 owner/admin/member（不含 readonly）。"""
    if item.get('user_id') == user_id:
        return True
    if item.get('project_id'):
        return await ProjectMemberDAO.check_permission(
            item['project_id'], user_id, required_role='member',
        )
    return False


async def update_item(
    library_item_id: str,
    user_id: str,
    fields: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    item = await MediaLibraryDAO.get(library_item_id)
    if not item:
        return None
    if not await can_mutate(item, user_id):
        raise PermissionError("无权限修改该素材")
    return await MediaLibraryDAO.update(library_item_id, fields)


async def soft_delete_item(
    library_item_id: str,
    user_id: str,
    reason: Optional[str] = None,
) -> bool:
    item = await MediaLibraryDAO.get(library_item_id)
    if not item:
        return False
    if not await can_mutate(item, user_id):
        raise PermissionError("无权限删除该素材")
    await MediaLibraryDAO.soft_delete(library_item_id, deleted_by=user_id, deleted_reason=reason)
    return True


async def record_usage(
    library_item_id: str,
    user_id: str,
    usage_context: str,
    *,
    project_id: Optional[str] = None,
    task_id: Optional[str] = None,
    target_entity_type: Optional[str] = None,
    target_entity_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """写入引用记录 + 自增 use_count。会做可见性检查。"""
    item = await MediaLibraryDAO.get(library_item_id)
    if not item:
        return None
    if not await can_view(item, user_id):
        raise PermissionError("无权限使用该素材")
    usage = await MediaLibraryUsageDAO.record(
        library_item_id=library_item_id,
        file_id=item['file_id'],
        user_id=user_id,
        usage_context=usage_context,
        project_id=project_id or item.get('project_id'),
        task_id=task_id,
        target_entity_type=target_entity_type,
        target_entity_id=target_entity_id,
    )
    await MediaLibraryDAO.increment_use_count(library_item_id)
    return usage
