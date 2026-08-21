@echo off
setlocal
schtasks.exe /End /TN "OSTORY-GPU-Installer" >nul 2>&1
schtasks.exe /Create /TN "OSTORY-GPU-Installer" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\OSTORY-GPU\windows_gpu_node_install.ps1" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
icacls.exe E:\OSTORY-GPU\config\agent-token.txt /inheritance:r /grant:r SYSTEM:F Administrators:F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Run /TN "OSTORY-GPU-Installer"
exit /b %errorlevel%
