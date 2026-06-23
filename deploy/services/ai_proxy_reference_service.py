"""Reference image preparation helpers for AI proxy routes."""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Callable, Iterable, List

from services.ai_proxy_types import GptImageReferenceInput
from utils.image_reference import storage_path_safe, to_doubao_image_input

StoragePathResolver = Callable[[str], Path]

IMAGE_MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
}


def image_mime_type_from_suffix(suffix: str, *, default: str = "image/png") -> str:
    return IMAGE_MIME_BY_SUFFIX.get(suffix.lower(), default)


def _log_warning(logger: Any, message: str, *args: Any) -> None:
    if logger is not None:
        logger.warning(message, *args)


def _log_info(logger: Any, message: str, *args: Any) -> None:
    if logger is not None:
        logger.info(message, *args)


def enhance_reference_prompt(prompt: str, ref_count: int) -> str:
    if ref_count <= 0:
        return prompt
    if ref_count == 1:
        return (
            f"请严格参考上面提供的参考图片，{prompt}\n\n"
            "重要提示：请紧密遵循参考图的画风、构图、角色设计、色彩风格和视觉元素。"
            "在保持与参考图一致性的同时，融入描述中的变化。"
            "确保生成的图像在视觉风格上与参考图高度相似。"
        )
    return (
        f"请严格参考上面提供的{ref_count}张参考图片，{prompt}\n\n"
        "重要提示：请紧密遵循这些参考图的画风、构图、角色设计、色彩风格和视觉元素。"
        "在保持与参考图一致性的同时，融入描述中的变化。"
        "确保生成的图像在视觉风格上与参考图高度相似。"
    )


def prepare_gemini_image_parts(
    *,
    prompt: str,
    references: Iterable[str],
    logger: Any,
    max_refs: int = 5,
    storage_path_resolver: StoragePathResolver = storage_path_safe,
) -> List[dict[str, Any]]:
    """Build Gemini multimodal parts from prompt and local/data URL references."""
    parts: List[dict[str, Any]] = []
    ref_count = 0

    for ref in list(references)[:max_refs]:
        try:
            if ref.startswith("data:"):
                mime_type = ref.split(";")[0].split(":")[1]
                b64_data = ref.split(",", 1)[1] if "," in ref else ref
                parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
                ref_count += 1
            elif ref.startswith("/storage/"):
                file_path = storage_path_resolver(ref)
                if file_path.exists():
                    img_bytes = file_path.read_bytes()
                    mime_type = image_mime_type_from_suffix(file_path.suffix)
                    b64_data = base64.b64encode(img_bytes).decode("utf-8")
                    parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
                    ref_count += 1
                    _log_info(logger, "📷 从磁盘读取参考图: %s (%s bytes)", file_path, len(img_bytes))
                else:
                    _log_warning(logger, "⚠️ 参考图文件不存在: %s", file_path)
            else:
                _log_warning(logger, "⚠️ 不支持的参考图格式: %s", ref[:80])
        except Exception as ref_err:
            _log_warning(logger, "⚠️ 处理参考图失败: %s", ref_err)

    parts.append({"text": enhance_reference_prompt(prompt, ref_count)})
    return parts


def _gpt_reference_extension_from_mime(mime: str) -> str:
    mime = mime.lower()
    if "jpeg" in mime or "jpg" in mime:
        return "jpeg"
    if "webp" in mime:
        return "webp"
    if "gif" in mime:
        return "gif"
    return "png"


def prepare_gpt_image_reference_inputs(
    references: Iterable[str],
    *,
    logger: Any,
    max_refs: int = 8,
    storage_path_resolver: StoragePathResolver = storage_path_safe,
) -> List[GptImageReferenceInput]:
    """Convert route reference strings into GPT Image multipart inputs."""
    reference_inputs: List[GptImageReferenceInput] = []

    for idx, ref in enumerate(list(references)[:max_refs]):
        img_bytes: bytes | None = None
        ext = "png"

        if ref.startswith("data:"):
            mime = ref.split(";")[0].split(":")[1] if ":" in ref.split(";")[0] else "image/png"
            ext = _gpt_reference_extension_from_mime(mime)
            b64_data = ref.split(",", 1)[1] if "," in ref else ref
            try:
                img_bytes = base64.b64decode(b64_data)
            except Exception as decode_error:
                _log_warning(logger, "⚠️ GPT Image edit 跳过无法解码的参考图: %s", decode_error)
                continue
        elif ref.startswith("/storage/"):
            file_path = storage_path_resolver(ref)
            if file_path.exists():
                img_bytes = file_path.read_bytes()
                ext = file_path.suffix.lstrip(".").lower() or "png"
                if ext == "jpg":
                    ext = "jpeg"

        if img_bytes is None:
            _log_warning(logger, "⚠️ GPT Image edit 跳过无效参考图: %s...", ref[:60])
            continue

        reference_inputs.append(
            GptImageReferenceInput(
                filename=f"ref_{idx}.{ext}",
                content=img_bytes,
                mime_type=f"image/{ext}",
            )
        )

    return reference_inputs


def prepare_doubao_reference_inputs(references: Iterable[str], *, max_refs: int = 14) -> List[str]:
    ref_inputs: List[str] = []
    for ref in list(references)[:max_refs]:
        converted = to_doubao_image_input(ref)
        if converted:
            ref_inputs.append(converted)
    return ref_inputs
