@echo off
setlocal
E:\OSTORY-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s E:\OSTORY-GPU\agent\windows_gpu_video_smoke.py >> E:\OSTORY-GPU\logs\video-smoke-console.log 2>&1
exit /b %errorlevel%
