param(
    [Parameter(Mandatory = $true)]
    [int]$Port,

    [Parameter(Mandatory = $true)]
    [string]$PythonExe,

    [Parameter(Mandatory = $true)]
    [string]$CommandMatch,

    [ValidateRange(1, 60)]
    [int]$WaitTimeoutSeconds = 15,

    [ValidateRange(100, 5000)]
    [int]$PollMilliseconds = 500,

    [string]$LogFile = "E:\OSTORY-GPU\logs\agent-port-cleanup.log"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Log {
    param([string]$Message)
    try {
        $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        if (-not (Test-Path -Path (Split-Path -Parent $LogFile))) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null
        }
        "[{0}] {1}" -f $time, $Message | Out-File -FilePath $LogFile -Append -Encoding UTF8
    } catch {
        # Logging must not block startup.
    }
}

try {
    Write-Log "Preparing port $Port for ComfyUI startup (match: $CommandMatch)"
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) {
        Write-Log "Port $Port is currently free."
        exit 0
    }

    $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    Write-Log "Port $Port occupied by PIDs: $($pids -join ',')"

    $foreignPids = @()
    # $PID is a built-in, read-only PowerShell automatic variable and variable
    # names are case-insensitive. Do not reuse it as a foreach iterator.
    foreach ($listenerPid in $pids) {
        if (-not $listenerPid) { continue }
        $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $listenerPid) -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $cmd = $proc.CommandLine
        $actualExe = [string]$proc.ExecutablePath
        $samePython = $actualExe -and [string]::Equals(
            [System.IO.Path]::GetFullPath($actualExe),
            [System.IO.Path]::GetFullPath($PythonExe),
            [System.StringComparison]::OrdinalIgnoreCase
        )
        if ($samePython -or ($cmd -and $cmd -like "*$CommandMatch*")) {
            Write-Log "Terminating ComfyUI process PID=$listenerPid Cmd=$cmd"
            Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
        } else {
            $foreignPids += $listenerPid
            Write-Log "Keep-running non-target process on port $Port PID=${listenerPid}: $cmd"
        }
    }

    if ($foreignPids.Count -gt 0) {
        $foreignList = $foreignPids -join ","
        Write-Log "Port $Port is still occupied by non-target processes: $foreignList"
        exit 2
    }

    # Stop-Process can return before Windows has removed the listening socket.
    # Wait for the exact managed listener to disappear instead of turning a
    # normal shutdown delay into a failed runtime switch.
    $deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)
    do {
        $left = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        if (-not $left) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    } while ((Get-Date) -lt $deadline)

    if ($left) {
        Write-Log "Port $Port still has listeners after ${WaitTimeoutSeconds}s cleanup wait: $($left -join ',')"
        exit 3
    }

    Write-Log "Port $Port cleanup complete."
    exit 0
} catch {
    Write-Log "Port cleanup failed on ${Port}: $($_.Exception.Message)"
    exit 1
}
