import json

import pytest

from scripts import windows_gpu_h3_long_video_verify as verifier


def _object_info_response(nodes):
    return type("Response", (), {
        "__enter__": lambda self: self,
        "__exit__": lambda self, *_args: None,
        "read": lambda self: json.dumps({node: {} for node in nodes}).encode(),
    })()


def test_long_video_verifier_is_non_inference_and_rejects_conflicting_pack(tmp_path, monkeypatch):
    root = tmp_path / "ComfyUI_MiniMaxH3_Director"
    root.mkdir()
    (root / ".ostory-reviewed-commit").write_text(
        verifier.REVIEWED_DIRECTOR_COMMIT, encoding="utf-8"
    )
    monkeypatch.setattr(
        verifier.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _object_info_response(verifier.REQUIRED_NODE_TYPES),
    )

    result = verifier.verify(8188, root)

    assert result["verified"] is True
    assert result["inference_executed"] is False
    assert result["context_frames"] == 22
    assert result["audio_context_frames"] == 24
    assert "prompt" not in result
    assert "model" not in result

    monkeypatch.setattr(
        verifier.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _object_info_response(
            verifier.REQUIRED_NODE_TYPES | {"MiniMaxH3MotionContext"}
        ),
    )
    with pytest.raises(RuntimeError, match="must not be installed"):
        verifier.verify(8188, root)
