/**
 * AudioStagePage.runGenerate — 配音页 TTS 异步化轻量集成测试占位。
 *
 * 2026-05-24 (Task 7)：runGenerate 改为 enqueue + pollTtsTaskUntilDone +
 * per-clip AbortController 后，理想测试应覆盖三条主流程：
 *
 *   1. minimaxTTS → pollTtsTaskUntilDone → updateStoryboardItem → taskRegistry.complete
 *   2. pollTtsTaskUntilDone 失败时 taskRegistry.fail 被调用
 *   3. 生成中切换 episode 时 AbortController 被取消
 *
 * 这些用例需要 mount 整个 <AudioStagePage>，而该组件强依赖 EpisodeContext
 * （complex fixture — storyboardItems / assets / characterVoices / loadSlices ...）。
 *
 * 现阶段的覆盖策略：
 *   - ttsTaskPoller 自身的 4 个单测 (__tests__/services/ttsTaskPoller.test.ts) 保证轮询核心逻辑
 *   - apiService.handleResponse 测试保证 504 detail 平铺
 *   - 这里的 it.todo 用作 future work breadcrumb；不引入 AudioStagePage 以避免
 *     fixture 缺失导致整个测试文件无法 compile
 *
 * 真实端到端覆盖请见 docs/superpowers/plans/minimax-tts-smoke-test.md（手测剧本）。
 */
import { describe, it } from 'vitest';

describe('AudioStagePage.runGenerate (轻量集成 placeholder)', () => {
  it.todo('runGenerate 调用 minimaxTTS → pollTtsTaskUntilDone → updateStoryboardItem → taskRegistry.complete');
  it.todo('pollTtsTaskUntilDone 失败时 taskRegistry.fail 被调用');
  it.todo('生成中切换 episode 时 AbortController 被取消');
});
