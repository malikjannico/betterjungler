import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_CHAMP_SELECT } from '../domain/simulationFixtures';
import { ChampSelectView } from './ChampSelectView';

vi.mock('../services/ddragonService', () => ({
  getChampionIconUrl: (key: string) => `https://example.invalid/${key}.png`,
}));

describe('ChampSelectView', () => {
  it('auto-follows hovered jungler outside Top 5, supports unified draft card, in-app picker, and planner outside draft', () => {
    // 1. Out of champ select -> renders in-app champion picker & rune planner instead of dead empty state
    const { rerender } = render(
      <ChampSelectView
        session={null}
        patchVersion="16.23.1"
        summonerProfile={null}
        highEloMeta={null}
      />
    );
    expect(screen.getByText(/Champion Pool & Rune Planner/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Nocturne/i }));
    expect(screen.getByText(/Nocturne — Optimal Setup/i)).toBeInTheDocument();

    // 2. Hover Master Yi (11) as assigned Top (off-role) -> auto-follows Yi and displays unified Draft card
    const sessionYiOffRole = {
      ...DEMO_CHAMP_SELECT,
      myTeam: DEMO_CHAMP_SELECT.myTeam.map((slot) =>
        slot.isLocalPlayer
          ? { ...slot, championId: 11, assignedPosition: 'top' as const }
          : slot
      ),
    };

    rerender(
      <ChampSelectView
        session={sessionYiOffRole}
        patchVersion="16.23.1"
        summonerProfile={null}
        highEloMeta={null}
      />
    );

    expect(screen.getByRole('region', { name: 'Live draft teams' })).toBeInTheDocument();
    expect(screen.getByText(/Master Yi — Optimal Setup/i)).toBeInTheDocument();
    expect(screen.getByText(/Assigned position:/i)).toBeInTheDocument();
    const applyBtn = screen.getByRole('button', { name: /Apply Master Yi Runes/i });
    expect(applyBtn).not.toBeDisabled();

    // Clean AD/AP percentages without raw numeric weights (no "AD 4 · 50%")
    expect(screen.queryByText(/AD \d+ · \d+%/i)).not.toBeInTheDocument();

    // 3. Hover non-jungle champion (Garen = 86) -> disables apply button with explicit notice
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

    // 4. User picks Amumu via in-app champion picker -> immediately overrides and enables 1-click LCU apply
    fireEvent.click(screen.getByRole('option', { name: /Amumu/i }));
    expect(screen.getByText(/Amumu — Optimal Setup/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply Amumu Runes & Spells/i })).not.toBeDisabled();
  });
});
