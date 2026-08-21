param(
    [string]$InstallRoot = "E:\OSTORY-GPU"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Downloads = Join-Path $InstallRoot "downloads"
$Logs = Join-Path $InstallRoot "logs"
$PortableDir = Join-Path $InstallRoot "ComfyUI_windows_portable"
$ComfyDir = Join-Path $PortableDir "ComfyUI"
$Python = Join-Path $PortableDir "python_embeded\python.exe"
$Curl = Join-Path $env:SystemRoot "System32\curl.exe"
$PipIndex = if ($env:OSTORY_PIP_INDEX_URL) { $env:OSTORY_PIP_INDEX_URL } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }
$LogFile = Join-Path $Logs "qwen-setup.log"
$ServicesStopped = $false

New-Item -ItemType Directory -Force -Path $Downloads, $Logs | Out-Null

function Write-Step {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Output $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Stop-GpuServices {
    Write-Step "Stopping GPU2 Agent and ComfyUI before dependency changes"
    schtasks.exe /End /TN "OSTORY-GPU-Agent" 2>$null | Out-Null
    schtasks.exe /End /TN "OSTORY-GPU-ComfyUI" 2>$null | Out-Null
    Start-Sleep -Seconds 5
    $script:ServicesStopped = $true
}

function Start-GpuServices {
    Write-Step "Starting GPU2 ComfyUI and Agent"
    schtasks.exe /Run /TN "OSTORY-GPU-ComfyUI" | Out-Null
    Start-Sleep -Seconds 8
    schtasks.exe /Run /TN "OSTORY-GPU-Agent" | Out-Null
    $script:ServicesStopped = $false
}

trap {
    $line = "[{0}] QWEN SETUP FAILED: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    if ($script:ServicesStopped) {
        try { Start-GpuServices } catch { }
    }
    exit 1
}

function Download-File {
    param([string]$Url, [string]$Destination)
    if (Test-Path $Destination) {
        Write-Step "Reusing existing file: $Destination"
        return
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null
    $partial = "$Destination.part"
    Write-Step "Downloading $Url"
    & $Curl --location --fail --retry 20 --retry-all-errors --retry-delay 10 --connect-timeout 30 --continue-at - --output $partial $Url
    if ($LASTEXITCODE -ne 0) {
        throw "Download failed with exit code ${LASTEXITCODE}: $Url"
    }
    Move-Item -Force $partial $Destination
}

function Install-ZipNode {
    param([string]$Name, [string]$Url, [string]$TargetName)
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

Write-Step "Starting Qwen Image Edit setup for GPU2"
Install-ZipNode `
    -Name "comfyui-layerstyle" `
    -Url "https://github.com/chflame163/ComfyUI_LayerStyle/archive/refs/heads/main.zip" `
    -TargetName "ComfyUI_LayerStyle"

Stop-GpuServices

$requirements = Join-Path $ComfyDir "custom_nodes\ComfyUI_LayerStyle\requirements.txt"
if (Test-Path $requirements) {
    Write-Step "Installing LayerStyle dependencies"
    & $Python -s -m pip install --index-url $PipIndex --timeout 90 --retries 5 -r $requirements
    if ($LASTEXITCODE -ne 0) {
        throw "LayerStyle dependency installation failed with exit code $LASTEXITCODE"
    }
}

# Keep the SeedVR2-compatible Transformers line while satisfying LayerStyle.
& $Python -s -m pip install --index-url $PipIndex --timeout 90 --retries 5 "transformers==4.57.6"
if ($LASTEXITCODE -ne 0) {
    throw "Transformers compatibility pin failed with exit code $LASTEXITCODE"
}

$models = @(
    @{
        Url = "https://modelscope.cn/models/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/master/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors"
        Path = Join-Path $ComfyDir "models\diffusion_models\qwen_image_edit_2509_fp8_e4m3fn.safetensors"
    },
    @{
        Url = "https://modelscope.cn/models/Comfy-Org/Qwen-Image_ComfyUI/resolve/master/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors"
        Path = Join-Path $ComfyDir "models\text_encoders\qwen_2.5_vl_7b_fp8_scaled.safetensors"
    },
    @{
        Url = "https://modelscope.cn/models/Comfy-Org/Qwen-Image_ComfyUI/resolve/master/split_files/vae/qwen_image_vae.safetensors"
        Path = Join-Path $ComfyDir "models\vae\qwen_image_vae.safetensors"
    },
    @{
        Url = "https://modelscope.cn/models/lightx2v/Qwen-Image-Lightning/resolve/master/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors"
        Path = Join-Path $ComfyDir "models\loras\Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors"
    }
)

foreach ($model in $models) {
    Download-File -Url $model.Url -Destination $model.Path
}

$workflowDir = Join-Path $ComfyDir "user\default\workflows"
New-Item -ItemType Directory -Force -Path $workflowDir | Out-Null
Download-File `
    -Url "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2509.json" `
    -Destination (Join-Path $workflowDir "OSTORY-Qwen-Image-Edit-2509-GPU2-Test.json")

Start-GpuServices

$deadline = (Get-Date).AddMinutes(5)
do {
    Start-Sleep -Seconds 5
    try {
        $objectInfo = Invoke-RestMethod -Uri "http://127.0.0.1:8188/object_info" -TimeoutSec 20
    } catch {
        $objectInfo = $null
    }
} while (-not $objectInfo -and (Get-Date) -lt $deadline)

if (-not $objectInfo) {
    throw "ComfyUI did not become ready after Qwen setup"
}

$requiredNodes = @(
    "LayerUtility: ImageScaleByAspectRatio V2",
    "TextEncodeQwenImageEditPlus",
    "CFGNorm"
)
$nodeStatus = @{}
foreach ($nodeName in $requiredNodes) {
    $nodeStatus[$nodeName] = $null -ne $objectInfo.PSObject.Properties[$nodeName]
}
$report = @{
    completed_at = (Get-Date).ToString("o")
    ui_url = "http://192.168.31.134:8188"
    nodes = $nodeStatus
    models = @($models | ForEach-Object { @{ path = $_.Path; size = (Get-Item $_.Path).Length } })
} | ConvertTo-Json -Depth 5
Set-Content -Path (Join-Path $InstallRoot "qwen-setup-report.json") -Value $report -Encoding UTF8

if ($nodeStatus.Values -contains $false) {
    throw "One or more required Qwen nodes are still unavailable"
}

Write-Step "Qwen Image Edit setup completed"
