@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "MECHA_GPU_ROOT=E:\MECHA-GPU"
set "COMFYUI_ROOT=E:\MECHA-GPU\ComfyUI-H3\ComfyUI"
set "PYTHON_EXE=E:\MECHA-GPU\ComfyUI-H3\python_embeded\python.exe"
if not exist "E:\MECHA-GPU\logs" mkdir "E:\MECHA-GPU\logs"
cd /d "%COMFYUI_ROOT%"
"%PYTHON_EXE%" -s main.py --listen 0.0.0.0 --port 8189 --lowvram --preview-method none --disable-auto-launch >> "E:\MECHA-GPU\logs\comfyui-h3-8189.log" 2>&1
endlocal
