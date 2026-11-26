import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./services/ddragonService', async () => {
  const actual = await vi.importActual<typeof import('./services/ddragonService')>(
    './services/ddragonService'
  );
  return {
    ...actual,
    fetchLatestPatchVersion: () => Promise.resolve('16.1.1'),
  };
});

describe('App HUD Integration', () => {
  it('renders Champ Select coach with anonymized Solo/Duo names and Riot legal disclaimer', async () => {
    render(<App />);

    expect(await screen.findByText('BETTERJUNGLER')).toBeInTheDocument();
    expect(screen.getByText('Champion Select Draft Coach')).toBeInTheDocument();
    expect(screen.getByText('Ally 1')).toBeInTheDocument();
    expect(screen.getByText('Enemy 1')).toBeInTheDocument();
    expect(screen.queryByText('TopLanerRealName')).not.toBeInTheDocument();
    expect(
      screen.getByText(/BetterJungler isn't endorsed by Riot Games/i)
    ).toBeInTheDocument();
  });

  it('switches to Win Plan & Map SVG and Live Coach adaptive build views', async () => {
    render(<App />);
    await screen.findByText('BETTERJUNGLER');

    // Switch to Win Plan & Map tab
    fireEvent.click(screen.getByRole('button', { name: /Win Plan & Map/i }));
    expect(
      screen.getByRole('img', { name: /Summoner's Rift Jungle Route and Ward Map/i })
    ).toBeInTheDocument();

    // Switch demo scenario to Full Build and inspect Live Coach
    fireEvent.change(screen.getByLabelText('Simulation scenario'), {
      target: { value: 'in_game_full_build' },
    });
    expect(screen.getByText('FULL BUILD OPTIMIZER ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Full-Build Replacement Alternatives')).toBeInTheDocument();

    // Toggle Compact HUD mode and back
    fireEvent.click(screen.getByRole('button', { name: /Compact HUD/i }));
    expect(screen.getByTestId('compact-hud-bar')).toBeInTheDocument();
  });
});
