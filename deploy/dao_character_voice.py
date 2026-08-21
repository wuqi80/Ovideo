"""兼容 shim：实现已迁至 dao.creative.character_voice（当前分层架构）。"""
import sys

from dao.creative import character_voice as _implementation

sys.modules[__name__] = _implementation
