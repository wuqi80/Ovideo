"""兼容 shim：实现已迁至 external_api.audio.minimax_audio（当前分层架构）。旧导入路径保持可用。"""
import sys

from external_api.audio import minimax_audio as _impl

sys.modules[__name__] = _impl
