import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompactHudBar } from './CompactHudBar';

describe('CompactHudBar', () => {
  it('renders transparent multi-card layout with >=12px text, 22px objective readout, and 2-line clamped cue', () => {
    const onExpand = vi.fn();
    render(
      <CompactHudBar
        phase="in_game"
        gameTime={620}
        objectives={[
          {
            id: 'dragon',
            name: 'Elemental Dragon',
            status: 'prep_vision',
            secondsRemaining: 42,
            nextSpawnFormatted: '00:42',
            actionText: 'Drop river pink ward',
            priority: 'high',
          },
        ]}
        buildPlan={null}
        topCue={{
          id: 'cue-1',
          category: 'objective',
          priority: 'urgent',
          title: 'Setup Dragon Vision',
          detail: 'Clear bot side camps, push mid wave with support, and sweep pit before spawn.',
        }}
        hotkey="Alt+J"
        scalePercent={125}
        onExpand={onExpand}
      />
    );

    const hud = screen.getByTestId('compact-hud-bar');
    expect(hud).toHaveClass('bg-transparent');
    expect(hud).toHaveAttribute('data-scale', '125');
    expect(hud.style.zoom).toBe('1.25');
    expect(screen.getByTestId('hud-objective-timer')).toHaveTextContent('0:42');
    expect(screen.getByTestId('hud-objective-timer')).toHaveClass('text-[22px]');
    expect(screen.getByTestId('hud-macro-cue')).toHaveClass('line-clamp-2');

    // Verify 12px typography floor (no sub-12px classes inside HUD)
    expect(hud.innerHTML).not.toMatch(/text-\[(10|11)px\]/);

    fireEvent.click(screen.getByRole('button', { name: /Expand/i }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
