@echo off
setlocal
if not exist E:\MECHA-GPU\logs mkdir E:\MECHA-GPU\logs
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
E:\MECHA-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s -m pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple --timeout 60 --retries 3 "transformers==4.57.6" > E:\MECHA-GPU\logs\seedvr-fix.log 2>&1
echo %errorlevel% > E:\MECHA-GPU\logs\seedvr-fix.exit
endlocal
