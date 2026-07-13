@echo off
setlocal
if not exist E:\MECHA-GPU\logs mkdir E:\MECHA-GPU\logs
(
  echo ==== TIME ====
  echo %date% %time%
  echo ==== PROCESSES ====
  tasklist.exe /v
  echo ==== TASKS ====
  schtasks.exe /Query /TN "MECHA-GPU-Installer" /V /FO LIST
  schtasks.exe /Query /TN "MECHA-GPU-ComfyUI" /V /FO LIST
  schtasks.exe /Query /TN "MECHA-GPU-Agent" /V /FO LIST
  echo ==== FILES ====
  dir E:\MECHA-GPU\downloads
  dir E:\MECHA-GPU
) > E:\MECHA-GPU\logs\node-status.txt 2>&1
endlocal
