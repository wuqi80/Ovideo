@echo off
setlocal
for %%T in (OSTORY-GPU-Monitor OSTORY-GPU-SeedVR-Tuning) do (
  schtasks.exe /End /TN "%%T" >nul 2>&1
  schtasks.exe /Delete /TN "%%T" /F >nul 2>&1
)
schtasks.exe /Create /TN "OSTORY-GPU-Monitor" /TR "cmd.exe /c E:\OSTORY-GPU\windows_gpu_monitor.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Create /TN "OSTORY-GPU-SeedVR-Tuning" /TR "cmd.exe /c E:\OSTORY-GPU\windows_gpu_seedvr_tuning_smoke.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Run /TN "OSTORY-GPU-Monitor"
schtasks.exe /Run /TN "OSTORY-GPU-SeedVR-Tuning"
exit /b %errorlevel%
