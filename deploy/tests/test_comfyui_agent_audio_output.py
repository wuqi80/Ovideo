from unittest.mock import Mock

from pipeline.comfyui_agent import ComfyUIAgent


def test_wait_for_completion_downloads_audio_outputs(monkeypatch):
    agent = ComfyUIAgent("https://example.test", "token", [8188])
    response = Mock()
    response.json.return_value = {
        "prompt-audio": {
            "status": {"status_str": "success", "completed": True},
            "outputs": {
                "9": {
                    "audio": [
                        {"filename": "score.mp3", "subfolder": "audio", "type": "output"}
                    ]
                }
            },
        }
    }
    monkeypatch.setattr("pipeline.comfyui_agent.requests.get", Mock(return_value=response))
    monkeypatch.setattr(
        agent,
        "_download_comfyui_output",
        Mock(return_value="C:/temp/score.mp3"),
    )

    assert agent._wait_for_completion(8188, "prompt-audio", timeout=1) == ["C:/temp/score.mp3"]


def test_wait_for_completion_accepts_single_audios_mapping(monkeypatch):
    agent = ComfyUIAgent("https://example.test", "token", [8188])
    response = Mock()
    response.json.return_value = {
        "prompt-audio": {
            "status": {"status_str": "success", "completed": True},
            "outputs": {
                "9": {
                    "audios": {
                        "filename": "theme.flac",
                        "subfolder": "audio",
                        "type": "output",
                    }
                }
            },
        }
    }
    monkeypatch.setattr("pipeline.comfyui_agent.requests.get", Mock(return_value=response))
    monkeypatch.setattr(
        agent,
        "_download_comfyui_output",
        Mock(return_value="C:/temp/theme.flac"),
    )

    assert agent._wait_for_completion(8188, "prompt-audio", timeout=1) == ["C:/temp/theme.flac"]
