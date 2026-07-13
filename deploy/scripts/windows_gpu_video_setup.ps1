$ErrorActionPreference = "Stop"

$Root = if ($env:MECHA_GPU_ROOT) { $env:MECHA_GPU_ROOT } else { "E:\MECHA-GPU" }
$PortableRoot = Join-Path $Root "ComfyUI_windows_portable"
$ComfyRoot = Join-Path $PortableRoot "ComfyUI"
$Python = Join-Path $PortableRoot "python_embeded\python.exe"
$Plugin = Join-Path $ComfyRoot "custom_nodes\ComfyUI-VideoHelperSuite"
$ReportPath = Join-Path $Root "video-helper-report.json"
$RequiredNodes = @("VHS_LoadVideo", "VHS_VideoCombine")
$PipIndex = if ($env:MECHA_PIP_INDEX_URL) { $env:MECHA_PIP_INDEX_URL } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Portable Python not found: $Python"
}
if (-not (Test-Path -LiteralPath (Join-Path $Plugin "requirements.txt"))) {
    throw "VideoHelperSuite is not staged at: $Plugin"
}

& $Python -s -m pip install --index-url $PipIndex --timeout 90 --retries 8 -r (Join-Path $Plugin "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    throw "VideoHelperSuite dependency installation failed"
}

$BundledFfmpeg = Get-ChildItem -LiteralPath (Join-Path $PortableRoot "python_embeded\Lib\site-packages\imageio_ffmpeg\binaries") -Filter "ffmpeg*.exe" |
    Select-Object -First 1
if (-not $BundledFfmpeg) {
    throw "imageio-ffmpeg installed without a bundled ffmpeg executable"
}
$Ffmpeg = Join-Path $PortableRoot "ffmpeg.exe"
Copy-Item -LiteralPath $BundledFfmpeg.FullName -Destination $Ffmpeg -Force

schtasks.exe /End /TN "MECHA-GPU-ComfyUI" 2>$null | Out-Null
Start-Sleep -Seconds 5
schtasks.exe /Run /TN "MECHA-GPU-ComfyUI" | Out-Null

$ObjectInfo = $null
for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
    Start-Sleep -Seconds 2
    try {
        $ObjectInfo = Invoke-RestMethod -Uri "http://127.0.0.1:8188/object_info" -TimeoutSec 10
        if ($ObjectInfo) { break }
    } catch {
        $ObjectInfo = $null
    }
}

if (-not $ObjectInfo) {
    throw "ComfyUI did not become ready after VideoHelperSuite installation"
}

$NodeStatus = @{}
foreach ($Node in $RequiredNodes) {
    $NodeStatus[$Node] = $ObjectInfo.PSObject.Properties.Name -contains $Node
}
$Success = -not ($NodeStatus.Values -contains $false)
$Report = [ordered]@{
    success = $Success
    checked_at = (Get-Date).ToString("o")
    plugin_path = $Plugin
    ffmpeg_path = $Ffmpeg
    ffmpeg_exists = (Test-Path -LiteralPath $Ffmpeg)
    nodes = $NodeStatus
}
$Report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding UTF8

if (-not $Success) {
    throw "VideoHelperSuite loaded without all required nodes"
}

Write-Host "VideoHelperSuite setup completed"
