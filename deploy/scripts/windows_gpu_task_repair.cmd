@echo off
setlocal
if not exist E:\MECHA-GPU\logs mkdir E:\MECHA-GPU\logs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\MECHA-GPU\windows_gpu_task_repair.ps1 >> E:\MECHA-GPU\logs\task-repair-console.log 2>&1
exit /b %errorlevel%
