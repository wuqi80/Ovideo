import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf-8');
const storyboardPageSource = readFileSync(resolve(__dirname, '../../pages/StoryboardGenPage.tsx'), 'utf-8');

describe('GenerationPage duplicate generation guards', () => {
  it('routes each shot through the single-flight guard', () => {
    expect(source).toContain('generationRequestsRef.current');
    expect(source).toContain('runSingleFlight(');
    expect(source).toContain('() => executeGenerationForShot(shot, useCurrentState, model, currentRefs)');
  });

  it('does not run automatic review, retry, or model rerouting after generation', () => {
    expect(source).not.toContain('GenerationPage:smartConsistencyRouting');
    expect(source).not.toContain('GenerationPage:qualityReviewEnabled');
    expect(source).not.toContain('GenerationPage:autoRetryConsistency');
    expect(source).not.toContain('reviewStoryboardImage(');
    expect(source).not.toContain('resolveConsistencyModel(');
    expect(source).not.toContain('resolveGenerationAttemptResults(');
    expect(source).not.toContain('生成后自动验收');
    expect(source).not.toContain('不合格自动重试 1 次');
    expect(source).not.toContain('角色一致性优先调度');
  });
});

describe('GenerationPage image output settings', () => {
  it('defaults every storyboard image model to 16:9 and 1K', () => {
    expect(source).toContain("page: 'GenerationPage:imageRatio'");
    expect(source).toContain("defaultValue: '16:9'");
    expect(source).toContain("page: 'GenerationPage:imageK'");
    expect(source).toContain("defaultValue: '1K'");
  });

  it('resolves auto settings before calling any provider', () => {
    expect(source).toContain('const resolvedImageSettings = resolveGptImageSettings(');
    expect(source).toContain('aspectRatio: resolvedImageSettings.ratio');
    expect(source).toContain('ratio: resolvedImageSettings.ratio');
    expect(source).toContain('outputWidth, outputHeight');
  });

  it('explains that automatic mode follows the largest reference image', () => {
    expect(source).toContain('按最大参考图和尺寸自动决定档位');
  });
});

describe('GenerationPage progress feedback', () => {
  it('labels provider progress separately from time-based estimates', () => {
    expect(source).toContain('实时进度');
    expect(source).toContain('预计进度');
    expect(source).toContain('formatStoryboardGenerationEta');
  });

  it('connects ComfyUI provider progress to the active shot', () => {
    expect(source).toContain(
      'progress => updateShotProviderProgress(shot.id, progress)',
    );
  });

  it('shows progress for single-shot and batch generation', () => {
    expect(source).toContain('currentGenerationProgress?.percent');
    expect(source).toContain('batchProgressDisplay?.aggregatePercent');
  });

  it('keeps estimated progress and remaining time on one line', () => {
    expect(source).toContain('mt-1 whitespace-nowrap text-[9px] text-primary/80');
    expect(source).toContain('mt-0.5 whitespace-nowrap text-[8px] text-n300');
    expect(source).toContain('mt-2 whitespace-nowrap text-[10px] text-n300');
  });
});

describe('GenerationPage other storyboard references', () => {
  it('offers other storyboard images without changing the source shot', () => {
    expect(source).toContain("['other-shot', '其他分镜']");
    expect(source).toContain('buildOtherStoryboardImagePickerItems(');
    expect(source).toContain('handleAddOtherStoryboardImage');
    expect(source).toContain('await onLoadAllStoryboardItems();');
    expect(source).toContain('其他分镜图片只建立当前镜头引用，不会修改来源镜头');
  });
});

describe('GenerationPage external reference persistence', () => {
  it('keeps current manual references during unrelated updates and saves edits immediately', () => {
    expect(source).toContain('activeReferenceShotIdRef.current');
    expect(source).toContain('resolveSelectedShotReferences(');
    expect(source).toContain('referencesRef.current = nextReferences');
    expect(source).toContain('configuredReferences: nextReferences');
    expect(source).toContain('referenceConfigInitialized: true');
    expect(source).not.toContain('pendingSaveRef.current');
  });

  it('keeps reference edits in the routed page snapshot while the server save is pending', () => {
    expect(storyboardPageSource).toContain('configuredReferenceDrafts');
    expect(storyboardPageSource).toContain('applyConfiguredReferenceDrafts(');
    expect(storyboardPageSource).toContain('[shotId]: nextReferences');
    expect(storyboardPageSource).toContain('storyboardItemToDbUpdate(resolvedUpdates)');
  });
});

describe('GenerationPage reference actions', () => {
  it('keeps the submitted reference list independent from material bindings', () => {
    expect(source).toContain('handleDeleteReference(ref)');
    expect(source).toContain('从当前镜头删除参考图片');
    expect(source).not.toContain('handleSetReferenceLocked');
    expect(source).not.toContain('detachShotReference');
    expect(source).not.toContain('素材绑定');
    expect(source).not.toContain('当前绑定');
    expect(source).not.toContain('解除素材绑定');
    expect(source).not.toContain('目标镜头的参考图片已锁定');
    expect(source).not.toContain('disabled={selectedShot?.isConfigConfirmed || references.length >= 6}');
    expect(source).not.toContain('disabled={references.length >= 6 || selectedShot?.isConfigConfirmed}');
  });

  it('keeps all reference image actions visible inside narrow cards', () => {
    expect(source).toContain('data-testid="reference-image-actions"');
    expect(source).toContain('grid grid-cols-2 gap-1');
    expect(source).toContain('inline-flex h-5 w-5 items-center justify-center');
  });

  it('copies cross-shot images into submitted references instead of generated results', () => {
    expect(source).toContain("'reference_image',");
    expect(source).toContain(
      'configuredReferences: [...currentReferences, copiedReference].slice(0, 6)',
    );
    expect(source).toContain('从其他镜头的画面分镜结果拖入');
    expect(source).toContain('实际提交参考图片');
  });

  it('uses the requested independent reference labels and preserves bottom scroll space', () => {
    expect(source).toContain('项目素材');
    expect(source).toContain('自动绑定');
    expect(source).not.toContain('从项目素材选择');
    expect(source).not.toContain('恢复绑定素材');
    expect(source).toContain('storyboard-config-pane min-h-0');
    expect(source).toContain('pb-24');
    expect(storyboardPageSource).toContain('layout-safe flex-1 min-h-0 overflow-hidden');
  });
});
