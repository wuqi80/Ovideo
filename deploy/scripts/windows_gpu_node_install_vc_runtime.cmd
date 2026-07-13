@echo off
setlocal
E:\MECHA-GPU\downloads\vc_redist.x64.exe /install /quiet /norestart /log E:\MECHA-GPU\logs\vc-redist.log
echo %errorlevel% > E:\MECHA-GPU\logs\vc-redist.exit
endlocal
