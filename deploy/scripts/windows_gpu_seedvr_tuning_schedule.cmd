@echo off
setlocal
for %%T in (MECHA-GPU-Monitor MECHA-GPU-SeedVR-Tuning) do (
  schtasks.exe /End /TN "%%T" >nul 2>&1
  schtasks.exe /Delete /TN "%%T" /F >nul 2>&1
)
schtasks.exe /Create /TN "MECHA-GPU-Monitor" /TR "cmd.exe /c E:\MECHA-GPU\windows_gpu_monitor.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Create /TN "MECHA-GPU-SeedVR-Tuning" /TR "cmd.exe /c E:\MECHA-GPU\windows_gpu_seedvr_tuning_smoke.cmd" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /Run /TN "MECHA-GPU-Monitor"
schtasks.exe /Run /TN "MECHA-GPU-SeedVR-Tuning"
exit /b %errorlevel%
