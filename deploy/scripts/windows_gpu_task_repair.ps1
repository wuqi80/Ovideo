$ErrorActionPreference = "Stop"

$root = "E:\MECHA-GPU"
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "task-repair.log"

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

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Force | Out-Null

    Write-RepairLog "Registered $TaskName (delay=$StartupDelay, restart every 1 minute)."
}

Set-Content -Path $logFile -Value "" -Encoding utf8
Write-RepairLog "Rebuilding MECHA GPU startup tasks."

Stop-ScheduledTask -TaskName "MECHA-GPU-Agent" -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "MECHA-GPU-ComfyUI" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Register-MechaTask `
    -TaskName "MECHA-GPU-ComfyUI" `
    -CommandPath (Join-Path $root "start_comfyui.cmd")
Register-MechaTask `
    -TaskName "MECHA-GPU-Agent" `
    -CommandPath (Join-Path $root "start_agent.cmd") `
    -StartupDelay "PT1M"

Start-ScheduledTask -TaskName "MECHA-GPU-ComfyUI"
Write-RepairLog "Started MECHA-GPU-ComfyUI."
Start-Sleep -Seconds 15
Start-ScheduledTask -TaskName "MECHA-GPU-Agent"
Write-RepairLog "Started MECHA-GPU-Agent."

Get-ScheduledTask -TaskName "MECHA-GPU-ComfyUI", "MECHA-GPU-Agent" |
    Select-Object TaskName, State |
    Format-Table -AutoSize |
    Out-String |
    Out-File -FilePath $logFile -Append -Encoding utf8

Write-RepairLog "Startup tasks rebuilt and launched."
