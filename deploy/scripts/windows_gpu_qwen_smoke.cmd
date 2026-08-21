@echo off
setlocal
set "OSTORY_GPU_ROOT=E:\OSTORY-GPU"
"E:\OSTORY-GPU\ComfyUI_windows_portable\python_embeded\python.exe" "E:\OSTORY-GPU\agent\windows_gpu_qwen_smoke.py" >> "E:\OSTORY-GPU\logs\qwen-smoke.log" 2>&1
exit /b %errorlevel%
