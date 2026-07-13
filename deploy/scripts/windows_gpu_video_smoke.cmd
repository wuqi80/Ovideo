@echo off
setlocal
E:\MECHA-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s E:\MECHA-GPU\agent\windows_gpu_video_smoke.py >> E:\MECHA-GPU\logs\video-smoke-console.log 2>&1
exit /b %errorlevel%
