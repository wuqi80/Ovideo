@echo off
setlocal enabledelayedexpansion
if not exist E:\MECHA-GPU\logs mkdir E:\MECHA-GPU\logs
echo timestamp,utilization.gpu,memory.used,memory.total,power.draw > E:\MECHA-GPU\logs\gpu-monitor.csv
for /L %%I in (1,1,180) do (
  nvidia-smi.exe --query-gpu=timestamp,utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader,nounits >> E:\MECHA-GPU\logs\gpu-monitor.csv
  ping.exe 127.0.0.1 -n 2 >nul
)
endlocal
