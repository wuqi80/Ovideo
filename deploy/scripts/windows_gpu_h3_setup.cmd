@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows_gpu_h3_setup.ps1" %*
exit /b %ERRORLEVEL%
