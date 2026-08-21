@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set OSTORY_GPU_ROOT=E:\OSTORY-GPU
set OSTORY_GPU_SMOKE_RESOLUTION=1080
set OSTORY_GPU_SMOKE_BLOCKS_TO_SWAP=0
del /q E:\OSTORY-GPU\logs\seedvr-smoke-result.json E:\OSTORY-GPU\logs\seedvr-smoke-error.txt 2>nul
E:\OSTORY-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s E:\OSTORY-GPU\agent\windows_gpu_seedvr_smoke.py > E:\OSTORY-GPU\logs\seedvr-smoke.log 2>&1
echo %errorlevel% > E:\OSTORY-GPU\logs\seedvr-smoke.exit
endlocal
