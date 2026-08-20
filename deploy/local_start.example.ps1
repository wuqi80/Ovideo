param(
    [switch]$BuildFrontend
)

# ============================================================
# 模板文件：复制为 local_start.ps1 后，把下方 <FILL_ME> 占位符替换为
# 团队负责人单独提供的真实密钥即可。local_start.ps1 已在 .gitignore 中，
# 不会被提交。其余非密钥配置（端口/库名/worker 数）一般无需修改。
# ============================================================

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Test-ContainerExists($Name) {
    $names = docker ps -a --format "{{.Names}}"
    return $names -contains $Name
}

function Ensure-Container($Name, $Image, $RunArgs) {
    if (Test-ContainerExists $Name) {
        docker start $Name | Out-Null
        return
    }
    docker run -d --name $Name @RunArgs $Image | Out-Null
}

Ensure-Container "drama-postgres" "postgres:17-alpine" @(
    "-e", "POSTGRES_USER=my2_user",
    "-e", "POSTGRES_PASSWORD=<FILL_ME_DB_PASSWORD>",
    "-e", "POSTGRES_DB=my2_db",
    "-p", "5432:5432"
)

Ensure-Container "drama-redis" "redis:7.0-alpine" @(
    "-p", "6379:6379"
)

for ($i = 0; $i -lt 60; $i++) {
    docker exec drama-postgres pg_isready -U my2_user -d my2_db | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
}
if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL is not ready"
}

foreach ($dir in @(
    "logs", "uploads", "outputs", "outputs/agent", "temp", "temp/uploads",
    "history", "persistent_storage", "persistent_storage/audio",
    "persistent_storage/uploads", "persistent_storage/video", "persistent_storage/image"
)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root $dir) | Out-Null
}

$SeedPython = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if (-not (Test-Path $SeedPython)) { $SeedPython = "python" }
if (-not (Test-Path ".\.venv\Scripts\python.exe")) { & $SeedPython -m venv .venv }

$DepsOk = $false
try {
    & ".\.venv\Scripts\python.exe" -c "import fastapi, uvicorn, asyncpg, redis" | Out-Null
    $DepsOk = ($LASTEXITCODE -eq 0)
} catch { $DepsOk = $false }
if (-not $DepsOk) { & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt }

if ($BuildFrontend) {
    if (-not (Test-Path ".\new_html\node_modules")) {
        docker run --rm -v "${Root}:/workspace" -w /workspace/new_html node:20-alpine npm ci
    }
    docker run --rm -v "${Root}:/workspace" -w /workspace/new_html node:20-alpine npm run build
}

# 启动前先停掉占用 6006 的旧进程，轮询等端口释放（重启可靠性）
$existing = Get-NetTCPConnection -LocalPort 6006 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "检测到 6006 被占用，停止旧后端进程后重启..."
    $existing.OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        if (-not (Get-NetTCPConnection -LocalPort 6006 -State Listen -ErrorAction SilentlyContinue)) { break }
    }
}
$Listening = Get-NetTCPConnection -LocalPort 6006 -State Listen -ErrorAction SilentlyContinue
if (-not $Listening) {
    # 重要：PowerShell 在 '& 脚本' 上下文里用 $env: 设的变量不会被 Start-Process 子进程继承，
    # 因此用 cmd 的 set 注入环境变量，由 cmd 启动 python，子进程必然继承。
    # 把 <FILL_ME_*> 替换为团队负责人提供的真实密钥。
    $envVars = [ordered]@{
        "PYTHONUTF8"           = "1"
        "PYTHONIOENCODING"     = "utf-8"
        "DB_HOST"              = "localhost"
        "DB_PORT"              = "5432"
        "DB_NAME"              = "my2_db"
        "DB_USER"              = "my2_user"
        "DB_PASSWORD"          = "<FILL_ME_DB_PASSWORD>"
        "REDIS_HOST"           = "localhost"
        "REDIS_PORT"           = "6379"
        "AGENT_ONLY_MODE"      = "true"
        "LITE_WORKERS_COUNT"   = "1"
        "DEEPSEEK_API_KEY"     = "<FILL_ME_DEEPSEEK_KEY>"
        "ARK_API_KEY"          = "<FILL_ME_ARK_KEY>"
        "GEMINI_TEXT_API_KEY"  = "<FILL_ME_GEMINI_TEXT_KEY>"
        "GEMINI_IMAGE_API_KEY" = "<FILL_ME_GEMINI_IMAGE_KEY>"
        "MINIMAX_API_KEY"      = "<FILL_ME_MINIMAX_JWT>"
        "SORA2_API_KEY"        = "<FILL_ME_SORA2_KEY>"
        "DASHSCOPE_API_KEY"    = "<FILL_ME_DASHSCOPE_KEY>"
    }
    $setCmds = ($envVars.GetEnumerator() | ForEach-Object { 'set "' + $_.Key + '=' + $_.Value + '"' }) -join ' && '
    $pyCmd = '.venv\Scripts\python.exe -m uvicorn cluster_main:app --host 0.0.0.0 --port 6006 > logs\local-backend.out.log 2> logs\local-backend.err.log'
    Start-Process -FilePath "cmd.exe" -ArgumentList ('/c ' + $setCmds + ' && ' + $pyCmd) -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
}

Write-Host "Local deployment is starting at http://localhost:6006/projects"
Write-Host "Run .\local_verify.ps1 to verify it."
