@echo off
setlocal
if not exist E:\MECHA-GPU\logs mkdir E:\MECHA-GPU\logs
set "SCRIPT_PATH=E:\MECHA-GPU\windows_gpu_task_repair.ps1"
if not exist "%SCRIPT_PATH%" set "SCRIPT_PATH=E:\MECHA-GPU\scripts\windows_gpu_task_repair.ps1"
if not exist "%SCRIPT_PATH%" (
  echo [ERROR] 找不到 windows_gpu_task_repair.ps1，请确认部署脚本路径：
  echo [ERROR] 已尝试:
  echo [ERROR] - E:\MECHA-GPU\windows_gpu_task_repair.ps1
  echo [ERROR] - E:\MECHA-GPU\scripts\windows_gpu_task_repair.ps1
  exit /b 1
)
set "SERVER_URL=%~1"
if not defined SERVER_URL set "SERVER_URL=https://192.168.31.134"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PATH%" -ServerUrl "%SERVER_URL%" >> E:\MECHA-GPU\logs\task-repair-console.log 2>&1
exit /b %errorlevel%
