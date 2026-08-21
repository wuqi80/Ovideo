@echo off
setlocal
if not exist E:\OSTORY-GPU\logs mkdir E:\OSTORY-GPU\logs
set "SCRIPT_PATH=E:\OSTORY-GPU\windows_gpu_task_repair.ps1"
if not exist "%SCRIPT_PATH%" set "SCRIPT_PATH=E:\OSTORY-GPU\scripts\windows_gpu_task_repair.ps1"
if not exist "%SCRIPT_PATH%" (
  echo [ERROR] windows_gpu_task_repair.ps1 was not found.
  echo [ERROR] Checked:
  echo [ERROR] - E:\OSTORY-GPU\windows_gpu_task_repair.ps1
  echo [ERROR] - E:\OSTORY-GPU\scripts\windows_gpu_task_repair.ps1
  exit /b 1
)
set "SERVER_URL=%~1"
if not defined SERVER_URL set "SERVER_URL=https://tv.ostory.ai"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PATH%" -ServerUrl "%SERVER_URL%" >> E:\OSTORY-GPU\logs\task-repair-console.log 2>&1
exit /b %errorlevel%
