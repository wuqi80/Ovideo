# -*- coding: utf-8 -*-
"""
文件和版本数据访问对象 (DAO)
"""
import uuid
import json
from typing import Optional, List, Dict, Any
from datetime import datetime
from db_manager import get_db_manager

class ProjectDAO:
    """项目数据访问对象"""
    
    @staticmethod
    async def create_project(
        user_id: str,
        project_name: str,
        description: str = "",
        visibility: str = "private",
    ) -> Dict[str, Any]:
        """创建新项目

        2026-05-26 组织管理 MVP — Slice 5: 创建时支持指定 visibility
        ('private' | 'org-default'). visibility 仅用于 UI badge 显示，
        真实可见性判断仍走 resource_shares 表（调用方负责落 share）。
        """
        db = get_db_manager()
        project_id = f"proj_{uuid.uuid4().hex[:12]}"
        # 兜底校验，防呆
        if visibility not in ('private', 'org-default'):
            visibility = 'private'
        query = """
            INSERT INTO projects (project_id, user_id, project_name, description, visibility)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, project_id, project_name, description, visibility, created_at
        """
        return await db.fetchrow(query, project_id, user_id, project_name, description, visibility)
    
    @staticmethod
    async def get_user_projects(user_id: str, include_archived: bool = False) -> List[Dict[str, Any]]:
        """获取用户的所有项目（不返回 settings 大字段以减少传输量）"""
        db = get_db_manager()
        # episode_count：每个项目的集数。前端用它区分"空项目"和"有内容的项目"，
        # 并在删除确认里显示，避免误删有内容的项目（identical 命名时尤其重要）。
        columns = ("p.id, p.project_id, p.user_id, p.project_name, p.description, "
                   "p.created_at, p.updated_at, p.last_accessed_at, p.is_archived, "
                   "(SELECT COUNT(*) FROM episodes e WHERE e.project_id = p.project_id) AS episode_count")
        archived_filter = "" if include_archived else "AND p.is_archived = FALSE"
        query = f"""
            SELECT {columns} FROM projects p
            WHERE p.user_id = $1 AND p.is_deleted IS NOT TRUE {archived_filter}
            ORDER BY p.last_accessed_at DESC NULLS LAST, p.created_at DESC
        """
        return await db.fetch(query, user_id)

    @staticmethod
    async def get_projects_for_org(
        user_id: str,
        org_id: str,
        include_archived: bool = False,
    ) -> List[Dict[str, Any]]:
        """组织 workspace 视图：返回该用户在 org_id 下能看到的所有项目。

        可见 = 是 owner / 项目被直接 share 给 org / 项目所在 group 被 share 给 org / group 直接 belongs to org。
        权限前提（user 是否 org_id 成员）由调用方校验。

        2026-05-26 组织管理 MVP — Slice 3
        详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5.4
        """
        db = get_db_manager()
        columns = ("p.id, p.project_id, p.user_id, p.project_name, p.description, "
                   "p.created_at, p.updated_at, p.last_accessed_at, p.is_archived, "
                   "p.group_id, p.visibility")
        archived_clause = "" if include_archived else "p.is_archived = FALSE AND"
        query = f"""
            SELECT DISTINCT {columns}
            FROM projects p
            WHERE {archived_clause}
                  (
                    p.user_id = $1
                    OR p.project_id IN (
                        SELECT resource_id FROM resource_shares
                        WHERE resource_type='project'
                          AND share_target_type='org' AND share_target_id=$2
                    )
                    OR p.group_id IN (
                        SELECT group_id FROM project_groups
                        WHERE organization_id=$2
                    )
                    OR p.group_id IN (
                        SELECT resource_id FROM resource_shares
                        WHERE resource_type='group'
                          AND share_target_type='org' AND share_target_id=$2
                    )
                  )
            ORDER BY p.last_accessed_at DESC NULLS LAST, p.created_at DESC
        """
        return await db.fetch(query, user_id, org_id)
    
    @staticmethod
    async def get_project(project_id: str) -> Optional[Dict[str, Any]]:
        """获取项目详情"""
        db = get_db_manager()
        query = "SELECT * FROM projects WHERE project_id = $1"
        return await db.fetchrow(query, project_id)
    
    @staticmethod
    async def update_project_access(project_id: str):
        """更新项目访问时间"""
        db = get_db_manager()
        query = """
            UPDATE projects
            SET last_accessed_at = CURRENT_TIMESTAMP
            WHERE project_id = $1
        """
        await db.execute(query, project_id)
    
    @staticmethod
    async def save_or_update_project(
        user_id: str,
        project_id: str,
        project_name: str,
        project_data: Dict[str, Any],
        description: str = ""
    ) -> Dict[str, Any]:
        """保存或更新完整的项目数据（使用JSONB存储）"""
        db = get_db_manager()
        
        # 将 Python dict 转换为 JSON 字符串（asyncpg 需要）
        project_data_json = json.dumps(project_data, ensure_ascii=False)
        
        # 检查项目是否存在
        existing = await db.fetchrow(
            "SELECT id FROM projects WHERE project_id = $1",
            project_id
        )
        
        if existing:
            # 更新现有项目
            query = """
                UPDATE projects
                SET project_name = $1,
                    description = $2,
                    settings = $3::jsonb,
                    last_accessed_at = CURRENT_TIMESTAMP
                WHERE project_id = $4 AND user_id = $5
                RETURNING *
            """
            return await db.fetchrow(
                query, project_name, description, project_data_json, project_id, user_id
            )
        else:
            # 创建新项目
            query = """
                INSERT INTO projects (project_id, user_id, project_name, description, settings)
                VALUES ($1, $2, $3, $4, $5::jsonb)
                RETURNING *
            """
            result = await db.fetchrow(
                query, project_id, user_id, project_name, description, project_data_json
            )
            await db.execute(
                """INSERT INTO project_members (project_id, user_id, role)
                   VALUES ($1, $2, 'owner')
                   ON CONFLICT (project_id, user_id) DO NOTHING""",
                project_id, user_id
            )
            return result
    
    @staticmethod
    async def delete_project(project_id: str, user_id: str):
        """软删除项目：仅标记 is_deleted=TRUE，保留所有版本/集/分镜/视频段/文件，可恢复。

        2026-06-15：原实现硬删除项目并级联删除集/分镜/视频段（不可恢复），曾导致用户
        误删后真实项目内容全丢。改为软删除——列表过滤掉已删项目，但数据完整保留，
        可随时 restore_project 恢复。
        """
        db = get_db_manager()
        await db.execute("""
            UPDATE projects
            SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
            WHERE project_id = $1 AND user_id = $2
        """, project_id, user_id)

    @staticmethod
    async def restore_project(project_id: str, user_id: str):
        """恢复软删除的项目。"""
        db = get_db_manager()
        await db.execute("""
            UPDATE projects
            SET is_deleted = FALSE, deleted_at = NULL
            WHERE project_id = $1 AND user_id = $2
        """, project_id, user_id)

    @staticmethod
    async def archive_project(project_id: str, user_id: str):
        """归档项目"""
        db = get_db_manager()
        query = """
            UPDATE projects
            SET is_archived = TRUE
            WHERE project_id = $1 AND user_id = $2
        """
        await db.execute(query, project_id, user_id)

    @staticmethod
    async def unarchive_project(project_id: str, user_id: str):
        db = get_db_manager()
        await db.execute(
            "UPDATE projects SET is_archived = FALSE WHERE project_id = $1 AND user_id = $2",
            project_id, user_id
        )

class VersionDAO:
    """版本数据访问对象"""
    
    @staticmethod
    async def create_version(
        project_id: str, 
        user_id: str, 
        version_name: str = "",
        description: str = "",
        parent_version_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """创建新版本"""
        db = get_db_manager()
        version_id = f"ver_{uuid.uuid4().hex[:12]}"
        
        # 获取下一个版本号
        version_number = await db.fetchval("""
            SELECT COALESCE(MAX(version_number), 0) + 1
            FROM versions
            WHERE project_id = $1
        """, project_id)
        
        # 取消当前版本标记
        await db.execute("""
            UPDATE versions
            SET is_current = FALSE
            WHERE project_id = $1
        """, project_id)
        
        # 创建新版本
        query = """
            INSERT INTO versions (
                version_id, project_id, user_id, version_number,
                version_name, description, parent_version_id, is_current
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
            RETURNING *
        """
        return await db.fetchrow(
            query, version_id, project_id, user_id, version_number,
            version_name, description, parent_version_id
        )
    
    @staticmethod
    async def get_project_versions(project_id: str) -> List[Dict[str, Any]]:
        """获取项目的所有版本"""
        db = get_db_manager()
        query = """
            SELECT v.*, 
                   COUNT(f.file_id) as file_count,
                   COUNT(tc.content_id) as text_count
            FROM versions v
            LEFT JOIN files f ON v.version_id = f.version_id AND f.is_deleted = FALSE
            LEFT JOIN text_contents tc ON v.version_id = tc.version_id AND tc.is_deleted = FALSE
            WHERE v.project_id = $1
            GROUP BY v.id
            ORDER BY v.version_number DESC
        """
        return await db.fetch(query, project_id)
    
    @staticmethod
    async def get_version(version_id: str) -> Optional[Dict[str, Any]]:
        """获取版本详情"""
        db = get_db_manager()
        query = "SELECT * FROM versions WHERE version_id = $1"
        return await db.fetchrow(query, version_id)
    
    @staticmethod
    async def get_current_version(project_id: str) -> Optional[Dict[str, Any]]:
        """获取项目当前版本"""
        db = get_db_manager()
        query = """
            SELECT * FROM versions
            WHERE project_id = $1 AND is_current = TRUE
            LIMIT 1
        """
        return await db.fetchrow(query, project_id)
    
    @staticmethod
    async def set_current_version(version_id: str):
        """设置当前版本"""
        db = get_db_manager()
        
        # 获取项目ID
        project_id = await db.fetchval(
            "SELECT project_id FROM versions WHERE version_id = $1",
            version_id
        )
        
        # 取消所有版本的is_current
        await db.execute(
            "UPDATE versions SET is_current = FALSE WHERE project_id = $1",
            project_id
        )
        
        # 设置新的当前版本
        await db.execute(
            "UPDATE versions SET is_current = TRUE WHERE version_id = $1",
            version_id
        )
    
    @staticmethod
    async def delete_version(version_id: str):
        """删除版本(级联删除相关文件和文本)"""
        db = get_db_manager()
        
        # 软删除相关文件
        await db.execute("""
            UPDATE files
            SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
            WHERE version_id = $1
        """, version_id)
        
        # 软删除相关文本
        await db.execute("""
            UPDATE text_contents
            SET is_deleted = TRUE
            WHERE version_id = $1
        """, version_id)
        
        # 删除版本记录
        await db.execute("DELETE FROM versions WHERE version_id = $1", version_id)

class FileDAO:
    """文件数据访问对象"""
    
    @staticmethod
    async def create_file(
        version_id: str,
        user_id: str,
        file_type: str,
        file_name: str,
        file_path: str,
        file_url: str,
        file_size_bytes: int,
        mime_type: str = "",
        metadata: Dict = None,
        file_id: str = None,
        entity_type: str = None,
        entity_id: str = None,
        file_role: str = None,
        is_selected: bool = False,
    ) -> Dict[str, Any]:
        """创建文件记录"""
        db = get_db_manager()
        
        if not file_id:
            file_id = f"file_{uuid.uuid4().hex[:12]}"
        
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
        
        query = """
            INSERT INTO files (
                file_id, version_id, user_id, file_type, file_name,
                file_path, file_url, file_size_bytes, mime_type, metadata,
                entity_type, entity_id, file_role, is_selected
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                    $11, $12, $13, $14)
            RETURNING *
        """
        return await db.fetchrow(
            query, file_id, version_id, user_id, file_type, file_name,
            file_path, file_url, file_size_bytes, mime_type, metadata_json,
            entity_type, entity_id, file_role, is_selected,
        )
    
    @staticmethod
    async def get_version_files(version_id: str, file_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取版本的所有文件"""
        db = get_db_manager()
        
        if file_type:
            query = """
                SELECT * FROM files
                WHERE version_id = $1 AND file_type = $2 AND is_deleted = FALSE
                ORDER BY created_at DESC
            """
            return await db.fetch(query, version_id, file_type)
        else:
            query = """
                SELECT * FROM files
                WHERE version_id = $1 AND is_deleted = FALSE
                ORDER BY created_at DESC
            """
            return await db.fetch(query, version_id)
    
    @staticmethod
    async def get_file(file_id: str) -> Optional[Dict[str, Any]]:
        """获取文件详情"""
        db = get_db_manager()
        query = "SELECT * FROM files WHERE file_id = $1 AND is_deleted = FALSE"
        return await db.fetchrow(query, file_id)
    
    @staticmethod
    async def get_file_by_name(file_name: str) -> Optional[Dict[str, Any]]:
        """根据文件名查找最近上传的文件"""
        db = get_db_manager()
        query = """
            SELECT * FROM files 
            WHERE file_name = $1 AND is_deleted = FALSE
            ORDER BY created_at DESC
            LIMIT 1
        """
        return await db.fetchrow(query, file_name)
    
    @staticmethod
    async def get_file_by_url(url: str) -> Optional[Dict[str, Any]]:
        """按 file_url 反查文件，忽略 scheme/host 与 ?token=... 查询串。

        用途：把分镜 generated_image_url（带 token 的 /storage 预览 URL）还原成
        本地文件，供 DashScope worker 转 Base64（DashScope 服务端无法 fetch token URL）。
        files.file_url 存为相对路径（如 /storage/...），故只比较 path。
        """
        if not url:
            return None
        from urllib.parse import urlparse
        # urlparse 对绝对/相对 URL 都能取出 path；fallback 兜底去掉 query
        path = urlparse(url).path or url.split('?', 1)[0]
        db = get_db_manager()
        query = """
            SELECT * FROM files
            WHERE split_part(file_url, '?', 1) = $1 AND is_deleted = FALSE
            ORDER BY created_at DESC
            LIMIT 1
        """
        return await db.fetchrow(query, path)
    
    @staticmethod
    async def get_recent_files(limit: int = 500) -> List[Dict[str, Any]]:
        """获取最近的文件记录（用于健康检查）"""
        db = get_db_manager()
        query = """
            SELECT file_id, file_path, file_url, file_type, created_at
            FROM files WHERE is_deleted = FALSE
            ORDER BY created_at DESC LIMIT $1
        """
        return await db.fetch(query, limit)
    
    @staticmethod
    async def delete_file(file_id: str):
        """软删除文件"""
        db = get_db_manager()
        query = """
            UPDATE files
            SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
            WHERE file_id = $1
        """
        await db.execute(query, file_id)

    @staticmethod
    async def soft_delete_user_files_by_path_fragment(user_id: str, path_fragment: str) -> int:
        """Soft-delete a user's file records whose stored path contains a generated file path."""
        if not path_fragment:
            return 0
        db = get_db_manager()
        result = await db.execute(
            """
            UPDATE files
            SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
              AND file_path LIKE $2
              AND is_deleted = FALSE
            """,
            user_id,
            f"%{path_fragment}%",
        )
        try:
            return int(str(result).split()[-1])
        except (IndexError, TypeError, ValueError):
            return 0
    
    @staticmethod
    async def permanently_delete_file(file_id: str):
        """永久删除文件"""
        db = get_db_manager()
        await db.execute("DELETE FROM files WHERE file_id = $1", file_id)
    
    @staticmethod
    async def get_user_files(
        user_id: str,
        file_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """获取用户的所有文件"""
        db = get_db_manager()
        
        if file_type:
            query = """
                SELECT * FROM files
                WHERE user_id = $1 AND file_type = $2 AND is_deleted = FALSE
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
            """
            return await db.fetch(query, user_id, file_type, limit, offset)
        else:
            query = """
                SELECT * FROM files
                WHERE user_id = $1 AND is_deleted = FALSE
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
            """
            return await db.fetch(query, user_id, limit, offset)

class WorkspaceSessionDAO:
    """Workspace会话数据访问对象"""
    
    @staticmethod
    def _config_key(user_id: str, scope: str = "") -> str:
        if scope:
            return f"workspace_session_{user_id}_{scope}"
        return f"workspace_session_{user_id}"
    
    @staticmethod
    async def save_session(user_id: str, session_data: Dict[str, Any], scope: str = ""):
        """保存workspace会话数据到system_configs表"""
        db = get_db_manager()
        config_key = WorkspaceSessionDAO._config_key(user_id, scope)
        
        session_data_json = json.dumps(session_data, ensure_ascii=False)
        
        query = """
            INSERT INTO system_configs (config_key, config_value, description)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (config_key)
            DO UPDATE SET config_value = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        """
        await db.execute(
            query, 
            config_key, 
            session_data_json,
            f"Workspace session for user {user_id} scope {scope}" if scope else f"Workspace session for user {user_id}"
        )
    
    @staticmethod
    async def load_session(user_id: str, scope: str = "") -> Optional[Dict[str, Any]]:
        """加载workspace会话数据"""
        db = get_db_manager()
        config_key = WorkspaceSessionDAO._config_key(user_id, scope)
        
        query = "SELECT config_value FROM system_configs WHERE config_key = $1"
        result = await db.fetchrow(query, config_key)
        
        if result:
            config_value = result.get('config_value')
            if isinstance(config_value, str):
                return json.loads(config_value)
            return config_value
        return None
    
    @staticmethod
    async def delete_session(user_id: str, scope: str = ""):
        """删除workspace会话数据"""
        db = get_db_manager()
        config_key = WorkspaceSessionDAO._config_key(user_id, scope)
        
        query = "DELETE FROM system_configs WHERE config_key = $1"
        await db.execute(query, config_key)

class PromptTemplateDAO:
    """提示词模板数据访问对象"""
    
    @staticmethod
    async def save_template(user_id: str, template_type: str, content: str):
        """保存用户的自定义提示词模板"""
        db = get_db_manager()
        config_key = f"prompt_template_{user_id}_{template_type}"
        
        # 将 Python dict 转换为 JSON 字符串
        content_json = json.dumps({"content": content}, ensure_ascii=False)
        
        # 使用UPSERT（INSERT ... ON CONFLICT UPDATE）
        query = """
            INSERT INTO system_configs (config_key, config_value, description)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (config_key)
            DO UPDATE SET config_value = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        """
        await db.execute(
            query, 
            config_key, 
            content_json,
            f"Prompt template {template_type} for user {user_id}"
        )
    
    @staticmethod
    async def load_template(user_id: str, template_type: str) -> Optional[str]:
        """加载用户的自定义提示词模板"""
        db = get_db_manager()
        config_key = f"prompt_template_{user_id}_{template_type}"
        
        query = "SELECT config_value FROM system_configs WHERE config_key = $1"
        result = await db.fetchrow(query, config_key)
        
        if result:
            config_value = result.get('config_value')
            if isinstance(config_value, dict):
                return config_value.get('content')
            return None
        return None
    
    @staticmethod
    async def delete_template(user_id: str, template_type: str):
        """删除用户的自定义提示词模板"""
        db = get_db_manager()
        config_key = f"prompt_template_{user_id}_{template_type}"
        
        query = "DELETE FROM system_configs WHERE config_key = $1"
        await db.execute(query, config_key)

class ProjectMemberDAO:
    """项目成员数据访问对象"""
    
    @staticmethod
    async def add_member(
        project_id: str, user_id: str,
        role: str = 'member', responsibility: str = 'all'
    ) -> Dict[str, Any]:
        db = get_db_manager()
        query = """
            INSERT INTO project_members (project_id, user_id, role, responsibility)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (project_id, user_id) DO UPDATE
              SET role = $3, responsibility = $4, updated_at = CURRENT_TIMESTAMP
            RETURNING *
        """
        return await db.fetchrow(query, project_id, user_id, role, responsibility)
    
    @staticmethod
    async def remove_member(project_id: str, user_id: str):
        db = get_db_manager()
        await db.execute(
            "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
            project_id, user_id
        )
    
    @staticmethod
    async def update_member_role(project_id: str, user_id: str, role: str):
        db = get_db_manager()
        await db.execute("""
            UPDATE project_members SET role = $3, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = $1 AND user_id = $2
        """, project_id, user_id, role)
    
    @staticmethod
    async def update_member_responsibility(project_id: str, user_id: str, responsibility: str):
        db = get_db_manager()
        await db.execute("""
            UPDATE project_members SET responsibility = $3, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = $1 AND user_id = $2
        """, project_id, user_id, responsibility)
    
    @staticmethod
    async def get_project_members(project_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        query = """
            SELECT pm.*, u.username, u.avatar_url, u.email
            FROM project_members pm
            JOIN users u ON pm.user_id = u.user_id
            WHERE pm.project_id = $1
            ORDER BY
              CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
              pm.joined_at
        """
        return await db.fetch(query, project_id)
    
    @staticmethod
    async def get_member(project_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        query = """
            SELECT pm.*, u.username, u.avatar_url
            FROM project_members pm
            JOIN users u ON pm.user_id = u.user_id
            WHERE pm.project_id = $1 AND pm.user_id = $2
        """
        return await db.fetchrow(query, project_id, user_id)
    
    @staticmethod
    async def check_permission(project_id: str, user_id: str, required_role: str = 'readonly') -> bool:
        """检查用户是否有项目权限，role 权重: owner > admin > member > readonly"""
        role_weight = {'owner': 4, 'admin': 3, 'member': 2, 'readonly': 1}
        member = await ProjectMemberDAO.get_member(project_id, user_id)
        if not member:
            return False
        return role_weight.get(member['role'], 0) >= role_weight.get(required_role, 0)
    
    @staticmethod
    async def get_user_accessible_projects(user_id: str, include_archived: bool = False) -> List[Dict[str, Any]]:
        """获取用户可访问的所有项目（自己拥有的 + 被邀请加入的）"""
        db = get_db_manager()
        archive_filter = "" if include_archived else "AND p.is_archived = FALSE"
        query = f"""
            SELECT DISTINCT
                   p.id, p.project_id, p.user_id, p.project_name, p.description,
                   p.created_at, p.updated_at, p.last_accessed_at, p.is_archived,
                   pm.role as member_role, pm.responsibility,
                   u.username as owner_name,
                   (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.project_id) as member_count,
                   (SELECT COUNT(*) FROM episodes e WHERE e.project_id = p.project_id) as episode_count
            FROM projects p
            JOIN project_members pm ON p.project_id = pm.project_id AND pm.user_id = $1
            JOIN users u ON p.user_id = u.user_id
            WHERE p.is_deleted IS NOT TRUE {archive_filter}
            ORDER BY p.last_accessed_at DESC NULLS LAST, p.updated_at DESC
        """
        return await db.fetch(query, user_id)

    @staticmethod
    async def get_org_accessible_projects(
        user_id: str,
        org_id: str,
        include_archived: bool = False,
    ) -> List[Dict[str, Any]]:
        """组织 workspace 视图（`/api/projects?org_id=X`）。

        可见 = owner OR project_members 内有我 OR 项目被 share→org OR 分组属于该 org OR 分组被 share→org。
        权限前提（user ∈ org X members）由调用方校验。

        2026-05-26 组织管理 MVP — Slice 3
        """
        db = get_db_manager()
        archive_filter = "" if include_archived else "AND p.is_archived = FALSE"
        query = f"""
            SELECT DISTINCT
                   p.id, p.project_id, p.user_id, p.project_name, p.description,
                   p.created_at, p.updated_at, p.last_accessed_at, p.is_archived,
                   p.group_id, p.visibility,
                   COALESCE(pm.role, 'member')      AS member_role,
                   COALESCE(pm.responsibility, '') AS responsibility,
                   u.username as owner_name,
                   (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.project_id) AS member_count
            FROM projects p
            LEFT JOIN project_members pm ON pm.project_id = p.project_id AND pm.user_id = $1
            LEFT JOIN users u ON p.user_id = u.user_id
            WHERE 1=1 {archive_filter}
              AND (
                p.user_id = $1
                OR pm.user_id = $1
                OR p.project_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='project'
                      AND share_target_type='org' AND share_target_id=$2
                )
                OR p.group_id IN (
                    SELECT group_id FROM project_groups WHERE organization_id=$2
                )
                OR p.group_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='group'
                      AND share_target_type='org' AND share_target_id=$2
                )
              )
            ORDER BY p.last_accessed_at DESC NULLS LAST, p.updated_at DESC
        """
        return await db.fetch(query, user_id, org_id)


class TextContentDAO:
    """文本内容数据访问对象"""
    
    @staticmethod
    async def create_text_content(
        version_id: str,
        user_id: str,
        content_type: str,
        content: str,
        title: str = "",
        metadata: Dict = None
    ) -> Dict[str, Any]:
        """创建文本内容"""
        db = get_db_manager()
        content_id = f"text_{uuid.uuid4().hex[:12]}"
        word_count = len(content)
        
        # 将 metadata 转换为 JSON 字符串
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
        
        query = """
            INSERT INTO text_contents (
                content_id, version_id, user_id, content_type,
                title, content, word_count, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            RETURNING *
        """
        return await db.fetchrow(
            query, content_id, version_id, user_id, content_type,
            title, content, word_count, metadata_json
        )
    
    @staticmethod
    async def get_version_texts(version_id: str) -> List[Dict[str, Any]]:
        """获取版本的所有文本"""
        db = get_db_manager()
        query = """
            SELECT * FROM text_contents
            WHERE version_id = $1 AND is_deleted = FALSE
            ORDER BY created_at DESC
        """
        return await db.fetch(query, version_id)
    
    @staticmethod
    async def get_text_content(content_id: str) -> Optional[Dict[str, Any]]:
        """获取文本详情"""
        db = get_db_manager()
        query = "SELECT * FROM text_contents WHERE content_id = $1 AND is_deleted = FALSE"
        return await db.fetchrow(query, content_id)
    
    @staticmethod
    async def update_text_content(content_id: str, content: str, title: str = None):
        """更新文本内容"""
        db = get_db_manager()
        word_count = len(content)
        
        if title:
            query = """
                UPDATE text_contents
                SET content = $1, title = $2, word_count = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE content_id = $4
            """
            await db.execute(query, content, title, word_count, content_id)
        else:
            query = """
                UPDATE text_contents
                SET content = $1, word_count = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE content_id = $3
            """
            await db.execute(query, content, word_count, content_id)
    
    @staticmethod
    async def delete_text_content(content_id: str):
        """软删除文本"""
        db = get_db_manager()
        query = """
            UPDATE text_contents
            SET is_deleted = TRUE
            WHERE content_id = $1
        """
        await db.execute(query, content_id)
