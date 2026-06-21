$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$health = Invoke-RestMethod -Uri "http://localhost:6006/health"
if ($health.status -ne "healthy") {
    throw "Health check failed"
}

$AdminPassword = $env:ADMIN_PASSWORD
if (-not $AdminPassword) {
    $AdminPassword = "admin123"
    Write-Host "ADMIN_PASSWORD is not set; using local development password. The server must set ALLOW_DEV_ADMIN_PASSWORD=true."
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

$Node = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (Test-Path $Node) {
    & $Node ".\scripts\verify_local_browser.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Browser verification failed"
    }
} else {
    Write-Host "Node runtime not found; skipped browser screenshot verification."
}

Write-Host "Local deployment verification passed."
