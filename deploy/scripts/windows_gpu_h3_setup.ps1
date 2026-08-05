param(
    [string]$InstallRoot = "E:\MECHA-GPU",
    [int]$Port = 8189,
    [switch]$SkipModelDownloads,
    [switch]$ForceRefreshComfyUI,
    [switch]$NoAgentRestart,
    [string]$HuggingFaceToken = $env:HF_TOKEN,
    [string]$HuggingFaceEndpoint = $env:HF_ENDPOINT
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$PortableRoot = Join-Path $InstallRoot "ComfyUI_windows_portable"
$SourcePythonRoot = Join-Path $PortableRoot "python_embeded"
$H3Root = Join-Path $InstallRoot "ComfyUI-H3"
$H3PythonRoot = Join-Path $H3Root "python_embeded"
$H3Python = Join-Path $H3PythonRoot "python.exe"
$ComfyRoot = Join-Path $H3Root "ComfyUI"
$Downloads = Join-Path $InstallRoot "downloads\h3"
$Logs = Join-Path $InstallRoot "logs"
$ScriptsRoot = Join-Path $InstallRoot "scripts"
$LogFile = Join-Path $Logs "h3-setup.log"
$ReportFile = Join-Path $InstallRoot "h3-readiness-report.json"
$StartCmd = Join-Path $ScriptsRoot "windows_gpu_start_h3_comfyui.cmd"
$AgentStartCmd = Join-Path $ScriptsRoot "windows_gpu_start_agent.cmd"
$LegacyAgentStartCmd = Join-Path $InstallRoot "start_agent.cmd"
$Curl = Join-Path $env:SystemRoot "System32\curl.exe"
$PipIndex = if ($env:MECHA_PIP_INDEX_URL) { $env:MECHA_PIP_INDEX_URL } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }
$RequiredNodes = @(
    "MiniMaxH3ImageToVideo",
    "UNETLoader",
    "CLIPLoader",
    "VAELoader",
    "VAEDecode",
    "VAEDecodeAudio",
    "BasicScheduler",
    "KSamplerSelect",
    "SamplerCustomAdvanced",
    "BasicGuider",
    "RandomNoise",
    "CreateVideo",
    "SaveVideo"
)
$ModelFiles = @(
    "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vae/minimax_h3_video_vae_fp16.safetensors",
    "vae/minimax_h3_audio_vae_fp32.safetensors"
)

New-Item -ItemType Directory -Force -Path $Downloads, $Logs, $ScriptsRoot | Out-Null

function Write-Step {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Output $line
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Assert-Path {
    param([string]$Path, [string]$Message)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Message`: $Path"
    }
}

function Ensure-H3Python {
    Assert-Path -Path $SourcePythonRoot -Message "Source portable Python not found"
    if (Test-Path -LiteralPath $H3Python) {
        Write-Step "H3 isolated Python already present: $H3Python"
        return
    }
    Write-Step "Copying isolated Python runtime for H3. Existing 8188 Python will not be modified."
    New-Item -ItemType Directory -Force -Path $H3Root | Out-Null
    Copy-Item -LiteralPath $SourcePythonRoot -Destination $H3PythonRoot -Recurse -Force
}

function Install-ComfyUI {
    if ((Test-Path -LiteralPath (Join-Path $ComfyRoot "main.py")) -and -not $ForceRefreshComfyUI) {
        Write-Step "H3 ComfyUI checkout already present: $ComfyRoot"
        return
    }
    $zip = Join-Path $Downloads "ComfyUI-master.zip"
    Write-Step "Downloading latest ComfyUI for H3 sidecar"
    & $Curl --location --fail --retry 12 --retry-all-errors --retry-delay 5 --output $zip "https://github.com/comfyanonymous/ComfyUI/archive/refs/heads/master.zip"
    if ($LASTEXITCODE -ne 0) {
        throw "ComfyUI download failed"
    }
    $extractRoot = Join-Path $Downloads "comfyui-extract"
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $zip -DestinationPath $extractRoot -Force
    $source = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $source) {
        throw "ComfyUI archive did not contain a directory"
    }
    if (Test-Path -LiteralPath $ComfyRoot) {
        Move-Item -LiteralPath $ComfyRoot -Destination "$ComfyRoot.bak.$(Get-Date -Format yyyyMMddHHmmss)"
    }
    Move-Item -LiteralPath $source.FullName -Destination $ComfyRoot
}

function Install-PythonRequirements {
    Assert-Path -Path $H3Python -Message "H3 Python not found"
    Assert-Path -Path (Join-Path $ComfyRoot "requirements.txt") -Message "ComfyUI requirements not found"
    Write-Step "Installing H3 ComfyUI Python requirements"
    & $H3Python -s -m pip install --disable-pip-version-check --index-url $PipIndex --timeout 120 --retries 12 -r (Join-Path $ComfyRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "ComfyUI requirements install failed"
    }
    Write-Step "Installing HuggingFace downloader helpers"
    & $H3Python -s -m pip install --disable-pip-version-check --index-url $PipIndex --timeout 120 --retries 12 "huggingface_hub[hf_xet]"
    if ($LASTEXITCODE -ne 0) {
        throw "huggingface_hub install failed"
    }
}

function Download-H3Models {
    if ($SkipModelDownloads) {
        Write-Step "Skipping H3 model downloads by request"
        return
    }
    $modelsRoot = Join-Path $ComfyRoot "models"
    New-Item -ItemType Directory -Force -Path $modelsRoot | Out-Null
    $endpoints = New-Object System.Collections.Generic.List[string]
    if ($HuggingFaceEndpoint) {
        $endpoints.Add($HuggingFaceEndpoint)
    }
    $endpoints.Add("https://hf-mirror.com")
    $endpoints.Add("https://huggingface.co")
    $uniqueEndpoints = $endpoints | Select-Object -Unique
    $downloadLog = Join-Path $Logs "h3-download.log"
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting MiniMax H3 model downloads" | Add-Content -LiteralPath $downloadLog -Encoding UTF8

    foreach ($relativePath in $ModelFiles) {
        $windowsRelativePath = $relativePath -replace "/", "\"
        $target = Join-Path $modelsRoot $windowsRelativePath
        $targetDir = Split-Path -Parent $target
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
        if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Length -gt 0)) {
            Write-Step "H3 model already present: $relativePath"
            continue
        }

        $downloaded = $false
        foreach ($endpoint in $uniqueEndpoints) {
            $base = $endpoint.TrimEnd("/")
            $url = "$base/Comfy-Org/MiniMax-H3/resolve/main/$relativePath"
            Write-Step "Downloading H3 model via ${base}: $relativePath"
            "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] curl $url -> $target" | Add-Content -LiteralPath $downloadLog -Encoding UTF8
            & curl.exe `
                -L `
                --fail `
                --retry 12 `
                --retry-all-errors `
                --retry-delay 10 `
                --connect-timeout 30 `
                --speed-time 60 `
                --speed-limit 1024 `
                --continue-at - `
                --output "$target" `
                "$url" 2>&1 | Tee-Object -FilePath $downloadLog -Append
            $curlExit = $LASTEXITCODE
            if ($curlExit -eq 0 -and (Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Length -gt 0)) {
                Write-Step "Downloaded H3 model: $relativePath"
                $downloaded = $true
                break
            }
            Write-Step "H3 model download attempt failed with curl exit ${curlExit}: $relativePath"
        }
        if (-not $downloaded) {
            throw "MiniMax H3 model download failed: $relativePath"
        }
    }
}

function Install-H3StartCommand {
    @"
@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "MECHA_GPU_ROOT=$InstallRoot"
set "COMFYUI_ROOT=$ComfyRoot"
set "PYTHON_EXE=$H3Python"
if not exist "$Logs" mkdir "$Logs"
cd /d "%COMFYUI_ROOT%"
"%PYTHON_EXE%" -s main.py --listen 0.0.0.0 --port $Port --lowvram --preview-method none --disable-auto-launch >> "$Logs\comfyui-h3-$Port.log" 2>&1
endlocal
"@ | Set-Content -LiteralPath $StartCmd -Encoding ASCII
}

function Update-AgentPortList {
    [Environment]::SetEnvironmentVariable("MECHA_COMFYUI_PORTS", "8188,$Port", "Machine")
    foreach ($candidate in @($AgentStartCmd, $LegacyAgentStartCmd)) {
        if (-not (Test-Path -LiteralPath $candidate)) {
            continue
        }
        $source = Get-Content -LiteralPath $candidate -Raw -Encoding UTF8
        $updated = $source -replace "set MECHA_COMFYUI_PORTS=.*", "set MECHA_COMFYUI_PORTS=8188,$Port"
        if ($updated -ne $source) {
            Write-Step "Updating Agent startup command ports to 8188,${Port}: $candidate"
            Set-Content -LiteralPath $candidate -Value $updated -Encoding UTF8
        }
    }
}

function Ensure-H3FirewallRule {
    Write-Step "Allowing H3 ComfyUI from the local subnet only on port $Port"
    Get-NetFirewallRule -DisplayName "MECHA GPU ComfyUI H3 LAN" -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule `
        -DisplayName "MECHA GPU ComfyUI H3 LAN" `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $Port `
        -RemoteAddress "192.168.31.0/24" `
        -Profile Any | Out-Null
}

function Register-H3ScheduledTask {
    Write-Step "Registering startup task MECHA-GPU-ComfyUI-H3"
    schtasks.exe /Create /F /TN "MECHA-GPU-ComfyUI-H3" /SC ONSTART /RL HIGHEST /RU SYSTEM /TR "`"$StartCmd`""
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to register MECHA-GPU-ComfyUI-H3 scheduled task"
    }
}

function Test-H3Readiness {
    Write-Step "Starting H3 ComfyUI on port $Port"
    schtasks.exe /Run /TN "MECHA-GPU-ComfyUI-H3" | Out-Null
    $baseUrl = "http://127.0.0.1:$Port"
    $deadline = (Get-Date).AddMinutes(10)
    $systemStatsOk = $false
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-RestMethod -Uri "$baseUrl/system_stats" -TimeoutSec 10 | Out-Null
            $systemStatsOk = $true
            break
        } catch {
            Start-Sleep -Seconds 5
        }
    }
    if (-not $systemStatsOk) {
        throw "H3 ComfyUI did not become healthy on port $Port"
    }

    $objectInfo = Invoke-RestMethod -Uri "$baseUrl/object_info" -TimeoutSec 30
    $nodeResults = @{}
    foreach ($node in $RequiredNodes) {
        $nodeResults[$node] = [bool]($objectInfo.PSObject.Properties.Name -contains $node)
    }
    $modelResults = @{}
    foreach ($file in $ModelFiles) {
        $path = Join-Path (Join-Path $ComfyRoot "models") ($file -replace "/", "\")
        $modelResults[$file] = Test-Path -LiteralPath $path
    }
    $report = @{
        success = -not ($nodeResults.Values -contains $false) -and -not ($modelResults.Values -contains $false)
        port = $Port
        service = "MECHA-GPU-ComfyUI-H3"
        base_url = $baseUrl
        comfyui_root = $ComfyRoot
        python = $H3Python
        nodes = $nodeResults
        models = $modelResults
        generated_at = (Get-Date).ToString("o")
    }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportFile -Encoding UTF8
    if (-not $report.success) {
        throw "H3 readiness failed. See $ReportFile"
    }
    Write-Step "H3 readiness OK. Report: $ReportFile"
}

Ensure-H3Python
Install-ComfyUI
Install-PythonRequirements
Download-H3Models
Install-H3StartCommand
Update-AgentPortList
Ensure-H3FirewallRule
Register-H3ScheduledTask
Test-H3Readiness

if (-not $NoAgentRestart) {
    Write-Step "Restarting Agent so it reports 8188,$Port"
    schtasks.exe /End /TN "MECHA-GPU-Agent" 2>$null | Out-Null
    Start-Sleep -Seconds 3
    schtasks.exe /Run /TN "MECHA-GPU-Agent" | Out-Null
} else {
    Write-Step "Skipping Agent scheduled-task restart by request; caller will restart Agent"
}
Write-Step "MiniMax H3 GPU2 setup completed"
