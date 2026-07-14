@echo off
setlocal
set MODE=%~1
if "%MODE%"=="" set MODE=readiness
E:\MECHA-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s E:\MECHA-GPU\windows_gpu_wan_smoke.py --mode %MODE%
exit /b %errorlevel%
