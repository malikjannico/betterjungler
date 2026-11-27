import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_POST_GAME_MATCHES } from '../domain/postGameFixtures';
import { computePersonalLearningSnapshot } from '../domain/personalLearningEngine';
import type { ClimbGoal } from '../types/coaching';
import { PersonalLearningPanel } from './PersonalLearningPanel';

describe('PersonalLearningPanel', () => {
  it('renders surfaced mistake signatures, multi-session tilt splits, and adopts recommended Match Focus', async () => {
    const base = DEMO_POST_GAME_MATCHES[1]!;
    const matches = Array.from({ length: 8 }, (_, idx) => ({
      ...base,
      matchId: `EUW1_PANEL_${idx}`,
      playedAt: new Date(Date.UTC(2026, 10, 27, 10, idx * 35, 0)).toISOString(),
    }));
    const snapshot = computePersonalLearningSnapshot(matches, matches, 'PLATINUM IV');
    const onAdoptFocusGoal = vi.fn<(goal: ClimbGoal) => Promise<void>>(async () => {});

    render(
      <PersonalLearningPanel
        snapshot={snapshot}
        currentFocusGoalId={null}
        onAdoptFocusGoal={onAdoptFocusGoal}
      />
    );

    expect(screen.getAllByText(/Confirmed Leak/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Recommended Match Focus:/i)).toBeInTheDocument();
    expect(screen.getByText(/Multi-Session Stamina & Tilt/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Set as Match Focus/i }));
    await waitFor(() => {
      expect(onAdoptFocusGoal).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /Set as Match Focus/i })).not.toBeDisabled();
    });
    expect(onAdoptFocusGoal.mock.calls[0]?.[0]?.isFocusGoal).toBe(true);
  });

  it('renders a safe empty state when snapshot is null and surfaces Adopt errors cleanly', async () => {
    render(<PersonalLearningPanel snapshot={null} />);
    expect(screen.getByText(/Sync jungle matches to unlock personal EWM baselines/i)).toBeInTheDocument();

    const base = DEMO_POST_GAME_MATCHES[1]!;
    const matches = Array.from({ length: 8 }, (_, idx) => ({
      ...base,
      matchId: `EUW1_ERR_${idx}`,
      playedAt: new Date(Date.UTC(2026, 10, 27, 12, idx * 35, 0)).toISOString(),
    }));
    const snapshot = computePersonalLearningSnapshot(matches, matches, 'PLATINUM IV');
    const failingAdopt = vi.fn<(goal: ClimbGoal) => Promise<void>>(async () => {
      throw new Error('SQLite focus update failed');
    });

    render(<PersonalLearningPanel snapshot={snapshot} onAdoptFocusGoal={failingAdopt} />);
    fireEvent.click(screen.getByRole('button', { name: /Set as Match Focus/i }));
    expect(await screen.findByText(/SQLite focus update failed/i)).toBeInTheDocument();
  });
});
