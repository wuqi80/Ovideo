param(
    [string]$InstallRoot = "E:\OSTORY-GPU",
    [switch]$SkipModelDownloads
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$PortableRoot = Join-Path $InstallRoot "ComfyUI_windows_portable"
$ComfyRoot = Join-Path $PortableRoot "ComfyUI"
$Python = Join-Path $PortableRoot "python_embeded\python.exe"
$Downloads = Join-Path $InstallRoot "downloads\wan"
$Logs = Join-Path $InstallRoot "logs"
$LogFile = Join-Path $Logs "wan-setup.log"
$ReportFile = Join-Path $InstallRoot "wan-readiness-report.json"
$Curl = Join-Path $env:SystemRoot "System32\curl.exe"
$Aria2 = Join-Path $InstallRoot "tools\aria2c.exe"
$PipIndex = if ($env:OSTORY_PIP_INDEX_URL) { $env:OSTORY_PIP_INDEX_URL } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }
$WanCommit = "088128b224242e110d3906c6750e9a3a348a659b"
$WanPlugin = Join-Path $ComfyRoot "custom_nodes\ComfyUI-WanVideoWrapper"
$ServicesStopped = $false

New-Item -ItemType Directory -Force -Path $Downloads, $Logs | Out-Null

function Write-Step {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Output $line
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Stop-GpuServices {
    Write-Step "Stopping GPU2 Agent and ComfyUI"
    schtasks.exe /End /TN "OSTORY-GPU-Agent" 2>$null | Out-Null
    schtasks.exe /End /TN "OSTORY-GPU-ComfyUI" 2>$null | Out-Null
    Start-Sleep -Seconds 5
    $script:ServicesStopped = $true
}

function Start-GpuServices {
    Write-Step "Starting GPU2 ComfyUI and Agent"
    schtasks.exe /Run /TN "OSTORY-GPU-ComfyUI" | Out-Null
    Start-Sleep -Seconds 10
    schtasks.exe /Run /TN "OSTORY-GPU-Agent" | Out-Null
    $script:ServicesStopped = $false
}

function Get-Sha256WithRetry {
    param(
        [string]$Path,
        [int]$MaxAttempts = 60
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $stream = $null
        $sha256 = $null
        try {
            $stream = [System.IO.File]::Open(
                $Path,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
            )
            $sha256 = [System.Security.Cryptography.SHA256]::Create()
            return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
        } catch {
            if ($attempt -eq $MaxAttempts) {
                throw
            }
            if ($attempt -eq 1) {
                Write-Step "Waiting for downloader to release model file: $Path"
            }
            Start-Sleep -Seconds 2
        } finally {
            if ($sha256) { $sha256.Dispose() }
            if ($stream) { $stream.Dispose() }
        }
    }
}

function Finalize-VerifiedFile {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$Sha256,
        [int]$MoveAttempts = 15
    )

    for ($attempt = 1; $attempt -le $MoveAttempts; $attempt++) {
        try {
            Move-Item -LiteralPath $Source -Destination $Destination -Force
            return
        } catch {
            if ($attempt -eq 1) {
                Write-Step "Waiting to finalize verified model file: $Source"
            }
            if ($attempt -lt $MoveAttempts) {
                Start-Sleep -Seconds 2
            }
        }
    }

    Write-Step "Source remains locked; copying verified model to final path: $Destination"
    $sourceStream = $null
    $destinationStream = $null
    try {
        $sourceStream = [System.IO.File]::Open(
            $Source,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        )
        $destinationStream = [System.IO.File]::Open(
            $Destination,
            [System.IO.FileMode]::Create,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $sourceStream.CopyTo($destinationStream, 8MB)
        $destinationStream.Flush($true)
    } finally {
        if ($destinationStream) { $destinationStream.Dispose() }
        if ($sourceStream) { $sourceStream.Dispose() }
    }

    $copiedHash = Get-Sha256WithRetry -Path $Destination
    if ($copiedHash -ne $Sha256.ToLowerInvariant()) {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        throw "SHA256 mismatch after finalizing $Destination. Expected $Sha256, got $copiedHash"
    }
    Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue
}

trap {
    Write-Step ("WAN SETUP FAILED: " + $_.Exception.Message)
    if ($script:ServicesStopped) {
        try { Start-GpuServices } catch { }
    }
    exit 1
}

function Download-VerifiedFile {
    param(
        [string[]]$Urls,
        [string]$Destination,
        [string]$Sha256
    )
    New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null
    $marker = "$Destination.sha256.ok"
    if ((Test-Path -LiteralPath $Destination) -and (Test-Path -LiteralPath $marker)) {
        if ((Get-Content -LiteralPath $marker -Raw).Trim().ToLowerInvariant() -eq $Sha256.ToLowerInvariant()) {
            Write-Step "Verified model already present: $Destination"
            return
        }
    }
    if (Test-Path -LiteralPath $Destination) {
        Write-Step "Verifying existing model: $Destination"
        $existingHash = Get-Sha256WithRetry -Path $Destination
        if ($existingHash -eq $Sha256.ToLowerInvariant()) {
            Set-Content -LiteralPath $marker -Value $Sha256 -Encoding ASCII
            return
        }
        Move-Item -LiteralPath $Destination -Destination "$Destination.bad.$(Get-Date -Format yyyyMMddHHmmss)"
    }

    $partial = "$Destination.part"
    $partialDir = Split-Path $partial -Parent
    $partialName = Split-Path $partial -Leaf
    $downloaded = $false
    foreach ($url in $Urls) {
        Write-Step "Downloading model: $url"
        if (Test-Path -LiteralPath $Aria2) {
            & $Aria2 `
                --continue=true `
                --max-connection-per-server=16 `
                --split=16 `
                --min-split-size=4M `
                --file-allocation=none `
                --auto-file-renaming=false `
                --allow-overwrite=true `
                --max-tries=0 `
                --retry-wait=5 `
                --summary-interval=30 `
                "--dir=$partialDir" `
                "--out=$partialName" `
                $url
        } else {
            & $Curl --location --fail --retry 12 --retry-all-errors --retry-delay 5 --connect-timeout 30 --continue-at - --output $partial $url
        }
        if ($LASTEXITCODE -eq 0) {
            $downloaded = $true
            break
        }
        Write-Step "Model source failed with exit code ${LASTEXITCODE}; trying next source."
    }
    if (-not $downloaded) {
        throw "All model download sources failed: $($Urls -join ', ')"
    }
    $actualHash = Get-Sha256WithRetry -Path $partial
    if ($actualHash -ne $Sha256.ToLowerInvariant()) {
        throw "SHA256 mismatch for $Destination. Expected $Sha256, got $actualHash"
    }
    Finalize-VerifiedFile -Source $partial -Destination $Destination -Sha256 $Sha256
    Set-Content -LiteralPath $marker -Value $Sha256 -Encoding ASCII
}

function Install-WanPlugin {
    $versionFile = Join-Path $WanPlugin ".ostory-version"
    if ((Test-Path -LiteralPath $versionFile) -and ((Get-Content -LiteralPath $versionFile -Raw).Trim() -eq $WanCommit)) {
        Write-Step "WanVideoWrapper is already pinned to $WanCommit"
        return
    }

    $zip = Join-Path $Downloads "ComfyUI-WanVideoWrapper-$WanCommit.zip"
    if (-not (Test-Path -LiteralPath $zip)) {
        Write-Step "Downloading WanVideoWrapper $WanCommit"
        & $Curl --location --fail --retry 20 --retry-all-errors --retry-delay 5 --output $zip "https://github.com/kijai/ComfyUI-WanVideoWrapper/archive/$WanCommit.zip"
        if ($LASTEXITCODE -ne 0) {
            throw "WanVideoWrapper download failed"
        }
    }
    $extractRoot = Join-Path $Downloads "wrapper-extract"
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $zip -DestinationPath $extractRoot -Force
    $source = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $source) {
        throw "WanVideoWrapper archive did not contain a directory"
    }
    if (Test-Path -LiteralPath $WanPlugin) {
        Move-Item -LiteralPath $WanPlugin -Destination "$WanPlugin.bak.$(Get-Date -Format yyyyMMddHHmmss)"
    }
    Move-Item -LiteralPath $source.FullName -Destination $WanPlugin
    Set-Content -LiteralPath $versionFile -Value $WanCommit -Encoding ASCII
}

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Portable Python not found: $Python"
}

$Models = @(
    @{
        Urls = @(
            "https://www.modelscope.cn/models/Kijai/WanVideo_comfy_fp8_scaled/resolve/master/I2V/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors",
            "https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/I2V/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors?download=true"
        )
        Destination = Join-Path $ComfyRoot "models\diffusion_models\wan2.1\Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors"
        Sha256 = "2ff922282cd84589702e6e8c26e083d1160bfc2b217dd44e1ae2688441dc495d"
    },
    @{
        Urls = @(
            "https://www.modelscope.cn/models/Kijai/WanVideo_comfy_fp8_scaled/resolve/master/InfiniteTalk/Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors",
            "https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/InfiniteTalk/Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors?download=true"
        )
        Destination = Join-Path $ComfyRoot "models\diffusion_models\wan2.1\Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors"
        Sha256 = "bd6e0e6feab8c22a482b1c4dd7c0504c215c35b507ddc3b4dcaa5d3ef539879e"
    },
    @{
        Urls = @(
            "https://www.modelscope.cn/models/Kijai/WanVideo_comfy/resolve/master/umt5-xxl-enc-fp8_e4m3fn.safetensors",
            "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/umt5-xxl-enc-fp8_e4m3fn.safetensors?download=true"
        )
        Destination = Join-Path $ComfyRoot "models\text_encoders\umt5-xxl-enc-fp8_e4m3fn.safetensors"
        Sha256 = "3fe5173588270c22505d4f9158bb1644b78331b8614206a97e92760b960c9ffa"
    },
    @{
        Urls = @(
            "https://www.modelscope.cn/models/Kijai/WanVideo_comfy/resolve/master/Wan2_1_VAE_bf16.safetensors",
            "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_bf16.safetensors?download=true"
        )
        Destination = Join-Path $ComfyRoot "models\vae\wan2.1\Wan2_1_VAE_bf16.safetensors"
        Sha256 = "1ab9a32cc2c740f6e39d80d367ce5dcc28db8c71b79b28670546b8973e9d75f9"
    },
    @{
        Urls = @(
            "https://www.modelscope.cn/models/Kijai/WanVideo_comfy/resolve/master/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors",
            "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors?download=true"
        )
        Destination = Join-Path $ComfyRoot "models\loras\wan2.1\lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors"
        Sha256 = "85c4a61c30e0497aa44b91d93a893b624708461a56fe5485183b28fa07e2dfb3"
    },
    @{
        Urls = @(
            "https://www.modelscope.cn/models/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/clip_vision/clip_vision_h.safetensors",
            "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors?download=true"
        )
        Destination = Join-Path $ComfyRoot "models\clip_vision\clip_vision_h.safetensors"
        Sha256 = "64a7ef761bfccbadbaa3da77366aac4185a6c58fa5de5f589b42a65bcc21f161"
    },
    @{
        Urls = @(
            "https://www.modelscope.cn/models/Kijai/wav2vec2_safetensors/resolve/master/wav2vec2-chinese-base_fp16.safetensors",
            "https://huggingface.co/Kijai/wav2vec2_safetensors/resolve/main/wav2vec2-chinese-base_fp16.safetensors?download=true"
        )
        Destination = Join-Path $ComfyRoot "models\wav2vec2\wav2vec2-chinese-base_fp16.safetensors"
        Sha256 = "000813e441020f18cff844c969d2d5d4adc2a5ce46b2db1f23950b05d88805b4"
    }
)

if (-not $SkipModelDownloads) {
    foreach ($model in $Models) {
        Download-VerifiedFile -Urls $model.Urls -Destination $model.Destination -Sha256 $model.Sha256
    }
}

Stop-GpuServices
Install-WanPlugin

$Requirements = Join-Path $WanPlugin "requirements.txt"
if (Test-Path -LiteralPath $Requirements) {
    Write-Step "Installing WanVideoWrapper Python dependencies"
    & $Python -s -m pip install --index-url $PipIndex --timeout 120 --retries 12 -r $Requirements
    if ($LASTEXITCODE -ne 0) {
        throw "WanVideoWrapper dependency installation failed"
    }
}

Start-GpuServices

$ObjectInfo = $null
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Seconds 2
    try {
        $ObjectInfo = Invoke-RestMethod -Uri "http://127.0.0.1:8188/object_info" -TimeoutSec 15
        if ($ObjectInfo) { break }
    } catch {
        $ObjectInfo = $null
    }
}
if (-not $ObjectInfo) {
    throw "ComfyUI did not become ready after Wan setup"
}

$RequiredNodes = @(
    "WanVideoModelLoader",
    "WanVideoImageToVideoEncode",
    "WanVideoImageToVideoMultiTalk",
    "MultiTalkModelLoader",
    "Wav2VecModelLoader",
    "WanVideoSampler",
    "WanVideoDecode",
    "VHS_LoadVideo",
    "VHS_LoadAudioUpload",
    "VHS_VideoCombine"
)
$NodeStatus = [ordered]@{}
foreach ($node in $RequiredNodes) {
    $NodeStatus[$node] = $ObjectInfo.PSObject.Properties.Name -contains $node
}
$ModelStatus = [ordered]@{}
foreach ($model in $Models) {
    $ModelStatus[$model.Destination] = Test-Path -LiteralPath $model.Destination
}
$Success = -not ($NodeStatus.Values -contains $false) -and -not ($ModelStatus.Values -contains $false)
$Report = [ordered]@{
    success = $Success
    checked_at = (Get-Date).ToString("o")
    wrapper_commit = $WanCommit
    low_vram_profile = [ordered]@{
        width = 640
        height = 384
        frames = 33
        steps = 4
        blocks_to_swap = 36
        attention = "sdpa"
        serial_agent = $true
    }
    nodes = $NodeStatus
    models = $ModelStatus
}
$Report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportFile -Encoding UTF8
if (-not $Success) {
    throw "Wan readiness check failed. See $ReportFile"
}

Write-Step "GPU2 Wan and InfiniteTalk setup completed"
