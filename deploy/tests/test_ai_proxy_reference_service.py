import base64

from services.ai_proxy_reference_service import (
    enhance_reference_prompt,
    prepare_doubao_reference_inputs,
    prepare_gemini_image_parts,
    prepare_gpt_image_reference_inputs,
)


class _Logger:
    infos = []
    warnings = []

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))


def setup_function():
    _Logger.infos = []
    _Logger.warnings = []


def test_enhance_reference_prompt_keeps_plain_prompt_without_references():
    assert enhance_reference_prompt("draw a robot", 0) == "draw a robot"


def test_prepare_gemini_image_parts_accepts_data_url_reference():
    parts = prepare_gemini_image_parts(
        prompt="draw a robot",
        references=["data:image/png;base64,AAAA"],
        logger=_Logger,
    )

    assert parts[0] == {"inlineData": {"mimeType": "image/png", "data": "AAAA"}}
    assert parts[-1]["text"].startswith("请严格参考上面提供的参考图片")
    assert "draw a robot" in parts[-1]["text"]


def test_prepare_gemini_image_parts_reads_storage_reference(tmp_path):
    image_path = tmp_path / "ref.jpg"
    image_path.write_bytes(b"image-bytes")

    parts = prepare_gemini_image_parts(
        prompt="draw",
        references=["/storage/ref.jpg"],
        logger=_Logger,
        storage_path_resolver=lambda _: image_path,
    )

    assert parts[0]["inlineData"]["mimeType"] == "image/jpeg"
    assert parts[0]["inlineData"]["data"] == base64.b64encode(b"image-bytes").decode("utf-8")
    assert _Logger.infos


def test_prepare_gpt_image_reference_inputs_accepts_data_and_storage_refs(tmp_path):
    storage_image = tmp_path / "source.jpg"
    storage_image.write_bytes(b"storage-image")

    refs = [
        "data:image/jpeg;base64,YWJj",
        "/storage/source.jpg",
    ]

    inputs = prepare_gpt_image_reference_inputs(
        refs,
        logger=_Logger,
        storage_path_resolver=lambda _: storage_image,
    )

    assert len(inputs) == 2
    assert inputs[0].filename == "ref_0.jpeg"
    assert inputs[0].content == b"abc"
    assert inputs[0].mime_type == "image/jpeg"
    assert inputs[1].filename == "ref_1.jpeg"
    assert inputs[1].content == b"storage-image"
    assert inputs[1].mime_type == "image/jpeg"


def test_prepare_gpt_image_reference_inputs_skips_invalid_refs():
    inputs = prepare_gpt_image_reference_inputs(
        ["data:image/png;base64,abc", "not-a-reference"],
        logger=_Logger,
    )

    assert inputs == []
    assert _Logger.warnings


def test_prepare_doubao_reference_inputs_uses_common_converter(monkeypatch):
    calls = []

    def fake_convert(ref):
        calls.append(ref)
        return f"converted:{ref}" if ref != "skip" else ""

    monkeypatch.setattr("services.ai_proxy_reference_service.to_doubao_image_input", fake_convert)

    result = prepare_doubao_reference_inputs(["a", "skip", "b"])

    assert result == ["converted:a", "converted:b"]
    assert calls == ["a", "skip", "b"]
