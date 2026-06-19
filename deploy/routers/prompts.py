"""Prompt template routes."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from dao_content import PromptTemplateDAO
from schemas.misc import PromptTemplate

logger = logging.getLogger(__name__)


DEFAULT_PROMPTS = {
    "rewrite": """你是一位专业的中文动画编剧。
请将以下小说/文本内容改写成符合行业标准的动画剧本格式。

要求：
1. 准确识别场景（Scene）、角色（Character）、对话（Dialogue）和动作（Action）。
2. 使用标准的剧本格式（场景标题加粗，角色名居中，对话清晰，包含必要的括弧指导）。
3. 增加适合动画制作的视觉描述（画面感）。
4. 保持原著的语气和情节，但要适应视听语言。
5. **必须使用中文输出剧本内容**。

输入文本:
{text}""",
    "storyboard": """请分析以下中文动画剧本，将其拆解为一系列关键镜头（Shot），并返回 JSON。

JSON 结构必须为 {"items": [ ... ]}
每个 item 需要包含以下字段：
- originalText: 对应的原文段落（从剧本中直接复制，用于高亮匹配）
- scriptSegment: AI提炼的场景描述（简洁的场景和动作描述，用于图像生成）
- imagePrompt: 图像生成提示词（英文，适合Stable Diffusion）
- videoPrompt: 视频生成提示词（中文，描述镜头运动和画面）
- dialogue: 人物台词（如果有）
- characters: 出现的角色列表（数组）
- scene: 场景位置（字符串）

重要：originalText 必须是剧本中的原始文本段落，scriptSegment 是你提炼的场景描述。

剧本:
{scriptText}""",
}


def create_prompt_router(*, require_auth_dependency) -> APIRouter:
    router = APIRouter()

    @router.get("/api/prompts/{template_type}")
    async def get_prompt_template(
        template_type: str,
        username: str = Depends(require_auth_dependency),
    ):
        """Load a user's prompt template, falling back to bundled defaults."""
        try:
            custom_content = await PromptTemplateDAO.load_template(username, template_type)
            if custom_content:
                logger.info("用户 %s 加载自定义提示词: %s", username, template_type)
                return {
                    "success": True,
                    "template_type": template_type,
                    "content": custom_content,
                    "is_custom": True,
                }

            return {
                "success": True,
                "template_type": template_type,
                "content": DEFAULT_PROMPTS.get(template_type, ""),
                "is_custom": False,
            }
        except Exception as exc:
            logger.error("获取提示词失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/prompts/{template_type}")
    async def save_prompt_template(
        template_type: str,
        request: PromptTemplate,
        username: str = Depends(require_auth_dependency),
    ):
        """Save a user's custom prompt template."""
        try:
            await PromptTemplateDAO.save_template(username, template_type, request.content)
            logger.info("用户 %s 保存提示词模板到数据库: %s", username, template_type)
            return {
                "success": True,
                "message": "提示词模板已保存",
                "template_type": template_type,
            }
        except Exception as exc:
            logger.error("保存提示词失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/api/prompts/{template_type}")
    async def delete_prompt_template(
        template_type: str,
        username: str = Depends(require_auth_dependency),
    ):
        """Delete a user's custom template so default content is used again."""
        try:
            existing_content = await PromptTemplateDAO.load_template(username, template_type)
            if existing_content:
                await PromptTemplateDAO.delete_template(username, template_type)
                logger.info("用户 %s 删除提示词模板: %s", username, template_type)
                return {
                    "success": True,
                    "message": "提示词模板已删除，已恢复为默认",
                }

            return {
                "success": True,
                "message": "提示词模板不存在（已是默认）",
            }
        except Exception as exc:
            logger.error("删除提示词失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
