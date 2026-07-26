// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptWorkspaceModeSwitch } from '../../components/ScriptWorkspaceModeSwitch';

afterEach(cleanup);

describe('ScriptWorkspaceModeSwitch', () => {
  it('puts quick mode first, labels both modes, and reports an explicit mode change', () => {
    const onChange = vi.fn();
    render(<ScriptWorkspaceModeSwitch mode="writing" onChange={onChange} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveTextContent('快速版');
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
    expect(radios[1]).toHaveTextContent('写作版');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');

    expect(screen.getByRole('radio', { name: '写作版' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '快速版' })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(radios[0]);
    expect(onChange).toHaveBeenCalledWith('quick');
  });
});
