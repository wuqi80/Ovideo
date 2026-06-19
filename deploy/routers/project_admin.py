# -*- coding: utf-8 -*-
"""Project settings and membership route handlers."""

import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


def create_project_admin_router(
    *,
    get_current_user_dependency: Any,
    user_dao: Any,
    project_dao: Any,
    project_member_dao: Any,
    get_db_manager_func: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    UserDAO = user_dao
    ProjectDAO = project_dao
    ProjectMemberDAO = project_member_dao

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

    @router.put("/api/projects/{project_id}")
    async def update_project(
        project_id: str,
        data: ProjectUpdate,
        user_id: str = Depends(get_current_user)
    ):
        """鏇存柊椤圭洰淇℃伅锛堝悕绉?鎻忚堪/灏侀潰/鏍囩锛?"""
        try:
            has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
            if not has_perm:
                raise HTTPException(status_code=403, detail="闇€瑕佺鐞嗗憳鏉冮檺")

            db = get_db_manager_func()
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
                sets.append(f"tags = ${idx}::jsonb")
                vals.append(json.dumps(data.tags, ensure_ascii=False))
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
                raise HTTPException(status_code=403, detail="闇€瑕佺鐞嗗憳鏉冮檺")
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
                raise HTTPException(status_code=403, detail="闇€瑕佺鐞嗗憳鏉冮檺")
            await ProjectDAO.unarchive_project(project_id, user_id)
            return {"success": True}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/projects/{project_id}/members")
    async def get_members(
        project_id: str,
        user_id: str = Depends(get_current_user)
    ):
        """鑾峰彇椤圭洰鎴愬憳鍒楄〃"""
        try:
            has_access = await ProjectMemberDAO.check_permission(project_id, user_id, 'readonly')
            if not has_access:
                raise HTTPException(status_code=403, detail="鏃犳潈璁块棶")
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
        """娣诲姞椤圭洰鎴愬憳"""
        try:
            has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
            if not has_perm:
                raise HTTPException(status_code=403, detail="闇€瑕佺鐞嗗憳鏉冮檺")

            target_user = await UserDAO.get_user_by_id(data.user_id)
            if not target_user:
                raise HTTPException(status_code=404, detail="鐢ㄦ埛涓嶅瓨鍦?")

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
        """鏇存柊鎴愬憳瑙掕壊/鑱岃矗"""
        try:
            has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
            if not has_perm:
                raise HTTPException(status_code=403, detail="闇€瑕佺鐞嗗憳鏉冮檺")

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
        """绉婚櫎椤圭洰鎴愬憳"""
        try:
            has_perm = await ProjectMemberDAO.check_permission(project_id, user_id, 'admin')
            if not has_perm:
                raise HTTPException(status_code=403, detail="闇€瑕佺鐞嗗憳鏉冮檺")

            member = await ProjectMemberDAO.get_member(project_id, member_user_id)
            if member and member['role'] == 'owner':
                raise HTTPException(status_code=400, detail="涓嶈兘绉婚櫎椤圭洰鎷ユ湁鑰?")

            await ProjectMemberDAO.remove_member(project_id, member_user_id)
            return {"success": True}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return router
