@echo off
setlocal
if not exist E:\OSTORY-GPU\logs mkdir E:\OSTORY-GPU\logs
E:\OSTORY-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s -c "import json,pathlib,torch; pathlib.Path(r'E:\OSTORY-GPU\logs\cuda-verify.json').write_text(json.dumps({'torch':torch.__version__,'cuda_available':torch.cuda.is_available(),'cuda':torch.version.cuda,'device':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}), encoding='utf-8')" 2> E:\OSTORY-GPU\logs\cuda-verify.err
echo %errorlevel% > E:\OSTORY-GPU\logs\cuda-verify.exit
curl.exe -sS --max-time 20 --output E:\OSTORY-GPU\logs\comfyui-system-stats.json http://127.0.0.1:8188/system_stats 2> E:\OSTORY-GPU\logs\comfyui-system-stats.err
echo %errorlevel% > E:\OSTORY-GPU\logs\comfyui-system-stats.exit
curl.exe -sS --max-time 60 --output E:\OSTORY-GPU\logs\seedvr2-object-info.json http://127.0.0.1:8188/object_info 2> E:\OSTORY-GPU\logs\seedvr2-object-info.err
echo %errorlevel% > E:\OSTORY-GPU\logs\seedvr2-object-info.exit
endlocal
