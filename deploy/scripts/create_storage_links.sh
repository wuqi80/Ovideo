#!/bin/bash
# 创建符号链接兼容新旧URL路径

cd persistent_storage

# 创建 videos -> video 符号链接
if [ -d "video" ] && [ ! -e "videos" ]; then
    ln -s video videos
    echo "✅ 创建符号链接: videos -> video"
elif [ -L "videos" ]; then
    echo "✅ 符号链接已存在: videos"
else
    echo "⚠️ 跳过videos链接"
fi

# 创建 images -> image 符号链接
if [ -d "image" ] && [ ! -e "images" ]; then
    ln -s image images
    echo "✅ 创建符号链接: images -> image"
elif [ -L "images" ]; then
    echo "✅ 符号链接已存在: images"
else
    echo "⚠️ 跳过images链接"
fi

echo ""
echo "当前目录结构："
ls -la | grep -E "^d|^l"

echo ""
echo "✅ 完成！现在 /storage/videos/ 和 /storage/video/ 都可以访问相同的文件"

