/**
 * 图片优化工具
 * 用于生成缩略图、压缩图片等
 * 统一使用WebP格式
 */

/**
 * 生成WebP缩略图（长边1024px）
 * @param dataUrl 原始DataURL
 * @param maxSize 长边最大尺寸（默认1024px）
 * @param quality 质量（0-1，默认0.8）
 * @returns WebP格式的DataURL
 */
export async function generateThumbnail(
  dataUrl: string, 
  maxSize: number = 1024, 
  quality: number = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      // 计算缩放比例（长边缩放到maxSize）
      const { width, height } = img;
      let newWidth = width;
      let newHeight = height;
      
      if (width > height) {
        // 宽度是长边
        if (width > maxSize) {
          newWidth = maxSize;
          newHeight = Math.round(height * (maxSize / width));
        }
      } else {
        // 高度是长边
        if (height > maxSize) {
          newHeight = maxSize;
          newWidth = Math.round(width * (maxSize / height));
        }
      }
      
      // 创建canvas
      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法获取canvas上下文'));
        return;
      }
      
      // 绘制缩放后的图片
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      
      // 转为WebP格式
      const thumbnail = canvas.toDataURL('image/webp', quality);
      resolve(thumbnail);
    };
    
    img.onerror = () => {
      reject(new Error('图片加载失败'));
    };
    
    img.src = dataUrl;
  });
}

/**
 * 压缩图片为WebP格式（保持原尺寸或缩放）
 * @param dataUrl 原始DataURL
 * @param maxSize 最大尺寸（宽或高，默认不限制）
 * @param quality 质量（0-1，默认0.85）
 * @returns WebP格式的DataURL
 */
export async function compressImage(
  dataUrl: string,
  maxSize: number | null = null,
  quality: number = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      let { width, height } = img;
      
      // 计算缩放比例（如果指定了maxSize）
      if (maxSize && (width > maxSize || height > maxSize)) {
        const scale = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      
      // 创建canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法获取canvas上下文'));
        return;
      }
      
      // 绘制图片
      ctx.drawImage(img, 0, 0, width, height);
      
      // 转为WebP格式
      const compressed = canvas.toDataURL('image/webp', quality);
      resolve(compressed);
    };
    
    img.onerror = () => {
      reject(new Error('图片加载失败'));
    };
    
    img.src = dataUrl;
  });
}

/**
 * 估算DataURL的大小（字节）
 */
export function estimateDataUrlSize(dataUrl: string): number {
  // Base64编码会增加约33%的大小
  const base64Data = dataUrl.split(',')[1] || dataUrl;
  return Math.ceil(base64Data.length * 0.75);
}

/**
 * 格式化文件大小显示
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 批量生成缩略图（带进度回调）
 */
export async function batchGenerateThumbnails(
  dataUrls: string[],
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const thumbnails: string[] = [];
  
  for (let i = 0; i < dataUrls.length; i++) {
    try {
      const thumbnail = await generateThumbnail(dataUrls[i]);
      thumbnails.push(thumbnail);
      
      if (onProgress) {
        onProgress(i + 1, dataUrls.length);
      }
    } catch (error) {
      console.error(`生成缩略图失败 (${i + 1}/${dataUrls.length}):`, error);
      // 失败时使用原图
      thumbnails.push(dataUrls[i]);
    }
  }
  
  return thumbnails;
}

