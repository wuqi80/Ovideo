param(
    [string]$InstallRoot = "E:\OSTORY-GPU",
    [int]$Port = 8188,
    [switch]$SkipModelDownloads,
    [switch]$ForceRefreshComfyUI,
    [switch]$RestartAgent,
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
$MiniReportFile = Join-Path $InstallRoot "config\h3-mini-ready.json"
$StartCmd = Join-Path $ScriptsRoot "windows_gpu_start_h3_comfyui.cmd"
$AgentStartCmd = Join-Path $ScriptsRoot "windows_gpu_start_agent.cmd"
$LegacyAgentStartCmd = Join-Path $InstallRoot "start_agent.cmd"
$Curl = Join-Path $env:SystemRoot "System32\curl.exe"
$PipIndex = if ($env:OSTORY_PIP_INDEX_URL) { $env:OSTORY_PIP_INDEX_URL } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }
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
$ClipProjCommit = "e556987e6bbf9c6448dd5691fe29ce9a7a6970ae"
$ClipProjVersion = "0.1.13"
$ClipProjRoot = Join-Path $ComfyRoot "custom_nodes\ComfyUI-ClipProj"
$MiniModelFiles = @(
    @{
        Repo = "Comfy-Org/Krea-2"
        Source = "text_encoders/qwen3vl_4b_fp8_scaled.safetensors"
        Target = "text_encoders/qwen3vl_4b_fp8_scaled.safetensors"
        Size = [Int64]5242467968
        Sha256 = "54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094"
    },
    @{
        Repo = "NicoLab28/ClipProj-MiniMax-H3"
        Source = "mmh3-4b-ClipProj-v3-mlp.safetensors"
        Target = "clip_projections/mmh3-4b-ClipProj-v3-mlp.safetensors"
        Size = [Int64]503434368
        Sha256 = "feef06ef3b9aede3b1f3331b71eebbc873e21a867d73bcf40ea2c0b007270693"
    }
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

function Install-H3MiniClipProj {
    $commitMarker = Join-Path $ClipProjRoot ".ostory-pinned-commit"
    if ((Test-Path -LiteralPath $commitMarker) -and
        ((Get-Content -LiteralPath $commitMarker -Raw -Encoding UTF8).Trim() -eq $ClipProjCommit)) {
        Write-Step "Pinned ClipProj node already present: $ClipProjCommit"
        return
    }
    $zip = Join-Path $Downloads "ComfyUI-ClipProj-$ClipProjCommit.zip"
    $extractRoot = Join-Path $Downloads "clipproj-extract"
    Write-Step "Downloading pinned ClipProj $ClipProjVersion ($ClipProjCommit)"
    & $Curl --location --fail --retry 12 --retry-all-errors --retry-delay 5 --output $zip "https://github.com/nicolab28/ComfyUI-ClipProj/archive/$ClipProjCommit.zip"
    if ($LASTEXITCODE -ne 0) {
        throw "ClipProj download failed"
    }
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $zip -DestinationPath $extractRoot -Force
    $source = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $source) {
        throw "ClipProj archive did not contain a directory"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ClipProjRoot) | Out-Null
    if (Test-Path -LiteralPath $ClipProjRoot) {
        Move-Item -LiteralPath $ClipProjRoot -Destination "$ClipProjRoot.bak.$(Get-Date -Format yyyyMMddHHmmss)"
    }
    Move-Item -LiteralPath $source.FullName -Destination $ClipProjRoot
    Set-Content -LiteralPath $commitMarker -Value $ClipProjCommit -Encoding ASCII
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


CHUNK_SIZE = 1 * 1024 * 1024
LOG_EVERY_BYTES = 64 * 1024 * 1024
CONNECT_FAILURE_LIMIT = 2


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
        "User-Agent": "OSTORY-GPU-H3-downloader/1.0",
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

    endpoints = []
    for endpoint in args.endpoint:
        base = endpoint.rstrip("/")
        if base and base not in endpoints:
            endpoints.append(base)

    connect_failures = {base: 0 for base in endpoints}
    skipped_connectivity = set()
    for attempt in range(1, args.attempts + 1):
        any_endpoint_tried = False
        for base in endpoints:
            if connect_failures.get(base, 0) >= CONNECT_FAILURE_LIMIT:
                if base not in skipped_connectivity:
                    write_log(args.log, f"skipping endpoint after repeated connection failures: {base}")
                    skipped_connectivity.add(base)
                continue
            any_endpoint_tried = True
            url = f"{base}/{args.repo_id}/resolve/main/{args.relative_path}"
            try:
                if download_once(url, target, partial, args.expected_size, args.token, args.log, args.relative_path):
                    write_log(args.log, f"download complete: {args.relative_path}")
                    return 0
            except (requests.exceptions.ConnectTimeout, requests.exceptions.ConnectionError) as exc:
                connect_failures[base] = connect_failures.get(base, 0) + 1
                write_log(args.log, f"download connection failed ({base}, attempt {attempt}/{args.attempts}, connection_failures={connect_failures[base]}/{CONNECT_FAILURE_LIMIT}): {type(exc).__name__}: {exc}")
            except Exception as exc:
                write_log(args.log, f"download attempt failed ({base}, attempt {attempt}/{args.attempts}): {type(exc).__name__}: {exc}")
        if not any_endpoint_tried:
            write_log(args.log, "all endpoints skipped after repeated connection failures")
            break
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
    $endpoints.Add("https://huggingface.co")
    $endpoints.Add("https://hf-mirror.com")
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

function Download-H3MiniModels {
    if ($SkipModelDownloads) {
        Write-Step "Skipping H3 Mini model downloads by request"
        return
    }
    $modelsRoot = Join-Path $ComfyRoot "models"
    $endpoints = New-Object System.Collections.Generic.List[string]
    if ($HuggingFaceEndpoint) {
        $endpoints.Add($HuggingFaceEndpoint)
    }
    $endpoints.Add("https://huggingface.co")
    $endpoints.Add("https://hf-mirror.com")
    $uniqueEndpoints = $endpoints | Select-Object -Unique
    $downloadLog = Join-Path $Logs "h3-mini-download.log"
    $downloader = Install-H3ModelDownloader
    foreach ($asset in $MiniModelFiles) {
        $target = Join-Path $modelsRoot ($asset.Target -replace "/", "\")
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        $downloadArgs = @(
            "-s", $downloader,
            "--repo-id", $asset.Repo,
            "--relative-path", $asset.Source,
            "--target", $target,
            "--log", $downloadLog,
            "--expected-size", "$($asset.Size)"
        )
        foreach ($endpoint in $uniqueEndpoints) {
            $downloadArgs += @("--endpoint", $endpoint.TrimEnd("/"))
        }
        if ($HuggingFaceToken) {
            $downloadArgs += @("--token", $HuggingFaceToken)
        }
        Write-Step "Downloading H3 Mini asset: $($asset.Target)"
        & $H3Python @downloadArgs
        if ($LASTEXITCODE -ne 0) {
            throw "MiniMax H3 Mini asset download failed: $($asset.Target)"
        }
    }
}

function Write-H3MiniReadiness {
    $modelsRoot = Join-Path $ComfyRoot "models"
    $modelResults = @{}
    foreach ($asset in $MiniModelFiles) {
        $path = Join-Path $modelsRoot ($asset.Target -replace "/", "\")
        $modelResults[$asset.Target] = (
            (Test-Path -LiteralPath $path) -and
            ([Int64](Get-Item -LiteralPath $path).Length -eq [Int64]$asset.Size)
        )
    }
    $commitMarker = Join-Path $ClipProjRoot ".ostory-pinned-commit"
    $nodeReady = (Test-Path -LiteralPath (Join-Path $ClipProjRoot "__init__.py")) -and
        (Test-Path -LiteralPath $commitMarker) -and
        ((Get-Content -LiteralPath $commitMarker -Raw -Encoding UTF8).Trim() -eq $ClipProjCommit)
    $report = @{
        verified = $nodeReady -and -not ($modelResults.Values -contains $false)
        clipproj_version = $ClipProjVersion
        clipproj_commit = $ClipProjCommit
        inference_executed = $false
        models = $modelResults
        expected_sha256 = @{
            "qwen3vl_4b_fp8_scaled.safetensors" = $MiniModelFiles[0].Sha256
            "mmh3-4b-ClipProj-v3-mlp.safetensors" = $MiniModelFiles[1].Sha256
        }
        generated_at = (Get-Date).ToString("o")
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $MiniReportFile) | Out-Null
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $MiniReportFile -Encoding UTF8
    if (-not $report.verified) {
        if ($SkipModelDownloads) {
            Write-Step "H3 Mini remains unavailable because its model downloads were skipped"
            return
        }
        throw "H3 Mini readiness failed. See $MiniReportFile"
    }
    Write-Step "H3 Mini files verified without inference. Report: $MiniReportFile"
}

function Install-H3StartCommand {
    @"
@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "OSTORY_GPU_ROOT=$InstallRoot"
set "COMFYUI_ROOT=$ComfyRoot"
set "PYTHON_EXE=$H3Python"
if not exist "$Logs" mkdir "$Logs"
cd /d "%COMFYUI_ROOT%"
"%PYTHON_EXE%" -s "%COMFYUI_ROOT%\main.py" --listen 0.0.0.0 --port $Port --lowvram --preview-method none --disable-auto-launch >> "$Logs\comfyui-h3-$Port.log" 2>&1
endlocal
"@ | Set-Content -LiteralPath $StartCmd -Encoding ASCII
}

function Update-AgentPortList {
    [Environment]::SetEnvironmentVariable("OSTORY_COMFYUI_PORTS", "8188", "Machine")
    foreach ($candidate in @($AgentStartCmd, $LegacyAgentStartCmd)) {
        if (-not (Test-Path -LiteralPath $candidate)) {
            continue
        }
        $source = Get-Content -LiteralPath $candidate -Raw -Encoding UTF8
        $updated = $source -replace "set OSTORY_COMFYUI_PORTS=.*", "set OSTORY_COMFYUI_PORTS=8188"
        if ($updated -ne $source) {
            Write-Step "Updating Agent startup command to the single managed port: $candidate"
            Set-Content -LiteralPath $candidate -Value $updated -Encoding UTF8
        }
    }
}

function Disable-LegacyH3Startup {
    Write-Step "Disabling the legacy independently-started H3 task and firewall rule"
    Get-NetFirewallRule -DisplayName "OSTORY GPU ComfyUI H3 LAN" -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    $legacyTask = Get-ScheduledTask -TaskName "OSTORY-GPU-ComfyUI-H3" -ErrorAction SilentlyContinue
    if ($legacyTask) {
        Disable-ScheduledTask -TaskName "OSTORY-GPU-ComfyUI-H3" | Out-Null
    }
}

function Test-H3Readiness {
    Write-Step "Starting H3 ComfyUI on port $Port"
    schtasks.exe /Run /TN "OSTORY-GPU-ComfyUI-H3" | Out-Null
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
        service = "OSTORY-GPU-ComfyUI-H3"
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
Install-H3MiniClipProj
Download-H3Models
Download-H3MiniModels
Write-H3MiniReadiness
Install-H3StartCommand
Update-AgentPortList
Disable-LegacyH3Startup
Write-Step "H3 installed for Agent-managed on-demand switching; no runtime smoke was started"

if ($RestartAgent) {
    Write-Step "Restarting Agent with the single managed port"
    schtasks.exe /End /TN "OSTORY-GPU-Agent" 2>$null | Out-Null
    Start-Sleep -Seconds 3
    schtasks.exe /Run /TN "OSTORY-GPU-Agent" | Out-Null
} else {
    Write-Step "Agent restart was not requested; installed files remain inactive"
}
Write-Step "MiniMax H3 GPU2 setup completed"
