import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AudioStagePage timeline visibility', () => {
  it('starts collapsed and lets MultiTrackTimeline control expansion', () => {
    const source = readFileSync(
      resolve(__dirname, '../../pages/AudioStagePage.tsx'),
      'utf-8',
    );

    expect(source).toContain('const [timelineCollapsed, setTimelineCollapsed] = useState(true)');
    expect(source).toContain('collapsed={timelineCollapsed}');
    expect(source).toContain('onCollapsedChange={setTimelineCollapsed}');
  });
});
