import json
from pathlib import Path

from scripts import windows_gpu_h3_sage_verify as verifier


def test_h3_sage_verifier_writes_only_non_inference_metadata(tmp_path, monkeypatch):
    fake_torch = type("Torch", (), {
        "__version__": "2.x",
        "version": type("Version", (), {"cuda": "12.4"})(),
        "cuda": type("Cuda", (), {
            "is_available": staticmethod(lambda: True),
            "get_device_capability": staticmethod(lambda _index: (8, 6)),
        })(),
    })()
    fake_sage = type("Sage", (), {"sageattn": staticmethod(lambda: None)})()
    monkeypatch.setitem(__import__("sys").modules, "torch", fake_torch)
    monkeypatch.setitem(__import__("sys").modules, "sageattention", fake_sage)
    monkeypatch.setattr(verifier.importlib.metadata, "version", lambda _name: "2.2.0")
    monkeypatch.setattr(verifier.urllib.request, "urlopen", lambda *_args, **_kwargs: type(
        "Response", (), {
            "__enter__": lambda self: self,
            "__exit__": lambda self, *_args: None,
            "read": lambda self: json.dumps({node: {} for node in verifier.REQUIRED_NODE_TYPES}).encode(),
        }
    )())
    root = tmp_path / "ComfyUI-KJNodes"
    root.mkdir()
    (root / ".mecha-reviewed-commit").write_text(
        verifier.REVIEWED_KJNODES_COMMIT, encoding="utf-8"
    )

    result = verifier.verify(8188, root)

    assert result["verified"] is True
    assert result["cuda_arch"] == "sm86"
    assert result["inference_executed"] is False
    assert "prompt" not in result
    assert "model" not in result
