"""兼容 shim：实现已迁至 services.file_service（refactor/v2 P3）。"""
from services.file_service import *  # noqa: F401,F403
# ⚠️ `import *` 不会导入下划线开头的名字。worker._save_external_video 用
# `from file_service import _sync_legacy_on_file_create` 把 video_url 同步进
# video_segments —— 漏了这行会静默 ImportError，导致生成视频后 video_segments.video_url
# 永远不更新、美化/成品页看不到视频（refactor 后的回归）。显式补回。
from services.file_service import _sync_legacy_on_file_create  # noqa: F401
