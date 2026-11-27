import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_POST_GAME_MATCHES } from './domain/postGameFixtures';
import { DEMO_IN_GAME_MID } from './domain/simulationFixtures';
import type { AppRuntimeState } from './types/riot';

const {
  mockSyncRecentMatches,
  mockFetchSummonerProfile,
  emitGameStateRef,
} = vi.hoisted(() => ({
  mockSyncRecentMatches: vi.fn(),
  mockFetchSummonerProfile: vi.fn(),
  emitGameStateRef: { current: null as ((state: AppRuntimeState) => void) | null },
}));

vi.mock('./services/ddragonService', () => ({
  fetchLatestPatchVersion: vi.fn().mockResolvedValue('16.23.1'),
  syncFullDdragonCatalog: vi.fn().mockResolvedValue({
    patch: '16.23.1',
    championsById: {},
    itemsById: {},
  }),
  getChampionIconUrl: (key: string) => `https://example.invalid/${key}.png`,
  getItemIconUrl: (id: number) => `https://example.invalid/item-${id}.png`,
  getOfficialMapUrl: () => '/map11.png',
}));

vi.mock('./services/tauriBridge', () => ({
  isTauriEnvironment: () => true,
  loadSettings: vi.fn().mockResolvedValue({
    riotId: 'JungleMain#EUW',
    region: 'EUW1',
    lolInstallPath: 'C:\\Riot Games\\League of Legends',
    overlayHotkey: 'Alt+J',
    hudCorner: 'beside-minimap',
    hudOpacity: 92,
    targetDivision: 'PLATINUM IV',
    hasApiKey: true,
    aiCoach: {
      provider: 'off',
      model: 'gemini-2.5-flash',
      endpoint: 'http://127.0.0.1:11434',
      hasApiKey: false,
    },
  }),
  checkRiotApiKeyHealth: vi.fn().mockResolvedValue({
    status: 'valid',
    message: 'OK',
    checkedAt: '2026-11-27T00:00:00Z',
  }),
  getAppMeta: vi.fn().mockResolvedValue({
    version: '0.4.0',
    commitSha: 'test',
    logDir: '',
  }),
  syncDdragonPatch: vi.fn().mockResolvedValue('16.23.1'),
  getAppState: vi.fn().mockResolvedValue({
    phase: 'in_game',
    gameflowPhase: 'InProgress',
    canInstallUpdate: false,
    lcuConnected: true,
    liveClientConnected: true,
    champSelect: null,
    liveGame: DEMO_IN_GAME_MID,
    summonerProfile: {
      riotId: 'JungleMain#EUW',
      puuid: 'puuid-1',
      region: 'EUW1',
      summonerLevel: 100,
      tier: 'GOLD',
      rank: 'II',
      leaguePoints: 40,
      wins: 10,
      losses: 8,
      topMasteryChampionIds: [234],
    },
    patchVersion: '16.23.1',
  } satisfies AppRuntimeState),
  loadClimbGoals: vi.fn().mockResolvedValue([]),
  getCachedMetaSnapshot: vi.fn().mockResolvedValue(null),
  getCachedMatches: vi.fn().mockResolvedValue([DEMO_POST_GAME_MATCHES[1]!]),
  loadLpHistory: vi.fn().mockResolvedValue([]),
  subscribeGameState: vi.fn().mockImplementation(async (onGame: (s: AppRuntimeState) => void) => {
    emitGameStateRef.current = onGame;
    return () => {};
  }),
  syncRecentMatches: mockSyncRecentMatches,
  fetchSummonerProfile: mockFetchSummonerProfile,
  getLcuProfile: vi.fn(),
  checkForAppUpdate: vi.fn().mockResolvedValue({
    available: false,
    currentVersion: '0.4.0',
    latestVersion: null,
    body: null,
    date: null,
  }),
  installAppUpdate: vi.fn(),
  setOverlayMode: vi.fn(),
  upsertClimbGoal: vi.fn(),
  deleteClimbGoal: vi.fn(),
  refreshHighEloMeta: vi.fn(),
  saveSettings: vi.fn(),
  saveRiotApiKey: vi.fn(),
  saveAiApiKey: vi.fn(),
  openLogsFolder: vi.fn(),
}));

import { App } from './App';

describe('Automated Post-Game Sync Loop', () => {
  afterEach(() => {
    vi.useRealTimers();
    mockSyncRecentMatches.mockReset();
    mockFetchSummonerProfile.mockReset();
    localStorage.clear();
  });

  it('ignores stale top matches at 8s, auto-switches PostGameReviewView at 20s on new matchId, and passes true win to fetchSummonerProfile', async () => {
    vi.useFakeTimers();

    const oldMatch = DEMO_POST_GAME_MATCHES[1]!;
    const newMatch = {
      ...DEMO_POST_GAME_MATCHES[0]!,
      matchId: 'EUW1_NEW_POST_GAME_999',
      playedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      championName: 'Viego',
      win: true,
    };

    mockSyncRecentMatches
      .mockResolvedValueOnce([oldMatch])
      .mockResolvedValueOnce([newMatch, oldMatch]);
    mockFetchSummonerProfile.mockResolvedValue({
      riotId: 'JungleMain#EUW',
      puuid: 'puuid-1',
      region: 'EUW1',
      summonerLevel: 100,
      tier: 'GOLD',
      rank: 'II',
      leaguePoints: 62,
      wins: 11,
      losses: 8,
      topMasteryChampionIds: [234],
    });

    render(<App />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Transition from in_game -> post_game
    act(() => {
      emitGameStateRef.current?.({
        phase: 'post_game',
        gameflowPhase: 'EndOfGame',
        canInstallUpdate: true,
        lcuConnected: true,
        liveClientConnected: false,
        champSelect: null,
        liveGame: null,
        summonerProfile: null,
        patchVersion: '16.23.1',
      });
    });

    // Mounted on PostGameReviewView showing oldMatch initially; no sync yet before 8s
    expect(screen.getByText(/Last Game Takeaway/i)).toBeInTheDocument();
    expect(mockSyncRecentMatches).not.toHaveBeenCalled();

    // At 8s: Match-V5 returns stale oldMatch -> must NOT show Auto-Synced or call fetchSummonerProfile
    await act(async () => {
      vi.advanceTimersByTime(8000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockSyncRecentMatches).toHaveBeenCalledTimes(1);
    expect(mockFetchSummonerProfile).not.toHaveBeenCalled();
    expect(screen.queryByText('Auto-Synced')).not.toBeInTheDocument();

    // At 20s: Match-V5 returns newMatch -> switches view to newMatch, shows Auto-Synced, and updates LP with true win
    await act(async () => {
      vi.advanceTimersByTime(12000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockSyncRecentMatches).toHaveBeenCalledTimes(2);
    expect(mockFetchSummonerProfile).toHaveBeenCalledWith(
      'JungleMain#EUW',
      'EUW1',
      true,
      'EUW1_NEW_POST_GAME_999'
    );
    expect(screen.getByText('Auto-Synced')).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Viego vs ${newMatch.enemyJunglerName}`, 'i'))
    ).toBeInTheDocument();
  });
});
