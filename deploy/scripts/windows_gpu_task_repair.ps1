param(
    [string]$ServerUrl = "https://tv.ostory.ai",
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$root = "E:\OSTORY-GPU"
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "task-repair.log"
$startAgentPath = Join-Path $root "start_agent.cmd"
$startAgentScriptPath = Join-Path $root "scripts\windows_gpu_start_agent.cmd"
$legacyH3TaskName = "OSTORY-GPU-ComfyUI-H3"
$startupGateTaskName = "OSTORY-GPU-After-DFS"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-RepairLog {
    param([string]$Message)

    "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message |
        Out-File -FilePath $logFile -Append -Encoding utf8
}

function Register-OstoryTaskCom {
    param(
        [string]$TaskName,
        [string]$CommandPath,
        [string]$StartupDelay,
        [bool]$AtStartup,
        [int]$RestartCount
    )

    $scheduler = New-Object -ComObject "Schedule.Service"
    $scheduler.Connect()
    $folder = $scheduler.GetFolder("\")
    $definition = $scheduler.NewTask(0)

    $definition.RegistrationInfo.Description = "OSTORY GPU startup task: $TaskName"
    $definition.Principal.UserId = "SYSTEM"
    $definition.Principal.LogonType = 5 # TASK_LOGON_SERVICE_ACCOUNT
    $definition.Principal.RunLevel = 1 # TASK_RUNLEVEL_HIGHEST

    if ($AtStartup) {
        $trigger = $definition.Triggers.Create(8) # TASK_TRIGGER_BOOT
        $trigger.Enabled = $true
        $trigger.Delay = $StartupDelay
    }

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
    $settings.RestartCount = $RestartCount
    if ($RestartCount -gt 0) {
        $settings.RestartInterval = "PT1M"
    }

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

function Register-OstoryTask {
    param(
        [string]$TaskName,
        [string]$CommandPath,
        [string]$StartupDelay = "PT0S",
        [bool]$AtStartup = $true,
        [int]$RestartCount = 999
    )

    $action = New-ScheduledTaskAction `
        -Execute "cmd.exe" `
        -Argument ('/c "{0}"' -f $CommandPath) `
        -WorkingDirectory $root
    $trigger = $null
    if ($AtStartup) {
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $trigger.Delay = $StartupDelay
    }
    $principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest
    $settingsParams = @{
        AllowStartIfOnBatteries = $true
        DontStopIfGoingOnBatteries = $true
        StartWhenAvailable = $true
        MultipleInstances = "IgnoreNew"
        ExecutionTimeLimit = (New-TimeSpan -Seconds 0)
    }
    if ($RestartCount -gt 0) {
        $settingsParams.RestartCount = $RestartCount
        $settingsParams.RestartInterval = (New-TimeSpan -Minutes 1)
    }
    $settings = New-ScheduledTaskSettingsSet @settingsParams

    try {
        $registerParams = @{
            TaskName = $TaskName
            Action = $action
            Principal = $principal
            Settings = $settings
            Force = $true
        }
        if ($AtStartup) {
            $registerParams.Trigger = $trigger
        }
        Register-ScheduledTask @registerParams | Out-Null
    } catch {
        Write-RepairLog (
            "Register-ScheduledTask failed for {0}; using Task Scheduler COM fallback: {1}" -f `
                $TaskName,
            $_.Exception.Message
        )
        Register-OstoryTaskCom `
            -TaskName $TaskName `
            -CommandPath $CommandPath `
            -StartupDelay $StartupDelay `
            -AtStartup $AtStartup `
            -RestartCount $RestartCount
    }

    Write-RepairLog "Registered $TaskName (at_startup=$AtStartup, delay=$StartupDelay, restart_count=$RestartCount, SYSTEM service account)."
}

function Ensure-AgentServerAddress {
    param([string]$Path)

    if (-not (Test-Path -Path $Path)) {
        return
    }

    $content = Get-Content -Path $Path -Raw -Encoding UTF8
    if ($content -match 'OSTORY_SERVER_URL=') {
        $replacement = ('set "OSTORY_SERVER_URL={0}"' -f $ServerUrl)
        $content = [regex]::Replace(
            $content,
            'set\s+"?OSTORY_SERVER_URL=.*',
            $replacement
        )
    } else {
        $content = "$content`r`nset OSTORY_SERVER_URL=$ServerUrl"
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
    Write-RepairLog "Ensured OSTORY_SERVER_URL=$ServerUrl in $Path"
}

function Ensure-AgentComfyUIPorts {
    param([string]$Path)

    if (-not (Test-Path -Path $Path)) {
        return
    }

    $content = Get-Content -Path $Path -Raw -Encoding UTF8
    $replacement = 'set OSTORY_COMFYUI_PORTS=8188'
    if ($content -match 'OSTORY_COMFYUI_PORTS=') {
        $content = [regex]::Replace(
            $content,
            '(?im)^set\s+"?OSTORY_COMFYUI_PORTS=.*$',
            $replacement
        )
    } else {
        $content = "$content`r`n$replacement"
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
    Write-RepairLog "Ensured OSTORY_COMFYUI_PORTS=8188 in $Path"
}

Set-Content -Path $logFile -Value "" -Encoding utf8
Write-RepairLog "Rebuilding OSTORY GPU startup tasks without stopping running processes."

Ensure-AgentServerAddress -Path $startAgentPath
Ensure-AgentServerAddress -Path $startAgentScriptPath
Ensure-AgentComfyUIPorts -Path $startAgentPath
Ensure-AgentComfyUIPorts -Path $startAgentScriptPath

$taskDefinitions = @(
    @{
        Name = "OSTORY-GPU-ComfyUI"
        Command = Join-Path $root "start_comfyui.cmd"
        Delay = "PT0S"
        AtStartup = $false
        RestartCount = 0
    },
    @{
        Name = "OSTORY-GPU-Agent"
        Command = Join-Path $root "start_agent.cmd"
        Delay = "PT0S"
        AtStartup = $false
        RestartCount = 999
    },
    @{
        Name = $startupGateTaskName
        Command = Join-Path $root "scripts\windows_gpu_wait_for_dfs.cmd"
        Delay = "PT0S"
        AtStartup = $true
        RestartCount = 999
    }
)

foreach ($taskDefinition in $taskDefinitions) {
    if (-not (Test-Path $taskDefinition.Command)) {
        throw "Missing startup command: $($taskDefinition.Command)"
    }
    Register-OstoryTask `
        -TaskName $taskDefinition.Name `
        -CommandPath $taskDefinition.Command `
        -StartupDelay $taskDefinition.Delay `
        -AtStartup $taskDefinition.AtStartup `
        -RestartCount $taskDefinition.RestartCount
}

# H3 now shares port 8188 with Wan and is started on demand by the Agent.
# Keep the legacy task recoverable, but never let it race the Wan startup task.
$legacyH3Task = Get-ScheduledTask -TaskName $legacyH3TaskName -ErrorAction SilentlyContinue
if ($legacyH3Task) {
    Disable-ScheduledTask -TaskName $legacyH3TaskName | Out-Null
    Write-RepairLog "Disabled legacy $legacyH3TaskName; H3 is Agent-managed on port 8188."
}

if ($StartNow) {
    try {
        Start-ScheduledTask -TaskName $startupGateTaskName
    } catch {
        schtasks.exe /Run /TN $startupGateTaskName | Out-Null
    }
    Write-RepairLog "Triggered DFS-gated startup task $startupGateTaskName."
}

Get-ScheduledTask -TaskName ($taskDefinitions.Name) |
    Select-Object TaskName, State |
    Format-Table -AutoSize |
    Out-String |
    Out-File -FilePath $logFile -Append -Encoding utf8

Write-RepairLog "Startup tasks rebuilt successfully."
