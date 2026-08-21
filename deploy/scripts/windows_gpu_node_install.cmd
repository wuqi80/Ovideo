@echo off
setlocal
if not exist E:\OSTORY-GPU\logs mkdir E:\OSTORY-GPU\logs
start "OSTORY GPU Installer" /b cmd.exe /c "powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\OSTORY-GPU\windows_gpu_node_install.ps1 ^> E:\OSTORY-GPU\logs\installer.log 2^>^&1 ^& echo exit_code=%%ERRORLEVEL%%^>^> E:\OSTORY-GPU\logs\installer.log"
endlocal
