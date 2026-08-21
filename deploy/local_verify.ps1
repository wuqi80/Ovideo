$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$health = Invoke-RestMethod -Uri "http://localhost:6006/health"
if ($health.status -ne "healthy") {
    throw "Health check failed"
}

$AdminPassword = $env:ADMIN_PASSWORD
if (-not $AdminPassword) {
    throw "ADMIN_PASSWORD must be set for authenticated local verification."
}

$loginBody = @{ username = "admin"; password = $AdminPassword } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "http://localhost:6006/api/login" -Method Post -ContentType "application/json" -Body $loginBody
if (-not $login.token) {
    throw "Login did not return token"
}

$headers = @{ Authorization = ("Bearer " + $login.token) }
$projects = Invoke-RestMethod -Uri "http://localhost:6006/api/projects" -Headers $headers
if ($projects.success -ne $true) {
    throw "Project list check failed"
}

$NodeCommand = if ($env:OSTORY_NODE_BIN) {
    Get-Item -LiteralPath $env:OSTORY_NODE_BIN -ErrorAction Stop
} else {
    Get-Command node -ErrorAction SilentlyContinue
}
if ($NodeCommand) {
    & $NodeCommand.Source ".\scripts\verify_local_browser.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Browser verification failed"
    }
} else {
    Write-Host "Node runtime not found; set OSTORY_NODE_BIN to enable browser verification."
}

Write-Host "Local deployment verification passed."
