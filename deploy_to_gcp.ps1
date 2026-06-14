# Drama GCP 部署脚本 - 在本地 PowerShell 里运行
# 用法：powershell -ExecutionPolicy Bypass -File D:\Codex\Drama\deploy_to_gcp.ps1

$Zone     = "asia-east2-c"
$Instance = "drama-project"
$LocalDeploy = "D:\Codex\Drama\deploy"
$SetupScript = "D:\Codex\Drama\server_setup.sh"
$TempZip  = "$env:TEMP\drama_deploy.tar.gz"

Write-Host "=========================================="
Write-Host "  [1/4] 打包代码（排除 node_modules / .venv）..."
Write-Host "=========================================="

# 用 tar 打包，排除大目录（需要 Git Bash 或 WSL 的 tar，Win10+ 内置）
$tarArgs = @(
    "-czf", $TempZip,
    "--exclude=./new_html/node_modules",
    "--exclude=./.venv",
    "--exclude=./__pycache__",
    "--exclude=./.pytest_cache",
    "--exclude=./logs",
    "--exclude=./temp",
    "--exclude=./uploads",
    "--exclude=./outputs",
    "--exclude=./persistent_storage",
    "-C", $LocalDeploy,
    "."
)
& tar @tarArgs
Write-Host "打包完成：$TempZip ($([math]::Round((Get-Item $TempZip).Length/1MB, 1)) MB)"

Write-Host ""
Write-Host "=========================================="
Write-Host "  [2/4] 上传压缩包到服务器..."
Write-Host "=========================================="

gcloud compute scp `
    $TempZip `
    "${Instance}:/home/Administrator/drama_deploy.tar.gz" `
    --zone=$Zone

Write-Host ""
Write-Host "=========================================="
Write-Host "  [3/4] 解压并上传部署脚本..."
Write-Host "=========================================="

gcloud compute ssh $Instance --zone=$Zone --command="mkdir -p ~/deploy && tar -xzf ~/drama_deploy.tar.gz -C ~/deploy && rm ~/drama_deploy.tar.gz"

gcloud compute scp `
    $SetupScript `
    "${Instance}:/home/Administrator/server_setup.sh" `
    --zone=$Zone

Write-Host ""
Write-Host "=========================================="
Write-Host "  [4/4] 在服务器上执行部署（约 5-10 分钟）..."
Write-Host "=========================================="

gcloud compute ssh $Instance --zone=$Zone --command="bash /home/Administrator/server_setup.sh 2>&1"

Write-Host ""
Write-Host "=========================================="
Write-Host "  部署完成！"
Write-Host "  访问：http://drama.rongyansuanli.com"
Write-Host "  管理：http://drama.rongyansuanli.com/admin/"
Write-Host "  账号：admin / admin123"
Write-Host "=========================================="

# 清理本地临时文件
Remove-Item $TempZip -ErrorAction SilentlyContinue
