param(
    [string]$ServerUrl = "https://spti.ai",
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$root = "E:\MECHA-GPU"
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "task-repair.log"
$startAgentPath = Join-Path $root "start_agent.cmd"
$startAgentScriptPath = Join-Path $root "scripts\windows_gpu_start_agent.cmd"
$legacyH3TaskName = "MECHA-GPU-ComfyUI-H3"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-RepairLog {
    param([string]$Message)

    "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message |
        Out-File -FilePath $logFile -Append -Encoding utf8
}

function Register-MechaTaskCom {
    param(
        [string]$TaskName,
        [string]$CommandPath,
        [string]$StartupDelay
    )

    $scheduler = New-Object -ComObject "Schedule.Service"
    $scheduler.Connect()
    $folder = $scheduler.GetFolder("\")
    $definition = $scheduler.NewTask(0)

    $definition.RegistrationInfo.Description = "MECHA GPU startup task: $TaskName"
    $definition.Principal.UserId = "SYSTEM"
    $definition.Principal.LogonType = 5 # TASK_LOGON_SERVICE_ACCOUNT
    $definition.Principal.RunLevel = 1 # TASK_RUNLEVEL_HIGHEST

    $trigger = $definition.Triggers.Create(8) # TASK_TRIGGER_BOOT
    $trigger.Enabled = $true
    $trigger.Delay = $StartupDelay

    $action = $definition.Actions.Create(0) # TASK_ACTION_EXEC
    $action.Path = "cmd.exe"
    $action.Arguments = '/c "{0}"' -f $CommandPath
    $action.WorkingDirectory = $root

    $settings = $definition.Settings
    $settings.Enabled = $true
    $settings.AllowDemandStart = $true
    $settings.StartWhenAvailable = $true
    $settings.DisallowStartIfOnBatteries = $false
    $settings.StopIfGoingOnBatteries = $false
    $settings.ExecutionTimeLimit = "PT0S"
    $settings.MultipleInstances = 2 # TASK_INSTANCES_IGNORE_NEW
    $settings.RestartCount = 999
    $settings.RestartInterval = "PT1M"

    [void]$folder.RegisterTaskDefinition(
        $TaskName,
        $definition,
        6, # TASK_CREATE_OR_UPDATE
        "SYSTEM",
        $null,
        5, # TASK_LOGON_SERVICE_ACCOUNT
        $null
    )
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
        Write-RepairLog (
            "Register-ScheduledTask failed for {0}; using Task Scheduler COM fallback: {1}" -f `
                $TaskName,
            $_.Exception.Message
        )
        Register-MechaTaskCom `
            -TaskName $TaskName `
            -CommandPath $CommandPath `
            -StartupDelay $StartupDelay
    }

    Write-RepairLog "Registered $TaskName (delay=$StartupDelay, SYSTEM service account, restart every 1 minute)."
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

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
    Write-RepairLog "Ensured MECHA_SERVER_URL=$ServerUrl in $Path"
}

Set-Content -Path $logFile -Value "" -Encoding utf8
Write-RepairLog "Rebuilding MECHA GPU startup tasks without stopping running processes."

Ensure-AgentServerAddress -Path $startAgentPath
Ensure-AgentServerAddress -Path $startAgentScriptPath

$taskDefinitions = @(
    @{
        Name = "MECHA-GPU-ComfyUI"
        Command = Join-Path $root "start_comfyui.cmd"
        Delay = "PT0S"
    },
    @{
        Name = "MECHA-GPU-Agent"
        Command = Join-Path $root "start_agent.cmd"
        Delay = "PT1M30S"
    }
)

foreach ($taskDefinition in $taskDefinitions) {
    if (-not (Test-Path $taskDefinition.Command)) {
        throw "Missing startup command: $($taskDefinition.Command)"
    }
    Register-MechaTask `
        -TaskName $taskDefinition.Name `
        -CommandPath $taskDefinition.Command `
        -StartupDelay $taskDefinition.Delay
}

# H3 now shares port 8188 with Wan and is started on demand by the Agent.
# Keep the legacy task recoverable, but never let it race the Wan startup task.
$legacyH3Task = Get-ScheduledTask -TaskName $legacyH3TaskName -ErrorAction SilentlyContinue
if ($legacyH3Task) {
    Disable-ScheduledTask -TaskName $legacyH3TaskName | Out-Null
    Write-RepairLog "Disabled legacy $legacyH3TaskName; H3 is Agent-managed on port 8188."
}

if ($StartNow) {
    foreach ($taskDefinition in $taskDefinitions) {
        try {
            Start-ScheduledTask -TaskName $taskDefinition.Name
        } catch {
            schtasks.exe /Run /TN $taskDefinition.Name | Out-Null
        }
        Write-RepairLog "Triggered startup for $($taskDefinition.Name)."
    }
}

Get-ScheduledTask -TaskName ($taskDefinitions.Name) |
    Select-Object TaskName, State |
    Format-Table -AutoSize |
    Out-String |
    Out-File -FilePath $logFile -Append -Encoding utf8

Write-RepairLog "Startup tasks rebuilt successfully."
