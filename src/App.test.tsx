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

    // Post-Game Review + synchronized chart <-> map timeline scrubber
    fireEvent.click(screen.getByRole('button', { name: /Post-Game Review/i }));
    expect(screen.getByText(/What You Did Good/i)).toBeInTheDocument();
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
});
