@echo off
setlocal

set "TASK_NAME=MECHA-GPU-WanSetup"
set "SETUP_CMD=E:\MECHA-GPU\windows_gpu_wan_setup.cmd"

schtasks /End /TN "%TASK_NAME%" >nul 2>&1
taskkill /F /IM aria2c.exe >nul 2>&1
taskkill /F /IM curl.exe >nul 2>&1
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
schtasks /Create /SC ONCE /ST 23:59 /TN "%TASK_NAME%" /TR "cmd.exe /c %SETUP_CMD%" /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b 1

schtasks /Run /TN "%TASK_NAME%"
if errorlevel 1 exit /b 1

schtasks /Query /TN "%TASK_NAME%"
exit /b %errorlevel%
