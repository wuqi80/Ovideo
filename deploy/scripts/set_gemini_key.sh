#!/bin/bash

# Gemini中转站API Key快速配置脚本

echo "═══════════════════════════════════════════════════"
echo "  Gemini中转站 API Key 配置工具"
echo "═══════════════════════════════════════════════════"
echo ""

# 检查参数
if [ -z "$1" ]; then
    echo "❌ 错误：请提供API Key"
    echo ""
    echo "使用方法："
    echo "  ./set_gemini_key.sh sk-your-api-key"
    echo ""
    echo "或者："
    echo "  bash set_gemini_key.sh sk-your-api-key"
    echo ""
    exit 1
fi

API_KEY="$1"

echo "🔑 API Key: ${API_KEY:0:15}..."
echo ""

# 方法1：修改代码
echo "📝 方法1：修改代码文件"
TARGET_FILE="new_html/services/geminiProxyService.ts"

if [ -f "$TARGET_FILE" ]; then
    # 备份原文件
    cp "$TARGET_FILE" "${TARGET_FILE}.backup"
    
    # 替换API Key
    sed -i "s/return 'YOUR_API_KEY';/return '$API_KEY';/" "$TARGET_FILE"
    
    echo "   ✅ 已更新 $TARGET_FILE"
    echo "   💾 备份文件: ${TARGET_FILE}.backup"
else
    echo "   ❌ 文件不存在: $TARGET_FILE"
fi

echo ""

# 方法2：设置环境变量
echo "📝 方法2：设置环境变量"
echo "   请在终端执行以下命令："
echo ""
echo "   export VITE_GEMINI_PROXY_API_KEY=\"$API_KEY\""
echo ""

# 提示重新构建
echo "═══════════════════════════════════════════════════"
echo "⚠️  重要：需要重新构建前端"
echo "═══════════════════════════════════════════════════"
echo ""
echo "执行以下命令："
echo "  cd new_html"
echo "  npm run build"
echo "  cd .."
echo ""
echo "或者一键执行："
echo "  cd new_html && npm run build && cd .."
echo ""

read -p "是否现在构建？(y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🔨 开始构建..."
    cd new_html
    npm run build
    cd ..
    echo ""
    echo "✅ 构建完成！"
    echo ""
    echo "现在可以启动服务器："
    echo "  python cluster_main.py"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "✅ 配置完成"
echo "═══════════════════════════════════════════════════"

