import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HudApp } from './HudApp';
import { DEMO_IN_GAME_MID } from './domain/simulationFixtures';
import * as tauriBridge from './services/tauriBridge';

describe('HudApp', () => {
  it('subscribes to game state & preferences and renders 12px click-through HUD telemetry', async () => {
    let pushState: ((s: NonNullable<Awaited<ReturnType<typeof tauriBridge.getAppState>>>) => void) | undefined;
    let pushPrefs: ((p: tauriBridge.HudPreferencesEvent) => void) | undefined;

    const spySubGame = vi
      .spyOn(tauriBridge, 'subscribeGameState')
      .mockImplementation(async (onUpdate) => {
        pushState = onUpdate;
        return () => {};
      });
    const spySubPrefs = vi
      .spyOn(tauriBridge, 'subscribeHudPreferences')
      .mockImplementation(async (onPrefs) => {
        pushPrefs = onPrefs;
        return () => {};
      });

    render(<HudApp />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      pushPrefs?.({
        hudCorner: 'beside-minimap',
        overlayHotkey: 'Alt+B',
        hudOpacity: 85,
        hudScale: 125,
        hudMonitor: 'primary',
        minimapSide: 'right',
      });
      pushState?.({
        phase: 'in_game',
        gameflowPhase: 'InProgress',
        canInstallUpdate: false,
        lcuConnected: true,
        liveClientConnected: true,
        champSelect: null,
        liveGame: DEMO_IN_GAME_MID,
        summonerProfile: null,
        patchVersion: '16.23.1',
      });
    });

    const hud = screen.getByTestId('compact-hud-bar');
    expect(hud).toHaveAttribute('data-scale', '125');
    expect(screen.getByLabelText('Expand hotkey Alt+B')).toBeInTheDocument();
    expect(screen.getByTestId('hud-objective-timer')).toHaveTextContent('LIVE');
    expect(screen.getByTestId('hud-macro-cue')).toBeInTheDocument();

    spySubGame.mockRestore();
    spySubPrefs.mockRestore();
  });
});
