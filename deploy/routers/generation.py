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
from services.generation_access_service import (
    GenerationAccessDenied,
    require_generation_request_access,
)
from utils.image_reference import storage_path_safe


COMFYUI_WORKFLOW_FALLBACKS = {
    "qwenN": "qwen",
    "qwenN_lora": "qwen_lora",
    "three_view": "qwen",
}

THREE_VIEW_PROMPT = (
    "Create a professional three-view turnaround sheet from the reference image. "
    "Show the same subject in front, side, and back views, aligned at equal scale "
    "on a clean neutral background. Preserve identity, clothing, colors, proportions, "
    "and design details. Do not add text, labels, borders, or unrelated objects."
)

ANGLE_ADJUST_COMPOSITION_GUARD = (
    "Preserve the complete visible subject, identity, proportions, clothing, colors, and visual style. "
    "When the reference contains a full-body character, keep the entire character from the top of the "
    "head through both feet fully inside the frame. For portraits or close-ups, keep the complete head "
    "and visible silhouette inside the frame. Reframe or zoom out as needed and leave a clear safe margin "
    "around the subject. Do not crop the head, hair, face, hands, feet, limbs, clothing, or accessories, "
    "and do not place the subject against the canvas edge."
)

GPU2_OPERATION_PROMPTS = {
    "matting_subject": (
        "Remove the background completely and keep only the main foreground subject. "
        "Preserve fine hair and edge details, and return a clean transparent-background cutout."
    ),
    "matting_split": (
        "Separate the main foreground subject from the background with clean detailed edges. "
        "Return a transparent-background subject cutout suitable for compositing."
    ),
    "image_fusion": (
        "Blend the subject from the second reference naturally into the scene from the first reference. "
        "Preserve the subject identity and the scene perspective, lighting, and visual style."
    ),
    "image_transfer": (
        "Transfer the subject from the second reference into the first reference scene, using the third "
        "reference as the placement mask or composition guide. Preserve identity and produce a coherent image."
    ),
    "pose_imitation": (
        "Make the subject in the second reference imitate the pose and composition of the first reference. "
        "Preserve identity, clothing, colors, and visual style."
    ),
    "panorama_360": (
        "Create a seamless 2:1 equirectangular 360-degree panorama from the reference scene. "
        "Preserve scene identity, lighting, and style, and avoid seams, text, and borders."
    ),
    "panorama_fusion": (
        "Create one seamless 2:1 equirectangular panorama by coherently combining all references. "
        "Preserve subjects and scene details while matching perspective, lighting, and style."
    ),
    "auto_storyboard": (
        "Create a clean storyboard contact sheet from the reference image and description. "
        "Use six distinct cinematic shots in a 3 by 2 grid with consistent characters and scene design. "
        "Do not add captions, labels, or borders."
    ),
    "i2i_around": (
        "Generate a coherent orbiting-camera view of the same subject and scene. "
        "Preserve identity, clothing, geometry, lighting, and background layout while applying the "
        "requested camera direction. Do not merely copy the input image."
    ),
}


def merge_gpu2_operation_prompt(operation: str, user_prompt: str = "") -> str:
    base = GPU2_OPERATION_PROMPTS[operation]
    cleaned = str(user_prompt or "").strip()
    return f"{base} Additional direction: {cleaned}" if cleaned else base


def merge_angle_adjust_prompt(user_prompt: str = "") -> str:
    cleaned = str(user_prompt or "").strip()
    direction = cleaned or "Adjust the camera angle slightly while remaining faithful to the reference."
    return f"{direction} {ANGLE_ADJUST_COMPOSITION_GUARD}"


def qwen_fallback_task_type(image_count: int) -> str:
    return f"qwen_{max(1, min(6, image_count))}"


def resolve_executable_comfyui_workflow_type(requested_type: str, image_count: int) -> tuple[str, bool]:
    """Resolve legacy placeholder workflow families to executable graphs."""
    effective_type = COMFYUI_WORKFLOW_FALLBACKS.get(requested_type, requested_type)
    if effective_type in {"qwen", "qwen_lora"}:
        total_images = max(1, min(6, image_count))
        return f"{effective_type}_{total_images}", effective_type != requested_type
    return effective_type, effective_type != requested_type


def _attach_entity_fields(task_data: dict, request: Any) -> None:
    if getattr(request, "entity_type", None):
        task_data["entity_type"] = request.entity_type
    if getattr(request, "entity_id", None):
        task_data["entity_id"] = request.entity_id
    if getattr(request, "file_role", None):
        task_data["file_role"] = request.file_role
    if getattr(request, "project_id", None):
        task_data["project_id"] = request.project_id
    if getattr(request, "episode_id", None):
        task_data["episode_id"] = request.episode_id
    if getattr(request, "preferred_agent_id", None):
        task_data["preferred_agent_id"] = request.preferred_agent_id
    if getattr(request, "preferred_node_id", None):
        task_data["preferred_node_id"] = request.preferred_node_id


def create_generation_router(
    *,
    require_auth_dependency: Any,
    task_service_module: Any,
    generate_gemini_images: Any,
    file_dao: Any,
    logger: logging.Logger,
    generation_access_checker: Any = require_generation_request_access,
) -> APIRouter:
    router = APIRouter()

    async def _authorize(request: Any, username: str, references: list[str]) -> None:
        try:
            await generation_access_checker(
                request,
                username,
                references,
                file_dao=file_dao,
            )
        except GenerationAccessDenied as exc:
            raise HTTPException(status_code=404, detail="Generation scope or source not found") from exc

    @router.post("/api/generate/image")
    async def generate_image(request: ImageGenerationRequest, username: str = Depends(require_auth_dependency)):
        try:
            await _authorize(request, username, request.ref_images)
            if request.engine == "gemini":
                return {
                    "success": False,
                    "message": "Gemini引擎请在前端直接调用，无需通过后端",
                }

            if request.engine == "comfyui":
                if not request.ref_images:
                    raise HTTPException(status_code=400, detail="当前处理模型至少需要1张参考图")

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
            await _authorize(request, username, request.image_filenames)
            if request.workflow_type not in ["qwen", "qwen_lora", "kontext", "qwenN", "qwenN_lora"]:
                raise HTTPException(status_code=400, detail=f"不支持的工作流类型: {request.workflow_type}")

            actual_workflow_type, fallback_applied = resolve_executable_comfyui_workflow_type(
                request.workflow_type,
                len(request.image_filenames),
            )
            if fallback_applied:
                logger.warning(
                    "工作流 %s 当前仅有空/占位模板，自动降级到可执行工作流 %s",
                    request.workflow_type,
                    actual_workflow_type,
                )
            else:
                logger.info(
                    "📊 %s工作流: 共%s张参考图，使用 %s",
                    request.workflow_type,
                    max(1, min(6, len(request.image_filenames))),
                    actual_workflow_type,
                )

            task_data = {
                "prompt": request.prompt,
                "seed": request.seed,
                "output_width": request.output_width,
                "output_height": request.output_height,
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
                "requested_workflow_type": request.workflow_type,
                "fallback_applied": fallback_applied,
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
            await _authorize(request, username, [request.image_filename])
            task_data = {
                "image_path": request.image_filename,
                "prompt": merge_angle_adjust_prompt(request.prompt),
                "seed": request.seed,
                "output_width": request.output_width,
                "output_height": request.output_height,
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
            await _authorize(request, username, [request.image_filename])
            task_data = {
                "image_path": request.image_filename,
                "prompt": THREE_VIEW_PROMPT,
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
            await _authorize(request, username, [request.image_filename])
            task_data = {
                "image_path": request.image_filename,
                "prompt": merge_gpu2_operation_prompt("i2i_around", request.prompt),
                "seed": request.seed,
                "gpu2_operation": "i2i_around",
                "requested_workflow_type": "i2i_around",
            }
            _attach_entity_fields(task_data, request)
            effective_task_type = "i2i_around"
            task_id = await task_service_module.get().submit(effective_task_type, task_data, username)
            logger.info(
                "✅ 创建全景角度生成任务: %s (图片: %s, 提示词: %s...)",
                task_id,
                request.image_filename,
                request.prompt[:50],
            )

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": effective_task_type,
                "requested_workflow_type": "i2i_around",
                "fallback_applied": False,
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
            await _authorize(request, username, [request.image_filename])
            if request.matting_type not in ["subject", "split"]:
                raise HTTPException(status_code=400, detail=f"不支持的抠图类型: {request.matting_type}")

            task_type = f"matting_{request.matting_type}"

            task_data = {
                "image_path": request.image_filename,
                "seed": request.seed,
                "gpu2_operation": task_type,
                "requested_workflow_type": task_type,
            }
            _attach_entity_fields(task_data, request)
            effective_task_type = qwen_fallback_task_type(1)
            task_id = await task_service_module.get().submit(effective_task_type, task_data, username)
            logger.info("✅ 创建抠图任务: %s (类型: %s, 图片: %s)", task_id, task_type, request.image_filename)

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": effective_task_type,
                "requested_workflow_type": task_type,
                "fallback_applied": True,
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
            await _authorize(
                request,
                username,
                [request.image_bk, request.image_hu, request.image_mb or ""],
            )
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

            image_filenames = [request.image_bk, request.image_hu]
            if request.fusion_type == "transfer":
                image_filenames.append(request.image_mb)
            task_data = {
                "prompt": merge_gpu2_operation_prompt(task_type),
                "seed": request.seed,
                "gpu2_operation": task_type,
                "requested_workflow_type": task_type,
            }
            for index, filename in enumerate(image_filenames, 1):
                task_data[f"image_path_{index}"] = filename
            _attach_entity_fields(task_data, request)

            effective_task_type = qwen_fallback_task_type(len(image_filenames))
            task_id = await task_service_module.get().submit(effective_task_type, task_data, username)
            logger.info("✅ 创建融合任务: %s (类型: %s)", task_id, task_type)

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": effective_task_type,
                "requested_workflow_type": task_type,
                "fallback_applied": True,
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
            await _authorize(request, username, [request.image_filename])
            task_data = {
                "image_path": request.image_filename,
                "prompt": merge_gpu2_operation_prompt("panorama_360", request.prompt),
                "seed": request.seed,
                "gpu2_operation": "panorama_360",
                "requested_workflow_type": "panorama_360",
                "output_width": 1024,
                "output_height": 512,
            }
            _attach_entity_fields(task_data, request)
            effective_task_type = qwen_fallback_task_type(1)
            task_id = await task_service_module.get().submit(effective_task_type, task_data, username)
            logger.info("✅ 创建360度全景生成任务: %s", task_id)

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": effective_task_type,
                "requested_workflow_type": "panorama_360",
                "fallback_applied": True,
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
            await _authorize(
                request,
                username,
                [request.image_1, request.image_2 or "", request.image_3],
            )
            if request.image_2:
                task_type = "panorama_fusion_3"
                task_data = {
                    "image_path_1": request.image_1,
                    "image_path_2": request.image_2,
                    "image_path_3": request.image_3,
                    "prompt": merge_gpu2_operation_prompt("panorama_fusion", request.prompt),
                    "seed": request.seed,
                }
            else:
                task_type = "panorama_fusion_1"
                task_data = {
                    "image_path_1": request.image_1,
                    "image_path_2": request.image_3,
                    "prompt": merge_gpu2_operation_prompt("panorama_fusion", request.prompt),
                    "seed": request.seed,
                }
            task_data.update(
                {
                    "gpu2_operation": "panorama_fusion",
                    "requested_workflow_type": task_type,
                    "output_width": 1024,
                    "output_height": 512,
                }
            )
            _attach_entity_fields(task_data, request)

            effective_task_type = qwen_fallback_task_type(3 if request.image_2 else 2)
            task_id = await task_service_module.get().submit(effective_task_type, task_data, username)
            logger.info("✅ 创建全景融合任务: %s (工作流: %s)", task_id, task_type)

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": effective_task_type,
                "requested_workflow_type": task_type,
                "fallback_applied": True,
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
            await _authorize(request, username, [request.image_filename])
            task_data = {
                "image_path": request.image_filename,
                "prompt": merge_gpu2_operation_prompt("auto_storyboard", request.prompt),
                "seed": request.seed,
                "gpu2_operation": "auto_storyboard",
                "requested_workflow_type": "auto_storyboard",
                "output_width": 1024,
                "output_height": 768,
            }
            _attach_entity_fields(task_data, request)
            effective_task_type = qwen_fallback_task_type(1)
            task_id = await task_service_module.get().submit(effective_task_type, task_data, username)
            logger.info("✅ 创建自动分镜任务: %s", task_id)

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": effective_task_type,
                "requested_workflow_type": "auto_storyboard",
                "fallback_applied": True,
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
            await _authorize(request, username, [request.reference_image])
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
                project_id=request.project_id,
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
            await _authorize(request, username, [request.image_filename])
            if request.workflow_type not in ["upscale_hd", "remove_watermark", "three_view"]:
                raise HTTPException(status_code=400, detail=f"不支持的工作流类型: {request.workflow_type}")

            actual_workflow_type, fallback_applied = resolve_executable_comfyui_workflow_type(
                request.workflow_type,
                1,
            )

            if request.workflow_type == "upscale_hd":
                seed = random.randint(100000, 999999)
                seed_key = "seed_0"
            else:
                seed = random.randint(100000000000000, 999999999999999)
                seed_key = "seed"

            if request.workflow_type == "three_view":
                task_data = {
                    "image_path_1": request.image_filename,
                    "prompt": THREE_VIEW_PROMPT,
                    seed_key: seed,
                }
                logger.warning(
                    "Workflow three_view is a placeholder; routing to executable workflow %s",
                    actual_workflow_type,
                )
            else:
                task_data = {"image_path": request.image_filename, seed_key: seed}
            _attach_entity_fields(task_data, request)
            task_id = await task_service_module.get().submit(actual_workflow_type, task_data, username)

            workflow_names = {
                "upscale_hd": "高清放大",
                "remove_watermark": "去水印",
                "three_view": "三视图",
            }

            logger.info("✅ 创建%s任务: %s (图片: %s)", workflow_names[request.workflow_type], task_id, request.image_filename)

            return {
                "success": True,
                "task_id": task_id,
                "workflow_type": actual_workflow_type,
                "requested_workflow_type": request.workflow_type,
                "fallback_applied": fallback_applied,
                "message": f"{workflow_names[request.workflow_type]}任务已提交",
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("素材处理失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    return router
