@echo off
setlocal
netsh advfirewall firewall delete rule name="OSTORY GPU ComfyUI LAN" >nul 2>&1
netsh advfirewall firewall add rule name="OSTORY GPU ComfyUI LAN" dir=in action=allow protocol=TCP localport=8188 remoteip=192.168.31.0/24 profile=any
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /End /TN "OSTORY-GPU-ComfyUI" >nul 2>&1
timeout.exe /t 3 /nobreak >nul
schtasks.exe /Run /TN "OSTORY-GPU-ComfyUI"
exit /b %errorlevel%
