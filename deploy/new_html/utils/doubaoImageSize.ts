export type DoubaoImageResolution = '1K' | '2K' | '4K';

const LONG_EDGE_BY_RESOLUTION: Record<DoubaoImageResolution, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
};

const SUPPORTED_RATIOS: Record<string, readonly [number, number]> = {
  '1:1': [1, 1],
  '3:4': [3, 4],
  '4:3': [4, 3],
  '9:16': [9, 16],
  '16:9': [16, 9],
};

/**
 * Doubao accepts either a K preset or an explicit WxH size. A K preset leaves
 * the canvas ratio to the model, so ratio-sensitive UI flows must send pixels.
 */
export function recommendDoubaoImageSize(
  ratio: string,
  resolution: DoubaoImageResolution,
): string {
  const dimensions = SUPPORTED_RATIOS[ratio];
  if (!dimensions) return resolution;

  const [ratioWidth, ratioHeight] = dimensions;
  const longEdge = LONG_EDGE_BY_RESOLUTION[resolution];
  if (ratioWidth >= ratioHeight) {
    return `${longEdge}x${Math.round(longEdge * ratioHeight / ratioWidth)}`;
  }
  return `${Math.round(longEdge * ratioWidth / ratioHeight)}x${longEdge}`;
}
