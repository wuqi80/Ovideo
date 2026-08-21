@echo off
setlocal
if not exist E:\OSTORY-GPU\logs mkdir E:\OSTORY-GPU\logs
(
  echo ==== TIME ====
  echo %date% %time%
  echo ==== PROCESSES ====
  tasklist.exe /v
  echo ==== TASKS ====
  schtasks.exe /Query /TN "OSTORY-GPU-Installer" /V /FO LIST
  schtasks.exe /Query /TN "OSTORY-GPU-ComfyUI" /V /FO LIST
  schtasks.exe /Query /TN "OSTORY-GPU-Agent" /V /FO LIST
  echo ==== FILES ====
  dir E:\OSTORY-GPU\downloads
  dir E:\OSTORY-GPU
) > E:\OSTORY-GPU\logs\node-status.txt 2>&1
endlocal
