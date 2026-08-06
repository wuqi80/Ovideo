param(
    [string]$InstallRoot = "E:\MECHA-GPU",
    [string]$ServerUrl = "https://192.168.31.134"
)

$ErrorActionPreference = "Continue"

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

function Get-CommandInfo {
    param([string]$Name, [string[]]$VersionArgs)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        return @{ available = $false; path = $null; version = $null }
    }

    $version = $null
    try {
        $version = (& $command.Source @VersionArgs 2>&1 | Select-Object -First 1 | Out-String).Trim()
    } catch {
        $version = $_.Exception.Message
    }
    return @{ available = $true; path = $command.Source; version = $version }
}

$gpu = @()
$nvidiaSmi = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
if ($nvidiaSmi) {
    try {
        $gpu = & $nvidiaSmi.Source `
            --query-gpu=name,driver_version,memory.total,compute_cap `
            --format=csv,noheader,nounits 2>&1
    } catch {
        $gpu = @($_.Exception.Message)
    }
}

$serverReachable = $false
$serverStatus = $null
try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $ServerUrl -Method Head -TimeoutSec 15
    $serverStatus = [int]$response.StatusCode
    $serverReachable = $true
} catch {
    if ($_.Exception.Response) {
        $serverStatus = [int]$_.Exception.Response.StatusCode
        $serverReachable = $true
    } else {
        $serverStatus = $_.Exception.Message
    }
}

$drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='E:'" -ErrorAction SilentlyContinue
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue

$report = [ordered]@{
    generated_at = (Get-Date).ToString("o")
    computer_name = $env:COMPUTERNAME
    user = $env:USERNAME
    os = if ($os) { $os.Caption } else { $null }
    os_version = if ($os) { $os.Version } else { $null }
    cpu = @($cpu | ForEach-Object { $_.Name })
    memory_gb = if ($os) { [math]::Round($os.TotalVisibleMemorySize / 1MB, 1) } else { $null }
    e_drive_free_gb = if ($drive) { [math]::Round($drive.FreeSpace / 1GB, 1) } else { $null }
    e_drive_total_gb = if ($drive) { [math]::Round($drive.Size / 1GB, 1) } else { $null }
    gpu = @($gpu)
    nvidia_smi_available = [bool]$nvidiaSmi
    python = Get-CommandInfo -Name "python.exe" -VersionArgs @("--version")
    py_launcher = Get-CommandInfo -Name "py.exe" -VersionArgs @("--version")
    git = Get-CommandInfo -Name "git.exe" -VersionArgs @("--version")
    ffmpeg = Get-CommandInfo -Name "ffmpeg.exe" -VersionArgs @("-version")
    server_url = $ServerUrl
    server_reachable = $serverReachable
    server_status = $serverStatus
    install_root = $InstallRoot
}

$reportPath = Join-Path $InstallRoot "diagnostics.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 6
