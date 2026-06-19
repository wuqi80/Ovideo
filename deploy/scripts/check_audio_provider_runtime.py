#!/usr/bin/env python3
"""Check audio provider runtime wiring without calling external APIs."""
from __future__ import annotations

from dataclasses import dataclass
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
    proxy: str = ""

    def aiohttp_proxy(self) -> str:
        return self.proxy


def main() -> int:
    root = deploy_root()
    sys.path.insert(0, str(root))

    import services.audio_provider as audio_provider  # noqa: PLC0415

    default_base, default_version = audio_provider._derive_gemini_sdk_endpoint(
        "https://generativelanguage.googleapis.com/v1beta/openai/"
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
            endpoint="https://runtime.example.test/gemini/v1beta/openai",
            proxy="http://runtime-proxy.example.test:8080",
        )

    original = audio_provider.resolve_provider
    audio_provider.resolve_provider = fake_resolve_provider
    try:
        provider = audio_provider.GeminiAudioProvider()
    finally:
        audio_provider.resolve_provider = original

    if calls != [("gemini-tts", "gemini-2.0-flash")]:
        fail(f"GeminiAudioProvider did not resolve gemini-tts runtime config: {calls}")
    if provider.api_key != "runtime-key":
        fail("GeminiAudioProvider did not pick up resolved key")
    if provider.endpoint != "https://runtime.example.test/gemini/v1beta/openai":
        fail("GeminiAudioProvider did not retain resolved endpoint")
    if provider._genai_http_options != {
        "baseUrl": "https://runtime.example.test/gemini",
        "apiVersion": "v1beta",
        "clientArgs": {"proxy": "http://runtime-proxy.example.test:8080"},
        "asyncClientArgs": {"proxy": "http://runtime-proxy.example.test:8080"},
    }:
        fail(f"GeminiAudioProvider http_options mismatch: {provider._genai_http_options}")

    print("Audio provider runtime OK")
    print("  gemini_tts_endpoint_wired=1")
    print("  gemini_tts_proxy_wired=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
