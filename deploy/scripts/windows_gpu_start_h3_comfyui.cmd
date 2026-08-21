@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "OSTORY_GPU_ROOT=E:\OSTORY-GPU"
if not defined OSTORY_COMFYUI_PORT set "OSTORY_COMFYUI_PORT=8188"
set "COMFY_PORT=%OSTORY_COMFYUI_PORT%"
set "COMFYUI_ROOT=E:\OSTORY-GPU\ComfyUI-H3"
set "COMFYUI_MAIN=%COMFYUI_ROOT%\ComfyUI\main.py"
set "PYTHON_EXE=%COMFYUI_ROOT%\python_embeded\python.exe"
set "LOG_FILE=%OSTORY_GPU_ROOT%\logs\comfyui-h3-%COMFY_PORT%.log"
set "CLEANUP_SCRIPT=%~dp0windows_gpu_cleanup_port.ps1"
if not exist "%PYTHON_EXE%" (
  echo [ERROR] missing python embed: %PYTHON_EXE%
  exit /b 2
)
if not exist "%COMFYUI_MAIN%" (
  echo [ERROR] missing ComfyUI main.py: %COMFYUI_MAIN%
  exit /b 3
)
if not exist "%OSTORY_GPU_ROOT%\logs" mkdir "%OSTORY_GPU_ROOT%\logs"
if not exist "%CLEANUP_SCRIPT%" (
  echo [ERROR] missing cleanup script: %CLEANUP_SCRIPT%
  exit /b 4
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CLEANUP_SCRIPT%" -Port %COMFY_PORT% -PythonExe "%PYTHON_EXE%" -CommandMatch "%COMFYUI_MAIN%" -LogFile "%LOG_FILE%"
if errorlevel 1 (
  echo [ERROR] failed to prepare port %COMFY_PORT%. skip start.
  exit /b 5
)
if exist "%LOG_FILE%" echo [OSTORY] start comfyui-h3 %COMFY_PORT% at %date% %time% >> "%LOG_FILE%"
cd /d "%COMFYUI_ROOT%"
"%PYTHON_EXE%" -s "%COMFYUI_MAIN%" --listen 0.0.0.0 --port %COMFY_PORT% --lowvram --preview-method none --disable-auto-launch >> "%LOG_FILE%" 2>&1
endlocal
