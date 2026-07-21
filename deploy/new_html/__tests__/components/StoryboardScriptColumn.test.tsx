import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StoryboardScriptColumn } from '../../components/StoryboardScriptColumn';
import type { ProjectFile } from '../../types';

const file = {
  id: 'script-1',
  name: '测试分镜',
  storyboard: {
    items: [
      {
        id: 'shot-1',
        shotNumber: '镜头01',
        originalText: '镜头01\n主角推门进入办公室。',
        scriptSegment: '主角进入办公室',
      },
      {
        id: 'shot-2',
        shotNumber: 2,
        originalText: '镜头02\n主角走向桌边。',
        scriptSegment: '主角走向桌边',
      },
    ],
  },
} as ProjectFile;

describe('StoryboardScriptColumn', () => {
  it('selects the matching design item when a script block is clicked', () => {
    const onSelectItemIds = vi.fn();
    render(
      <StoryboardScriptColumn
        selectedFile={file}
        highlightedItemIds={new Set()}
        onSelectItemIds={onSelectItemIds}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /镜头 01/ }));
    expect(onSelectItemIds).toHaveBeenCalledTimes(1);
    expect(Array.from(onSelectItemIds.mock.calls[0][0])).toEqual(['shot-1']);
  });

  it('scrolls the corresponding script block into view when a design card is selected', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    const { rerender } = render(
      <StoryboardScriptColumn
        selectedFile={file}
        highlightedItemIds={new Set()}
        onSelectItemIds={vi.fn()}
      />,
    );
    rerender(
      <StoryboardScriptColumn
        selectedFile={file}
        highlightedItemIds={new Set(['shot-2'])}
        onSelectItemIds={vi.fn()}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(screen.getByRole('button', { name: /镜头 02/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
