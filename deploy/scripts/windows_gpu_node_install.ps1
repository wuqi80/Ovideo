param(
    [string]$InstallRoot = "E:\MECHA-GPU",
    [string]$ServerUrl = "https://mecha.one"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Downloads = Join-Path $InstallRoot "downloads"
$Logs = Join-Path $InstallRoot "logs"
$Config = Join-Path $InstallRoot "config"
$AgentDir = Join-Path $InstallRoot "agent"
$PortableDir = Join-Path $InstallRoot "ComfyUI_windows_portable"
$ComfyDir = Join-Path $PortableDir "ComfyUI"
$Python = Join-Path $PortableDir "python_embeded\python.exe"
$Curl = Join-Path $env:SystemRoot "System32\curl.exe"
$PipIndex = if ($env:MECHA_PIP_INDEX_URL) { $env:MECHA_PIP_INDEX_URL } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }

New-Item -ItemType Directory -Force -Path $InstallRoot, $Downloads, $Logs, $Config, $AgentDir | Out-Null

trap {
    $message = "[{0}] INSTALL FAILED: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message
    Add-Content -Path (Join-Path $Logs "install-progress.log") -Value $message -Encoding UTF8
    Set-Content -Path (Join-Path $InstallRoot "install-failed.txt") -Value $message -Encoding UTF8
    exit 1
}

function Write-Step {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Output $line
    Add-Content -Path (Join-Path $Logs "install-progress.log") -Value $line -Encoding UTF8
}

function Download-File {
    param([string]$Url, [string]$Destination)

    if (Test-Path $Destination) {
        Write-Step "Reusing download: $Destination"
        return
    }
    Write-Step "Downloading $Url"
    & $Curl --location --fail --retry 5 --retry-delay 5 --continue-at - --output $Destination $Url
    if ($LASTEXITCODE -ne 0) {
        throw "Download failed with exit code ${LASTEXITCODE}: $Url"
    }
}

function Install-ZipNode {
    param(
        [string]$Name,
        [string]$Url,
        [string]$TargetName
    )

    $target = Join-Path "$ComfyDir\custom_nodes" $TargetName
    if (Test-Path $target) {
        Write-Step "Custom node already present: $TargetName"
        return
    }

    $zip = Join-Path $Downloads "$Name.zip"
    $extract = Join-Path $Downloads "$Name-extract"
    Download-File -Url $Url -Destination $zip
    Remove-Item -Recurse -Force $extract -ErrorAction SilentlyContinue
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $source = Get-ChildItem $extract -Directory | Select-Object -First 1
    if (-not $source) {
        throw "No extracted directory found for $Name"
    }
    Move-Item $source.FullName $target
}

Write-Step "Starting MECHA GPU node installation"

$archive = Join-Path $Downloads "ComfyUI_windows_portable_nvidia_cu126.7z"
$sevenZip = Join-Path $Downloads "7zr.exe"

if (-not (Test-Path $Python)) {
    Download-File `
        -Url "https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia_cu126.7z" `
        -Destination $archive
    Download-File -Url "https://www.7-zip.org/a/7zr.exe" -Destination $sevenZip
    Write-Step "Extracting ComfyUI portable"
    & $sevenZip x $archive "-o$InstallRoot" -y
    if ($LASTEXITCODE -ne 0) {
        throw "ComfyUI extraction failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path $Python)) {
    throw "Embedded Python was not found after extraction: $Python"
}

Write-Step "Installing SeedVR2 custom node"
Install-ZipNode `
    -Name "seedvr2" `
    -Url "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler/archive/refs/heads/main.zip" `
    -TargetName "seedvr2_videoupscaler"

$seedRequirements = Join-Path $ComfyDir "custom_nodes\seedvr2_videoupscaler\requirements.txt"
if (Test-Path $seedRequirements) {
    Write-Step "Installing SeedVR2 Python dependencies"
    & $Python -s -m pip install --index-url $PipIndex --timeout 60 --retries 3 -r $seedRequirements
    if ($LASTEXITCODE -ne 0) {
        throw "SeedVR2 dependency installation failed with exit code $LASTEXITCODE"
    }
}

# ComfyUI portable currently bundles a Transformers 5.x build that breaks
# Diffusers' optional flash-attention detection on Windows. Keep SeedVR2 on
# the last stable 4.x line until the upstream packages converge.
Write-Step "Pinning SeedVR2-compatible Transformers runtime"
& $Python -s -m pip install --index-url $PipIndex --timeout 60 --retries 3 "transformers==4.57.6"
if ($LASTEXITCODE -ne 0) {
    throw "Transformers compatibility pin failed with exit code $LASTEXITCODE"
}

Write-Step "Installing Agent Python dependencies"
& $Python -s -m pip install --index-url $PipIndex --timeout 60 --retries 3 requests pillow
if ($LASTEXITCODE -ne 0) {
    throw "Agent dependency installation failed with exit code $LASTEXITCODE"
}

$modelDir = Join-Path $ComfyDir "models\SEEDVR2"
New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
$modelPath = Join-Path $modelDir "seedvr2_ema_3b_fp8_e4m3fn.safetensors"
$modelCache = Join-Path $Downloads "seedvr2_ema_3b_fp8_e4m3fn.safetensors"
if ((Test-Path $modelCache) -and -not (Test-Path $modelPath)) {
    Write-Step "Installing SeedVR2 model from local download cache"
    Copy-Item $modelCache $modelPath
} else {
    Download-File `
        -Url "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/seedvr2_ema_3b_fp8_e4m3fn.safetensors?download=true" `
        -Destination $modelPath
}

$vaePath = Join-Path $modelDir "ema_vae_fp16.safetensors"
$vaeCache = Join-Path $Downloads "ema_vae_fp16.safetensors"
if ((Test-Path $vaeCache) -and -not (Test-Path $vaePath)) {
    Write-Step "Installing SeedVR2 VAE from local download cache"
    Copy-Item $vaeCache $vaePath
} else {
    Download-File `
        -Url "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/ema_vae_fp16.safetensors?download=true" `
        -Destination $vaePath
}

$startComfy = @'
@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set OMP_NUM_THREADS=16
set MKL_NUM_THREADS=16
set OPENBLAS_NUM_THREADS=16
set NUMEXPR_MAX_THREADS=16
cd /d E:\MECHA-GPU\ComfyUI_windows_portable
python_embeded\python.exe -s ComfyUI\main.py --listen 0.0.0.0 --port 8188 --lowvram --preview-method none --disable-auto-launch >> E:\MECHA-GPU\logs\comfyui.log 2>&1
endlocal
'@
Set-Content -Path (Join-Path $InstallRoot "start_comfyui.cmd") -Value $startComfy -Encoding ASCII

Write-Step "Allowing ComfyUI UI from the local subnet only"
Get-NetFirewallRule -DisplayName "MECHA GPU ComfyUI LAN" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule `
    -DisplayName "MECHA GPU ComfyUI LAN" `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 8188 `
    -RemoteAddress "192.168.31.0/24" `
    -Profile Any | Out-Null

$startAgent = @'
@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set MECHA_GPU_ROOT=E:\MECHA-GPU
set MECHA_SERVER_URL=https://mecha.one
set MECHA_COMFYUI_PORTS=8188
E:\MECHA-GPU\ComfyUI_windows_portable\python_embeded\python.exe -s E:\MECHA-GPU\agent\windows_gpu_agent_runner.py >> E:\MECHA-GPU\logs\agent.log 2>&1
endlocal
'@
Set-Content -Path (Join-Path $InstallRoot "start_agent.cmd") -Value $startAgent -Encoding ASCII

$setupTasks = @'
@echo off
schtasks.exe /Create /TN "MECHA-GPU-ComfyUI" /TR "cmd.exe /c E:\MECHA-GPU\start_comfyui.cmd" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks.exe /Create /TN "MECHA-GPU-Agent" /TR "cmd.exe /c E:\MECHA-GPU\start_agent.cmd" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks.exe /Run /TN "MECHA-GPU-ComfyUI"
if exist E:\MECHA-GPU\config\agent-token.txt schtasks.exe /Run /TN "MECHA-GPU-Agent"
'@
Set-Content -Path (Join-Path $InstallRoot "register_startup_tasks.cmd") -Value $setupTasks -Encoding ASCII

Write-Step "Verifying CUDA-enabled PyTorch"
$cudaReport = & $Python -s -c "import json, torch; print(json.dumps({'torch': torch.__version__, 'cuda_available': torch.cuda.is_available(), 'cuda': torch.version.cuda, 'device': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))"
Set-Content -Path (Join-Path $InstallRoot "cuda-report.json") -Value $cudaReport -Encoding UTF8

Write-Step "Installation completed"
Set-Content -Path (Join-Path $InstallRoot "install-complete.txt") -Value (Get-Date).ToString("o") -Encoding ASCII
