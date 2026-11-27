import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pkg from '../package.json';
import { App } from './App';
import { CompactHudBar } from './components/CompactHudBar';
import { LiquidGlassFilter } from './components/LiquidGlassFilter';

vi.mock('./services/ddragonService', () => ({
  fetchLatestPatchVersion: vi.fn().mockResolvedValue('16.23.1'),
  syncFullDdragonCatalog: vi.fn().mockResolvedValue({
    patch: '16.23.1',
    championsById: {},
    itemsById: {},
  }),
  getChampionIconUrl: (key: string) =>
    `https://ddragon.leagueoflegends.com/cdn/16.23.1/img/champion/${key}.png`,
  getItemIconUrl: (id: number) =>
    `https://ddragon.leagueoflegends.com/cdn/16.23.1/img/item/${id}.png`,
  getProfileIconUrl: (id: number) =>
    `https://ddragon.leagueoflegends.com/cdn/16.23.1/img/profileicon/${id}.png`,
  getOfficialMapUrl: () => '/map11.png',
}));

async function renderAppAndFlush() {
  render(<App />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('BetterJungler App Integration', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('boots cleanly on Climb & Goals empty state without fake defaults', async () => {
    await renderAppAndFlush();

    expect(screen.getByText('BetterJungler')).toBeInTheDocument();
    expect(screen.getByText(/Connect League Client or your Riot ID to begin/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 local\/demo ranked games/i)).not.toBeInTheDocument();

    // Champ Select & Win Plan stay honestly gated until active draft/game or explicit sample preview
    fireEvent.click(screen.getByRole('button', { name: /Champ Select/i }));
    expect(screen.getByText('Not in Champ Select')).toBeInTheDocument();
    expect(screen.queryByText(/Top 5 jungle picks/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Win Plan & Map/i }));
    expect(screen.getByText(/Win Plan & Map unlock once draft completes/i)).toBeInTheDocument();
  });

  it('activates Simulator scenarios, enforces Solo/Duo anonymity, 4-clear single-row selector, and seconds-granular Post-Game sync', async () => {
    await renderAppAndFlush();

    // Enter Champ Select sample via EmptyState CTA -> preserves Solo/Duo anonymity
    fireEvent.click(screen.getByRole('button', { name: /Champ Select/i }));
    fireEvent.click(screen.getByRole('button', { name: /Preview sample draft/i }));
    expect(screen.getByText('Champion Select Draft Coach')).toBeInTheDocument();
    expect(screen.getByText('Ally 1')).toBeInTheDocument();
    expect(screen.queryByText('TopLanerRealName')).not.toBeInTheDocument();

    // Win Plan stays locked at 9/10 while player hasn't picked
    fireEvent.click(screen.getByRole('button', { name: /Win Plan & Map/i }));
    expect(screen.getByText(/9\/10 picks locked/i)).toBeInTheDocument();

    // Switch Simulator to Loading -> Win Plan unlocks with 4 Clear Sequence buttons
    fireEvent.click(screen.getByRole('button', { name: /Simulator/i }));
    fireEvent.change(screen.getByLabelText('Simulation scenario'), {
      target: { value: 'loading' },
    });
    expect(screen.getByText(/Deny:/i)).toBeInTheDocument();
    const clearButtons = screen
      .getByRole('group', { name: 'Clear sequence' })
      .querySelectorAll('button');
    expect(clearButtons).toHaveLength(4);

    const step1 = screen.getByRole('button', { name: /Step 1:/i });
    fireEvent.click(step1);
    expect(screen.getByRole('button', { name: 'Close step detail' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close step detail' }));

    const wardBtn = screen.getByRole('button', { name: /Ward spot: Dragon River Control Ward/i });
    fireEvent.click(wardBtn);
    expect(screen.getByText('Dragon River Control Ward')).toBeInTheDocument();

    // Switch Simulator to Mid Game -> Live Coach
    fireEvent.click(screen.getByRole('button', { name: /Simulator/i }));
    fireEvent.change(screen.getByLabelText('Simulation scenario'), {
      target: { value: 'in_game_mid' },
    });
    expect(screen.getByText(/Elemental Dragon/i)).toBeInTheDocument();
    expect(screen.getByText(/Adaptive Jungle Build/i)).toBeInTheDocument();

    // Post-Game Review + Stacked Match Cards -> Detail Subpage + synchronized seconds cursor + JSON export
    fireEvent.click(screen.getByRole('button', { name: /Post-Game Review/i }));
    const matchCards = screen.getByRole('list', { name: 'Match history' }).querySelectorAll('button');
    expect(matchCards.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(matchCards[0]!);
    expect(screen.getByText(/What You Did Good/i)).toBeInTheDocument();

    const ghostBtn = screen.getByRole('button', { name: /Enemy Jungler Ghost/i });
    fireEvent.click(ghostBtn);
    expect(ghostBtn).toHaveAttribute('aria-pressed', 'true');

    const origCreateObjectUrl = URL.createObjectURL;
    const origRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrlSpy = vi.fn<(obj: Blob | MediaSource) => string>(
      () => 'blob:betterjungler-review'
    );
    URL.createObjectURL = createObjectUrlSpy;
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    try {
      fireEvent.click(screen.getByRole('button', { name: /Export Review JSON/i }));
      expect(screen.getByText(/Exported betterjungler-review-/i)).toBeInTheDocument();
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreateObjectUrl;
      URL.revokeObjectURL = origRevokeObjectUrl;
    }

    const scrubber = screen.getByLabelText('Timeline cursor seconds');
    fireEvent.change(scrubber, { target: { value: '600' } });
    expect(screen.getByText(/Jungle Path & Timeline Replay \(0:00 – 10:00\)/i)).toBeInTheDocument();

    const chartSlider = screen.getByRole('slider', { name: 'Inspect match timeline minute' });
    fireEvent.keyDown(chartSlider, { key: 'Home' });
    fireEvent.keyDown(chartSlider, { key: 'ArrowRight' });
    expect(screen.getByText(/Jungle Path & Timeline Replay \(0:00 – 2:00\)/i)).toBeInTheDocument();

    // Climb Ladder & Goals + Match Focus roundtrip + collapsible sidebar Ctrl+B
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(localStorage.getItem('betterjungler_nav_collapsed')).toBe('true');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(localStorage.getItem('betterjungler_nav_collapsed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /Climb & Goals/i }));
    expect(screen.getByRole('heading', { name: 'Climb & Goals', level: 2 })).toBeInTheDocument();
    const pinButtons = screen.getAllByRole('button', { name: /Pin Goal/i });
    fireEvent.click(pinButtons[0]!);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: /Set as Match Focus/i }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: /Post-Game Review/i }));
    const matchCardAfterFocus = screen
      .getByRole('list', { name: 'Match history' })
      .querySelector('button');
    fireEvent.click(matchCardAfterFocus!);
    expect(screen.getByText(/Focus (PASS|MISS)/i)).toBeInTheDocument();
  });

  it('toggles into Compact HUD, Ctrl+K Simulator with Escape focus return, and renders LiquidGlassFilter', async () => {
    const { container } = render(
      <>
        <LiquidGlassFilter />
        <App />
      </>
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('#lg-lens')).not.toBeNull();
    expect(container.querySelector('#rift-desat')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Scenario Simulator' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Scenario Simulator' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Simulator/i }));

    fireEvent.click(screen.getByRole('button', { name: /Compact HUD/i }));
    expect(screen.getByTestId('compact-hud-bar')).toBeInTheDocument();
    expect(screen.getByText(/HUD armed · appears in game/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Expand/i }));
    expect(screen.getByText('BetterJungler')).toBeInTheDocument();
  });

  it('renders passive kbd shortcut hint when CompactHudBar is click-through and displays Riot legal disclaimer', async () => {
    const onExpand = vi.fn();
    const { unmount } = render(
      <CompactHudBar
        phase="in_game"
        gameTime={255}
        objectives={[]}
        buildPlan={null}
        topCue={null}
        hotkey="Alt+J"
        clickThrough
        onExpand={onExpand}
      />
    );
    expect(screen.getByLabelText('Expand hotkey Alt+J').tagName).toBe('KBD');
    unmount();

    await renderAppAndFlush();
    expect(
      screen.getByText(/BetterJungler isn't endorsed by Riot Games/i)
    ).toBeInTheDocument();
  });

  it('shows What\'s New banner after upgrade only when idle and renders About & Changelog in Settings', async () => {
    localStorage.setItem('betterjungler_last_seen_version', '0.1.0');
    try {
      await renderAppAndFlush();
      // Idle on boot -> What's New is shown cleanly
      expect(
        screen.getByText(new RegExp(`What's New in v${pkg.version.replaceAll('.', '\\.')}`, 'i'))
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: "Dismiss What's New" }));
      expect(localStorage.getItem('betterjungler_last_seen_version')).toBe(pkg.version);

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      fireEvent.click(screen.getByRole('button', { name: /^Account & Riot API/ }));
      expect(screen.getByText(/Keyless LCU Mode active/i)).toBeInTheDocument();

      const riotIdInput = screen.getByLabelText(/Riot ID/i) as HTMLInputElement;
      fireEvent.change(riotIdInput, { target: { value: 'UnsavedSmurf#EUW' } });
      expect(riotIdInput.value).toBe('UnsavedSmurf#EUW');

      const proxyInput = screen.getByLabelText('Riot API Proxy URL (HTTPS)') as HTMLInputElement;
      fireEvent.change(proxyInput, { target: { value: 'http://insecure.example.com' } });
      expect(screen.getByText(/Riot API Proxy URL must use HTTPS/i)).toBeInTheDocument();
      fireEvent.change(proxyInput, { target: { value: '' } });

      fireEvent.click(screen.getByRole('button', { name: /^Back to Settings/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Overlay & HUD/ }));
      fireEvent.click(screen.getByRole('button', { name: '125%' }));
      expect(screen.getByLabelText('In-Game Minimap Side')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^Back to Settings/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Updates & About/ }));
      expect(screen.getByText(/About & Automatic Updates/i)).toBeInTheDocument();
      expect(screen.getByText(`v${pkg.version}`)).toBeInTheDocument();
      expect(screen.getByLabelText('Update Mode')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /View Changelog/i }));
      expect(screen.getByText(/Dedicated Two-Window HUD & Windows 11 Mica/i)).toBeInTheDocument();
    } finally {
      localStorage.removeItem('betterjungler_last_seen_version');
    }
  });
});
