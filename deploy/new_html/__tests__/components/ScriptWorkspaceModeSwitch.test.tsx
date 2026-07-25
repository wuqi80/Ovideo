// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptWorkspaceModeSwitch } from '../../components/ScriptWorkspaceModeSwitch';

afterEach(cleanup);

describe('ScriptWorkspaceModeSwitch', () => {
  it('labels both modes and reports an explicit mode change', () => {
    const onChange = vi.fn();
    render(<ScriptWorkspaceModeSwitch mode="writing" onChange={onChange} />);

    expect(screen.getByRole('radio', { name: '写作版' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '快速版' })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('radio', { name: '快速版' }));
    expect(onChange).toHaveBeenCalledWith('quick');
  });
});
