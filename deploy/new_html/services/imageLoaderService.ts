/**
 * 图片懒加载和缓存服务
 * - 初始只加载缩略图
 * - 按需加载原图并缓存
 * - 避免重复加载
 */

import { apiBlob, apiJson, secureApiUrl } from './httpClient';
import { runWhenIdle } from '../utils/idleScheduler';

// 原图缓存：{ shotId: { imageId: fullImageUrl } }
const imageCache: Map<string, Map<string, string>> = new Map();

// 正在加载的请求：避免重复请求
const loadingPromises: Map<string, Promise<any>> = new Map();

// Blob URL 缓存：将需要认证的URL转换为blob URL
const blobUrlCache: Map<string, string> = new Map();

/**
 * 获取镜头的完整图片数据（带缓存）
 */
export async function loadShotImages(
    projectId: string,
    shotId: string
): Promise<{ images: any[]; selectedImageId?: string }> {
    const cacheKey = `${projectId}:${shotId}`;
    
    // 检查是否已在缓存中
    if (imageCache.has(shotId)) {
        console.log(`📦 从缓存加载镜头 ${shotId} 的图片`);
        // 从缓存返回，但仍然需要请求获取完整数据结构
    }
    
    // 检查是否正在加载
    if (loadingPromises.has(cacheKey)) {
        console.log(`⏳ 等待镜头 ${shotId} 的图片加载完成`);
        return await loadingPromises.get(cacheKey)!;
    }
    
    // 开始加载
    console.log(`🔄 开始加载镜头 ${shotId} 的完整图片数据`);
    const loadPromise = fetchShotImages(projectId, shotId);
    
    loadingPromises.set(cacheKey, loadPromise);
    
    try {
        const result = await loadPromise;
        
        // 缓存结果
        if (result.images && result.images.length > 0) {
            const shotCache = new Map<string, string>();
            result.images.forEach((img: any) => {
                if (img.url) {
                    shotCache.set(img.id, img.url);
                }
            });
            imageCache.set(shotId, shotCache);
            console.log(`✅ 已缓存镜头 ${shotId} 的 ${result.images.length} 张图片`);
        }
        
        return result;
    } finally {
        loadingPromises.delete(cacheKey);
    }
}

/**
 * 从后端获取镜头图片
 */
async function fetchShotImages(
    projectId: string,
    shotId: string
): Promise<{ images: any[]; selectedImageId?: string }> {
    const data = await apiJson<any>(
        `/api/projects/${projectId}/images/${shotId}`,
        { method: 'GET' },
        '加载镜头图片'
    );
    
    // 🔧 将所有图片URL转换为Blob URL，但保留原始URL
    const convertedImages = await convertImageUrlsToBlobUrls(data.images || []);
    
    return {
        images: convertedImages,
        selectedImageId: data.selectedImageId
    };
}

/**
 * 获取单张图片的完整URL（从缓存或加载）
 * @returns { displayUrl: string, originalUrl: string } - displayUrl是Blob URL，originalUrl是原始API路径
 */
export async function getFullImageUrl(
    projectId: string,
    shotId: string,
    imageId: string
): Promise<{ displayUrl: string; originalUrl: string } | null> {
    // 加载整个镜头的图片
    const result = await loadShotImages(projectId, shotId);
    const img = result.images.find((i: any) => i.id === imageId);
    
    if (!img || !img.url) {
        return null;
    }
    
    return {
        displayUrl: img.url,  // 这是Blob URL，用于显示
        originalUrl: img.originalUrl || img.url  // 这是原始URL，用于保存
    };
}

/**
 * 预加载镜头图片（后台静默加载）
 */
export function preloadShotImages(
    projectId: string,
    shotId: string
): void {
    runWhenIdle(() => {
        loadShotImages(projectId, shotId).catch(err => {
            console.warn(`预加载镜头 ${shotId} 失败:`, err);
        });
    }, { fallbackDelayMs: 100 });
}

/**
 * 清空缓存（切换项目时调用）
 */
export function clearImageCache(): void {
    // 清理blob URLs
    blobUrlCache.forEach(blobUrl => {
        URL.revokeObjectURL(blobUrl);
    });
    blobUrlCache.clear();
    
    imageCache.clear();
    loadingPromises.clear();
    console.log('🧹 已清空图片缓存');
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): { shotCount: number; imageCount: number } {
    let imageCount = 0;
    imageCache.forEach(shotCache => {
        imageCount += shotCache.size;
    });
    
    return {
        shotCount: imageCache.size,
        imageCount
    };
}

/**
 * 获取已缓存的Blob URL（如果存在）
 */
export function getCachedBlobUrl(cacheKey: string): string | undefined {
    return blobUrlCache.get(cacheKey);
}

/**
 * 设置Blob URL缓存
 */
export function setCachedBlobUrl(cacheKey: string, blobUrl: string): void {
    blobUrlCache.set(cacheKey, blobUrl);
}

/**
 * 删除特定的Blob URL缓存
 */
export function removeCachedBlobUrl(cacheKey: string): void {
    const blobUrl = blobUrlCache.get(cacheKey);
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrlCache.delete(cacheKey);
        console.log(`🗑️ 已清理Blob缓存: ${cacheKey}`);
    }
}

/**
 * 从镜头缓存中删除特定图片（不影响其他图片）
 * @param shotId 镜头ID
 * @param imageId 图片ID
 */
export function removeImageFromCache(shotId: string, imageId: string): void {
    // 从 imageCache 中删除
    if (imageCache.has(shotId)) {
        const shotCache = imageCache.get(shotId)!;
        if (shotCache.has(imageId)) {
            shotCache.delete(imageId);
            console.log(`🗑️ 已从镜头缓存中删除图片: ${shotId}/${imageId}`);
        }
    }
    
    // 从 blobUrlCache 中删除
    const cacheKey = `${shotId}:${imageId}`;
    removeCachedBlobUrl(cacheKey);
}

/**
 * 清除镜头的所有图片缓存
 */
export function clearShotImageCache(shotId: string): void {
    // 清理 imageCache
    if (imageCache.has(shotId)) {
        imageCache.delete(shotId);
        console.log(`🗑️ 已清理镜头 ${shotId} 的图片缓存`);
    }
    
    // 清理 blobUrlCache 中以该 shotId 开头的缓存
    const keysToDelete: string[] = [];
    blobUrlCache.forEach((_, key) => {
        if (key.startsWith(`${shotId}:`)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => {
        const blobUrl = blobUrlCache.get(key);
        if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
        }
        blobUrlCache.delete(key);
    });
    
    if (keysToDelete.length > 0) {
        console.log(`🗑️ 已清理镜头 ${shotId} 的 ${keysToDelete.length} 个Blob缓存`);
    }
}

/**
 * 将需要认证的图片URL转换为Blob URL
 * 这样img标签就可以直接使用，不会出现401错误
 */
export async function getAuthenticatedImageUrl(imageUrl: string): Promise<string> {
    // 如果不是API URL（如data:image或已经是blob），直接返回
    if (!imageUrl.startsWith('/api/files/') && !imageUrl.startsWith('http')) {
        return imageUrl;
    }
    
    // 检查缓存
    if (blobUrlCache.has(imageUrl)) {
        return blobUrlCache.get(imageUrl)!;
    }
    
    try {
        // 使用共享 httpClient 下载图片
        const securedUrl = secureApiUrl(imageUrl, { absolute: imageUrl.startsWith('/') });
        const blob = await apiBlob(securedUrl, { method: 'GET' }, '下载图片', {
            requireAuth: false,
            includeContentType: false,
        });
        const blobUrl = URL.createObjectURL(blob);
        
        // 缓存blob URL
        blobUrlCache.set(imageUrl, blobUrl);
        console.log(`✅ 已转换图片URL为Blob: ${imageUrl}`);
        
        return blobUrl;
    } catch (error) {
        console.error(`转换图片URL失败: ${imageUrl}`, error);
        return imageUrl; // 返回原URL作为fallback
    }
}

/**
 * 批量转换图片URL为Blob URL
 */
export async function convertImageUrlsToBlobUrls(images: any[]): Promise<any[]> {
    const results = await Promise.all(
        images.map(async (img) => {
            const converted = { ...img };
            
            if (img.url) {
                // 🔧 保存原始URL
                converted.originalUrl = img.url;
                // 转换为Blob URL用于显示
                converted.url = await getAuthenticatedImageUrl(img.url);
            }
            if (img.thumbnail) {
                converted.thumbnail = await getAuthenticatedImageUrl(img.thumbnail);
            }
            
            return converted;
        })
    );
    return results;
}
