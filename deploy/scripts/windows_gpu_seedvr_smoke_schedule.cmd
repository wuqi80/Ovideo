@echo off
setlocal
schtasks.exe /End /TN "OSTORY-GPU-SeedVR-Smoke" >nul 2>&1
schtasks.exe /Delete /TN "OSTORY-GPU-SeedVR-Smoke" /F >nul 2>&1
schtasks.exe /Create /TN "OSTORY-GPU-SeedVR-Smoke" /TR "cmd.exe /c E:\OSTORY-GPU\windows_gpu_seedvr_smoke.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Run /TN "OSTORY-GPU-SeedVR-Smoke"
exit /b %errorlevel%
