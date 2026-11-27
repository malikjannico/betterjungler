import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  it('renders sidebar rail navigation, preserves Solo/Duo anonymity, and synchronizes RiftMap + chart scrubber', async () => {
    await renderAppAndFlush();

    expect(screen.getByText('BETTERJUNGLER')).toBeInTheDocument();
    expect(screen.getByText('Champion Select Draft Coach')).toBeInTheDocument();
    expect(screen.getByText('Ally 1')).toBeInTheDocument();
    expect(screen.queryByText('TopLanerRealName')).not.toBeInTheDocument();

    // Switch to Win Plan & Map -> test interactive RiftMap step & ward buttons
    fireEvent.click(screen.getByRole('button', { name: /Win Plan & Map/i }));
    expect(screen.getByText(/Enemy Win Condition to Deny/i)).toBeInTheDocument();
    expect(screen.getByText(/Enemy Jungle Opening & Lane Gankability/i)).toBeInTheDocument();
    expect(screen.getByText(/Invade Risk:/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Summoner's Rift Jungle Route/i })).toBeInTheDocument();

    const step1 = screen.getByRole('button', { name: /Step 1:/i });
    fireEvent.click(step1);
    expect(screen.getByRole('button', { name: 'Close step detail' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close step detail' }));

    const wardBtn = screen.getByRole('button', { name: /Ward spot: Dragon River Control Ward/i });
    fireEvent.click(wardBtn);
    expect(screen.getByText('Dragon River Control Ward')).toBeInTheDocument();

    // Open Simulator popover -> switch scenario to Mid Game
    fireEvent.click(screen.getByRole('button', { name: /Simulator/i }));
    const selector = screen.getByLabelText('Simulation scenario');
    fireEvent.change(selector, { target: { value: 'in_game_mid' } });
    expect(screen.getByText(/Elemental Dragon/i)).toBeInTheDocument();
    expect(screen.getByText(/Adaptive Item Build/i)).toBeInTheDocument();
    expect(screen.getByText(/900 Smite|1200 Smite|600 Smite/i)).toBeInTheDocument();

    // Post-Game Review + synchronized chart <-> map timeline scrubber + ghost path + JSON export
    fireEvent.click(screen.getByRole('button', { name: /Post-Game Review/i }));
    expect(screen.getByText(/What You Did Good/i)).toBeInTheDocument();
    const ghostBtn = screen.getByRole('button', { name: /Enemy Jungler Ghost/i });
    fireEvent.click(ghostBtn);
    expect(ghostBtn).toHaveAttribute('aria-pressed', 'true');

    const origCreateObjectUrl = URL.createObjectURL;
    const origRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrlSpy = vi.fn<(obj: Blob | MediaSource) => string>(
      () => 'blob:betterjungler-review'
    );
    const revokeObjectUrlSpy = vi.fn();
    URL.createObjectURL = createObjectUrlSpy;
    URL.revokeObjectURL = revokeObjectUrlSpy;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    try {
      fireEvent.click(screen.getByRole('button', { name: /Export Review JSON/i }));
      expect(screen.getByText(/Exported betterjungler-review-/i)).toBeInTheDocument();
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
      const exportedBlob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob | undefined;
      expect(exportedBlob).toBeDefined();
      const exportedText = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
        reader.readAsText(exportedBlob!);
      });
      expect(exportedText).toContain('"schemaVersion": 1');
      expect(exportedText).toContain('"appVersion": "0.3.0"');
      expect(exportedText).not.toContain('puuid');
      expect(exportedText).not.toContain('summonerName');
      expect(exportedText).not.toContain('riotId');
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreateObjectUrl;
      URL.revokeObjectURL = origRevokeObjectUrl;
    }
    const scrubber = screen.getByLabelText('Timeline minute cutoff');
    fireEvent.change(scrubber, { target: { value: '10' } });
    expect(screen.getByText(/Jungle Path & Timeline Replay \(0m – 10m\)/i)).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();

    // Keyboard slider navigation -> syncs chart & map
    const chartSlider = screen.getByRole('slider', { name: 'Inspect match timeline minute' });
    fireEvent.keyDown(chartSlider, { key: 'Home' });
    fireEvent.keyDown(chartSlider, { key: 'ArrowRight' });
    expect(screen.getByText(/Jungle Path & Timeline Replay \(0m – 2m\)/i)).toBeInTheDocument();

    // Climb Ladder & Goals
    fireEvent.click(screen.getByRole('button', { name: /Climb & Goals/i }));
    expect(screen.getByText(/Division Climb Ladder/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommended Next Focus Goals/i)).toBeInTheDocument();
  });

  it('toggles into Compact HUD via button/expand roundtrip, Ctrl+K Simulator with Escape focus return, and renders LiquidGlassFilter', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Expand/i }));
    expect(screen.getByText('BETTERJUNGLER')).toBeInTheDocument();
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
      // Browser demo starts in champ_select -> What's New waits safely until idle
      expect(screen.queryByText(/What's New in v0\.2\.0/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Simulator/i }));
      fireEvent.change(screen.getByLabelText('Simulation scenario'), {
        target: { value: 'idle' },
      });

      expect(screen.getByText(/What's New in v0\.3\.0/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: "Dismiss What's New" }));
      expect(screen.queryByText(/What's New in v0\.3\.0/i)).not.toBeInTheDocument();
      expect(localStorage.getItem('betterjungler_last_seen_version')).toBe('0.3.0');

      expect(screen.getByText(/First-Run Windows Setup/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss setup checklist' }));
      expect(screen.queryByText(/First-Run Windows Setup/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
      expect(screen.getByText(/About & Automatic Updates/i)).toBeInTheDocument();
      expect(screen.getByText('v0.3.0')).toBeInTheDocument();

      // Verify changing HUD scale does not wipe unsaved Riot ID edits
      const riotIdInput = screen.getByLabelText(/Riot ID/i) as HTMLInputElement;
      fireEvent.change(riotIdInput, { target: { value: 'UnsavedSmurf#EUW' } });
      fireEvent.change(screen.getByLabelText('HUD Scale'), { target: { value: '125' } });
      expect(riotIdInput.value).toBe('UnsavedSmurf#EUW');
      expect(screen.getByLabelText('In-Game Minimap Side')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /View Changelog/i }));
      expect(screen.getByText(/Dedicated Two-Window HUD & Windows 11 Mica/i)).toBeInTheDocument();
    } finally {
      localStorage.removeItem('betterjungler_last_seen_version');
    }
  });
});
