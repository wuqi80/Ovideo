"""Image/material generation task routes."""
from __future__ import annotations

import base64
import logging
import random
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from schemas.generation import (
    AngleAdjustRequest,
    AroundAngleRequest,
    AutoStoryboardRequest,
    ComfyUIWorkflowRequest,
    HumanMultiAngleRequest,
    ImageFusionRequest,
    ImageGenerationRequest,
    MaterialProcessRequest,
    MattingRequest,
    MultiGridStoryboardRequest,
    Panorama360Request,
    PanoramaFusionRequest,
)
from services.ai_proxy_image_persistence_service import persist_generated_ai_images
from services.ai_proxy_types import AIProxyError
from utils.image_reference import storage_path_safe


def _attach_entity_fields(task_data: dict, request: Any) -> None:
    if getattr(request, "entity_type", None):
        task_data["entity_type"] = request.entity_type
    if getattr(request, "entity_id", None):
        task_data["entity_id"] = request.entity_id
    if getattr(request, "file_role", None):
        task_data["file_role"] = request.file_role
    if getattr(request, "episode_id", None):
        task_data["episode_id"] = request.episode_id


def create_generation_router(
    *,
    require_auth_dependency: Any,
    task_service_module: Any,
    generate_gemini_images: Any,
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/generate/image")
    async def generate_image(request: ImageGenerationRequest, username: str = Depends(require_auth_dependency)):
        try:
            if request.engine == "gemini":
                return {
                    "success": False,
                    "message": "Gemini引擎请在前端直接调用，无需通过后端",
                }

            if request.engine == "comfyui":
                if not request.ref_images:
                    raise HTTPException(status_code=400, detail="ComfyUI引擎至少需要1张参考图")

                task_data = {
                    "image": request.ref_images[0],
                    "ref_images": request.ref_images[1:6],
                    "prompt": request.prompt,
                    "negative_prompt": request.negative_prompt or "bad quality, worst quality",
                    "seed": request.seed,
                    "strength": request.strength,
                }
                _attach_entity_fields(task_data, request)
                task_id = await task_service_module.get().submit("i2i_fj", task_data, username)
                logger.info("✅ 创建I2I图像生成任务: %s", task_id)

                return {
                    "success": True,
                    "task_id": task_id,
                    "engine": "comfyui",
                    "message": "图像生成任务已提交",
                }

            raise HTTPException(status_code=400, detail=f"不支持的引擎: {request.engine}")

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("图像生成失败: %s", exc)
            raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

    @router.post("/api/generate/comfyui-workflow")
    async def generate_comfyui_workflow(
        request: ComfyUIWorkflowRequest,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            if request.workflow_type not in ["qwen", "qwen_lora", "kontext", "qwenN", "qwenN_lora"]:
                raise HTTPException(status_code=400, detail=f"不支持的工作流类型: {request.workflow_type}")

            actual_workflow_type = request.workflow_type
            if request.workflow_type in ["qwen", "qwen_lora", "qwenN", "qwenN_lora"]:
                total_images = len(request.image_filenames)
                total_images = max(1, min(6, total_images))
                actual_workflow_type = f"{request.workflow_type}_{total_images}"

                logger.info("📊 %s工作流: 共%s张参考图，使用 %s", request.workflow_type, total_images, actual_workflow_type)

            task_data = {
                "prompt": request.prompt,
                "seed": request.seed,
            }
            _attach_entity_fields(task_data, request)

            if request.workflow_type in ["qwen", "qwen_lora", "qwenN", "qwenN_lora"]:
                for i, filename in enumerate(request.image_filenames[:6], 1):
                    task_data[f"image_path_{i}"] = filename
            else:
                if len(request.image_filenames) > 0:
                    task_data["image_path"] = request.image_filenames[0]
                task_data["negative_prompt"] = request.negative_prompt

            task_id = await task_service_module.get().submit(actual_workflow_type, task_data, username)
            logger.info("✅ 创建%s工作流任务: %s", actual_workflow_type, task_id)

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": actual_workflow_type,
                "message": f"{request.workflow_type}工作流任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("%s工作流生成失败: %s", request.workflow_type, exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/angle-adjust")
    async def adjust_image_angle(request: AngleAdjustRequest, username: str = Depends(require_auth_dependency)):
        try:
            task_data = {
                "image_path": request.image_filename,
                "prompt": request.prompt,
                "seed": request.seed,
            }
            _attach_entity_fields(task_data, request)
            task_id = await task_service_module.get().submit("i2i_fj", task_data, username)
            logger.info("✅ 创建角度调整任务: %s (图片: %s)", task_id, request.image_filename)

            return {
                "success": True,
                "task_id": task_id,
                "message": "角度调整任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("角度调整失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/human-multi-angle")
    async def generate_human_multi_angle(
        request: HumanMultiAngleRequest,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            task_data = {
                "image_path": request.image_filename,
                "seed": request.seed,
            }
            _attach_entity_fields(task_data, request)
            task_id = await task_service_module.get().submit("i2i_human", task_data, username)
            logger.info("✅ 创建多角度人物生成任务: %s (图片: %s)", task_id, request.image_filename)

            return {
                "success": True,
                "task_id": task_id,
                "message": "多角度人物生成任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("多角度人物生成失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/around-angle")
    async def generate_around_angle(request: AroundAngleRequest, username: str = Depends(require_auth_dependency)):
        try:
            task_data = {
                "image_path": request.image_filename,
                "prompt": request.prompt,
                "seed": request.seed,
            }
            _attach_entity_fields(task_data, request)
            task_id = await task_service_module.get().submit("i2i_around", task_data, username)
            logger.info(
                "✅ 创建全景角度生成任务: %s (图片: %s, 提示词: %s...)",
                task_id,
                request.image_filename,
                request.prompt[:50],
            )

            return {
                "success": True,
                "task_id": task_id,
                "message": "全景角度生成任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("全景角度生成失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/matting")
    async def generate_matting(request: MattingRequest, username: str = Depends(require_auth_dependency)):
        try:
            if request.matting_type not in ["subject", "split"]:
                raise HTTPException(status_code=400, detail=f"不支持的抠图类型: {request.matting_type}")

            task_type = f"matting_{request.matting_type}"

            task_data = {
                "image_path": request.image_filename,
                "seed": request.seed,
            }
            _attach_entity_fields(task_data, request)
            task_id = await task_service_module.get().submit(task_type, task_data, username)
            logger.info("✅ 创建抠图任务: %s (类型: %s, 图片: %s)", task_id, task_type, request.image_filename)

            return {
                "success": True,
                "task_id": task_id,
                "message": f"抠图任务({request.matting_type})已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("抠图失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/image-fusion")
    async def generate_image_fusion(request: ImageFusionRequest, username: str = Depends(require_auth_dependency)):
        try:
            valid_types = ["fusion", "transfer", "imitation"]
            if request.fusion_type not in valid_types:
                raise HTTPException(status_code=400, detail=f"不支持的融合类型: {request.fusion_type}")

            if request.fusion_type == "transfer" and not request.image_mb:
                raise HTTPException(status_code=400, detail="迁移学习需要提供蒙版图(image_mb)")

            workflow_map = {
                "fusion": "image_fusion",
                "transfer": "image_transfer",
                "imitation": "pose_imitation",
            }
            task_type = workflow_map[request.fusion_type]

            task_data = {
                "image_BK": request.image_bk,
                "image_HU": request.image_hu,
                "seed": request.seed,
            }

            if request.fusion_type == "transfer":
                task_data["image_MB"] = request.image_mb
            _attach_entity_fields(task_data, request)

            task_id = await task_service_module.get().submit(task_type, task_data, username)
            logger.info("✅ 创建融合任务: %s (类型: %s)", task_id, task_type)

            return {
                "success": True,
                "task_id": task_id,
                "message": f"融合任务({request.fusion_type})已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("融合失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/panorama-360")
    async def generate_panorama_360(request: Panorama360Request, username: str = Depends(require_auth_dependency)):
        try:
            task_data = {
                "image_path": request.image_filename,
                "prompt": request.prompt,
                "seed": request.seed,
            }
            _attach_entity_fields(task_data, request)
            task_id = await task_service_module.get().submit("panorama_360", task_data, username)
            logger.info("✅ 创建360度全景生成任务: %s", task_id)

            return {
                "success": True,
                "task_id": task_id,
                "message": "360度全景生成任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("360度全景生成失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/panorama-fusion")
    async def generate_panorama_fusion(
        request: PanoramaFusionRequest,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            if request.image_2:
                task_type = "panorama_fusion_3"
                task_data = {
                    "image_1": request.image_1,
                    "image_2": request.image_2,
                    "image_3": request.image_3,
                    "prompt": request.prompt,
                    "seed": request.seed,
                }
            else:
                task_type = "panorama_fusion_1"
                task_data = {
                    "image_1": request.image_1,
                    "image_3": request.image_3,
                    "prompt": request.prompt,
                    "seed": request.seed,
                }
            _attach_entity_fields(task_data, request)

            task_id = await task_service_module.get().submit(task_type, task_data, username)
            logger.info("✅ 创建全景融合任务: %s (工作流: %s)", task_id, task_type)

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": task_type,
                "message": "全景融合任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("全景融合失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/auto-storyboard")
    async def generate_auto_storyboard(
        request: AutoStoryboardRequest,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            task_data = {
                "image_path": request.image_filename,
                "prompt": request.prompt,
                "seed": request.seed,
            }
            _attach_entity_fields(task_data, request)
            task_id = await task_service_module.get().submit("auto_storyboard", task_data, username)
            logger.info("✅ 创建自动分镜任务: %s", task_id)

            return {
                "success": True,
                "task_id": task_id,
                "message": "自动分镜任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("自动分镜失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/generate/multi-grid-storyboard")
    async def generate_multi_grid_storyboard(
        request: MultiGridStoryboardRequest,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            if request.mode not in ["multi_shot", "story"]:
                raise HTTPException(status_code=400, detail=f"不支持的模式: {request.mode}")

            if not request.reference_image:
                raise HTTPException(status_code=400, detail="必须传入一张参考图像")

            if request.mode == "multi_shot":
                full_prompt = f"{request.user_prompt}+AI+分镜"
            else:
                full_prompt = f"{request.user_prompt}+AI+分镜1"

            logger.info("📷 多宫格分镜请求 - 模式: %s, 提示词: %s...", request.mode, full_prompt[:50])

            parts = []

            ref = request.reference_image
            if ref.startswith("data:"):
                mime_type = ref.split(";")[0].split(":")[1]
                b64_data = ref.split(",")[1] if "," in ref else ref
                parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
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
                    }
                    mime_type = mime_map.get(ext, "image/png")
                    b64_data = base64.b64encode(img_bytes).decode("utf-8")
                    parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
                else:
                    logger.warning("⚠️ 多宫格参考图不存在: %s", file_path)

            enhanced_prompt = (
                f"请严格参考上面提供的参考图片，{full_prompt}\n\n"
                "重要提示：请紧密遵循参考图的画风、构图、角色设计、色彩风格和视觉元素。"
                "在保持与参考图一致性的同时，融入描述中的变化。确保生成的图像在视觉风格上与参考图高度相似。"
            )
            parts.append({"text": enhanced_prompt})

            images, model = await generate_gemini_images(
                parts=parts,
                requested_model=None,
                aspect_ratio="16:9",
            )

            logger.info("✅ 多宫格分镜生成成功 (模式: %s)，图片数量: %s", request.mode, len(images))

            file_metadata = {"prompt": full_prompt[:500], "model": model, "feature": "gemini-multi-grid"}
            files_result = await persist_generated_ai_images(
                images,
                user_id=username,
                source="gemini",
                media_source="generated_storyboard_gemini",
                prompt=full_prompt,
                model=model,
                entity_type=request.entity_type,
                entity_id=request.entity_id,
                file_role=request.file_role or "storyboard",
                episode_id=request.episode_id,
                file_metadata=file_metadata,
                media_metadata=file_metadata,
                logger=logger,
            )

            return {
                "success": True,
                "mode": request.mode,
                "prompt": full_prompt,
                "images": images,
                "files": files_result,
                "message": f"多宫格分镜({request.mode})生成成功",
            }

        except HTTPException:
            raise
        except AIProxyError as exc:
            logger.error("多宫格分镜 Gemini 生成失败: %s | upstream: %s", exc, exc.upstream)
            raise HTTPException(status_code=exc.status_code, detail=exc.detail)
        except Exception as exc:
            logger.error("多宫格分镜生成失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/materials/process")
    async def process_material(request: MaterialProcessRequest, username: str = Depends(require_auth_dependency)):
        try:
            if request.workflow_type not in ["upscale_hd", "remove_watermark", "three_view"]:
                raise HTTPException(status_code=400, detail=f"不支持的工作流类型: {request.workflow_type}")

            if request.workflow_type == "upscale_hd":
                seed = random.randint(100000, 999999)
                seed_key = "seed_0"
            else:
                seed = random.randint(100000000000000, 999999999999999)
                seed_key = "seed"

            task_data = {"image_path": request.image_filename, seed_key: seed}
            _attach_entity_fields(task_data, request)
            task_id = await task_service_module.get().submit(request.workflow_type, task_data, username)

            workflow_names = {
                "upscale_hd": "高清放大",
                "remove_watermark": "去水印",
                "three_view": "三视图",
            }

            logger.info("✅ 创建%s任务: %s (图片: %s)", workflow_names[request.workflow_type], task_id, request.image_filename)

            return {
                "success": True,
                "task_id": task_id,
                "message": f"{workflow_names[request.workflow_type]}任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("素材处理失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    return router
