@echo off
setlocal
E:\OSTORY-GPU\downloads\vc_redist.x64.exe /install /quiet /norestart /log E:\OSTORY-GPU\logs\vc-redist.log
echo %errorlevel% > E:\OSTORY-GPU\logs\vc-redist.exit
endlocal
