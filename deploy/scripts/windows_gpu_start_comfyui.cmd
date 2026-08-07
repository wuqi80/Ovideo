@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set OMP_NUM_THREADS=16
set MKL_NUM_THREADS=16
set OPENBLAS_NUM_THREADS=16
set NUMEXPR_MAX_THREADS=16
set COMFY_PORT=8188
set COMFY_ROOT=E:\MECHA-GPU\ComfyUI_windows_portable
set PYTHON_EXE=%COMFY_ROOT%\python_embeded\python.exe
set COMFY_MAIN=%COMFY_ROOT%\ComfyUI\main.py
set LOG_FILE=E:\MECHA-GPU\logs\comfyui.log
set CLEANUP_SCRIPT=%~dp0windows_gpu_cleanup_port.ps1
if not exist "%COMFY_ROOT%\python_embeded\python.exe" (
  echo [ERROR] missing python embed: E:\MECHA-GPU\ComfyUI_windows_portable\python_embeded\python.exe
  exit /b 2
)
if not exist "%COMFY_MAIN%" (
  echo [ERROR] missing ComfyUI main.py: E:\MECHA-GPU\ComfyUI_windows_portable\ComfyUI\main.py
  exit /b 3
)
if not exist "E:\MECHA-GPU\logs" mkdir E:\MECHA-GPU\logs
if not exist "%CLEANUP_SCRIPT%" (
  echo [ERROR] missing cleanup script: %CLEANUP_SCRIPT%
  exit /b 4
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CLEANUP_SCRIPT%" -Port %COMFY_PORT% -PythonExe "%PYTHON_EXE%" -CommandMatch "%COMFY_MAIN%" -LogFile "%LOG_FILE%"
if errorlevel 1 (
  echo [ERROR] failed to prepare port %COMFY_PORT%. skip start.
  exit /b 5
)
echo [MECHA] start comfyui %COMFY_PORT% at %date% %time% >> "%LOG_FILE%"
cd /d "%COMFY_ROOT%"
"%PYTHON_EXE%" -s "%COMFY_MAIN%" --listen 0.0.0.0 --port %COMFY_PORT% --lowvram --preview-method none --disable-auto-launch >> "%LOG_FILE%" 2>&1
endlocal
