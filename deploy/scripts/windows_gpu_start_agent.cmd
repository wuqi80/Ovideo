@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set MECHA_GPU_ROOT=E:\MECHA-GPU
if not defined MECHA_SERVER_URL set "MECHA_SERVER_URL=https://spti.ai"
set MECHA_COMFYUI_PORTS=8188,8189
E:\MECHA-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s E:\MECHA-GPU\agent\windows_gpu_agent_runner.py >> E:\MECHA-GPU\logs\agent.log 2>&1
endlocal
