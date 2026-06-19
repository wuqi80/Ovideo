"""AI proxy routes.

The external provider calls live in services.ai_proxy_service. This router keeps
the HTTP route layer focused on auth, request shaping, persistence, and response
format.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Callable, List, Optional

import requests as download_requests
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from schemas.generation import (
    DeepseekChatRequest,
    DoubaoImageRequest,
    GeminiImageRequest,
    GeminiTextRequest,
    GptImageRequest,
)
from services.ai_proxy_service import (
    AIProxyError,
    GptImageReferenceInput,
    ensure_deepseek_configured,
    generate_doubao_images as proxy_generate_doubao_images,
    generate_gemini_images as proxy_generate_gemini_images,
    generate_gpt_images as proxy_generate_gpt_images,
    generate_gemini_text_result,
    stream_deepseek_chat,
)
from utils.image_reference import storage_path_safe, to_doubao_image_input

logger = logging.getLogger(__name__)


async def _save_text_result(task_id: str, text_content: str):
    """Persist a completed streaming text result back to the task table."""
    try:
        from dao_task import TaskDAO

        truncated_text = text_content[:2000] if len(text_content) > 2000 else text_content
        await TaskDAO.update_task_status(
            task_id=task_id,
            status="completed",
            result_data={"text": truncated_text, "full_length": len(text_content)},
        )
        logger.info("✅ 文本结果已保存到数据库: %s, 长度: %s", task_id, len(text_content))
    except Exception as e:
        logger.error("⚠️ 保存文本结果失败: %s", e, exc_info=True)


def create_ai_proxy_router(
    *,
    require_auth_dependency,
    get_main_event_loop: Callable[[], Optional[asyncio.AbstractEventLoop]],
    doubao_model_provider: Callable[[], str],
) -> APIRouter:
    router = APIRouter()

    def _schedule_text_result_save(task_id: Optional[str], complete_text: str):
        if not task_id or not complete_text:
            return
        loop = get_main_event_loop()
        if loop is not None and not loop.is_closed():
            try:
                asyncio.run_coroutine_threadsafe(
                    _save_text_result(task_id, complete_text),
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
            task_id = None
            try:
                from dao_task import TaskDAO

                task_id = f"deepseek_text_{int(time.time() * 1000)}"
                await TaskDAO.create_task(
                    task_id=task_id,
                    user_id=username,
                    task_type="deepseek_text",
                    task_data={
                        "prompt": request.prompt[:500],
                        "response_format": request.response_format,
                        "temperature": request.temperature,
                    },
                )
                logger.info("✅ DeepSeek文本生成任务已创建: %s", task_id)
            except Exception as save_error:
                logger.error("⚠️ 保存DeepSeek任务失败: %s", save_error, exc_info=True)
                task_id = None

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

            try:
                from dao_task import TaskDAO

                task_id = f"gemini_text_{int(time.time() * 1000)}"
                await TaskDAO.create_task(
                    task_id=task_id,
                    user_id=username,
                    task_type="gemini_text",
                    task_data={
                        "prompt": request.prompt[:500],
                        "system_prompt": request.system_prompt[:200] if request.system_prompt else None,
                        "temperature": request.temperature,
                        "model": request.model,
                    },
                )
                truncated_text = content[:2000] if len(content) > 2000 else content
                await TaskDAO.update_task_status(
                    task_id=task_id,
                    status="completed",
                    result_data={"text": truncated_text, "full_length": len(content)},
                )
                logger.info("✅ Gemini文本生成任务已保存: %s, 长度: %s", task_id, len(content))
            except Exception as save_error:
                logger.error("⚠️ 保存Gemini文本任务失败: %s", save_error, exc_info=True)

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
            parts = []
            ref_count = 0
            for ref in request.references[:5]:
                try:
                    if ref.startswith("data:"):
                        mime_type = ref.split(";")[0].split(":")[1]
                        b64_data = ref.split(",")[1] if "," in ref else ref
                        parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
                        ref_count += 1
                    elif ref.startswith("/storage/"):
                        file_path = storage_path_safe(ref)
                        if file_path.exists():
                            img_bytes = file_path.read_bytes()
                            ext = file_path.suffix.lower()
                            mime_map = {
                                ".png": "image/png",
                                ".jpg": "image/jpeg",
                                ".jpeg": "image/jpeg",
                                ".webp": "image/webp",
                                ".gif": "image/gif",
                                ".bmp": "image/bmp",
                            }
                            mime_type = mime_map.get(ext, "image/png")
                            b64_data = base64.b64encode(img_bytes).decode("utf-8")
                            parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
                            ref_count += 1
                            logger.info("📷 从磁盘读取参考图: %s (%s bytes)", file_path, len(img_bytes))
                        else:
                            logger.warning("⚠️ 参考图文件不存在: %s", file_path)
                    else:
                        logger.warning("⚠️ 不支持的参考图格式: %s", ref[:80])
                except Exception as ref_err:
                    logger.warning("⚠️ 处理参考图失败: %s", ref_err)

            enhanced_prompt = request.prompt
            if ref_count > 0:
                if ref_count == 1:
                    enhanced_prompt = f"请严格参考上面提供的参考图片，{request.prompt}\n\n重要提示：请紧密遵循参考图的画风、构图、角色设计、色彩风格和视觉元素。在保持与参考图一致性的同时，融入描述中的变化。确保生成的图像在视觉风格上与参考图高度相似。"
                else:
                    enhanced_prompt = f"请严格参考上面提供的{ref_count}张参考图片，{request.prompt}\n\n重要提示：请紧密遵循这些参考图的画风、构图、角色设计、色彩风格和视觉元素。在保持与参考图一致性的同时，融入描述中的变化。确保生成的图像在视觉风格上与参考图高度相似。"

            parts.append({"text": enhanced_prompt})

            images, model = await proxy_generate_gemini_images(
                parts=parts,
                requested_model=request.model,
                aspect_ratio=request.aspectRatio,
                image_size=request.imageSize,
            )

            logger.info("✅ 图像生成成功: %s 张图片, 用户: %s", len(images), username)

            task_id = None
            try:
                from dao_task import TaskDAO

                task_id = f"gemini_img_{int(time.time() * 1000)}"
                await TaskDAO.create_task(
                    task_id=task_id,
                    user_id=username,
                    task_type=f"gemini_image_{model.replace('gemini-', '').replace('-image', '')}",
                    task_data={
                        "prompt": request.prompt,
                        "model": model,
                        "aspectRatio": request.aspectRatio,
                        "imageSize": request.imageSize,
                    },
                )
                await TaskDAO.update_task_status(
                    task_id=task_id,
                    status="completed",
                    result_data={"images_count": len(images)},
                )
                logger.info("✅ Gemini图像生成任务已保存: %s", task_id)
            except Exception as save_error:
                logger.error("⚠️ 保存Gemini图像生成任务失败: %s", save_error, exc_info=True)

            from file_service import save_generated_file_to_db

            files_result = []
            for img_data_url in images:
                try:
                    b64_data = img_data_url.split(",")[1] if "," in img_data_url else img_data_url
                    img_content = base64.b64decode(b64_data)
                    saved = await save_generated_file_to_db(
                        content=img_content,
                        file_type="image",
                        user_id=username,
                        source="gemini",
                        entity_type=request.entity_type,
                        entity_id=request.entity_id,
                        file_role=request.file_role or "generated_image",
                        original_ext=".png",
                        episode_id=request.episode_id,
                        extra_metadata={"prompt": request.prompt, "model": model},
                    )
                    try:
                        import media_library_service
                        from dao_content import FileDAO as _FileDAO

                        _file_record = await _FileDAO.get_file(saved["file_id"]) if saved.get("file_id") else None
                        if _file_record:
                            await media_library_service.create_from_file(
                                file_record=_file_record,
                                source="generated_image_gemini",
                                episode_id=request.episode_id,
                                source_task_id=task_id,
                                source_entity_type=request.entity_type,
                                source_entity_id=request.entity_id,
                                title=(request.prompt or "")[:80] or None,
                                metadata={"prompt": request.prompt, "model": model},
                            )
                    except Exception as _e:
                        logger.warning("media_library 同步失败 (Gemini): %s", _e)
                    files_result.append(
                        {
                            "data_url": img_data_url,
                            "file_id": saved["file_id"],
                            "file_url": saved["file_url"],
                        }
                    )
                except Exception as e:
                    logger.warning("保存图片到 files 表失败: %s", e)
                    files_result.append({"data_url": img_data_url, "file_id": None, "file_url": None})

            return {"success": True, "images": images, "files": files_result}

        except AIProxyError as e:
            logger.error("图像生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except Exception as e:
            logger.error("图像生成失败: %s", e)
            raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

    @router.post("/api/gpt-image/generate")
    async def gpt_image_generate(request: GptImageRequest, username: str = Depends(require_auth_dependency)):
        """GPT Image 2 系列统一网关。"""
        if not request.prompt or not request.prompt.strip():
            raise HTTPException(status_code=400, detail="prompt 不能为空")

        try:
            reference_inputs: List[GptImageReferenceInput] = []
            if request.references:
                for idx, ref in enumerate(request.references[:8]):
                    img_bytes = None
                    ext = "png"
                    if ref.startswith("data:"):
                        mime = ref.split(";")[0].split(":")[1] if ":" in ref.split(";")[0] else "image/png"
                        ext = "jpeg" if "jpeg" in mime or "jpg" in mime else ("webp" if "webp" in mime else "png")
                        b64_data = ref.split(",", 1)[1] if "," in ref else ref
                        try:
                            img_bytes = base64.b64decode(b64_data)
                        except Exception as decode_error:
                            logger.warning("⚠️ GPT Image edit 跳过无法解码的参考图: %s", decode_error)
                            continue
                    elif ref.startswith("/storage/"):
                        fp = storage_path_safe(ref)
                        if fp.exists():
                            img_bytes = fp.read_bytes()
                            ext = fp.suffix.lstrip(".").lower() or "png"
                            if ext == "jpg":
                                ext = "jpeg"
                    if img_bytes is None:
                        logger.warning("⚠️ GPT Image edit 跳过无效参考图: %s...", ref[:60])
                        continue
                    reference_inputs.append(
                        GptImageReferenceInput(
                            filename=f"ref_{idx}.{ext}",
                            content=img_bytes,
                            mime_type=f"image/{ext}",
                        )
                    )

                if not reference_inputs:
                    raise HTTPException(status_code=400, detail="提供了 references 但全部无法读取，无法发起图改图")

            images, model, tier = await proxy_generate_gpt_images(
                tier=request.tier,
                prompt=request.prompt,
                references=reference_inputs,
                n=request.n,
                size=request.size,
                quality=request.quality,
            )

            from file_service import save_generated_file_to_db

            files_result = []
            for img in images:
                try:
                    if img.startswith("data:"):
                        b64_data = img.split(",", 1)[1] if "," in img else img
                        content = base64.b64decode(b64_data)
                    else:
                        r2 = download_requests.get(img, timeout=60)
                        r2.raise_for_status()
                        content = r2.content
                    saved = await save_generated_file_to_db(
                        content=content,
                        file_type="image",
                        user_id=username,
                        source=f"gpt-image-{tier}",
                        entity_type=request.entity_type,
                        entity_id=request.entity_id,
                        file_role=request.file_role or "generated_image",
                        original_ext=".png",
                        episode_id=request.episode_id,
                        extra_metadata={
                            "prompt": request.prompt,
                            "model": model,
                            "tier": tier,
                            "size": request.size,
                            "quality": request.quality,
                            "ref_count": len(request.references or []),
                        },
                    )
                    try:
                        import media_library_service
                        from dao_content import FileDAO as _FileDAO

                        _file_record = await _FileDAO.get_file(saved["file_id"]) if saved.get("file_id") else None
                        if _file_record:
                            await media_library_service.create_from_file(
                                file_record=_file_record,
                                source="generated_image_gpt",
                                episode_id=request.episode_id,
                                source_entity_type=request.entity_type,
                                source_entity_id=request.entity_id,
                                title=(request.prompt or "")[:80] or None,
                                metadata={"prompt": request.prompt, "model": model, "tier": tier},
                            )
                    except Exception as _e:
                        logger.warning("media_library 同步失败 (GPT Image): %s", _e)
                    files_result.append(
                        {
                            "data_url": img if img.startswith("data:") else None,
                            "url": None if img.startswith("data:") else img,
                            "file_id": saved["file_id"],
                            "file_url": saved["file_url"],
                        }
                    )
                except Exception as e:
                    logger.warning("GPT Image 保存到 files 表失败: %s", e)
                    files_result.append(
                        {
                            "data_url": img if img.startswith("data:") else None,
                            "url": img if not img.startswith("data:") else None,
                            "file_id": None,
                            "file_url": None,
                        }
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
            ref_inputs: List[str] = []
            if request.references:
                for ref in request.references[:14]:
                    converted = to_doubao_image_input(ref)
                    if converted:
                        ref_inputs.append(converted)

            images = await proxy_generate_doubao_images(
                prompt=request.prompt,
                reference_inputs=ref_inputs,
                size=request.size,
                sequential=request.sequential,
                count=request.count,
                model=doubao_model_provider(),
            )
            logger.info("✅ 豆包生成 %s 张图片, 用户: %s", len(images), username)

            try:
                from dao_task import TaskDAO

                task_id = f"doubao_img_{int(time.time() * 1000)}"
                await TaskDAO.create_task(
                    task_id=task_id,
                    user_id=username,
                    task_type="doubao_image",
                    task_data={
                        "prompt": request.prompt,
                        "size": request.size,
                        "count": request.count,
                        "sequential": request.sequential,
                    },
                )
                await TaskDAO.update_task_status(
                    task_id=task_id,
                    status="completed",
                    result_data={"images_count": len(images)},
                )
                logger.info("✅ 豆包图像生成任务已保存: %s", task_id)
            except Exception as save_error:
                logger.error("⚠️ 保存豆包图像生成任务失败: %s", save_error, exc_info=True)

            from file_service import save_generated_file_to_db

            files_result = []
            for img_data_url in images:
                try:
                    b64_data = img_data_url.split(",")[1] if "," in img_data_url else img_data_url
                    img_content = base64.b64decode(b64_data)
                    saved = await save_generated_file_to_db(
                        content=img_content,
                        file_type="image",
                        user_id=username,
                        source="doubao",
                        entity_type=request.entity_type,
                        entity_id=request.entity_id,
                        file_role=request.file_role or "generated_image",
                        original_ext=".png",
                        episode_id=request.episode_id,
                        extra_metadata={"prompt": request.prompt, "model": "doubao"},
                    )
                    try:
                        import media_library_service
                        from dao_content import FileDAO as _FileDAO

                        _file_record = await _FileDAO.get_file(saved["file_id"]) if saved.get("file_id") else None
                        if _file_record:
                            await media_library_service.create_from_file(
                                file_record=_file_record,
                                source="generated_image_doubao",
                                episode_id=request.episode_id,
                                source_entity_type=request.entity_type,
                                source_entity_id=request.entity_id,
                                title=(request.prompt or "")[:80] or None,
                                metadata={"prompt": request.prompt, "model": "doubao"},
                            )
                    except Exception as _e:
                        logger.warning("media_library 同步失败 (Doubao): %s", _e)
                    files_result.append(
                        {
                            "data_url": img_data_url,
                            "file_id": saved["file_id"],
                            "file_url": saved["file_url"],
                        }
                    )
                except Exception as e:
                    logger.warning("保存图片到 files 表失败: %s", e)
                    files_result.append({"data_url": img_data_url, "file_id": None, "file_url": None})

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
