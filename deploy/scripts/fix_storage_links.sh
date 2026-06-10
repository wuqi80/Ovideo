#!/bin/bash
# 修复存储目录链接

echo "🔧 开始修复存储目录链接..."
cd persistent_storage || { echo "❌ persistent_storage 目录不存在"; exit 1; }

# 1. 检查并删除旧的 videos 目录
if [ -d "videos" ] && [ ! -L "videos" ]; then
    echo "📦 发现 videos 是真实目录，检查是否为空..."
    if [ -z "$(ls -A videos 2>/dev/null)" ]; then
        echo "   ✅ videos 目录为空，可以安全删除"
        rm -rf videos
    else
        echo "   ⚠️  videos 目录不为空，需要合并内容"
        echo "   正在将 videos/ 内容移动到 video/..."
        cp -r videos/* video/ 2>/dev/null || true
        rm -rf videos
        echo "   ✅ 内容已合并并删除旧目录"
    fi
fi

# 2. 检查并删除旧的 images 目录
if [ -d "images" ] && [ ! -L "images" ]; then
    echo "📦 发现 images 是真实目录，检查是否为空..."
    if [ -z "$(ls -A images 2>/dev/null)" ]; then
        echo "   ✅ images 目录为空，可以安全删除"
        rm -rf images
    else
        echo "   ⚠️  images 目录不为空，需要合并内容"
        echo "   正在将 images/ 内容移动到 image/..."
        cp -r images/* image/ 2>/dev/null || true
        rm -rf images
        echo "   ✅ 内容已合并并删除旧目录"
    fi
fi

# 3. 创建符号链接
echo ""
echo "🔗 创建符号链接..."

if [ ! -e "videos" ]; then
    ln -s video videos
    echo "   ✅ 已创建 videos -> video"
else
    echo "   ⚠️  videos 已存在"
fi

if [ ! -e "images" ]; then
    ln -s image images
    echo "   ✅ 已创建 images -> image"
else
    echo "   ⚠️  images 已存在"
fi

# 4. 验证结果
echo ""
echo "📊 验证结果："
echo ""
ls -la | grep -E "^d|^l" | grep -E "video|image"

echo ""
echo "🧪 测试访问："
if [ -d "videos" ]; then
    echo "   ✅ videos/ 可访问"
else
    echo "   ❌ videos/ 不可访问"
fi

if [ -d "images" ]; then
    echo "   ✅ images/ 可访问"
else
    echo "   ❌ images/ 不可访问"
fi

echo ""
echo "✅ 修复完成！请重启FastAPI服务器"

