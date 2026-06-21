import { generateUUID } from '../services/videoService';
import type { UploadedImage, TaskGroup } from '../services/videoTaskTypes';
import type { VideoModel } from '../services/videoModelService';

/**
 * 2026-05-25：构造一个"空卡"任务对——一个 placeholder UploadedImage + 一个关联它的 TaskGroup。
 * 用于在 storyboard 任意位置手工插入新卡，等待本地上传图片后转正。
 *
 * 字段约定：
 *   - image.isPlaceholder = true（沿用 UploadedImage 已有字段，转正后翻为 false）
 *   - image.url = ''（待上传后填充）
 *   - image.filename = '空卡片'（UI 显示标签，区别于 storyboard 同步的"空分镜"）
 *   - group.ids = [image.id]（单图 = I2V 入口）
 *   - group.model = 传入的默认 model（VideoPage 用全局 globalModel）
 *   - group.shotType = 'multi'（大能模型默认值，其他模型忽略此字段）
 */
export function buildEmptyTaskGroup(model: VideoModel): {
    image: UploadedImage;
    group: TaskGroup;
} {
    const imageId = generateUUID();
    const image: UploadedImage = {
        id: imageId,
        url: '',
        filename: '空卡片',
        uploadTime: Date.now(),
        isPlaceholder: true,
    };
    const group: TaskGroup = {
        uuid: generateUUID(),
        ids: [imageId],
        model,
        shotType: 'multi',
    };
    return { image, group };
}
