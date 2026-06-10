# -*- coding: utf-8 -*-
"""
Workflow template DAO -- workflow_templates 表的增删改查
"""
import json
import re
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

_PLACEHOLDER_RE = re.compile(r"^\{.+\}$")


class WorkflowTemplateDAO:
    """workflow_templates CRUD 与 ComfyUI workflow 占位符解析"""

    @staticmethod
    async def create(
        name: str,
        category: str,
        workflow_json: dict,
        placeholders: Optional[list] = None,
        description: str = "",
        node_type: str = "any",
        estimated_time: int = 30,
        workflow_key: str = "",
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        template_id = f"wft_{uuid.uuid4().hex[:12]}"
        wf_s = json.dumps(workflow_json, ensure_ascii=False)
        ph = placeholders if placeholders is not None else []
        ph_s = json.dumps(ph, ensure_ascii=False)
        query = """
            INSERT INTO workflow_templates (
                template_id, name, category, description,
                workflow_json, placeholders, node_type, estimated_time, enabled,
                workflow_key
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, TRUE, $9)
            RETURNING *
        """
        return await db.fetchrow(
            query,
            template_id,
            name,
            category,
            description,
            wf_s,
            ph_s,
            node_type,
            estimated_time,
            workflow_key or None,
        )

    @staticmethod
    async def get_by_id(template_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM workflow_templates WHERE template_id = $1", template_id
        )

    @staticmethod
    async def get_by_name(name: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM workflow_templates WHERE name = $1", name
        )

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM workflow_templates ORDER BY category, name"
        )

    @staticmethod
    async def list_enabled() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """
            SELECT * FROM workflow_templates
            WHERE enabled = TRUE
            ORDER BY category, name
            """
        )

    @staticmethod
    async def update(
        template_id: str, **kwargs: Any
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {
            "name",
            "category",
            "description",
            "workflow_json",
            "placeholders",
            "node_type",
            "estimated_time",
            "enabled",
            "workflow_key",
        }
        sets: List[str] = []
        vals: List[Any] = []
        idx = 1
        bump_version = False

        for key, val in kwargs.items():
            if key not in allowed:
                continue
            if key == "workflow_json":
                sets.append(f"workflow_json = ${idx}::jsonb")
                vals.append(json.dumps(val, ensure_ascii=False))
                idx += 1
                bump_version = True
            elif key == "placeholders":
                sets.append(f"placeholders = ${idx}::jsonb")
                vals.append(json.dumps(val, ensure_ascii=False))
                idx += 1
            elif key == "enabled":
                sets.append(f"enabled = ${idx}")
                vals.append(val)
                idx += 1
            elif val is not None:
                sets.append(f"{key} = ${idx}")
                vals.append(val)
                idx += 1

        if bump_version:
            sets.append("version = version + 1")

        if not sets:
            return await WorkflowTemplateDAO.get_by_id(template_id)

        vals.append(template_id)
        query = (
            f"UPDATE workflow_templates SET {', '.join(sets)} "
            f"WHERE template_id = ${idx} RETURNING *"
        )
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def delete(template_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM workflow_templates WHERE template_id = $1", template_id
        )
        return result == "DELETE 1"

    @staticmethod
    def parse_nodes(workflow_json: dict) -> List[Dict[str, Any]]:
        """
        遍历 ComfyUI workflow JSON（节点 id -> {class_type, inputs}），
        收集非 list 的 input 字段及是否为 {placeholder} 形式。
        """
        out: List[Dict[str, Any]] = []
        if not isinstance(workflow_json, dict):
            return out

        for node_id, node in workflow_json.items():
            if not isinstance(node, dict):
                continue
            class_type = node.get("class_type") or ""
            inputs = node.get("inputs")
            if not isinstance(inputs, dict):
                continue
            for field_name, value in inputs.items():
                if isinstance(value, list):
                    continue
                field = f"inputs.{field_name}"
                if isinstance(value, str) and _PLACEHOLDER_RE.match(value):
                    is_placeholder = True
                else:
                    is_placeholder = False
                out.append(
                    {
                        "node_id": str(node_id),
                        "class_type": class_type,
                        "field": field,
                        "current_value": value,
                        "is_placeholder": is_placeholder,
                    }
                )
        return out
