$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = "E:\MECHA-GPU"
$logFile = Join-Path $root "logs\dfs-startup-gate.log"
$dfsHealthUrl = "http://192.168.31.121:4213/health"
$requiredConsecutivePasses = 6
$probeIntervalSeconds = 10
$probeTimeoutSeconds = 5
$stabilizationSeconds = 120
$comfyReadyTimeoutSeconds = 300
$wanTaskName = "MECHA-GPU-ComfyUI"
$agentTaskName = "MECHA-GPU-Agent"

function Write-GateLog {
    param([string]$Message)

    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    $line | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Test-DfsReady {
    try {
        $response = Invoke-WebRequest `
            -Uri $dfsHealthUrl `
            -Method Get `
            -UseBasicParsing `
            -TimeoutSec $probeTimeoutSeconds
        if ([int]$response.StatusCode -ne 200) {
            return $false
        }
        $payload = $response.Content | ConvertFrom-Json
        $hasReady = $payload.PSObject.Properties.Name -contains "ready"
        return $hasReady -and ($payload.ready -is [bool]) -and ($payload.ready -eq $true)
    } catch {
        return $false
    }
}

function Start-MechaScheduledTask {
    param([string]$TaskName)

    try {
        Start-ScheduledTask -TaskName $TaskName
    } catch {
        & schtasks.exe /Run /TN $TaskName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to start scheduled task $TaskName"
        }
    }
    Write-GateLog "Triggered $TaskName."
}

function Wait-ComfyUIReady {
    $deadline = (Get-Date).AddSeconds($comfyReadyTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest `
                -Uri "http://127.0.0.1:8188/system_stats" `
                -Method Get `
                -UseBasicParsing `
                -TimeoutSec 5
            if ([int]$response.StatusCode -eq 200) {
                return $true
            }
        } catch {
            # Wan is still starting.
        }
        Start-Sleep -Seconds 5
    }
    return $false
}

New-Item -ItemType Directory -Path (Split-Path -Parent $logFile) -Force | Out-Null
Write-GateLog "Waiting for DFS readiness at $dfsHealthUrl."

while ($true) {
    $consecutivePasses = 0
    while ($consecutivePasses -lt $requiredConsecutivePasses) {
        if (Test-DfsReady) {
            $consecutivePasses += 1
            Write-GateLog "DFS readiness pass $consecutivePasses/$requiredConsecutivePasses."
        } else {
            if ($consecutivePasses -gt 0) {
                Write-GateLog "DFS readiness failed; consecutive pass count reset to zero."
            }
            $consecutivePasses = 0
        }
        if ($consecutivePasses -lt $requiredConsecutivePasses) {
            Start-Sleep -Seconds $probeIntervalSeconds
        }
    }

    Write-GateLog "DFS passed 6 consecutive checks; stabilizing for 120 seconds."
    Start-Sleep -Seconds $stabilizationSeconds
    if (Test-DfsReady) {
        Write-GateLog "DFS final readiness check passed; releasing Drama GPU startup."
        break
    }
    Write-GateLog "DFS final readiness check failed; returning to the readiness gate."
}

Start-MechaScheduledTask -TaskName $wanTaskName
if (-not (Wait-ComfyUIReady)) {
    throw "Wan ComfyUI did not become ready on port 8188 within $comfyReadyTimeoutSeconds seconds"
}
Write-GateLog "Wan ComfyUI is ready on port 8188."

Start-MechaScheduledTask -TaskName $agentTaskName
Write-GateLog "Drama GPU startup sequence completed."
