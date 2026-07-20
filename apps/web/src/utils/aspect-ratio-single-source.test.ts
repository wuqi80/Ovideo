import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASPECT_RATIOS, RATIO_TO_SIZE, sizeForRatio } from '@ovideo/shared';

/**
 * 画幅表只许有一份。
 *
 * 【为什么要用读源码这种笨办法】这两页的画幅逻辑长在 React 组件里，本仓的 web
 * 测试没有 DOM 环境（无 jsdom / testing-library），渲染不出来。而真正要钉住的
 * 不是渲染结果，是「本地副本被删掉了、且确实改从 shared 取」这件事——
 * 副本只要还在，下次改 2K 档就又是改一处漏一处。源码断言恰好钉的就是这个。
 */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../pages/${rel}`, import.meta.url)), 'utf8');

const STORYBOARD_STAGE = 'workflow/StoryboardStage.tsx';
const DESIGN_STAGE = 'workflow/DesignStage.tsx';

describe('画幅换算的唯一真相在 @ovideo/shared', () => {
  it.each([STORYBOARD_STAGE, DESIGN_STAGE])('%s 不再自留 RATIO_TO_SIZE 副本', (rel) => {
    const src = read(rel);
    // 本地重新声明一张表 = 副本回归
    expect(src).not.toMatch(/(const|let|var)\s+RATIO_TO_SIZE/);
    // 也不许把尺寸字面量散在页面里
    expect(src).not.toContain('1440x2560');
    expect(src).not.toContain('2560x1440');
  });

  it.each([STORYBOARD_STAGE, DESIGN_STAGE])('%s 从 shared 引画幅表', (rel) => {
    const src = read(rel);
    const importLine = /import\s*\{[^}]*\}\s*from\s*'@ovideo\/shared'/g;
    const imports = src.match(importLine)?.join('\n') ?? '';
    expect(imports).toContain('ASPECT_RATIOS');
    expect(imports).toContain('sizeForRatio');
  });

  it('StoryboardStage 的 RATIO_OPTIONS 由 ASPECT_RATIOS 生成，不是手写数组', () => {
    const src = read(STORYBOARD_STAGE);
    expect(src).toMatch(/RATIO_OPTIONS\s*=\s*ASPECT_RATIOS/);
  });

  it('两页提交生成时都走 sizeForRatio，而非下标查表', () => {
    for (const rel of [STORYBOARD_STAGE, DESIGN_STAGE]) {
      expect(read(rel)).toMatch(/size:\s*sizeForRatio\(/);
      expect(read(rel)).not.toMatch(/RATIO_TO_SIZE\[/);
    }
  });

  /**
   * 缺陷 E：设计图弹窗有画幅选择器却不读项目画幅。向导里选过 16:9，
   * 这里仍默认 9:16——竖构图的参考喂给横构图的目标，一致性从地基就歪了。
   */
  it('DesignStage 的生成弹窗默认画幅跟随项目，而不是写死常量', () => {
    const src = read(DESIGN_STAGE);
    // 不许再有页面级写死默认
    expect(src).not.toMatch(/(const|let|var)\s+DEFAULT_RATIO\b/);
    // 默认值必须由项目画幅推导（脏值经 isAspectRatio 兜到 shared 的默认）
    expect(src).toMatch(
      /defaultRatio[^\n]*=\s*isAspectRatio\(projectRatio\)[\s\S]{0,80}DEFAULT_ASPECT_RATIO/,
    );
    // 打开弹窗时用的就是它
    expect(src).toMatch(/setGenState\(\{\s*prompt:\s*defaultPrompt,\s*ratio:\s*defaultRatio\s*\}\)/);
  });

  it('shared 的表本身覆盖全部画幅，且脏值退回默认而不抛错', () => {
    for (const r of ASPECT_RATIOS) expect(RATIO_TO_SIZE[r]).toMatch(/^\d+x\d+$/);
    expect(sizeForRatio('16:9')).toBe('2560x1440');
    expect(sizeForRatio('bogus')).toBe('1440x2560');
    expect(sizeForRatio(null)).toBe('1440x2560');
  });
});
