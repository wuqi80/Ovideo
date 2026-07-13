@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set MECHA_GPU_ROOT=E:\MECHA-GPU
set MECHA_GPU_SMOKE_RESOLUTION=1080
set MECHA_GPU_SMOKE_BLOCKS_TO_SWAP=0
del /q E:\MECHA-GPU\logs\seedvr-smoke-result.json E:\MECHA-GPU\logs\seedvr-smoke-error.txt 2>nul
E:\MECHA-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s E:\MECHA-GPU\agent\windows_gpu_seedvr_smoke.py > E:\MECHA-GPU\logs\seedvr-smoke.log 2>&1
echo %errorlevel% > E:\MECHA-GPU\logs\seedvr-smoke.exit
endlocal
