@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set OSTORY_GPU_ROOT=E:\OSTORY-GPU
set OSTORY_H3_COMFYUI_URL=http://127.0.0.1:8188
E:\OSTORY-GPU\ComfyUI-H3\python_embeded\python.exe -s E:\OSTORY-GPU\scripts\windows_gpu_h3_smoke.py %*
exit /b %ERRORLEVEL%
