@echo off
setlocal
if not exist E:\MECHA-GPU mkdir E:\MECHA-GPU
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\MECHA-GPU\windows_gpu_node_diagnose.ps1 > E:\MECHA-GPU\diagnostics.log 2>&1
echo exit_code=%ERRORLEVEL%>> E:\MECHA-GPU\diagnostics.log
endlocal
