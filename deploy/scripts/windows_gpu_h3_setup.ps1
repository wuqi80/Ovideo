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
$ModelExpectedSizes = @{
    "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors" = [Int64]20970379616
    "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" = [Int64]15687142551
    "vae/minimax_h3_audio_vae_fp32.safetensors" = [Int64]605254808
}

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

function Install-H3ModelDownloader {
    $downloader = Join-Path $ScriptsRoot "h3_model_downloader.py"
    @'
import argparse
import os
import re
import time
from pathlib import Path

import requests


CHUNK_SIZE = 8 * 1024 * 1024
LOG_EVERY_BYTES = 256 * 1024 * 1024


def now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def write_log(log_path, message):
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(f"[{now()}] {message}\n")


def size_of(path):
    try:
        return Path(path).stat().st_size
    except FileNotFoundError:
        return 0


def infer_expected_total(response, offset):
    content_range = response.headers.get("Content-Range", "")
    match = re.search(r"/(\d+)$", content_range)
    if match:
        return int(match.group(1))
    content_length = response.headers.get("Content-Length", "")
    if content_length.isdigit():
        length = int(content_length)
        if response.status_code == 206:
            return offset + length
        return length
    return 0


def normalize_existing(target, partial, expected_size, log_path, relative_path):
    target_size = size_of(target)
    if target_size <= 0:
        return
    if expected_size > 0 and target_size == expected_size:
        return
    if expected_size <= 0:
        return
    partial_size = size_of(partial)
    write_log(log_path, f"existing target incomplete; moving to part for resume: {relative_path} ({target_size}/{expected_size} bytes)")
    if partial_size >= target_size:
        Path(target).unlink(missing_ok=True)
    else:
        os.replace(target, partial)


def download_once(url, target, partial, expected_size, token, log_path, relative_path):
    partial_path = Path(partial)
    offset = size_of(partial_path)
    headers = {
        "Accept-Encoding": "identity",
        "User-Agent": "MECHA-GPU-H3-downloader/1.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if offset > 0:
        headers["Range"] = f"bytes={offset}-"

    write_log(log_path, f"python requests {url} -> {partial} (offset={offset})")
    with requests.get(url, headers=headers, stream=True, timeout=(30, 60), allow_redirects=True) as response:
        if offset > 0 and response.status_code == 200:
            write_log(log_path, f"server ignored Range; restarting partial file: {relative_path}")
            partial_path.unlink(missing_ok=True)
            offset = 0
            mode = "wb"
        elif response.status_code == 206:
            mode = "ab"
        elif response.status_code == 200:
            mode = "wb"
        elif response.status_code == 416 and expected_size > 0 and offset == expected_size:
            os.replace(partial, target)
            return True
        else:
            response.raise_for_status()
            mode = "ab" if offset else "wb"

        effective_expected_size = expected_size
        inferred_size = infer_expected_total(response, offset)
        if effective_expected_size <= 0 and inferred_size > 0:
            effective_expected_size = inferred_size
            write_log(log_path, f"inferred expected size from response: {relative_path} {effective_expected_size} bytes")

        written_since_log = 0
        with open(partial_path, mode + ("" if "b" in mode else "b")) as handle:
            for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
                if not chunk:
                    continue
                handle.write(chunk)
                handle.flush()
                written_since_log += len(chunk)
                if written_since_log >= LOG_EVERY_BYTES:
                    write_log(log_path, f"download progress: {relative_path} {size_of(partial_path)} bytes")
                    written_since_log = 0

    partial_size = size_of(partial_path)
    if effective_expected_size > 0:
        if partial_size == effective_expected_size:
            os.replace(partial, target)
            return True
        write_log(log_path, f"partial incomplete after response: {relative_path} ({partial_size}/{effective_expected_size} bytes)")
        return False
    if partial_size > 0:
        os.replace(partial, target)
        return True
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--relative-path", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--endpoint", action="append", required=True)
    parser.add_argument("--expected-size", type=int, default=0)
    parser.add_argument("--token", default="")
    parser.add_argument("--attempts", type=int, default=12)
    args = parser.parse_args()

    target = Path(args.target)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = Path(str(target) + ".part")
    normalize_existing(target, partial, args.expected_size, args.log, args.relative_path)

    target_size = size_of(target)
    if args.expected_size > 0 and target_size == args.expected_size:
        write_log(args.log, f"already complete: {args.relative_path}")
        return 0
    if args.expected_size <= 0 and target_size > 0:
        write_log(args.log, f"already present without expected size: {args.relative_path}")
        return 0

    for endpoint in args.endpoint:
        base = endpoint.rstrip("/")
        url = f"{base}/{args.repo_id}/resolve/main/{args.relative_path}"
        for attempt in range(1, args.attempts + 1):
            try:
                if download_once(url, target, partial, args.expected_size, args.token, args.log, args.relative_path):
                    write_log(args.log, f"download complete: {args.relative_path}")
                    return 0
            except Exception as exc:
                write_log(args.log, f"download attempt failed ({base}, attempt {attempt}/{args.attempts}): {type(exc).__name__}: {exc}")
            time.sleep(10)
    write_log(args.log, f"download failed after all endpoints: {args.relative_path}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
'@ | Set-Content -LiteralPath $downloader -Encoding UTF8
    return $downloader
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
    $downloader = Install-H3ModelDownloader
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting MiniMax H3 model downloads" | Add-Content -LiteralPath $downloadLog -Encoding UTF8

    foreach ($relativePath in $ModelFiles) {
        $windowsRelativePath = $relativePath -replace "/", "\"
        $target = Join-Path $modelsRoot $windowsRelativePath
        $partialTarget = "$target.part"
        $expectedSize = [Int64]0
        if ($ModelExpectedSizes.ContainsKey($relativePath)) {
            $expectedSize = [Int64]$ModelExpectedSizes[$relativePath]
        }
        $targetDir = Split-Path -Parent $target
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
        if (Test-Path -LiteralPath $target) {
            $targetSize = [Int64](Get-Item -LiteralPath $target).Length
            if (($expectedSize -gt 0 -and $targetSize -eq $expectedSize) -or ($expectedSize -le 0 -and $targetSize -gt 0)) {
                Write-Step "H3 model already present: $relativePath"
                continue
            }
            Write-Step "H3 model is incomplete; keeping it for resume: $relativePath ($targetSize/$expectedSize bytes)"
            if ((Test-Path -LiteralPath $partialTarget) -and ((Get-Item -LiteralPath $partialTarget).Length -ge $targetSize)) {
                Remove-Item -LiteralPath $target -Force
            } else {
                Move-Item -LiteralPath $target -Destination $partialTarget -Force
            }
        }

        $downloadArgs = @(
            "-s",
            $downloader,
            "--repo-id",
            "Comfy-Org/MiniMax-H3",
            "--relative-path",
            $relativePath,
            "--target",
            $target,
            "--log",
            $downloadLog
        )
        foreach ($endpoint in $uniqueEndpoints) {
            $downloadArgs += @("--endpoint", $endpoint.TrimEnd("/"))
        }
        if ($expectedSize -gt 0) {
            $downloadArgs += @("--expected-size", "$expectedSize")
        }
        if ($HuggingFaceToken) {
            $downloadArgs += @("--token", $HuggingFaceToken)
        }

        Write-Step "Downloading H3 model with resumable Python downloader: $relativePath"
        & $H3Python @downloadArgs
        if ($LASTEXITCODE -ne 0) {
            throw "MiniMax H3 model download failed: $relativePath"
        }
        Write-Step "Downloaded H3 model: $relativePath"
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
