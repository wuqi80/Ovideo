@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set OMP_NUM_THREADS=16
set MKL_NUM_THREADS=16
set OPENBLAS_NUM_THREADS=16
set NUMEXPR_MAX_THREADS=16
cd /d E:\MECHA-GPU\ComfyUI_windows_portable
python_embeded\python.exe -s ComfyUI\main.py --listen 0.0.0.0 --port 8188 --lowvram --preview-method none --disable-auto-launch >> E:\MECHA-GPU\logs\comfyui.log 2>&1
endlocal
