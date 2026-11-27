import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_CHAMP_SELECT } from '../domain/simulationFixtures';
import { ChampSelectView } from './ChampSelectView';

vi.mock('../services/ddragonService', () => ({
  getChampionIconUrl: (key: string) => `https://example.invalid/${key}.png`,
}));

describe('ChampSelectView', () => {
  it('auto-follows hovered jungler outside Top 5, blocks unknown hovers, and surfaces off-role notice', () => {
    // 1. Hover Master Yi (11) as assigned Top (off-role) -> auto-follows Yi and displays off-role notice
    const sessionYiOffRole = {
      ...DEMO_CHAMP_SELECT,
      myTeam: DEMO_CHAMP_SELECT.myTeam.map((slot) =>
        slot.isLocalPlayer
          ? { ...slot, championId: 11, assignedPosition: 'top' as const }
          : slot
      ),
    };

    const { rerender } = render(
      <ChampSelectView
        session={sessionYiOffRole}
        patchVersion="16.23.1"
        summonerProfile={null}
        highEloMeta={null}
      />
    );

    expect(screen.getByText(/Master Yi — Optimal Setup/i)).toBeInTheDocument();
    expect(screen.getByText(/Assigned position:/i)).toBeInTheDocument();
    const applyBtn = screen.getByRole('button', { name: /Apply Master Yi Runes/i });
    expect(applyBtn).not.toBeDisabled();

    // 2. Hover non-jungle champion (Garen = 86) -> disables apply button with explicit notice
    const sessionGarenHover = {
      ...DEMO_CHAMP_SELECT,
      myTeam: DEMO_CHAMP_SELECT.myTeam.map((slot) =>
        slot.isLocalPlayer ? { ...slot, championId: 86 } : slot
      ),
    };

    rerender(
      <ChampSelectView
        session={sessionGarenHover}
        patchVersion="16.23.1"
        summonerProfile={null}
        highEloMeta={null}
      />
    );

    expect(
      screen.getByText(/hovered champion is outside the 32-jungler playbook/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply .* Runes & Spells/i })).toBeDisabled();
  });
});
