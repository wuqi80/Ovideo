$ErrorActionPreference = "Stop"

param(
    [string]$ServerUrl = "https://192.168.31.134"
)

$root = "E:\MECHA-GPU"
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "task-repair.log"
$startAgentPath = Join-Path $root "start_agent.cmd"
$startAgentScriptPath = Join-Path $root "scripts\windows_gpu_start_agent.cmd"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-RepairLog {
    param([string]$Message)

    "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message |
        Out-File -FilePath $logFile -Append -Encoding utf8
}

function Register-MechaTask {
    param(
        [string]$TaskName,
        [string]$CommandPath,
        [string]$StartupDelay = "PT0S"
    )

    $action = New-ScheduledTaskAction `
        -Execute "cmd.exe" `
        -Argument ('/c "{0}"' -f $CommandPath) `
        -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = $StartupDelay
    $principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

    try {
        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $action `
            -Trigger $trigger `
            -Principal $principal `
            -Settings $settings `
            -Force | Out-Null
    } catch {
        Write-RepairLog ("Register-ScheduledTask failed for {0}, fallback to schtasks.exe: {1}" -f $TaskName, $_.Exception.Message)
        Register-ScheduledTaskFallback -TaskName $TaskName -CommandPath $CommandPath
    }

    Write-RepairLog "Registered $TaskName (delay=$StartupDelay, restart every 1 minute)."
}

function Register-ScheduledTaskFallback {
    param(
        [string]$TaskName,
        [string]$CommandPath
    )
    try {
        schtasks.exe /Delete /TN $TaskName /F | Out-Null
    } catch {
        # ignore delete failures
    }
    $cmd = 'cmd.exe /c "{0}"' -f $CommandPath
    $createArgs = @(
        "/Create",
        "/F",
        "/TN",
        "`"$TaskName`"",
        "/SC",
        "ONSTART",
        "/RU",
        "SYSTEM",
        "/RL",
        "HIGHEST",
        "/TR",
        "`"$cmd`""
    )
    & schtasks.exe @createArgs | Out-Null
}

function Ensure-AgentServerAddress {
    param([string]$Path)
    if (-not (Test-Path -Path $Path)) {
        return
    }
    $content = Get-Content -Path $Path -Raw -Encoding UTF8
    if ($content -match 'MECHA_SERVER_URL=') {
        $replacement = ('set "MECHA_SERVER_URL={0}"' -f $ServerUrl)
        $content = [regex]::Replace(
            $content,
            'set\s+"?MECHA_SERVER_URL=.*',
            $replacement
        )
    } else {
        $content = "$content`r`nset MECHA_SERVER_URL=$ServerUrl"
    }
    $content | Set-Content -Path $Path -Encoding UTF8
    Write-RepairLog "Ensured MECHA_SERVER_URL=$ServerUrl in $Path"
}

function Start-OptionalTask {
    param([string]$TaskName)

    try {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    } catch {
        return
    }
    if ($task.State -ne "Ready" -and $task.State -ne "Running") {
        $command = Join-Path $root "scripts\windows_gpu_start_h3_comfyui.cmd"
        if (Test-Path $command) {
            Register-ScheduledTaskFallback -TaskName $TaskName -CommandPath $command
        }
    }
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-RepairLog "Triggered startup for $TaskName."
}

function Register-ScheduledTaskFallback {
    param([string]$TaskName)
    if ($TaskName -ne "MECHA-GPU-ComfyUI-H3") {
        return
    }
    $command = Join-Path $root "scripts\windows_gpu_start_h3_comfyui.cmd"
    if (-not (Test-Path $command)) {
        return
    }
    Register-MechaTask `
        -TaskName $TaskName `
        -CommandPath $command
}

Set-Content -Path $logFile -Value "" -Encoding utf8
Write-RepairLog "Rebuilding MECHA GPU startup tasks."

Stop-ScheduledTask -TaskName "MECHA-GPU-Agent" -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "MECHA-GPU-ComfyUI" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Ensure-AgentServerAddress -Path $startAgentPath
Ensure-AgentServerAddress -Path $startAgentScriptPath

Register-MechaTask `
    -TaskName "MECHA-GPU-ComfyUI" `
    -CommandPath (Join-Path $root "start_comfyui.cmd")
Register-MechaTask `
    -TaskName "MECHA-GPU-Agent" `
    -CommandPath (Join-Path $root "start_agent.cmd") `
    -StartupDelay "PT1M"

try {
    Start-ScheduledTask -TaskName "MECHA-GPU-ComfyUI"
} catch {
    schtasks.exe /Run /TN "MECHA-GPU-ComfyUI" | Out-Null
}
Write-RepairLog "Started MECHA-GPU-ComfyUI."
Start-Sleep -Seconds 15
try {
    Start-ScheduledTask -TaskName "MECHA-GPU-Agent"
} catch {
    schtasks.exe /Run /TN "MECHA-GPU-Agent" | Out-Null
}
Write-RepairLog "Started MECHA-GPU-Agent."
Start-OptionalTask -TaskName "MECHA-GPU-ComfyUI-H3"

Get-ScheduledTask -TaskName "MECHA-GPU-ComfyUI", "MECHA-GPU-Agent" |
    Select-Object TaskName, State |
    Format-Table -AutoSize |
    Out-String |
    Out-File -FilePath $logFile -Append -Encoding utf8

Write-RepairLog "Startup tasks rebuilt and launched."
