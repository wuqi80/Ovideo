@echo off
setlocal
set "MECHA_GPU_ROOT=E:\MECHA-GPU"
"E:\MECHA-GPU\ComfyUI_windows_portable\python_embeded\python.exe" "E:\MECHA-GPU\agent\windows_gpu_qwen_smoke.py" >> "E:\MECHA-GPU\logs\qwen-smoke.log" 2>&1
exit /b %errorlevel%
