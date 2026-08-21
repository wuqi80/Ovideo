@echo off
setlocal

set "MODE=%~1"
if "%MODE%"=="" set "MODE=readiness"
if /I not "%MODE%"=="readiness" if /I not "%MODE%"=="i2v" if /I not "%MODE%"=="infinitetalk" (
  echo Unsupported smoke mode: %MODE%
  exit /b 2
)

set "TASK_NAME=OSTORY-GPU-WanSmoke"
set "SMOKE_CMD=E:\OSTORY-GPU\windows_gpu_wan_smoke.cmd"

schtasks /End /TN "%TASK_NAME%" >nul 2>&1
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
schtasks /Create /SC ONCE /ST 23:59 /TN "%TASK_NAME%" /TR "cmd.exe /c %SMOKE_CMD% %MODE%" /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b 1

schtasks /Run /TN "%TASK_NAME%"
if errorlevel 1 exit /b 1

schtasks /Query /TN "%TASK_NAME%"
exit /b %errorlevel%
