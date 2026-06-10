/**
 * prompt_mapper.ts - 角度吸附与提示词映射
 * 负责将连续角度值吸附到固定档位，并生成对应的提示词
 */

// Azimuth 8档映射表（每45°一档）
export const AZIMUTH_SNAPS = [
    { angle: 0, text: 'front view' },
    { angle: 45, text: 'front-right quarter view' },
    { angle: 90, text: 'right side view' },
    { angle: 135, text: 'back-right quarter view' },
    { angle: 180, text: 'back view' },
    { angle: 225, text: 'back-left quarter view' },
    { angle: 270, text: 'left side view' },
    { angle: 315, text: 'front-left quarter view' },
] as const;

// Elevation 4档映射表
export const ELEVATION_SNAPS = [
    { angle: -30, text: 'low-angle shot' },
    { angle: 0, text: 'eye-level shot' },
    { angle: 30, text: 'elevated shot' },
    { angle: 60, text: 'high-angle shot' },
] as const;

// Distance 3档映射表
export const DISTANCE_SNAPS = [
    { min: 0, max: 3, text: 'close-up' },
    { min: 3, max: 6, text: 'medium shot' },
    { min: 6, max: 10, text: 'wide shot' },
] as const;

export interface SnappedValues {
    azimuth: number;       // 吸附后的水平角 (0-360)
    elevation: number;     // 吸附后的俯仰角 (-30 to 60)
    distance: string;      // 距离档位名称
    azimuthText: string;   // 水平角描述
    elevationText: string; // 俯仰角描述
    distanceText: string;  // 距离描述
}

export interface RawValues {
    horizontal: number;  // 原始水平角 (0-360)
    vertical: number;    // 原始俯仰角 (-30 to 90)
    zoom: number;        // 原始缩放值 (0-10)
}

export interface PromptOutput {
    anglePhraseUI: string;    // 逗号风格: "{azimuthText}, {elevationText}, {distanceText}"
    anglePromptSks: string;   // 严格格式: "<sks> {azimuthText} {elevationText} {distanceText}"
    angleDebug: string;       // 调试信息
    snapped: SnappedValues;
    raw: RawValues;
}

/**
 * 将角度吸附到最近的档位
 */
function snapToNearest(value: number, snaps: readonly { angle: number }[]): number {
    let closest = snaps[0].angle;
    let minDiff = Math.abs(value - closest);
    
    for (const snap of snaps) {
        // 对于 azimuth，需要处理 360° 边界情况
        let diff = Math.abs(value - snap.angle);
        // 处理跨越 360° 的情况
        if (snap.angle === 0 && value > 270) {
            diff = Math.abs(value - 360);
        }
        if (diff < minDiff) {
            minDiff = diff;
            closest = snap.angle;
        }
    }
    
    return closest;
}

/**
 * 获取水平角的吸附值和描述
 */
export function snapAzimuth(rawAngle: number): { angle: number; text: string } {
    // 归一化到 0-360
    let normalized = ((rawAngle % 360) + 360) % 360;
    
    const snappedAngle = snapToNearest(normalized, AZIMUTH_SNAPS);
    const snap = AZIMUTH_SNAPS.find(s => s.angle === snappedAngle);
    
    return {
        angle: snappedAngle,
        text: snap?.text || 'front view'
    };
}

/**
 * 获取俯仰角的吸附值和描述
 */
export function snapElevation(rawAngle: number): { angle: number; text: string } {
    // 限制范围 -30 到 90
    const clamped = Math.max(-30, Math.min(90, rawAngle));
    
    const snappedAngle = snapToNearest(clamped, ELEVATION_SNAPS);
    const snap = ELEVATION_SNAPS.find(s => s.angle === snappedAngle);
    
    return {
        angle: snappedAngle,
        text: snap?.text || 'eye-level shot'
    };
}

/**
 * 获取距离的档位描述
 */
export function snapDistance(zoom: number): { text: string; category: string } {
    const clamped = Math.max(0, Math.min(10, zoom));
    
    for (const snap of DISTANCE_SNAPS) {
        if (clamped >= snap.min && clamped < snap.max) {
            return { text: snap.text, category: snap.text };
        }
    }
    
    // 边界情况：zoom === 10
    return { text: 'wide shot', category: 'wide shot' };
}

/**
 * 主映射函数：将原始值转换为吸附值和提示词
 */
export function mapAnglesToPrompt(horizontal: number, vertical: number, zoom: number): PromptOutput {
    const azimuthSnap = snapAzimuth(horizontal);
    const elevationSnap = snapElevation(vertical);
    const distanceSnap = snapDistance(zoom);
    
    const snapped: SnappedValues = {
        azimuth: azimuthSnap.angle,
        elevation: elevationSnap.angle,
        distance: distanceSnap.category,
        azimuthText: azimuthSnap.text,
        elevationText: elevationSnap.text,
        distanceText: distanceSnap.text,
    };
    
    const raw: RawValues = {
        horizontal: Math.round(horizontal * 10) / 10,
        vertical: Math.round(vertical * 10) / 10,
        zoom: Math.round(zoom * 10) / 10,
    };
    
    // 生成提示词
    const anglePhraseUI = `${snapped.azimuthText}, ${snapped.elevationText}, ${snapped.distanceText}`;
    const anglePromptSks = `<sks> ${snapped.azimuthText} ${snapped.elevationText} ${snapped.distanceText}`;
    const angleDebug = `${anglePhraseUI} (horizontal: ${raw.horizontal}°, vertical: ${raw.vertical}°, zoom: ${raw.zoom} | snapped: ${snapped.azimuth}°, ${snapped.elevation}°, ${snapped.distance})`;
    
    return {
        anglePhraseUI,
        anglePromptSks,
        angleDebug,
        snapped,
        raw,
    };
}

