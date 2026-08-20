@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set MECHA_GPU_ROOT=E:\MECHA-GPU
set MECHA_H3_COMFYUI_URL=http://127.0.0.1:8188
E:\MECHA-GPU\ComfyUI-H3\python_embeded\python.exe -s E:\MECHA-GPU\scripts\windows_gpu_h3_smoke.py %*
exit /b %ERRORLEVEL%
