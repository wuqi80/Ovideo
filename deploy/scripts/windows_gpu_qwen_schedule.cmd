@echo off
setlocal
schtasks.exe /End /TN "MECHA-GPU-Qwen-Setup" >nul 2>&1
schtasks.exe /Create /TN "MECHA-GPU-Qwen-Setup" /TR "cmd.exe /c E:\MECHA-GPU\windows_gpu_qwen_setup.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Run /TN "MECHA-GPU-Qwen-Setup"
exit /b %errorlevel%
