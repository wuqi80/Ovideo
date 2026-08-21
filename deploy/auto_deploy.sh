#!/bin/bash
set -e

echo "=========================================="
echo "  Ostory TV deployment"
echo "=========================================="

# 检查必要工具
command -v python3 >/dev/null 2>&1 || { echo "需要 python3"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "需要 node"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "需要 npm"; exit 1; }

echo ""
echo "[1/8] 安装 Python 依赖..."
pip install -r requirements.txt -q 2>/dev/null || pip3 install -r requirements.txt -q
echo "  OK"

echo ""
echo "[2/8] 创建目录..."
mkdir -p persistent_storage/audio persistent_storage/uploads persistent_storage/video
mkdir -p uploads outputs outputs/agent temp history logs
echo "  OK"

echo ""
echo "[3/8] 启动 Redis..."
if command -v redis-server >/dev/null 2>&1; then
    redis-server --daemonize yes 2>/dev/null || echo "  Redis 已在运行"
    redis-cli ping 2>/dev/null && echo "  Redis OK" || echo "  Redis 连接失败"
else
    echo "  redis-server 未安装，跳过"
fi

echo ""
echo "[4/8] 执行数据库迁移..."
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs 2>/dev/null)
fi

python3 scripts/apply_migrations.py \
    --env .env \
    --root . \
    --manifest db_build/manifest.txt
echo "  迁移完成"

echo ""
echo "[5/8] 构建前端..."
cd new_html
npm install --silent 2>/dev/null
npm run build 2>/dev/null
cd ..
echo "  前端构建完成 → dist/"

echo ""
echo "[6/8] 运行后端测试..."
python -m pytest tests/test_smoke.py tests/test_audio_provider.py -v 2>/dev/null || python3 -m pytest tests/test_smoke.py tests/test_audio_provider.py -v

echo ""
echo "[7/8] 运行前端测试..."
cd new_html && npx vitest run 2>/dev/null && cd .. || cd ..

echo ""
echo "[8/8] 启动后端服务..."
nohup python cluster_main.py > logs/server.log 2>&1 &
SERVER_PID=$!
echo "  服务已启动 PID=$SERVER_PID"

sleep 2
if kill -0 $SERVER_PID 2>/dev/null; then
    echo ""
    echo "=========================================="
    echo "  部署完成!"
    echo "=========================================="
    echo "  后端 API: http://0.0.0.0:8000"
    echo "  日志文件: logs/server.log"
    echo "  停止服务: kill $SERVER_PID"
    echo "=========================================="
else
    echo "  服务启动失败，请检查 logs/server.log"
fi
