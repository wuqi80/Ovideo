@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "OSTORY_GPU_ROOT=E:\OSTORY-GPU"
if not defined OSTORY_COMFYUI_PORT set "OSTORY_COMFYUI_PORT=8188"
set "LAUNCHER=%~dp0windows_gpu_start_music3_comfyui.ps1"
if not exist "%LAUNCHER%" (
  echo [ERROR] missing Music3 launcher: %LAUNCHER%
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%" -Port %OSTORY_COMFYUI_PORT%
exit /b %ERRORLEVEL%
