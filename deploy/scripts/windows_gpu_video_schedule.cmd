@echo off
setlocal
schtasks.exe /End /TN "MECHA-GPU-Video-Setup" >nul 2>&1
schtasks.exe /Create /TN "MECHA-GPU-Video-Setup" /TR "cmd.exe /c E:\MECHA-GPU\windows_gpu_video_setup.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Run /TN "MECHA-GPU-Video-Setup"
exit /b %errorlevel%
