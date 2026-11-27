import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HudApp } from './HudApp';
import { DEMO_IN_GAME_MID } from './domain/simulationFixtures';
import * as tauriBridge from './services/tauriBridge';

describe('HudApp', () => {
  it('subscribes to game state & preferences and renders modular HUD widgets (objectives, build, cs, skill order, game plan, cue)', async () => {
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
    const spySaveWidgets = vi
      .spyOn(tauriBridge, 'saveHudWidgets')
      .mockImplementation(async (w) => w);

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
        liveGame: {
          ...DEMO_IN_GAME_MID,
          activePlayer: {
            ...DEMO_IN_GAME_MID.activePlayer,
            level: 11,
            abilities: {
              Q: { abilityLevel: 5 },
              W: { abilityLevel: 2 },
              E: { abilityLevel: 2 },
              R: { abilityLevel: 1 },
            },
          },
        },
        summonerProfile: null,
        patchVersion: '16.23.1',
      });
    });

    const hud = screen.getByTestId('compact-hud-bar');
    expect(hud).toHaveAttribute('data-scale', '125');
    expect(screen.getByLabelText('Expand hotkey Alt+B')).toBeInTheDocument();
    expect(screen.getByTestId('hud-objective-timer')).toHaveTextContent('LIVE');
    expect(screen.getByTestId('hud-widget-cs')).toBeInTheDocument();
    expect(screen.getByTestId('hud-widget-skillOrder')).toHaveTextContent('LEVEL R NOW');
    expect(screen.getByTestId('hud-macro-cue')).toBeInTheDocument();

    // Unlock HUD for dragging -> shows floating edit bar and toggles widget cleanly
    await act(async () => {
      pushPrefs?.({
        hudCorner: 'beside-minimap',
        overlayHotkey: 'Alt+B',
        hudOpacity: 85,
        hudScale: 125,
        hudMonitor: 'primary',
        minimapSide: 'right',
        hudLocked: false,
      });
    });
    expect(screen.getByText(/HUD Layout Edit/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'CS / min' }));
    expect(spySaveWidgets).toHaveBeenCalled();

    spySubGame.mockRestore();
    spySubPrefs.mockRestore();
    spySaveWidgets.mockRestore();
  });

  it('applies signed patch pack timings, hot-swaps on patch-pack-updated, and avoids 1Hz IPC polling', async () => {
    let pushState: ((s: NonNullable<Awaited<ReturnType<typeof tauriBridge.getAppState>>>) => void) | undefined;
    let pushPack: ((p: Awaited<ReturnType<typeof tauriBridge.installSignedPatchPack>>) => void) | undefined;

    const basePack = (dragonFirstSpawnSec: number): NonNullable<Awaited<ReturnType<typeof tauriBridge.getActivePatchPack>>> => ({
      patch: '16.23.1',
      issuedAt: '2026-11-27T12:00:00Z',
      verified: true,
      metaVerified: true,
      source: 'hot_swapped',
      fallbackReason: null,
      payload: {
        objectiveTimings: {
          scuttleInitialSec: 210,
          dragonFirstSpawnSec,
          dragonRespawnSec: 300,
          elderRespawnSec: 360,
          voidgrubsSpawnSec: 600,
          heraldSpawnSec: 900,
          heraldDespawnSec: 1185,
          atakhanSpawnSec: 1200,
          baronSpawnSec: 1500,
          baronRespawnSec: 360,
        },
        smiteThresholds: {
          baseDamage: 600,
          unleashedDamage: 900,
          primalDamage: 1200,
          unleashedStacks: 20,
          primalStacks: 40,
        },
        metaTierOverrides: [],
      },
    });

    const spySubGame = vi
      .spyOn(tauriBridge, 'subscribeGameState')
      .mockImplementation(async (onUpdate) => {
        pushState = onUpdate;
        return () => {};
      });
    const spySubPrefs = vi
      .spyOn(tauriBridge, 'subscribeHudPreferences')
      .mockImplementation(async () => () => {});
    const spySubPack = vi
      .spyOn(tauriBridge, 'subscribePatchPackUpdated')
      .mockImplementation(async (onUpdate) => {
        pushPack = onUpdate;
        return () => {};
      });
    const spyGetPack = vi
      .spyOn(tauriBridge, 'getActivePatchPack')
      .mockResolvedValue(basePack(330));

    render(<HudApp />);
    await act(async () => {
      await Promise.resolve();
    });

    const liveAt4Min = {
      ...DEMO_IN_GAME_MID,
      gameData: { ...DEMO_IN_GAME_MID.gameData, gameTime: 240 },
      events: { Events: [] },
    };

    await act(async () => {
      pushState?.({
        phase: 'in_game',
        gameflowPhase: 'InProgress',
        canInstallUpdate: false,
        lcuConnected: true,
        liveClientConnected: true,
        champSelect: null,
        liveGame: liveAt4Min,
        summonerProfile: null,
        patchVersion: '16.23.1',
      });
    });

    // At 240s (4:00) with dragonFirstSpawnSec=330 (5:30), countdown is 90s -> 1:30.
    expect(screen.getByTestId('hud-objective-timer')).toHaveTextContent('1:30');
    expect(spyGetPack).toHaveBeenCalledTimes(1);

    // Repeated 1Hz in_game state ticks must not re-poll getActivePatchPack.
    await act(async () => {
      pushState?.({
        phase: 'in_game',
        gameflowPhase: 'InProgress',
        canInstallUpdate: false,
        lcuConnected: true,
        liveClientConnected: true,
        champSelect: null,
        liveGame: { ...liveAt4Min, gameData: { ...liveAt4Min.gameData, gameTime: 240 } },
        summonerProfile: null,
        patchVersion: '16.23.1',
      });
    });
    expect(spyGetPack).toHaveBeenCalledTimes(1);

    // Hot-swap patch pack via event -> timer updates immediately without IPC poll.
    await act(async () => {
      pushPack?.(basePack(315));
    });
    expect(screen.getByTestId('hud-objective-timer')).toHaveTextContent('1:15');

    spySubGame.mockRestore();
    spySubPrefs.mockRestore();
    spySubPack.mockRestore();
    spyGetPack.mockRestore();
  });
});
