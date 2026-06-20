# -*- coding: utf-8 -*-
"""DAO-backed project create/list/detail routes."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


class ProjectCreate(BaseModel):
    project_name: str
    description: Optional[str] = ""
    visibility: Optional[str] = "private"


def create_project_core_router(
    *,
    get_current_user_dependency: Any,
    project_dao: Any,
    version_dao: Any,
    project_member_dao: Any,
    user_dao: Any,
    activity_log_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    ProjectDAO = project_dao
    VersionDAO = version_dao
    ProjectMemberDAO = project_member_dao
    UserDAO = user_dao
    ActivityLogDAO = activity_log_dao

    @router.post("/api/projects")
    async def create_project(
        project_data: ProjectCreate,
        user_id: str = Depends(get_current_user)
    ):
        """Create a new DAO-backed project."""
        try:
            project = await ProjectDAO.create_project(
                user_id=user_id,
                project_name=project_data.project_name,
                description=project_data.description,
                visibility=project_data.visibility or 'private',
            )

            version = await VersionDAO.create_version(
                project_id=project['project_id'],
                user_id=user_id,
                version_name="初始版本",
                description="项目创建时的初始版本"
            )

            await ProjectMemberDAO.add_member(
                project_id=project['project_id'],
                user_id=user_id,
                role='owner'
            )

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
        """List all projects available to the current user."""
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
        """Return a DAO-backed project detail payload."""
        try:
            project = await ProjectDAO.get_project(project_id)
            if not project:
                raise HTTPException(status_code=404, detail="项目不存在")

            has_access = (
                project.get('user_id') == user_id
                or await ProjectMemberDAO.check_permission(project_id, user_id, 'readonly')
                or await UserDAO.is_admin_user(user_id)
            )
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

    return router
