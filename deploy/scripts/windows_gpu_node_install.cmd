@echo off
setlocal
if not exist E:\MECHA-GPU\logs mkdir E:\MECHA-GPU\logs
start "MECHA GPU Installer" /b cmd.exe /c "powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\MECHA-GPU\windows_gpu_node_install.ps1 ^> E:\MECHA-GPU\logs\installer.log 2^>^&1 ^& echo exit_code=%%ERRORLEVEL%%^>^> E:\MECHA-GPU\logs\installer.log"
endlocal
