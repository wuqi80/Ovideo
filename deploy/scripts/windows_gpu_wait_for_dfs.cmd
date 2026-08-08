@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\MECHA-GPU\scripts\windows_gpu_wait_for_dfs.ps1"
exit /b %ERRORLEVEL%
