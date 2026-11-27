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
            id: 'grubs',
            name: 'Voidgrubs',
            status: 'prep_vision',
            secondsRemaining: 33,
            nextSpawnFormatted: '00:33',
            actionText: 'Hover top river',
            priority: 'high',
          },
          {
            id: 'dragon',
            name: 'Elemental Dragon',
            status: 'upcoming',
            secondsRemaining: 213,
            nextSpawnFormatted: '03:33',
            actionText: 'Track bot reset',
            priority: 'medium',
          },
        ]}
        buildPlan={null}
        topCue={{
          id: 'cue-1',
          category: 'objective',
          priority: 'urgent',
          title: 'Setup Grubs Vision',
          detail: 'Clear top side camps, push mid wave, and contest Voidgrubs on spawn.',
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
    expect(screen.getByTestId('hud-objective-timer')).toHaveTextContent('0:33');
    expect(screen.getByTestId('hud-objective-timer')).toHaveClass('text-[22px]');
    expect(screen.getByTestId('hud-secondary-objective')).toHaveTextContent('DRG');
    expect(screen.getByTestId('hud-secondary-objective')).toHaveTextContent('3:33');
    expect(screen.getByTestId('hud-macro-cue')).toHaveClass('line-clamp-2');

    // Verify 12px typography floor (no sub-12px classes inside HUD)
    expect(hud.innerHTML).not.toMatch(/text-\[(10|11)px\]/);

    fireEvent.click(screen.getByRole('button', { name: /Expand/i }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
