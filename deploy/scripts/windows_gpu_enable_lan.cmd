@echo off
setlocal
netsh advfirewall firewall delete rule name="MECHA GPU ComfyUI LAN" >nul 2>&1
netsh advfirewall firewall add rule name="MECHA GPU ComfyUI LAN" dir=in action=allow protocol=TCP localport=8188,8189 remoteip=192.168.31.0/24 profile=any
if errorlevel 1 exit /b %errorlevel%
schtasks.exe /End /TN "MECHA-GPU-ComfyUI" >nul 2>&1
timeout.exe /t 3 /nobreak >nul
schtasks.exe /Run /TN "MECHA-GPU-ComfyUI"
exit /b %errorlevel%
