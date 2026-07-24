import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf-8');
const storyboardPageSource = readFileSync(resolve(__dirname, '../../pages/StoryboardGenPage.tsx'), 'utf-8');

describe('GenerationPage duplicate generation guards', () => {
  it('does not automatically submit a second generation request by default', () => {
    expect(source).toContain(
      "page: 'GenerationPage:autoRetryConsistency', episodeId, version: 2, defaultValue: false",
    );
  });

  it('routes each shot through the single-flight guard', () => {
    expect(source).toContain('generationRequestsRef.current');
    expect(source).toContain('runSingleFlight(');
    expect(source).toContain('() => executeGenerationForShot(shot, useCurrentState, model, currentRefs)');
  });

  it('replaces the first failed attempt instead of appending both attempts', () => {
    expect(source).toContain('generated = resolveGenerationAttemptResults(');
    expect(source).not.toContain('generated.push(...await runOnce(2, retryFeedback))');
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
    expect(source).not.toContain('pendingSaveRef.current');
  });

  it('keeps reference edits in the routed page snapshot while the server save is pending', () => {
    expect(storyboardPageSource).toContain('configuredReferenceDrafts');
    expect(storyboardPageSource).toContain('applyConfiguredReferenceDrafts(');
    expect(storyboardPageSource).toContain('[shotId]: nextReferences');
    expect(storyboardPageSource).toContain('storyboardItemToDbUpdate(resolvedUpdates)');
  });
});
