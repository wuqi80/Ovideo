@echo off
setlocal
if not exist E:\OSTORY-GPU\logs mkdir E:\OSTORY-GPU\logs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\OSTORY-GPU\windows_gpu_qwen_setup.ps1 >> E:\OSTORY-GPU\logs\qwen-setup-console.log 2>&1
exit /b %errorlevel%
