@echo off
setlocal
schtasks.exe /End /TN "OSTORY-GPU-Video-Setup" >nul 2>&1
schtasks.exe /Create /TN "OSTORY-GPU-Video-Setup" /TR "cmd.exe /c E:\OSTORY-GPU\windows_gpu_video_setup.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Run /TN "OSTORY-GPU-Video-Setup"
exit /b %errorlevel%
