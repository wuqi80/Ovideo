@echo off
setlocal
if not exist E:\OSTORY-GPU mkdir E:\OSTORY-GPU
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\OSTORY-GPU\windows_gpu_node_diagnose.ps1 > E:\OSTORY-GPU\diagnostics.log 2>&1
echo exit_code=%ERRORLEVEL%>> E:\OSTORY-GPU\diagnostics.log
endlocal
