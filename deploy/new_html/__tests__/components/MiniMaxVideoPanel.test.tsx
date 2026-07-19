import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MiniMaxVideoPanel } from '../../components/video/MiniMaxVideoPanel';

const defaultValue = {
    model: 'MiniMax-Hailuo-2.3' as const,
    duration: 6 as const,
    resolution: '768P' as const,
    promptOptimizer: true,
};

describe('MiniMaxVideoPanel', () => {
    it('exposes Standard and Fast model choices', () => {
        const onChange = vi.fn();
        render(
            <MiniMaxVideoPanel
                value={defaultValue}
                prompt="move gently"
                onChange={onChange}
                onPromptChange={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Fast' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            model: 'MiniMax-Hailuo-2.3-Fast',
        }));
    });

    it('disables 10 seconds while 1080P is selected instead of silently changing the resolution', () => {
        render(
            <MiniMaxVideoPanel
                value={{ ...defaultValue, resolution: '1080P' }}
                prompt="test"
                onChange={vi.fn()}
                onPromptChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('option', { name: '10 秒' })).toBeDisabled();
    });

    it('disables 1080P while 10 seconds is selected', () => {
        render(
            <MiniMaxVideoPanel
                value={{ ...defaultValue, duration: 10, resolution: '768P' }}
                prompt="move gently"
                onChange={vi.fn()}
                onPromptChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('option', { name: '1080P' })).toBeDisabled();
    });
});
