#!/bin/bash
# 一键修复部署脚本
# 在服务器的 MY 项目根目录下执行：bash fix_deploy.sh

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=============================="
echo "  开始修复部署"
echo "=============================="

# 1. 确保 dist 目录存在且完整
echo ""
echo "[1/3] 检查 dist 目录..."
if [ -f "dist/index.html" ] && [ -f "dist/assets/index-BZV40eAE.css" ] && [ -f "dist/assets/vendor-Bzgz95E1.js" ] && [ -f "dist/assets/utils-DDFnePNV.js" ]; then
    echo "  ✅ dist 目录完整"
else
    echo "  ❌ dist 目录不完整！"
    echo "  缺少的文件："
    [ ! -f "dist/index.html" ] && echo "    - dist/index.html"
    [ ! -f "dist/assets/index-BZV40eAE.css" ] && echo "    - dist/assets/index-BZV40eAE.css"
    [ ! -f "dist/assets/vendor-Bzgz95E1.js" ] && echo "    - dist/assets/vendor-Bzgz95E1.js"
    [ ! -f "dist/assets/utils-DDFnePNV.js" ] && echo "    - dist/assets/utils-DDFnePNV.js"
    [ ! -f "dist/assets/index-B8KWavIh.js" ] && echo "    - dist/assets/index-B8KWavIh.js"
    echo ""
    echo "  请确保 deploy/dist 整个目录已上传到服务器项目根目录"
    exit 1
fi

# 2. 列出 dist/assets 的所有文件
echo ""
echo "[2/3] dist/assets 文件列表："
ls -la dist/assets/

# 3. 重启后端
echo ""
echo "[3/3] 重启后端服务..."
# 查找并杀掉现有进程
PID=$(ps aux | grep 'cluster_main' | grep -v grep | awk '{print $2}' | head -1)
if [ -n "$PID" ]; then
    echo "  杀掉旧进程: $PID"
    kill "$PID" 2>/dev/null || true
    sleep 2
fi

# 启动新进程
echo "  启动新进程..."
nohup python3 cluster_main.py > server.log 2>&1 &
sleep 3

# 验证
NEW_PID=$(ps aux | grep 'cluster_main' | grep -v grep | awk '{print $2}' | head -1)
if [ -n "$NEW_PID" ]; then
    echo "  ✅ 服务已启动 (PID: $NEW_PID)"
else
    echo "  ❌ 启动失败，查看 server.log"
    tail -20 server.log
    exit 1
fi

echo ""
echo "=============================="
echo "  ✅ 部署完成！"
echo "  请在浏览器 Ctrl+Shift+R 强制刷新"
echo "=============================="
