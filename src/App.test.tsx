import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pkg from '../package.json';
import { App } from './App';
import { CompactHudBar } from './components/CompactHudBar';
import { AppErrorBoundary } from './components/ErrorBoundary';
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

  it('boots cleanly on Climb & Goals first nav item without fake defaults or Simulator chrome', async () => {
    await renderAppAndFlush();

    expect(screen.getByText('BetterJungler')).toBeInTheDocument();
    expect(screen.getByText(/Connect League Client or your Riot ID to begin/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 local\/demo ranked games/i)).not.toBeInTheDocument();

    // Simulator pill & preview buttons are completely removed
    expect(screen.queryByRole('button', { name: /Simulator/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Preview sample/i })).not.toBeInTheDocument();

    // Climb & Goals is ordered first above Champ Select in the nav rail
    const navButtons = Array.from(document.querySelectorAll('.m3-rail__dest')).map(
      (btn) => btn.textContent ?? ''
    );
    expect(navButtons[0]).toMatch(/Climb & Goals/i);
    expect(navButtons[1]).toMatch(/Champ Select/i);

    fireEvent.click(screen.getByRole('button', { name: /Win Plan & Map/i }));
    expect(screen.getByText(/Win Plan & Map unlock once draft completes/i)).toBeInTheDocument();
  });

  it('supports Ctrl+B nav collapse, Compact HUD toggle, LiquidGlassFilter, and full Riot legal disclaimer', async () => {
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

    // Full Riot disclaimer is always visible (no toggle/truncate button)
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toMatch(
      /BetterJungler isn't endorsed by Riot Games.*trademarks or registered trademarks of Riot Games, Inc\./i
    );
    expect(screen.queryByRole('button', { name: /Toggle legal disclaimer/i })).not.toBeInTheDocument();

    // Collapsible nav rail Ctrl+B
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(localStorage.getItem('betterjungler_nav_collapsed')).toBe('true');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(localStorage.getItem('betterjungler_nav_collapsed')).toBe('false');

    // Compact HUD toggle
    fireEvent.click(screen.getByRole('button', { name: /Compact HUD/i }));
    expect(screen.getByTestId('compact-hud-bar')).toBeInTheDocument();
    expect(screen.getByText(/HUD armed · appears in game/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Expand/i }));
    expect(screen.getByText('BetterJungler')).toBeInTheDocument();
  });

  it('recovers gracefully from render exceptions via AppErrorBoundary instead of white-screening', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Bomb() {
      if (shouldThrow) throw new Error('boom-render-error');
      return <div>Recovered View</div>;
    }

    try {
      render(
        <AppErrorBoundary>
          <Bomb />
        </AppErrorBoundary>
      );
      expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong/i);
      expect(screen.getByText(/boom-render-error/i)).toBeInTheDocument();

      shouldThrow = false;
      fireEvent.click(screen.getByRole('button', { name: /Restore View/i }));
      expect(screen.getByText('Recovered View')).toBeInTheDocument();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('renders passive kbd shortcut hint when CompactHudBar is click-through', () => {
    const onExpand = vi.fn();
    render(
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
  });

  it("shows What's New banner after upgrade only when idle and renders About & Changelog in Settings", async () => {
    localStorage.setItem('betterjungler_last_seen_version', '0.1.0');
    try {
      await renderAppAndFlush();
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
