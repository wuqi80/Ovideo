"""AI proxy routes.

Provider calls live in dedicated service modules. This router keeps the HTTP
route layer focused on auth, request shaping, task persistence, and response
format.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from schemas.generation import (
    DeepseekChatRequest,
    DoubaoImageRequest,
    GeminiImageRequest,
    GeminiTextRequest,
    GptImageRequest,
)
from services.ai_proxy_deepseek_service import (
    ensure_deepseek_configured,
    stream_deepseek_chat,
)
from services.ai_proxy_doubao_image_service import (
    generate_doubao_images as proxy_generate_doubao_images,
)
from services.ai_proxy_gemini_image_service import (
    generate_gemini_images as proxy_generate_gemini_images,
)
from services.ai_proxy_gemini_text_service import (
    generate_gemini_text_result,
)
from services.ai_proxy_gpt_image_service import (
    generate_gpt_images as proxy_generate_gpt_images,
)
from services.ai_proxy_types import AIProxyError
from services.ai_proxy_image_persistence_service import persist_generated_ai_images
from services.ai_proxy_task_service import (
    complete_ai_proxy_text_task,
    create_completed_gemini_text_task,
    create_completed_image_task,
    create_deepseek_text_task,
)
from services.ai_proxy_reference_service import (
    ReferenceImageError,
    prepare_doubao_reference_inputs,
    prepare_gemini_image_parts,
    prepare_gpt_image_reference_inputs,
)

logger = logging.getLogger(__name__)


def create_ai_proxy_router(
    *,
    require_auth_dependency,
    get_main_event_loop: Callable[[], Optional[asyncio.AbstractEventLoop]],
) -> APIRouter:
    router = APIRouter()

    def _schedule_text_result_save(task_id: Optional[str], complete_text: str):
        if not task_id or not complete_text:
            return
        loop = get_main_event_loop()
        if loop is not None and not loop.is_closed():
            try:
                asyncio.run_coroutine_threadsafe(
                    complete_ai_proxy_text_task(
                        task_id=task_id,
                        text_content=complete_text,
                        logger=logger,
                    ),
                    loop,
                )
            except Exception as e:
                logger.error("⚠️ 提交保存任务到主事件循环失败: %s", e, exc_info=True)
        else:
            logger.warning("⚠️ MAIN_EVENT_LOOP 不可用，跳过 DeepSeek 文本结果持久化")

    @router.post("/api/deepseek/chat")
    async def deepseek_chat(request: DeepseekChatRequest, username: str = Depends(require_auth_dependency)):
        """DeepSeek流式聊天接口"""
        try:
            ensure_deepseek_configured(request.model)
        except AIProxyError as e:
            raise HTTPException(status_code=e.status_code, detail=e.detail)

        try:
            task_id = await create_deepseek_text_task(
                user_id=username,
                prompt=request.prompt,
                response_format=request.response_format,
                temperature=request.temperature,
                logger=logger,
            )

            return StreamingResponse(
                stream_deepseek_chat(
                    prompt=request.prompt,
                    response_format=request.response_format,
                    temperature=request.temperature,
                    model=request.model,
                    on_complete=lambda text: _schedule_text_result_save(task_id, text),
                ),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("AI服务请求失败: %s", e)
            raise HTTPException(status_code=500, detail="AI服务请求失败，请稍后重试")

    @router.post("/api/gemini/text")
    async def gemini_text_chat(request: GeminiTextRequest, username: str = Depends(require_auth_dependency)):
        """Gemini文本生成接口（代理）"""
        try:
            text_result = await generate_gemini_text_result(
                prompt=request.prompt,
                system_prompt=request.system_prompt,
                temperature=request.temperature,
                model=request.model,
            )
            content = text_result.content

            await create_completed_gemini_text_task(
                user_id=username,
                prompt=request.prompt,
                system_prompt=request.system_prompt,
                temperature=request.temperature,
                model=request.model,
                content=content,
                logger=logger,
            )

            return {
                "content": content,
                "provider": text_result.provider,
                "model": text_result.model_name,
                "failover": text_result.failover,
            }

        except AIProxyError as e:
            logger.error("文本生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except Exception as e:
            logger.error("文本生成失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="文本生成失败，请稍后重试")

    @router.post("/api/gemini/image")
    async def gemini_image_generate(request: GeminiImageRequest, username: str = Depends(require_auth_dependency)):
        """Gemini图像生成接口（代理）"""
        try:
            parts = prepare_gemini_image_parts(
                prompt=request.prompt,
                references=request.references,
                reference_metadata=[item.model_dump() for item in request.reference_metadata],
                logger=logger,
            )

            images, model = await proxy_generate_gemini_images(
                parts=parts,
                requested_model=request.model,
                aspect_ratio=request.aspectRatio,
                image_size=request.imageSize,
            )

            logger.info("✅ 图像生成成功: %s 张图片, 用户: %s", len(images), username)

            task_id = await create_completed_image_task(
                task_id_prefix="gemini_img",
                user_id=username,
                task_type=f"gemini_image_{model.replace('gemini-', '').replace('-image', '')}",
                task_data={
                    "prompt": request.prompt,
                    "model": model,
                    "aspectRatio": request.aspectRatio,
                    "imageSize": request.imageSize,
                },
                images_count=len(images),
                logger=logger,
            )

            files_result = await persist_generated_ai_images(
                images,
                user_id=username,
                source="gemini",
                media_source="generated_image_gemini",
                prompt=request.prompt,
                model=model,
                entity_type=request.entity_type,
                entity_id=request.entity_id,
                file_role=request.file_role,
                project_id=request.project_id,
                episode_id=request.episode_id,
                file_metadata={"prompt": request.prompt, "model": model},
                media_metadata={"prompt": request.prompt, "model": model},
                source_task_id=task_id,
                logger=logger,
            )

            return {"success": True, "images": images, "files": files_result}

        except ReferenceImageError as e:
            logger.warning("Gemini 角色参考图无效: %s", e)
            raise HTTPException(status_code=400, detail=str(e))
        except AIProxyError as e:
            logger.error("图像生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except Exception as e:
            logger.error("图像生成失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

    @router.post("/api/gpt-image/generate")
    async def gpt_image_generate(request: GptImageRequest, username: str = Depends(require_auth_dependency)):
        """GPT Image 2 系列统一网关。"""
        if not request.prompt or not request.prompt.strip():
            raise HTTPException(status_code=400, detail="prompt 不能为空")

        try:
            reference_inputs = prepare_gpt_image_reference_inputs(
                request.references,
                logger=logger,
            )
            if request.references and not reference_inputs:
                raise HTTPException(status_code=400, detail="提供了 references 但全部无法读取，无法发起图改图")

            images, model, tier = await proxy_generate_gpt_images(
                tier=request.tier,
                prompt=request.prompt,
                references=reference_inputs,
                n=request.n,
                size=request.size,
                quality=request.quality,
            )

            files_result = await persist_generated_ai_images(
                images,
                user_id=username,
                source=f"gpt-image-{tier}",
                media_source="generated_image_gpt",
                prompt=request.prompt,
                model=model,
                entity_type=request.entity_type,
                entity_id=request.entity_id,
                file_role=request.file_role,
                project_id=request.project_id,
                episode_id=request.episode_id,
                file_metadata={
                    "prompt": request.prompt,
                    "model": model,
                    "tier": tier,
                    "size": request.size,
                    "quality": request.quality,
                    "ref_count": len(request.references or []),
                },
                media_metadata={"prompt": request.prompt, "model": model, "tier": tier},
                include_url=True,
                logger=logger,
            )

            logger.info("✅ GPT Image %s 生成 %s 张, 用户: %s", tier, len(images), username)
            return {"success": True, "images": images, "files": files_result, "model": model, "tier": tier}
        except AIProxyError as e:
            logger.error("GPT Image 生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("GPT Image 生成异常: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

    @router.post("/api/materials/doubao")
    async def generate_doubao_images(request: DoubaoImageRequest, username: str = Depends(require_auth_dependency)):
        try:
            ref_inputs = prepare_doubao_reference_inputs(request.references)

            images = await proxy_generate_doubao_images(
                prompt=request.prompt,
                reference_inputs=ref_inputs,
                size=request.size,
                sequential=request.sequential,
                count=request.count,
                model=request.model,
            )
            logger.info("✅ 豆包生成 %s 张图片, 用户: %s", len(images), username)

            await create_completed_image_task(
                task_id_prefix="doubao_img",
                user_id=username,
                task_type="doubao_image",
                task_data={
                    "prompt": request.prompt,
                    "size": request.size,
                    "count": request.count,
                    "sequential": request.sequential,
                },
                images_count=len(images),
                logger=logger,
            )

            files_result = await persist_generated_ai_images(
                images,
                user_id=username,
                source="doubao",
                media_source="generated_image_doubao",
                prompt=request.prompt,
                model="doubao",
                entity_type=request.entity_type,
                entity_id=request.entity_id,
                file_role=request.file_role,
                project_id=request.project_id,
                episode_id=request.episode_id,
                file_metadata={"prompt": request.prompt, "model": "doubao"},
                media_metadata={"prompt": request.prompt, "model": "doubao"},
                logger=logger,
            )

            return {"success": True, "images": images, "files": files_result}
        except AIProxyError as e:
            logger.error("豆包图像生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("豆包图像生成异常: %s", e)
            raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

    return router
