@echo off
setlocal
schtasks.exe /End /TN "MECHA-GPU-SeedVR-Smoke" >nul 2>&1
schtasks.exe /Delete /TN "MECHA-GPU-SeedVR-Smoke" /F >nul 2>&1
schtasks.exe /Create /TN "MECHA-GPU-SeedVR-Smoke" /TR "cmd.exe /c E:\MECHA-GPU\windows_gpu_seedvr_smoke.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Run /TN "MECHA-GPU-SeedVR-Smoke"
exit /b %errorlevel%
