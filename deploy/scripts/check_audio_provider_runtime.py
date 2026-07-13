#!/usr/bin/env python3
"""Check audio provider runtime wiring without calling external APIs."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import sys


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


@dataclass
class FakeConfig:
    api_key: str
    endpoint: str
    model_name: str = ""
    proxy: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    def aiohttp_proxy(self) -> str:
        return self.proxy

    def url_for_operation(self, operation: str, **path_params) -> str:
        from services.api_provider_registry import get_provider_api_path  # noqa: PLC0415

        path = get_provider_api_path("minimax", operation, **path_params).strip("/")
        return f"{self.endpoint.rstrip('/')}/{path}" if path else self.endpoint.rstrip("/")


def main() -> int:
    root = deploy_root()
    sys.path.insert(0, str(root))

    import services.audio_provider as audio_provider  # noqa: PLC0415
    import external_api.audio.minimax_audio as minimax_audio  # noqa: PLC0415

    default_base, default_version = audio_provider._derive_gemini_sdk_endpoint(
        "https://generativelanguage.googleapis.com/v1beta"
    )
    if default_base != "https://generativelanguage.googleapis.com":
        fail(f"Gemini default baseUrl derivation changed: {default_base}")
    if default_version != "v1beta":
        fail(f"Gemini default apiVersion derivation changed: {default_version}")

    custom_base, custom_version = audio_provider._derive_gemini_sdk_endpoint(
        "https://self-hosted.example.test/gemini/v1beta"
    )
    if custom_base != "https://self-hosted.example.test/gemini":
        fail(f"Gemini custom baseUrl derivation changed: {custom_base}")
    if custom_version != "v1beta":
        fail(f"Gemini custom apiVersion derivation changed: {custom_version}")

    options = audio_provider._build_gemini_http_options(
        FakeConfig(
            api_key="k",
            endpoint="https://self-hosted.example.test/native/v1",
            proxy="http://proxy.example.test:7890",
        )
    )
    if not options:
        fail("Gemini http_options were not built")
    if options.get("baseUrl") != "https://self-hosted.example.test/native":
        fail(f"Gemini http_options baseUrl mismatch: {options}")
    if options.get("apiVersion") != "v1":
        fail(f"Gemini http_options apiVersion mismatch: {options}")
    for key in ("clientArgs", "asyncClientArgs"):
        if options.get(key, {}).get("proxy") != "http://proxy.example.test:7890":
            fail(f"Gemini http_options proxy missing from {key}: {options}")

    calls: list[tuple[str, str]] = []

    def fake_resolve_provider(provider: str, model_name: str | None = None) -> FakeConfig:
        calls.append((provider, model_name or ""))
        return FakeConfig(
            api_key="runtime-key",
            endpoint="https://runtime.example.test/gemini/v1beta",
            model_name="gemini-runtime-tts-model",
            proxy="http://runtime-proxy.example.test:8080",
        )

    original = audio_provider.resolve_provider
    audio_provider.resolve_provider = fake_resolve_provider
    try:
        provider = audio_provider.GeminiAudioProvider()
    finally:
        audio_provider.resolve_provider = original

    if calls != [("gemini-tts", "")]:
        fail(f"GeminiAudioProvider did not resolve gemini-tts runtime config: {calls}")
    if provider.api_key != "runtime-key":
        fail("GeminiAudioProvider did not pick up resolved key")
    if provider.endpoint != "https://runtime.example.test/gemini/v1beta":
        fail("GeminiAudioProvider did not retain resolved endpoint")
    if provider.model_name != "gemini-runtime-tts-model":
        fail(f"GeminiAudioProvider did not pick up resolved runtime model: {provider.model_name}")
    if provider._genai_http_options != {
        "baseUrl": "https://runtime.example.test/gemini",
        "apiVersion": "v1beta",
        "clientArgs": {"proxy": "http://runtime-proxy.example.test:8080"},
        "asyncClientArgs": {"proxy": "http://runtime-proxy.example.test:8080"},
    }:
        fail(f"GeminiAudioProvider http_options mismatch: {provider._genai_http_options}")

    minimax_calls: list[tuple[str, str]] = []

    def fake_minimax_resolve_provider(provider: str, model_name: str | None = None) -> FakeConfig:
        minimax_calls.append((provider, model_name or ""))
        return FakeConfig(
            api_key="minimax-runtime-key",
            endpoint="https://runtime.example.test/minimax/v1",
            model_name="MiniMax-Hailuo-02",
            proxy="http://minimax-proxy.example.test:8080",
            extra={"group_id": "runtime-group"},
        )

    original_minimax = minimax_audio.resolve_provider
    minimax_audio.resolve_provider = fake_minimax_resolve_provider
    try:
        minimax_client = minimax_audio.MinimaxAudioClient()
        explicit_group_client = minimax_audio.MinimaxAudioClient(group_id="explicit-group")
    finally:
        minimax_audio.resolve_provider = original_minimax

    if minimax_calls != [
        ("minimax", minimax_audio.MINIMAX_DEFAULT_PROVIDER_MODEL),
        ("minimax", minimax_audio.MINIMAX_DEFAULT_PROVIDER_MODEL),
    ]:
        fail(f"MinimaxAudioClient did not resolve minimax runtime config: {minimax_calls}")
    if minimax_client.api_key != "minimax-runtime-key":
        fail("MinimaxAudioClient did not pick up resolved key")
    if minimax_client.base_url != "https://runtime.example.test/minimax/v1":
        fail("MinimaxAudioClient did not pick up resolved endpoint")
    if minimax_client._aiohttp_proxy != "http://minimax-proxy.example.test:8080":
        fail("MinimaxAudioClient did not pick up resolved proxy")
    if minimax_client.group_id != "runtime-group":
        fail(f"MinimaxAudioClient did not pick up runtime group_id: {minimax_client.group_id}")
    if minimax_client._group_params({"task_id": "task-1"}) != {
        "task_id": "task-1",
        "GroupId": "runtime-group",
    }:
        fail(f"MinimaxAudioClient did not include GroupId params: {minimax_client._group_params({'task_id': 'task-1'})}")
    if explicit_group_client.group_id != "explicit-group":
        fail("Explicit MiniMax group_id should override runtime extra config")

    print("Audio provider runtime OK")
    print("  gemini_tts_endpoint_wired=1")
    print("  gemini_tts_proxy_wired=1")
    print("  gemini_tts_model_wired=1")
    print("  minimax_audio_group_id_wired=1")
    print("  minimax_audio_proxy_wired=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
