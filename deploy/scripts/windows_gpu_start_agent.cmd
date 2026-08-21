@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set OSTORY_GPU_ROOT=E:\OSTORY-GPU
if not defined OSTORY_SERVER_URL set "OSTORY_SERVER_URL=https://tv.ostory.ai"
if not defined OSTORY_GPU_TELEMETRY_DIR set "OSTORY_GPU_TELEMETRY_DIR=D:\OSTORY-GPU-Telemetry"
if not defined OSTORY_GPU_AGENT_MAINTENANCE set "OSTORY_GPU_AGENT_MAINTENANCE=1"
set OSTORY_COMFYUI_PORTS=8188
E:\OSTORY-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s E:\OSTORY-GPU\agent\windows_gpu_agent_runner.py >> E:\OSTORY-GPU\logs\agent.log 2>&1
endlocal
