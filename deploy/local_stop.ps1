param(
    [switch]$StopInfra
)

$ErrorActionPreference = 'Stop'

$listeners = netstat -ano | Select-String ":6006\s+.*LISTENING"
foreach ($line in $listeners) {
    $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
    $pidValue = [int]$parts[-1]
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
}

if ($StopInfra) {
    foreach ($name in @("drama-postgres", "drama-redis")) {
        $exists = docker ps -a --format "{{.Names}}" | Select-String "^$name$"
        if ($exists) {
            docker stop $name | Out-Null
        }
    }
}

Write-Host "Local backend stopped."
