#!/bin/bash
# 创建存储目录的符号链接，使单数和复数形式都可访问

cd persistent_storage

# 创建 videos -> video 符号链接
if [ -d "video" ] && [ ! -e "videos" ]; then
    ln -s video videos
    echo "✅ 已创建符号链接: videos -> video"
elif [ -e "videos" ]; then
    echo "ℹ️  videos 已存在，跳过"
fi

# 创建 images -> image 符号链接
if [ -d "image" ] && [ ! -e "images" ]; then
    ln -s image images
    echo "✅ 已创建符号链接: images -> image"
elif [ -e "images" ]; then
    echo "ℹ️  images 已存在，跳过"
fi

echo ""
echo "📁 当前目录结构:"
ls -la | grep -E "video|image"

