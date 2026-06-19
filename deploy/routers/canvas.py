# -*- coding: utf-8 -*-
"""Canvas board, node, and connection route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


def create_canvas_router(
    *,
    get_current_user_dependency: Any,
    project_member_dao: Any,
    canvas_board_dao: Any,
    canvas_node_dao: Any,
    canvas_connection_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    ProjectMemberDAO = project_member_dao
    CanvasBoardDAO = canvas_board_dao
    CanvasNodeDAO = canvas_node_dao
    CanvasConnectionDAO = canvas_connection_dao

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


    return router
