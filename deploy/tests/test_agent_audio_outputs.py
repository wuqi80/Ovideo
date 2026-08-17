from pathlib import Path

import agent_routes


def test_agent_audio_output_is_saved_and_grouped_as_audio(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    entry = agent_routes.save_output_file(
        b"fake-mp3",
        "task-music",
        "score.mp3",
        "audio/mpeg",
    )
    result = agent_routes.build_task_result([entry], duration=30)

    assert entry["file_type"] == "audio"
    assert entry["mime_type"] == "audio/mpeg"
    assert "/audios/" in entry["url"]
    assert Path(entry["file_path"]).read_bytes() == b"fake-mp3"
    assert result["audios"] == [entry]
    assert result["images"] == []
    assert result["videos"] == []
