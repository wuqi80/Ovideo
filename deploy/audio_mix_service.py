"""兼容 shim：实现已迁至 services.audio_mix_service（当前分层架构）。"""
import sys

from services import audio_mix_service as _implementation

sys.modules[__name__] = _implementation
