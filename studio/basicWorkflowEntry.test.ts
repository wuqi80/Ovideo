import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');
const sidebarSource = readFileSync(resolve(__dirname, 'components/SidebarDock.tsx'), 'utf-8');
const nodeSource = readFileSync(resolve(__dirname, 'components/Node.tsx'), 'utf-8');

describe('basic script-to-video workflow entry', () => {
  it('offers the one-click workflow on the empty canvas and in the template panel', () => {
    expect(appSource).toContain('onClick={createBasicWorkflow}');
    expect(appSource).toContain('onCreateBasicWorkflow={createBasicWorkflow}');
    expect(appSource).toContain("window.confirm('将用基础工作流替换当前画布。当前内容仍可通过撤销恢复，是否继续？')");
    expect(appSource).toContain('saveHistory();');
    expect(sidebarSource).toContain('一键创建基础工作流');
    expect(sidebarSource).toContain('输入剧本 → 生成首帧 → 生成视频');
  });

  it('keeps the script node as an editable, non-generating input', () => {
    expect(nodeSource).toContain('if (node.type === NodeType.PROMPT_INPUT) return null');
    expect(nodeSource).toContain("node.title.includes('剧本')");
    expect(nodeSource).toContain('maxLength={6000}');
  });
});
